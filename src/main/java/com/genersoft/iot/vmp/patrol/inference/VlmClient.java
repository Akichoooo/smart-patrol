package com.genersoft.iot.vmp.patrol.inference;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.conf.UserSetting;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * 云端 VLM 客户端（OpenAI 兼容协议族）：
 * - chat_completions / responses / anthropic 三种协议
 * - 429 限流指数退避重试（用户提醒的关键点）
 * - 主模型失败自动降级备用模型
 * - API Key 仅后端持有（DB AES 加密），日志与返回一律脱敏
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class VlmClient {

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .build();

    @Value("${patrol.vlm.max-retry:5}")
    private int maxRetry;

    @Value("${patrol.vlm.min-interval-ms:2000}")
    private long minIntervalMs;

    @Value("${patrol.vlm.max-concurrent:1}")
    private int maxConcurrent;

    @Value("${patrol.vlm.circuit-threshold:5}")
    private int circuitThreshold;

    @Value("${patrol.vlm.circuit-open-ms:60000}")
    private long circuitOpenMs;

    @Value("${patrol.vlm.deadline-ms:180000}")
    private long deadlineMs;

    // ---- 成熟保底策略组件（进程级，多任务共享） ----
    /** 客户端限流：最多并发 + 最小调用间隔（令牌桶简化版） */
    private static final java.util.concurrent.Semaphore CONCURRENCY = new java.util.concurrent.Semaphore(1);
    private static volatile long lastCallAt = 0;
    /** 熔断器：连续限流次数 / 熔断打开截止时间 */
    private static volatile int consecutiveRateLimit = 0;
    private static volatile long circuitOpenUntil = 0;

    @Value("${patrol.vlm.timeout-ms:90000}")
    private long timeoutMs;

    private final PatrolTaskMapper taskMapper;

    @Autowired(required = false)
    private UserSetting userSetting;

    /** 视觉模型输出配额：sensenova 等推理模型的 reasoning_tokens 计入配额，
     *  实测 1024 会概率性截断正文（finish_reason=length 且 content 半截/为空），必须留足余量。
     *  推理模型可把思考关掉（在 patrol_vlm_model.params_json 配 {"thinking":{"type":"disabled"}}），
     *  否则简单提示也可能把全部配额烧在 reasoning 上导致正文为空。 */
    @Value("${patrol.vlm.max-tokens:4096}")
    private int maxTokens;

    public record VlmResult(boolean ok, String content, String actualModel, long costMs,
                            long totalTokens, String error, boolean switchedModel, boolean truncated) {
        /** 兼容旧构造（截断=false） */
        public VlmResult(boolean ok, String content, String actualModel, long costMs,
                         long totalTokens, String error, boolean switchedModel) {
            this(ok, content, actualModel, costMs, totalTokens, error, switchedModel, false);
        }
    }

    /** 健康握手（供应商默认主模型） */
    public VlmResult handshake(int modelId) {
        return handshake(modelId, null);
    }

    /** 指定模型握手（模型清单里逐个测试） */
    public VlmResult handshake(int modelId, String modelOverride) {
        return call(modelId, "这是一次巡检系统握手测试，请回复：握手成功", null, modelOverride);
    }

    /**
     * 图文分析
     *
     * @param modelId    patrol_vlm_model.id
     * @param prompt     提示词
     * @param imageB64   图片 base64（可空 = 纯文本）
     */
    public VlmResult analyze(int modelId, String prompt, String imageB64, String kbContext) {
        String fullPrompt = prompt;
        if (kbContext != null && !kbContext.isBlank()) {
            fullPrompt = prompt + "\n\n【参考知识库】\n" + kbContext;
        }
        return call(modelId, fullPrompt, imageB64, null);
    }

    private VlmResult call(int modelId, String prompt, String imageB64, String modelOverride) {
        Map<String, Object> model = taskMapper == null ? null : findModel(modelId);
        if (model == null) {
            return new VlmResult(false, null, null, 0, 0, "模型不存在: " + modelId, false);
        }
        // 熔断：连续限流达阈值后，冷却期内快速失败（避免配额耗尽继续硬打）
        if (circuitOpenUntil > System.currentTimeMillis()) {
            long wait = (circuitOpenUntil - System.currentTimeMillis()) / 1000 + 1;
            return new VlmResult(false, null, null, 0, 0,
                    "VLM 限流熔断中（配额恢复冷却），约 " + wait + "s 后自动恢复，请稍后", false);
        }
        final long deadline = System.currentTimeMillis() + deadlineMs;
        rateLimitSeen = false;
        String baseUrl = str(model, "base_url", "https://token.sensenova.cn/v1");
        String protocol = str(model, "protocol", "chat_completions");
        String apiKey = decrypt(str(model, "api_key_enc", ""));
        // 供应商透传参数（如推理模型关思考 {"thinking":{"type":"disabled"}}）
        JSONObject extraParams = parseParamsJson(str(model, "params_json", null));
        String mainModel = modelOverride != null && !modelOverride.isBlank()
                ? modelOverride
                : str(model, "model", "sensenova-6.8-flash-lite");
        // 指定模型测试时不降级（就测这一个）
        String fallback = modelOverride != null ? null : str(model, "model_fallback", null);

        long t0 = System.currentTimeMillis();
        Exception lastError = null;
        // 客户端主动限流：并发许可 + 最小间隔（在 429 发生前自我约束）
        boolean acquired = false;
        try {
            acquired = CONCURRENCY.tryAcquire(30, TimeUnit.SECONDS);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
        if (!acquired) {
            return new VlmResult(false, null, null, 0, 0, "VLM 调用排队超时（并发受限）", false);
        }
        try {
            for (int attempt = 0; attempt <= maxRetry; attempt++) {
                if (System.currentTimeMillis() > deadline) {
                    lastError = new IOException("总耗时超过截止时间(" + deadlineMs + "ms)");
                    break;
                }
                // 交替使用主/备用模型：覆盖"某一路由节点间歇性 model route not found"与限流
                boolean useFallback = attempt % 2 == 1 && fallback != null && !fallback.isBlank();
                String actualModel = useFallback ? fallback : mainModel;
                // 渐进降载：限流重试第 2 次起进一步压低分辨率，减少视觉 token
                String attemptImage = (rateLimitSeen && attempt >= 2) ? downscale(imageB64, 800) : imageB64;
                try {
                    throttle();
                    JSONObject respBody = doHttp(baseUrl, protocol, apiKey, actualModel, prompt, attemptImage, extraParams);
                    // 有些网关用 HTTP 200 返回 {"error":{...}}（Key 无效/无权限/模型未开通）。
                    // 不识别的话它会被当成模型正文，最终在界面上显示成"识别正常 + 一段 JSON"，
                    // 既误导用户又掩盖真因。这里按失败处理并给出可读原因。
                    if (respBody != null && respBody.containsKey("error")) {
                        Object errObj = respBody.get("error");
                        String em = errObj instanceof JSONObject eo ? eo.getString("message") : String.valueOf(errObj);
                        Integer ec = errObj instanceof JSONObject eo ? eo.getInteger("code") : null;
                        throw new VlmHttpException(ec == null ? 403 : ec,
                                "模型服务拒绝访问：" + (em == null ? String.valueOf(errObj) : em), 0);
                    }
                    String content = extractContent(protocol, respBody);
                    // 输出被截断（finish_reason=length）：content 可能半截或为空，不可作为判定依据，按失败重试
                    if (isTruncated(protocol, respBody)) {
                        log.warn("[VlmClient] 输出截断(模型:{}, content={}字符)，退避后重试({}/{})", actualModel,
                                content == null ? 0 : content.length(), attempt + 1, maxRetry);
                        throw new IOException("模型输出被截断(finish_reason=length)，max_tokens=" + maxTokens);
                    } else if (content != null && !content.isBlank()) {
                        long tokens = extractTokens(protocol, respBody);
                        consecutiveRateLimit = 0;
                        return new VlmResult(true, content, actualModel,
                                System.currentTimeMillis() - t0, tokens, null, useFallback, false);
                    } else {
                        lastError = new IOException("空响应");
                    }
                } catch (VlmHttpException e) {
                    lastError = e;
                    boolean routeMissing = e.code == 404 || e.message.contains("model route not found");
                    boolean rateLimited = e.code == 429;
                    boolean serverError = e.code >= 500 || e.code == 408;
                    if (rateLimited) {
                        rateLimitSeen = true;
                        consecutiveRateLimit++;
                        if (consecutiveRateLimit >= circuitThreshold) {
                            circuitOpenUntil = System.currentTimeMillis() + circuitOpenMs;
                            log.warn("[VlmClient] 连续限流 {} 次，熔断 {}ms（配额恢复冷却期）", consecutiveRateLimit, circuitOpenMs);
                        }
                    }
                    if (!routeMissing && !rateLimited && !serverError) {
                        break; // 鉴权/参数类错误不重试
                    }
                    long backoff;
                    if (rateLimited) {
                        // 优先遵守服务端 Retry-After；否则指数退避 + 抖动(±30%)防惊群
                        long base = Math.min(20000L, 3000L * (1L << Math.min(attempt, 3)));
                        backoff = e.retryAfterMs > 0 ? Math.max(e.retryAfterMs, 1000) : base;
                        backoff = jitter(backoff);
                    } else {
                        backoff = jitter(Math.min(8000L, 1000L * (attempt + 1)));
                    }
                    if (System.currentTimeMillis() + backoff > deadline) {
                        lastError = new IOException("重试退避将超出总截止时间");
                        break;
                    }
                    log.warn("[VlmClient] 调用失败({}{})，{}ms 后重试({}/{}) 模型:{}",
                            e.code, routeMissingTag(routeMissing), backoff, attempt + 1, maxRetry, actualModel);
                    try { Thread.sleep(backoff); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                    continue;
                } catch (Exception e) {
                    lastError = e;
                    long backoff = jitter(1500L * (attempt + 1));
                    try { Thread.sleep(backoff); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); break; }
                }
            }
        } finally {
            if (acquired) CONCURRENCY.release();
        }
        String err = lastError == null ? "未知错误" : lastError.getMessage();
        if (lastError instanceof VlmHttpException vh) {
            if (vh.code == 429) {
                err = "VLM 限流/配额受限(429)：" + vh.message + "（已按指数退避重试 " + maxRetry + " 次，请稍后或提升账户 TPM/RPM 配额）";
            } else {
                // 把 {"error":{"code":16,"message":"Forbidden"}} 这类原始体翻成人话，
                // 否则界面上只会看到一坨 JSON，用户不知道是 Key 还是额度问题
                String detail = providerErrorText(vh.message);
                String hint = switch (vh.code) {
                    case 401, 403 -> "API Key 无效/已过期、账户无额度，或该模型未开通";
                    case 404 -> "模型名或接口路径不存在";
                    case 408 -> "服务端超时";
                    default -> vh.code >= 500 ? "服务商内部错误" : "服务商拒绝了本次请求";
                };
                err = "模型服务不可用（HTTP " + vh.code + "：" + detail + "）—— " + hint;
            }
        }
        // 重试耗尽仍是"截断"类失败：明确带 truncated 标志，调用方不得把残缺正文当判定依据
        boolean endedTruncated = lastError != null && lastError.getMessage() != null
                && lastError.getMessage().contains("截断");
        return new VlmResult(false, null, null, System.currentTimeMillis() - t0, 0, err, false, endedTruncated);
    }

    /** 把服务商的错误体翻成人话（{"error":{"code":16,"message":"Forbidden"}} → Forbidden） */
    private static String providerErrorText(String bodyOrMsg) {
        if (bodyOrMsg == null || bodyOrMsg.isBlank()) return "无响应详情";
        try {
            JSONObject o = JSONObject.parseObject(bodyOrMsg);
            Object e = o == null ? null : o.get("error");
            if (e instanceof JSONObject eo) {
                String m = eo.getString("message");
                String c = eo.getString("code");
                return (m == null ? String.valueOf(eo) : m) + (c == null ? "" : "（code " + c + "）");
            }
            if (e != null) return String.valueOf(e);
        } catch (Exception ignore) {
            // 不是 JSON 就直接用原文
        }
        return abbreviate(bodyOrMsg, 200);
    }

    /** OpenAI 兼容/anthropic 协议的截断判定：finish_reason=length / stop_reason=max_tokens */
    private static boolean isTruncated(String protocol, JSONObject respBody) {
        try {
            if ("anthropic".equals(protocol)) {
                String stopReason = respBody.getString("stop_reason");
                return "max_tokens".equals(stopReason);
            }
            JSONArray choices = respBody.getJSONArray("choices");
            if (choices == null || choices.isEmpty()) return false;
            String finishReason = choices.getJSONObject(0).getString("finish_reason");
            return "length".equalsIgnoreCase(finishReason);
        } catch (Exception e) {
            return false;
        }
    }

    /** 限流历史标记（同一次 call 内：发生过 429 则后续重试进一步降分辨率） */
    private boolean rateLimitSeen;

    /** 最小调用间隔约束（客户端主动限流） */
    private void throttle() {
        long wait = lastCallAt + minIntervalMs - System.currentTimeMillis();
        if (wait > 0) {
            try { Thread.sleep(wait); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
        }
        lastCallAt = System.currentTimeMillis();
    }

    /** 退避抖动 ±30%，防惊群 */
    private static long jitter(long ms) {
        long spread = (long) (ms * 0.3);
        return ms - spread + (long) (Math.random() * spread * 2);
    }

    /** 限流重试时进一步缩图（800px），显著减少视觉 token */
    private static String downscale(String imageB64, int maxSide) {
        try {
            String data = imageB64.contains("base64,") ? imageB64.substring(imageB64.indexOf("base64,") + 7) : imageB64;
            byte[] src = java.util.Base64.getDecoder().decode(data);
            javax.imageio.ImageIO.setUseCache(false);
            java.awt.image.BufferedImage img = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(src));
            if (img == null) return imageB64;
            int w = img.getWidth(), h = img.getHeight();
            if (Math.max(w, h) <= maxSide) return imageB64;
            double scale = (double) maxSide / Math.max(w, h);
            java.awt.image.BufferedImage out = new java.awt.image.BufferedImage(
                    Math.max(1, (int) (w * scale)), Math.max(1, (int) (h * scale)), java.awt.image.BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D g = out.createGraphics();
            g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.drawImage(img, 0, 0, out.getWidth(), out.getHeight(), null);
            g.dispose();
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(out, "jpg", bos);
            return "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(bos.toByteArray());
        } catch (Exception e) {
            return imageB64;
        }
    }

    private static String routeMissingTag(boolean routeMissing) {
        return routeMissing ? ",model-route-missing" : "";
    }

    private static class VlmHttpException extends IOException {
        final int code;
        final String message;
        final long retryAfterMs;

        VlmHttpException(int code, String message) {
            this(code, message, 0);
        }

        VlmHttpException(int code, String message, long retryAfterMs) {
            super(message);
            this.code = code;
            this.message = message;
            this.retryAfterMs = retryAfterMs;
        }
    }

    private JSONObject doHttp(String baseUrl, String protocol, String apiKey, String model,
                              String prompt, String imageB64, JSONObject extraParams) throws IOException {
        String url;
        JSONObject body = new JSONObject();
        Headers.Builder hb = new Headers.Builder();
        if ("anthropic".equals(protocol)) {
            url = trimEnd(baseUrl) + "/v1/messages";
            hb.add("x-api-key", apiKey).add("anthropic-version", "2023-06-01");
            body.put("model", model);
            body.put("max_tokens", maxTokens);
            JSONArray msgs = new JSONArray();
            JSONObject m = new JSONObject();
            if (imageB64 != null) {
                JSONArray content = new JSONArray();
                JSONObject img = new JSONObject();
                img.put("type", "image");
                JSONObject src = new JSONObject();
                src.put("type", "base64");
                src.put("media_type", "image/jpeg");
                src.put("data", stripDataUri(imageB64));
                img.put("source", src);
                content.add(img);
                JSONObject txt = new JSONObject();
                txt.put("type", "text");
                txt.put("text", prompt);
                content.add(txt);
                m.put("content", content);
            } else {
                m.put("content", prompt);
            }
            m.put("role", "user");
            msgs.add(m);
            body.put("messages", msgs);
        } else if ("responses".equals(protocol)) {
            url = trimEnd(baseUrl) + "/responses";
            hb.add("Authorization", "Bearer " + apiKey);
            body.put("model", model);
            body.put("input", prompt);
        } else {
            url = trimEnd(baseUrl) + "/chat/completions";
            hb.add("Authorization", "Bearer " + apiKey);
            body.put("model", model);
            body.put("max_tokens", maxTokens);
            body.put("temperature", 0.1);
            JSONArray msgs = new JSONArray();
            JSONObject m = new JSONObject();
            if (imageB64 != null) {
                JSONArray content = new JSONArray();
                JSONObject t = new JSONObject();
                t.put("type", "text");
                t.put("text", prompt);
                content.add(t);
                JSONObject img = new JSONObject();
                img.put("type", "image_url");
                JSONObject iu = new JSONObject();
                iu.put("url", imageB64.startsWith("data:") ? imageB64 : "data:image/jpeg;base64," + stripDataUri(imageB64));
                img.put("image_url", iu);
                content.add(img);
                m.put("content", content);
            } else {
                m.put("content", prompt);
            }
            m.put("role", "user");
            msgs.add(m);
            body.put("messages", msgs);
        }

        // 合并供应商透传参数（params_json）：model/messages 属协议信封，不允许覆盖
        if (extraParams != null) {
            for (Map.Entry<String, Object> e : extraParams.entrySet()) {
                if ("model".equals(e.getKey()) || "messages".equals(e.getKey())) continue;
                body.put(e.getKey(), e.getValue());
            }
        }

        Request req = new Request.Builder().url(url)
                .post(RequestBody.create(body.toJSONString(), MediaType.parse("application/json")))
                .headers(hb.build())
                .build();
        try (Response resp = http.newCall(req).execute()) {
            String respBody = resp.body() == null ? "" : resp.body().string();
            if (!resp.isSuccessful()) {
                // 解析 Retry-After 响应头（秒），429 时优先遵守服务端指示
                String ra = resp.header("Retry-After");
                long retryAfterMs = 0;
                if (ra != null && !ra.isBlank()) {
                    try { retryAfterMs = (long) (Double.parseDouble(ra.trim()) * 1000); } catch (Exception ignore) { }
                }
                throw new VlmHttpException(resp.code(), abbreviate(respBody, 300), retryAfterMs);
            }
            return JSONObject.parseObject(respBody);
        }
    }

    private String extractContent(String protocol, JSONObject resp) {
        try {
            if ("anthropic".equals(protocol)) {
                JSONArray content = resp.getJSONArray("content");
                if (content != null && !content.isEmpty()) {
                    StringBuilder sb = new StringBuilder();
                    for (Object o : content) {
                        JSONObject c = (JSONObject) o;
                        if ("text".equals(c.getString("type"))) sb.append(c.getString("text"));
                    }
                    return sb.toString();
                }
                return null;
            }
            if ("responses".equals(protocol)) {
                JSONArray arr = resp.getJSONArray("output");
                if (arr != null) {
                    for (Object o : arr) {
                        JSONObject item = (JSONObject) o;
                        if ("message".equals(item.getString("type"))) {
                            return item.getJSONArray("content").getJSONObject(0).getString("text");
                        }
                    }
                }
                return null;
            }
            JSONObject msg = resp.getJSONArray("choices").getJSONObject(0).getJSONObject("message");
            String content = msg.getString("content");
            if (content == null || content.isBlank()) {
                // Sensenova 等推理模型：正文可能只出现在 reasoning 字段
                String reasoning = msg.getString("reasoning");
                if (reasoning != null && !reasoning.isBlank()) {
                    return reasoning;
                }
            }
            return content;
        } catch (Exception e) {
            log.warn("[VlmClient] 解析响应失败: {}", e.getMessage());
            return null;
        }
    }

    private long extractTokens(String protocol, JSONObject resp) {
        try {
            JSONObject usage = resp.getJSONObject("usage");
            return usage == null ? 0 : usage.getLongValue("total_tokens",
                    usage.getLongValue("input_tokens", 0) + usage.getLongValue("output_tokens", 0));
        } catch (Exception e) {
            return 0;
        }
    }

    // ---------- 知识库检索（简单关键词匹配，作为 VLM 上下文） ----------
    @Autowired(required = false)
    private com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper genericMapper;

    /**
     * 知识库上下文：分两块拼给模型——
     * ① 结构化判定规则：把"对象 + 正常范围/期望值 + 超限动作"写成硬约束，让模型据它限定识别范围、
     *    按标准值纠错、超出即判异常（异常会自动生成告警，见 CompositeAnalyzer）；
     * ② 文本知识：设备手册/判定经验，作为补充背景。
     * 规则必须显式写成"必须遵守"的指令，否则模型容易只当背景资料忽略掉。
     */
    public String retrieveKbContext(List<Integer> kbIds) {
        if (kbIds == null || kbIds.isEmpty() || genericMapper == null) return null;
        StringBuilder rules = new StringBuilder();
        StringBuilder texts = new StringBuilder();
        try {
            for (Integer kbId : kbIds) {
                List<Map<String, Object>> docs = genericMapper.listByKbId("patrol_knowledge_doc", kbId);
                for (Map<String, Object> doc : docs) {
                    if ("RULE".equalsIgnoreCase(str(doc, "doc_type", "TEXT"))) {
                        String line = formatRule(doc);
                        if (line != null) rules.append("  - ").append(line).append('\n');
                    } else {
                        String content = str(doc, "content", "");
                        if (content.length() > 600) content = content.substring(0, 600);
                        texts.append("- ").append(str(doc, "title", "")).append(": ").append(content).append('\n');
                    }
                }
            }
        } catch (Exception e) {
            log.warn("[VlmClient] 知识库检索失败: {}", e.getMessage());
        }
        StringBuilder sb = new StringBuilder();
        if (rules.length() > 0) sb.append("【判定标准（必须严格遵守，超出范围/不符即判异常）】\n").append(rules);
        if (texts.length() > 0) sb.append("【参考知识】\n").append(texts);
        return sb.length() == 0 ? null : sb.toString();
    }

    /** 结构化规则 → 一句可执行的判定指令 */
    private static String formatRule(Map<String, Object> d) {
        String metric = str(d, "metric", "").trim();
        if (metric.isEmpty()) metric = str(d, "title", "指标").trim();
        String kind = str(d, "rule_kind", "RANGE");
        String unit = str(d, "unit", "").trim();
        String sev = switch (str(d, "severity", "medium")) {
            case "high" -> "严重";
            case "low" -> "提示";
            default -> "重要";
        };
        String act = switch (str(d, "action", "ALARM")) {
            case "REVIEW" -> "转人工复核";
            case "INFO" -> "仅提示不告警";
            default -> "判为异常并告警";
        };
        String body;
        if ("EXPECT".equalsIgnoreCase(kind)) {
            String expect = str(d, "expect_value", "").trim();
            if (expect.isEmpty()) return null;
            body = "期望值 = " + expect + "；识别结果与之不符时判异常（可能为识别错误或设备异常）";
        } else if ("TIME_WINDOW".equalsIgnoreCase(kind)) {
            String expect = str(d, "expect_value", "").trim();
            body = "时间应在" + (expect.isEmpty() ? "当前时间附近（默认 ±1 天）" : expect)
                    + "；明显偏离时判异常（设备时钟异常或识别错误）";
        } else {
            String min = num(d.get("min_val"));
            String max = num(d.get("max_val"));
            if (min == null && max == null) return null;
            String range = min == null ? ("≤ " + max) : max == null ? ("≥ " + min) : (min + " ~ " + max);
            body = "正常范围 " + range + (unit.isEmpty() ? "" : " " + unit) + "；超出该范围判异常";
        }
        String note = str(d, "content", "").trim();
        return metric + "：" + body + "（超限处理：" + act + "，等级：" + sev + "）"
                + (note.isEmpty() ? "" : "。补充：" + (note.length() > 200 ? note.substring(0, 200) : note));
    }

    /** BigDecimal 序列化值规整："20.000" → "20"，空/null 返回 null */
    private static String num(Object v) {
        if (v == null) return null;
        String s = String.valueOf(v).trim();
        if (s.isEmpty() || "null".equals(s)) return null;
        if (s.contains(".")) s = s.replaceAll("0+$", "").replaceAll("\\.$", "");
        return s;
    }

    // ---------- 工具 ----------
    private Map<String, Object> findModel(int id) {
        try {
            return genericMapper.getOne("patrol_vlm_model", id);
        } catch (Exception e) {
            return null;
        }
    }

    private static String str(Map<String, Object> map, String key, String def) {
        Object v = map.get(key);
        return v == null ? def : String.valueOf(v);
    }

    /** 解析模型行 params_json（非法 JSON 视为无透传参数，不阻断主流程） */
    private static JSONObject parseParamsJson(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return JSONObject.parseObject(json);
        } catch (Exception e) {
            return null;
        }
    }

    private static String trimEnd(String s) {
        return s == null ? "" : (s.endsWith("/") ? s.substring(0, s.length() - 1) : s);
    }

    private static String stripDataUri(String b64) {
        if (b64.contains("base64,")) {
            return b64.substring(b64.indexOf("base64,") + 7);
        }
        return b64;
    }

    private static String abbreviate(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    // ---------- AES 加解密（api_key_enc） ----------
    @Value("${patrol.aes.key:wvp-patrol-2026-aes}")
    private String aesKeyField;

    private String aesKey() {
        return aesKeyField == null || aesKeyField.isBlank() ? "wvp-patrol-2026-aes" : aesKeyField;
    }

    public String encrypt(String plain) {
        if (plain == null || plain.isBlank()) return null;
        try {
            SecretKeySpec key = new SecretKeySpec(padKey(aesKey()), "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            return Base64.getEncoder().encodeToString(cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            return plain; // 加密失败降级为原文（比丢失配置好）
        }
    }

    private String decrypt(String enc) {
        if (enc == null || enc.isBlank()) return "";
        try {
            SecretKeySpec key = new SecretKeySpec(padKey(aesKey()), "AES");
            Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE, key);
            return new String(cipher.doFinal(Base64.getDecoder().decode(enc)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return enc; // 可能是历史明文，兼容
        }
    }

    private static byte[] padKey(String keyStr) {
        byte[] src = keyStr.getBytes(StandardCharsets.UTF_8);
        byte[] key = new byte[16];
        System.arraycopy(src, 0, key, 0, Math.min(src.length, 16));
        return key;
    }
}
