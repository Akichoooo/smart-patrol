package com.genersoft.iot.vmp.patrol.controller;

import lombok.RequiredArgsConstructor;

import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.patrol.service.PatrolGenericService;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * patrol 通用配置实体 REST：
 * /api/patrol/{entity}/list | /save | /{id}/delete
 * entity ∈ robot / profile / protocol / waypoint / route / algo / model / prompt /
 *          knowledge / knowledge-doc / scheme / analyzer / maintenance / dict
 */
@Tag(name = "巡检平台-配置实体")
@RestController
@RequestMapping("/api/patrol")
@RequiredArgsConstructor
public class PatrolEntityController {

    private final PatrolGenericService service;

    private final com.genersoft.iot.vmp.patrol.inference.VlmClient vlmClient;

    /** entity -> 表名 与所需权限模块映射 */
    private static final java.util.Map<String, String[]> ENTITY_TABLE = java.util.Map.ofEntries(
            java.util.Map.entry("robot", new String[]{"patrol_robot_device", "settings.asset", "monitor.robot"}),
            java.util.Map.entry("profile", new String[]{"patrol_device_profile", "settings.asset", "settings.asset"}),
            java.util.Map.entry("protocol", new String[]{"patrol_protocol_template", "settings.asset", "settings.asset"}),
            java.util.Map.entry("waypoint", new String[]{"patrol_waypoint", "settings.asset", "settings.asset"}),
            java.util.Map.entry("route", new String[]{"patrol_route", "settings.asset", "settings.asset"}),
            java.util.Map.entry("algo", new String[]{"patrol_algo", "settings.ai", "settings.ai"}),
            java.util.Map.entry("model", new String[]{"patrol_vlm_model", "settings.ai", "settings.ai"}),
            java.util.Map.entry("prompt", new String[]{"patrol_prompt", "settings.ai", "settings.ai"}),
            java.util.Map.entry("knowledge", new String[]{"patrol_knowledge_base", "settings.ai", "settings.ai"}),
            java.util.Map.entry("knowledge-doc", new String[]{"patrol_knowledge_doc", "settings.ai", "settings.ai"}),
            java.util.Map.entry("scheme", new String[]{"patrol_identify_scheme", "settings.ai", "settings.ai"}),
            java.util.Map.entry("analyzer", new String[]{"patrol_analyzer", "settings.ai", "settings.ai"}),
            java.util.Map.entry("maintenance", new String[]{"patrol_maintenance_area", "settings.patrol", "settings.patrol"}),
            java.util.Map.entry("dict", new String[]{"patrol_dict", "settings.patrol", "settings.patrol"})
    );

    private String table(String entity) {
        String[] def = ENTITY_TABLE.get(entity);
        if (def == null) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "未知实体: " + entity);
        }
        return def[0];
    }

    private String viewModule(String entity) {
        return ENTITY_TABLE.get(entity)[1];
    }

    private String editModule(String entity) {
        return ENTITY_TABLE.get(entity)[2];
    }

    @GetMapping("/{entity}/list")
    @Operation(summary = "实体列表（可选 type 过滤）")
    public List<Map<String, Object>> list(@PathVariable String entity,
                                          @RequestParam(required = false) String type) {
        checkView(entity);
        String t = table(entity);
        List<Map<String, Object>> rows = "robot".equals(entity) && type != null && !type.isBlank()
                ? service.listByType(t, type)
                : service.list(t);
        // 模型配置不下发加密后的 Key（前端只展示 已配置/未配置）
        if ("patrol_vlm_model".equals(t)) {
            for (Map<String, Object> row : rows) {
                Object k = row.get("api_key_enc");
                row.put("apiKeyConfigured", k != null && !String.valueOf(k).isBlank());
                row.put("api_key_enc", "***");
            }
        }
        return rows;
    }

    @GetMapping("/knowledge/doc/list")
    @Operation(summary = "知识库文档列表（按知识库）")
    public List<Map<String, Object>> kbDocs(@RequestParam int kbId) {
        checkView("knowledge-doc");
        return service.listByKb("patrol_knowledge_doc", kbId);
    }

    @PostMapping("/{entity}/save")
    @Audit(module = "settings", action = "edit", targetType = "配置")
    @Operation(summary = "保存实体（body 带 id 则更新，否则新增）")
    public Map<String, Object> save(@PathVariable String entity, @RequestBody Map<String, Object> body) {
        checkEdit(entity);
        String table = table(entity);
        // 模型供应商的 API Key：前端传明文 api_key，落库列是 api_key_enc 且必须 AES 加密。
        // 之前把 api_key 直接交给通用 SQL，拼出并不存在的列 → Unknown column 'api_key' → 保存 500。
        if ("patrol_vlm_model".equals(table)) {
            Object key = body.remove("api_key");
            if (key != null && !String.valueOf(key).isBlank()) {
                body.put("api_key_enc", vlmClient.encrypt(String.valueOf(key).trim()));
            }
        }
        java.util.List<String> ignored = new java.util.ArrayList<>();
        int id = service.save(table, body, ignored);
        Map<String, Object> out = new java.util.HashMap<>();
        out.put("id", id);
        // 多传的字段如实回传，便于前端发现字段名写错（而不是静默丢弃）
        if (!ignored.isEmpty()) out.put("ignoredFields", ignored);
        return out;
    }

    @PostMapping("/{entity}/{id}/delete")
    @Audit(module = "settings", action = "delete", targetType = "配置")
    @Operation(summary = "删除实体")
    public void delete(@PathVariable String entity, @PathVariable int id) {
        checkEdit(entity);
        service.delete(table(entity), id);
    }

    @PostMapping("/{entity}/{id}/enable")
    @Audit(module = "settings", action = "edit", targetType = "配置")
    @Operation(summary = "启用/停用实体（profile/protocol 切 enabled，maintenance 切 status）")
    public Map<String, Object> enable(@PathVariable String entity, @PathVariable int id,
                                      @RequestBody Map<String, Object> body) {
        if (!ENTITY_TABLE.containsKey(entity)) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "未知实体: " + entity);
        }
        checkEdit(entity);
        boolean on = Boolean.TRUE.equals(body.get("enabled"))
                || "true".equalsIgnoreCase(String.valueOf(body.get("enabled")));
        switch (entity) {
            case "profile", "protocol" -> service.save(table(entity), Map.of("id", id, "enabled", on));
            case "maintenance" -> service.save(table(entity), Map.of("id", id, "status", on ? PatrolStatus.ACTIVE : PatrolStatus.DISABLED));
            default -> throw new ControllerException(ErrorCode.ERROR400.getCode(), "该实体不支持启停: " + entity);
        }
        return Map.of("enabled", on);
    }

    private void checkView(String entity) {
        if (!PatrolSecurityUtils.hasPerm(viewModule(entity), "view")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }

    private void checkEdit(String entity) {
        if (!PatrolSecurityUtils.hasPerm(editModule(entity), "edit")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }
}
