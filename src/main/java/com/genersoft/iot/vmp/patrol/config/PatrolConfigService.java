package com.genersoft.iot.vmp.patrol.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 巡检平台全局配置（存 patrol_dict，type=sys_config，界面可改）。
 * 当前项：yolo_url（本地推理服务地址）。
 */
@Slf4j
@Service
public class PatrolConfigService {

    public static final String CONFIG_TYPE = "sys_config";

    @Autowired
    private com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper genericMapper;

    private final Map<String, String> cache = new ConcurrentHashMap<>();

    public String get(String code, String def) {
        String cached = cache.get(code);
        if (cached != null) return cached;
        try {
            for (Map<String, Object> row : genericMapper.listByType("patrol_dict", CONFIG_TYPE)) {
                String c = String.valueOf(row.get("code"));
                String v = row.get("label") == null ? "" : String.valueOf(row.get("label"));
                cache.put(c, v);
            }
        } catch (Exception e) {
            log.warn("[巡检配置] 读取失败: {}", e.getMessage());
        }
        return cache.getOrDefault(code, def);
    }

    public void set(String code, String value) {
        try {
            // upsert：先查后插/改（insert 的自增 id 回填仅支持单 Map 参数，这里必须显式分支）
            Integer id = null;
            for (Map<String, Object> row : genericMapper.listByType("patrol_dict", CONFIG_TYPE)) {
                if (code.equals(String.valueOf(row.get("code")))) {
                    id = Integer.parseInt(String.valueOf(row.get("id")));
                }
            }
            if (id != null) {
                genericMapper.update("patrol_dict",
                        "label = '" + value.replace("'", "''") + "'", id);
            } else {
                genericMapper.insert("patrol_dict",
                        "type, code, label, sort, enabled",
                        "'" + CONFIG_TYPE + "', '" + code + "', '" + value.replace("'", "''") + "', 0, 1",
                        new java.util.HashMap<>());
            }
            cache.put(code, value);
        } catch (Exception e) {
            log.warn("[巡检配置] 保存失败: {}", e.getMessage());
        }
    }
}
