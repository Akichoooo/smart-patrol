package com.genersoft.iot.vmp.patrol.bean;

import lombok.Getter;

/**
 * 巡检点位识别结果状态枚举
 * 对应表: patrol_point_result.result
 *
 * @author WVP-Pro
 */
@Getter
public enum PatrolResultStatus {

    /** 识别结果正常 */
    NORMAL("NORMAL", "正常"),

    /** 识别结果异常 */
    ABNORMAL("ABNORMAL", "异常"),

    /** 算法研判分析中 */
    ANALYZING("ANALYZING", "分析中"),

    /** 识别引擎执行失败 */
    FAILED("FAILED", "识别失败");

    private final String code;
    private final String description;

    PatrolResultStatus(String code, String description) {
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
    public static PatrolResultStatus of(String code, PatrolResultStatus defaultStatus) {
        if (code == null || code.isBlank()) {
            return defaultStatus;
        }
        for (PatrolResultStatus status : values()) {
            if (status.code.equalsIgnoreCase(code.trim())) {
                return status;
            }
        }
        return defaultStatus;
    }

    public static PatrolResultStatus of(String code) {
        return of(code, ANALYZING);
    }
}
