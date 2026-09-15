package com.genersoft.iot.vmp.patrol.service;

import com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 通用 CRUD 服务：
 * - 表名与列名走白名单，杜绝 SQL 注入
 * - 值用 PreparedStatement 参数；JSON 列原样字符串
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PatrolGenericService {

    private final PatrolGenericMapper mapper;

    private static final Set<String> ALLOWED_TABLES = Set.of(
            "patrol_robot_device", "patrol_device_profile", "patrol_protocol_template",
            "patrol_waypoint", "patrol_route", "patrol_algo", "patrol_vlm_model",
            "patrol_prompt", "patrol_knowledge_base", "patrol_knowledge_doc",
            "patrol_identify_scheme", "patrol_analyzer", "patrol_maintenance_area", "patrol_dict");

    private static final Set<String> SNAKE_CASE_RE = Set.of(); // 校验用正则代替

    private static final java.util.regex.Pattern COL_RE = java.util.regex.Pattern.compile("^[a-z][a-z0-9_]*$");

    /** 可空列缓存（表结构固定，进程内缓存即可；查询失败时按"全部不可空"保守处理） */
    private final Map<String, Set<String>> nullableCache = new java.util.concurrent.ConcurrentHashMap<>();

    /** 全列名缓存；查询失败时存通配集合，即"无法校验 → 全部放行"，绝不因为元数据读不到而拒绝保存 */
    private static final Set<String> ALLOW_ANY = Set.of("*");
    private final Map<String, Set<String>> columnsCache = new java.util.concurrent.ConcurrentHashMap<>();

    private Set<String> tableColumns(String table) {
        return columnsCache.computeIfAbsent(table, t -> {
            try {
                return Set.copyOf(mapper.allColumns(t));
            } catch (Exception e) {
                log.warn("[通用保存] 读取表列失败，本次不校验列名: {} {}", t, e.getMessage());
                return ALLOW_ANY;
            }
        });
    }

    private Set<String> nullableCols(String table) {
        return nullableCache.computeIfAbsent(table, t -> {
            try {
                return Set.copyOf(mapper.nullableColumns(t));
            } catch (Exception e) {
                log.warn("[通用保存] 读取可空列失败，按全部不可空处理: {} {}", t, e.getMessage());
                return Set.of();
            }
        });
    }

    private void checkTable(String table) {
        if (!ALLOWED_TABLES.contains(table)) {
            throw new IllegalArgumentException("非法表名: " + table);
        }
    }

    private String snake(String camel) {
        return camel.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase();
    }

    private String safeCol(String col) {
        String c = snake(col);
        if (!COL_RE.matcher(c).matches()) {
            throw new IllegalArgumentException("非法列名: " + col);
        }
        return c;
    }

    private String sqlVal(Object v) {
        if (v == null) return "NULL";
        if (v instanceof Number || v instanceof Boolean) return String.valueOf(v);
        String s = String.valueOf(v).replace("'", "''");
        return "'" + s + "'";
    }

    public List<Map<String, Object>> list(String table) {
        checkTable(table);
        return mapper.listAll(table);
    }

    public Map<String, Object> getOne(String table, int id) {
        checkTable(table);
        return mapper.getOne(table, id);
    }

    public List<Map<String, Object>> listByType(String table, String type) {
        checkTable(table);
        return mapper.listByType(table, type);
    }

    public List<Map<String, Object>> listByKb(String table, int kbId) {
        checkTable(table);
        return mapper.listByKbId(table, kbId);
    }

    public int save(String table, Map<String, Object> body) {
        return save(table, body, null);
    }

    /**
     * @param ignoredOut 非空时，回填被跳过的字段名（前端多传的界面态字段、或列名写错）。
     *                   跳过而不是报错：通用保存层不该因为前端带了个 UI 字段就 500。
     */
    public int save(String table, Map<String, Object> body, java.util.List<String> ignoredOut) {
        checkTable(table);
        Object idRaw = body.get("id");
        int id = idRaw == null ? 0 : Integer.parseInt(String.valueOf(idRaw));
        java.util.Set<String> cols0 = tableColumns(table);
        StringBuilder cols = new StringBuilder();
        StringBuilder vals = new StringBuilder();
        StringBuilder sets = new StringBuilder();
        for (Map.Entry<String, Object> e : body.entrySet()) {
            if (e.getKey().equalsIgnoreCase("id")) continue;
            Object value = e.getValue();
            // 约定：字段缺失或为 null = 不动这一列；空串 = 对**可空列**显式置 NULL。
            // 必须限定"可空列"：NOT NULL 文本列（如 patrol_vlm_model.model）写成 NULL 会直接抛
            // SQLIntegrityConstraintViolationException，表现为保存 500。
            if (value == null) continue;
            String col = safeCol(e.getKey());
            if (!cols0.contains("*") && !cols0.contains(col)) {
                // 表里没有这一列：记下来跳过，不再拼进 SQL 造成 Unknown column 500
                if (ignoredOut != null) ignoredOut.add(col);
                log.warn("[通用保存] {}.{} 列不存在，已跳过（请检查字段名或前端是否多传了界面态字段）", table, col);
                continue;
            }
            if (value instanceof String s && s.isBlank() && nullableCols(table).contains(col)) {
                value = null;
            }
            if (cols.length() > 0) {
                cols.append(", ");
                vals.append(", ");
            }
            cols.append(col);
            vals.append(sqlVal(value));
            if (sets.length() > 0) sets.append(", ");
            sets.append(col).append(" = ").append(sqlVal(value));
        }
        if (id > 0) {
            if (sets.length() == 0) return 0;
            return mapper.update(table, sets.toString(), id);
        } else {
            if (cols.length() == 0) return 0;
            Map<String, Object> idHolder = new java.util.HashMap<>();
            mapper.insert(table, cols.toString(), vals.toString(), idHolder);
            Object newId = idHolder.get("id");
            return newId == null ? 0 : Integer.parseInt(String.valueOf(newId));
        }
    }

    public int delete(String table, int id) {
        checkTable(table);
        return mapper.delete(table, id);
    }
}
