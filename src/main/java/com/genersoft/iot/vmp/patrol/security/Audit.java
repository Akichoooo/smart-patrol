package com.genersoft.iot.vmp.patrol.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作审计注解：标注在 patrol 模块 controller 方法上，由 AuditAspect 切面落库。
 * WVP 老接口不走此注解，由 UriPermInterceptor 按 patrol_uri_permission 白名单记录。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Audit {
    /** 模块，如 patrol.task */
    String module();
    /** 动作，如 execute / create / edit / delete */
    String action();
    /** 目标类型（可选） */
    String targetType() default "";
}
