package com.genersoft.iot.vmp.patrol.dao;

import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

/**
 * patrol 通用 CRUD Mapper：小实体表（装备/点位/算法/模型/提示词/知识库/方案/检修区域/字典）
 * 列名与表名在 Service 层通过白名单约束，防注入。
 */
@Mapper
public interface PatrolGenericMapper {

    @Select("SELECT * FROM ${table} ORDER BY id DESC")
    List<Map<String, Object>> listAll(@Param("table") String table);

    @Select("SELECT * FROM ${table} WHERE id = #{id}")
    Map<String, Object> getOne(@Param("table") String table, @Param("id") int id);

    @Select("SELECT * FROM ${table} WHERE type = #{type} ORDER BY id DESC")
    List<Map<String, Object>> listByType(@Param("table") String table, @Param("type") String type);

    @Select("SELECT * FROM ${table} WHERE kb_id = #{kbId} ORDER BY id DESC")
    List<Map<String, Object>> listByKbId(@Param("table") String table, @Param("kbId") int kbId);

    /**
     * 动态插入（列白名单校验在 Service 层）
     */
    @Insert("<script>INSERT INTO ${table} (${cols}) VALUES (${vals})</script>")
    @Options(useGeneratedKeys = true, keyProperty = "id.id", keyColumn = "id")
    int insert(@Param("table") String table, @Param("cols") String cols, @Param("vals") String vals, @Param("id") Map<String, Object> idHolder);

    /**
     * 动态更新：SET 片段由 Service 拼（白名单列）
     */
    @Update("UPDATE ${table} SET ${sets} WHERE id = #{id}")
    int update(@Param("table") String table, @Param("sets") String sets, @Param("id") int id);

    @Delete("DELETE FROM ${table} WHERE id = #{id}")
    int delete(@Param("table") String table, @Param("id") int id);

    @Select("SELECT COUNT(*) FROM ${table} WHERE enabled = 1")
    int countEnabled(@Param("table") String table);

    /**
     * 该表可空列名（小写）。用于把"空串"安全地解释为 NULL 时避开 NOT NULL 列
     * （把 NOT NULL 文本列写成 NULL 会直接抛 SQLIntegrityConstraintViolationException）。
     */
    @Select("SELECT LOWER(column_name) FROM information_schema.columns "
            + "WHERE table_schema = DATABASE() AND table_name = #{table} AND is_nullable = 'YES'")
    List<String> nullableColumns(@Param("table") String table);

    /** 该表全部列名（小写）。用于保存时跳过不存在的列，避免 Unknown column 直接 500。 */
    @Select("SELECT LOWER(column_name) FROM information_schema.columns "
            + "WHERE table_schema = DATABASE() AND table_name = #{table}")
    List<String> allColumns(@Param("table") String table);
}
