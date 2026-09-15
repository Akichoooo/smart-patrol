package com.genersoft.iot.vmp.patrol.service;

import java.util.List;
import java.util.Map;

/**
 * 巡检任务与执行编排服务接口
 *
 * @author WVP-Pro
 */
public interface PatrolTaskService {

    /**
     * 查询任务列表（支持按任务名模糊与按任务类型检索）
     *
     * @param keyword 任务名称关键字
     * @param type 任务类型编码 (ROUTINE/SPECIAL/CUSTOM)
     * @return 任务概要列表
     */
    List<Map<String, Object>> listTasks(String keyword, String type);

    /**
     * 获取任务详情（包含绑定的点位列表）
     *
     * @param id 任务ID
     * @return 任务详情及点位明细，不存在则抛出 404
     */
    Map<String, Object> getTask(int id);

    /**
     * 获取任务绑定的点位序列
     *
     * @param taskId 任务ID
     * @return 顺序点位列表
     */
    List<Map<String, Object>> getTaskPoints(int taskId);

    /**
     * 创建巡检任务并保存绑定的点位序列
     *
     * @param body 任务参数（含 points 数组）
     * @param creator 创建人用户名
     * @return 新增的任务ID
     */
    int saveTask(Map<String, Object> body, String creator);

    /**
     * 更新巡检任务信息与重置点位序列
     *
     * @param id 任务ID
     * @param body 任务更新参数
     */
    void updateTask(int id, Map<String, Object> body);

    /**
     * 删除任务及清理关联的任务点位
     *
     * @param id 任务ID
     */
    void deleteTask(int id);

    /**
     * 启用或停用任务
     *
     * @param id 任务ID
     * @param enabled 是否启用
     */
    void setTaskEnabled(int id, boolean enabled);

    /**
     * 获取正在执行或最近执行的任务执行单列表
     *
     * @return 执行单列表
     */
    List<Map<String, Object>> listExecutingTasks();

    /**
     * 暂停任务执行
     *
     * @param execId 执行单ID
     */
    void pauseExecution(int execId);

    /**
     * 恢复任务执行
     *
     * @param execId 执行单ID
     */
    void resumeExecution(int execId);

    /**
     * 强制终止任务执行
     *
     * @param execId 执行单ID
     */
    void stopExecution(int execId);

    /**
     * 获取任务执行进度与点位研判明细
     *
     * @param execId 执行单ID
     * @return 执行明细及已执行点位结果
     */
    Map<String, Object> getExecutionProgress(int execId);
}
