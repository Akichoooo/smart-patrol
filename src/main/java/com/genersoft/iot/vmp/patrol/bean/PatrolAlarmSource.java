package com.genersoft.iot.vmp.patrol.bean;

import lombok.Getter;

/**
 * 告警来源分类枚举
 * 对应表: patrol_alarm.source
 *
 * @author WVP-Pro
 */
@Getter
public enum PatrolAlarmSource {

    /** 巡视结果告警（AI 点位分析产生） */
    INSPECT("INSPECT", "巡视结果告警"),

    /** 静默监视告警（后台持续监控产生） */
    MONITOR("MONITOR", "静默监视告警"),

    /** 对比分析告警（跨周期历史对比产生） */
    COMPARE("COMPARE", "对比分析告警"),

    /** 巡视设备告警（机器人/无人机本体故障） */
    DEVICE("DEVICE", "巡视设备告警");

    private final String code;
    private final String description;

    PatrolAlarmSource(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public static PatrolAlarmSource of(String code, PatrolAlarmSource defaultSource) {
        if (code == null || code.isBlank()) {
            return defaultSource;
        }
        for (PatrolAlarmSource s : values()) {
            if (s.code.equalsIgnoreCase(code.trim())) {
                return s;
            }
        }
        return defaultSource;
    }

    public static PatrolAlarmSource of(String code) {
        return of(code, INSPECT);
    }
}
