package com.genersoft.iot.vmp.patrol.inference;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * YOLO 推理客户端（调 yolo_service.py :8999）。
 * 地址来自配置 patrol.inference.yolo-url，禁止写死。
 */
@Slf4j
@Component
public class YoloClient {

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();

    @Value("${patrol.inference.yolo-url:http://127.0.0.1:8999}")
    private String yoloUrl;

    public record YoloDetection(String label, double confidence, List<Double> box, int classId) {
    }

    @Autowired(required = false)
    private com.genersoft.iot.vmp.patrol.config.PatrolConfigService configService;

    /** 推理服务地址：优先取界面配置(patrol_dict sys_config/yolo_url)，否则用 yml */
    private String baseUrl() {
        if (configService != null) {
            String v = configService.get("yolo_url", null);
            if (v != null && !v.isBlank()) return v.trim();
        }
        return stripSlash(yoloUrl);
    }

    public record YoloResult(boolean ok, List<YoloDetection> detections, long costMs, String error) {
        public int count() {
            return detections == null ? 0 : detections.size();
        }
    }

    /** 健康检查 */
    public YoloResult health() {
        long t0 = System.currentTimeMillis();
        try {
            Request req = new Request.Builder().url(baseUrl() + "/health").get().build();
            try (Response resp = http.newCall(req).execute()) {
                String body = resp.body() == null ? "" : resp.body().string();
                return new YoloResult(resp.isSuccessful(), List.of(), System.currentTimeMillis() - t0,
                        resp.isSuccessful() ? body : "HTTP " + resp.code());
            }
        } catch (IOException e) {
            return new YoloResult(false, List.of(), System.currentTimeMillis() - t0, e.getMessage());
        }
    }

    /**
     * 目标检测（/v1/detect）或 OCR 检测（/v1/ocr_detect）
     */
    public YoloResult detect(String imageBase64, double conf, boolean ocr) {
        return detect(imageBase64, conf, ocr, null, null);
    }

    public YoloResult detect(String imageBase64, double conf, boolean ocr, String modelFile) {
        return detect(imageBase64, conf, ocr, modelFile, null);
    }

    /**
     * 指定模型权重文件（算法管理里上传/选择的）与算法服务地址。
     * 算法档案 patrol_algo.endpoint 配置了服务地址时优先于全局 yolo_url（不同算法可指向不同推理服务/端口）。
     */
    public YoloResult detect(String imageBase64, double conf, boolean ocr, String modelFile, String algoEndpoint) {
        long t0 = System.currentTimeMillis();
        try {
            JSONObject body = new JSONObject();
            body.put("image", imageBase64);
            body.put("conf", conf);
            if (modelFile != null && !modelFile.isBlank() && !"yolov8n.pt".equals(modelFile)) {
                body.put("model", modelFile);
            }
            String base = algoEndpoint != null && !algoEndpoint.isBlank() ? stripSlash(algoEndpoint) : baseUrl();
            Request req = new Request.Builder()
                    .url(base + (ocr ? "/v1/ocr_detect" : "/v1/detect"))
                    .post(RequestBody.create(body.toJSONString(), MediaType.parse("application/json")))
                    .build();
            try (Response resp = http.newCall(req).execute()) {
                String respBody = resp.body() == null ? "" : resp.body().string();
                if (!resp.isSuccessful()) {
                    return new YoloResult(false, List.of(), System.currentTimeMillis() - t0, "HTTP " + resp.code() + " " + respBody);
                }
                JSONObject json = JSONObject.parseObject(respBody);
                JSONArray dets = json.getJSONArray("detections");
                List<YoloDetection> list = new java.util.ArrayList<>();
                if (dets != null) {
                    for (Object o : dets) {
                        JSONObject d = (JSONObject) o;
                        JSONArray box = d.getJSONArray("box");
                        List<Double> bl = box == null ? List.of() : box.toJavaList(Double.class);
                        list.add(new YoloDetection(
                                d.getString("label"),
                                d.getDoubleValue("confidence"),
                                bl,
                                d.getIntValue("class_id")));
                    }
                }
                return new YoloResult(true, list, System.currentTimeMillis() - t0, null);
            }
        } catch (IOException e) {
            log.warn("[YoloClient] 推理调用失败: {}", e.getMessage());
            return new YoloResult(false, List.of(), System.currentTimeMillis() - t0, e.getMessage());
        }
    }

    private String stripSlash(String url) {
        String u = url == null || url.isBlank() ? "http://127.0.0.1:8999" : url.trim();
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }
}
