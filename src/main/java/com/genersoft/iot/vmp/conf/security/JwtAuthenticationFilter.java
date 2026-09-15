package com.genersoft.iot.vmp.conf.security;

import com.genersoft.iot.vmp.conf.UserSetting;
import com.genersoft.iot.vmp.conf.security.dto.JwtUser;
import com.genersoft.iot.vmp.patrol.security.PatrolAuthorityService;
import com.genersoft.iot.vmp.service.IUserService;
import com.genersoft.iot.vmp.storager.dao.dto.Role;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingRequestWrapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * jwt token 过滤器
 * <p>
 * 巡检平台改造（滑动续签 + RBAC 权限装配）：
 * 1. EXPIRING_SOON 时签发新 token 写入响应头 access-token（前端拦截器自动续期），
 *    为避免每请求都签发，剩余时间 < 有效期50% 时才续签（EXPIRING_SOON 判定已覆盖该窗口）。
 * 2. SecurityContext 的 authorities 从 patrol_role_permission 聚合，admin 全权限兜底。
 */
@Slf4j
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final static String WSHeader = "sec-websocket-protocol";


    @Autowired
    private UserSetting userSetting;

    @Autowired
    private IUserService userService;

    @Autowired(required = false)
    private PatrolAuthorityService patrolAuthorityService;


    @Override
    protected void doFilterInternal(HttpServletRequest servletRequest, HttpServletResponse response, FilterChain chain) throws IOException, ServletException {
        ContentCachingRequestWrapper request = new ContentCachingRequestWrapper(servletRequest);
        // 忽略登录请求的token验证
        String requestURI = request.getRequestURI();
        if ((requestURI.startsWith("/doc.html") || requestURI.startsWith("/swagger-ui")  ) && !userSetting.getDocEnable()) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }

        if (requestURI.equalsIgnoreCase("/api/user/login")) {
            chain.doFilter(request, response);
            return;
        }

        if (!userSetting.getInterfaceAuthentication()) {
            UsernamePasswordAuthenticationToken token = new UsernamePasswordAuthenticationToken(null, null, new ArrayList<>() );
            SecurityContextHolder.getContext().setAuthentication(token);
            chain.doFilter(request, response);
            return;
        }

        String jwt = request.getHeader(JwtUtils.getHeader());
        // 这里如果没有jwt，继续往后走，因为后面还有鉴权管理器等去判断是否拥有身份凭证，所以是可以放行的
        // 没有jwt相当于匿名访问，若有一些接口是需要权限的，则不能访问这些接口

        // websocket 鉴权信息默认存储在这里
        String secWebsocketProtocolHeader = request.getHeader(WSHeader);
        if (StringUtils.isBlank(jwt)) {

            if (secWebsocketProtocolHeader != null) {
                jwt = secWebsocketProtocolHeader;
                response.setHeader(WSHeader, secWebsocketProtocolHeader);
            }else {
                jwt = request.getParameter(JwtUtils.getHeader());
            }
            if (StringUtils.isBlank(jwt)) {
                jwt = request.getHeader(JwtUtils.getApiKeyHeader());
                if (StringUtils.isBlank(jwt)) {
                    chain.doFilter(request, response);
                    return;
                }
            }
        }

        JwtUser jwtUser = JwtUtils.verifyToken(jwt);
        String username = jwtUser.getUserName();
        switch (jwtUser.getStatus()){
            case EXPIRED:
                response.setStatus(401);
                chain.doFilter(request, response);
                // 异常
                return;
            case EXCEPTION:
                // 过期
                response.setStatus(400);
                chain.doFilter(request, response);
                return;
            case EXPIRING_SOON:
                // 滑动续签：下发新 token 到响应头，前端拦截器读取后更新本地 token。
                // 本请求继续用旧 token 完成（旧 token 在有效期内仍可验证），后续请求使用新 token。
                try {
                    String renewed = JwtUtils.createToken(username);
                    if (renewed != null) {
                        response.setHeader(JwtUtils.getHeader(), renewed);
                    }
                } catch (Exception e) {
                    log.warn("[Token续签] 签发失败: {}", e.getMessage());
                }
                break;
            default:
        }
        // 构建UsernamePasswordAuthenticationToken,这里密码为null，是因为提供了正确的JWT,实现自动登录
        User user = new User();
        user.setId(jwtUser.getUserId());
        user.setUsername(jwtUser.getUserName());
        user.setPassword(jwtUser.getPassword());
        Role role = new Role();
        role.setId(jwtUser.getRoleId());
        user.setRole(role);

        // 加载真实用户（含 defaultPassword），用于默认密码访问限制
        User dbUser = userService.getUserById(jwtUser.getUserId());
        user.setDefaultPassword(dbUser != null && dbUser.isDefaultPassword());

        // 默认密码用户：仅允许修改密码与登出接口
        if (user.isDefaultPassword()) {
            if (!requestURI.equalsIgnoreCase("/api/user/changePassword")
                    && !requestURI.equalsIgnoreCase("/api/user/logout")) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                return;
            }
        }

        UsernamePasswordAuthenticationToken token = new UsernamePasswordAuthenticationToken(user, jwtUser.getPassword(), loadAuthorities(user.getRole().getId()) );
        SecurityContextHolder.getContext().setAuthentication(token);
        chain.doFilter(request, response);
    }

    /** 巡检平台 RBAC：聚合角色权限；未启用 patrol 模块时退化为空列表（兼容原行为） */
    private List<GrantedAuthority> loadAuthorities(int roleId) {
        if (patrolAuthorityService != null) {
            try {
                return patrolAuthorityService.loadAuthorities(roleId);
            } catch (Exception e) {
                log.warn("[Patrol权限] 聚合角色{}权限失败: {}", roleId, e.getMessage());
            }
        }
        return new ArrayList<>();
    }
}
