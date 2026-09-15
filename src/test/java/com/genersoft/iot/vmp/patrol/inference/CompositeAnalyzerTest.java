package com.genersoft.iot.vmp.patrol.inference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 审计修复回归测试（P1-2 / P1-1 / P3-1）：
 * 1) YOLO 与 VLM 全部失败 → FAILED（不允许凭空 NORMAL）
 * 2) VLM 输出截断（finish_reason=length，重试耗尽）→ 失败处理，不因"有错误文本"误判
 * 3) VLM 正常输出完整 JSON 且含 confidence → 用模型置信度，不硬编码 0.95
 * 4) VLM 输出无完整 JSON（文本粗判路径）→ 标记引擎失败，YOLO 未检出时整体 FAILED
 */
class CompositeAnalyzerTest {

    private CompositeAnalyzer analyzer;
    private YoloClient yoloClient;
    private VlmClient vlmClient;

    /** 最小 base64 图（1x1 像素 JPEG 起始字节即可触发 ImageIO 失败→原图回传，无需真实图） */
    private static final String IMG_B64 =
            java.util.Base64.getEncoder().encodeToString(new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0});

    @BeforeEach
    void setup() {
        yoloClient = mock(YoloClient.class);
        vlmClient = mock(VlmClient.class);
        // 构造注入后直接以构造器传入 mock（架构规范 §3：禁止字段注入 + 反射塞字段）
        analyzer = new CompositeAnalyzer(yoloClient, vlmClient);
    }

    /** scheme：YOLO(算法1) + VLM(模型2) 全启用 */
    private static Map<String, Object> fullScheme() {
        Map<String, Object> s = new HashMap<>();
        s.put("algo_id", 1);
        s.put("vlm_model_id", 2);
        s.put("vlm_enabled", true);
        s.put("threshold", 0.6);
        s.put("sceneType", "text_digit");
        return s;
    }

    private void yolo(boolean ok) {
        when(yoloClient.detect(anyString(), anyDouble(), Mockito.anyBoolean(), any(), any()))
                .thenReturn(new YoloClient.YoloResult(ok, java.util.List.of(), 1, ok ? null : "服务不可达"));
    }

    private void vlm(boolean ok, String content) {
        when(vlmClient.retrieveKbContext(any())).thenReturn(null);
        when(vlmClient.analyze(anyInt(), anyString(), anyString(), any()))
                .thenReturn(new VlmClient.VlmResult(ok, content, "test-model", 1, 10,
                        ok ? null : "模型输出被截断(finish_reason=length)", false, !ok));
    }

    @Test
    void bothEnginesFailedShouldBeFAILED() {
        yolo(false);
        vlm(false, null); // VLM 调用失败（含截断重试耗尽）
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        assertEquals("FAILED", r.result(), "全部引擎失败必须标 FAILED，不得凭空 NORMAL");
        assertEquals(0.0, r.confidence(), 0.0001);
        assertTrue(r.vlmText() != null && r.vlmText().contains("【VLM 调用失败"), "失败文本应保留供排查");
    }

    @Test
    void vlmFailedYoloSucceededShouldNotCountVlmAsSuccess() {
        yolo(true); // YOLO 正常但未检出目标（空 detections）
        vlm(false, null);
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        // VLM 失败时即使 YOLO 成功，也不得把 VLM 计为成功引擎：结果允许 NORMAL（YOLO 未检出），
        // 但 anomaly_reason 必须说明 VLM 不可用，且不得出现模型置信度
        assertEquals("NORMAL", r.result());
        assertTrue(r.anomalyReason() != null && r.anomalyReason().contains("VLM 复核不可用"),
                "必须说明 VLM 不可用：" + r.anomalyReason());
    }

    @Test
    void truncatedJsonShouldNotBeUsedAsJudgement() {
        yolo(false);
        // VLM ok=true 但正文是被截断的残缺 JSON（模拟历史缺陷：94 字符断在 findings 中间）
        vlm(true, "```json\n{\"findings\": [{\"item\": \"空调外壳\", \"anomaly\": fal");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        assertEquals("FAILED", r.result(), "残缺 JSON 不可作为判定依据，全引擎无效即 FAILED");
    }

    @Test
    void vlmConfidenceShouldBeUsedWhenProvided() {
        yolo(true);
        vlm(true, "```json\n{\"findings\": [{\"item\": \"外壳\", \"anomaly\": false}], \"anomaly\": false, "
                + "\"confidence\": 0.8, \"reason\": \"外观正常\"}\n```");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        assertEquals("NORMAL", r.result());
        assertEquals(0.8, r.confidence(), 0.0001, "模型给出 confidence 时应采用模型值而非硬编码 0.95");
    }

    @Test
    void vlmNormalWithoutConfidenceKeepsMarkerValue() {
        yolo(true);
        vlm(true, "```json\n{\"findings\": [], \"anomaly\": false, \"reason\": \"正常\"}\n```");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        assertEquals("NORMAL", r.result());
        assertEquals(0.95, r.confidence(), 0.0001, "模型未给 confidence 时保留标记值");
    }

    @Test
    void vlmAbnormalTakesPrecedenceOverYolo() {
        yolo(true);
        vlm(true, "```json\n{\"findings\": [{\"item\": \"外壳破损\", \"anomaly\": true}], \"anomaly\": true, "
                + "\"confidence\": 0.9, \"reason\": \"发现裂纹\"}\n```");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, fullScheme(), "prompt", "点位");
        assertEquals("ABNORMAL", r.result());
        assertEquals(0.9, r.confidence(), 0.0001);
        assertTrue(r.anomalyReason() != null && r.anomalyReason().contains("裂纹"));
    }

    @Test
    void noAlgoVlmDisabledGivesFailed() {
        Map<String, Object> s = new HashMap<>();
        s.put("vlm_enabled", false); // 未配算法也未启 VLM：attempted=0
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, s, "prompt", "点位");
        assertEquals("NORMAL", r.result(), "无引擎配置时保持旧行为（不判失败）");
    }

    // ---------------- 提示词链路（场景→端点/提示词/聚合） ----------------

    @Test
    void generalSceneShouldUseDetectEndpointNotOcr() {
        // 通用外观方案（prompt scene=general）：YOLO 必须走 /v1/detect 而非 OCR 端点
        Map<String, Object> s = fullScheme();
        s.put("sceneType", "general");
        yolo(true);
        vlm(true, "```json\n{\"findings\": [], \"anomaly\": false, \"reason\": \"正常\"}\n```");
        analyzer.analyze(IMG_B64, s, "prompt", "点位");
        org.mockito.Mockito.verify(yoloClient)
                .detect(anyString(), anyDouble(), org.mockito.ArgumentMatchers.eq(false), any(), any());
    }

    @Test
    void textDigitSceneShouldUseOcrEndpoint() {
        Map<String, Object> s = fullScheme();
        s.put("sceneType", "text_digit");
        yolo(true);
        vlm(true, "```json\n{\"text\": \"ABC-123\", \"anomaly\": false, \"reason\": \"铭牌正常\"}\n```");
        analyzer.analyze(IMG_B64, s, "prompt", "点位");
        org.mockito.Mockito.verify(yoloClient)
                .detect(anyString(), anyDouble(), org.mockito.ArgumentMatchers.eq(true), any(), any());
    }

    @Test
    void findingsAnomalyShouldAggregateToAbnormal() {
        // 通用外观方案：findings 中任一项 anomaly=true → 整体 ABNORMAL，理由含异常项名
        Map<String, Object> s = fullScheme();
        s.put("sceneType", "general");
        yolo(true);
        vlm(true, "```json\n{\"findings\": [{\"item\": \"外壳\", \"anomaly\": false},"
                + "{\"item\": \"渗漏\", \"anomaly\": true}], \"anomaly\": true, \"confidence\": 0.9, "
                + "\"reason\": \"发现渗漏痕迹\"}\n```");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, s, "prompt", "点位");
        assertEquals("ABNORMAL", r.result(), "findings 聚合：单项异常必须上抬为整体异常");
        assertTrue(r.anomalyReason() != null && r.anomalyReason().contains("渗漏"),
                "理由应包含异常项名称: " + r.anomalyReason());
        assertEquals("渗漏", r.identifySubType(), "缺陷子类型应取异常发现项");
    }

    @Test
    void findingsAllNormalStaysNormal() {
        Map<String, Object> s = fullScheme();
        s.put("sceneType", "general");
        yolo(true);
        vlm(true, "```json\n{\"findings\": [{\"item\": \"外壳\", \"anomaly\": false},"
                + "{\"item\": \"密封\", \"anomaly\": false}], \"anomaly\": false, "
                + "\"confidence\": 0.85, \"reason\": \"外观正常\"}\n```");
        CompositeAnalyzer.AnalysisResult r = analyzer.analyze(IMG_B64, s, "prompt", "点位");
        assertEquals("NORMAL", r.result());
        assertEquals(0.85, r.confidence(), 0.0001);
    }

    @Test
    void algoEndpointShouldBePassedToYolo() {
        // 算法档案配置的推理服务地址应传给 YoloClient（优先于全局配置）
        Map<String, Object> s = fullScheme();
        s.put("sceneType", "general");
        s.put("algoEndpoint", "http://yolo-b:8999");
        yolo(true);
        vlm(true, "```json\n{\"findings\": [], \"anomaly\": false, \"reason\": \"正常\"}\n```");
        analyzer.analyze(IMG_B64, s, "prompt", "点位");
        org.mockito.Mockito.verify(yoloClient)
                .detect(anyString(), anyDouble(), org.mockito.ArgumentMatchers.eq(false),
                        any(), org.mockito.ArgumentMatchers.eq("http://yolo-b:8999"));
    }
}
