package com.genersoft.iot.vmp.patrol.service.impl;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.bean.PatrolAlarmSource;
import com.genersoft.iot.vmp.patrol.bean.PatrolAlarmStatus;
import com.genersoft.iot.vmp.patrol.bean.PatrolReviewStatus;
import com.genersoft.iot.vmp.patrol.config.PatrolConfigService;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.service.PatrolResultService;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 巡检点位结果、告警与统计服务实现
 *
 * @author WVP-Pro
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PatrolResultServiceImpl implements PatrolResultService {

    private final PatrolTaskMapper mapper;
    private final PatrolConfigService configService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private static final String DEFAULT_ALARM_RULES_JSON =
            "{\"minIntervalSeconds\":300,\"silenceDurationHours\":4,\"autoRecoverMinutes\":30}";

    @Override
    public List<Map<String, Object>> listResults() {
        List<Map<String, Object>> list = mapper.resultAll();
        fillMedia(list);
        return list;
    }

    @Override
    public List<Map<String, Object>> listAbnormalResults() {
        List<Map<String, Object>> list = mapper.resultAbnormal();
        fillMedia(list);
        return list;
    }

    @Override
    public List<Map<String, Object>> queryResults(String keyword, String beginDate, String endDate) {
        List<Map<String, Object>> list = mapper.resultAll();
        if (keyword != null && !keyword.isBlank()) {
            list.removeIf(r -> !String.valueOf(r.get("waypoint_name")).contains(keyword.trim()));
        }
        if (beginDate != null && !beginDate.isBlank()) {
            String begin = beginDate.trim() + " 00:00:00";
            list.removeIf(r -> normTime(r.get("captured_at")).compareTo(begin) < 0);
        }
        if (endDate != null && !endDate.isBlank()) {
            String end = endDate.trim() + " 23:59:59";
            list.removeIf(r -> normTime(r.get("captured_at")).compareTo(end) > 0);
        }
        fillMedia(list);
        return list;
    }

    @Override
    public Map<String, Object> getResultDetail(int id) {
        Map<String, Object> r = mapper.resultGet(id);
        if (r == null) {
            log.warn("[巡检-结果] 未找到点位结果记录: id={}", id);
            throw new ControllerException(ErrorCode.ERROR404);
        }
        Object mediaId = r.get("media_id");
        if (mediaId != null) {
            try {
                Map<String, Object> media = mapper.mediaGet(Integer.parseInt(String.valueOf(mediaId)));
                if (media != null) {
                    r.put("mediaUrl", media.get("url"));
                    r.put("mediaPath", media.get("path"));
                }
            } catch (Exception e) {
                log.warn("[巡检-结果] 获取点位媒体失败: mediaId={}, error={}", mediaId, e.getMessage());
            }
        }
        return r;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void reviewResult(int id, String decision, String note, String operator) {
        PatrolReviewStatus reviewStatus = PatrolReviewStatus.of(decision, PatrolReviewStatus.CONFIRMED_NORMAL);
        String finalNote = (note == null || note.isBlank()) ? "人工确认" : note.trim();
        mapper.resultReview(id, reviewStatus.getCode(), operator, finalNote);
        log.info("[巡检-结果] 人工确认审核完成: resultId={}, decision={}, operator={}", id, reviewStatus.getCode(), operator);
    }

    @Override
    public List<Map<String, Object>> listAlarms(String source) {
        PatrolAlarmSource alarmSource = PatrolAlarmSource.of(source, PatrolAlarmSource.INSPECT);
        return mapper.alarmListBySource(alarmSource.getCode());
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void recoverAlarms(String source, String operator) {
        PatrolAlarmSource alarmSource = PatrolAlarmSource.of(source, PatrolAlarmSource.INSPECT);
        List<Map<String, Object>> pending = mapper.alarmPendingOfSource(alarmSource.getCode());
        int count = 0;
        for (Map<String, Object> a : pending) {
            long alarmId = Long.parseLong(String.valueOf(a.get("id")));
            mapper.alarmUpdate(alarmId, PatrolAlarmStatus.CLOSED.getCode(), operator, null);
            count++;
        }
        log.info("[巡检-告警] 批量复归完成: source={}, closedCount={}, operator={}", alarmSource.getCode(), count, operator);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void confirmAlarm(long id, String action, Map<String, Object> body, String operator) {
        PatrolAlarmStatus targetStatus = PatrolAlarmStatus.fromAction(action);
        String dispatchJson = null;

        if (targetStatus == PatrolAlarmStatus.DISPATCHED && body != null) {
            Map<String, Object> d = new LinkedHashMap<>();
            d.put("orderNo", "WO-" + System.currentTimeMillis() / 1000);
            d.put("assignee", body.get("assignee"));
            d.put("priority", body.get("priority"));
            d.put("note", body.get("note"));
            d.put("dispatchTime", new Date());
            dispatchJson = JSONObject.toJSONString(d);
        } else if (targetStatus == PatrolAlarmStatus.FALSE_POSITIVE) {
            String note = body != null && body.get("note") != null
                    ? String.valueOf(body.get("note")).trim() : "";
            dispatchJson = "误报说明: " + note;
        } else if (targetStatus == PatrolAlarmStatus.SILENCED) {
            dispatchJson = "已设为免打扰 (操作人: " + operator + ")";
        }

        mapper.alarmUpdate(id, targetStatus.getCode(), operator, dispatchJson);
        log.info("[巡检-告警] 告警处置完成: alarmId={}, action={}, targetStatus={}, operator={}",
                id, action, targetStatus.getCode(), operator);
    }

    @Override
    public List<Map<String, Object>> statsExecution() {
        return mapper.statsExecution();
    }

    @Override
    public List<Map<String, Object>> curveHistory(int waypointId, String readingKey, int days) {
        String key = readingKey;
        if (key == null || key.isBlank()) {
            Map<String, Object> latest = mapper.readingLatest(waypointId);
            key = latest == null ? null : String.valueOf(latest.get("reading_key"));
        }
        if (key == null) {
            return List.of();
        }
        return mapper.readingCurve(waypointId, key, Math.max(1, days));
    }

    @Override
    public Map<String, Object> getAlarmRules() {
        Map<String, Object> result = new HashMap<>();
        String json = configService.get("alarm_rules_json", DEFAULT_ALARM_RULES_JSON);
        result.put("configJson", json);
        return result;
    }

    @Override
    public void saveAlarmRules(Map<String, Object> body) {
        Object jsonVal = body == null ? null : body.get("configJson");
        if (jsonVal == null || String.valueOf(jsonVal).isBlank()) {
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "configJson 不能为空");
        }
        String jsonStr = String.valueOf(jsonVal).trim();
        try {
            objectMapper.readValue(jsonStr, Map.class);
        } catch (Exception e) {
            log.warn("[巡检-告警] 告警规则 JSON 格式不合法: {}", e.getMessage());
            throw new ControllerException(ErrorCode.ERROR400.getCode(), "configJson 必须是有效 JSON: " + e.getMessage());
        }
        configService.set("alarm_rules_json", jsonStr);
        log.info("[巡检-告警] 保存告警规则成功: {}", jsonStr);
    }

    @Override
    public List<Map<String, Object>> listNotifications(Integer userId) {
        return mapper.notificationList(userId);
    }

    @Override
    public int countUnreadNotifications(Integer userId) {
        return mapper.notificationUnread(userId);
    }

    @Override
    public void readNotification(Long id, boolean all, Integer userId) {
        if (all) {
            mapper.notificationReadAll(userId);
            log.info("[巡检-通知] 用户 {} 全部通知已标记已读", userId);
        } else if (id != null) {
            mapper.notificationRead(id);
            log.info("[巡检-通知] 通知已标记已读: id={}, userId={}", id, userId);
        }
    }

    /**
     * captured_at 的两种形态（LocalDateTime "…T…" / 字符串）统一成可字典序比较的 "yyyy-MM-dd HH:mm:ss"
     */
    private static String normTime(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v).replace('T', ' ');
        return s.length() > 19 ? s.substring(0, 19) : s;
    }

    /**
     * 批量充填点位结果的媒体 URL 与本地文件路径
     */
    private void fillMedia(List<Map<String, Object>> list) {
        if (list == null || list.isEmpty()) return;
        for (Map<String, Object> r : list) {
            Object mediaId = r.get("media_id");
            if (mediaId != null) {
                try {
                    Map<String, Object> m = mapper.mediaOfResult(Integer.parseInt(String.valueOf(mediaId)));
                    if (m != null) {
                        r.put("mediaUrl", m.get("url"));
                        r.put("mediaPath", m.get("path"));
                    }
                } catch (Exception ignore) {
                }
            }
        }
    }
}
