package com.genersoft.iot.vmp.patrol.security;

import lombok.RequiredArgsConstructor;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 巡检平台 MVC 配置：注册 WVP 接口鉴权/审计拦截器。
 * 拦截 /api/** 但排除 /api/patrol/**（patrol 自身用 @PreAuthorize + @Audit）。
 */
@Configuration
@RequiredArgsConstructor
public class PatrolWebMvcConfig implements WebMvcConfigurer {

    private final UriPermInterceptor uriPermInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(uriPermInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/patrol/**", "/api/user/login", "/api/user/logout");
    }
}
