package com.genersoft.iot.vmp.patrol.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.storager.dao.dto.Role;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 权限聚合服务：把角色的 模块权限 + 摄像头功能级权限 聚合为 GrantedAuthority 列表。
 * 登录/过滤器装配 SecurityContext 时调用；结果缓存(Redis)避免每请求查库。
 * admin(roleId==1) 由 PatrolSecurityUtils 兜底，不在此展开。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PatrolAuthorityService {

    public static final String CACHE_KEY = "patrol:auth";

    private final PatrolRolePermissionMapper rolePermissionMapper;

    /**
     * 聚合某角色的全部权限 authority（模块:操作 + 摄像头功能级）
     */
    @Cacheable(cacheNames = CACHE_KEY, key = "#roleId")
    public List<GrantedAuthority> loadAuthorities(int roleId) {
        List<GrantedAuthority> list = new ArrayList<>();
        list.add(new SimpleGrantedAuthority(PatrolPermission.role(roleId)));
        try {
            List<PatrolRolePermissionMapper.ModuleActions> perms = rolePermissionMapper.listByRoleId(roleId);
            if (perms != null) {
                for (PatrolRolePermissionMapper.ModuleActions ma : perms) {
                    for (String action : parseActions(ma.getActionsJson())) {
                        list.add(new SimpleGrantedAuthority(PatrolPermission.perm(ma.getModule(), action)));
                    }
                }
            }
            // 摄像头功能级：角色直接授予的功能
            List<String> funcs = rolePermissionMapper.listChannelFuncs(roleId);
            if (funcs != null) {
                for (String f : funcs) {
                    list.add(new SimpleGrantedAuthority(PatrolPermission.channelPerm(f)));
                }
            }
        } catch (Exception e) {
            log.warn("[Patrol权限] 加载角色{}权限失败: {}", roleId, e.getMessage());
        }
        return list;
    }

    private Set<String> parseActions(String actionsJson) {
        Set<String> set = new HashSet<>();
        try {
            JSONArray arr = JSONArray.parseArray(actionsJson);
            if (arr != null) {
                for (Object o : arr) {
                    set.add(String.valueOf(o));
                }
            }
        } catch (Exception ignore) {
            set.add("view");
        }
        return set;
    }

    /**
     * 角色对指定通道的功能级权限集合（admin 返回 null 表示全部允许）
     */
    public Set<String> channelFuncsFor(int roleId, int channelId) {
        Set<String> funcs = new HashSet<>();
        try {
            List<String> direct = rolePermissionMapper.listChannelFuncs(roleId);
            if (direct != null) {
                funcs.addAll(direct);
            }
            List<String> bound = rolePermissionMapper.listChannelFuncsByChannel(roleId, channelId);
            if (bound != null) {
                funcs.addAll(bound);
            }
        } catch (Exception e) {
            log.warn("[Patrol权限] 加载角色{}通道{}功能权限失败: {}", roleId, channelId, e.getMessage());
        }
        return funcs;
    }
}
