package com.genersoft.iot.vmp.patrol.security;

import lombok.RequiredArgsConstructor;

import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.bean.PatrolRolePermission;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 巡检平台角色权限管理（设置 → 账号与安全 → 角色与权限）：
 * - GET  /api/patrol/role-permission/{roleId}  查询角色权限
 * - POST /api/patrol/role-permission/save      保存(模块+数据范围)
 * - POST /api/patrol/role-permission/channel   保存摄像头功能级权限
 */
@Tag(name = "巡检平台-角色权限管理")
@RestController
@RequestMapping("/api/patrol/role-permission")
@RequiredArgsConstructor
public class PatrolRolePermissionController {

    private final PatrolRolePermissionMapper mapper;

    @Autowired(required = false)
    private CacheManager cacheManager;

    private final UriPermInterceptor uriPermInterceptor;

    private void evict(int roleId) {
        if (cacheManager != null) {
            Cache cache = cacheManager.getCache(PatrolAuthorityService.CACHE_KEY);
            if (cache != null) {
                cache.evictIfPresent(roleId);
            }
        }
    }

    @GetMapping("/{roleId}")
    @Operation(summary = "查询角色权限(模块/数据范围/摄像头功能)")
    public Map<String, Object> get(@PathVariable int roleId) {
        Map<String, Object> result = new HashMap<>();
        List<PatrolRolePermissionMapper.ModuleActions> perms = mapper.listByRoleId(roleId);
        result.put("modules", perms);
        result.put("scopes", mapper.listDataScope(roleId));
        List<String> funcs = mapper.listChannelFuncs(roleId);
        result.put("channelFuncs", funcs);
        // URI 映射表（供审计规则查看）
        result.put("uriPerms", uriPermInterceptor != null ? List.of() : List.of());
        return result;
    }

    @PostMapping("/save")
    @Transactional
    @Audit(module = "settings.security", action = "edit", targetType = "角色权限")
    @Operation(summary = "保存角色模块权限与数据范围")
    public void save(@RequestBody PatrolRolePermission.SaveRequest req) {
        if (req.getRoleId() == null) {
            throw new ControllerException(ErrorCode.ERROR400);
        }
        if (!PatrolSecurityUtils.hasPerm("settings.security", "edit")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        // 模块权限：先清后插
        mapper.clearModuleActions(req.getRoleId());
        if (req.getModules() != null) {
            for (PatrolRolePermission.ModuleItem item : req.getModules()) {
                JSONArray arr = new JSONArray();
                if (item.getActions() != null) {
                    item.getActions().forEach(arr::add);
                }
                mapper.upsertModuleActions(req.getRoleId(), item.getModule(), arr.toJSONString());
            }
        }
        // 数据范围
        if (req.getScopeType() != null) {
            String scopeJson = req.getScopeJson() == null ? "[]" : req.getScopeJson();
            mapper.upsertDataScope(req.getRoleId(), req.getScopeType(), scopeJson);
        }
        evict(req.getRoleId());
    }

    @PostMapping("/channel")
    @Transactional
    @Audit(module = "settings.security", action = "edit", targetType = "摄像头权限")
    @Operation(summary = "保存角色对某通道的功能级权限")
    public void saveChannel(@RequestBody PatrolRolePermission.ChannelPerm perm) {
        if (perm.getRoleId() == null || (perm.getChannelId() == null && perm.getChannelGroupId() == null)) {
            throw new ControllerException(ErrorCode.ERROR400);
        }
        if (!PatrolSecurityUtils.hasPerm("settings.security", "edit")) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
        // 同一通道先删后插
        mapper.deleteChannelPerm(perm.getRoleId(), perm.getChannelId());
        mapper.insertChannelPerm(perm);
        evict(perm.getRoleId());
    }

    /** 角色可选模块清单（前端勾选树用） */
    @GetMapping("/modules")
    @Operation(summary = "权限模块清单")
    public List<JSONObject> modules() {
        return List.of(
                moduleNode(PatrolPermission.MODULE_OVERVIEW, "信息总览", "view"),
                moduleNode(PatrolPermission.MODULE_MONITOR_VIDEO, "视频监控", "view,ptz,preset,snapshot,download"),
                moduleNode(PatrolPermission.MODULE_MONITOR_ROBOT, "机器人监控", "view,ptz,execute"),
                moduleNode(PatrolPermission.MODULE_MONITOR_DRONE, "无人机监控", "view,execute"),
                moduleNode(PatrolPermission.MODULE_MONITOR_PLAYBACK, "录像回放", "view,download"),
                moduleNode(PatrolPermission.MODULE_PATROL_TASK, "巡检任务", "view,create,edit,delete,execute,export"),
                moduleNode(PatrolPermission.MODULE_PATROL_EXECUTION, "任务执行", "view,execute"),
                moduleNode(PatrolPermission.MODULE_PATROL_RESULT, "巡检结果", "view,review,export"),
                moduleNode(PatrolPermission.MODULE_PATROL_REPORT, "任务报告", "view,export,review"),
                moduleNode(PatrolPermission.MODULE_PATROL_ALARM, "告警管理", "view,confirm,review,export"),
                moduleNode(PatrolPermission.MODULE_PATROL_STATS, "查询统计", "view,export"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_SECURITY, "账号与安全", "view,create,edit,delete,export"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_ACCESS, "设备接入", "view,create,edit,delete"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_MEDIA, "媒体与级联", "view,create,edit,delete"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_ORG, "组织与地图", "view,create,edit,delete"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_ASSET, "机器人与装备", "view,create,edit,delete"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_AI, "智能算法", "view,create,edit,delete,execute"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_PATROL, "巡视配置", "view,create,edit,delete"),
                moduleNode(PatrolPermission.MODULE_SETTINGS_SYSTEM, "系统", "view"));
    }

    private JSONObject moduleNode(String code, String name, String actions) {
        JSONObject o = new JSONObject();
        o.put("code", code);
        o.put("name", name);
        JSONArray arr = new JSONArray();
        for (String a : actions.split(",")) {
            arr.add(a);
        }
        o.put("actions", arr);
        return o;
    }
}
