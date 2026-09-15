package com.genersoft.iot.vmp.patrol.controller;

import lombok.RequiredArgsConstructor;

import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.orchestrator.PatrolOrchestrator;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * AI 检测统一入口：所有模块（台账识别 / 观看单帧研判 / 回放识别 / 机器人回传）共用这一个方法。
 * source=CHANNEL 平台抓帧（等价台账识别）；source=IMAGE 直接收 base64 截图（观看/回放）。
 * 返回结构统一：{ok, result, confidence, identifyType, yolo, vlm, readings, mediaId, mediaUrl}
 */
@Tag(name = "巡检平台-AI检测统一入口")
@RestController
@RequestMapping("/api/patrol/ai")
@RequiredArgsConstructor
public class PatrolAiController {

    private final PatrolOrchestrator orchestrator;

    @PostMapping("/analyze")
    @Audit(module = "settings.ai", action = "execute", targetType = "AI检测")
    @Operation(summary = "统一AI检测：source=CHANNEL(channelId抓帧) 或 IMAGE(image=base64截图)")
    public Map<String, Object> analyze(@RequestBody Map<String, Object> body) {
        if (!PatrolSecurityUtils.hasPerm("settings.ai", "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        String source = body.get("source") == null ? "IMAGE" : String.valueOf(body.get("source"));
        Integer schemeId = body.get("schemeId") == null ? null : Integer.parseInt(String.valueOf(body.get("schemeId")));
        String label = body.get("label") == null ? null : String.valueOf(body.get("label"));
        if ("CHANNEL".equalsIgnoreCase(source)) {
            Integer channelId = body.get("channelId") == null ? null : Integer.parseInt(String.valueOf(body.get("channelId")));
            if (channelId == null) {
                throw new ControllerException(ErrorCode.ERROR400.getCode(), "source=CHANNEL 需要 channelId");
            }
            return orchestrator.analyzeChannelNow(channelId, schemeId, label);
        }
        String image = body.get("image") == null ? null : String.valueOf(body.get("image"));
        if (image == null || image.isBlank()) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "缺少 image");
        }
        return orchestrator.analyzeImageRaw(image, null, null, schemeId, label, PatrolStatus.PLAYBACK);
    }
}
