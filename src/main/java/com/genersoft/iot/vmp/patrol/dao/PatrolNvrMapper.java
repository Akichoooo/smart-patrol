package com.genersoft.iot.vmp.patrol.dao;

import org.apache.ibatis.annotations.*;

import java.util.List;
import java.util.Map;

/**
 * 录像设备（NVR/PVR，含"自研 NVR"=ZLM 录制）档案 + 摄像头挂载绑定。
 * - 摄像头接入向导选择挂载到某台 NVR 时：RTSP 从 NVR 取流（通道号=NVR 侧通道号），
 *   云台经 NVR 的 ISAPI/CGI 下发，绑定关系存 patrol_nvr_camera。
 * - channel_id 对应 wvp_device_channel.id（CommonGBChannel.gbId），一通道只能挂一台 NVR。
 */
@Mapper
public interface PatrolNvrMapper {

    String COLS = "id, name, vendor, ip, rtsp_port, api_port, username, password, channel_count, region_civil_code, remark, create_time, update_time";

    @Select("SELECT " + COLS + " FROM patrol_nvr ORDER BY id DESC")
    List<Map<String, Object>> list();

    @Select("SELECT " + COLS + " FROM patrol_nvr WHERE id = #{id}")
    Map<String, Object> getById(@Param("id") int id);

    @Insert("INSERT INTO patrol_nvr (name, vendor, ip, rtsp_port, api_port, username, password, channel_count, region_civil_code, remark) " +
            "VALUES (#{name}, #{vendor}, #{ip}, #{rtspPort}, #{apiPort}, #{username}, #{password}, #{channelCount}, #{regionCivilCode}, #{remark})")
    @Options(useGeneratedKeys = true, keyProperty = "id", keyColumn = "id")
    int insert(Map<String, Object> nvr);

    @Update("UPDATE patrol_nvr SET name = #{name}, vendor = #{vendor}, ip = #{ip}, rtsp_port = #{rtspPort}, api_port = #{apiPort}, " +
            "username = #{username}, password = #{password}, channel_count = #{channelCount}, region_civil_code = #{regionCivilCode}, " +
            "remark = #{remark} WHERE id = #{id}")
    int update(Map<String, Object> nvr);

    /** 密码为空串时保持原密码（编辑页密码留空 = 不修改） */
    @Update("UPDATE patrol_nvr SET name = #{name}, vendor = #{vendor}, ip = #{ip}, rtsp_port = #{rtspPort}, api_port = #{apiPort}, " +
            "username = #{username}, password = IF(#{password} IS NULL OR #{password} = '', password, #{password}), " +
            "channel_count = #{channelCount}, region_civil_code = #{regionCivilCode}, remark = #{remark} WHERE id = #{id}")
    int updateKeepPassword(Map<String, Object> nvr);

    @Delete("DELETE FROM patrol_nvr WHERE id = #{id}")
    int delete(@Param("id") int id);

    @Delete("DELETE FROM patrol_nvr_camera WHERE nvr_id = #{nvrId}")
    int unbindAllOfNvr(@Param("nvrId") int nvrId);

    // ---------------- 摄像头挂载绑定 ----------------

    @Insert("INSERT INTO patrol_nvr_camera (nvr_id, channel_id, nvr_channel_no) VALUES (#{nvrId}, #{channelId}, #{nvrChannelNo}) " +
            "ON DUPLICATE KEY UPDATE nvr_id = VALUES(nvr_id), nvr_channel_no = VALUES(nvr_channel_no)")
    int bind(@Param("nvrId") int nvrId, @Param("channelId") int channelId, @Param("nvrChannelNo") int nvrChannelNo);

    @Delete("DELETE FROM patrol_nvr_camera WHERE channel_id = #{channelId}")
    int unbind(@Param("channelId") int channelId);

    @Select("SELECT b.channel_id AS channelId, b.nvr_id AS nvrId, b.nvr_channel_no AS nvrChannelNo, " +
            "n.name AS nvrName, n.vendor AS nvrVendor " +
            "FROM patrol_nvr_camera b LEFT JOIN patrol_nvr n ON n.id = b.nvr_id")
    List<Map<String, Object>> bindings();

    /** 通道 → NVR 连接信息（云台经 NVR 下发时使用；password 仅后端内部使用，不返回前端） */
    @Select("SELECT b.channel_id AS channelId, b.nvr_channel_no AS nvrChannelNo, " +
            "n.id AS nvrId, n.name AS nvrName, n.vendor AS vendor, n.ip AS ip, n.api_port AS apiPort, " +
            "n.username AS username, n.password AS password " +
            "FROM patrol_nvr_camera b JOIN patrol_nvr n ON n.id = b.nvr_id WHERE b.channel_id = #{channelId}")
    Map<String, Object> bindingOfChannel(@Param("channelId") int channelId);

    /** 未挂载 NVR 的直连通道：取其拉流代理源地址（从中解析 IP/凭据做直连 ISAPI 控制） */
    @Select("SELECT p.src_url AS srcUrl, p.stream AS stream FROM wvp_device_channel c " +
            "JOIN wvp_stream_proxy p ON p.id = c.data_device_id WHERE c.id = #{channelId}")
    Map<String, Object> proxyOfChannel(@Param("channelId") int channelId);

    @Select("SELECT p.id AS id, p.stream AS stream, p.src_url AS srcUrl FROM wvp_stream_proxy p " +
            "JOIN wvp_device_channel c ON p.id = c.data_device_id WHERE c.id = #{channelId} LIMIT 1")
    Map<String, Object> proxyByChannelId(@Param("channelId") int channelId);

    @Delete("DELETE FROM patrol_channel_storage WHERE channel_id = #{channelId}")
    int storageDelete(@Param("channelId") int channelId);

    /** 删除 NVR 时其上各通道的录像归属回落到 ZLM 平台存储（摄像机本体不受影响） */
    @Update("UPDATE patrol_channel_storage SET storage_type = 'ZLM', nvr_id = NULL, nvr_channel_no = NULL WHERE nvr_id = #{nvrId}")
    int storageFallbackToZlm(@Param("nvrId") int nvrId);

    // ---------------- 录像归属（ZLM 本地存储节点 / 厂商 NVR / 不录） ----------------

    @Insert("INSERT INTO patrol_channel_storage (channel_id, storage_type, nvr_id, nvr_channel_no) " +
            "VALUES (#{channelId}, #{storageType}, #{nvrId}, #{nvrChannelNo}) " +
            "ON DUPLICATE KEY UPDATE storage_type = VALUES(storage_type), nvr_id = VALUES(nvr_id), " +
            "nvr_channel_no = VALUES(nvr_channel_no)")
    int assignStorage(@Param("channelId") int channelId, @Param("storageType") String storageType,
                      @Param("nvrId") Integer nvrId, @Param("nvrChannelNo") Integer nvrChannelNo);

    @Select("SELECT channel_id AS channelId, storage_type AS storageType, nvr_id AS nvrId, " +
            "nvr_channel_no AS nvrChannelNo FROM patrol_channel_storage")
    List<Map<String, Object>> storageAll();

    @Select("SELECT channel_id AS channelId, storage_type AS storageType, nvr_id AS nvrId, " +
            "nvr_channel_no AS nvrChannelNo FROM patrol_channel_storage WHERE channel_id = #{channelId}")
    Map<String, Object> storageOfChannel(@Param("channelId") int channelId);

    // ---------------- 存储节点能力汇总（ZLM 节点容量 = 录像索引聚合） ----------------

    @Select("SELECT id, ip, http_port AS httpPort, rtsp_port AS rtspPort, record_day AS recordDay, " +
            "record_path AS recordPath, server_id AS serverId FROM wvp_media_server")
    List<Map<String, Object>> mediaServers();

    @Select("SELECT media_server_id AS mediaServerId, COUNT(*) AS cnt, COALESCE(SUM(file_size),0) AS bytes " +
            "FROM wvp_cloud_record GROUP BY media_server_id")
    List<Map<String, Object>> cloudRecordStats();
}
