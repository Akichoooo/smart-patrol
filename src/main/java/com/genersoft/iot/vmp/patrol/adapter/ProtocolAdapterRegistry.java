package com.genersoft.iot.vmp.patrol.adapter;

import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * 协议适配器注册表（Registry）。
 * 设备 → 模板 → 适配器。核心流程只依赖本注册表，无厂商 if-else。
 * <p>
 * 未实现的协议（MQTT / TCP / gRPC / DDS）不做任何降级伪装：
 * 直接返回 DISABLED + 明确原因，由编排器按"能力不支持"处理并记录在案。
 * 待接入清单见 patrol/DESIGN.md「未实现清单」。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProtocolAdapterRegistry {

    private final GenericHttpAdapter genericHttpAdapter;

    @Autowired(required = false)
    private java.util.List<ProtocolAdapter> adapters;

    private final Map<String, ProtocolAdapter> byType = new HashMap<>();

    /** 尚未实现的协议类型 → 明确原因（不伪装、不降级） */
    private static final Map<String, String> NOT_IMPLEMENTED = Map.of(
            "MQTT", "MQTT 适配器未实现（需部署 Broker 后按预设接入）",
            "TCP", "TCP 适配器未实现",
            "GRPC", "gRPC 适配器未实现（Spot 预设待接入）",
            "DDS", "DDS 适配器未实现（宇树预设需局域网 DDS 桥）");

    /** DB 原始行是 snake_case；兼容 camelCase 传入 */
    private static Object firstOf(Map<String, Object> row, String snake, String camel, String def) {
        Object v = row.get(snake);
        if (v == null) v = row.get(camel);
        return v == null ? def : v;
    }

    private void index() {
        if (!byType.isEmpty()) {
            return;
        }
        if (adapters != null) {
            for (ProtocolAdapter a : adapters) {
                byType.put(a.type(), a);
            }
        }
    }

    /**
     * 下发指令（能力协商 + 配置驱动）。
     *
     * @param deviceRow   patrol_robot_device 行
     * @param templateRow patrol_protocol_template 行
     * @param command     统一指令
     */
    public ProtocolAdapter.CommandResult dispatch(Map<String, Object> deviceRow, Map<String, Object> templateRow,
                                                  String command, Map<String, Object> params) {
        index();
        String type = String.valueOf(templateRow == null ? "HTTP_REST"
                : firstOf(templateRow, "protocol_type", "protocolType", "HTTP_REST"));

        if (NOT_IMPLEMENTED.containsKey(type)) {
            log.info("[协议注册表] {} 未实现，指令 {} 按能力不支持返回", type, command);
            return ProtocolAdapter.CommandResult.disabled(command + " (" + NOT_IMPLEMENTED.get(type) + ")");
        }

        ProtocolAdapter adapter = byType.get(type);
        if (adapter == null) {
            return ProtocolAdapter.CommandResult.disabled(command + " (无 " + type + " 适配器)");
        }

        // 能力协商：模板 capabilities_json 过滤（不支持则返回 DISABLED，而非报错）
        String capsJson = String.valueOf(templateRow == null ? "[]" : firstOf(templateRow, "capabilities_json", "capabilitiesJson", "[]"));
        try {
            boolean inCaps = com.alibaba.fastjson2.JSONArray.parseArray(capsJson).contains(command);
            if (!inCaps) {
                return ProtocolAdapter.CommandResult.disabled(command + " (模板能力集未声明)");
            }
        } catch (Exception e) {
            return ProtocolAdapter.CommandResult.disabled(command + " (能力集解析失败)");
        }

        if (adapter instanceof GenericHttpAdapter g) {
            return g.executeWithTemplate(deviceRow, templateRow, command, params);
        }
        return adapter.send(command, deviceRow, params);
    }
}
