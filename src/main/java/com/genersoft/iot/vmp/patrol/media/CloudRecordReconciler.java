package com.genersoft.iot.vmp.patrol.media;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.conf.UserSetting;
import com.genersoft.iot.vmp.media.bean.MediaServer;
import com.genersoft.iot.vmp.media.service.IMediaServerService;
import com.genersoft.iot.vmp.service.bean.CloudRecordItem;
import com.genersoft.iot.vmp.storager.dao.CloudRecordServiceMapper;
import com.genersoft.iot.vmp.utils.DateUtil;
import lombok.extern.slf4j.Slf4j;
import lombok.RequiredArgsConstructor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.File;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.TimeUnit;

/**
 * 平台录像对账（孤儿文件补册）：
 * ZLM 录像完成的 on_record_mp4 HOOK 偶发丢失（流重启/网络抖动）时，mp4 已在磁盘落盘
 * 但 wvp_cloud_record 无记录，用户回放列表看不到。本任务定时用 ZLM getMp4RecordFile
 * 枚举磁盘录像与库记录比对，为孤儿文件补建记录（文件名内含起始时间，大小取磁盘实值）。
 * 只补册，不删除/不修改任何已有记录（对账安全原则）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CloudRecordReconciler {

    private final CloudRecordServiceMapper cloudRecordServiceMapper;

    private final IMediaServerService mediaServerService;

    private final UserSetting userSetting;

    /** ZLM HTTP API（与编排器抓帧共用同一配置来源） */
    @Value("${patrol.capture.zlm-api-url:http://polaris-media:8081}")
    private String zlmApiUrl;

    @Value("${patrol.capture.zlm-secret:su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf}")
    private String zlmSecret;

    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();

    /** ZLM 录像文件名格式：yyyy-MM-dd-HH-mm-ss-<index>.mp4 */
    private static final java.util.regex.Pattern FILE_NAME_RE =
            java.util.regex.Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})-(\\d{2})-(\\d{2})-(\\d{2})-(\\d+)\\.mp4$");

    /**
     * 每天凌晨 04:10 对账近 N 天录像（含当天，避免对上重复）。
     * 近窗口设计：避免启动时全量扫描历史（可按需手动调用 reconcile）。
     */
    @Scheduled(cron = "0 10 4 * * ?")
    public void scheduledReconcile() {
        reconcile(3);
    }

    /** 对账入口：近 days 天（含今天）内，ZLM 磁盘文件 vs wvp_cloud_record，孤儿补册。返回补册条数。 */
    public int reconcile(int days) {
        List<MediaServer> servers = mediaServerService.getAll();
        if (servers == null || servers.isEmpty()) return 0;
        int added = 0;
        for (MediaServer server : servers) {
            try {
                added += reconcileOneServer(server, days);
            } catch (Exception e) {
                log.warn("[录像对账] 节点 {} 对账失败: {}", server.getId(), e.getMessage());
            }
        }
        if (added > 0) {
            log.info("[录像对账] 本次共补册 {} 条孤儿录像记录", added);
        }
        return added;
    }

    private int reconcileOneServer(MediaServer server, int days) {
        int added = 0;
        for (int d = days - 1; d >= 0; d--) {
            String period = LocalDate.now().minusDays(d).toString();
            long periodStart = DateUtil.yyyy_MM_dd_HH_mm_ssToTimestampMs(period + " 00:00:00");
            long periodEnd = DateUtil.yyyy_MM_dd_HH_mm_ssToTimestampMs(period + " 23:59:59");
            // 枚举该节点下近窗口有记录的 app/stream 组合（库驱动，避免猜测目录结构）
            List<Map<String, Object>> combos = cloudRecordServiceMapper.getCombosOfPeriod(periodStart, periodEnd);
            if (combos == null || combos.isEmpty()) continue;
            for (Map<String, Object> combo : combos) {
                String app = String.valueOf(combo.get("app"));
                String stream = String.valueOf(combo.get("stream"));
                JSONObject result = listZlmRecordFiles(server, app, stream, period);
                if (result == null) continue;
                JSONArray paths = result.getJSONArray("paths");
                String rootPath = result.getString("rootPath");
                if (paths == null || paths.isEmpty() || rootPath == null) continue;
                for (int i = 0; i < paths.size(); i++) {
                    String fileName = paths.getString(i);
                    Long startTime = parseStartTimeFromName(fileName);
                    if (startTime == null) continue;
                    boolean exists = cloudRecordServiceMapper.existsByFileName(server.getId(), app, stream, fileName) > 0;
                    if (exists) continue;
                    CloudRecordItem item = buildItem(server, app, stream, rootPath, fileName, startTime);
                    if (item == null) continue;
                    cloudRecordServiceMapper.add(item);
                    added++;
                    log.info("[录像对账] 补册孤儿录像: {}/{}/{} 文件:{} 大小:{}", server.getId(), app, stream,
                            fileName, item.getFileSize());
                }
            }
        }
        return added;
    }

    /** 调 ZLM getMp4RecordFile（实测该 API 同时接受 GET/POST，这里与项目其它直连调用一致用 GET） */
    private JSONObject listZlmRecordFiles(MediaServer server, String app, String stream, String period) {
        try {
            String url = zlmApiUrl + "/index/api/getMp4RecordFile?secret=" + zlmSecret
                    + "&vhost=__defaultVhost__&app=" + java.net.URLEncoder.encode(app, java.nio.charset.StandardCharsets.UTF_8)
                    + "&stream=" + java.net.URLEncoder.encode(stream, java.nio.charset.StandardCharsets.UTF_8)
                    + "&period=" + period;
            try (Response resp = http.newCall(new Request.Builder().url(url).build()).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) return null;
                JSONObject body = JSONObject.parseObject(resp.body().string());
                if (body == null || body.getIntValue("code") != 0) return null;
                return body.getJSONObject("data");
            }
        } catch (Exception e) {
            log.warn("[录像对账] getMp4RecordFile({}/{}/{}) 失败: {}", app, stream, period, e.getMessage());
            return null;
        }
    }

    /** 文件名 yyyy-MM-dd-HH-mm-ss-N.mp4 → 起始毫秒（东八区，与 ZLM 命名约定一致） */
    private static Long parseStartTimeFromName(String fileName) {
        java.util.regex.Matcher m = FILE_NAME_RE.matcher(fileName);
        if (!m.matches()) return null;
        try {
            String ts = m.group(1) + "-" + m.group(2) + "-" + m.group(3) + " "
                    + m.group(4) + ":" + m.group(5) + ":" + m.group(6);
            return DateUtil.yyyy_MM_dd_HH_mm_ssToTimestampMs(ts);
        } catch (Exception e) {
            return null;
        }
    }

    /** 组装补册记录：大小从磁盘实值（容器内路径=rootPath+fileName），时长无法离线还原，按 0 记（回放按 mp4 实际时长播放） */
    private CloudRecordItem buildItem(MediaServer server, String app, String stream,
                                       String rootPath, String fileName, long startTime) {
        try {
            CloudRecordItem item = new CloudRecordItem();
            item.setApp(app);
            item.setStream(stream);
            item.setStartTime(startTime);
            item.setEndTime(startTime); // 时长未知：结束=开始（回放端按文件实际时长处理）
            item.setMediaServerId(server.getId());
            item.setFileName(fileName);
            item.setFolder(rootPath);
            item.setFilePath(rootPath + fileName);
            item.setServerId(userSetting.getServerId());
            item.setFileSize(diskFileSize(rootPath, fileName));
            item.setTimeLen(0);
            return item;
        } catch (Exception e) {
            return null;
        }
    }

    /** 容器内文件大小（rootPath 已是容器内绝对路径）。取不到时以 -1 占位，避免误报 0 字节 */
    private static long diskFileSize(String rootPath, String fileName) {
        try {
            File f = new File(rootPath, fileName);
            return f.exists() ? f.length() : -1;
        } catch (Exception e) {
            return -1;
        }
    }
}
