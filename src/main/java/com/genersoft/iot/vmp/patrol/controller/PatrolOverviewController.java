package com.genersoft.iot.vmp.patrol.controller;

import lombok.RequiredArgsConstructor;

import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.patrol.dao.PatrolGenericMapper;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;

/**
 * 信息总览聚合：WVP 设备/通道统计 + patrol 巡检/告警/缺陷统计。
 * WVP 数据通过其现有 service 读取，不改 WVP 接口。
 */
@Tag(name = "巡检平台-信息总览")
@RestController
@RequestMapping("/api/patrol")
@RequiredArgsConstructor
public class PatrolOverviewController {

    private final PatrolTaskMapper taskMapper;

    private final PatrolGenericMapper genericMapper;

    @Autowired(required = false)
    private com.genersoft.iot.vmp.gb28181.service.IDeviceChannelService channelService;

    /** 近7天按天数据中，从最近一天向前连续有成功记录的天数（真实计算，不编造） */
    private int continuousNormalDays(List<Map<String, Object>> byDay) {
        if (byDay == null || byDay.isEmpty()) {
            return 0;
        }
        java.util.List<java.time.LocalDate> days = new java.util.ArrayList<>();
        for (Map<String, Object> d : byDay) {
            Object v = d.get("day");
            if (v == null) continue;
            try {
                days.add(java.time.LocalDate.parse(String.valueOf(v).substring(0, 10)));
            } catch (Exception ignore) {
            }
        }
        java.util.Collections.sort(days);
        java.util.Collections.reverse(days);
        int streak = 0;
        java.time.LocalDate expect = java.time.LocalDate.now();
        for (java.time.LocalDate d : days) {
            if (d.equals(expect)) {
                streak++;
                expect = expect.minusDays(1);
            } else if (d.isBefore(expect)) {
                break;
            }
        }
        return streak;
    }

    @GetMapping("/overview")
    @Operation(summary = "信息总览聚合")
    public Map<String, Object> overview() {
        Map<String, Object> result = new HashMap<>();

        // 摄像机（含国标与拉流代理：以通道表为准，避免只有 RTSP 接入时统计为 0）
        int camTotal = 0, camOnline = 0;
        try {
            camTotal = taskMapper.channelTotal();
            camOnline = taskMapper.channelOnline();
        } catch (Exception ignore) {
        }
        if (camTotal == 0) {
            try {
                com.github.pagehelper.PageInfo<com.genersoft.iot.vmp.gb28181.bean.DeviceChannel> page =
                        channelService.queryChannels(null, true, null, null, null, 1, 1000);
                camTotal = page == null ? 0 : (int) page.getTotal();
                if (page != null) {
                    for (com.genersoft.iot.vmp.gb28181.bean.DeviceChannel c : page.getList()) {
                        if ("ON".equalsIgnoreCase(c.getStatus())) {
                            camOnline++;
                        }
                    }
                }
            } catch (Exception ignore) {
            }
        }
        result.put("cameras", Map.of("total", camTotal, "online", camOnline));

        // 装备
        try {
            List<Map<String, Object>> devices = genericMapper.listAll("patrol_robot_device");
            int robotTotal = 0, robotOnline = 0, droneTotal = 0, droneOnline = 0;
            for (Map<String, Object> d : devices) {
                boolean online = "ONLINE".equalsIgnoreCase(String.valueOf(d.get("status")));
                if ("DRONE".equalsIgnoreCase(String.valueOf(d.get("type")))) {
                    droneTotal++;
                    if (online) droneOnline++;
                } else {
                    robotTotal++;
                    if (online) robotOnline++;
                }
            }
            result.put("robots", Map.of("total", robotTotal, "online", robotOnline));
            result.put("drones", Map.of("total", droneTotal, "online", droneOnline));
        } catch (Exception e) {
            result.put("robots", Map.of("total", 0, "online", 0));
            result.put("drones", Map.of("total", 0, "online", 0));
        }

        // 点位数
        try {
            result.put("waypoints", genericMapper.listAll("patrol_waypoint").size());
        } catch (Exception e) {
            result.put("waypoints", 0);
        }

        // 巡视统计（近7天按天）
        List<Map<String, Object>> byDay = taskMapper.statsByDay();
        int todayTotal = 0, todayFinished = 0;
        for (Map<String, Object> d : byDay) {
            todayTotal += ((Number) d.getOrDefault("finished", 0)).intValue() + ((Number) d.getOrDefault("abnormal", 0)).intValue();
            todayFinished += ((Number) d.getOrDefault("finished", 0)).intValue();
        }
        // 今日任务数（执行单）
        try {
            List<Map<String, Object>> recent = taskMapper.executionRecent(100);
            String today = java.time.LocalDate.now().toString(); // ISO yyyy-MM-dd（SimpleDateFormat 线程不安全，阿里手册禁例）
            int tTotal = 0, tFinished = 0;
            for (Map<String, Object> e : recent) {
                String ct = String.valueOf(e.get("create_time"));
                if (ct != null && ct.startsWith(today)) {
                    tTotal++;
                    if ("FINISHED".equals(String.valueOf(e.get("status")))) tFinished++;
                }
            }
            todayTotal = tTotal;
            todayFinished = tFinished;
        } catch (Exception ignore) {
        }
        result.put("patrol", Map.of("byDay", byDay, "todayTotal", todayTotal, "todayFinished", todayFinished));

        // 告警统计
        Map<String, Object> recent3 = new HashMap<>();
        recent3.put("GENERAL", 0);
        recent3.put("SERIOUS", 0);
        recent3.put("DANGER", 0);
        try {
            for (Map<String, Object> row : taskMapper.alarmStats3M()) {
                recent3.put(String.valueOf(row.get("level")), ((Number) row.get("cnt")).intValue());
            }
        } catch (Exception ignore) {
        }
        List<Map<String, Object>> alarmList = taskMapper.alarmRecent(10);
        result.put("alarms", Map.of("recent3", recent3, "list", alarmList));

        // 缺陷统计（异常且已人工确认的最近记录）
        List<Map<String, Object>> defects = new ArrayList<>();
        try {
            for (Map<String, Object> r : taskMapper.resultAbnormal()) {
                if ("CONFIRMED_ABNORMAL".equals(String.valueOf(r.get("review_status")))) {
                    Map<String, Object> d = new HashMap<>();
                    d.put("waypointName", r.get("waypoint_name"));
                    d.put("result", r.get("result"));
                    d.put("capturedAt", r.get("captured_at"));
                    d.put("defectTime", r.get("reviewed_at"));
                    defects.add(d);
                }
            }
        } catch (Exception ignore) {
        }
        result.put("defects", defects.size() > 10 ? defects.subList(0, 10) : defects);

        // 可靠性统计（只用真实可计算项；无数据源的项返回 null 并在 notCollected 中列明）
        Map<String, Object> reliability = new HashMap<>();
        List<String> notCollected = new ArrayList<>();
        try {
            List<Map<String, Object>> recent = taskMapper.executionRecent(500);
            int success = 0, failed = 0;
            for (Map<String, Object> e : recent) {
                String st = String.valueOf(e.get("status"));
                if ("FINISHED".equals(st)) success++;
                if (PatrolStatus.FAILED.equals(st)) failed++;
            }
            reliability.put("normalDays", byDay.size());
            reliability.put("continuousDays", continuousNormalDays(byDay));
            reliability.put("offlineCount", failed);
            reliability.put("attendanceRate", recent.isEmpty() ? null : success * 100 / recent.size());
            reliability.put("executionTotal", recent.size());
            reliability.put("executionFinished", success);
        } catch (Exception ignore) {
        }
        // 以下依赖数据源未接入，不编造数值
        notCollected.add("录像完整率(需录像巡检作业接入)");
        notCollected.add("累计在线时长(需设备心跳时长统计)");
        notCollected.add("投运期间自检正常天数(系统自检状态按方案未实现)");
        reliability.put("notCollected", notCollected);
        result.put("reliability", reliability);

        return result;
    }
}
