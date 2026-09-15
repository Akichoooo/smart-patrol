package com.genersoft.iot.vmp.patrol.dao;

import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

/**
 * 巡检任务/执行/结果/告警/通知/读数 Mapper
 */
@Mapper
public interface PatrolTaskMapper {

    // ---------------- 任务 ----------------
    @Select("<script>SELECT t.*, s.name AS schemeName FROM patrol_task t " +
            "LEFT JOIN patrol_identify_scheme s ON t.default_scheme_id = s.id " +
            "<where>" +
            "<if test='keyword != null and keyword != \"\"'> AND t.name LIKE CONCAT('%',#{keyword},'%') </if>" +
            "<if test='type != null and type != \"\"'> AND t.type = #{type} </if>" +
            "</where> ORDER BY t.id DESC</script>")
    List<Map<String, Object>> taskList(@Param("keyword") String keyword, @Param("type") String type);

    @Select("SELECT t.*, s.name AS schemeName FROM patrol_task t LEFT JOIN patrol_identify_scheme s ON t.default_scheme_id = s.id WHERE t.id = #{id}")
    Map<String, Object> taskGet(@Param("id") int id);

    @Insert("INSERT INTO patrol_task (name, type, robot_device_id, priority, creator, time_plans_json, default_scheme_id, enabled, remark, create_time) VALUES " +
            "(#{name}, #{type}, #{robotDeviceId}, #{priority}, #{creator}, #{timePlansJson}, #{defaultSchemeId}, #{enabled}, #{remark}, NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int taskInsert(Map<String, Object> task);

    @Update("UPDATE patrol_task SET name = #{name}, type = #{type}, robot_device_id = #{robotDeviceId}, priority = #{priority}, " +
            "time_plans_json = #{timePlansJson}, default_scheme_id = #{defaultSchemeId}, remark = #{remark} WHERE id = #{id}")
    int taskUpdate(Map<String, Object> task);

    @Update("UPDATE patrol_task SET enabled = #{enabled} WHERE id = #{id}")
    int taskEnable(@Param("id") int id, @Param("enabled") boolean enabled);

    @Delete("DELETE FROM patrol_task WHERE id = #{id}")
    int taskDelete(@Param("id") int id);

    @Select("SELECT COUNT(*) FROM patrol_task")
    int taskCount();

    // ---------------- 任务点位 ----------------
    @Delete("DELETE FROM patrol_task_point WHERE task_id = #{taskId}")
    int pointsClear(@Param("taskId") int taskId);

    @Insert("INSERT INTO patrol_task_point (task_id, waypoint_id, seq, capture_mode, scheme_id, params_json) VALUES " +
            "(#{taskId}, #{waypointId}, #{seq}, #{captureMode}, #{schemeId}, #{paramsJson})")
    int pointInsert(Map<String, Object> point);

    @Select("SELECT p.*, w.name AS waypoint_name, w.area, w.device_name, w.part_name, w.capture_channel_id " +
            "FROM patrol_task_point p LEFT JOIN patrol_waypoint w ON p.waypoint_id = w.id WHERE p.task_id = #{taskId} ORDER BY p.seq")
    List<Map<String, Object>> pointsOfTask(@Param("taskId") int taskId);

    // ---------------- 执行 ----------------
    @Insert("INSERT INTO patrol_task_execution (task_id, device_id, status, progress, trigger_type, total_points, started_at, create_time) VALUES " +
            "(#{taskId}, #{deviceId}, 'RUNNING', 0, #{triggerType}, #{totalPoints}, NOW(), NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int executionInsert(Map<String, Object> exec);

    @Select("SELECT e.*, t.name AS task_name, d.name AS device_name FROM patrol_task_execution e " +
            "LEFT JOIN patrol_task t ON e.task_id = t.id LEFT JOIN patrol_robot_device d ON e.device_id = d.id " +
            "WHERE e.status IN ('PENDING','RUNNING','PAUSED') ORDER BY e.id DESC")
    List<Map<String, Object>> executingList();

    @Select("SELECT e.*, t.name AS task_name, d.name AS device_name FROM patrol_task_execution e " +
            "LEFT JOIN patrol_task t ON e.task_id = t.id LEFT JOIN patrol_robot_device d ON e.device_id = d.id ORDER BY e.id DESC LIMIT #{limit}")
    List<Map<String, Object>> executionRecent(@Param("limit") int limit);

    @Select("SELECT e.*, t.name AS task_name, d.name AS device_name FROM patrol_task_execution e " +
            "LEFT JOIN patrol_task t ON e.task_id = t.id LEFT JOIN patrol_robot_device d ON e.device_id = d.id WHERE e.id = #{id}")
    Map<String, Object> executionGet(@Param("id") int id);

    @Update("UPDATE patrol_task_execution SET status = #{status}, progress = #{progress}, finished_points = #{finishedPoints}, " +
            "abnormal_points = #{abnormalPoints}, error_msg = #{errorMsg} WHERE id = #{id}")
    int executionUpdate(Map<String, Object> exec);

    @Update("UPDATE patrol_task_execution SET status = #{status}, finished_at = NOW() WHERE id = #{id}")
    int executionFinish(@Param("id") int id, @Param("status") String status);

    @Select("SELECT COUNT(*) FROM patrol_task_execution WHERE task_id = #{taskId} AND status IN ('RUNNING','PAUSED')")
    int executionRunningOfTask(@Param("taskId") int taskId);

    @Update("UPDATE patrol_task_execution SET progress = #{progress}, finished_points = #{finishedPoints}, abnormal_points = #{abnormalPoints} WHERE id = #{id}")
    int executionProgress(@Param("id") int id, @Param("progress") int progress,
                          @Param("finishedPoints") int finishedPoints, @Param("abnormalPoints") int abnormalPoints);

    // ---------------- 点位结果 ----------------
    @Insert("INSERT INTO patrol_point_result (execution_id, task_id, task_point_id, waypoint_id, waypoint_name, media_id, scheme_id, " +
            "result, identify_type, confidence, process_note, captured_at, create_time) VALUES " +
            "(#{executionId}, #{taskId}, #{taskPointId}, #{waypointId}, #{waypointName}, #{mediaId}, #{schemeId}, " +
            "#{result}, #{identifyType}, #{confidence}, #{processNote}, NOW(), NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int resultInsert(Map<String, Object> result);

    @Update("UPDATE patrol_point_result SET yolo_json = #{yoloJson}, vlm_json = #{vlmJson}, result = #{result}, " +
            "identify_type = #{identifyType}, identify_sub_type = #{identifySubType}, defect_type = #{defectType}, " +
            "confidence = #{confidence}, anomaly_reason = #{anomalyReason}, process_note = #{processNote} WHERE id = #{id}")
    int resultUpdate(Map<String, Object> result);

    @Update("UPDATE patrol_point_result SET review_status = #{reviewStatus}, reviewed_by = #{reviewedBy}, review_note = #{reviewNote}, reviewed_at = NOW() WHERE id = #{id}")
    int resultReview(@Param("id") int id, @Param("reviewStatus") String reviewStatus,
                     @Param("reviewedBy") String reviewedBy, @Param("reviewNote") String reviewNote);

    @Select("SELECT * FROM patrol_point_result WHERE execution_id = #{executionId} ORDER BY id")
    List<Map<String, Object>> resultsOfExecution(@Param("executionId") int executionId);

    @Select("SELECT pr.* FROM patrol_point_result pr WHERE pr.id = #{id}")
    Map<String, Object> resultGet(@Param("id") int id);

    @Select("SELECT pr.* FROM patrol_point_result pr ORDER BY pr.id DESC LIMIT 300")
    List<Map<String, Object>> resultAll();

    @Select("SELECT pr.* FROM patrol_point_result pr WHERE pr.result = 'ABNORMAL' ORDER BY pr.id DESC LIMIT 300")
    List<Map<String, Object>> resultAbnormal();

    // ---------------- 媒体 ----------------
    @Insert("INSERT INTO patrol_media (execution_id, point_result_id, type, file_name, path, url, size, source, captured_at, create_time) VALUES " +
            "(#{executionId}, #{pointResultId}, #{type}, #{fileName}, #{path}, #{url}, #{size}, #{source}, NOW(), NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int mediaInsert(Map<String, Object> media);

    @Select("SELECT * FROM patrol_media WHERE id = #{id}")
    Map<String, Object> mediaGet(@Param("id") int id);

    // 结果表持有 media_id 外键；point_result_id 仅在"结果先入库、媒体后补写"链路才有值，两条路都兜住
    @Select("SELECT url, path FROM patrol_media WHERE id = #{mediaId} OR point_result_id = #{mediaId} ORDER BY id DESC LIMIT 1")
    Map<String, Object> mediaOfResult(@Param("mediaId") int mediaId);

    // ---------------- 告警 ----------------
    @Insert("INSERT INTO patrol_alarm (alarm_no, point_result_id, task_id, execution_id, waypoint_name, channel_id, source, level, description, " +
            "identify_type, identify_sub_type, anomaly_reason, media_id, status, alarm_time) VALUES " +
            "(#{alarmNo}, #{pointResultId}, #{taskId}, #{executionId}, #{waypointName}, #{channelId}, #{source}, #{level}, #{description}, " +
            "#{identifyType}, #{identifySubType}, #{anomalyReason}, #{mediaId}, 'PENDING', NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int alarmInsert(Map<String, Object> alarm);

    @Select("SELECT a.*, m.url AS media_url FROM patrol_alarm a LEFT JOIN patrol_media m ON a.media_id = m.id " +
            "WHERE a.source = #{source} ORDER BY a.id DESC LIMIT 300")
    List<Map<String, Object>> alarmListBySource(@Param("source") String source);

    @Select("SELECT a.*, m.url AS media_url FROM patrol_alarm a LEFT JOIN patrol_media m ON a.media_id = m.id ORDER BY a.id DESC LIMIT #{limit}")
    List<Map<String, Object>> alarmRecent(@Param("limit") int limit);

    @Update("UPDATE patrol_alarm SET status = #{status}, confirmed_by = #{confirmedBy}, dispatch_json = #{dispatchJson} WHERE id = #{id}")
    int alarmUpdate(@Param("id") long id, @Param("status") String status,
                    @Param("confirmedBy") String confirmedBy, @Param("dispatchJson") String dispatchJson);

    @Select("SELECT level, COUNT(*) AS cnt FROM patrol_alarm WHERE alarm_time >= DATE_SUB(NOW(), INTERVAL 3 MONTH) GROUP BY level")
    List<Map<String, Object>> alarmStats3M();

    @Select("SELECT * FROM patrol_alarm WHERE status = 'PENDING' AND source = #{source}")
    List<Map<String, Object>> alarmPendingOfSource(@Param("source") String source);

    // ---------------- 读数 ----------------
    @Insert("INSERT INTO patrol_point_reading (point_result_id, waypoint_id, reading_key, value_num, value_text, unit, confidence, recorded_at) VALUES " +
            "(#{pointResultId}, #{waypointId}, #{readingKey}, #{valueNum}, #{valueText}, #{unit}, #{confidence}, NOW())")
    int readingInsert(Map<String, Object> reading);

    @Select("SELECT recorded_at, value_num FROM patrol_point_reading WHERE waypoint_id = #{waypointId} AND reading_key = #{readingKey} " +
            "AND recorded_at >= DATE_SUB(NOW(), INTERVAL #{days} DAY) ORDER BY recorded_at")
    List<Map<String, Object>> readingCurve(@Param("waypointId") int waypointId, @Param("readingKey") String readingKey, @Param("days") int days);

    @Select("SELECT reading_key, value_num, value_text, unit, recorded_at FROM patrol_point_reading WHERE waypoint_id = #{waypointId} ORDER BY id DESC LIMIT 1")
    Map<String, Object> readingLatest(@Param("waypointId") int waypointId);

    // ---------------- 通知 ----------------
    @Insert("INSERT INTO patrol_notification (user_id, title, content, type, biz_id, is_read, create_time) VALUES " +
            "(#{userId}, #{title}, #{content}, #{type}, #{bizId}, 0, NOW())")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int notificationInsert(Map<String, Object> notice);

    @Select("SELECT * FROM patrol_notification WHERE user_id IS NULL OR user_id = #{userId} ORDER BY id DESC LIMIT 50")
    List<Map<String, Object>> notificationList(@Param("userId") Integer userId);

    @Select("SELECT COUNT(*) FROM patrol_notification WHERE (user_id IS NULL OR user_id = #{userId}) AND is_read = 0")
    int notificationUnread(@Param("userId") Integer userId);

    @Update("UPDATE patrol_notification SET is_read = 1 WHERE id = #{id}")
    int notificationRead(@Param("id") long id);

    @Update("UPDATE patrol_notification SET is_read = 1 WHERE (user_id IS NULL OR user_id = #{userId})")
    int notificationReadAll(@Param("userId") Integer userId);

    @Select("SELECT c.stream_id, c.device_id, c.data_type, c.gb_device_id, " +
            "COALESCE(NULLIF(c.name,''), c.gb_name) AS name FROM wvp_device_channel c WHERE c.id = #{id}")
    Map<String, Object> wvpChannelById(@Param("id") int id);

    @Delete("DELETE FROM wvp_device_channel WHERE id = #{id}")
    int channelDelete(@Param("id") int id);

    /** 拉流代理通道与代理行的 stock 关联字段是 data_device_id = proxy.id（stock 插入后拿不到自增id，接入时显式补全） */
    @Select("SELECT id FROM wvp_device_channel WHERE data_type = 3 AND gb_device_id = #{gbDeviceId} ORDER BY id DESC LIMIT 1")
    Integer channelIdByGbDeviceId(@Param("gbDeviceId") String gbDeviceId);

    @Select("SELECT id FROM wvp_stream_proxy WHERE stream = #{stream} ORDER BY id DESC LIMIT 1")
    Integer proxyIdByStream(@Param("stream") String stream);

    /** 补全代理通道的关联与名称（stream_id stock 在播放时才回写，接入时显式写上） */
    @Update("UPDATE wvp_device_channel SET stream_id = #{stream}, data_device_id = #{dataDeviceId}, name = #{name}, gb_name = #{name} WHERE id = #{id}")
    int channelFillStream(@Param("id") int id, @Param("stream") String stream, @Param("name") String name, @Param("dataDeviceId") int dataDeviceId);

    @Select("SELECT src_url FROM wvp_stream_proxy WHERE stream = #{stream} AND enable = 1 LIMIT 1")
    String proxySrcUrl(@Param("stream") String stream);

    @Select("SELECT app FROM wvp_stream_proxy WHERE stream = #{stream} AND enable = 1 LIMIT 1")
    String proxyAppOf(@Param("stream") String stream);

    @Select("SELECT id FROM wvp_device_channel WHERE stream_id = #{stream} ORDER BY id DESC LIMIT 1")
    Integer channelIdByStream(@Param("stream") String stream);

    /** 关闭单通道平台录像：清空通道上的计划关联（wvp_record_plan_link 语义即通道行 record_plan_id） */
    @Update("UPDATE wvp_device_channel SET record_plan_id = NULL WHERE id = #{channelId}")
    int unlinkRecordPlan(@Param("channelId") int channelId);

    @Select("SELECT gb_civil_code FROM wvp_device_channel WHERE id = #{channelId}")
    String channelCivilCode(@Param("channelId") int channelId);

    /** 摄像机总数（含国标与拉流代理，即所有有视频来源的通道） */
    @Select("SELECT COUNT(*) FROM wvp_device_channel")
    int channelTotal();

    /** 在线摄像机数（通道状态为准） */
    @Select("SELECT COUNT(*) FROM wvp_device_channel WHERE COALESCE(gb_status, status) = 'ON'")
    int channelOnline();

    @Select("<script>SELECT c.id, COALESCE(NULLIF(c.name,''), c.gb_name) AS name, c.gb_device_id, c.gb_manufacturer AS manufacturer, " +
            "c.gb_model AS model, c.status, c.data_type AS dataType, p.src_url AS srcUrl, " +
            "r.name AS regionName, c.create_time AS createTime " +
            "FROM wvp_device_channel c " +
            "LEFT JOIN wvp_stream_proxy p ON c.stream_id = p.stream " +
            "LEFT JOIN wvp_common_region r ON r.device_id = c.gb_civil_code " +
            "<where>" +
            "<if test='keyword != null and keyword != \"\"'> AND (c.name LIKE CONCAT('%',#{keyword},'%') OR c.gb_name LIKE CONCAT('%',#{keyword},'%')) </if>" +
            "<if test='status != null and status != \"\"'> AND c.status = #{status} </if>" +
            "</where> ORDER BY c.id DESC LIMIT 2000</script>")
    List<Map<String, Object>> exportChannels(@Param("keyword") String keyword, @Param("status") String status);

    @Select("<script>SELECT d.device_id, COALESCE(NULLIF(d.name,''), d.custom_name) AS name, d.manufacturer, d.model, d.firmware, " +
            "d.on_line AS online, d.ip, d.port, d.transport, d.create_time AS createTime " +
            "FROM wvp_device d " +
            "<where>" +
            "<if test='keyword != null and keyword != \"\"'> AND (d.name LIKE CONCAT('%',#{keyword},'%') OR d.device_id LIKE CONCAT('%',#{keyword},'%')) </if>" +
            "<if test='status != null and status != \"\"'> AND d.on_line = #{status} </if>" +
            "</where> ORDER BY d.id DESC LIMIT 2000</script>")
    List<Map<String, Object>> exportDevices(@Param("keyword") String keyword, @Param("status") String status);

    // ---------------- 统计 ----------------
    @Select("SELECT DATE(captured_at) AS day, " +
            "SUM(CASE WHEN result='ANALYZING' THEN 1 ELSE 0 END) AS running, " +
            "SUM(CASE WHEN result='NORMAL' THEN 1 ELSE 0 END) AS finished, " +
            "SUM(CASE WHEN result='ABNORMAL' THEN 1 ELSE 0 END) AS abnormal " +
            "FROM patrol_point_result WHERE captured_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(captured_at) ORDER BY day")
    List<Map<String, Object>> statsByDay();

    @Select("SELECT t.name AS task_name, COUNT(e.id) AS exec_count, " +
            "SUM(CASE WHEN e.status='FINISHED' THEN 1 ELSE 0 END) AS success_count, " +
            "SUM(CASE WHEN e.status IN ('FAILED') THEN 1 ELSE 0 END) AS failed_count, " +
            "SUM(e.total_points) AS total_points, SUM(e.abnormal_points) AS abnormal_points, " +
            "AVG(TIMESTAMPDIFF(SECOND, e.started_at, e.finished_at)) AS avg_cost_seconds " +
            "FROM patrol_task t LEFT JOIN patrol_task_execution e ON e.task_id = t.id GROUP BY t.id, t.name")
    List<Map<String, Object>> statsExecution();
}
