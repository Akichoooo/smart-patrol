package com.genersoft.iot.vmp.patrol.security;

import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import java.util.Set;

/**
 * 操作审计切面：拦截 @Audit 注解方法，成功/失败均落 patrol_audit_log。
 * 参数脱敏：password/token/apiKey/key/secret 相关字段一律移除。
 */
@Slf4j
@Aspect
@Component
@RequiredArgsConstructor
public class AuditAspect {

    private static final Set<String> SENSITIVE_KEYS = Set.of(
            "password", "oldpassword", "newpassword", "token", "accesstoken",
            "apikey", "api_key", "key", "secret", "authorization", "pushkey", "appkey", "secretkey");

    private final PatrolAuditLogMapper auditLogMapper;

    @Around("@annotation(audit)")
    public Object around(ProceedingJoinPoint pjp, Audit audit) throws Throwable {
        long start = System.currentTimeMillis();
        HttpServletRequest request = currentRequest();
        PatrolAuditLogBean bean = new PatrolAuditLogBean();
        bean.setModule(audit.module());
        bean.setAction(audit.action());
        bean.setTargetType(audit.targetType());
        if (request != null) {
            bean.setHttpMethod(request.getMethod());
            bean.setUri(request.getRequestURI());
            bean.setIp(clientIp(request));
            bean.setUserAgent(abbreviate(request.getHeader("User-Agent"), 250));
            bean.setParamsJson(sanitize(buildArgs(pjp)));
        }
        User user = PatrolSecurityUtils.currentUser();
        if (user != null) {
            bean.setUserId(user.getId());
            bean.setUsername(user.getUsername());
        }
        bean.setTraceId(MDC.get("traceId"));
        Object result;
        try {
            result = pjp.proceed();
            bean.setResult("SUCCESS");
            return result;
        } catch (Throwable t) {
            bean.setResult("FAIL");
            bean.setErrorMsg(abbreviate(t.getMessage(), 500));
            throw t;
        } finally {
            bean.setDurationMs(System.currentTimeMillis() - start);
            try {
                auditLogMapper.insert(bean);
            } catch (Exception e) {
                log.warn("[审计] 写入失败: {}", e.getMessage());
            }
        }
    }

    private String buildArgs(ProceedingJoinPoint pjp) {
        try {
            String[] names = ((MethodSignature) pjp.getSignature()).getParameterNames();
            Object[] values = pjp.getArgs();
            JSONObject json = new JSONObject();
            for (int i = 0; i < values.length; i++) {
                Object v = values[i];
                if (v instanceof MultipartFile f) {
                    json.put(names[i], f.getOriginalFilename());
                } else if (v != null && !(v instanceof HttpServletRequest)) {
                    json.put(names[i], abbreviate(String.valueOf(v), 300));
                }
            }
            return json.toJSONString();
        } catch (Exception e) {
            return "{}";
        }
    }

    static String sanitize(String json) {
        if (json == null) {
            return "{}";
        }
        try {
            JSONObject obj = JSONObject.parseObject(json);
            for (String k : obj.keySet().toArray(new String[0])) {
                if (SENSITIVE_KEYS.contains(k.toLowerCase())) {
                    obj.put(k, "***");
                }
            }
            return obj.toJSONString();
        } catch (Exception e) {
            return "{\"raw\":\"<unparsed>\"}";
        }
    }

    static String clientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip != null && !ip.isBlank()) {
            int idx = ip.indexOf(',');
            return idx > 0 ? ip.substring(0, idx).trim() : ip.trim();
        }
        return request.getRemoteAddr();
    }

    static String abbreviate(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }

    static HttpServletRequest currentRequest() {
        ServletRequestAttributes attrs = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs == null ? null : attrs.getRequest();
    }
}
