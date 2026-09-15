package com.genersoft.iot.vmp.patrol.service;

import java.util.List;
import java.util.Map;

/**
 * 巡检点位结果、告警闭环与统计服务接口
 *
 * @author WVP-Pro
 */
public interface PatrolResultService {

    /**
     * 查询全量点位结果列表（结果浏览归档）
     *
     * @return 包含媒体 URL 的点位结果列表
     */
    List<Map<String, Object>> listResults();

    /**
     * 查询识别异常的点位结果列表
     *
     * @return 异常点位结果列表
     */
    List<Map<String, Object>> listAbnormalResults();

    /**
     * 按点位关键字与日期范围过滤点位结果
     *
     * @param keyword 点位名称关键字
     * @param beginDate 开始日期 (yyyy-MM-dd)
     * @param endDate 结束日期 (yyyy-MM-dd)
     * @return 过滤后的点位结果列表
     */
    List<Map<String, Object>> queryResults(String keyword, String beginDate, String endDate);

    /**
     * 获取单个点位结果详情（包含媒体图片与研判全量数据）
     *
     * @param id 点位结果ID
     * @return 点位结果详情数据，不存在则抛出 404 异常
     */
    Map<String, Object> getResultDetail(int id);

    /**
     * 点位结果人工确认审核（正常 / 异常订正）
     *
     * @param id 点位结果ID
     * @param decision 审核决策 (CONFIRMED_NORMAL / CONFIRMED_ABNORMAL)
     * @param note 审核说明
     * @param operator 操作人用户名
     */
    void reviewResult(int id, String decision, String note, String operator);

    /**
     * 按来源分类获取告警列表
     *
     * @param source 告警来源分类 (INSPECT / MONITOR / COMPARE / DEVICE)
     * @return 告警记录列表
     */
    List<Map<String, Object>> listAlarms(String source);

    /**
     * 批量复归告警（一键关闭归档当前处于 PENDING 状态的告警）
     *
     * @param source 告警来源分类
     * @param operator 操作人用户名
     */
    void recoverAlarms(String source, String operator);

    /**
     * 针对单条告警进行处置（复归 CLOSED / 派单 DISPATCH / 误报排除 FALSE_POSITIVE / 免打扰 SILENCE）
     *
     * @param id 告警记录ID
     * @param action 处置动作
     * @param body 附加处置参数（派单人、优先级、说明等）
     * @param operator 操作人用户名
     */
    void confirmAlarm(long id, String action, Map<String, Object> body, String operator);

    /**
     * 获取各任务执行情况汇总统计
     *
     * @return 各任务执行统计列表
     */
    List<Map<String, Object>> statsExecution();

    /**
     * 获取指定点位表计读数的历史趋势曲线
     *
     * @param waypointId 点位ID
     * @param readingKey 读数项键名（如油温、气压，可空）
     * @param days 查询最近天数
     * @return 时间序列曲线数据点
     */
    List<Map<String, Object>> curveHistory(int waypointId, String readingKey, int days);

    /**
     * 获取告警抑制与防打扰规则配置
     *
     * @return 告警规则 JSON Map
     */
    Map<String, Object> getAlarmRules();

    /**
     * 保存告警抑制与防打扰规则配置
     *
     * @param body 规则参数
     */
    void saveAlarmRules(Map<String, Object> body);

    /**
     * 获取站内通知列表
     *
     * @param userId 当前用户ID
     * @return 通知列表
     */
    List<Map<String, Object>> listNotifications(Integer userId);

    /**
     * 获取未读通知数量
     *
     * @param userId 当前用户ID
     * @return 未读数量
     */
    int countUnreadNotifications(Integer userId);

    /**
     * 标记通知为已读
     *
     * @param id 通知ID（为空时若 all=true 则全部标记）
     * @param all 是否全部标记为已读
     * @param userId 当前用户ID
     */
    void readNotification(Long id, boolean all, Integer userId);
}
