package com.genersoft.iot.vmp.patrol.security;

import org.apache.ibatis.annotations.*;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * 角色权限 Mapper（模块/操作 + 数据范围 + 摄像头功能级）
 */
@Mapper
@Repository
public interface PatrolRolePermissionMapper {

    /** module + actions 聚合行 */
    class ModuleActions {
        private String module;
        private String actionsJson;

        public String getModule() { return module; }
        public void setModule(String module) { this.module = module; }
        public String getActionsJson() { return actionsJson; }
        public void setActionsJson(String actionsJson) { this.actionsJson = actionsJson; }
    }

    /** 角色全部模块权限 */
    @Select("SELECT module, actions_json FROM patrol_role_permission WHERE role_id = #{roleId}")
    @Results({
            @Result(property = "module", column = "module"),
            @Result(property = "actionsJson", column = "actions_json"),
    })
    List<ModuleActions> listByRoleId(@Param("roleId") int roleId);

    /** 角色直接授予的摄像头功能（channel_id 与 channel_group_id 均为空的行=全通道生效） */
    @Select("SELECT DISTINCT jt.func FROM patrol_role_channel_permission p, " +
            "JSON_TABLE(p.funcs_json, '$[*]' COLUMNS (func VARCHAR(32) PATH '$')) jt " +
            "WHERE p.role_id = #{roleId} AND p.channel_id IS NULL AND p.channel_group_id IS NULL")
    List<String> listChannelFuncs(@Param("roleId") int roleId);

    /** 角色对指定通道授予的功能（按通道绑定；分组绑定待 WVP 分组表结构确认后扩展） */
    @Select("SELECT DISTINCT jt.func FROM patrol_role_channel_permission p, " +
            "JSON_TABLE(p.funcs_json, '$[*]' COLUMNS (func VARCHAR(32) PATH '$')) jt " +
            "WHERE p.role_id = #{roleId} AND p.channel_id = #{channelId}")
    List<String> listChannelFuncsByChannel(@Param("roleId") int roleId, @Param("channelId") int channelId);

    /** 角色数据权限范围行 */
    @Select("SELECT scope_type, scope_json FROM patrol_role_data_scope WHERE role_id = #{roleId}")
    @Results({
            @Result(property = "scopeType", column = "scope_type"),
            @Result(property = "scopeJson", column = "scope_json"),
    })
    List<ScopeRow> listDataScope(@Param("roleId") int roleId);

    class ScopeRow {
        private String scopeType;
        private String scopeJson;
        public String getScopeType() { return scopeType; }
        public void setScopeType(String scopeType) { this.scopeType = scopeType; }
        public String getScopeJson() { return scopeJson; }
        public void setScopeJson(String scopeJson) { this.scopeJson = scopeJson; }
    }

    @Insert("INSERT INTO patrol_role_permission (role_id, module, actions_json) VALUES (#{roleId}, #{module}, #{actionsJson}) " +
            "ON DUPLICATE KEY UPDATE actions_json = VALUES(actions_json)")
    int upsertModuleActions(@Param("roleId") int roleId, @Param("module") String module, @Param("actionsJson") String actionsJson);

    @Delete("DELETE FROM patrol_role_permission WHERE role_id = #{roleId} AND module = #{module}")
    int deleteModuleActions(@Param("roleId") int roleId, @Param("module") String module);

    @Insert("INSERT INTO patrol_role_data_scope (role_id, scope_type, scope_json) VALUES (#{roleId}, #{scopeType}, #{scopeJson}) " +
            "ON DUPLICATE KEY UPDATE scope_json = VALUES(scope_json)")
    int upsertDataScope(@Param("roleId") int roleId, @Param("scopeType") String scopeType, @Param("scopeJson") String scopeJson);

    @Insert("INSERT INTO patrol_role_channel_permission (role_id, channel_id, channel_group_id, funcs_json) VALUES " +
            "(#{roleId}, #{channelId}, #{channelGroupId}, #{funcsJson})")
    int insertChannelPerm(com.genersoft.iot.vmp.patrol.bean.PatrolRolePermission.ChannelPerm perm);

    @Delete("DELETE FROM patrol_role_channel_permission WHERE role_id = #{roleId} AND channel_id = #{channelId}")
    int deleteChannelPerm(@Param("roleId") int roleId, @Param("channelId") Integer channelId);

    /** 全量保存某角色的模块权限（先删后插） */
    @Delete("DELETE FROM patrol_role_permission WHERE role_id = #{roleId}")
    int clearModuleActions(@Param("roleId") int roleId);
}
