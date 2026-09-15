package com.genersoft.iot.vmp.patrol.inference;

import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * CompositeAnalyzer：识别方案的运行时分析链（Chain of Responsibility）。
 * 流程：YOLO 初筛 →（按需）知识库检索 → VLM 复核 → 融合判定。
 * 输出统一 AnalysisResult，结构化读数（PointReading）单列，喂 patrol_point_reading 做曲线数据源。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CompositeAnalyzer {

    private final YoloClient yoloClient;

    private final VlmClient vlmClient;

    /** 融合判定结果 */
    public record AnalysisResult(boolean normal, String result, double confidence,
                                 String identifyType, String identifySubType, String defectType,
                                 String anomalyReason, String yoloJson, String vlmText,
                                 List<Map<String, Object>> readings) {
    }


    /** VLM 发送前图片最长边上限（省配额：视觉 token 随分辨率增长；识别精度 1600px 足够） */
    private static final int VLM_MAX_SIDE = 1600;

    /**
     * 分析一张点位照片。
     *
     * @param imageB64  图片 base64
     * @param scheme    识别方案（algo_id/vlm_model_id/prompt_id/kb_ids/threshold/vlm_enabled）
     * @param prompt    提示词内容（Service 层解析好传入）
     */
    public AnalysisResult analyze(String imageB64, Map<String, Object> scheme, String prompt, String waypointName) {
        String vlmImage = downscaleForVlm(imageB64);
        String identifyType = mapScene(str(scheme, "sceneType"));
        double threshold = dbl(scheme, "threshold", 0.6);

        // 1) YOLO 初筛（仅 text_digit 场景走 OCR 端点；通用/灯/表等场景走目标检测端点）
        YoloClient.YoloResult yolo = null;
        boolean yoloOk = false;
        String yoloJson = null;
        if (scheme.get("algo_id") != null) {
            boolean ocr = "text_digit".equals(identifyType);
            String weights = str(scheme, "algoFilePath");
            String endpoint = str(scheme, "algoEndpoint");
            yolo = yoloClient.detect(imageB64, threshold, ocr, weights, endpoint);
            yoloOk = yolo.ok();
            if (yoloOk) {
                JSONArray arr = new JSONArray();
                for (YoloClient.YoloDetection d : yolo.detections()) {
                    JSONObject o = new JSONObject();
                    o.put("label", d.label());
                    o.put("confidence", d.confidence());
                    o.put("box", d.box());
                    arr.add(o);
                }
                yoloJson = arr.toJSONString();
            }
        }

        // 2) VLM 复核（未启用或YOLO失败且无算法时也走VLM兜底）
        boolean vlmEnabled = Boolean.parseBoolean(String.valueOf(scheme.getOrDefault("vlm_enabled", true)));
        String vlmText = null;
        boolean vlmFailed = false;
        List<Map<String, Object>> readings = new java.util.ArrayList<>();
        boolean vlmSaysAbnormal = false;
        String vlmReason = null;
        String identifySubType = null;
        String defectType = null;
        String actualModel = null;
        Double vlmConfidence = null;

        if (vlmEnabled && scheme.get("vlm_model_id") != null) {
            // 知识库上下文
            String kbCtx = vlmClient.retrieveKbContext(parseIntList(scheme.get("kb_ids_json")));
            VlmClient.VlmResult vr = vlmClient.analyze(
                    Integer.parseInt(String.valueOf(scheme.get("vlm_model_id"))),
                    prompt == null ? defaultPrompt(waypointName, identifyType) : prompt,
                    vlmImage, kbCtx);
            actualModel = vr.actualModel();
            if (vr.ok()) {
                vlmText = vr.content();
                JSONObject parsed = extractJson(vlmText);
                if (parsed != null) {
                    // 判定
                    Boolean anomaly = parsed.getBoolean("anomaly");
                    vlmSaysAbnormal = anomaly != null && anomaly;
                    vlmReason = parsed.getString("reason");
                    Double conf = parsed.getDouble("confidence");
                    if (conf != null) vlmConfidence = conf;
                    // 读数（表计）
                    JSONObject reading = parsed.getJSONObject("reading");
                    if (reading != null) {
                        Map<String, Object> r = new HashMap<>();
                        r.put("readingKey", waypointName);
                        r.put("valueNum", reading.getDouble("value"));
                        r.put("valueText", String.valueOf(reading.get("value")));
                        r.put("unit", reading.getString("unit"));
                        r.put("confidence", reading.getDouble("confidence"));
                        readings.add(r);
                    }
                    // 发现项聚合（通用外观方案）：任一发现项异常 → 整体异常，理由取首个异常项
                    JSONArray findings = parsed.getJSONArray("findings");
                    if (findings != null && !findings.isEmpty()) {
                        List<String> abnormalItems = new java.util.ArrayList<>();
                        for (Object o : findings) {
                            JSONObject f = (JSONObject) o;
                            if (Boolean.TRUE.equals(f.getBoolean("anomaly"))) {
                                abnormalItems.add(String.valueOf(f.getOrDefault("item", "未命名发现项")));
                            }
                        }
                        if (!abnormalItems.isEmpty()) {
                            vlmSaysAbnormal = true;
                            vlmReason = "发现异常项: " + String.join("、", abnormalItems)
                                    + (vlmReason != null ? "。" + vlmReason : "");
                            identifySubType = abnormalItems.size() == 1 ? abnormalItems.get(0) : "多发现项异常";
                        }
                    }
                    JSONArray lights = parsed.getJSONArray("lights");
                    if (lights != null && !lights.isEmpty()) {
                        for (Object o : lights) {
                            JSONObject l = (JSONObject) o;
                            if (Boolean.TRUE.equals(l.getBoolean("anomaly"))) {
                                vlmSaysAbnormal = true;
                                vlmReason = l.getString("name") + " 状态异常: " + l.getString("status");
                                identifySubType = l.getString("name");
                            }
                        }
                    }
                    JSONArray switches = parsed.getJSONArray("switches");
                    if (switches != null && !switches.isEmpty()) {
                        identifySubType = "空开状态";
                        for (Object o : switches) {
                            JSONObject sw = (JSONObject) o;
                            Map<String, Object> r = new HashMap<>();
                            r.put("readingKey", sw.getString("name"));
                            r.put("valueText", sw.getString("state"));
                            r.put("unit", "state");
                            readings.add(r);
                        }
                    }
                } else {
                    // 无完整 JSON：文本粗判（仅作参考性提示，标记引擎失败，不据此判 NORMAL/ABNORMAL）
                    vlmFailed = true;
                    vlmSaysAbnormal = vlmText != null && (vlmText.contains("异常") || vlmText.contains("隐患"));
                    vlmReason = abbreviate(vlmText, 300);
                }
            } else {
                vlmFailed = true;
                vlmText = "【VLM 调用失败" + (vr.truncated() ? "·输出截断】" : "】") + vr.error();
            }
        }

        // 3) 融合判定
        double yoloMaxConf = yoloOk && yolo.detections() != null
                ? yolo.detections().stream().mapToDouble(YoloClient.YoloDetection::confidence).max().orElse(0)
                : 0;
        boolean abnormal;
        double confidence;
        // VLM 判定有效的条件：有正文、且解析出了完整 JSON（vlmFailed=false）
        boolean vlmUsable = vlmEnabled && vlmText != null && !vlmFailed;
        if (vlmUsable) {
            abnormal = vlmSaysAbnormal;
            // 置信度：模型给出 confidence 用模型值（0-1），否则保留标记值；不再把 0.95 伪装成模型置信度
            confidence = vlmConfidence != null
                    ? Math.max(0.0, Math.min(1.0, vlmConfidence))
                    : (abnormal ? Math.max(0.9, yoloMaxConf) : 0.95);
        } else if (yoloOk) {
            abnormal = yoloMaxConf >= threshold;
            confidence = yoloMaxConf;
        } else {
            abnormal = false;
            confidence = 0;
        }

        // 实际启用的引擎数与成功数：一个都没成功 → FAILED，不谎报正常
        // （VLM 调用失败/输出截断/无完整JSON 都算失败，不因"有错误文本"误计成功）
        boolean algoConfigured = scheme.get("algo_id") != null;
        boolean yoloSucceeded = algoConfigured && yolo != null && yolo.ok();
        boolean vlmSucceeded = vlmUsable;
        int attempted = (algoConfigured ? 1 : 0) + (vlmEnabled ? 1 : 0);
        int succeeded = (yoloSucceeded ? 1 : 0) + (vlmSucceeded ? 1 : 0);
        String result;
        if (attempted > 0 && succeeded == 0) {
            result = PatrolStatus.FAILED;   // 全部引擎失败，明确标记失败
        } else {
            result = abnormal ? PatrolStatus.ABNORMAL : PatrolStatus.NORMAL;
        }
        String anomalyReason = abnormal
                ? (vlmReason != null ? vlmReason : "YOLO 检出置信度 " + yoloMaxConf + " ≥ 阈值 " + threshold)
                : (vlmFailed ? ("VLM 复核不可用，仅完成 YOLO 初筛" + (yoloOk ? "（未检出目标）" : "")
                        + (vlmText != null && vlmText.startsWith("【") ? "。" + vlmText : "")) : null);
        if (defectType == null) defectType = abnormal ? (identifySubType != null ? identifySubType : identifyType) : null;

        return new AnalysisResult(!abnormal, result, confidence, identifyType, identifySubType, defectType,
                anomalyReason, yoloJson, vlmText == null ? null : ("[" + (actualModel == null ? "" : actualModel + "] ") + vlmText), readings);
    }

    /** 发送 VLM 前把图片等比缩到最长边 ≤1600 并转 JPEG（大幅降低视觉 token 与 429 概率） */
    private String downscaleForVlm(String imageB64) {
        try {
            String data = imageB64.contains("base64,") ? imageB64.substring(imageB64.indexOf("base64,") + 7) : imageB64;
            byte[] src = java.util.Base64.getDecoder().decode(data);
            javax.imageio.ImageIO.setUseCache(false);
            java.awt.image.BufferedImage img = javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(src));
            if (img == null) return imageB64;
            int w = img.getWidth(), h = img.getHeight();
            if (Math.max(w, h) <= VLM_MAX_SIDE) {
                return "data:image/jpeg;base64," + data;
            }
            double scale = (double) VLM_MAX_SIDE / Math.max(w, h);
            int nw = Math.max(1, (int) Math.round(w * scale));
            int nh = Math.max(1, (int) Math.round(h * scale));
            java.awt.image.BufferedImage out = new java.awt.image.BufferedImage(nw, nh, java.awt.image.BufferedImage.TYPE_INT_RGB);
            java.awt.Graphics2D g = out.createGraphics();
            g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            g.drawImage(img, 0, 0, nw, nh, null);
            g.dispose();
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(out, "jpg", bos);
            String b64 = java.util.Base64.getEncoder().encodeToString(bos.toByteArray());
            return "data:image/jpeg;base64," + b64;
        } catch (Exception e) {
            return imageB64;
        }
    }

    /** 从模型输出中提取第一个 JSON 对象（括号配平扫描，支持 findings/lights/switches 等嵌套结构） */
    private JSONObject extractJson(String text) {
        if (text == null) return null;
        // 去掉 markdown 代码块包裹
        String cleaned = text.replace("```json", "").replace("```", "");
        JSONObject firstParsed = null;
        int depth = 0, start = -1;
        boolean inStr = false, escape = false;
        for (int i = 0; i < cleaned.length(); i++) {
            char c = cleaned.charAt(i);
            if (inStr) {
                if (escape) escape = false;
                else if (c == '\\') escape = true;
                else if (c == '"') inStr = false;
                continue;
            }
            if (c == '"') { inStr = true; continue; }
            if (c == '{') {
                if (depth == 0) start = i;
                depth++;
            } else if (c == '}') {
                if (depth > 0) {
                    depth--;
                    if (depth == 0 && start >= 0) {
                        JSONObject candidate = tryParse(cleaned.substring(start, i + 1));
                        start = -1;
                        if (candidate == null) continue;
                        if (hasKnownKeys(candidate)) return candidate;
                        if (firstParsed == null) firstParsed = candidate;
                    }
                }
            }
        }
        // 没有带已知键的对象时退回第一个可解析对象（保持旧版宽松兜底）
        return firstParsed;
    }

    private static boolean hasKnownKeys(JSONObject o) {
        return o.containsKey("anomaly") || o.containsKey("reading") || o.containsKey("lights")
                || o.containsKey("switches") || o.containsKey("findings") || o.containsKey("confidence");
    }

    private static JSONObject tryParse(String s) {
        try {
            return JSONObject.parseObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    /** 提示词场景 -> 识别类型字典编码 */
    /** 提示词场景 -> 识别类型字典编码（general=通用外观，走通用检测端点，不折叠成 OCR） */
    private String mapScene(String scene) {
        if (scene == null || scene.isBlank()) return "general";
        return switch (scene) {
            case "meter" -> "meter_reading";
            case "indicator_light" -> "indicator_light";
            case "switch_status" -> "switch_status";
            case "text", "text_digit" -> "text_digit";
            case "general" -> "general";
            default -> "general";
        };
    }

    /** 分场景兜底提示词（未在方案里配 prompt 时按识别类型给最小可用提示） */
    private String defaultPrompt(String waypointName, String identifyType) {
        String head = "你是工业设备巡检专家。请检查照片（点位：" + waypointName + "）";
        return switch (identifyType) {
            case "meter_reading" -> head + "中的表计读数，按JSON输出：{\"reading\":{\"value\":数值,\"unit\":\"单位\",\"confidence\":0-1},\"anomaly\":true/false,\"confidence\":0-1(你对判定的把握度),\"reason\":\"判定原因\"}。";
            case "indicator_light" -> head + "中设备指示灯状态(运行/停止/告警/闪烁)，按JSON输出：{\"lights\":[{\"name\":\"灯名\",\"status\":\"green/red/yellow/off/flashing\",\"anomaly\":true/false}],\"anomaly\":true/false,\"confidence\":0-1(你对判定的把握度),\"reason\":\"判定原因\"}。红灯或异常闪烁需判定异常。";
            case "switch_status" -> head + "中断路器/空开的分合闸状态，按JSON输出：{\"switches\":[{\"name\":\"空开名称\",\"state\":\"closed合闸/open分闸\"}],\"anomaly\":true/false,\"confidence\":0-1(你对判定的把握度),\"reason\":\"判定原因\"}。";
            case "text_digit" -> head + "中的铭牌/面板文字与数字，按JSON输出：{\"text\":\"识别出的完整文本\",\"anomaly\":true/false,\"confidence\":0-1(你对判定的把握度),\"reason\":\"内容是否异常及原因\"}。";
            default -> head + "中设备外观是否正常(破损/渗漏/锈蚀/异物/放电痕迹)，按JSON输出：{\"findings\":[{\"item\":\"发现项\",\"anomaly\":true/false}],\"anomaly\":true/false,\"confidence\":0-1(你对判定的把握度),\"reason\":\"综合研判\"}。";
        };
    }

    /**
     * 解析 id 列表。kb_ids_json 从库里取出是**字符串**（如 "[2]"），早期实现只处理 List，
     * 导致知识库 id 永远解析为空 —— 知识库对 VLM 从未生效。这里兼容 List / JSON 数组串 / "1,2" 逗号串。
     */
    private List<Integer> parseIntList(Object v) {
        if (v == null) return List.of();
        if (v instanceof List<?> list) {
            return list.stream().filter(java.util.Objects::nonNull)
                    .map(x -> Integer.parseInt(String.valueOf(x).trim())).toList();
        }
        String s = String.valueOf(v).trim();
        if (s.isEmpty() || "null".equals(s) || "[]".equals(s)) return List.of();
        try {
            if (s.startsWith("[")) {
                return JSONArray.parseArray(s).stream().filter(java.util.Objects::nonNull)
                        .map(x -> Integer.parseInt(String.valueOf(x).trim())).toList();
            }
            return java.util.Arrays.stream(s.split(",")).map(String::trim)
                    .filter(x -> !x.isEmpty()).map(Integer::parseInt).toList();
        } catch (Exception e) {
            log.warn("[CompositeAnalyzer] kbIds 解析失败: {} ({})", s, e.getMessage());
            return List.of();
        }
    }

    private static String str(Map<String, Object> map, String key) {
        Object v = map.get(key);
        return v == null ? null : String.valueOf(v);
    }

    private static double dbl(Map<String, Object> map, String key, double def) {
        try {
            Object v = map.get(key);
            return v == null ? def : Double.parseDouble(String.valueOf(v));
        } catch (Exception e) {
            return def;
        }
    }

    private static String abbreviate(String s, int max) {
        return s == null ? null : (s.length() <= max ? s : s.substring(0, max));
    }
}
