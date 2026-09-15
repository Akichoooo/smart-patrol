package com.genersoft.iot.vmp.patrol.bean;

/**
 * 巡检平台状态词汇表（常量汇总与向后兼容门面）
 *
 * <p>状态强类型请优先使用对应的枚举类：
 * <ul>
 *   <li>{@link PatrolResultStatus} 结果判定状态</li>
 *   <li>{@link PatrolReviewStatus} 人工确认状态</li>
 *   <li>{@link PatrolAlarmStatus} 告警生命周期状态</li>
 *   <li>{@link PatrolAlarmSource} 告警来源分类</li>
 *   <li>{@link PatrolExecutionStatus} 任务执行状态</li>
 * </ul>
 *
 * @author WVP-Pro
 */
public final class PatrolStatus {

    private PatrolStatus() {
    }

    // ---- patrol_point_result.result / 任务结论 ----
    public static final String NORMAL = PatrolResultStatus.NORMAL.getCode();
    public static final String ABNORMAL = PatrolResultStatus.ABNORMAL.getCode();
    public static final String ANALYZING = PatrolResultStatus.ANALYZING.getCode();
    public static final String FAILED = PatrolResultStatus.FAILED.getCode();

    // ---- patrol_point_result.review_status / 人工审核状态 ----
    public static final String REVIEW_PENDING = PatrolReviewStatus.PENDING.getCode();
    public static final String CONFIRMED_NORMAL = PatrolReviewStatus.CONFIRMED_NORMAL.getCode();
    public static final String CONFIRMED_ABNORMAL = PatrolReviewStatus.CONFIRMED_ABNORMAL.getCode();

    // ---- patrol_alarm.status / 告警状态 ----
    public static final String ALARM_PENDING = PatrolAlarmStatus.PENDING.getCode();
    public static final String ALARM_CLOSED = PatrolAlarmStatus.CLOSED.getCode();
    public static final String ALARM_DISPATCHED = PatrolAlarmStatus.DISPATCHED.getCode();
    public static final String ALARM_FALSE_POSITIVE = PatrolAlarmStatus.FALSE_POSITIVE.getCode();
    public static final String ALARM_SILENCED = PatrolAlarmStatus.SILENCED.getCode();

    // ---- patrol_task_execution.status / 任务执行状态 ----
    public static final String EXEC_RUNNING = PatrolExecutionStatus.RUNNING.getCode();
    public static final String EXEC_PAUSED = PatrolExecutionStatus.PAUSED.getCode();
    public static final String EXEC_FINISHED = PatrolExecutionStatus.FINISHED.getCode();
    public static final String EXEC_STOPPED = PatrolExecutionStatus.STOPPED.getCode();

    // ---- 检修区 patrol_maintenance_area.status ----
    public static final String ACTIVE = "ACTIVE";
    public static final String DISABLED = "DISABLED";

    // ---- 识别来源 patrol_media.source / AI 检测上下文 ----
    public static final String MANUAL = "MANUAL";
    public static final String ROBOT = "ROBOT";
    public static final String PLAYBACK = "PLAYBACK";
}
