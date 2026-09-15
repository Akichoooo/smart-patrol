package com.genersoft.iot.vmp.patrol.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * MDC 过滤器：为每个请求生成 traceId，并写入当前用户 userId，
 * 使 Logback 日志与 patrol_audit_log 可通过 traceId 关联。
 * 说明：作为普通 Servlet Filter（@Component 自动注册，最高优先级，先于 Security 链执行）。
 * logback pattern 已加 %X{traceId}。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class TraceIdMdcFilter extends OncePerRequestFilter {

    public static final String TRACE_ID = "traceId";
    public static final String USER_ID = "userId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String traceId = request.getHeader("X-Trace-Id");
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        }
        MDC.put(TRACE_ID, traceId);
        response.setHeader("X-Trace-Id", traceId);
        try {
            Integer uid = PatrolSecurityUtils.currentUserId();
            if (uid != null) {
                MDC.put(USER_ID, String.valueOf(uid));
            }
            chain.doFilter(request, response);
        } finally {
            MDC.remove(TRACE_ID);
            MDC.remove(USER_ID);
        }
    }
}
