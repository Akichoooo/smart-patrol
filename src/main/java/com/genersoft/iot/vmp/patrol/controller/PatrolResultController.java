package com.genersoft.iot.vmp.patrol.controller;

import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.patrol.service.PatrolResultService;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 巡检点位结果、告警闭环、通知与曲线统计控制器
 *
 * <p>遵循三层解耦架构，控制器仅负责请求映射、参数解构与鉴权，具体业务全部下沉至 {@link PatrolResultService}。
 *
 * @author WVP-Pro
 */
@Tag(name = "巡检平台-结果告警统计")
@RestController
@RequestMapping("/api/patrol")
@RequiredArgsConstructor
public class PatrolResultController {

    private final PatrolResultService resultService;

    // ---------------- 巡检结果 ----------------

    /**
     * 查询全量点位结果列表（结果浏览归档）
     *
     * @return 包含媒体 URL 的点位结果列表
     */
    @GetMapping("/result/list")
    @Operation(summary = "结果列表（浏览归档）")
    public List<Map<String, Object>> resultList() {
        checkPermission("patrol.result", "view");
        return resultService.listResults();
    }

    /**
     * 查询识别异常的点位结果列表
     *
     * @return 异常点位结果列表
     */
    @GetMapping("/result/abnormal")
    @Operation(summary = "识别异常点位")
    public List<Map<String, Object>> resultAbnormal() {
        checkPermission("patrol.result", "view");
        return resultService.listAbnormalResults();
    }

    /**
     * 按关键字与采集日期过滤查询结果
     *
     * @param keyword 点位名称关键字
     * @param beginDate 开始日期 (yyyy-MM-dd)
     * @param endDate 结束日期 (yyyy-MM-dd)
     * @return 过滤后的点位结果列表
     */
    @GetMapping("/result/query")
    @Operation(summary = "结果查询（含历史图像，按点位关键字与采集日期过滤）")
    public List<Map<String, Object>> resultQuery(@RequestParam(required = false) String keyword,
                                                 @RequestParam(required = false) String beginDate,
                                                 @RequestParam(required = false) String endDate) {
        checkPermission("patrol.result", "view");
        return resultService.queryResults(keyword, beginDate, endDate);
    }

    /**
     * 获取单个点位结果详情（包含关联媒体信息）
     *
     * @param id 点位结果ID
     * @return 点位结果详情数据
     */
    @GetMapping("/result/{id}")
    @Operation(summary = "结果详情")
    public Map<String, Object> resultGet(@PathVariable int id) {
        checkPermission("patrol.result", "view");
        return resultService.getResultDetail(id);
    }

    /**
     * 点位结果人工确认审核（正常 / 异常订正）
     *
     * @param id 点位结果ID
     * @param decision 审核决策 (CONFIRMED_NORMAL / CONFIRMED_ABNORMAL)
     * @param note 审核说明
     * @param body JSON 格式入参
     * @param request HTTP 请求上下文
     */
    @PostMapping("/result/{id}/review")
    @Audit(module = "patrol.result", action = "review")
    @Operation(summary = "人工审核（正常/异常/误识别原因）")
    public void resultReview(@PathVariable int id,
                             @RequestParam(required = false) String decision,
                             @RequestParam(required = false) String note,
                             @RequestBody(required = false) Map<String, Object> body,
                             HttpServletRequest request) {
        checkPermission("patrol.result", "review");
        String realDecision = decision;
        String realNote = note;
        if (body != null && body.get("decision") != null) realDecision = String.valueOf(body.get("decision"));
        if (body != null && body.get("note") != null) realNote = String.valueOf(body.get("note"));
        if (realDecision == null && request != null) realDecision = request.getParameter("decision");
        if (realNote == null && request != null) realNote = request.getParameter("note");

        resultService.reviewResult(id, realDecision, realNote, PatrolSecurityUtils.currentUsername());
    }

    // ---------------- 告警管理 ----------------

    /**
     * 按来源分类获取告警列表
     *
     * @param source 告警来源分类 (INSPECT / MONITOR / COMPARE / DEVICE)
     * @return 告警记录列表
     */
    @GetMapping("/alarm/list")
    @Operation(summary = "告警列表（source: INSPECT/DEVICE/MONITOR/COMPARE）")
    public List<Map<String, Object>> alarmList(@RequestParam(defaultValue = "INSPECT") String source) {
        checkPermission("patrol.alarm", "view");
        return resultService.listAlarms(source);
    }

    /**
     * 批量复归待处理告警
     *
     * @param source 告警来源分类
     * @param body 请求体入参
     * @param request HTTP 请求上下文
     */
    @PostMapping("/alarm/recover")
    @Audit(module = "patrol.alarm", action = "confirm")
    @Operation(summary = "批量复归")
    public void alarmRecover(@RequestParam(required = false) String source,
                             @RequestBody(required = false) Map<String, Object> body,
                             HttpServletRequest request) {
        checkPermission("patrol.alarm", "confirm");
        String src = body != null && body.get("source") != null ? String.valueOf(body.get("source")) : source;
        if (src == null && request != null) {
            src = request.getParameter("source");
        }
        resultService.recoverAlarms(src, PatrolSecurityUtils.currentUsername());
    }

    /**
     * 单条告警处置（复归 CLOSED / 派单 DISPATCH / 误报排除 FALSE_POSITIVE / 免打扰 SILENCE）
     *
     * @param id 告警ID
     * @param action 处置动作
     * @param body 附加处置参数
     * @param request HTTP 请求上下文
     */
    @PostMapping("/alarm/{id}/confirm")
    @Audit(module = "patrol.alarm", action = "confirm")
    @Operation(summary = "告警处置：action=CLOSED复归/DISPATCH派单/FALSE_POSITIVE误报/SILENCE免打扰")
    public void alarmConfirm(@PathVariable long id,
                             @RequestParam(required = false) String action,
                             @RequestBody(required = false) Map<String, Object> body,
                             HttpServletRequest request) {
        checkPermission("patrol.alarm", "confirm");
        String act = action;
        if (act == null && body != null && body.get("action") != null) act = String.valueOf(body.get("action"));
        if (act == null && request != null) act = request.getParameter("action");
        if (act == null) act = "CLOSED";

        resultService.confirmAlarm(id, act, body, PatrolSecurityUtils.currentUsername());
    }

    /**
     * 巡视设备本体告警快捷查询
     *
     * @return 巡视设备告警列表
     */
    @GetMapping("/alarm/device/list")
    @Operation(summary = "巡视设备告警")
    public List<Map<String, Object>> alarmDevice() {
        checkPermission("patrol.alarm", "view");
        return resultService.listAlarms("DEVICE");
    }

    // ---------------- 站内通知 ----------------

    /**
     * 当前用户的站内通知列表
     *
     * @return 通知列表
     */
    @GetMapping("/notification/list")
    @Operation(summary = "通知列表")
    public List<Map<String, Object>> notificationList() {
        return resultService.listNotifications(PatrolSecurityUtils.currentUserId());
    }

    /**
     * 当前用户未读通知数量
     *
     * @return 未读通知数
     */
    @GetMapping("/notification/unread/count")
    @Operation(summary = "未读数")
    public int notificationUnread() {
        return resultService.countUnreadNotifications(PatrolSecurityUtils.currentUserId());
    }

    /**
     * 标记通知为已读
     *
     * @param body 请求体入参
     * @param id 指定通知ID
     */
    @PostMapping("/notification/read")
    @Operation(summary = "标记已读")
    public void notificationRead(@RequestBody(required = false) Map<String, Object> body,
                                 @RequestParam(required = false) Long id) {
        boolean all = body != null && Boolean.TRUE.equals(body.get("all"));
        Long targetId = id;
        if (targetId == null && body != null && body.get("id") != null) {
            targetId = Long.parseLong(String.valueOf(body.get("id")));
        }
        resultService.readNotification(targetId, all, PatrolSecurityUtils.currentUserId());
    }

    // ---------------- 告警规则配置 ----------------

    /**
     * 获取告警抑制与防打扰规则配置
     *
     * @return 规则配置 JSON
     */
    @GetMapping("/alarm/rules")
    @Operation(summary = "读取告警规则(JSON)")
    public Map<String, Object> alarmRulesGet() {
        checkPermission("settings.patrol", "edit");
        return resultService.getAlarmRules();
    }

    /**
     * 保存告警抑制与防打扰规则配置
     *
     * @param body 配置参数
     */
    @PostMapping("/alarm/rules/save")
    @Audit(module = "settings.patrol", action = "edit", targetType = "告警规则")
    @Operation(summary = "保存告警规则(JSON)")
    public void alarmRulesSave(@RequestBody Map<String, Object> body) {
        checkPermission("settings.patrol", "edit");
        resultService.saveAlarmRules(body);
    }

    // ---------------- 数据统计与分析 ----------------

    /**
     * 任务执行情况统计汇总
     *
     * @return 各任务执行统计列表
     */
    @GetMapping("/stats/execution")
    @Operation(summary = "任务执行情况统计")
    public List<Map<String, Object>> statsExecution() {
        checkPermission("patrol.stats", "view");
        return resultService.statsExecution();
    }

    /**
     * 表计读数历史趋势曲线分析
     *
     * @param waypointId 点位ID
     * @param readingKey 读数项键名（如油温、气压，可空）
     * @param days 查询天数
     * @return 时间序列曲线数据点
     */
    @GetMapping("/stats/curve/history")
    @Operation(summary = "历史曲线（读数）")
    public List<Map<String, Object>> curveHistory(@RequestParam int waypointId,
                                                  @RequestParam(required = false) String readingKey,
                                                  @RequestParam(defaultValue = "30") int days) {
        checkPermission("patrol.stats", "view");
        return resultService.curveHistory(waypointId, readingKey, days);
    }

    /**
     * 统一权限检查辅助方法
     *
     * @param module 模块编码
     * @param action 操作编码
     */
    private void checkPermission(String module, String action) {
        if (!PatrolSecurityUtils.hasPerm(module, action)) {
            throw new ControllerException(ErrorCode.ERROR403);
        }
    }
}
