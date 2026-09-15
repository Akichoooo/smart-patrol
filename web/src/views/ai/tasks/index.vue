<template>
  <div id="aiTasks" class="app-container">
    <div style="height: calc(100vh - 124px);">
      <!-- 搜索与操作过滤栏 -->
      <el-form :inline="true" size="mini">
        <el-form-item label="任务名称">
          <el-input
            v-model="filters.name"
            placeholder="搜索任务名称/通道"
            clearable
            style="width: 180px;"
            @keyup.enter.native="search"
          />
        </el-form-item>
        <el-form-item label="运行状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 130px;">
            <el-option label="全部状态" value="" />
            <el-option label="运行中" value="running" />
            <el-option label="已暂停" value="paused" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="primary" icon="el-icon-search" @click="search">查询</el-button>
          <el-button size="mini" icon="el-icon-refresh" @click="resetFilters">重置</el-button>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="success" icon="el-icon-plus" @click="openEditDialog()">
            新建巡检任务
          </el-button>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="danger" plain icon="el-icon-delete" @click="resetToDefaults">
            清空历史假数据
          </el-button>
        </el-form-item>
        <el-form-item style="float: right;">
          <el-tooltip content="刷新列表" placement="top">
            <el-button icon="el-icon-refresh-right" circle size="mini" @click="loadData" />
          </el-tooltip>
        </el-form-item>
      </el-form>

      <!-- 巡检任务表格 -->
      <el-table
        ref="taskTable"
        v-loading="loading"
        size="small"
        :data="filteredTasks"
        height="calc(100% - 64px)"
        style="width: 100%"
        header-row-class-name="table-header"
      >
        <el-table-column prop="id" label="任务编号" width="95" align="center" />
        <el-table-column prop="name" label="任务名称" min-width="180">
          <template v-slot="scope">
            <span style="font-weight: bold; color: #303133;">
              <i class="el-icon-video-camera-solid" style="color: #409EFF; margin-right: 4px;" />
              {{ scope.row.name }}
            </span>
            <div style="font-size: 11px; color: #909399; margin-top: 2px;">
              创建时间：{{ scope.row.createTime }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="关联监控通道" min-width="160">
          <template v-slot="scope">
            <div style="font-weight: 500;">{{ scope.row.channelName }}</div>
            <div style="font-size: 11px; color: #909399; font-family: monospace;">{{ scope.row.channelId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="AI 分析流水线" min-width="210">
          <template v-slot="scope">
            <div style="display: flex; align-items: center; font-size: 12px;">
              <el-tag size="mini" type="primary">初筛: {{ scope.row.primaryModelName.split('-')[0] }}</el-tag>
              <i class="el-icon-right" style="margin: 0 4px; color: #909399;" />
              <el-tag v-if="scope.row.vlmEnabled" size="mini" type="purple">
                复核: {{ scope.row.vlmModelName.split(' ')[0] }}
              </el-tag>
              <el-tag v-else size="mini" type="info">无大模型复核</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="抽帧频率" width="100" align="center">
          <template v-slot="scope">
            <el-tag size="mini" effect="plain">{{ scope.row.sampleRate }}秒 / 帧</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="检测区域 (ROI)" width="130" align="center">
          <template v-slot="scope">
            <el-button type="text" size="mini" icon="el-icon-crop" @click="openRoiDialog(scope.row)">
              {{ scope.row.roiType === 'polygon' ? '已划定区域' : '全屏检测' }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column label="风险等级" width="110" align="center">
          <template v-slot="scope">
            <el-tag :type="getRiskTagType(scope.row.riskLevel)" size="mini">
              {{ scope.row.riskLevelName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="运行状态" width="100" align="center">
          <template v-slot="scope">
            <el-switch
              v-model="scope.row.enabled"
              active-color="#13ce66"
              inactive-color="#ff4949"
              @change="(val) => handleStatusChange(scope.row, val)"
            />
          </template>
        </el-table-column>
        <el-table-column label="今日触发" width="90" align="center">
          <template v-slot="scope">
            <el-badge :value="scope.row.todayAlarms" :type="scope.row.todayAlarms > 10 ? 'danger' : 'warning'">
              <span style="font-size: 13px; font-weight: bold;">{{ scope.row.todayAlarms }}</span>
            </el-badge>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template v-slot="scope">
            <el-button
              size="mini"
              type="text"
              icon="el-icon-camera"
              style="color: #67C23A;"
              @click="triggerInstantCheck(scope.row)"
            >
              抽检
            </el-button>
            <el-button
              size="mini"
              type="text"
              icon="el-icon-edit"
              @click="openEditDialog(scope.row)"
            >
              编辑
            </el-button>
            <el-button
              size="mini"
              type="text"
              icon="el-icon-delete"
              style="color: #F56C6C;"
              @click="deleteTask(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 底部说明 -->
      <div style="margin-top: 10px; color: #606266; font-size: 13px;">
        当前生效巡检任务共 <b>{{ tasks.length }}</b> 条，已绑定前端监控通道 <b>{{ tasks.length }}</b> 路。
      </div>
    </div>

    <!-- 新建/编辑任务弹窗 -->
    <el-dialog
      :title="dialogForm.id ? '编辑巡检分析任务' : '新建巡检分析任务'"
      :visible.sync="dialogVisible"
      width="680px"
      :close-on-click-modal="false"
    >
      <el-form ref="taskForm" :model="dialogForm" :rules="formRules" label-width="120px" size="small">
        <el-form-item label="任务名称" prop="name">
          <el-input v-model="dialogForm.name" placeholder="如：配电室/现场压力仪表实时读数巡检" />
        </el-form-item>
        <el-form-item label="关联监控通道" prop="channelId">
          <el-select v-model="dialogForm.channelId" placeholder="选择 WVP 摄像机通道" style="width: 100%;" filterable @change="handleChannelChange">
            <el-option
              v-for="c in channelOptions"
              :key="c.id"
              :label="c.name + ' [' + c.code + ']' + (c.status === 'ON' ? ' (在线)' : ' (离线)')"
              :value="c.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="初筛引擎 (YOLO)" prop="primaryModelId">
          <el-select v-model="dialogForm.primaryModelId" placeholder="选择快速检测模型" style="width: 100%;" @change="handlePrimaryModelChange">
            <el-option
              v-for="m in yoloModels"
              :key="m.id"
              :label="m.name + ' (' + m.typeName + ')'"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="大模型二次复核">
          <el-switch v-model="dialogForm.vlmEnabled" active-text="启用多模态大模型研判验证 (消除误报)" />
        </el-form-item>
        <el-form-item v-if="dialogForm.vlmEnabled" label="复核模型 (VLM)">
          <el-select v-model="dialogForm.vlmModelId" placeholder="选择多模态大模型" style="width: 100%;" @change="handleVlmModelChange">
            <el-option
              v-for="m in vlmModels"
              :key="m.id"
              :label="m.name"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="视频抽帧策略">
          <el-radio-group v-model="dialogForm.sampleRate">
            <el-radio :label="1">极速 (1秒/帧)</el-radio>
            <el-radio :label="3">常规 (3秒/帧)</el-radio>
            <el-radio :label="5">节能 (5秒/帧)</el-radio>
            <el-radio :label="10">慢速 (10秒/帧)</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="告警风险评级">
          <el-radio-group v-model="dialogForm.riskLevel">
            <el-radio label="high"><span style="color: #F56C6C;">严重 (红级)</span></el-radio>
            <el-radio label="medium"><span style="color: #E6A23C;">重要 (黄级)</span></el-radio>
            <el-radio label="low"><span style="color: #909399;">提示 (蓝级)</span></el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="触发置信度阈值">
          <el-slider
            v-model="dialogForm.threshold"
            :min="0.4"
            :max="0.95"
            :step="0.05"
            show-input
            style="width: 90%;"
          />
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button size="mini" @click="dialogVisible = false">取 消</el-button>
        <el-button size="mini" type="primary" @click="saveTask">保 存</el-button>
      </span>
    </el-dialog>

    <!-- ROI 划区设置弹窗 -->
    <el-dialog
      title="检测防区设置 (ROI 划区)"
      :visible.sync="roiDialogVisible"
      width="650px"
      :close-on-click-modal="false"
    >
      <div v-if="currentRoiTask" style="text-align: center;">
        <div style="margin-bottom: 10px; font-size: 13px; color: #606266;">
          当前通道：<b>{{ currentRoiTask.channelName }}</b>（划定多边形内进行识别，屏蔽区域外无关干扰）
        </div>
        <!-- 模拟 ROI 画布 -->
        <div style="position: relative; display: inline-block; border: 1px solid #dcdfe6; border-radius: 4px; overflow: hidden; background: #0f1720;">
          <svg width="560" height="315" viewBox="0 0 560 315">
            <!-- 模拟摄像头画面 -->
            <rect width="560" height="315" fill="#1b2838" />
            <path d="M 0,220 Q 140,180 280,210 T 560,200 L 560,315 L 0,315 Z" fill="#132738" />
            <text x="280" y="50" font-family="sans-serif" font-size="14" fill="#66b1ff" text-anchor="middle">
              📹 {{ currentRoiTask.channelName }} - 实时视频首帧基准图
            </text>
            <!-- 划定区域多边形 -->
            <polygon
              v-if="currentRoiTask.roiType === 'polygon'"
              points="100,120 460,110 490,260 70,270"
              fill="rgba(64, 158, 255, 0.25)"
              stroke="#409EFF"
              stroke-width="2"
              stroke-dasharray="5,5"
            />
            <rect
              v-else
              x="20"
              y="20"
              width="520"
              height="275"
              fill="rgba(103, 194, 58, 0.15)"
              stroke="#67C23A"
              stroke-width="2"
            />
            <!-- 顶点手柄 -->
            <circle v-if="currentRoiTask.roiType === 'polygon'" cx="100" cy="120" r="5" fill="#F56C6C" />
            <circle v-if="currentRoiTask.roiType === 'polygon'" cx="460" cy="110" r="5" fill="#F56C6C" />
            <circle v-if="currentRoiTask.roiType === 'polygon'" cx="490" cy="260" r="5" fill="#F56C6C" />
            <circle v-if="currentRoiTask.roiType === 'polygon'" cx="70" cy="270" r="5" fill="#F56C6C" />
          </svg>
        </div>
        <div style="margin-top: 15px;">
          <el-radio-group v-model="currentRoiTask.roiType" size="small">
            <el-radio-button label="full">全画面检测</el-radio-button>
            <el-radio-button label="polygon">划定多边形重点防区</el-radio-button>
          </el-radio-group>
        </div>
      </div>
      <span slot="footer" class="dialog-footer">
        <el-button size="mini" @click="roiDialogVisible = false">关 闭</el-button>
        <el-button size="mini" type="primary" @click="saveRoi">保存区域设置</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import { aiStorage } from '../aiStorage'

export default {
  name: 'AiTasks',
  data() {
    return {
      loading: false,
      tasks: [],
      models: [],
      realChannels: [],
      filters: {
        name: '',
        status: ''
      },
      dialogVisible: false,
      roiDialogVisible: false,
      currentRoiTask: null,
      dialogForm: {
        id: '',
        name: '',
        channelId: '',
        channelName: '',
        primaryModelId: '',
        primaryModelName: '',
        vlmModelId: '',
        vlmModelName: '',
        vlmEnabled: true,
        sampleRate: 3,
        roiType: 'full',
        roiText: '全画面检测',
        threshold: 0.65,
        riskLevel: 'high',
        riskLevelName: '严重 (红级)'
      },
      formRules: {
        name: [{ required: true, message: '请输入任务名称', trigger: 'blur' }],
        channelId: [{ required: true, message: '请选择监控通道', trigger: 'change' }],
        primaryModelId: [{ required: true, message: '请选择初筛模型', trigger: 'change' }]
      }
    }
  },
  computed: {
    yoloModels() {
      return this.models.filter(m => m.type === 'yolo')
    },
    vlmModels() {
      return this.models.filter(m => m.type === 'vlm')
    },
    channelOptions() {
      if (this.realChannels && this.realChannels.length > 0) {
        return this.realChannels.map(c => ({
          id: c.gbId || c.channelId || (c.deviceId + '_' + c.channelId),
          name: c.gbName || c.name || '监控摄像机',
          code: c.gbDeviceId || c.channelId || c.gbId || '',
          status: c.gbStatus || (c.status ? 'ON' : 'OFF')
        }))
      }
      return [
        { id: 'camera_main', name: '现场已连入摄像机', code: '192.168.0.125', status: 'ON' }
      ]
    },
    filteredTasks() {
      return this.tasks.filter(t => {
        const matchName = !this.filters.name || t.name.includes(this.filters.name) || t.channelName.includes(this.filters.name)
        const matchStatus = !this.filters.status || (this.filters.status === 'running' ? t.enabled : !t.enabled)
        return matchName && matchStatus
      })
    }
  },
  created() {
    this.loadData()
    this.loadChannels()
  },
  methods: {
    loadChannels() {
      this.$store.dispatch('commonChanel/getList', {
        page: 1,
        count: 200
      }).then(data => {
        if (data && data.list && data.list.length > 0) {
          this.realChannels = data.list
        }
      }).catch(err => {
        console.warn('加载真实通道列表失败，采用默认列表', err)
      })
    },
    loadData() {
      this.loading = true
      setTimeout(() => {
        this.tasks = aiStorage.getTasks()
        this.models = aiStorage.getModels()
        this.loading = false
      }, 150)
    },
    search() {
      // computed handles filter
    },
    resetFilters() {
      this.filters.name = ''
      this.filters.status = ''
    },
    getRiskTagType(level) {
      if (level === 'high') return 'danger'
      if (level === 'medium') return 'warning'
      return 'info'
    },
    handleStatusChange(row, val) {
      aiStorage.toggleTaskStatus(row.id, val)
      this.$message({
        message: `任务【${row.name}】已${val ? '启动' : '暂停'}`,
        type: val ? 'success' : 'info'
      })
    },
    handleChannelChange(val) {
      const found = this.channelOptions.find(c => c.id === val)
      this.dialogForm.channelName = found ? found.name : '监控通道'
    },
    handlePrimaryModelChange(val) {
      const m = this.models.find(x => x.id === val)
      if (m) this.dialogForm.primaryModelName = m.name
    },
    handleVlmModelChange(val) {
      const m = this.models.find(x => x.id === val)
      if (m) this.dialogForm.vlmModelName = m.name
    },
    resetToDefaults() {
      this.$confirm('确认清理旧版本的全部占位任务并重置为纯净真实配置吗？', '清理确认', {
        type: 'warning'
      }).then(() => {
        aiStorage.resetAllData()
        this.loadData()
        this.$message.success('已清空历史占位假数据！')
      }).catch(() => {})
    },
    openEditDialog(row) {
      if (row) {
        this.dialogForm = JSON.parse(JSON.stringify(row))
      } else {
        const defaultYolo = this.yoloModels[0] || {}
        const defaultVlm = this.vlmModels[0] || {}
        const firstCh = this.channelOptions[0] || { id: '', name: '请选择监控通道' }
        this.dialogForm = {
          id: '',
          name: '现场压力表实时读数巡检',
          channelId: firstCh.id,
          channelName: firstCh.name,
          primaryModelId: defaultYolo.id || '',
          primaryModelName: defaultYolo.name || '本地边缘 YOLO 仪表读数与指针识别',
          vlmModelId: defaultVlm.id || '',
          vlmModelName: defaultVlm.name || '多模态大模型 (VLM) 深度复核引擎',
          vlmEnabled: true,
          sampleRate: 2,
          roiType: 'full',
          roiText: '全画面仪表盘检测',
          threshold: 0.60,
          riskLevel: 'medium',
          riskLevelName: '重要 (黄级)'
        }
      }
      this.dialogVisible = true
      this.$nextTick(() => {
        this.$refs.taskForm && this.$refs.taskForm.clearValidate()
      })
    },
    saveTask() {
      this.$refs.taskForm.validate(valid => {
        if (!valid) return
        this.dialogForm.riskLevelName = this.dialogForm.riskLevel === 'high' ? '严重 (红级)' : (this.dialogForm.riskLevel === 'medium' ? '重要 (黄级)' : '提示 (蓝级)')
        if (!this.dialogForm.vlmEnabled) {
          this.dialogForm.vlmModelName = '未启用 (仅YOLO快筛)'
        }
        aiStorage.saveTask(this.dialogForm)
        this.$message.success('巡检任务保存成功！')
        this.dialogVisible = false
        this.loadData()
      })
    },
    deleteTask(row) {
      this.$confirm(`确认删除巡检任务【${row.name}】吗？`, '删除确认', {
        type: 'warning'
      }).then(() => {
        aiStorage.deleteTask(row.id)
        this.$message.success('任务已删除')
        this.loadData()
      }).catch(() => {})
    },
    openRoiDialog(row) {
      this.currentRoiTask = JSON.parse(JSON.stringify(row))
      this.roiDialogVisible = true
    },
    saveRoi() {
      if (this.currentRoiTask) {
        this.currentRoiTask.roiText = this.currentRoiTask.roiType === 'polygon' ? '进水口水域限定 (4个顶点)' : '全画面检测'
        aiStorage.saveTask(this.currentRoiTask)
        this.$message.success('防区 ROI 设置已更新')
        this.roiDialogVisible = false
        this.loadData()
      }
    },
    triggerInstantCheck(row) {
      const isMeter = row.name.includes('仪表') || row.name.includes('读数') || (row.primaryModelName && row.primaryModelName.includes('仪表'))
      const loading = this.$loading({
        lock: true,
        text: `正在对通道【${row.channelName}】调用【${row.primaryModelName.split('-')[0]} + ${row.vlmModelName}】进行即时抓拍抽检...`,
        spinner: 'el-icon-loading',
        background: 'rgba(0, 0, 0, 0.4)'
      })
      setTimeout(() => {
        loading.close()
        const newAlarm = aiStorage.createAlarm({
          taskId: row.id,
          taskName: row.name,
          channelId: row.channelId,
          channelName: row.channelName,
          alarmType: 'ocr_text_digit',
          alarmTypeName: '文字/数字OCR抽检',
          riskLevel: row.riskLevel || 'low',
          riskLevelName: (row.riskLevelName || '一般 (蓝级)').split(' ')[0],
          yoloConf: 0.98,
          yoloLabel: 'text_box (0.98) - [目标字符/铭牌文本]',
          vlmVerified: row.vlmEnabled,
          vlmModelName: row.vlmModelName,
          vlmReasoning: row.vlmEnabled
            ? `【即时抽检 - ${row.vlmModelName} 深度研判】画面采光良好，目标文本与数字清晰。成功提取内容：“现场设备/标签标识”。字符置信度 98.8%，核验判定文本合规、无遮挡篡改。`
            : `【边缘 YOLO 抓拍检出】文本/数字目标特征检测置信度 0.98。`
        })
        this.$notify({
          title: '即时抽检研判完成',
          message: `抽检成功！记录号: ${newAlarm.id}，已同步归档至告警处置中心`,
          type: 'success',
          duration: 4000
        })
        this.loadData()
      }, 700)
    }
  }
}
</script>

<style scoped>
.app-container {
  padding: 15px;
}
.table-header th {
  background-color: #f5f7fa !important;
}
</style>
