package com.genersoft.iot.vmp.patrol.controller;

import com.genersoft.iot.vmp.conf.exception.ControllerException;
import com.genersoft.iot.vmp.patrol.bean.PatrolStatus;
import com.genersoft.iot.vmp.patrol.orchestrator.PatrolOrchestrator;
import com.genersoft.iot.vmp.patrol.security.Audit;
import com.genersoft.iot.vmp.patrol.security.PatrolSecurityUtils;
import com.genersoft.iot.vmp.patrol.service.PatrolTaskService;
import com.genersoft.iot.vmp.vmanager.bean.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 巡检任务定义、点位编排与任务生命周期调度控制器
 *
 * <p>遵循三层解耦架构，任务 CRUD 与状态维护委托至 {@link PatrolTaskService}，
 * 异步执行编排委托至 {@link PatrolOrchestrator}。
 *
 * @author WVP-Pro
 */
@Tag(name = "巡检平台-任务")
@RestController
@RequestMapping("/api/patrol")
@RequiredArgsConstructor
public class PatrolTaskController {

    private final PatrolTaskService taskService;
    private final PatrolOrchestrator orchestrator;

    @Qualifier("patrolTaskExecutor")
    private final ThreadPoolTaskExecutor patrolTaskExecutor;

    // ---------------- 任务定义与点位 ----------------

    /**
     * 查询巡检任务列表
     *
     * @param keyword 任务名称关键字
     * @param type 任务类型
     * @return 任务列表
     */
    @GetMapping("/task/list")
    @Operation(summary = "任务列表")
    public List<Map<String, Object>> taskList(@RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String type) {
        checkPermission("patrol.task", "view");
        return taskService.listTasks(keyword, type);
    }

    /**
     * 获取单个巡检任务详情（包含绑定的点位明细）
     *
     * @param id 任务ID
     * @return 任务详情
     */
    @GetMapping("/task/{id}")
    @Operation(summary = "任务详情")
    public Map<String, Object> taskGet(@PathVariable int id) {
        checkPermission("patrol.task", "view");
        return taskService.getTask(id);
    }

    /**
     * 获取指定任务包含的点位序列
     *
     * @param id 任务ID
     * @return 任务点位列表
     */
    @GetMapping("/task/{id}/points")
    @Operation(summary = "任务点位")
    public List<Map<String, Object>> taskPoints(@PathVariable int id) {
        checkPermission("patrol.task", "view");
        return taskService.getTaskPoints(id);
    }

    /**
     * 新建巡检任务（含点位批量套用）
     *
     * @param body 任务参数
     * @return 新增任务的主键ID Map
     */
    @PostMapping("/task/save")
    @Audit(module = "patrol.task", action = "create")
    @Operation(summary = "新建任务（含点位批量套用）")
    public Map<String, Object> taskSave(@RequestBody Map<String, Object> body) {
        checkPermission("patrol.task", "create");
        int taskId = taskService.saveTask(body, PatrolSecurityUtils.currentUsername());
        return Map.of("id", taskId);
    }

    /**
     * 更新巡检任务及重置点位序列
     *
     * @param id 任务ID
     * @param body 任务更新参数
     */
    @PostMapping("/task/{id}/update")
    @Audit(module = "patrol.task", action = "edit")
    @Operation(summary = "更新任务")
    public void taskUpdate(@PathVariable int id, @RequestBody Map<String, Object> body) {
        checkPermission("patrol.task", "edit");
        taskService.updateTask(id, body);
    }

    /**
     * 删除巡检任务
     *
     * @param id 任务ID
     */
    @PostMapping("/task/{id}/delete")
    @Audit(module = "patrol.task", action = "delete")
    @Operation(summary = "删除任务")
    public void taskDelete(@PathVariable int id) {
        checkPermission("patrol.task", "delete");
        taskService.deleteTask(id);
    }

    /**
     * 启用定时/例行巡检任务
     *
     * @param id 任务ID
     */
    @PostMapping("/task/{id}/enable")
    @Audit(module = "patrol.task", action = "edit")
    @Operation(summary = "启用任务")
    public void taskEnable(@PathVariable int id) {
        checkPermission("patrol.task", "edit");
        taskService.setTaskEnabled(id, true);
    }

    /**
     * 停用巡检任务
     *
     * @param id 任务ID
     */
    @PostMapping("/task/{id}/disable")
    @Audit(module = "patrol.task", action = "edit")
    @Operation(summary = "停用任务")
    public void taskDisable(@PathVariable int id) {
        checkPermission("patrol.task", "edit");
        taskService.setTaskEnabled(id, false);
    }

    // ---------------- 任务执行与调度 ----------------

    /**
     * 立即触发巡检任务（异步推进，立即返回执行单号）
     *
     * @param id 任务ID
     * @return 执行单号 Map
     */
    @PostMapping("/task/{id}/execute")
    @Audit(module = "patrol.task", action = "execute")
    @Operation(summary = "立即执行（异步）：返回执行单号")
    public Map<String, Object> taskExecute(@PathVariable int id) {
        checkPermission("patrol.task", "execute");
        int executionId = orchestrator.startExecution(id, PatrolStatus.MANUAL);
        // 提交到专有线程池异步推进，保障 HTTP 接口毫秒级返回
        patrolTaskExecutor.execute(() -> orchestrator.runExecution(executionId, id));
        return Map.of("executionId", executionId);
    }

    /**
     * 获取正在执行或最近执行的任务列表
     *
     * @return 执行单列表
     */
    @GetMapping("/task/executing/list")
    @Operation(summary = "执行中列表")
    public List<Map<String, Object>> executingList() {
        checkPermission("patrol.execution", "view");
        return taskService.listExecutingTasks();
    }

    /**
     * 暂停执行中的任务
     *
     * @param execId 执行单ID
     */
    @PostMapping("/task/execution/{execId}/pause")
    @Audit(module = "patrol.execution", action = "execute")
    @Operation(summary = "暂停执行")
    public void execPause(@PathVariable int execId) {
        checkPermission("patrol.execution", "execute");
        taskService.pauseExecution(execId);
    }

    /**
     * 恢复已暂停的任务
     *
     * @param execId 执行单ID
     */
    @PostMapping("/task/execution/{execId}/resume")
    @Audit(module = "patrol.execution", action = "execute")
    @Operation(summary = "恢复执行")
    public void execResume(@PathVariable int execId) {
        checkPermission("patrol.execution", "execute");
        taskService.resumeExecution(execId);
    }

    /**
     * 强制终止任务执行
     *
     * @param execId 执行单ID
     */
    @PostMapping("/task/execution/{execId}/stop")
    @Audit(module = "patrol.execution", action = "execute")
    @Operation(summary = "停止执行（终态）")
    public void execStop(@PathVariable int execId) {
        checkPermission("patrol.execution", "execute");
        taskService.stopExecution(execId);
    }

    /**
     * 查询任务执行进度与点位实时研判明细
     *
     * @param execId 执行单ID
     * @return 执行详情
     */
    @GetMapping("/task/execution/{execId}/progress")
    @Operation(summary = "执行详情（含点位明细）")
    public Map<String, Object> execProgress(@PathVariable int execId) {
        checkPermission("patrol.execution", "view");
        return taskService.getExecutionProgress(execId);
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
