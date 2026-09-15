package com.genersoft.iot.vmp.patrol.controller;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.gb28181.service.IGbChannelService;
import com.genersoft.iot.vmp.patrol.adapter.HikvisionIsapiAdapter;
import com.genersoft.iot.vmp.patrol.adapter.ProtocolAdapter;
import com.genersoft.iot.vmp.patrol.dao.PatrolNvrMapper;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.streamProxy.service.IStreamProxyService;
import com.genersoft.iot.vmp.streamProxy.bean.StreamProxy;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * 设备接入向导（RTSP 直连族：海康/大华/通用/ONVIF-RTSP）：
 * - 测试连通（ZLM 瞬态拉流探活）
 * - 创建接入（拉流代理 + 通道 + 可选归入行政区划 + 可选挂载录像设备NVR）
 * - 录像设备（NVR）档案管理 / 摄像头挂载绑定 / 经 NVR 的云台控制
 * - Excel 模板下载 / 批量导入 / 设备导出（勾选/全选）
 * 国标(GB28181)与推流类接入不在此向导（分别由设备注册/推流天然完成）。
 */
@Slf4j
@Tag(name = "巡检平台-设备接入向导")
@RestController
@RequestMapping("/api/patrol/access")
@RequiredArgsConstructor
public class PatrolAccessController {

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build();

    @Value("${patrol.capture.zlm-api-url:http://polaris-media:8081}")
    private String zlmApiUrl;

    @Value("${patrol.capture.zlm-secret:su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf}")
    private String zlmSecret;

    private final IStreamProxyService streamProxyService;

    private final IGbChannelService gbChannelService;

    private final PatrolTaskMapper taskMapper;

    private final PatrolNvrMapper nvrMapper;

    private final HikvisionIsapiAdapter isapiAdapter;

    @Autowired
    private com.genersoft.iot.vmp.patrol.orchestrator.PatrolOrchestrator orchestrator;

    public record AccessParam(String name, String vendor, String ip, Integer port,
                              String user, String password, Integer channelNo, Integer subtype,
                              String customUrl, Boolean enableAudio, String regionCivilCode,
                              Integer nvrId, Integer nvrChannelNo) {
    }

    // ---------------- 协议 URL 构造（存原始密码，WVP 编码一次正好） ----------------
    public static String buildRtspUrl(AccessParam p) {
        int port = p.port() == null ? 554 : p.port();
        int ch = p.channelNo() == null ? 1 : p.channelNo();
        int sub = p.subtype() == null ? 0 : p.subtype();
        String auth = p.user() == null || p.user().isBlank() ? "" : p.user() + ":" + p.password() + "@";
        return switch (p.vendor() == null ? "generic" : p.vendor()) {
            case "hik" -> String.format("rtsp://%s%s:%d/Streaming/Channels/%d%02d", auth, p.ip(), port, ch, sub + 1);
            case "dahua" -> String.format("rtsp://%s%s:%d/cam/realmonitor?channel=%d&subtype=%d", auth, p.ip(), port, ch, sub);
            case "univ" -> String.format("rtsp://%s%s:%d/media/video%d", auth, p.ip(), port, ch);
            case "generic" -> p.customUrl();
            default -> null;
        };
    }

    // ---------------- 测试连通 ----------------
    @PostMapping("/test")
    @Operation(summary = "接入参数连通性测试（ZLM 瞬态拉流探活）")
    public Map<String, Object> test(@RequestBody AccessParam p) {
        check();
        long t0 = System.currentTimeMillis();
        String url;
        if (p.nvrId() != null) {
            // 挂载到录像设备：与 add() 相同逻辑，从 NVR 取流
            Map<String, Object> nvr = nvrMapper.getById(p.nvrId());
            if (nvr == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "所选录像设备(NVR)不存在");
            url = buildRtspUrl(new AccessParam(p.name(), str(nvr.get("vendor"), "hik"),
                    str(nvr.get("ip"), null), intVal(nvr.get("rtsp_port"), 554),
                    str(nvr.get("username"), null), str(nvr.get("password"), null),
                    p.nvrChannelNo() == null ? 1 : p.nvrChannelNo(), p.subtype(), null, p.enableAudio(), null, null, null));
        } else {
            url = buildRtspUrl(p);
        }
        if (url == null || url.isBlank()) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "无法构造 RTSP 地址，请检查参数");
        }
        String probeStream = "probe_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        boolean ok = false;
        String error = null;
        try {
            zlmGet("/index/api/addStreamProxy?secret=" + zlmSecret
                    + "&vhost=__defaultVhost__&app=probe&stream=" + probeStream
                    + "&url=" + urlencode(url) + "&rtp_type=0&enable_audio=0&enable_mp4=0&retry_count=-1&timeout_sec=6");
            // 轮询确认真的出流（拉起成功≠出流）
            for (int i = 0; i < 4; i++) {
                Thread.sleep(1200);
                String list = zlmGet("/index/api/getMediaList?secret=" + zlmSecret);
                if (list != null && list.contains("\"app\" : \"probe\"") && list.contains(probeStream)) {
                    ok = true;
                    break;
                }
            }
            if (!ok) error = "拉流未出流：地址/账号/密码/码流类型可能不正确";
        } catch (Exception e) {
            error = e.getMessage();
        } finally {
            zlmGet("/index/api/delStreamProxy?secret=" + zlmSecret + "&vhost=__defaultVhost__&app=probe&stream=" + probeStream);
        }
        Map<String, Object> out = new HashMap<>();
        out.put("ok", ok);
        out.put("costMs", System.currentTimeMillis() - t0);
        out.put("resolvedUrl", url);
        out.put("error", error);
        return out;
    }

    // ---------------- 创建接入 ----------------
    @PostMapping("/add")
    @Audit(module = "settings.access", action = "create", targetType = "设备接入")
    @Operation(summary = "创建接入（拉流代理+通道+可选归入区划+可选挂载NVR）")
    public Map<String, Object> add(@RequestBody AccessParam p) {
        checkEdit();
        String url;
        Integer nvrId = p.nvrId();
        Integer nvrChannelNo = p.nvrChannelNo() == null ? 1 : p.nvrChannelNo();
        if (nvrId != null) {
            // 挂载到录像设备：RTSP 从 NVR 取流，通道号 = NVR 侧通道号
            Map<String, Object> nvr = nvrMapper.getById(nvrId);
            if (nvr == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "所选录像设备(NVR)不存在");
            url = buildRtspUrl(new AccessParam(p.name(), str(nvr.get("vendor"), "hik"),
                    str(nvr.get("ip"), null), intVal(nvr.get("rtsp_port"), 554),
                    str(nvr.get("username"), null), str(nvr.get("password"), null),
                    nvrChannelNo, p.subtype(), null, p.enableAudio(), null, null, null));
        } else {
            url = buildRtspUrl(p);
        }
        if (url == null || url.isBlank()) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "无法构造 RTSP 地址");
        }
        String name = p.name() == null || p.name().isBlank() ? (p.ip() == null ? "NVR通道" : p.ip() + "_" + (p.channelNo() == null ? 1 : p.channelNo())) : p.name();
        String stream = "cam_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);

        StreamProxy proxy = new StreamProxy();
        proxy.setType("default");
        proxy.setApp("live");
        proxy.setStream(stream);
        proxy.setSrcUrl(url);
        proxy.setEnableAudio(Boolean.TRUE.equals(p.enableAudio()));
        proxy.setEnableMp4(false);
        proxy.setEnable(true);
        proxy.setTimeout(12);
        // gbDeviceId 必须设置：StreamProxyServiceImpl.add 只在有 gbDeviceId 时才同步创建通用通道行，
        // 否则台账/通道管理看不到这条接入
        proxy.setGbDeviceId("3402000000132" + String.format("%07d",
                Math.abs(UUID.randomUUID().getLeastSignificantBits()) % 10000000));
        proxy.setGbName(name);
        streamProxyService.add(proxy);

        // add 只写库不触发 ZLM，start 才真正去源拉流（失败不阻断，可手动拉起）
        try {
            streamProxyService.startByAppAndStream("live", stream, (code, msg, streamInfo) -> {
                if (code != 0) {
                    log.warn("[接入向导] 自动拉流未成功(可在拉流代理页手动拉起): stream={}, code={}, msg={}", stream, code, msg);
                }
            });
        } catch (Exception e) {
            log.warn("[接入向导] 自动拉流异常(可手动拉起): {}", e.getMessage());
        }

        // 找到新通道（本次生成的 gbDeviceId 唯一可定位；stock 插入代理后拿不到自增 id，关联字段在此显式补全），
        // 然后归入行政区划 + 挂载到录像设备（绑定用于云台经NVR下发）
        Integer channelId = taskMapper.channelIdByGbDeviceId(proxy.getGbDeviceId());
        if (channelId != null) {
            Integer proxyId = taskMapper.proxyIdByStream(stream);
            taskMapper.channelFillStream(channelId, stream, name, proxyId == null ? 0 : proxyId);
            if (p.regionCivilCode() != null && !p.regionCivilCode().isBlank()) {
                try {
                    gbChannelService.addChannelToRegion(p.regionCivilCode(), List.of(channelId));
                } catch (Exception e) {
                    log.warn("[接入向导] 区划绑定失败(不影响接入): {}", e.getMessage());
                }
            }
            if (nvrId != null) {
                try {
                    nvrMapper.bind(nvrId, channelId, nvrChannelNo);
                } catch (Exception e) {
                    log.warn("[接入向导] NVR挂载绑定失败(不影响接入): {}", e.getMessage());
                }
            }
        }
        Map<String, Object> out = new HashMap<>();
        out.put("channelId", channelId);
        out.put("stream", stream);
        out.put("srcUrl", url);
        return out;
    }

    // ================= 存储节点（ZLM 存储节点 / 厂商 NVR 统一抽象） =================

    /** 统一存储节点列表：kind=ZLM（自研存储节点，含容量/在录路数）或 NVR（厂商录像设备） */
    @GetMapping("/storage-nodes")
    @Operation(summary = "存储节点统一列表（ZLM 存储节点 + 厂商 NVR）")
    public List<Map<String, Object>> storageNodes() {
        check();
        List<Map<String, Object>> out = new ArrayList<>();
        List<Map<String, Object>> stats = nvrMapper.cloudRecordStats();
        Map<String, Map<String, Object>> statOf = new HashMap<>();
        for (Map<String, Object> s : stats) {
            statOf.put(String.valueOf(s.get("mediaServerId")), s);
        }
        List<Map<String, Object>> storageRows = nvrMapper.storageAll();
        for (Map<String, Object> ms : nvrMapper.mediaServers()) {
            String id = String.valueOf(ms.get("id"));
            Map<String, Object> node = new HashMap<>(ms);
            node.put("kind", "ZLM");
            node.put("nodeId", "zlm:" + id);
            node.put("name", "ZLM 存储节点（" + id + "）");
            node.put("role", "推流 + 存储（平台录像）");
            Map<String, Object> st = statOf.get(id);
            long bytes = st == null ? 0L : Long.parseLong(String.valueOf(st.get("bytes")));
            node.put("recordCount", st == null ? 0 : st.get("cnt"));
            node.put("usedBytes", bytes);
            node.put("usedText", bytes > 0 ? String.format("%.1f GB", bytes / 1024.0 / 1024 / 1024) : "0 MB");
            node.put("assignedCount", storageRows.stream()
                    .filter(x -> "ZLM".equalsIgnoreCase(String.valueOf(x.get("storageType")))).count());
            node.put("capabilities", List.of("预览转发", "录像存储", "抓帧(AI素材)", "按需拉流", "水平扩展"));
            out.add(node);
        }
        for (Map<String, Object> r : nvrMapper.list()) {
            String id = String.valueOf(r.get("id"));
            Map<String, Object> node = new HashMap<>();
            node.put("kind", "NVR");
            node.put("nodeId", "nvr:" + id);
            node.put("id", r.get("id"));
            node.put("name", r.get("name"));
            node.put("ip", r.get("ip"));
            node.put("apiPort", r.get("api_port"));
            node.put("rtspPort", r.get("rtsp_port"));
            node.put("vendor", r.get("vendor"));
            node.put("username", r.get("username"));
            node.put("hasPassword", r.get("password") != null && !String.valueOf(r.get("password")).isBlank());
            node.put("channelCount", r.get("channel_count"));
            node.put("recordDay", null);
            node.put("role", "厂商录像（本机录像由 NVR 负责，平台只读检索）");
            long mounted = nvrMapper.bindings().stream()
                    .filter(b -> String.valueOf(b.get("nvrId")).equals(id)).count();
            node.put("assignedCount", mounted);
            node.put("recordCount", null);
            node.put("usedText", "存于 NVR 本机硬盘");
            node.put("capabilities", List.of("本机录像(只读)", "录像检索回放", "云台/预置位", "OSD/巡航(在NVR配置)"));
            out.add(node);
        }
        return out;
    }

    @GetMapping("/storage/list")
    @Operation(summary = "各通道录像归属列表（前端建映射用）")
    public List<Map<String, Object>> storageList() {
        check();
        return nvrMapper.storageAll();
    }

    @GetMapping("/stream-online")
    @Operation(summary = "ZLM 在线流集合(app/stream)。拉流状态以 ZLM 实际收流为准——WVP 重启会复位 pulling 标志且无新事件纠正，不能作为事实源")
    public List<String> streamOnline() {
        List<String> keys = new java.util.ArrayList<>();
        String body = zlmGet("/index/api/getMediaList?secret=" + zlmSecret);
        if (body == null || body.isEmpty()) {
            return keys;
        }
        try {
            JSONObject json = JSONObject.parseObject(body);
            JSONArray data = json == null ? null : json.getJSONArray("data");
            if (data != null) {
                java.util.Set<String> seen = new java.util.HashSet<>();
                for (int i = 0; i < data.size(); i++) {
                    JSONObject m = data.getJSONObject(i);
                    if (m == null) continue;
                    String key = m.getString("app") + "/" + m.getString("stream");
                    if (seen.add(key)) {
                        keys.add(key);
                    }
                }
            }
        } catch (Exception ignored) {
            // ZLM 返回异常时按"无在线流"处理，前端如实显示未拉流
        }
        return keys;
    }

    @DeleteMapping("/channel")
    @Audit(module = "settings.access", action = "delete", targetType = "摄像机通道")
    @Operation(summary = "删除拉流代理通道（RTSP直连）：停 ZLM 拉流 + 删代理 + 删通道 + 清巡逻侧归属/挂载")
    public Map<String, Object> deleteChannel(@RequestParam Integer channelId) {
        checkEdit();
        Map<String, Object> ch = taskMapper.wvpChannelById(channelId);
        if (ch == null) throw new ControllerException(ErrorCode.ERROR404);
        if (!"3".equals(String.valueOf(ch.get("data_type")))) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(),
                    "国标通道由设备端上报，请删除整台国标设备（设备端仍开着注册会自动回来）");
        }
        Map<String, Object> proxy = nvrMapper.proxyByChannelId(channelId);
        if (proxy != null && proxy.get("id") != null) {
            try {
                streamProxyService.delete(Integer.parseInt(String.valueOf(proxy.get("id"))));
            } catch (Exception e) {
                log.warn("[通道删除] 代理记录删除失败，继续清理: {}", e.getMessage());
            }
        }
        if (proxy != null && proxy.get("stream") != null) {
            // 兜底：代理记录可能已被单独删掉，但 ZLM 里的拉流任务还在（孤儿流），直接停掉
            zlmGet("/index/api/delStreamProxy?secret=" + zlmSecret
                    + "&vhost=__defaultVhost__&app=live&stream=" + proxy.get("stream"));
        }
        nvrMapper.unbind(channelId);
        nvrMapper.storageDelete(channelId);
        return Map.of("deleted", taskMapper.channelDelete(channelId));
    }

    @GetMapping("/channel/play-stream")
    @Operation(summary = "按需起临时码流供观看切换（hd=1主码流/hd=0子码流）。不动通道的录像/识别载体，无人观看自动回收")
    public Map<String, Object> playStream(@RequestParam Integer channelId, @RequestParam(defaultValue = "0") Integer hd) throws InterruptedException {
        check();
        Map<String, Object> proxy = nvrMapper.proxyByChannelId(channelId);
        if (proxy == null || proxy.get("stream") == null || proxy.get("srcUrl") == null) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "仅拉流代理(RTSP直连)接入的通道支持码流切换");
        }
        String src = String.valueOf(proxy.get("srcUrl"));
        String stream = String.valueOf(proxy.get("stream"));
        String sibling = deriveStreamUrl(src, hd == 1);
        if (sibling == null || sibling.equals(src)) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "该源地址无法推导另一码流（自定义地址不支持切换）");
        }
        String tmp = stream + (hd == 1 ? "_hd" : "_sd");
        zlmGet("/index/api/addStreamProxy?secret=" + zlmSecret
                + "&vhost=__defaultVhost__&app=live&stream=" + tmp
                + "&url=" + urlencode(sibling)
                + "&rtp_type=0&enable_audio=1&enable_mp4=0&retry_count=-1&timeout_sec=8&enable_disable_none_reader=1");
        boolean online = false;
        for (int i = 0; i < 6; i++) {
            Thread.sleep(1200);
            String list = zlmGet("/index/api/getMediaList?secret=" + zlmSecret);
            if (list != null && list.contains("\"stream\" : \"" + tmp + "\"")) {
                online = true;
                break;
            }
        }
        if (!online) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "该码流拉取未出流（设备可能只放行一路同码流或带宽不足）");
        }
        return Map.of("stream", tmp, "path", "/live/" + tmp + ".live.flv");
    }

    /** 从既有源地址推导姊妹码流：海克 Channels/{ch}0{1主2子}；大华 subtype=({0主1子})；自定义地址返回 null */
    static String deriveStreamUrl(String src, boolean hd) {
        if (src == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(Streaming/Channels/\\d0)(\\d)$").matcher(src);
        if (m.find()) return src.substring(0, m.start(2)) + (hd ? "1" : "2");
        m = java.util.regex.Pattern.compile("(subtype=)(\\d)").matcher(src);
        if (m.find()) return src.substring(0, m.start(2)) + (hd ? "0" : "1");
        return null;
    }

    /** 设置通道录像归属：ZLM=平台录像 / NVR=厂商NVR录像(同时取流和云台走该NVR) / NONE=不录 */
    @PostMapping("/storage/assign")
    @Audit(module = "settings.media", action = "edit", targetType = "录像归属")
    @Operation(summary = "设置摄像机录像归属")
    public Map<String, Object> assignStorage(@RequestParam Integer channelId,
                                             @RequestParam String storageType,
                                             @RequestParam(required = false) Integer nvrId,
                                             @RequestParam(required = false) Integer nvrChannelNo) {
        checkEdit();
        if (channelId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "channelId 不可为空");
        String type = storageType == null ? "NONE" : storageType.toUpperCase();
        if ("NVR".equals(type)) {
            if (nvrId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "选择厂商 NVR 时必须指定 nvrId");
            if (nvrMapper.getById(nvrId) == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "录像设备不存在");
            // 取流/云台也走该 NVR
            nvrMapper.bind(nvrId, channelId, nvrChannelNo == null ? 1 : nvrChannelNo);
        } else if ("ZLM".equals(type) || "NONE".equals(type)) {
            // 归属平台存储/不录：解除 NVR 挂载（取流回退直连）
            nvrMapper.unbind(channelId);
        } else {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "storageType 仅支持 ZLM/NVR/NONE");
        }
        nvrMapper.assignStorage(channelId, type, "NVR".equals(type) ? nvrId : null,
                nvrChannelNo == null ? 1 : nvrChannelNo);
        return Map.of("ok", true, "storageType", type);
    }

    // ================= 录像设备（NVR）管理 =================

    @GetMapping("/nvr/list")
    @Operation(summary = "录像设备列表（密码不下发，只回 hasPassword）")
    public List<Map<String, Object>> nvrList() {
        check();
        List<Map<String, Object>> rows = nvrMapper.list();
        List<Map<String, Object>> binds = nvrMapper.bindings();
        for (Map<String, Object> r : rows) {
            Object pwd = r.get("password");
            r.put("hasPassword", pwd != null && !String.valueOf(pwd).isBlank());
            r.put("password", "***");
            int id = intVal(r.get("id"), 0);
            long mounted = binds.stream().filter(b -> intVal(b.get("nvrId"), 0) == id).count();
            r.put("mountedCount", mounted);
        }
        return rows;
    }

    @GetMapping("/nvr/bindings")
    @Operation(summary = "摄像头挂载绑定列表（通道→NVR）")
    public List<Map<String, Object>> nvrBindings() {
        check();
        return nvrMapper.bindings();
    }

    @PostMapping("/nvr/save")
    @Audit(module = "settings.access", action = "edit", targetType = "录像设备(NVR)")
    @Operation(summary = "新增/编辑录像设备（编辑时密码留空=不修改）")
    public Map<String, Object> nvrSave(@RequestBody Map<String, Object> body) {
        checkEdit();
        Map<String, Object> nvr = new HashMap<>(body);
        nvr.putIfAbsent("vendor", "hik");
        nvr.putIfAbsent("rtspPort", 554);
        nvr.putIfAbsent("apiPort", 80);
        nvr.putIfAbsent("channelCount", 16);
        Integer id = intVal(nvr.remove("id"), 0);
        Map<String, Object> row = new HashMap<>();
        row.put("name", nvr.get("name"));
        row.put("vendor", nvr.get("vendor"));
        row.put("ip", nvr.get("ip"));
        row.put("rtspPort", nvr.get("rtspPort"));
        row.put("apiPort", nvr.get("apiPort"));
        row.put("username", nvr.get("username"));
        row.put("password", nvr.get("password"));
        row.put("channelCount", nvr.get("channelCount"));
        row.put("regionCivilCode", nvr.get("regionCivilCode"));
        row.put("remark", nvr.get("remark"));
        if (id > 0 && nvrMapper.getById(id) != null) {
            row.put("id", id);
            nvrMapper.updateKeepPassword(row);
        } else {
            nvrMapper.insert(row);
        }
        return Map.of("ok", true);
    }

    @DeleteMapping("/nvr/delete")
    @Audit(module = "settings.access", action = "delete", targetType = "录像设备(NVR)")
    @Operation(summary = "删除录像设备（同时解除其下挂载绑定）")
    public Map<String, Object> nvrDelete(@RequestParam int id) {
        checkEdit();
        // 其上各通道的录像归属回落 ZLM，摄像机本体不受影响
        nvrMapper.storageFallbackToZlm(id);
        nvrMapper.unbindAllOfNvr(id);
        nvrMapper.delete(id);
        return Map.of("ok", true);
    }

    @PostMapping("/nvr/bind")
    @Audit(module = "settings.access", action = "edit", targetType = "通道挂载NVR")
    @Operation(summary = "把已有通道挂载到录像设备（nvrChannelNo=NVR 侧通道号）")
    public Map<String, Object> nvrBind(@RequestParam Integer channelId,
                                       @RequestParam Integer nvrId,
                                       @RequestParam Integer nvrChannelNo) {
        checkEdit();
        if (channelId == null || nvrId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "参数不可为空");
        if (nvrMapper.getById(nvrId) == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "录像设备不存在");
        nvrMapper.bind(nvrId, channelId, nvrChannelNo == null ? 1 : nvrChannelNo);
        return Map.of("ok", true);
    }

    @DeleteMapping("/nvr/unbind")
    @Audit(module = "settings.access", action = "edit", targetType = "通道挂载NVR")
    @Operation(summary = "解除通道的 NVR 挂载")
    public Map<String, Object> nvrUnbind(@RequestParam Integer channelId) {
        checkEdit();
        nvrMapper.unbind(channelId);
        return Map.of("ok", true);
    }

    // ---------------- 摄像机台账（面向对象的简化视图） ----------------

    /** 手动识别：对指定通道立即抓帧并执行 YOLO(+VLM) 分析 */
    @PostMapping("/analyze")
    @Audit(module = "settings.ai", action = "execute", targetType = "手动识别")
    @Operation(summary = "手动识别：指定通道立即抓帧并分析（YOLO+VLM）")
    public Map<String, Object> analyzeNow(@RequestParam Integer channelId,
                                         @RequestParam(required = false) Integer schemeId,
                                         @RequestParam(required = false) String label) {
        if (!PatrolSecurityUtils.hasPerm("settings.ai", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        if (channelId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "channelId 不可为空");
        return orchestrator.analyzeChannelNow(channelId, schemeId, label);
    }

    @PostMapping("/record/unlink")
    @Audit(module = "settings.media", action = "edit", targetType = "关闭通道录像")
    @Operation(summary = "关闭单个通道的平台录像（解除其录像计划关联）")
    public Map<String, Object> recordUnlink(@RequestParam Integer channelId) {
        checkEdit();
        if (channelId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "channelId 不可为空");
        taskMapper.unlinkRecordPlan(channelId);
        return Map.of("ok", true);
    }

    /** 修改通道归属区划（复用国标 addChannelToRegion，覆盖式设置 gb_civil_code；清空则解除原归属） */
    @PostMapping("/record/region")
    @Audit(module = "settings.org", action = "edit", targetType = "通道归属区划")
    @Operation(summary = "设置通道归属行政区划")
    public Map<String, Object> setChannelRegion(@RequestParam Integer channelId,
                                                @RequestParam(required = false) String civilCode) {
        checkEdit();
        if (civilCode == null || civilCode.isBlank()) {
            String old = taskMapper.channelCivilCode(channelId);
            if (old != null && !old.isBlank()) {
                gbChannelService.deleteChannelToRegion(old, List.of(channelId));
            }
            return Map.of("ok", true);
        }
        gbChannelService.addChannelToRegion(civilCode, List.of(channelId));
        return Map.of("ok", true);
    }

    /** NVR 连通性测试：ISAPI 设备信息（海康/大华NVR均支持探活），generic 仅测试端口可达 */
    @PostMapping("/nvr/test")
    @Operation(summary = "录像设备(NVR)连通性测试")
    public Map<String, Object> nvrTest(@RequestBody Map<String, Object> body) {
        check();
        String host = str(body.get("ip"), null);
        if (host == null || host.isBlank()) throw new ControllerException(ErrorCode.ERROR400.getCode(), "IP 不可为空");
        int apiPort = intVal(body.get("apiPort"), 80);
        String user = str(body.get("username"), ""), password = str(body.get("password"), "");
        long t0 = System.currentTimeMillis();
        ProtocolAdapter.CommandResult r = isapiAdapter.send(ProtocolAdapter.CMD_STATUS,
                Map.of("connection_json", JSONObject.of("host", host, "port", apiPort, "user", user, "password", password)),
                null);
        Map<String, Object> out = new HashMap<>();
        out.put("ok", ProtocolAdapter.CommandResult.OK.equals(r.state()));
        out.put("costMs", System.currentTimeMillis() - t0);
        out.put("info", r.data());
        out.put("error", r.error());
        return out;
    }

    /** 云台控制（拉流代理通道无法走国标云台）：优先经挂载的 NVR 下发；未挂载则从取流地址解析凭据直连摄像机 ISAPI */
    @PostMapping("/nvr-ptz")
    @Audit(module = "monitor.video", action = "ptz", targetType = "通道云台")
    @Operation(summary = "拉流代理通道的云台连续控制（经NVR或直连ISAPI）")
    public Map<String, Object> nvrPtz(@RequestParam Integer channelId,
                                      @RequestBody Map<String, Object> body) {
        if (!PatrolSecurityUtils.hasChannelFunc("ptz")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        if (channelId == null) throw new ControllerException(ErrorCode.ERROR400.getCode(), "channelId 不可为空");
        String via;
        JSONObject conn;
        Map<String, Object> params = new HashMap<>();
        for (String k : List.of("pan", "tilt", "zoom", "iris", "focus")) {
            if (body.get(k) != null) params.put(k, body.get(k));
        }
        Map<String, Object> bind = nvrMapper.bindingOfChannel(channelId);
        if (bind != null) {
            via = "NVR:" + bind.get("nvrName");
            conn = JSONObject.of(
                    "host", bind.get("ip"),
                    "port", intVal(bind.get("apiPort"), 80),
                    "user", str(bind.get("username"), ""),
                    "password", str(bind.get("password"), ""));
            params.put("channelNo", intVal(bind.get("nvrChannelNo"), 1));
        } else {
            // 直连回退：从 rtsp://user:pass@host:port/... 解析凭据，对摄像机 80 端口 ISAPI 直控（通道号固定 1）
            Map<String, Object> proxy = nvrMapper.proxyOfChannel(channelId);
            if (proxy == null || proxy.get("srcUrl") == null) {
                throw new ControllerException(ErrorCode.ERROR400.getCode(), "该通道未挂载录像设备，也不是拉流代理通道，无法控制云台");
            }
            String[] cred = parseRtspCreds(String.valueOf(proxy.get("srcUrl")));
            if (cred == null) {
                throw new ControllerException(ErrorCode.ERROR400.getCode(),
                        "未挂载录像设备，且无法从取流地址解析出控制凭据（地址未含账号或非海康设备），云台不可用；可将通道挂载到 NVR 后重试");
            }
            via = "直连ISAPI";
            conn = JSONObject.of("host", cred[0], "port", 80, "user", cred[1], "password", cred[2]);
            params.put("channelNo", 1);
        }
        ProtocolAdapter.CommandResult r = isapiAdapter.send(ProtocolAdapter.CMD_SET_PTZ,
                Map.of("connection_json", conn), params);
        Map<String, Object> out = new HashMap<>();
        out.put("ok", ProtocolAdapter.CommandResult.OK.equals(r.state()));
        out.put("error", r.error());
        out.put("via", via);
        return out;
    }

    /** 解析 rtsp://user:pass@host[:port]/... 的 host/user/pass（密码可含 @# 等特殊字符：按最后一个 @ 分割） */
    static String[] parseRtspCreds(String url) {
        try {
            if (url == null || !url.startsWith("rtsp://")) return null;
            String body = url.substring("rtsp://".length());
            int pathSlash = body.indexOf('/');
            String authority = pathSlash > 0 ? body.substring(0, pathSlash) : body;
            int at = authority.lastIndexOf('@');
            if (at <= 0) return null;
            String credPart = authority.substring(0, at);
            String hostPart = authority.substring(at + 1);
            int colon = credPart.indexOf(':');
            if (colon <= 0) return null;
            String host = hostPart.split(":")[0];
            if (host.isBlank()) return null;
            return new String[]{host, credPart.substring(0, colon), credPart.substring(colon + 1)};
        } catch (Exception e) {
            return null;
        }
    }

    // ---------------- Excel 模板 ----------------
    @GetMapping("/template")
    @Operation(summary = "下载批量接入模板 xlsx")
    public void template(jakarta.servlet.http.HttpServletResponse response) throws IOException {
        checkEdit();
        List<List<Object>> rows = new ArrayList<>();
        rows.add(List.of("现场南门海康球机", "hik", "192.168.0.64", 554, "admin", "密码123", 1, 0, "110105", "示例行-可删除"));
        rows.add(List.of("大华枪机", "dahua", "192.168.0.65", 554, "admin", "密码456", 1, 0, "110105", ""));
        rows.add(List.of("自定义RTSP", "generic", "-", 554, "", "", 1, 0, "", "rtsp://x/x"));
        excel(response, "设备批量接入模板.xlsx",
                List.of("设备名称", "厂商(hik/dahua/univ/generic)", "IP", "端口", "账号", "密码", "通道号", "码流(0主1子)", "区划编号civilCode", "备注/自定义URL"),
                rows);
    }

    // ---------------- 批量导入 ----------------
    @PostMapping("/import")
    @Audit(module = "settings.access", action = "create", targetType = "设备批量接入")
    @Operation(summary = "批量导入接入(Excel)")
    public Map<String, Object> importExcel(@org.springframework.web.bind.annotation.RequestParam("file")
                                           org.springframework.web.multipart.MultipartFile file) throws IOException {
        checkEdit();
        List<List<String>> rows = readExcel(file);
        if (rows.isEmpty()) throw new ControllerException(ErrorCode.ERROR400.getCode(), "Excel 无数据行");
        int ok = 0, fail = 0;
        List<String> errors = new ArrayList<>();
        int rn = 0;
        for (List<String> r : rows) {
            rn++;
            try {
                if (r.size() < 8) throw new IllegalArgumentException("列数不足");
                String name = cell(r, 0);
                String vendor = cell(r, 1);
                if ("generic".equalsIgnoreCase(vendor)) {
                    String custom = cell(r, 9);
                    if (custom == null || custom.isBlank()) throw new IllegalArgumentException("generic 需要完整 RTSP URL");
                }
                AccessParam p = new AccessParam(name, vendor.toLowerCase(), cell(r, 2),
                        parseInt(cell(r, 3), 554), cell(r, 4), cell(r, 5),
                        parseInt(cell(r, 6), 1), parseInt(cell(r, 7), 0), cell(r, 9),
                        Boolean.FALSE, blankToNull(cell(r, 8)), null, null);
                Map<String, Object> added = add(p);
                if (added.get("channelId") == null) throw new IllegalArgumentException("通道未生成");
                ok++;
            } catch (Exception e) {
                fail++;
                errors.add("第" + rn + "行: " + e.getMessage());
            }
        }
        Map<String, Object> out = new HashMap<>();
        out.put("total", rows.size());
        out.put("success", ok);
        out.put("fail", fail);
        out.put("errors", errors);
        return out;
    }

    // ---------------- 导出设备/通道 Excel（勾选 or 全选） ----------------
    @GetMapping("/export")
    @Operation(summary = "导出设备/通道 xlsx（ids 勾选导出，all=全选导出）")
    public void export(@RequestParam(defaultValue = "channels") String type,
                       @RequestParam(required = false) String ids,
                       @RequestParam(required = false) Boolean all,
                       @RequestParam(required = false) String keyword,
                       @RequestParam(required = false) String status,
                       jakarta.servlet.http.HttpServletResponse response) throws IOException {
        check();
        if ("devices".equals(type)) {
            List<Map<String, Object>> rows = taskMapper.exportDevices(keyword, status);
            if (!Boolean.TRUE.equals(all) && ids != null && !ids.isBlank()) {
                Set<String> idset = new HashSet<>(Arrays.asList(ids.split(",")));
                rows.removeIf(r -> !idset.contains(String.valueOf(r.get("device_id"))));
            }
            List<List<Object>> data = new ArrayList<>();
            for (Map<String, Object> r : rows) {
                data.add(row(
                        r.get("device_id"), r.get("name"), r.get("manufacturer"), r.get("model"), r.get("firmware"),
                        intVal(r.get("online"), 0) == 1 ? "在线" : "离线",
                        r.get("ip"), r.get("port"), r.get("transport"), r.get("createTime")));
            }
            excel(response, "设备清单.xlsx",
                    List.of("设备编号(国标)", "名称", "厂商", "型号", "固件", "在线状态", "IP", "端口", "传输协议", "接入时间"),
                    data);
            return;
        }
        List<Map<String, Object>> rows = taskMapper.exportChannels(keyword, status);
        if (!Boolean.TRUE.equals(all) && ids != null && !ids.isBlank()) {
            Set<String> idset = new HashSet<>(Arrays.asList(ids.split(",")));
            rows.removeIf(r -> !idset.contains(String.valueOf(r.get("id"))));
        }
        List<List<Object>> data = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            data.add(row(
                    r.get("id"), r.get("name"), r.get("gbDeviceId"), r.get("manufacturer"),
                    r.get("model"), "ON".equals(String.valueOf(r.get("status"))) ? "在线" : "离线",
                    r.get("dataType"), r.get("srcUrl"), r.get("regionName"), r.get("createTime")));
        }
        excel(response, "通道清单.xlsx",
                List.of("通道ID", "名称", "国标编号", "厂商", "型号", "在线状态", "接入方式(1国标/3拉流代理)", "源地址(RTSP)", "所属区划", "接入时间"),
                data);
    }

    // ================= 工具 =================
    private String zlmGet(String path) {
        try (Response resp = http.newCall(new Request.Builder().url(zlmApiUrl + path).build()).execute()) {
            return resp.body() == null ? null : resp.body().string();
        } catch (IOException e) {
            return null;
        }
    }

    private static String urlencode(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }

    private void excel(jakarta.servlet.http.HttpServletResponse response, String fileName,
                       List<String> headers, List<List<Object>> rows) throws IOException {
        response.setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        response.setHeader("Content-Disposition", "attachment; filename=" + java.net.URLEncoder.encode(fileName, java.nio.charset.StandardCharsets.UTF_8));
        List<List<String>> head = headers.stream().map(java.util.Collections::singletonList).toList();
        com.alibaba.excel.EasyExcel.write(response.getOutputStream())
                .head(head)
                .sheet("设备")
                .doWrite(rows);
    }

    private List<List<String>> readExcel(org.springframework.web.multipart.MultipartFile file) throws IOException {
        List<java.util.Map<Integer, String>> list = com.alibaba.excel.EasyExcel.read(file.getInputStream())
                .sheet(0)
                .headRowNumber(1)
                .doReadSync();
        List<List<String>> out = new ArrayList<>();
        for (java.util.Map<Integer, String> m : list) {
            List<String> row = new ArrayList<>();
            for (int i = 0; i < 10; i++) {
                Object v = m.get(i);
                row.add(v == null ? "" : String.valueOf(v).trim());
            }
            if (row.get(9).contains("示例行")) continue; // 跳过模板示例行
            if (row.stream().allMatch(String::isBlank)) continue; // 跳过空行
            out.add(row);
        }
        return out;
    }

    private static String cell(List<String> r, int i) {
        return i < r.size() ? r.get(i) : "";
    }

    private static Integer parseInt(String v, int def) {
        try {
            return v == null || v.isBlank() ? def : Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v;
    }

    private static String str(Object v, String def) {
        return v == null ? def : String.valueOf(v);
    }

    /** Excel 行构造（数据库字段可空，List.of 遇 null 直接 NPE） */
    private static List<Object> row(Object... vals) {
        List<Object> out = new ArrayList<>(vals.length);
        for (Object v : vals) out.add(v == null ? "" : v);
        return out;
    }

    private static int intVal(Object v, int def) {
        try {
            if (v == null) return def;
            if (v instanceof Number n) return n.intValue();
            return (int) Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return def;
        }
    }

    private void check() {
        if (!PatrolSecurityUtils.hasPerm("settings.access", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }

    private void checkEdit() {
        if (!PatrolSecurityUtils.hasPerm("settings.access", "create") && !PatrolSecurityUtils.hasPerm("settings.access", "edit")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }
}
