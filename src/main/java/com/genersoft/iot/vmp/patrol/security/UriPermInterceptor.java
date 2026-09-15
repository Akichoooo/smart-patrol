package com.genersoft.iot.vmp.patrol.security;

import com.genersoft.iot.vmp.patrol.security.PatrolUriPermissionMapper.UriPerm;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.servlet.HandlerInterceptor;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * WVP 老接口的统一鉴权 + 审计拦截器（按 patrol_uri_permission 映射表驱动，
 * 不改任何 WVP controller；映射加载后有本地缓存）。
 * <p>
 * 命中映射的请求：
 * - audit_only=1 → 只记审计，不拦截；
 * - audit_only=0 → 先校验 模块:操作 权限，摄像头相关接口还做功能级校验（如 ptz），无权限返回 403。
 * 同时对登录/登出与 403 越权记录审计。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class UriPermInterceptor implements HandlerInterceptor {

    private static final AntPathMatcher MATCHER = new AntPathMatcher();

    private volatile List<UriPerm> cache = Collections.emptyList();

    private final PatrolUriPermissionMapper uriPermissionMapper;

    private final PatrolAuditLogMapper auditLogMapper;

    /** 供管理接口在映射表变更后刷新 */
    public void reloadCache() {
        try {
            this.cache = new ArrayList<>(uriPermissionMapper.selectAll());
            log.info("[Patrol鉴权] URI映射已加载 {} 条", cache.size());
        } catch (Exception e) {
            this.cache = Collections.emptyList();
            log.warn("[Patrol鉴权] URI映射加载失败，鉴权降级为放行: {}", e.getMessage());
        }
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String uri = request.getRequestURI();
        String method = request.getMethod();

        // 登录接口审计（成功/失败由 UserController 决定，这里先记尝试）
        if ("/api/user/login".equalsIgnoreCase(uri)) {
            // 登录结果审计放在登录成功/失败后：简单方案是在这里异步不记，成功由 AuthController 补充
            return true;
        }
        if ("/api/user/logout".equalsIgnoreCase(uri)) {
            writeAudit(request, "settings.security", "logout", "SUCCESS", null, 0);
            return true;
        }

        if (cache.isEmpty() && uriPermissionMapper != null) {
            synchronized (this) {
                if (cache.isEmpty()) {
                    reloadCache();
                }
            }
        }

        for (UriPerm perm : cache) {
            if (!MATCHER.match(perm.getUriPattern(), uri)) {
                continue;
            }
            if (!"ANY".equalsIgnoreCase(perm.getHttpMethod()) && !method.equalsIgnoreCase(perm.getHttpMethod())) {
                continue;
            }
            long start = System.currentTimeMillis();
            boolean allowed = perm.isAuditOnly() || PatrolSecurityUtils.hasPerm(perm.getModule(), perm.getAction());
            // 摄像头功能级：ptz 类接口要求 CH_PTZ / CH_PRESET 等功能权限
            if (allowed && perm.getChannelParam() != null && !perm.isAuditOnly()) {
                allowed = checkChannelFunc(perm, request, uri);
            }
            if (!allowed) {
                response.setStatus(HttpStatus.FORBIDDEN.value());
                writeAudit(request, perm.getModule(), perm.getAction(), "DENIED", "无权限: " + perm.getModule() + ":" + perm.getAction(),
                        System.currentTimeMillis() - start);
                return false;
            }
            // 写类型操作审计（GET 查询类不记，避免日志爆炸）
            if (!"GET".equalsIgnoreCase(method)) {
                writeAudit(request, perm.getModule(), perm.getAction(), "SUCCESS", null, System.currentTimeMillis() - start);
            }
            return true;
        }
        return true;
    }

    /** 摄像头功能级校验：模块 action=view→CH_VIEW, ptz→CH_PTZ, preset→CH_PRESET 等 */
    private boolean checkChannelFunc(UriPerm perm, HttpServletRequest request, String uri) {
        String func = switch (perm.getAction()) {
            case "ptz" -> PatrolPermission.CH_PTZ;
            case "preset" -> PatrolPermission.CH_PRESET;
            case "playback" -> PatrolPermission.CH_PLAYBACK;
            case "download" -> PatrolPermission.CH_DOWNLOAD;
            case "snapshot" -> PatrolPermission.CH_SNAPSHOT;
            default -> PatrolPermission.CH_VIEW;
        };
        return PatrolSecurityUtils.hasChannelFunc(func);
    }

    private void writeAudit(HttpServletRequest request, String module, String action, String result, String error, long cost) {
        try {
            PatrolAuditLogBean bean = new PatrolAuditLogBean();
            bean.setModule(module);
            bean.setAction(action);
            bean.setHttpMethod(request.getMethod());
            bean.setUri(request.getRequestURI());
            bean.setIp(AuditAspect.clientIp(request));
            bean.setUserAgent(AuditAspect.abbreviate(request.getHeader("User-Agent"), 250));
            bean.setResult(result);
            bean.setErrorMsg(error);
            bean.setTraceId(MDC.get("traceId"));
            bean.setDurationMs(cost);
            bean.setParamsJson(AuditAspect.sanitize(paramsJson(request)));
            User user = PatrolSecurityUtils.currentUser();
            if (user != null) {
                bean.setUserId(user.getId());
                bean.setUsername(user.getUsername());
            }
            auditLogMapper.insert(bean);
        } catch (Exception e) {
            log.warn("[审计] 拦截器写入失败: {}", e.getMessage());
        }
    }

    private String paramsJson(HttpServletRequest request) {
        try {
            JSONObjectWrapper w = new JSONObjectWrapper();
            request.getParameterMap().forEach((k, v) -> {
                if (v != null && v.length > 0) {
                    w.put(k, String.join(",", v));
                }
            });
            return w.toJson();
        } catch (Exception e) {
            return "{}";
        }
    }

    /** 简单包装避免在拦截器里引入 fastjson 依赖细节 */
    static class JSONObjectWrapper {
        private final java.util.Map<String, String> map = new java.util.LinkedHashMap<>();

        void put(String k, String v) {
            map.put(k, v);
        }

        String toJson() {
            return com.alibaba.fastjson2.JSONObject.toJSONString(map);
        }
    }
}
