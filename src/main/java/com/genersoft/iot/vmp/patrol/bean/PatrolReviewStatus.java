package com.genersoft.iot.vmp.patrol.bean;

import lombok.Getter;

/**
 * 巡检结果人工审核/确认状态枚举
 * 对应表: patrol_point_result.review_status
 *
 * @author WVP-Pro
 */
@Getter
public enum PatrolReviewStatus {

    /** 待人工确认/未复核 */
    PENDING("PENDING", "待确认"),

    /** 人工确认为正常（排除误报） */
    CONFIRMED_NORMAL("CONFIRMED_NORMAL", "确认正常"),

    /** 人工确认为真实异常 */
    CONFIRMED_ABNORMAL("CONFIRMED_ABNORMAL", "确认异常");

    private final String code;
    private final String description;

    PatrolReviewStatus(String code, String description) {
        this.code = code;
        this.description = description;
    }

    /**
     * 根据编码安全解析状态，未匹配时返回默认值
     *
     * @param code 状态编码
     * @param defaultStatus 缺省状态
     * @return 对应的状态枚举
     */
    public static PatrolReviewStatus of(String code, PatrolReviewStatus defaultStatus) {
        if (code == null || code.isBlank()) {
            return defaultStatus;
        }
        for (PatrolReviewStatus status : values()) {
            if (status.code.equalsIgnoreCase(code.trim())) {
                return status;
            }
        }
        return defaultStatus;
    }

    public static PatrolReviewStatus of(String code) {
        return of(code, PENDING);
    }
}
