package com.genersoft.iot.vmp.patrol.orchestrator;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.conf.UserSetting;
import com.genersoft.iot.vmp.gb28181.bean.CommonGBChannel;
import com.genersoft.iot.vmp.patrol.adapter.ProtocolAdapter;
import com.genersoft.iot.vmp.patrol.adapter.ProtocolAdapterRegistry;
import com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.inference.CompositeAnalyzer;
import com.genersoft.iot.vmp.patrol.ws.PatrolWsEndpoint;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * 巡检任务编排器（P5 核心，异步闭环）：
 * 触发（HTTP 线程）→ 创建执行单 → 虚拟线程异步推进：
 *   对每个点位：采集(FIXED_CHANNEL走WVP截图 / ROBOT走协议适配器或等待回传)
 *   → 建 point_result(ANALYZING) → CompositeAnalyzer(YOLO→知识库→VLM→融合)
 *   → 异常则建 告警+通知+WS推送 → 更新进度 → 收尾。
 * 非幂等指令（startTask）不自动重试，超时回查状态。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PatrolOrchestrator {

    private final PatrolTaskMapper taskMapper;

    private final PatrolGenericMapper genericMapper;

    private final ProtocolAdapterRegistry adapterRegistry;

    private final CompositeAnalyzer compositeAnalyzer;

    @Autowired
    private com.genersoft.iot.vmp.patrol.media.MediaService mediaService;

    /** 手动识别：国标通道需先点播再抓帧 */
    @Autowired
    private com.genersoft.iot.vmp.gb28181.service.IGbChannelPlayService channelPlayService;

    @Autowired
    private com.genersoft.iot.vmp.gb28181.dao.CommonGBChannelMapper commonGBChannelMapper;

    @Value("${patrol.media.upload-dir:./media/patrol}")
    private String mediaDir;

    @Value("${patrol.capture.timeout-ms:15000}")
    private long captureTimeoutMs;

    /** ZLM HTTP API（FIXED_CHANNEL 模式经 getSnap 拉源流截图） */
    @Value("${patrol.capture.zlm-api-url:http://polaris-media:8081}")
    private String zlmApiUrl;

    @Value("${patrol.capture.zlm-secret:su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf}")
    private String zlmSecret;

    @Value("${patrol.capture.zlm-rtsp-port:10002}")
    private int zlmRtspPort;

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();

    /**
     * 触发执行（HTTP 线程内仅做创建，立即返回 executionId）
     */
    @Transactional
    public int startExecution(int taskId, String triggerType) {
        Map<String, Object> task = taskMapper.taskGet(taskId);
        if (task == null) {
            throw new IllegalArgumentException("任务不存在: " + taskId);
        }
        List<Map<String, Object>> points = taskMapper.pointsOfTask(taskId);
        if (points.isEmpty()) {
            throw new IllegalArgumentException("任务未配置点位");
        }
        Map<String, Object> exec = new HashMap<>();
        exec.put("taskId", taskId);
        exec.put("deviceId", task.get("robot_device_id"));
        exec.put("triggerType", triggerType == null ? PatrolStatus.MANUAL : triggerType);
        exec.put("totalPoints", points.size());
        taskMapper.executionInsert(exec);
        int executionId = Integer.parseInt(String.valueOf(exec.get("id")));

        // 若绑定机器人（协议下发）；FIXED_CHANNEL 模式不需要机器人也能跑闭环
        Integer robotId = toInt(task.get("robot_device_id"));
        if (robotId != null) {
            Map<String, Object> device = genericMapper.getOne("patrol_robot_device", robotId);
            if (device != null) {
                Integer templateId = toInt(device.get("template_id"));
                if (templateId != null) {
                    Map<String, Object> template = genericMapper.getOne("patrol_protocol_template", templateId);
                    if (template != null) {
                        Map<String, Object> params = new HashMap<>();
                        params.put("taskId", taskId);
                        params.put("executionId", executionId);
                        ProtocolAdapter.CommandResult r = adapterRegistry.dispatch(device, template,
                                ProtocolAdapter.CMD_START_TASK, params);
                        log.info("[编排器] 任务{}下发 startTask → {} ({}ms)", taskId, r.state(), r.costMs());
                        // 非幂等指令：RESULT_UNKNOWN 时回查一次状态
                        if (ProtocolAdapter.CommandResult.RESULT_UNKNOWN.equals(r.state())) {
                            ProtocolAdapter.CommandResult st = adapterRegistry.dispatch(device, template,
                                    ProtocolAdapter.CMD_STATUS, Map.of());
                            log.info("[编排器] 任务{}回查状态 → {}", taskId, st.state());
                        }
                    }
                }
            }
        }
        return executionId;
    }

    /**
     * 推进执行（由控制器提交到 patrolTaskExecutor 虚拟线程池，HTTP 线程不阻塞）
     */
    public void runExecution(int executionId, int taskId) {
        List<Map<String, Object>> points = taskMapper.pointsOfTask(taskId);
        Map<String, Object> task = taskMapper.taskGet(taskId);
        int total = points.size();
        int finished = 0;
        int abnormal = 0;
        try {
            for (Map<String, Object> point : points) {
                processOnePoint(executionId, taskId, point, task);
                finished++;
                boolean hasAbnormal = hasAbnormalResult(executionId, taskId, point);
                if (hasAbnormal) abnormal++;
                int progress = total == 0 ? 100 : finished * 100 / total;
                taskMapper.executionProgress(executionId, progress, finished, abnormal);
                PatrolWsEndpoint.push("EXECUTION_PROGRESS", Map.of(
                        "id", executionId, "progress", progress, "finishedPoints", finished,
                        "abnormalPoints", abnormal, "totalPoints", total, "status", "RUNNING"));
            }
            taskMapper.executionFinish(executionId, "FINISHED");
            PatrolWsEndpoint.push("EXECUTION_FINISHED", Map.of(
                    "id", executionId, "status", "FINISHED", "abnormalPoints", abnormal, "totalPoints", total));
        } catch (Exception e) {
            log.error("[编排器] 执行{}失败", executionId, e);
            taskMapper.executionFinish(executionId, PatrolStatus.FAILED);
            PatrolWsEndpoint.push("EXECUTION_FINISHED", Map.of("id", executionId, "status", PatrolStatus.FAILED, "error", e.getMessage()));
        }
    }

    /** 处理单个点位：采集 → 分析 → 判定 → 告警/读数 */
    private void processOnePoint(int executionId, int taskId, Map<String, Object> point, Map<String, Object> task) {
        int waypointId = Integer.parseInt(String.valueOf(point.get("waypoint_id")));
        Map<String, Object> waypoint = genericMapper.getOne("patrol_waypoint", waypointId);
        String waypointName = String.valueOf(waypoint == null ? point.get("waypoint_name") : waypoint.get("name"));
        String captureSource = String.valueOf(waypoint == null ? "ONBOARD_CAMERA" : waypoint.getOrDefault("captureSource", "ONBOARD_CAMERA"));

        // 1) 采集
        String imageB64 = capture(point, waypoint, captureSource);
        if (imageB64 == null) {
            // 无图（机器人未回传/摄像机不可用）：记录点位失败但不中断任务
            Map<String, Object> result = new HashMap<>();
            result.put("executionId", executionId);
            result.put("taskId", taskId);
            result.put("taskPointId", point.get("id"));
            result.put("waypointId", waypointId);
            result.put("waypointName", waypointName);
            result.put("result", PatrolStatus.FAILED);
            result.put("processNote", "采集失败：无可用画面（" + captureSource + "）");
            result.put("identifyType", "capture");
            taskMapper.resultInsert(result);
            return;
        }

        // 2) 存媒体
        // 2) 存媒体（图片落盘，库中只存文件名/URL，避免超长）
        String storedFileName;
        int sizeBytes;
        try {
            byte[] imgBytes = java.util.Base64.getDecoder().decode(
                    imageB64.contains("base64,") ? imageB64.substring(imageB64.indexOf("base64,") + 7) : imageB64);
            storedFileName = mediaService.saveBytes(imgBytes);
            sizeBytes = imgBytes.length;
        } catch (Exception e) {
            log.warn("[编排器] 媒体落盘失败: {}", e.getMessage());
            storedFileName = null;
            sizeBytes = imageB64.length() / 2;
        }
        Map<String, Object> media = new HashMap<>();
        media.put("executionId", executionId);
        media.put("pointResultId", null);
        media.put("type", "PHOTO");
        media.put("fileName", storedFileName);
        media.put("path", storedFileName);
        media.put("storageType", mediaService.currentType());
        media.put("objectKey", storedFileName);
        media.put("url", storedFileName == null ? null
                : mediaService.urlOf(storedFileName));
        media.put("size", sizeBytes);
        media.put("source", "FIXED_CHANNEL".equals(captureSource) ? "FIXED_CHANNEL" : PatrolStatus.ROBOT);
        taskMapper.mediaInsert(media);
        int mediaId = Integer.parseInt(String.valueOf(media.get("id")));

        // 3) 建结果（ANALYZING）
        Map<String, Object> result = new HashMap<>();
        result.put("executionId", executionId);
        result.put("taskId", taskId);
        result.put("taskPointId", point.get("id"));
        result.put("waypointId", waypointId);
        result.put("waypointName", waypointName);
        result.put("mediaId", mediaId);
        result.put("schemeId", point.get("scheme_id") != null ? point.get("scheme_id") : task.get("default_scheme_id"));
        result.put("result", PatrolStatus.ANALYZING);
        result.put("processNote", "分析中…");
        taskMapper.resultInsert(result);
        int resultId = Integer.parseInt(String.valueOf(result.get("id")));
        PatrolWsEndpoint.push("POINT_RESULT", Map.of("id", resultId, "waypointName", waypointName, "result", PatrolStatus.ANALYZING));

        // 4) 解析方案（点位级 > 任务级）
        Integer schemeId = point.get("scheme_id") != null ? toInt(point.get("scheme_id")) : toInt(task.get("default_scheme_id"));
        Map<String, Object> scheme = schemeId == null ? null : genericMapper.getOne("patrol_identify_scheme", schemeId);
        String prompt = null;
        String scene = null;
        Map<String, Object> schemeForAnalyzer = new HashMap<>();
        if (scheme != null) {
            schemeForAnalyzer.putAll(scheme);
            // 算法权重文件（yolo_service 按文件名动态加载）
            Integer algoId = toInt(scheme.get("algo_id"));
            if (algoId != null) {
                Map<String, Object> algo = genericMapper.getOne("patrol_algo", algoId);
                if (algo != null) {
                    if (algo.get("file_path") != null) {
                        schemeForAnalyzer.put("algoFilePath", String.valueOf(algo.get("file_path")));
                    }
                    // 算法档案配置的推理服务地址：优先于全局 yolo_url（不同算法可指向不同服务）
                    if (algo.get("endpoint") != null) {
                        schemeForAnalyzer.put("algoEndpoint", String.valueOf(algo.get("endpoint")));
                    }
                }
            }
            Integer promptId = toInt(scheme.get("prompt_id"));
            if (promptId != null) {
                Map<String, Object> p = genericMapper.getOne("patrol_prompt", promptId);
                if (p != null) {
                    prompt = String.valueOf(p.get("content"));
                    scene = p.get("scene") == null ? null : String.valueOf(p.get("scene"));
                }
            }
            // 识别类型取提示词场景（general/meter/indicator_light/switch_status/text_digit）
            schemeForAnalyzer.put("sceneType", scene != null ? scene : "general");
        }
        if (schemeForAnalyzer.isEmpty()) {
            // 键名必须与库表列名一致（vlm_enabled）：CompositeAnalyzer 按 snake_case 读取，
            // 写成驼峰 vlmEnabled 会被忽略，"未配方案时的 VLM 兜底"从来没生效过
            schemeForAnalyzer.put("vlm_enabled", true);
        }

        // 5) 分析链
        CompositeAnalyzer.AnalysisResult ar = compositeAnalyzer.analyze(imageB64, schemeForAnalyzer, prompt, waypointName);
        persistAnalysis(executionId, taskId, resultId, mediaId, waypointId, waypointName, ar, waypoint);
    }

    /**
     * 设备/机器人推模式：媒体回传后对指定媒体执行识别分析（供 /ingest/media 调用）。
     * 复用与任务编排完全相同的分析链与落库/告警逻辑，只是没有 task 上下文。
     */
    public Map<String, Object> analyzeMedia(int mediaId, Integer waypointId, Integer schemeId, String waypointName) {
        return analyzeMediaInternal(mediaId, waypointId, schemeId, waypointName, null);
    }

    /**
     * 手动识别：对指定通道立即抓帧 → 存图 → YOLO/VLM 分析 → 落结果/告警（无任务上下文）。
     * 与任务编排、推模式共用同一条分析链，只有采集入口不同。
     */
    public Map<String, Object> analyzeChannelNow(int channelId, Integer schemeId, String label) {
        Map<String, Object> ch = taskMapper.wvpChannelById(channelId);
        if (ch == null) {
            return Map.of("ok", false, "error", "通道不存在: " + channelId);
        }
        String name = (label == null || label.isBlank())
                ? String.valueOf(ch.getOrDefault("name", "通道" + channelId)) : label;

        String imageB64 = captureByChannel(channelId);
        if (imageB64 == null) {
            return Map.of("ok", false, "error", "抓帧失败：该通道当前取不到画面（离线、拉流失败或国标点播超时）");
        }
        return analyzeImageRaw(imageB64, null, null, schemeId, name, PatrolStatus.MANUAL);
    }

    /** 统一 AI 图像分析入口（台账识别/观看单帧研判/回放识别/机器人回传共用）：存证 → 入库 → 单一分析管线 */
    public Map<String, Object> analyzeImageRaw(String imageB64, Integer executionId, Integer waypointId,
                                               Integer schemeId, String label, String source) {
        if (imageB64 == null || imageB64.isBlank()) {
            return Map.of("ok", false, "error", "缺少图像数据");
        }
        String name = label == null || label.isBlank() ? "回传分析点位" : label;
        String storedFileName;
        int sizeBytes;
        try {
            byte[] imgBytes = java.util.Base64.getDecoder().decode(
                    imageB64.contains("base64,") ? imageB64.substring(imageB64.indexOf("base64,") + 7) : imageB64);
            storedFileName = mediaService.saveBytes(imgBytes);
            sizeBytes = imgBytes.length;
        } catch (Exception e) {
            log.warn("[AI分析] 媒体落盘失败: {}", e.getMessage());
            return Map.of("ok", false, "error", "媒体落盘失败: " + e.getMessage());
        }
        Map<String, Object> media = new HashMap<>();
        media.put("executionId", executionId);
        media.put("pointResultId", null);
        media.put("type", "PHOTO");
        media.put("fileName", storedFileName);
        media.put("path", storedFileName);
        media.put("storageType", mediaService.currentType());
        media.put("objectKey", storedFileName);
        media.put("url", mediaService.urlOf(storedFileName));
        media.put("size", sizeBytes);
        media.put("source", source == null ? PatrolStatus.MANUAL : source);
        taskMapper.mediaInsert(media);
        int mediaId = Integer.parseInt(String.valueOf(media.get("id")));

        Map<String, Object> r = analyzeMediaInternal(mediaId, waypointId, schemeId, name, null);
        Map<String, Object> out = new HashMap<>(r);
        out.put("ok", true);
        out.put("mediaId", mediaId);
        out.put("mediaUrl", media.get("url"));
        return out;
    }

    /** 仅存证不分析（机器人回传 analyze=false 时） */
    public Map<String, Object> storeImage(String imageB64, Integer executionId, String source) {
        if (imageB64 == null || imageB64.isBlank()) {
            return Map.of("ok", false, "error", "缺少图像数据");
        }
        try {
            byte[] imgBytes = java.util.Base64.getDecoder().decode(
                    imageB64.contains("base64,") ? imageB64.substring(imageB64.indexOf("base64,") + 7) : imageB64);
            String fn = mediaService.saveBytes(imgBytes);
            Map<String, Object> media = new HashMap<>();
            media.put("executionId", executionId);
            media.put("pointResultId", null);
            media.put("type", "PHOTO");
            media.put("fileName", fn);
            media.put("path", fn);
            media.put("storageType", mediaService.currentType());
            media.put("objectKey", fn);
            media.put("url", mediaService.urlOf(fn));
            media.put("size", imgBytes.length);
            media.put("source", source == null ? PatrolStatus.ROBOT : source);
            taskMapper.mediaInsert(media);
            return Map.of("ok", true, "id", media.get("id"), "url", media.get("url"));
        } catch (Exception e) {
            return Map.of("ok", false, "error", "媒体保存失败: " + e.getMessage());
        }
    }

    /** 抓帧（手动识别）：代理流走 ZLM 回环/瞬态拉流；国标通道先点播再回环抓帧 */
    private String captureByChannel(int channelDbId) {
        try {
            Map<String, Object> channel = taskMapper.wvpChannelById(channelDbId);
            if (channel == null) return null;
            String streamId = channel.get("stream_id") == null ? null : String.valueOf(channel.get("stream_id"));
            Integer dataType = toInt(channel.get("data_type"));
            if (streamId != null && !streamId.isBlank() && !"NULL".equalsIgnoreCase(streamId)) {
                String app = taskMapper.proxyAppOf(streamId);
                if (app == null || app.isBlank()) app = "live";
                String b64 = zlmSnap("rtsp://127.0.0.1:" + zlmRtspPort + "/" + app + "/" + streamId);
                if (b64 != null) return b64;
                String srcUrl = taskMapper.proxySrcUrl(streamId);
                return srcUrl == null ? null : zlmSnap(srcUrl);
            }
            if (dataType != null && dataType == 1) {
                // 国标通道无常驻流：先点播，等流建立后走 ZLM 回环 RTSP 抓帧
                Object deviceId = channel.get("device_id");
                Object gbChannelId = channel.get("gb_device_id");
                if (deviceId == null || gbChannelId == null) return null;
                CommonGBChannel c = commonGBChannelMapper.queryById(channelDbId);
                if (c == null) return null;                channelPlayService.play(c, null, false, (code, msg, si) -> { });
                String loopback = "rtsp://127.0.0.1:" + zlmRtspPort + "/rtp/" + deviceId + "_" + gbChannelId;
                for (int i = 0; i < 8; i++) {
                    Thread.sleep(1500);
                    String b64 = zlmSnap(loopback);
                    if (b64 != null) return b64;
                }
                log.warn("[手动识别] 国标通道{}点播后仍未抓到帧", channelDbId);
                return null;
            }
            return null;
        } catch (Exception e) {
            log.warn("[手动识别] 抓帧异常: {}", e.getMessage());
            return null;
        }
    }

    private Map<String, Object> analyzeMediaInternal(int mediaId, Integer waypointId, Integer schemeId,
                                                     String waypointName, Integer channelIdForAlarm) {
        Map<String, Object> media = taskMapper.mediaGet(mediaId);
        if (media == null) {
            throw new IllegalArgumentException("媒体不存在: " + mediaId);
        }
        Map<String, Object> waypoint = waypointId == null ? null : genericMapper.getOne("patrol_waypoint", waypointId);
        // 手动识别：无点位，但告警要挂到通道上（便于"看画面"下钻）
        if (waypoint == null && channelIdForAlarm != null) {
            waypoint = new HashMap<>();
            waypoint.put("capture_channel_id", channelIdForAlarm);
        }
        String name = waypointName != null ? waypointName
                : (waypoint != null ? String.valueOf(waypoint.get("name")) : "手动回传点位");
        String path = media.get("path") == null ? null : String.valueOf(media.get("path"));
        byte[] bytes;
        try {
            bytes = mediaService.read(path);
        } catch (Exception e) {
            throw new IllegalArgumentException("读取媒体失败: " + e.getMessage());
        }
        if (bytes == null) {
            throw new IllegalArgumentException("媒体文件不存在: " + path);
        }
        String imageB64 = java.util.Base64.getEncoder().encodeToString(bytes);

        Map<String, Object> scheme = schemeId == null ? null : genericMapper.getOne("patrol_identify_scheme", schemeId);
        String prompt = null;
        String scene = null;
        String schemeName = null;
        String algoName = null;
        String vlmModelName = null;
        String promptName = null;
        Map<String, Object> schemeForAnalyzer = new HashMap<>();
        if (scheme != null) {
            schemeName = scheme.get("name") == null ? null : String.valueOf(scheme.get("name"));
            schemeForAnalyzer.putAll(scheme);
            // 算法权重文件（yolo_service 按文件名动态加载）
            Integer algoId = toInt(scheme.get("algo_id"));
            if (algoId != null) {
                Map<String, Object> algo = genericMapper.getOne("patrol_algo", algoId);
                if (algo != null) {
                    algoName = algo.get("name") == null ? null : String.valueOf(algo.get("name"));
                    if (algo.get("file_path") != null) {
                        schemeForAnalyzer.put("algoFilePath", String.valueOf(algo.get("file_path")));
                    }
                    // 算法档案配置的推理服务地址：优先于全局 yolo_url（不同算法可指向不同服务）
                    if (algo.get("endpoint") != null) {
                        schemeForAnalyzer.put("algoEndpoint", String.valueOf(algo.get("endpoint")));
                    }
                }
            }
            Integer promptId = toInt(scheme.get("prompt_id"));
            if (promptId != null) {
                Map<String, Object> p = genericMapper.getOne("patrol_prompt", promptId);
                if (p != null) {
                    promptName = p.get("name") == null ? null : String.valueOf(p.get("name"));
                    prompt = String.valueOf(p.get("content"));
                    scene = p.get("scene") == null ? null : String.valueOf(p.get("scene"));
                }
            }
            Integer vlmModelId = toInt(scheme.get("vlm_model_id"));
            if (vlmModelId != null) {
                Map<String, Object> vm = genericMapper.getOne("patrol_vlm_model", vlmModelId);
                if (vm != null) {
                    vlmModelName = vm.get("model") == null ? null : String.valueOf(vm.get("model"));
                }
            }
        }
        schemeForAnalyzer.put("sceneType", scene == null ? "general" : scene);
        if (schemeForAnalyzer.isEmpty()) {
            // 键名必须与库表列名一致（vlm_enabled）：CompositeAnalyzer 按 snake_case 读取，
            // 写成驼峰 vlmEnabled 会被忽略，"未配方案时的 VLM 兜底"从来没生效过
            schemeForAnalyzer.put("vlm_enabled", true);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("executionId", null);
        result.put("taskId", null);
        result.put("taskPointId", null);
        result.put("waypointId", waypointId);
        result.put("waypointName", name);
        result.put("mediaId", mediaId);
        result.put("schemeId", schemeId);
        result.put("result", PatrolStatus.ANALYZING);
        result.put("processNote", "推模式回传分析中…");
        taskMapper.resultInsert(result);
        int resultId = Integer.parseInt(String.valueOf(result.get("id")));

        long t0 = System.currentTimeMillis();
        CompositeAnalyzer.AnalysisResult ar = compositeAnalyzer.analyze(imageB64, schemeForAnalyzer, prompt, name);
        persistAnalysis(null, null, resultId, mediaId, waypointId, name, ar, waypoint);

        // 本次实际用到的识别配置：前端「本次使用」胶囊展示（方案/算法/模型/提示词/档位/阈值/耗时）
        boolean algoOn = scheme != null && scheme.get("algo_id") != null;
        boolean vlmOn = scheme == null || Boolean.parseBoolean(String.valueOf(scheme.getOrDefault("vlm_enabled", true)));
        String mode = algoOn && vlmOn ? "yolo_vlm" : (algoOn ? "yolo_only" : "vlm_only");
        Map<String, Object> out = new HashMap<>();
        out.put("resultId", resultId);
        out.put("result", ar.result());
        out.put("confidence", Math.round(ar.confidence() * 10000) / 100.0);
        out.put("identifyType", String.valueOf(ar.identifyType()));
        out.put("identifySubType", ar.identifySubType());
        out.put("anomalyReason", ar.anomalyReason());
        out.put("yolo", ar.yoloJson() == null ? "" : ar.yoloJson());
        out.put("vlm", ar.vlmText() == null ? "" : ar.vlmText());
        out.put("readings", ar.readings());
        out.put("mode", mode);
        out.put("schemeName", schemeName);
        out.put("algoName", algoName);
        out.put("vlmModelName", vlmModelName);
        out.put("promptName", promptName);
        out.put("threshold", scheme == null ? null : scheme.get("threshold"));
        out.put("costMs", System.currentTimeMillis() - t0);
        return out;
    }

    /** 分析结果落库 + 读数 + 异常告警（任务编排与推模式共用） */
    private void persistAnalysis(Integer executionId, Integer taskId, int resultId, int mediaId, Integer waypointId,
                                 String waypointName, CompositeAnalyzer.AnalysisResult ar, Map<String, Object> waypoint) {
        // 6) 结果落库
        Map<String, Object> upd = new HashMap<>();
        upd.put("id", resultId);
        upd.put("yoloJson", ar.yoloJson());
        upd.put("vlmJson", ar.vlmText());
        upd.put("result", ar.result());
        upd.put("identifyType", ar.identifyType());
        upd.put("identifySubType", ar.identifySubType());
        upd.put("defectType", ar.defectType());
        upd.put("confidence", Math.round(ar.confidence() * 10000) / 100.0);
        upd.put("anomalyReason", ar.anomalyReason());
        upd.put("processNote", "分析完成");
        taskMapper.resultUpdate(upd);
        PatrolWsEndpoint.push("POINT_RESULT", Map.of("id", resultId, "waypointName", waypointName,
                "result", ar.result(), "confidence", upd.get("confidence")));

        // 7) 读数入库（曲线数据源）
        for (Map<String, Object> r : ar.readings()) {
            Map<String, Object> reading = new HashMap<>(r);
            reading.put("pointResultId", resultId);
            reading.put("waypointId", waypointId);
            reading.put("readingKey", String.valueOf(r.getOrDefault("readingKey", waypointName)));
            taskMapper.readingInsert(reading);
        }

        // 8) 异常 → 告警 + 通知 + WS
        if (PatrolStatus.ABNORMAL.equals(ar.result())) {
            createAlarm(executionId, taskId, waypointName, ar, resultId, mediaId, waypoint);
        }
    }

    /** 采集：FIXED_CHANNEL 走 WVP 截图；ONBOARD_CAMERA 走协议抓拍 */
    private String capture(Map<String, Object> point, Map<String, Object> waypoint, String captureSource) {
        try {
            Integer channelId = waypoint == null ? null : toInt(waypoint.get("capture_channel_id"));
            if ("FIXED_CHANNEL".equals(captureSource) && channelId != null) {
                return wvpSnap(channelId);
            }
            // 无机器人绑定时，绑定了固定通道的点位也可降级走通道截图
            if (channelId != null && !"FIXED_CHANNEL".equals(captureSource)) {
                String s = wvpSnap(channelId);
                if (s != null) return s;
            }
            return null;
        } catch (Exception e) {
            log.warn("[编排器] 采集失败: {}", e.getMessage());
            return null;
        }
    }

    /** WVP 通道截图：流已在线则经 ZLM 回环 RTSP 抓帧；否则按源地址瞬态拉流抓帧；GB 通道未接入返回 null */
    private String wvpSnap(int channelDbId) {
        try {
            Map<String, Object> channel = taskMapper.wvpChannelById(channelDbId);
            if (channel == null) return null;
            String streamId = channel.get("stream_id") == null ? null : String.valueOf(channel.get("stream_id"));
            if (streamId == null || streamId.isBlank() || "NULL".equalsIgnoreCase(streamId)) {
                log.warn("[编排器] 通道{}为国标通道，在线抓拍需先点播(未接入)，跳过采集", channelDbId);
                return null;
            }
            // 优先：流已在线（拉流代理保持在线），走 ZLM 本机回环 RTSP 抓帧，避免与已有会话抢相机连接
            String app = taskMapper.proxyAppOf(streamId);
            if (app == null || app.isBlank()) app = "live";
            String loopback = "rtsp://127.0.0.1:" + zlmRtspPort + "/" + app + "/" + streamId;
            String b64 = zlmSnap(loopback);
            if (b64 != null) return b64;
            // 回退：按源地址瞬态拉流
            String srcUrl = taskMapper.proxySrcUrl(streamId);
            if (srcUrl == null || srcUrl.isBlank()) return null;
            return zlmSnap(srcUrl);
        } catch (Exception e) {
            log.warn("[编排器] 通道截图失败: {}", e.getMessage());
            return null;
        }
    }

    /** 调 ZLM getSnap 抓一帧；返回 base64 或 null（占位图/失败一律视为失败） */
    private String zlmSnap(String rtspUrl) {
        try {
            String snapUrl = zlmApiUrl + "/index/api/getSnap?secret=" + zlmSecret
                    + "&url=" + java.net.URLEncoder.encode(rtspUrl, java.nio.charset.StandardCharsets.UTF_8)
                    + "&timeout_sec=8&expire_sec=30";
            try (Response resp = http.newCall(new Request.Builder().url(snapUrl).build()).execute()) {
                if (resp.isSuccessful() && resp.body() != null) {
                    byte[] bytes = resp.body().bytes();
                    // ZLM 抓拍失败会返回固定占位图（约47KB），按指纹识别避免把"无信号图"当真实巡检数据
                    if (bytes.length > 1000 && !isZlmPlaceholder(bytes)) {
                        return Base64.getEncoder().encodeToString(bytes);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[编排器] ZLM抓帧失败({}): {}", rtspUrl, e.getMessage());
        }
        return null;
    }

    /** ZLM 无信号占位图指纹：优先用 patrol_dict(sys_config/zlm_placeholder_md5) 持久化值（跨重启可用），
     *  未配置时启动学习一次并回写；ZLM 升级会换占位图，每日凌晨重新校准。避免把"无信号图"当真实巡检数据。 */
    private volatile String placeholderMd5 = null;

    /** 持久化配置键 */
    private static final String PLACEHOLDER_MD5_KEY = "zlm_placeholder_md5";

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private com.genersoft.iot.vmp.patrol.config.PatrolConfigService configService;

    @org.springframework.beans.factory.annotation.Qualifier("patrolTaskExecutor")
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor patrolExecutor;

    /** 启动学习/加载指纹 + 每日校准（ZLM 版本升级会更换占位图） */
    @jakarta.annotation.PostConstruct
    public void initPlaceholderFingerprint() {
        try {
            if (configService != null) {
                String saved = configService.get(PLACEHOLDER_MD5_KEY, null);
                if (saved != null && !saved.isBlank()) {
                    placeholderMd5 = saved.trim();
                    log.info("[编排器] 已加载持久化占位图指纹: {}", placeholderMd5);
                }
            }
            // 启动即校准（异步，不阻塞启动）：无缓存/校准失败都只是记日志，抓帧时还会兜底再学
            Runnable calibrate = () -> {
                try {
                    String learned = learnPlaceholderFingerprint();
                    if (learned != null) placeholderMd5 = learned;
                } catch (Exception e) {
                    log.warn("[编排器] 启动校准占位图指纹失败: {}", e.getMessage());
                }
            };
            if (patrolExecutor != null) {
                patrolExecutor.execute(calibrate);
            } else {
                Thread.ofVirtual().name("patrol-placeholder-init").start(calibrate);
            }
        } catch (Exception e) {
            log.warn("[编排器] 占位图指纹初始化失败: {}", e.getMessage());
        }
    }

    /** 每日 03:30 重新校准（ZLM 升级换图后指纹自动更新） */
    @org.springframework.scheduling.annotation.Scheduled(cron = "0 30 3 * * ?")
    public void refreshPlaceholderFingerprint() {
        try {
            String learned = learnPlaceholderFingerprint();
            if (learned != null) placeholderMd5 = learned;
        } catch (Exception e) {
            log.warn("[编排器] 定时校准占位图指纹失败: {}", e.getMessage());
        }
    }

    /** 对无效 RTSP 地址抓一帧学习指纹；成功则回写 patrol_dict 持久化，下次重启无需重学 */
    private String learnPlaceholderFingerprint() {
        try {
            String bad = "rtsp://127.0.0.1:1/patrol-placeholder-probe";
            String snapUrl = zlmApiUrl + "/index/api/getSnap?secret=" + zlmSecret
                    + "&url=" + java.net.URLEncoder.encode(bad, java.nio.charset.StandardCharsets.UTF_8)
                    + "&timeout_sec=2&expire_sec=1";
            try (Response resp = http.newCall(new Request.Builder().url(snapUrl).build()).execute()) {
                if (resp.isSuccessful() && resp.body() != null) {
                    byte[] bytes = resp.body().bytes();
                    if (bytes.length < 1000) return null; // 异常小图不是占位图
                    String md5 = md5Hex(bytes);
                    if (md5 == null) return null;
                    if (configService != null && !md5.equals(placeholderMd5)) {
                        configService.set(PLACEHOLDER_MD5_KEY, md5);
                    }
                    log.info("[编排器] ZLM无信号占位图指纹: {} ({}字节){}", md5, bytes.length,
                            md5.equals(placeholderMd5) ? "" : "（已更新）");
                    return md5;
                }
            }
        } catch (Exception e) {
            log.warn("[编排器] 占位图指纹学习失败: {}", e.getMessage());
        }
        return null;
    }

    private static String md5Hex(byte[] bytes) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            StringBuilder sb = new StringBuilder();
            for (byte b : md.digest(bytes)) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isZlmPlaceholder(byte[] bytes) {
        String fp = placeholderMd5;
        if (fp == null) {
            // 无持久化缓存且未学过：现场学习一次（原有兜底路径）
            fp = learnPlaceholderFingerprint();
            if (fp != null) placeholderMd5 = fp;
            if (fp == null) return false;
        }
        return fp.equals(md5Hex(bytes));
    }

    /** 机器人媒体走回传接口 POST /api/patrol/ingest/media（推模式），此处不主动抓取 */

    @Transactional
    public void createAlarm(Integer executionId, Integer taskId, String waypointName,
                            CompositeAnalyzer.AnalysisResult ar, int resultId, int mediaId,
                            Map<String, Object> waypoint) {
        String level = "SERIOUS";
        Map<String, Object> alarm = new HashMap<>();
        alarm.put("alarmNo", "ALM-" + System.currentTimeMillis() + "-" + executionId);
        alarm.put("pointResultId", resultId);
        alarm.put("taskId", taskId);
        alarm.put("executionId", executionId);
        alarm.put("waypointName", waypointName);
        alarm.put("channelId", waypoint == null ? null : waypoint.get("capture_channel_id"));
        alarm.put("source", "INSPECT");
        alarm.put("level", level);
        alarm.put("description", "【" + (ar.identifyType() == null ? "智能识别" : ar.identifyType()) + "】" +
                (ar.anomalyReason() == null ? "识别异常" : ar.anomalyReason()));
        alarm.put("identifyType", ar.identifyType());
        alarm.put("identifySubType", ar.identifySubType());
        alarm.put("anomalyReason", ar.anomalyReason());
        alarm.put("mediaId", mediaId);
        taskMapper.alarmInsert(alarm);
        long alarmId = Long.parseLong(String.valueOf(alarm.get("id")));

        // 站内通知（广播）
        Map<String, Object> notice = new HashMap<>();
        notice.put("userId", null);
        notice.put("title", "巡检告警 · " + waypointName);
        notice.put("content", alarm.get("description"));
        notice.put("type", "ALARM");
        notice.put("bizId", alarmId);
        taskMapper.notificationInsert(notice);

        PatrolWsEndpoint.push("ALARM", Map.of(
                "id", alarmId, "waypointName", waypointName, "level", level,
                "description", alarm.get("description"), "alarmTime", new java.util.Date()));
    }

    private boolean hasAbnormalResult(int executionId, int taskId, Map<String, Object> point) {
        List<Map<String, Object>> results = taskMapper.resultsOfExecution(executionId);
        for (Map<String, Object> r : results) {
            if (Objects.equals(String.valueOf(r.get("waypoint_id")), String.valueOf(point.get("waypoint_id")))
                    && PatrolStatus.ABNORMAL.equals(String.valueOf(r.get("result")))) {
                return true;
            }
        }
        return false;
    }

    private Integer toInt(Object v) {
        if (v == null) return null;
        try {
            return Integer.parseInt(String.valueOf(v));
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
