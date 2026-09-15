package com.genersoft.iot.vmp.patrol.controller;

import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.adapter.ProtocolAdapter;
import com.genersoft.iot.vmp.patrol.adapter.ProtocolAdapterRegistry;
import com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper;
import com.genersoft.iot.vmp.patrol.inference.VlmClient;
import com.genersoft.iot.vmp.patrol.inference.YoloClient;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 平台连通性测试 + 装备指令下发 + 媒体回传 + 审计查询 + 报告导出 + 可靠性
 */
@Slf4j
@Tag(name = "巡检平台-联动与测试")
@RestController
@RequestMapping("/api/patrol")
@RequiredArgsConstructor
public class PatrolOpsController {

    private final YoloClient yoloClient;
    private final VlmClient vlmClient;
    private final ProtocolAdapterRegistry adapterRegistry;
    private final PatrolGenericMapper genericMapper;
    private final com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper taskMapper;
    private final com.genersoft.iot.vmp.patrol.security.PatrolAuditLogMapper auditLogMapper;
    private final com.genersoft.iot.vmp.patrol.media.MediaService mediaService;
    private final com.genersoft.iot.vmp.patrol.orchestrator.PatrolOrchestrator orchestrator;
    private final com.genersoft.iot.vmp.patrol.config.PatrolConfigService configService;
    private final com.genersoft.iot.vmp.patrol.media.CloudRecordReconciler cloudRecordReconciler;

    @org.springframework.beans.factory.annotation.Value("${patrol.inference.models-dir:/opt/wvp/models/patrol}")
    private String modelsDir;

    // ---------------- 录像对账 ----------------

    /** 手动触发录像对账（孤儿文件补册）。默认近3天，可指定 days（1-30） */
    @PostMapping("/cloud-record/reconcile")
    @Audit(module = "settings.media", action = "execute", targetType = "录像对账")
    @Operation(summary = "手动触发平台录像对账（孤儿文件补册）")
    public Map<String, Object> reconcileCloudRecord(@RequestParam(defaultValue = "3") int days) {
        if (!PatrolSecurityUtils.hasPerm("settings.media", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        int d = Math.max(1, Math.min(30, days));
        int added = cloudRecordReconciler.reconcile(d);
        return Map.of("ok", true, "days", d, "added", added);
    }

    // ---------------- 连通性测试 ----------------
    @PostMapping("/algo/{id}/test")
    @Audit(module = "settings.ai", action = "execute")
    @Operation(summary = "YOLO 服务连通测试")
    public Map<String, Object> testYolo(@PathVariable int id) {
        checkAi();
        YoloClient.YoloResult r = yoloClient.health();
        return Map.of("ok", r.ok(), "costMs", r.costMs(), "model", "yolov8n", "message", r.error() == null ? "服务正常" : r.error());
    }

    @PostMapping("/model/{id}/test")
    @Audit(module = "settings.ai", action = "execute")
    @Operation(summary = "VLM 模型握手测试（429自动退避重试+备用模型降级）")
    public Map<String, Object> testVlm(@PathVariable int id) {
        checkAi();
        VlmClient.VlmResult r = vlmClient.handshake(id);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", r.ok());
        resp.put("reply", r.ok() ? r.content() : null);
        resp.put("actualModel", r.actualModel());
        resp.put("costMs", r.costMs());
        resp.put("totalTokens", r.totalTokens());
        resp.put("error", r.error());
        if (r.ok() && r.actualModel() != null) {
            try {
                Map<String, Object> model = genericMapper.getOne("patrol_vlm_model", id);
                if (model != null && !r.actualModel().equals(String.valueOf(model.get("model")))) {
                    genericMapper.update("patrol_vlm_model",
                            "model = '" + r.actualModel().replace("'", "''") + "', latency_ms = " + (int) r.costMs(), id);
                } else if (model != null) {
                    genericMapper.update("patrol_vlm_model", "latency_ms = " + (int) r.costMs(), id);
                }
            } catch (Exception ignore) {
            }
        }
        return resp;
    }

    @PostMapping("/robot/{id}/test")
    @Audit(module = "settings.asset", action = "execute")
    @Operation(summary = "装备连通测试")
    public Map<String, Object> testRobot(@PathVariable int id) {
        checkAsset();
        Map<String, Object> device = genericMapper.getOne("patrol_robot_device", id);
        if (device == null) throw new ControllerException(ErrorCode.ERROR404);
        Integer templateId = device.get("template_id") == null ? null : Integer.parseInt(String.valueOf(device.get("template_id")));
        if (templateId == null) {
            return Map.of("ok", false, "error", "装备未绑定协议模板");
        }
        Map<String, Object> template = genericMapper.getOne("patrol_protocol_template", templateId);
        ProtocolAdapter.CommandResult r = adapterRegistry.dispatch(device, template, ProtocolAdapter.CMD_STATUS, Map.of());
        return Map.of("ok", ProtocolAdapter.CommandResult.OK.equals(r.state()),
                "state", r.state(), "costMs", r.costMs(), "error", r.error() == null ? "" : r.error());
    }

    /** 装备指令下发（机器人监控页控制按钮） */
    @PostMapping("/robot/{id}/command")
    @Audit(module = "monitor.robot", action = "execute")
    @Operation(summary = "下发装备指令（能力协商，不支持返回 DISABLED）")
    public Map<String, Object> robotCommand(@PathVariable int id, @RequestBody Map<String, Object> body) {
        String cmd = String.valueOf(body.getOrDefault("command", "status"));
        Map<String, Object> device = genericMapper.getOne("patrol_robot_device", id);
        if (device == null) throw new ControllerException(ErrorCode.ERROR404);
        Integer templateId = device.get("template_id") == null ? null : Integer.parseInt(String.valueOf(device.get("template_id")));
        if (templateId == null) {
            return Map.of("state", PatrolStatus.DISABLED, "error", "装备未绑定协议模板");
        }
        Map<String, Object> template = genericMapper.getOne("patrol_protocol_template", templateId);
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> pm
                ? (Map<String, Object>) pm : Map.of();
        ProtocolAdapter.CommandResult r = adapterRegistry.dispatch(device, template, cmd, params);
        return Map.of("state", r.state(), "data", r.data() == null ? Map.of() : r.data(), "error", r.error() == null ? "" : r.error());
    }

    // ---------------- 媒体回传（推模式）----------------
    // 兼容入口：核心逻辑在 PatrolOrchestrator.analyzeImageRaw/storeImage（与台账识别/观看研判/回放识别共用同一分析管线）
    @PostMapping(value = "/ingest/media")
    @Operation(summary = "设备/机器人媒体回传（JSON base64）：analyze=true 走统一AI分析管线，否则仅存证")
    public Map<String, Object> ingestMedia(@RequestParam(required = false) Integer executionId,
                                           @RequestParam(required = false) Integer waypointId,
                                           @RequestParam(required = false) Integer schemeId,
                                           @RequestParam(required = false) Boolean analyze,
                                           @RequestParam(required = false) String image,
                                           @RequestBody(required = false) String rawBody) {
        // JSON body {"executionId":1,"waypointId":2,"schemeId":2,"analyze":true,"image":"base64"}
        String img = image;
        Integer execId = executionId;
        Integer wpId = waypointId;
        Integer schId = schemeId;
        Boolean doAnalyzeFlag = analyze;
        if (rawBody != null && rawBody.trim().startsWith("{")) {
            JSONObject body = JSONObject.parseObject(rawBody);
            if (img == null) img = body.getString("image");
            if (execId == null) execId = body.getInteger("executionId");
            if (wpId == null) wpId = body.getInteger("waypointId");
            if (schId == null) schId = body.getInteger("schemeId");
            if (doAnalyzeFlag == null) doAnalyzeFlag = body.getBoolean("analyze");
        }
        if (img == null || img.isBlank()) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "缺少 image");
        }
        if (!Boolean.TRUE.equals(doAnalyzeFlag)) {
            return orchestrator.storeImage(img, execId, PatrolStatus.ROBOT);
        }
        Map<String, Object> analysis = orchestrator.analyzeImageRaw(img, execId, wpId, schId, null, PatrolStatus.ROBOT);
        Map<String, Object> out = new HashMap<>();
        out.put("id", analysis.get("mediaId"));
        out.put("url", analysis.get("mediaUrl"));
        out.put("analysis", analysis);
        return out;
    }

    @GetMapping("/media/{id}")
    @Operation(summary = "媒体详情")
    public Map<String, Object> mediaGet(@PathVariable int id) {
        return taskMapper.mediaGet(id);
    }

    /** 图片访问（<img> 无法带 access-token，文件名 UUID 不可猜，故走放行路径）
     *  直接写响应流：绕开 WVP 全局 ResponseBodyAdvice 对 byte[] 的包装 */
    @GetMapping("/media/file/{fileName}")
    @Operation(summary = "巡检图片文件访问")
    public void mediaFile(@PathVariable String fileName, jakarta.servlet.http.HttpServletResponse response) {
        try {
            byte[] bytes = mediaService.read(fileName);
            if (bytes == null) {
                response.setStatus(404);
                return;
            }
            response.setContentType("image/jpeg");
            response.setContentLength(bytes.length);
            response.setHeader("Cache-Control", "public, max-age=604800");
            response.getOutputStream().write(bytes);
            response.flushBuffer();
        } catch (Exception e) {
            try {
                response.setStatus(400);
            } catch (Exception ignore) {
            }
        }
    }

    // ---------------- 算法权重上传 / 推理服务配置 ----------------

    /** 上传 YOLO 权重到推理服务共享目录（/app/models），返回文件名供算法引用 */
    @PostMapping("/algo/upload")
    @Audit(module = "settings.ai", action = "create", targetType = "算法权重")
    @Operation(summary = "上传 YOLO 权重文件(.pt)")
    public Map<String, Object> uploadWeights(@org.springframework.web.bind.annotation.RequestParam("file") org.springframework.web.multipart.MultipartFile file) {
        checkAi();
        String original = file.getOriginalFilename();
        if (original == null || !original.toLowerCase().endsWith(".pt")) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "仅支持 .pt 权重文件");
        }
        try {
            String safe = original.replaceAll("[^a-zA-Z0-9._-]", "_");
            java.nio.file.Path dir = java.nio.file.Paths.get(modelsDir);
            java.nio.file.Files.createDirectories(dir);
            java.nio.file.Path target = dir.resolve(safe);
            file.transferTo(target.toAbsolutePath());
            return Map.of("fileName", safe, "size", file.getSize());
        } catch (Exception e) {
            throw new ControllerException(ErrorCode.ERROR500.getCode(), "权重保存失败: " + e.getMessage());
        }
    }

    /** 本地推理服务地址（界面可改，存 patrol_dict sys_config） */
    @GetMapping("/config/inference")
    @Operation(summary = "读取推理服务配置")
    public Map<String, Object> getInferenceConfig() {
        Map<String, Object> out = new HashMap<>();
        out.put("yoloUrl", configService.get("yolo_url", ""));
        return out;
    }

    @PostMapping("/config/inference")
    @Audit(module = "settings.ai", action = "edit", targetType = "推理服务配置")
    @Operation(summary = "保存推理服务配置")
    public void setInferenceConfig(@RequestBody Map<String, Object> body) {
        checkAi();
        Object url = body.get("yoloUrl");
        if (url != null) {
            configService.set("yolo_url", String.valueOf(url).replaceAll("/$", ""));
        }
    }

    /** 按具体模型测试连通（模型清单里每个模型的"测试"按钮） */
    @PostMapping("/model/{id}/test-model")
    @Audit(module = "settings.ai", action = "execute")
    @Operation(summary = "测试供应商下指定模型")
    public Map<String, Object> testModelById(@PathVariable int id, @RequestBody Map<String, Object> body) {
        checkAi();
        String model = body.get("model") == null ? null : String.valueOf(body.get("model"));
        VlmClient.VlmResult r = vlmClient.handshake(id, model);
        Map<String, Object> resp = new HashMap<>();
        resp.put("ok", r.ok());
        resp.put("reply", r.ok() ? r.content() : null);
        resp.put("actualModel", r.actualModel());
        resp.put("costMs", r.costMs());
        resp.put("totalTokens", r.totalTokens());
        resp.put("error", r.error());
        return resp;
    }

    // ---------------- 审计查询（设置-账号与安全-操作审计） ----------------
    @GetMapping("/audit/list")
    @Operation(summary = "审计日志查询（分页）")
    public Object auditList(@RequestParam(defaultValue = "1") int page,
                            @RequestParam(defaultValue = "20") int count,
                            @RequestParam(required = false) String username,
                            @RequestParam(required = false) String module,
                            @RequestParam(required = false) String result,
                            @RequestParam(required = false) String startTime,
                            @RequestParam(required = false) String endTime) {
        if (!PatrolSecurityUtils.hasPerm("settings.security", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        com.github.pagehelper.PageHelper.startPage(page, count);
        return new com.github.pagehelper.PageInfo<>(auditLogMapper.list(username, module, result, startTime, endTime));
    }

    // ---------------- 报告 ----------------
    @GetMapping("/report/list")
    @Operation(summary = "报告列表（按执行单聚合）")
    public Object reportList() {
        if (!PatrolSecurityUtils.hasPerm("patrol.report", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        return taskMapper.executionRecent(100).stream()
                .filter(e -> "FINISHED".equals(String.valueOf(e.get("status"))))
                .map(e -> {
                    Map<String, Object> r = new HashMap<>(e);
                    r.put("name", "巡检报告-" + e.get("task_name") + "-" + e.get("id"));
                    int total = e.get("total_points") == null ? 0 : Integer.parseInt(String.valueOf(e.get("total_points")));
                    int abnormal = e.get("abnormal_points") == null ? 0 : Integer.parseInt(String.valueOf(e.get("abnormal_points")));
                    r.put("totalPoints", total);
                    r.put("abnormalPoints", abnormal);
                    r.put("normalPoints", total - abnormal);
                    r.put("finishedAt", e.get("finished_at"));
                    return r;
                })
                .toList();
    }

    @GetMapping("/report/{id}")
    @Operation(summary = "报告详情")
    public Map<String, Object> reportGet(@PathVariable int id) {
        if (!PatrolSecurityUtils.hasPerm("patrol.report", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        Map<String, Object> exec = taskMapper.executionGet(id);
        if (exec == null) throw new ControllerException(ErrorCode.ERROR404);
        List<Map<String, Object>> points = taskMapper.resultsOfExecution(id);
        exec.put("abnormalList", points.stream()
                .filter(p -> PatrolStatus.ABNORMAL.equals(String.valueOf(p.get("result"))))
                .toList());
        return exec;
    }

    @GetMapping("/report/{id}/export")
    @Operation(summary = "导出巡检报告明细 xlsx")
    public void reportExport(jakarta.servlet.http.HttpServletResponse response, @PathVariable int id) throws IOException {
        if (!PatrolSecurityUtils.hasPerm("patrol.report", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        Map<String, Object> exec = taskMapper.executionGet(id);
        if (exec == null) throw new ControllerException(ErrorCode.ERROR404);
        List<List<Object>> data = new ArrayList<>();
        for (Map<String, Object> r : taskMapper.resultsOfExecution(id)) {
            data.add(List.of(
                    r.get("waypoint_name") == null ? "" : r.get("waypoint_name"),
                    r.get("identify_type") == null ? "" : r.get("identify_type"),
                    r.get("result") == null ? "" : String.valueOf(r.get("result")),
                    r.get("confidence") == null ? "" : r.get("confidence"),
                    r.get("anomaly_reason") == null ? "" : r.get("anomaly_reason"),
                    r.get("review_status") == null ? "" : String.valueOf(r.get("review_status")),
                    r.get("captured_at") == null ? String.valueOf(r.get("create_time")) : String.valueOf(r.get("captured_at"))));
        }
        String name = exec.get("task_name") == null ? String.valueOf(id) : String.valueOf(exec.get("task_name"));
        String fileName = "巡检报告-" + name + "-" + id + ".xlsx";
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename="
                + java.net.URLEncoder.encode(fileName, java.nio.charset.StandardCharsets.UTF_8));
        List<List<String>> head = List.of("点位", "识别类型", "结论", "置信度(%)", "异常原因", "复核状态", "抓拍时间")
                .stream().map(java.util.Collections::singletonList).toList();
        com.alibaba.excel.EasyExcel.write(response.getOutputStream())
                .head(head)
                .sheet("巡检报告")
                .doWrite(data);
    }

    // ---------------- 可靠性统计 ----------------
    @GetMapping("/stats/reliability")
    @Operation(summary = "可靠性分析统计")
    public Map<String, Object> reliability() {
        if (!PatrolSecurityUtils.hasPerm("patrol.stats", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        Map<String, Object> result = new HashMap<>();
        List<Map<String, Object>> byDay = taskMapper.statsByDay();
        List<Map<String, Object>> recent = taskMapper.executionRecent(500);
        int success = 0;
        for (Map<String, Object> e : recent) {
            if ("FINISHED".equals(String.valueOf(e.get("status")))) success++;
        }
        result.put("normalDays", byDay.size());
        result.put("continuousDays", null);              // 需按天连续统计，未采集
        result.put("recordRate", null);                  // 录像完整性未接入
        result.put("offlineCount", recent.size() - success);
        result.put("onlineHours", null);                 // 在线时长未接入
        result.put("attendanceRate", recent.isEmpty() ? null : success * 100 / recent.size());
        result.put("executionTotal", recent.size());
        result.put("executionFinished", success);

        // 环形指标：仅"任务执行闭环率"可由执行单真实计算，其余需审核/漏检数据源，返回 null 不编造
        java.util.List<Map<String, Object>> rings = new java.util.ArrayList<>();
        rings.add(ring("任务执行闭环率", recent.isEmpty() ? null : success * 100 / recent.size()));
        rings.add(ring("巡视告警人工审核完成率", null));
        rings.add(ring("巡视告警准确率", null));
        rings.add(ring("巡视结果人工审核完成率", null));
        rings.add(ring("巡视点位漏检率", null));
        result.put("rings", rings);
        result.put("notCollected", java.util.List.of(
                "巡视告警人工审核完成率", "巡视告警准确率", "巡视结果人工审核完成率", "巡视点位漏检率",
                "录像完整率", "累计在线时长", "连续正常运行天数"));
        return result;
    }

    /** ring 节点（percent 允许 null = 未采集） */
    private Map<String, Object> ring(String title, Integer percent) {
        Map<String, Object> m = new HashMap<>();
        m.put("title", title);
        m.put("percent", percent);
        return m;
    }

    private void checkAi() {
        if (!PatrolSecurityUtils.hasPerm("settings.ai", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }

    private void checkAsset() {
        if (!PatrolSecurityUtils.hasPerm("settings.asset", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }
}
