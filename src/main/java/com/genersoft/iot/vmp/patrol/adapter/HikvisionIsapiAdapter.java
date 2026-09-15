package com.genersoft.iot.vmp.patrol.adapter;

import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * 海康威视 ISAPI 协议适配器（HTTP Digest 认证，相机/NVR/PVR 80 端口）。
 * 实测设备：iDS-MCD20M/32G/GLE (PVR)。
 * 能力：status(设备信息) / capturePhoto(ISAPI抓图，部分存储型设备不支持) /
 *      getMediaList(录像检索 /ISAPI/ContentMgmt/search) / setPtz(连续控制，固定机位不支持)
 * 连接配置（connection_json）：{ "host": "192.168.0.125", "port": 80,
 *                              "user": "admin", "password": "...", "channelNo": 1 }
 */
@Slf4j
@org.springframework.stereotype.Component
public class HikvisionIsapiAdapter extends ProtocolAdapter {

    public static final String TYPE = "HIKVISION_ISAPI";

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();

    @Override
    public String type() {
        return TYPE;
    }

    @Override
    public Set<String> capabilities() {
        return Set.of(CMD_STATUS, CMD_CAPTURE_PHOTO, CMD_GET_MEDIA_LIST, CMD_SET_PTZ);
    }

    @Override
    public CommandResult send(String command, Map<String, Object> device, Map<String, Object> params) {
        long t0 = System.currentTimeMillis();
        try {
            JSONObject conn = parseConnection(device);
            String host = conn.getString("host");
            Integer port = conn.getInteger("port") == null ? 80 : conn.getInteger("port");
            String user = conn.getString("user");
            String password = conn.getString("password");
            if (host == null || host.isBlank()) {
                return CommandResult.fail("连接配置缺少 host", cost(t0));
            }
            return switch (command) {
                case CMD_STATUS -> deviceInfo(host, port, user, password, t0);
                case CMD_CAPTURE_PHOTO -> capturePhoto(host, port, user, password, conn, params, t0);
                case CMD_GET_MEDIA_LIST -> mediaSearch(host, port, user, password, params, t0);
                case CMD_SET_PTZ -> ptzContinuous(host, port, user, password, conn, params, t0);
                default -> CommandResult.disabled(command + " (ISAPI 适配器未实现该指令)");
            };
        } catch (Exception e) {
            return CommandResult.fail(e.getMessage(), cost(t0));
        }
    }

    private CommandResult deviceInfo(String host, Integer port, String user, String password, long t0) {
        try (Response resp = digestGet(host, port, "/ISAPI/System/deviceInfo", user, password).execute()) {
            String body = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                return CommandResult.fail("HTTP " + resp.code() + " " + abbreviate(body, 120), cost(t0));
            }
            JSONObject out = new JSONObject();
            out.put("deviceName", tag(body, "deviceName"));
            out.put("model", tag(body, "model"));
            out.put("serialNumber", tag(body, "serialNumber"));
            out.put("firmwareVersion", tag(body, "firmwareVersion"));
            return CommandResult.ok(out, cost(t0));
        } catch (Exception e) {
            return CommandResult.fail(e.getMessage(), cost(t0));
        }
    }

    /** ISAPI 即时抓图；部分 PVR/NVR 存储型设备不支持（会超时），此时建议走 RTSP/ZLM 抓帧 */
    private CommandResult capturePhoto(String host, Integer port, String user, String password,
                                       JSONObject conn, Map<String, Object> params, long t0) {
        int ch = channelNo(conn, params);
        String uri = "/ISAPI/Streaming/channels/" + ch + "01/picture";
        try (Response resp = digestGet(host, port, uri, user, password).execute()) {
            if (!resp.isSuccessful() || resp.body() == null) {
                return CommandResult.fail("ISAPI 抓图失败 HTTP " + resp.code(), cost(t0));
            }
            byte[] bytes = resp.body().bytes();
            if (bytes.length > 1000 && bytes[0] == (byte) 0xFF) {
                JSONObject out = new JSONObject();
                out.put("byteLength", bytes.length);
                out.put("base64", java.util.Base64.getEncoder().encodeToString(bytes));
                return CommandResult.ok(out, cost(t0));
            }
            return CommandResult.fail("设备返回非图片内容（存储型设备通常不支持 ISAPI 即时抓图，请用 RTSP/ZLM 抓帧）", cost(t0));
        } catch (Exception e) {
            return CommandResult.fail("ISAPI 抓图超时/失败: " + e.getMessage(), cost(t0));
        }
    }

    /** 录像检索（NVR/PVR 本机录像）：POST /ISAPI/ContentMgmt/search */
    private CommandResult mediaSearch(String host, Integer port, String user, String password,
                                      Map<String, Object> params, long t0) {
        String startTime = str(params, "startTime", "2026-09-01T00:00:00Z");
        String endTime = str(params, "endTime", "2026-09-30T23:59:59Z");
        int ch = params != null && params.get("channelNo") != null
                ? (int) Double.parseDouble(String.valueOf(params.get("channelNo"))) : 1;
        String xml = "<CMSearchDescription><searchID>C0-1</searchID>"
                + "<trackList><trackID>" + mediaTrackId(params) + "</trackID></trackList>"
                + "<timeSpanList><timeSpan><startTime>" + startTime + "</startTime>"
                + "<endTime>" + endTime + "</endTime></timeSpan></timeSpanList>"
                + "<maxResults>40</maxResults><searchResultPosition>0</searchResultPosition>"
                + "<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>"
                + "</CMSearchDescription>";
        String uri = "/ISAPI/ContentMgmt/search";
        try (Response resp = digestClient(user, password).newCall(new Request.Builder()
                .url("http://" + host + ":" + port + uri)
                .post(RequestBody.create(xml, MediaType.parse("application/xml")))
                .build()).execute()) {
            String body = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                return CommandResult.fail("HTTP " + resp.code() + " " + abbreviate(body, 150), cost(t0));
            }
            JSONObject out = new JSONObject();
            out.put("matchList", tag(body, "searchMatchList"));
            out.put("raw", abbreviate(body, 2000));
            return CommandResult.ok(out, cost(t0));
        } catch (Exception e) {
            return CommandResult.fail(e.getMessage(), cost(t0));
        }
    }

    /** 连续云台控制：PUT /ISAPI/PTZCtrl/channels/{ch}/continuous（固定机位设备不支持，返回错误属预期） */
    private CommandResult ptzContinuous(String host, Integer port, String user, String password,
                                        JSONObject conn, Map<String, Object> params, long t0) {
        int ch = channelNo(conn, params);
        int pan = (int) dbl(params, "pan", 0);
        int tilt = (int) dbl(params, "tilt", 0);
        int zoom = (int) dbl(params, "zoom", 0);
        String xml = "<PTZData><pan>" + pan + "</pan><tilt>" + tilt + "</tilt><zoom>" + zoom + "</zoom>"
                + (params != null && params.get("iris") != null ? "<iris>" + (int) dbl(params, "iris", 0) + "</iris>" : "")
                + (params != null && params.get("focus") != null ? "<focus>" + (int) dbl(params, "focus", 0) + "</focus>" : "")
                + "</PTZData>";
        String uri = "/ISAPI/PTZCtrl/channels/" + ch + "/continuous";
        try (Response resp = digestClient(user, password).newCall(new Request.Builder()
                .url("http://" + host + ":" + port + uri)
                .put(RequestBody.create(xml, MediaType.parse("application/xml")))
                .build()).execute()) {
            String body = resp.body() == null ? "" : resp.body().string();
            return resp.isSuccessful()
                    ? CommandResult.ok("PTZ 已下发", cost(t0))
                    : CommandResult.fail("HTTP " + resp.code() + " " + abbreviate(body, 120), cost(t0));
        } catch (Exception e) {
            return CommandResult.fail(e.getMessage(), cost(t0));
        }
    }

    // ---------- HTTP（Digest 优先，Basic 回退） ----------
    /** 统一 Digest 认证客户端（海康 ISAPI 全部接口均为 Digest，Basic 会被 401 拒绝） */
    private okhttp3.OkHttpClient digestClient(String user, String password) {
        return http.newBuilder()
                .authenticator(new com.burgstaller.okhttp.digest.DigestAuthenticator(
                        new com.burgstaller.okhttp.digest.Credentials(user, password)))
                .build();
    }

    private okhttp3.Call digestGet(String host, Integer port, String uri, String user, String password) {
        return digestClient(user, password).newCall(new Request.Builder()
                .url("http://" + host + ":" + port + uri)
                .get()
                .build());
    }

    private JSONObject parseConnection(Map<String, Object> device) {
        Object cj = device.get("connection_json");
        if (cj == null) cj = device.get("connectionJson");
        try {
            return JSONObject.parseObject(String.valueOf(cj == null ? "{}" : cj));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private int channelNo(JSONObject conn, Map<String, Object> params) {
        Object p = params == null ? null : params.get("channelNo");
        if (p != null) return (int) Double.parseDouble(String.valueOf(p));
        Integer c = conn.getInteger("channelNo");
        return c == null ? 1 : c;
    }

    private String mediaTrackId(Map<String, Object> params) {
        Object t = params == null ? null : params.get("trackID");
        return t == null ? "media" : String.valueOf(t);
    }

    private static String str(Map<String, Object> map, String key, String def) {
        Object v = map == null ? null : map.get(key);
        return v == null ? def : String.valueOf(v);
    }

    private static double dbl(Map<String, Object> map, String key, double def) {
        try {
            Object v = map == null ? null : map.get(key);
            return v == null ? def : Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return def;
        }
    }

    private static String tag(String xml, String tag) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("<" + tag + ">([^<]+)</" + tag + ">").matcher(xml);
        return m.find() ? m.group(1) : null;
    }

    private static long cost(long t0) {
        return System.currentTimeMillis() - t0;
    }

    private static String abbreviate(String s, int max) {
        return s == null ? "" : (s.length() <= max ? s : s.substring(0, max));
    }
}
