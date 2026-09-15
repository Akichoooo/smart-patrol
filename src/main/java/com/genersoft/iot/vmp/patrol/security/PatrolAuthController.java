package com.genersoft.iot.vmp.patrol.security;

import com.genersoft.iot.vmp.conf.UserSetting;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.conf.security.JwtUtils;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.DigestUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 巡检平台认证/授权接口：
 * - GET  /api/patrol/auth/me  下发当前用户权限（模块/操作/数据范围/摄像头功能级）
 * - POST /api/patrol/auth/refresh  显式续签（凭当前有效 token 换新）
 * - POST /api/patrol/auth/login-audit  登录结果审计（登录成功/失败由前端在 login 后回调，落审计表）
 */
@Tag(name = "巡检平台-认证与授权")
@RestController
@RequestMapping("/api/patrol/auth")
@RequiredArgsConstructor
public class PatrolAuthController {

    private final UserSetting userSetting;

    private final PatrolAuthorityService authorityService;

    private final PatrolRolePermissionMapper rolePermissionMapper;

    private final PatrolAuditLogMapper auditLogMapper;

    @Data
    public static class MeResponse {
        private Integer userId;
        private String username;
        private Integer roleId;
        private boolean admin;
        /** 有权可见的模块编码列表（菜单树用） */
        private List<String> modules;
        /** module -> actions 映射（按钮级 hasPermission 用） */
        private Map<String, List<String>> actions;
        /** 数据权限：scopeType + ids */
        private String scopeType;
        private Set<String> scopeIds;
        /** 摄像头功能级权限（全局功能集合；通道级明细另查） */
        private Set<String> channelFuncs;
        /** token 剩余有效时间（分钟） */
        private Long loginTimeoutMinutes;
    }

    @GetMapping("/me")
    @Operation(summary = "当前登录用户权限信息")
    public MeResponse me(HttpServletRequest request) {
        User user = PatrolSecurityUtils.currentUser();
        if (user == null) {
            throw new ControllerException(ErrorCode.ERROR100);
        }
        MeResponse resp = new MeResponse();
        resp.setUserId(user.getId());
        resp.setUsername(user.getUsername());
        boolean admin = user.getRole() != null && user.getRole().getId() == 1;
        resp.setAdmin(admin);
        resp.setLoginTimeoutMinutes(userSetting.getLoginTimeout());

        // 聚合模块与操作
        List<String> modules = new ArrayList<>();
        Map<String, List<String>> actions = new HashMap<>();
        int roleId = user.getRole() == null ? 0 : user.getRole().getId();
        if (admin) {
            // admin 全权限兜底
            for (String[] ma : ALL_MODULES) {
                modules.add(ma[0]);
                actions.put(ma[0], List.of("view", "create", "edit", "delete", "execute", "export", "review", "confirm"));
            }
            resp.setChannelFuncs(new HashSet<>(List.of(
                    PatrolPermission.CH_VIEW, PatrolPermission.CH_PTZ, PatrolPermission.CH_PRESET,
                    PatrolPermission.CH_PLAYBACK, PatrolPermission.CH_DOWNLOAD, PatrolPermission.CH_SNAPSHOT,
                    PatrolPermission.CH_TALK, PatrolPermission.CH_RECORD)));
        } else {
            try {
                for (PatrolRolePermissionMapper.ModuleActions ma : rolePermissionMapper.listByRoleId(roleId)) {
                    modules.add(ma.getModule());
                    Set<String> acts = new HashSet<>();
                    try {
                        com.alibaba.fastjson2.JSONArray arr = com.alibaba.fastjson2.JSONArray.parseArray(ma.getActionsJson());
                        for (Object o : arr) {
                            acts.add(String.valueOf(o));
                        }
                    } catch (Exception ignore) {
                        acts.add("view");
                    }
                    actions.put(ma.getModule(), new ArrayList<>(acts));
                }
            } catch (Exception ignore) {
            }
            try {
                List<String> funcs = rolePermissionMapper.listChannelFuncs(roleId);
                resp.setChannelFuncs(funcs == null ? new HashSet<>() : new HashSet<>(funcs));
            } catch (Exception ignore) {
                resp.setChannelFuncs(new HashSet<>());
            }
        }
        resp.setModules(modules);
        resp.setActions(actions);

        // 数据权限
        try {
            List<PatrolRolePermissionMapper.ScopeRow> scopes = rolePermissionMapper.listDataScope(roleId);
            for (PatrolRolePermissionMapper.ScopeRow s : scopes) {
                if ("ALL".equalsIgnoreCase(s.getScopeType()) || admin) {
                    resp.setScopeType("ALL");
                    resp.setScopeIds(new HashSet<>());
                    break;
                }
                resp.setScopeType(s.getScopeType());
                Set<String> ids = new HashSet<>();
                try {
                    com.alibaba.fastjson2.JSONArray arr = com.alibaba.fastjson2.JSONArray.parseArray(s.getScopeJson());
                    for (Object o : arr) {
                        ids.add(String.valueOf(o));
                    }
                } catch (Exception ignore) {
                }
                resp.setScopeIds(ids);
            }
            if (resp.getScopeType() == null) {
                resp.setScopeType(admin ? "ALL" : "NONE");
            }
        } catch (Exception ignore) {
            resp.setScopeType(admin ? "ALL" : "NONE");
        }
        return resp;
    }

    @PostMapping("/refresh")
    @Operation(summary = "显式续签 token（凭当前有效 token 换新）")
    public Map<String, String> refresh(HttpServletResponse response,
                                       @RequestHeader(value = JwtUtils.HEADER, required = false) String token) {
        User user = PatrolSecurityUtils.currentUser();
        if (user == null) {
            throw new ControllerException(ErrorCode.ERROR100);
        }
        String jwt = JwtUtils.createToken(user.getUsername());
        response.setHeader(JwtUtils.HEADER, jwt);
        Map<String, String> result = new HashMap<>();
        result.put("token", jwt);
        return result;
    }

    /**
     * 登录结果审计：登录成功/失败由前端在调用 /api/user/login 后回调一次。
     * （/api/user/login 在 SecurityConfig 中 permitAll，无法走拦截器，采用前端回调方案）
     */
    @PostMapping("/login-audit")
    @Operation(summary = "登录结果审计回调")
    public void loginAudit(@RequestHeader(value = "X-Login-Result", defaultValue = "SUCCESS") String loginResult,
                           @RequestHeader(value = "X-Login-Username", defaultValue = "") String username,
                           HttpServletRequest request) {
        try {
            PatrolAuditLogBean bean = new PatrolAuditLogBean();
            bean.setUsername(username);
            bean.setModule("settings.security");
            bean.setAction("login");
            bean.setHttpMethod(request.getMethod());
            bean.setUri("/api/user/login");
            bean.setIp(AuditAspect.clientIp(request));
            bean.setUserAgent(AuditAspect.abbreviate(request.getHeader("User-Agent"), 250));
            bean.setResult("FAIL".equalsIgnoreCase(loginResult) ? "FAIL" : "SUCCESS");
            bean.setTraceId(MDC.get("traceId"));
            bean.setDurationMs(0L);
            User cur = PatrolSecurityUtils.currentUser();
            if (cur != null) {
                bean.setUserId(cur.getId());
            }
            auditLogMapper.insert(bean);
        } catch (Exception ignore) {
        }
    }

    /** 全模块清单（admin 展开用） */
    private static final String[][] ALL_MODULES = {
            {PatrolPermission.MODULE_OVERVIEW, "总览"},
            {PatrolPermission.MODULE_MONITOR_VIDEO, "视频监控"},
            {PatrolPermission.MODULE_MONITOR_ROBOT, "机器人监控"},
            {PatrolPermission.MODULE_MONITOR_DRONE, "无人机监控"},
            {PatrolPermission.MODULE_MONITOR_PLAYBACK, "录像回放"},
            {PatrolPermission.MODULE_PATROL_TASK, "巡检任务"},
            {PatrolPermission.MODULE_PATROL_EXECUTION, "任务执行"},
            {PatrolPermission.MODULE_PATROL_RESULT, "巡检结果"},
            {PatrolPermission.MODULE_PATROL_REPORT, "任务报告"},
            {PatrolPermission.MODULE_PATROL_ALARM, "告警管理"},
            {PatrolPermission.MODULE_PATROL_STATS, "查询统计"},
            {PatrolPermission.MODULE_SETTINGS_SECURITY, "设置-账号与安全"},
            {PatrolPermission.MODULE_SETTINGS_ACCESS, "设置-设备接入"},
            {PatrolPermission.MODULE_SETTINGS_MEDIA, "设置-媒体与级联"},
            {PatrolPermission.MODULE_SETTINGS_ORG, "设置-组织与地图"},
            {PatrolPermission.MODULE_SETTINGS_ASSET, "设置-机器人与装备"},
            {PatrolPermission.MODULE_SETTINGS_AI, "设置-智能算法"},
            {PatrolPermission.MODULE_SETTINGS_PATROL, "设置-巡视配置"},
            {PatrolPermission.MODULE_SETTINGS_SYSTEM, "设置-系统"},
    };
}
