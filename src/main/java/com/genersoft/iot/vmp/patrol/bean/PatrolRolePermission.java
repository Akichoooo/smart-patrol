package com.genersoft.iot.vmp.patrol.bean;

import lombok.Data;

/**
 * 巡检平台权限相关值对象
 */
public class PatrolRolePermission {

    @Data
    public static class ChannelPerm {
        private Integer roleId;
        private Integer channelId;
        private Integer channelGroupId;
        private String funcsJson;
    }

    @Data
    public static class SaveRequest {
        /** role_id -> 模块权限列表 */
        private Integer roleId;
        private java.util.List<ModuleItem> modules;
        private String scopeType;
        private String scopeJson;
    }

    @Data
    public static class ModuleItem {
        private String module;
        private java.util.List<String> actions;
    }
}
