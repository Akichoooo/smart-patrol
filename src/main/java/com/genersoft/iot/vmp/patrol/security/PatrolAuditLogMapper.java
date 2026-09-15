package com.genersoft.iot.vmp.patrol.security;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Param;
import org.springframework.stereotype.Repository;

/**
 * 操作审计 Mapper（查询走 PageHelper 分页）
 */
@Mapper
@Repository
public interface PatrolAuditLogMapper {

    @Insert("INSERT INTO patrol_audit_log (user_id, username, module, action, target_type, target_id, target_name, " +
            "http_method, uri, params_json, ip, user_agent, result, error_msg, trace_id, duration_ms) VALUES " +
            "(#{userId}, #{username}, #{module}, #{action}, #{targetType}, #{targetId}, #{targetName}, " +
            "#{httpMethod}, #{uri}, #{paramsJson}, #{ip}, #{userAgent}, #{result}, #{errorMsg}, #{traceId}, #{durationMs})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(PatrolAuditLogBean bean);

    @Select("<script>SELECT id, user_id, username, module, action, target_type, target_id, target_name, " +
            "http_method, uri, params_json, ip, user_agent, result, error_msg, trace_id, duration_ms, created_at " +
            "FROM patrol_audit_log <where> " +
            "<if test='username != null and username != \"\"'> AND username LIKE CONCAT('%', #{username}, '%') </if>" +
            "<if test='module != null and module != \"\"'> AND module = #{module} </if>" +
            "<if test='result != null and result != \"\"'> AND result = #{result} </if>" +
            "<if test='startTime != null'> AND created_at &gt;= #{startTime} </if>" +
            "<if test='endTime != null'> AND created_at &lt;= #{endTime} </if>" +
            "</where> ORDER BY id DESC</script>")
    @Results({
            @Result(property = "userId", column = "user_id"),
            @Result(property = "targetType", column = "target_type"),
            @Result(property = "targetId", column = "target_id"),
            @Result(property = "targetName", column = "target_name"),
            @Result(property = "httpMethod", column = "http_method"),
            @Result(property = "paramsJson", column = "params_json"),
            @Result(property = "userAgent", column = "user_agent"),
            @Result(property = "errorMsg", column = "error_msg"),
            @Result(property = "traceId", column = "trace_id"),
            @Result(property = "durationMs", column = "duration_ms"),
            @Result(property = "createdAt", column = "created_at"),
    })
    java.util.List<PatrolAuditLogBean> list(@Param("username") String username, @Param("module") String module,
                                            @Param("result") String result, @Param("startTime") String startTime,
                                            @Param("endTime") String endTime);
}
