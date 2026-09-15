package com.genersoft.iot.vmp.patrol.security;

import lombok.Data;

/**
 * 操作审计日志实体
 */
@Data
public class PatrolAuditLogBean {
    private Long id;
    private Integer userId;
    private String username;
    private String module;
    private String action;
    private String targetType;
    private String targetId;
    private String targetName;
    private String httpMethod;
    private String uri;
    private String paramsJson;
    private String ip;
    private String userAgent;
    /** SUCCESS / FAIL / DENIED */
    private String result;
    private String errorMsg;
    private String traceId;
    private Long durationMs;
    private String createdAt;
}
