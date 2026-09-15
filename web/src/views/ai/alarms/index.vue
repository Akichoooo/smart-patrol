<template>
  <div id="aiAlarms" class="app-container">
    <div style="height: calc(100vh - 124px);">
      <!-- 搜索与筛选栏 -->
      <el-form :inline="true" size="mini">
        <el-form-item label="告警类型">
          <el-select v-model="filters.alarmType" placeholder="全部类别" clearable style="width: 160px;">
            <el-option label="全部类别" value="" />
            <el-option label="仪表读数核验" value="meter_gauge" />
            <el-option label="即时单帧抽检" value="manual_debris" />
            <el-option label="指针卡死/超量程" value="meter_abnormal" />
            <el-option label="区域违规安全事件" value="safety" />
          </el-select>
        </el-form-item>
        <el-form-item label="处置状态">
          <el-select v-model="filters.status" placeholder="全部状态" clearable style="width: 140px;">
            <el-option label="全部状态" value="" />
            <el-option label="待人工复核" value="pending" />
            <el-option label="已派发工单" value="dispatched" />
            <el-option label="已处置归档" value="closed" />
            <el-option label="已判定误报" value="false_positive" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="primary" icon="el-icon-search" @click="search">查询</el-button>
          <el-button size="mini" icon="el-icon-refresh" @click="resetFilters">重置</el-button>
        </el-form-item>
        <el-form-item style="float: right;">
          <el-button size="mini" type="danger" plain icon="el-icon-delete" @click="resetToDefaults">
            清空告警记录
          </el-button>
          <el-button size="mini" type="info" plain icon="el-icon-download" @click="exportAlarms">
            导出告警报表
          </el-button>
          <el-tooltip content="刷新列表" placement="top">
            <el-button icon="el-icon-refresh-right" circle size="mini" @click="loadData" />
          </el-tooltip>
        </el-form-item>
      </el-form>

      <!-- 告警列表表格 -->
      <el-table
        ref="alarmTable"
        v-loading="loading"
        size="small"
        :data="filteredAlarms"
        height="calc(100% - 64px)"
        style="width: 100%"
        header-row-class-name="table-header"
      >
        <el-table-column prop="id" label="告警编号" width="160" align="center">
          <template v-slot="scope">
            <span style="font-family: monospace; font-weight: 500;">{{ scope.row.id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="抓拍证据图" width="110" align="center">
          <template v-slot="scope">
            <el-image
              :src="scope.row.snapUrl"
              :preview-src-list="[scope.row.snapUrl]"
              fit="cover"
              style="width: 80px; height: 48px; border-radius: 4px; cursor: pointer; border: 1px solid #dcdfe6;"
            />
          </template>
        </el-table-column>
        <el-table-column label="来源通道 / 任务" min-width="190">
          <template v-slot="scope">
            <div style="font-weight: bold; color: #303133;">
              <i class="el-icon-video-camera" style="color: #409EFF; margin-right: 4px;" />
              {{ scope.row.channelName }}
            </div>
            <div style="font-size: 11px; color: #909399; margin-top: 2px;">
              任务: {{ scope.row.taskName }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="alarmTypeName" label="隐患类型" width="130" align="center">
          <template v-slot="scope">
            <el-tag :type="getRiskTagType(scope.row.riskLevel)" size="mini">
              {{ scope.row.alarmTypeName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="算法检出项" width="160">
          <template v-slot="scope">
            <div style="font-family: monospace; font-size: 11px; color: #E6A23C;">
              初筛: {{ scope.row.yoloLabel }}
            </div>
            <div v-if="scope.row.vlmVerified" style="font-size: 11px; color: #67C23A; margin-top: 2px;">
              <i class="el-icon-circle-check" /> {{ scope.row.vlmModelName }} 研判
            </div>
          </template>
        </el-table-column>
        <el-table-column label="大模型语义研判结论" min-width="260" show-overflow-tooltip>
          <template v-slot="scope">
            <span style="font-size: 12px; color: #606266;">
              {{ scope.row.vlmReasoning }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="time" label="抓拍时间" width="145" align="center" />
        <el-table-column label="处置状态" width="130" align="center">
          <template v-slot="scope">
            <el-tag :type="getStatusTagType(scope.row.status)" size="mini" effect="dark">
              {{ scope.row.statusName }}
            </el-tag>
            <div v-if="scope.row.dispatchInfo" style="font-size: 10px; color: #909399; margin-top: 2px;">
              单号: {{ scope.row.dispatchInfo.orderNo.slice(-6) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="人机协同处置" width="160" fixed="right" align="center">
          <template v-slot="scope">
            <el-button
              size="mini"
              :type="scope.row.status === 'pending' ? 'primary' : 'text'"
              icon="el-icon-coordinate"
              @click="openDispatchModal(scope.row)"
            >
              {{ scope.row.status === 'pending' ? '核验与处置' : '查看工单详情' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 底部统计 -->
      <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; color: #606266; font-size: 13px;">
        <div>
          当前共记录 <b>{{ alarms.length }}</b> 起识别事件（待人工复核：<b style="color: #F56C6C;">{{ pendingCount }}</b> 起，已派单处置：<b style="color: #E6A23C;">{{ dispatchedCount }}</b> 起，已闭环归档：<b style="color: #67C23A;">{{ closedCount }}</b> 起）
        </div>
      </div>
    </div>

    <!-- 告警核验与人机协同派单弹窗 -->
    <el-dialog
      title="告警核验与闭环处置工作台"
      :visible.sync="dispatchModalVisible"
      width="820px"
      :close-on-click-modal="false"
    >
      <div v-if="currentAlarm">
        <!-- 基础元数据栏 -->
        <div style="background: #f4f6f9; padding: 10px 15px; border-radius: 4px; margin-bottom: 15px; display: flex; justify-content: space-between; font-size: 13px;">
          <div><b>告警单号：</b><span style="font-family: monospace;">{{ currentAlarm.id }}</span></div>
          <div><b>来源通道：</b>{{ currentAlarm.channelName }}</div>
          <div><b>抓拍时间：</b>{{ currentAlarm.time }}</div>
        </div>

        <el-row :gutter="20">
          <!-- 左侧：图像证据对比 -->
          <el-col :span="11">
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #303133;">
              <i class="el-icon-picture-outline" /> 抓拍证据原图与目标框
            </div>
            <div style="border: 1px solid #dcdfe6; border-radius: 4px; overflow: hidden; background: #131c26;">
              <img :src="currentAlarm.snapUrl" style="width: 100%; height: 210px; object-fit: cover; display: block;" />
            </div>
            <div style="margin-top: 8px; font-size: 11px; color: #909399; display: flex; justify-content: space-between;">
              <span>初筛目标：<b>{{ currentAlarm.yoloLabel }}</b></span>
              <span>置信度：<b>{{ (currentAlarm.yoloConf * 100).toFixed(1) }}%</b></span>
            </div>
          </el-col>

          <!-- 右侧：大模型研判结论与处置表单 -->
          <el-col :span="13">
            <div style="font-weight: bold; margin-bottom: 8px; font-size: 13px; color: #303133;">
              <i class="el-icon-cpu" /> 多模态大模型智能研判报告
            </div>
            <div style="background: #eef5fe; border-left: 4px solid #409EFF; padding: 10px 12px; font-size: 12px; line-height: 1.6; color: #303133; border-radius: 0 4px 4px 0; max-height: 140px; overflow-y: auto;">
              {{ currentAlarm.vlmReasoning }}
            </div>

            <!-- 人机协同决策表单 (待复核状态可编辑) -->
            <div v-if="currentAlarm.status === 'pending'" style="margin-top: 15px;">
              <el-divider content-position="left"><b>人工复核与处置闭环</b></el-divider>
              <el-form label-width="95px" size="mini">
                <el-form-item label="核实结论">
                  <el-radio-group v-model="dispatchForm.decision">
                    <el-radio label="real">真实隐患 (派发工单)</el-radio>
                    <el-radio label="false">误报排除</el-radio>
                  </el-radio-group>
                </el-form-item>
                <div v-if="dispatchForm.decision === 'real'">
                  <el-form-item label="指派责任人">
                    <el-select v-model="dispatchForm.assignee" placeholder="选择现场处置责任人" style="width: 100%;">
                      <el-option label="张工 (巡检运行一班)" value="张工 (巡检运行一班)" />
                      <el-option label="李工 (防汛应急工程组)" value="李工 (防汛应急工程组)" />
                      <el-option label="王工 (水工设备维修班)" value="王工 (水工设备维修班)" />
                      <el-option label="刘工 (安全环保督导组)" value="刘工 (安全环保督导组)" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="工单紧急度">
                    <el-radio-group v-model="dispatchForm.priority">
                      <el-radio label="紧急"><span style="color: #F56C6C;">紧急 (立即处置)</span></el-radio>
                      <el-radio label="高"><span style="color: #E6A23C;">高 (2小时内)</span></el-radio>
                      <el-radio label="普通">普通 (当日办结)</el-radio>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="处置指令说明">
                    <el-input
                      v-model="dispatchForm.note"
                      type="textarea"
                      :rows="2"
                      placeholder="输入现场处置要求（如：请前往现场核验该表指针实际读数与管道压力）"
                    />
                  </el-form-item>
                </div>
                <div v-else>
                  <el-form-item label="误报排除说明">
                    <el-input
                      v-model="dispatchForm.falseReason"
                      placeholder="说明排除原因（如：表盘反光阴影扰动/非真实异常）"
                    />
                  </el-form-item>
                </div>
              </el-form>
            </div>

            <!-- 已派单/已办结展示 -->
            <div v-else style="margin-top: 15px;">
              <el-divider content-position="left"><b>工单执行跟踪</b></el-divider>
              <div v-if="currentAlarm.dispatchInfo" style="font-size: 12px; line-height: 1.8; background: #fafafa; padding: 10px; border-radius: 4px; border: 1px solid #ebeef5;">
                <div><b>派工单号：</b><span style="color: #409EFF; font-weight: bold;">{{ currentAlarm.dispatchInfo.orderNo }}</span></div>
                <div><b>指定责任人：</b>{{ currentAlarm.dispatchInfo.assignee }}</div>
                <div><b>派发时间：</b>{{ currentAlarm.dispatchInfo.dispatchTime }}</div>
                <div><b>下发指令：</b>{{ currentAlarm.dispatchInfo.note }}</div>
                <div v-if="currentAlarm.dispatchInfo.closeTime" style="color: #67C23A; margin-top: 4px;">
                  <b>办结归档时间：</b>{{ currentAlarm.dispatchInfo.closeTime }} ({{ currentAlarm.dispatchInfo.closeNote }})
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>
      <span slot="footer" class="dialog-footer">
        <el-button size="mini" @click="dispatchModalVisible = false">关 闭</el-button>
        <template v-if="currentAlarm && currentAlarm.status === 'pending'">
          <el-button
            v-if="dispatchForm.decision === 'real'"
            size="mini"
            type="danger"
            icon="el-icon-s-promotion"
            @click="submitDispatch"
          >
            下发工单并闭环派单
          </el-button>
          <el-button
            v-else
            size="mini"
            type="warning"
            icon="el-icon-circle-close"
            @click="submitFalseAlarm"
          >
            确认误报并归档
          </el-button>
        </template>
        <template v-else-if="currentAlarm && currentAlarm.status === 'dispatched'">
          <el-button size="mini" type="success" icon="el-icon-check" @click="closeAlarmOrder">
            完成现场处置并结单归档
          </el-button>
        </template>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import { aiStorage } from '../aiStorage'

export default {
  name: 'AiAlarms',
  data() {
    return {
      loading: false,
      alarms: [],
      filters: {
        alarmType: '',
        status: ''
      },
      dispatchModalVisible: false,
      currentAlarm: null,
      dispatchForm: {
        decision: 'real',
        assignee: '张工 (巡检运行一班)',
        priority: '高',
        note: '立即组织人员前往现场处置排查，完成后上传闭环照片。',
        falseReason: '目标非固体漂浮杂物，为水波反光'
      }
    }
  },
  computed: {
    filteredAlarms() {
      return this.alarms.filter(a => {
        const matchType = !this.filters.alarmType || a.alarmType === this.filters.alarmType
        const matchStatus = !this.filters.status || a.status === this.filters.status
        return matchType && matchStatus
      })
    },
    pendingCount() {
      return this.alarms.filter(a => a.status === 'pending').length
    },
    dispatchedCount() {
      return this.alarms.filter(a => a.status === 'dispatched').length
    },
    closedCount() {
      return this.alarms.filter(a => a.status === 'closed').length
    }
  },
  created() {
    this.loadData()
  },
  methods: {
    loadData() {
      this.loading = true
      setTimeout(() => {
        this.alarms = aiStorage.getAlarms()
        this.loading = false
      }, 150)
    },
    resetToDefaults() {
      this.$confirm('确认清空全部历史告警记录并重置吗？', '清空确认', { type: 'warning' })
        .then(() => {
          aiStorage.resetAllData()
          this.loadData()
          this.$message.success('已清空历史告警记录！')
        }).catch(() => {})
    },
    search() {
      // handled by computed
    },
    resetFilters() {
      this.filters.alarmType = ''
      this.filters.status = ''
    },
    getRiskTagType(level) {
      if (level === 'high') return 'danger'
      if (level === 'medium') return 'warning'
      return 'info'
    },
    getStatusTagType(status) {
      const map = {
        pending: 'danger',
        dispatched: 'warning',
        closed: 'success',
        false_positive: 'info'
      }
      return map[status] || 'info'
    },
    openDispatchModal(row) {
      this.currentAlarm = JSON.parse(JSON.stringify(row))
      this.dispatchForm = {
        decision: 'real',
        assignee: '张工 (巡检运行一班)',
        priority: '高',
        note: '立即排查处置【' + row.alarmTypeName + '】，完成后上传闭环照片。',
        falseReason: '目标非隐患，确认为正常作业或环境扰动'
      }
      this.dispatchModalVisible = true
    },
    submitDispatch() {
      if (!this.dispatchForm.assignee) {
        this.$message.warning('请选择指派的现场处置责任人')
        return
      }
      aiStorage.dispatchAlarm(this.currentAlarm.id, this.dispatchForm)
      this.$notify({
        title: '工单下发成功',
        message: `告警已转为工单派发至 [${this.dispatchForm.assignee}]，优先级别：${this.dispatchForm.priority}`,
        type: 'success'
      })
      this.dispatchModalVisible = false
      this.loadData()
    },
    submitFalseAlarm() {
      aiStorage.markFalseAlarm(this.currentAlarm.id, this.dispatchForm.falseReason)
      this.$message.success('已标记为误报并归档')
      this.dispatchModalVisible = false
      this.loadData()
    },
    closeAlarmOrder() {
      aiStorage.closeAlarm(this.currentAlarm.id, '现场处理合格，已完成闭环验收')
      this.$message.success('工单已办结并归档！')
      this.dispatchModalVisible = false
      this.loadData()
    },
    exportAlarms() {
      this.$message.success('已生成告警巡检报表并开始下载 (CSV)')
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
