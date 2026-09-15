package com.genersoft.iot.vmp.conf.security;

import com.alibaba.excel.util.StringUtils;
import com.genersoft.iot.vmp.conf.security.dto.LoginUser;
import com.genersoft.iot.vmp.patrol.security.PatrolAuthorityService;
import com.genersoft.iot.vmp.service.IUserService;
import com.genersoft.iot.vmp.storager.dao.dto.User;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * 用户登录认证逻辑
 */
@Slf4j
@Component
public class DefaultUserDetailsServiceImpl implements UserDetailsService {

    @Autowired
    private IUserService userService;

    @Autowired(required = false)
    private PatrolAuthorityService patrolAuthorityService;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        if (StringUtils.isBlank(username)) {
            log.info("登录用户：{} 不存在", username);
            throw new UsernameNotFoundException("登录用户：" + username + " 不存在");
        }

        // 查出密码
        User user = userService.getUserByUsername(username);
        if (user == null) {
            log.info("登录用户：{} 不存在", username);
            throw new UsernameNotFoundException("登录用户：" + username + " 不存在");
        }
        String password = SecurityUtils.encryptPassword(user.getPassword());
        user.setPassword(password);
        LoginUser loginUser = new LoginUser(user, LocalDateTime.now());
        // 巡检平台 RBAC：登录时聚合真实权限到 GrantedAuthority
        if (user.getRole() != null && patrolAuthorityService != null) {
            loginUser.setAuthorities(patrolAuthorityService.loadAuthorities(user.getRole().getId()));
        }
        return loginUser;
    }
}
