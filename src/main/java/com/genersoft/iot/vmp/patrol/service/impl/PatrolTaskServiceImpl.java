package com.genersoft.iot.vmp.patrol.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.bean.PatrolExecutionStatus;
import com.genersoft.iot.vmp.patrol.dao.PatrolTaskMapper;
import com.genersoft.iot.vmp.patrol.service.PatrolTaskService;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 巡检任务与执行编排服务实现
 *
 * @author WVP-Pro
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PatrolTaskServiceImpl implements PatrolTaskService {

    private final PatrolTaskMapper mapper;

    @Override
    public List<Map<String, Object>> listTasks(String keyword, String type) {
        return mapper.taskList(keyword, type);
    }

    @Override
    public Map<String, Object> getTask(int id) {
        Map<String, Object> task = mapper.taskGet(id);
        if (task == null) {
            log.warn("[巡检-任务] 任务不存在: taskId={}", id);
            throw new ControllerException(ErrorCode.ERROR404);
        }
        task.put("points", mapper.pointsOfTask(id));
        return task;
    }

    @Override
    public List<Map<String, Object>> getTaskPoints(int taskId) {
        return mapper.pointsOfTask(taskId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int saveTask(Map<String, Object> body, String creator) {
        Map<String, Object> task = new HashMap<>();
        task.put("name", body.get("name"));
        task.put("type", body.getOrDefault("type", "ROUTINE"));
        task.put("robotDeviceId", body.get("robotDeviceId"));
        task.put("priority", body.getOrDefault("priority", "1"));
        task.put("creator", body.get("creator") != null ? body.get("creator") : creator);
        task.put("timePlansJson", body.get("timePlans") == null ? "[]" : JSONArray.toJSONString(body.get("timePlans")));
        task.put("defaultSchemeId", body.get("defaultSchemeId"));
        task.put("enabled", 0);
        task.put("remark", body.get("remark"));

        mapper.taskInsert(task);
        int taskId = Integer.parseInt(String.valueOf(task.get("id")));
        savePoints(taskId, body.get("points"));
        log.info("[巡检-任务] 创建任务成功: taskId={}, name={}, creator={}", taskId, task.get("name"), creator);
        return taskId;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateTask(int id, Map<String, Object> body) {
        Map<String, Object> task = new HashMap<>();
        task.put("id", id);
        task.put("name", body.get("name"));
        task.put("type", body.getOrDefault("type", "ROUTINE"));
        task.put("robotDeviceId", body.get("robotDeviceId"));
        task.put("priority", body.getOrDefault("priority", "1"));
        task.put("timePlansJson", body.get("timePlans") == null ? "[]" : JSONArray.toJSONString(body.get("timePlans")));
        task.put("defaultSchemeId", body.get("defaultSchemeId"));
        task.put("remark", body.get("remark"));

        mapper.taskUpdate(task);
        mapper.pointsClear(id);
        savePoints(id, body.get("points"));
        log.info("[巡检-任务] 更新任务成功: taskId={}, name={}", id, task.get("name"));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteTask(int id) {
        mapper.pointsClear(id);
        mapper.taskDelete(id);
        log.info("[巡检-任务] 删除任务成功: taskId={}", id);
    }

    @Override
    public void setTaskEnabled(int id, boolean enabled) {
        mapper.taskEnable(id, enabled);
        log.info("[巡检-任务] 切换任务启用状态: taskId={}, enabled={}", id, enabled);
    }

    @Override
    public List<Map<String, Object>> listExecutingTasks() {
        List<Map<String, Object>> running = mapper.executingList();
        if (running == null || running.isEmpty()) {
            return mapper.executionRecent(20);
        }
        return running;
    }

    @Override
    public void pauseExecution(int execId) {
        Map<String, Object> e = new HashMap<>();
        e.put("id", execId);
        e.put("status", PatrolExecutionStatus.PAUSED.getCode());
        e.put("progress", null);
        e.put("finishedPoints", null);
        e.put("abnormalPoints", null);
        e.put("errorMsg", null);
        mapper.executionUpdate(e);
        log.info("[巡检-执行] 暂停任务执行: execId={}", execId);
    }

    @Override
    public void resumeExecution(int execId) {
        Map<String, Object> e = new HashMap<>();
        e.put("id", execId);
        e.put("status", PatrolExecutionStatus.RUNNING.getCode());
        e.put("progress", null);
        e.put("finishedPoints", null);
        e.put("abnormalPoints", null);
        e.put("errorMsg", null);
        mapper.executionUpdate(e);
        log.info("[巡检-执行] 恢复任务执行: execId={}", execId);
    }

    @Override
    public void stopExecution(int execId) {
        mapper.executionFinish(execId, PatrolExecutionStatus.STOPPED.getCode());
        log.info("[巡检-执行] 终止任务执行: execId={}", execId);
    }

    @Override
    public Map<String, Object> getExecutionProgress(int execId) {
        Map<String, Object> exec = mapper.executionGet(execId);
        if (exec != null) {
            exec.put("points", mapper.resultsOfExecution(execId));
        }
        return exec;
    }

    /**
     * 批量保存任务绑定的点位序列
     */
    @SuppressWarnings("unchecked")
    private void savePoints(int taskId, Object points) {
        if (!(points instanceof List<?> list)) return;
        int seq = 0;
        for (Object o : list) {
            if (!(o instanceof Map)) continue;
            JSONObject p = new JSONObject((Map<String, Object>) o);
            Map<String, Object> point = new HashMap<>();
            point.put("taskId", taskId);
            point.put("waypointId", p.getInteger("waypointId"));
            point.put("seq", seq++);
            point.put("captureMode", p.getString("captureMode") == null ? "PHOTO" : p.getString("captureMode"));
            point.put("schemeId", p.getInteger("schemeId")); // null 代表跟随任务级默认方案
            point.put("paramsJson", p.getString("params"));
            mapper.pointInsert(point);
        }
    }
}
