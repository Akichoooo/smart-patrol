package com.genersoft.iot.vmp.patrol.security;

import org.apache.ibatis.annotations.*;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * WVP 接口 URI→权限映射 Mapper（保护 WVP 老接口，不改其 controller）
 */
@Mapper
@Repository
public interface PatrolUriPermissionMapper {

    class UriPerm {
        private String uriPattern;
        private String httpMethod;
        private String module;
        private String action;
        private String channelParam;
        private boolean auditOnly;

        public String getUriPattern() { return uriPattern; }
        public void setUriPattern(String v) { this.uriPattern = v; }
        public String getHttpMethod() { return httpMethod; }
        public void setHttpMethod(String v) { this.httpMethod = v; }
        public String getModule() { return module; }
        public void setModule(String v) { this.module = v; }
        public String getAction() { return action; }
        public void setAction(String v) { this.action = v; }
        public String getChannelParam() { return channelParam; }
        public void setChannelParam(String v) { this.channelParam = v; }
        public boolean isAuditOnly() { return auditOnly; }
        public void setAuditOnly(boolean v) { this.auditOnly = v; }
    }

    /** 全表（启动时全量加载缓存，变更后手动失效） */
    @Select("SELECT uri_pattern, http_method, module, action, channel_param, audit_only FROM patrol_uri_permission")
    List<UriPerm> listAll();

    @Select("SELECT uri_pattern, http_method, module, action, channel_param, audit_only FROM patrol_uri_permission")
    @Results({
            @Result(property = "uriPattern", column = "uri_pattern"),
            @Result(property = "httpMethod", column = "http_method"),
            @Result(property = "channelParam", column = "channel_param"),
            @Result(property = "auditOnly", column = "audit_only"),
    })
    List<UriPerm> selectAll();

    @Insert("INSERT INTO patrol_uri_permission (uri_pattern, http_method, module, action, channel_param, audit_only) VALUES " +
            "(#{uriPattern}, #{httpMethod}, #{module}, #{action}, #{channelParam}, #{auditOnly})")
    int insert(UriPerm perm);

    @Delete("DELETE FROM patrol_uri_permission WHERE uri_pattern = #{uriPattern}")
    int deleteByPattern(@Param("uriPattern") String uriPattern);
}
