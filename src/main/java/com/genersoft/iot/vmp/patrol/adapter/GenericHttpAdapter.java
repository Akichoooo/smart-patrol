package com.genersoft.iot.vmp.patrol.adapter;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * 通用 HTTP REST 模板适配器（零代码接入长尾厂商）：
 * 端点全部来自 patrol_protocol_template.config_json，
 * 非幂等指令（idempotent=false）超时不重试直接返回 RESULT_UNKNOWN。
 */
@Slf4j
@Component
public class GenericHttpAdapter extends ProtocolAdapter {

    @Override
    public String type() {
        return "HTTP_REST";
    }

    @Override
    public Set<String> capabilities() {
        // 能力集由模板 capabilities_json 决定；此处返回全集，由调用方按模板过滤
        return Set.of(
                CMD_STATUS, CMD_START_TASK, CMD_PAUSE_TASK, CMD_RESUME_TASK, CMD_STOP_TASK,
                CMD_GOTO_WAYPOINT, CMD_CAPTURE_PHOTO, CMD_START_VIDEO, CMD_STOP_VIDEO,
                CMD_SET_PTZ, CMD_RETURN_HOME, CMD_GET_MEDIA_LIST, CMD_SUBSCRIBE_EVENTS);
    }

    /**
     * @param device   patrol_robot_device 行（connection_json 含模板 config）
     * @param template 模板行（config_json）
     */
    public CommandResult executeWithTemplate(Map<String, Object> device, Map<String, Object> template,
                                             String command, Map<String, Object> params) {
        long t0 = System.currentTimeMillis();
        try {
            Object cfgRaw = template.getOrDefault("config_json", template.getOrDefault("configJson", "{}"));
            JSONObject config = JSONObject.parseObject(String.valueOf(cfgRaw));
            JSONObject conn = config.getJSONObject("connection");
            JSONObject endpoints = config.getJSONObject("endpoints");
            JSONObject ep = endpoints == null ? null : endpoints.getJSONObject(command);
            String baseUrl = conn == null ? "" : conn.getString("baseUrl");
            if (ep == null || baseUrl == null || baseUrl.isBlank()) {
                return CommandResult.disabled(command);
            }
            String method = ep.getString("method");
            String path = ep.getString("path");
            String url = render(baseUrl + path, device, params);
            JSONObject payload = null;
            String rawPayload = ep.getString("payload");
            if (rawPayload != null && !rawPayload.isBlank()) {
                String rendered = render(rawPayload, device, params);
                payload = JSONObject.parseObject(rendered);
            }
            Map<String, String> headers = new HashMap<>();
            JSONObject auth = config.getJSONObject("auth");
            if (auth != null) {
                String token = auth.getString("token");
                if (token != null) {
                    headers.put("Authorization", "Bearer " + token);
                }
            }
            JSONObject resp = httpCall(method == null ? "POST" : method, url, payload, headers);
            Integer httpCode = resp.getInteger("httpCode");
            boolean idempotent = Boolean.TRUE.equals(ep.getBoolean("readOnly")) || Boolean.TRUE.equals(ep.getBoolean("idempotent"));
            if (httpCode == null) {
                return idempotent ? CommandResult.fail("无响应", System.currentTimeMillis() - t0)
                        : CommandResult.resultUnknown("无响应（非幂等指令不重试，需回查状态）", System.currentTimeMillis() - t0);
            }
            if (httpCode >= 200 && httpCode < 300) {
                return CommandResult.ok(resp.get("body"), System.currentTimeMillis() - t0);
            }
            return idempotent ? CommandResult.fail("HTTP " + httpCode, System.currentTimeMillis() - t0)
                    : CommandResult.resultUnknown("HTTP " + httpCode, System.currentTimeMillis() - t0);
        } catch (IOException e) {
            return CommandResult.resultUnknown(e.getMessage(), System.currentTimeMillis() - t0);
        } catch (Exception e) {
            return CommandResult.fail(e.getMessage(), System.currentTimeMillis() - t0);
        }
    }

    @Override
    public CommandResult send(String command, Map<String, Object> device, Map<String, Object> params) {
        // 直接 send 不带模板上下文时不可用；请使用 executeWithTemplate（编排器走注册表调用）
        return CommandResult.disabled(command);
    }

}
