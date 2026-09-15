package com.genersoft.iot.vmp.patrol.security;

import com.genersoft.iot.vmp.storager.dao.dto.User;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Collection;
import java.util.Collections;
import java.util.Set;

/**
 * 巡检平台权限判断工具（供 AOP / 服务层使用，判断均基于 SecurityContext 的 GrantedAuthority）
 */
@Slf4j
public final class PatrolSecurityUtils {

    private PatrolSecurityUtils() {
    }

    /** 取当前登录用户（principal 为 WVP User） */
    public static User currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof User user) {
            return user;
        }
        return null;
    }

    public static Integer currentUserId() {
        User u = currentUser();
        return u == null ? null : u.getId();
    }

    public static String currentUsername() {
        User u = currentUser();
        return u == null ? null : u.getUsername();
    }

    /** 是否超级管理员（roleId == 1，全权限兜底） */
    public static boolean isAdmin() {
        User u = currentUser();
        return u != null && u.getRole() != null && u.getRole().getId() == 1;
    }

    /** 判断当前用户是否具备 模块:操作 权限（admin 兜底） */
    public static boolean hasPerm(String module, String action) {
        if (isAdmin()) {
            return true;
        }
        return hasAuthority(PatrolPermission.perm(module, action));
    }

    /** 判断摄像头功能级权限（admin 兜底；空 principal 视为匿名拒绝） */
    public static boolean hasChannelFunc(String func) {
        if (isAdmin()) {
            return true;
        }
        return hasAuthority(PatrolPermission.channelPerm(func));
    }

    private static boolean hasAuthority(String code) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null) {
            return false;
        }
        Collection<? extends GrantedAuthority> authorities = auth.getAuthorities();
        if (authorities == null) {
            return false;
        }
        for (GrantedAuthority a : authorities) {
            if (code.equals(a.getAuthority())) {
                return true;
            }
        }
        return false;
    }

    /** 当前用户全部 authority 集合 */
    public static Set<String> authorities() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getAuthorities() == null) {
            return Collections.emptySet();
        }
        return auth.getAuthorities().stream().map(GrantedAuthority::getAuthority)
                .collect(java.util.stream.Collectors.toSet());
    }
}
