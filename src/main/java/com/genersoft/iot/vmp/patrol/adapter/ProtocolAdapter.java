package com.genersoft.iot.vmp.patrol.adapter;

import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;

import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Autowired;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * 协议适配器 SPI。
 * 能力协商：capabilities() 声明支持的指令；编排器下发前校验，不支持返回 DISABLED 而非报错。
 */
@Slf4j
public abstract class ProtocolAdapter {

    /** 支持的指令能力 */
    public abstract Set<String> capabilities();

    /** 适配器类型标识（http/mqtt/dds/grpc/…） */
    public abstract String type();

    /**
     * 下发统一指令。非幂等指令（startTask/stopTask 等）由实现保证不自动重试；
     * 超时返回 CommandResult.resultUnknown，由编排器回查 status()。
     */
    public abstract CommandResult send(String command, Map<String, Object> device, Map<String, Object> params);

    /** 查询设备状态（回查用） */
    public CommandResult status(Map<String, Object> device) {
        return CommandResult.disabled("status");
    }

    // ---------------- 统一指令集（能力导向，与厂商无关） ----------------
    public static final String CMD_STATUS = "status";
    public static final String CMD_START_TASK = "startTask";
    public static final String CMD_PAUSE_TASK = "pauseTask";
    public static final String CMD_RESUME_TASK = "resumeTask";
    public static final String CMD_STOP_TASK = "stopTask";
    public static final String CMD_GOTO_WAYPOINT = "gotoWaypoint";
    public static final String CMD_CAPTURE_PHOTO = "capturePhoto";
    public static final String CMD_START_VIDEO = "startVideo";
    public static final String CMD_STOP_VIDEO = "stopVideo";
    public static final String CMD_SET_PTZ = "setPtz";
    public static final String CMD_RETURN_HOME = "returnHome";
    public static final String CMD_GET_MEDIA_LIST = "getMediaList";
    public static final String CMD_SUBSCRIBE_EVENTS = "subscribeEvents";

    /** 指令结果（泛型载体 state） */
    public record CommandResult(String state, Object data, long costMs, String error) {
        public static final String OK = "OK";
        public static final String DISABLED = PatrolStatus.DISABLED;
        public static final String RESULT_UNKNOWN = "RESULT_UNKNOWN";
        public static final String FAIL = "FAIL";

        public static CommandResult ok(Object data, long cost) {
            return new CommandResult(OK, data, cost, null);
        }

        public static CommandResult fail(String error, long cost) {
            return new CommandResult(FAIL, null, cost, error);
        }

        public static CommandResult resultUnknown(String error, long cost) {
            return new CommandResult(RESULT_UNKNOWN, null, cost, error);
        }

        public static CommandResult disabled(String cmd) {
            return new CommandResult(DISABLED, null, 0, "能力不支持: " + cmd);
        }
    }

    /** 供 HTTP 类适配器使用的共享客户端（模板方法支撑） */
    protected static final OkHttpClient SHARED_HTTP = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build();

    /** HTTP 端点调用工具（模板渲染 ${deviceId} ${p.x} 等） */
    protected JSONObject httpCall(String method, String url, JSONObject payload, Map<String, String> headers) throws IOException {
        RequestBody body = payload == null ? null : RequestBody.create(payload.toJSONString(), MediaType.parse("application/json"));
        Request.Builder rb = new Request.Builder().url(url);
        if ("GET".equalsIgnoreCase(method)) rb.get();
        else if ("POST".equalsIgnoreCase(method)) rb.post(body == null ? RequestBody.create(new byte[0]) : body);
        else rb.method(method.toUpperCase(), body);
        if (headers != null) headers.forEach(rb::addHeader);
        try (Response resp = SHARED_HTTP.newCall(rb.build()).execute()) {
            String respBody = resp.body() == null ? "" : resp.body().string();
            JSONObject json = new JSONObject();
            json.put("httpCode", resp.code());
            try {
                json.put("body", JSONObject.parseObject(respBody));
            } catch (Exception e) {
                json.put("bodyRaw", respBody);
            }
            return json;
        }
    }

    /** 模板变量替换：${deviceId} ${edgeCode} ${p.x} … */
    protected String render(String template, Map<String, Object> device, Map<String, Object> params) {
        if (template == null) return null;
        String result = template.replace("${deviceId}", String.valueOf(device.get("device_id") != null ? device.get("device_id") : device.get("id")));
        if (params != null) {
            for (Map.Entry<String, Object> e : params.entrySet()) {
                result = result.replace("${p." + e.getKey() + "}", String.valueOf(e.getValue()));
            }
        }
        return result;
    }
}
