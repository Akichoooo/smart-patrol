package com.genersoft.iot.vmp.patrol.bean;

import lombok.Getter;

/**
 * 巡检任务执行状态枚举
 * 对应表: patrol_task_execution.status
 *
 * @author WVP-Pro
 */
@Getter
public enum PatrolExecutionStatus {

    /** 正在执行 */
    RUNNING("RUNNING", "运行中"),

    /** 暂停执行 */
    PAUSED("PAUSED", "已暂停"),

    /** 执行完成 */
    FINISHED("FINISHED", "已完成"),

    /** 人工提前停止 */
    STOPPED("STOPPED", "已停止"),

    /** 执行异常失败 */
    FAILED("FAILED", "失败");

    private final String code;
    private final String description;

    PatrolExecutionStatus(String code, String description) {
        this.code = code;
        this.description = description;
    }

    public static PatrolExecutionStatus of(String code, PatrolExecutionStatus defaultStatus) {
        if (code == null || code.isBlank()) {
            return defaultStatus;
        }
        for (PatrolExecutionStatus s : values()) {
            if (s.code.equalsIgnoreCase(code.trim())) {
                return s;
            }
        }
        return defaultStatus;
    }

    public static PatrolExecutionStatus of(String code) {
        return of(code, RUNNING);
    }
}
