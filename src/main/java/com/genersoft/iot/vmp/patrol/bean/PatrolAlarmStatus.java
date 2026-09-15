package com.genersoft.iot.vmp.patrol.bean;

import lombok.Getter;

/**
 * 告警生命周期状态枚举
 * 对应表: patrol_alarm.status
 *
 * @author WVP-Pro
 */
@Getter
public enum PatrolAlarmStatus {

    /** 待确认（未处置） */
    PENDING("PENDING", "待确认"),

    /** 已复归/已结案归档 */
    CLOSED("CLOSED", "已复归"),

    /** 已派发工单并流转闭环 */
    DISPATCHED("DISPATCHED", "已派单"),

    /** 确认属于误报排除并归档 */
    FALSE_POSITIVE("FALSE_POSITIVE", "误报排除"),

    /** 设为免打扰（阶段性告警抑制） */
    SILENCED("SILENCED", "已免打扰");

    private final String code;
    private final String description;

    PatrolAlarmStatus(String code, String description) {
        this.code = code;
        this.description = description;
    }

    /**
     * 根据前端操作动作 (action) 解析目标告警状态
     *
     * @param action 前端传入动作 (CLOSED/DISPATCH/FALSE_POSITIVE/SILENCE)
     * @return 目标状态
     */
    public static PatrolAlarmStatus fromAction(String action) {
        if (action == null || action.isBlank()) {
            return CLOSED;
        }
        return switch (action.trim().toUpperCase()) {
            case "DISPATCH" -> DISPATCHED;
            case "FALSE_POSITIVE" -> FALSE_POSITIVE;
            case "SILENCE" -> SILENCED;
            default -> CLOSED;
        };
    }

    public static PatrolAlarmStatus of(String code, PatrolAlarmStatus defaultStatus) {
        if (code == null || code.isBlank()) {
            return defaultStatus;
        }
        for (PatrolAlarmStatus status : values()) {
            if (status.code.equalsIgnoreCase(code.trim())) {
                return status;
            }
        }
        return defaultStatus;
    }

    public static PatrolAlarmStatus of(String code) {
        return of(code, PENDING);
    }
}
