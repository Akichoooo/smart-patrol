<template>
  <div id="aiModels" class="app-container">
    <div style="height: calc(100vh - 124px);">
      <!-- 搜索与操作过滤栏 (WVP 原生样式) -->
      <el-form :inline="true" size="mini">
        <el-form-item label="模型名称">
          <el-input
            v-model="filters.name"
            placeholder="搜索模型名称/标识"
            clearable
            style="width: 180px;"
            @keyup.enter.native="search"
          />
        </el-form-item>
        <el-form-item label="模型类型">
          <el-select v-model="filters.type" placeholder="全部类型" clearable style="width: 150px;">
            <el-option label="全部类型" value="" />
            <el-option label="本地边缘 YOLO" value="yolo" />
            <el-option label="云端多模态 VLM" value="vlm" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="primary" icon="el-icon-search" @click="search">查询</el-button>
          <el-button size="mini" icon="el-icon-refresh" @click="resetFilters">重置</el-button>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="success" icon="el-icon-plus" @click="openEditDialog()">
            添加模型服务
          </el-button>
        </el-form-item>
        <el-form-item>
          <el-button size="mini" type="warning" plain icon="el-icon-connection" @click="testAllConnection">
            批量测试连通性
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

      <!-- 模型列表表格 -->
      <el-table
        ref="modelTable"
        v-loading="loading"
        size="small"
        :data="filteredModels"
        height="calc(100% - 64px)"
        style="width: 100%"
        header-row-class-name="table-header"
      >
        <el-table-column prop="id" label="ID" width="70" align="center" />
        <el-table-column prop="name" label="模型名称" min-width="160">
          <template v-slot="scope">
            <span style="font-weight: bold; color: #409EFF;">
              <i :class="scope.row.type === 'yolo' ? 'el-icon-cpu' : 'el-icon-chat-dot-round'" style="margin-right: 4px;" />
              {{ scope.row.name }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="130" align="center">
          <template v-slot="scope">
            <el-tag :type="scope.row.type === 'yolo' ? 'primary' : 'purple'" size="mini" effect="light">
              {{ scope.row.typeName }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="modelName" label="模型标识/代号" width="140" show-overflow-tooltip />
        <el-table-column prop="endpoint" label="接口地址 (Endpoint)" min-width="200" show-overflow-tooltip>
          <template v-slot="scope">
            <span style="font-family: monospace; font-size: 12px;">{{ scope.row.endpoint }}</span>
          </template>
        </el-table-column>
        <el-table-column label="API Key / 鉴权" width="130">
          <template v-slot="scope">
            <span v-if="!scope.row.apiKey" style="color: #909399; font-size: 12px;">无需凭证</span>
            <span v-else style="font-family: monospace; font-size: 12px; color: #67C23A;">
              sk-****{{ scope.row.apiKey.slice(-4) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="识别目标与能力" min-width="180">
          <template v-slot="scope">
            <el-tag
              v-for="(cap, idx) in (scope.row.capabilities || []).slice(0, 3)"
              :key="idx"
              size="mini"
              type="info"
              style="margin-right: 4px; margin-bottom: 2px;"
            >
              {{ cap }}
            </el-tag>
            <span v-if="(scope.row.capabilities || []).length > 3" style="color: #909399; font-size: 11px;">
              +{{ scope.row.capabilities.length - 3 }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="健康状态" width="120" align="center">
          <template v-slot="scope">
            <el-tag size="mini" type="success">
              <i class="el-icon-circle-check" /> 正常 ({{ scope.row.latency }})
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right" align="center">
          <template v-slot="scope">
            <el-button
              size="mini"
              type="text"
              icon="el-icon-link"
              style="color: #E6A23C;"
              @click="testSingleConnection(scope.row)"
            >
              测试
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
              @click="deleteModel(scope.row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 底部统计说明 -->
      <div style="margin-top: 10px; display: flex; justify-content: space-between; align-items: center; color: #606266; font-size: 13px;">
        <div>
          共登记 <b>{{ models.length }}</b> 个算法引擎（YOLO 边缘引擎: <b>{{ yoloCount }}</b> 个，VLM 多模态大模型: <b>{{ vlmCount }}</b> 个）
        </div>
        <el-button type="text" size="mini" @click="resetToFactory">恢复默认示例数据</el-button>
      </div>
    </div>

    <!-- 添加/编辑模型弹窗 (深度还原用户配置面板设计) -->
    <el-dialog
      :visible.sync="dialogVisible"
      width="640px"
      :close-on-click-modal="false"
      custom-class="model-config-dialog"
    >
      <div slot="title" style="display: flex; align-items: center; justify-content: space-between; padding-right: 25px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px; font-weight: bold; color: #303133;">
            {{ dialogForm.name || (dialogForm.type === 'vlm' ? '商汤-zy' : '本地边缘 YOLO') }}
          </span>
          <i class="el-icon-edit" style="color: #909399; font-size: 14px;" />
          <el-radio-group v-model="dialogForm.status" size="mini">
            <el-radio-button label="online">已启用</el-radio-button>
            <el-radio-button label="disabled">禁用</el-radio-button>
          </el-radio-group>
        </div>
        <el-button
          v-if="dialogForm.id"
          type="text"
          icon="el-icon-delete"
          style="color: #909399; font-size: 17px; padding: 0;"
          title="删除该模型"
          @click="deleteModel(dialogForm); dialogVisible = false"
        />
      </div>
      <el-form ref="modelForm" :model="dialogForm" :rules="formRules" label-width="110px" size="small">
        <el-form-item label="服务类别" prop="type">
          <el-radio-group v-model="dialogForm.type" @change="handleTypeChange">
            <el-radio label="yolo">
              <i class="el-icon-cpu" /> 本地/边缘 YOLO 引擎 (目标检测快筛)
            </el-radio>
            <el-radio label="vlm" style="margin-top: 8px;">
              <i class="el-icon-chat-dot-round" /> 云端多模态 VLM 大模型 (语义研判与复核)
            </el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="dialogForm.type === 'vlm'" label="快捷选择厂商">
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <el-button size="mini" type="primary" plain @click="applyProviderPreset('sensenova')">商汤日日新 (SenseNova)</el-button>
            <el-button size="mini" type="success" plain @click="applyProviderPreset('dashscope')">阿里百炼 (Qwen-VL)</el-button>
            <el-button size="mini" type="warning" plain @click="applyProviderPreset('zhipu')">智谱 AI (GLM-4V)</el-button>
            <el-button size="mini" type="info" plain @click="applyProviderPreset('openai')">OpenAI (GPT-4o)</el-button>
            <el-button size="mini" plain @click="applyProviderPreset('siliconflow')">硅基流动 (Qwen2-VL)</el-button>
          </div>
          <div style="font-size: 11px; color: #909399; margin-top: 4px;">
            点击快捷填充厂商标准 Endpoint 与多模态模型代号，原生支持各厂商 Chat Completions 协议
          </div>
        </el-form-item>
        <el-form-item label="模型显示名称" prop="name">
          <el-input v-model="dialogForm.name" placeholder="如：商汤-zy / 通义千问多模态" />
        </el-form-item>
        <el-form-item label="Base URL" prop="endpoint">
          <el-input v-model="dialogForm.endpoint" placeholder="https://token.sensenova.cn/v1" />
        </el-form-item>
        <el-form-item v-if="dialogForm.type === 'vlm'" label="接口协议">
          <el-select v-model="dialogForm.protocol" placeholder="选择接口协议类型" style="width: 100%;">
            <el-option label="Anthropic Messages (/v1/messages)" value="anthropic">
              <span style="float: left;">Anthropic Messages (/v1/messages)</span>
              <span style="float: right; color: #8492a6; font-size: 11px;">Claude 协议</span>
            </el-option>
            <el-option label="Chat Completions (/chat/completions)" value="chat_completions">
              <span style="float: left;">Chat Completions (/chat/completions)</span>
              <span style="float: right; color: #8492a6; font-size: 11px;">商汤 / OpenAI / 阿里百炼 / 智谱标准</span>
            </el-option>
            <el-option label="Responses (/responses)" value="responses">
              <span style="float: left;">Responses (/responses)</span>
              <span style="float: right; color: #8492a6; font-size: 11px;">自定义/扩展协议</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="模型代号/ID" prop="modelName">
          <div style="display: flex; gap: 8px;">
            <el-select
              v-model="dialogForm.modelName"
              filterable
              allow-create
              default-first-option
              placeholder="输入或选择模型代号"
              style="flex: 1;"
            >
              <el-option-group v-if="fetchedModelList.length > 0" label="云端在线读取的模型列表">
                <el-option
                  v-for="item in fetchedModelList"
                  :key="item"
                  :label="item"
                  :value="item"
                />
              </el-option-group>
              <el-option-group label="商汤 SenseNova (官方推荐模型)">
                <el-option label="sensenova-6.8-flash-lite (日日新轻量多模态 · 官方推荐)" value="sensenova-6.8-flash-lite" />
                <el-option label="sensenova-6.7-flash-lite (日日新 6.7 轻量多模态)" value="sensenova-6.7-flash-lite" />
                <el-option label="sensenova-u1-fast (多模态图文推理)" value="sensenova-u1-fast" />
                <el-option label="deepseek-v4-flash (深度推理)" value="deepseek-v4-flash" />
              </el-option-group>
              <el-option-group label="阿里云百炼 (通义千问)">
                <el-option label="qwen-vl-max (视觉旗舰)" value="qwen-vl-max" />
                <el-option label="qwen-vl-plus (高精视觉)" value="qwen-vl-plus" />
              </el-option-group>
              <el-option-group label="智谱 AI (GLM)">
                <el-option label="glm-4v-flash (快速视觉理解)" value="glm-4v-flash" />
                <el-option label="glm-4v (旗舰多模态)" value="glm-4v" />
              </el-option-group>
              <el-option-group label="OpenAI">
                <el-option label="gpt-4o-mini (轻量多模态)" value="gpt-4o-mini" />
                <el-option label="gpt-4o (全能旗舰)" value="gpt-4o" />
              </el-option-group>
            </el-select>
            <el-button size="mini" type="primary" plain :loading="fetchingModels" @click="fetchAvailableModels">
              获取模型列表
            </el-button>
          </div>
          <div style="font-size: 11px; color: #909399; margin-top: 4px;">
            提示：商汤官方轻量多模态模型代号为 <b>sensenova-6.8-flash-lite</b>
          </div>
        </el-form-item>
        <el-form-item v-if="dialogForm.type === 'vlm'" label="API Key">
          <el-input
            v-model="dialogForm.apiKey"
            placeholder="云端厂商 API 访问密钥 (sk-xxxxxxxx)"
            show-password
          />
          <div style="font-size: 12px; color: #909399; margin-top: 4px;">
            支持商汤/阿里云百炼/OpenAI/智谱等各厂商标准 API Key
          </div>
        </el-form-item>
        <el-form-item label="识别置信阈值">
          <el-slider
            v-model="dialogForm.confThreshold"
            :min="0.3"
            :max="0.95"
            :step="0.05"
            show-input
            style="width: 90%;"
          />
        </el-form-item>
        <el-form-item label="核心检测目标">
          <el-select
            v-model="dialogForm.capabilities"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入检测标签"
            style="width: 100%;"
          >
            <el-option label="表盘定位(dial)" value="表盘定位(dial)" />
            <el-option label="指针定位(pointer)" value="指针定位(pointer)" />
            <el-option label="量程零点与满度" value="量程零点与满度" />
            <el-option label="角度法读数计算" value="角度法读数计算" />
            <el-option label="数字液晶表OCR" value="数字液晶表OCR" />
            <el-option label="反光/划痕/破损归因" value="反光/划痕/破损归因" />
            <el-option label="巡检报告自动生成" value="巡检报告自动生成" />
            <el-option label="区域违规入侵" value="区域违规入侵" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dialogForm.type === 'vlm'" label="研判提示词">
          <el-input
            v-model="dialogForm.promptTemplate"
            type="textarea"
            :rows="3"
            placeholder="预置 System Prompt，指导大模型重点关注何种隐患并给出处置建议"
          />
        </el-form-item>
        <el-form-item label="部署描述">
          <el-input v-model="dialogForm.description" placeholder="说明模型部署节点或配置备注" />
        </el-form-item>
      </el-form>
      <span slot="footer" class="dialog-footer">
        <el-button size="mini" @click="dialogVisible = false">取 消</el-button>
        <el-button size="mini" type="warning" plain :loading="testLoading" @click="testDialogConnection">
          测试连通性
        </el-button>
        <el-button size="mini" type="primary" @click="saveModel">保 存</el-button>
      </span>
    </el-dialog>
  </div>
</template>

<script>
import { aiStorage, resolveAiEndpoint } from '../aiStorage'

export default {
  name: 'AiModels',
  data() {
    return {
      loading: false,
      testLoading: false,
      models: [],
      filters: {
        name: '',
        type: ''
      },
      fetchingModels: false,
      fetchedModelList: [],
      dialogVisible: false,
      dialogForm: {
        id: '',
        name: '',
        status: 'online',
        type: 'yolo',
        typeName: '本地边缘 YOLO',
        endpoint: '',
        protocol: 'chat_completions',
        modelName: '',
        apiKey: '',
        confThreshold: 0.65,
        capabilities: [],
        promptTemplate: '',
        description: ''
      },
      formRules: {
        name: [{ required: true, message: '请输入模型名称', trigger: 'blur' }],
        type: [{ required: true, message: '请选择模型类别', trigger: 'change' }],
        endpoint: [{ required: true, message: '请输入接口地址', trigger: 'blur' }],
        modelName: [{ required: true, message: '请输入模型代号', trigger: 'blur' }]
      }
    }
  },
  computed: {
    filteredModels() {
      return this.models.filter(m => {
        const matchName = !this.filters.name || m.name.includes(this.filters.name) || (m.modelName && m.modelName.includes(this.filters.name))
        const matchType = !this.filters.type || m.type === this.filters.type
        return matchName && matchType
      })
    },
    yoloCount() {
      return this.models.filter(m => m.type === 'yolo').length
    },
    vlmCount() {
      return this.models.filter(m => m.type === 'vlm').length
    }
  },
  created() {
    this.loadData()
  },
  methods: {
    loadData() {
      this.loading = true
      setTimeout(() => {
        this.models = aiStorage.getModels()
        this.loading = false
      }, 150)
    },
    search() {
      // computed handles filtering
    },
    resetFilters() {
      this.filters.name = ''
      this.filters.type = ''
    },
    handleTypeChange(val) {
      this.dialogForm.typeName = val === 'yolo' ? '本地边缘 YOLO' : '云端多模态 VLM'
      if (val === 'yolo' && !this.dialogForm.endpoint) {
        this.dialogForm.endpoint = 'http://127.0.0.1:8999/v1/ocr_detect'
        this.dialogForm.modelName = 'yolov8n-ocr-digit.pt'
      } else if (val === 'vlm' && !this.dialogForm.endpoint) {
        this.dialogForm.endpoint = 'https://token.sensenova.cn/v1'
        this.dialogForm.modelName = 'sensenova-6.8-flash-lite'
        this.dialogForm.protocol = 'chat_completions'
      }
    },
    applyProviderPreset(preset) {
      if (preset === 'sensenova') {
        this.dialogForm.name = '商汤-zy'
        this.dialogForm.endpoint = 'https://token.sensenova.cn/v1'
        this.dialogForm.protocol = 'chat_completions'
        this.dialogForm.modelName = 'sensenova-6.8-flash-lite'
        this.dialogForm.description = '商汤日日新多模态大模型，支持高精文字/数字及复杂场景语义研判'
      } else if (preset === 'dashscope') {
        this.dialogForm.name = '阿里通义千问 (Qwen-VL) 多模态引擎'
        this.dialogForm.endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        this.dialogForm.protocol = 'chat_completions'
        this.dialogForm.modelName = 'qwen-vl-max'
        this.dialogForm.description = '阿里云百炼 DashScope 视觉理解旗舰模型，高精OCR与图文研判'
      } else if (preset === 'zhipu') {
        this.dialogForm.name = '智谱清言 (GLM-4V) 多模态引擎'
        this.dialogForm.endpoint = 'https://open.bigmodel.cn/api/paas/v4'
        this.dialogForm.protocol = 'chat_completions'
        this.dialogForm.modelName = 'glm-4v-flash'
        this.dialogForm.description = '智谱 AI 开放平台视觉大模型，毫秒级快速响应'
      } else if (preset === 'openai') {
        this.dialogForm.name = 'OpenAI (GPT-4o-mini) 视觉引擎'
        this.dialogForm.endpoint = 'https://api.openai.com/v1'
        this.dialogForm.protocol = 'chat_completions'
        this.dialogForm.modelName = 'gpt-4o-mini'
        this.dialogForm.description = 'OpenAI 多模态大模型，支持高精细节图文研判'
      } else if (preset === 'siliconflow') {
        this.dialogForm.name = '硅基流动 (Qwen2-VL) 视觉推理引擎'
        this.dialogForm.endpoint = 'https://api.siliconflow.cn/v1'
        this.dialogForm.protocol = 'chat_completions'
        this.dialogForm.modelName = 'Qwen/Qwen2-VL-72B-Instruct'
        this.dialogForm.description = '硅基流动开源大模型托管服务，多模态72B视觉推理'
      }
      this.$message.success(`已应用【${this.dialogForm.name}】标准预设，请填入对应的 API Key 即可测试！`)
    },
    async fetchAvailableModels() {
      if (!this.dialogForm.apiKey || !this.dialogForm.apiKey.trim()) {
        this.$message.warning('请先输入云端 API Key，再拉取可用模型列表')
        return
      }
      this.fetchingModels = true
      try {
        let base = (this.dialogForm.endpoint || 'https://token.sensenova.cn/v1').trim()
        let proxyBase = base
        if (proxyBase.includes('token.sensenova.cn')) {
          proxyBase = proxyBase.replace(/https?:\/\/token\.sensenova\.cn/i, '/sensenova_proxy')
        } else if (proxyBase.includes('dashscope.aliyuncs.com')) {
          proxyBase = proxyBase.replace(/https?:\/\/dashscope\.aliyuncs\.com/i, '/dashscope_proxy')
        } else if (proxyBase.includes('open.bigmodel.cn')) {
          proxyBase = proxyBase.replace(/https?:\/\/open\.bigmodel\.cn/i, '/zhipu_proxy')
        } else if (proxyBase.includes('api.openai.com')) {
          proxyBase = proxyBase.replace(/https?:\/\/api\.openai\.com/i, '/openai_proxy')
        } else if (proxyBase.includes('api.siliconflow.cn')) {
          proxyBase = proxyBase.replace(/https?:\/\/api\.siliconflow\.cn/i, '/siliconflow_proxy')
        } else if (proxyBase.includes('api.anthropic.com')) {
          proxyBase = proxyBase.replace(/https?:\/\/api\.anthropic\.com/i, '/anthropic_proxy')
        }
        proxyBase = proxyBase.replace(/\/$/, '')
        let modelsUrl = proxyBase.endsWith('/v1') ? `${proxyBase}/models` : `${proxyBase}/v1/models`

        const res = await fetch(modelsUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.dialogForm.apiKey.trim()}`
          }
        })
        const data = await res.json()
        if (res.ok && data && (Array.isArray(data.data) || Array.isArray(data.models))) {
          const list = data.data || data.models
          const modelIds = list.map(item => typeof item === 'string' ? item : (item.id || item.model || item.name)).filter(Boolean)
          if (modelIds.length > 0) {
            this.fetchedModelList = modelIds
            this.$message.success(`成功从云端读取到 ${modelIds.length} 个可用模型！`)
            if (!this.dialogForm.modelName || !modelIds.includes(this.dialogForm.modelName)) {
              const preferred = modelIds.find(id => id.includes('sensenova') && id.includes('flash')) ||
                                modelIds.find(id => id.includes('vl') || id.includes('vision') || id.includes('4o')) ||
                                modelIds[0]
              this.dialogForm.modelName = preferred
            }
            return
          }
        }
        throw new Error((data && data.error && (data.error.message || data.error.code)) || `HTTP ${res.status}`)
      } catch (err) {
        this.$notify({
          title: '拉取模型列表提示',
          message: `从云端拉取失败: ${err.message || '网络超时'}。您可以直接从官方推荐模型中选择或手动输入。`,
          type: 'warning',
          duration: 5000
        })
      } finally {
        this.fetchingModels = false
      }
    },
    resetToDefaults() {
      this.$confirm('确认清理旧版本的全部占位模型并重置为纯净真实配置吗？', '清理确认', {
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
        if (!this.dialogForm.protocol) {
          this.dialogForm.protocol = 'chat_completions'
        }
        if (!this.dialogForm.status) {
          this.dialogForm.status = 'online'
        }
        if (this.dialogForm.modelName === 'sensenova-6.8-flash') {
          this.dialogForm.modelName = 'sensenova-6.8-flash-lite'
        }
      } else {
        this.dialogForm = {
          id: '',
          name: '',
          status: 'online',
          type: 'yolo',
          typeName: '本地边缘 YOLO',
          endpoint: 'http://127.0.0.1:8999/v1/ocr_detect',
          protocol: 'chat_completions',
          modelName: 'yolov8n-ocr-digit.pt',
          apiKey: '',
          confThreshold: 0.60,
          capabilities: ['文本区域定位(text_box)', '数显屏幕定位(digital_screen)', '字符与数字检测(digit_det)', 'OCR文本提取'],
          promptTemplate: '你是一名工业自动化与巡检专家。请仔细识别提取画面中的所有文字铭牌、英文字符与数字读数，并分析是否存在异常。',
          description: '运行于本地机器，毫秒级快速初筛识别文字与数字目标'
        }
      }
      this.dialogVisible = true
      this.$nextTick(() => {
        this.$refs.modelForm && this.$refs.modelForm.clearValidate()
      })
    },
    saveModel() {
      this.$refs.modelForm.validate(valid => {
        if (!valid) return
        this.dialogForm.typeName = this.dialogForm.type === 'yolo' ? '本地边缘 YOLO' : '云端多模态 VLM'
        if (this.dialogForm.modelName === 'sensenova-6.8-flash') {
          this.dialogForm.modelName = 'sensenova-6.8-flash-lite'
        }
        aiStorage.saveModel(this.dialogForm)
        this.$message.success('模型配置保存成功！')
        this.dialogVisible = false
        this.loadData()
      })
    },
    deleteModel(row) {
      this.$confirm(`确认删除算法模型【${row.name}】吗？若已有巡检任务绑定该模型，可能导致分析中断。`, '删除确认', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }).then(() => {
        aiStorage.deleteModel(row.id)
        this.$message.success('删除成功')
        this.loadData()
      }).catch(() => {})
    },
    async executeHandshake(endpoint, protocol, modelName, apiKey) {
      let targetModel = (modelName || 'sensenova-6.8-flash-lite').trim()
      if (targetModel === 'sensenova-6.8-flash') {
        targetModel = 'sensenova-6.8-flash-lite'
      }

      let ep = resolveAiEndpoint(endpoint, protocol)
      let headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      }
      if (protocol === 'anthropic') {
        headers['x-api-key'] = apiKey.trim()
        headers['anthropic-version'] = '2023-06-01'
      }

      let requestBody = {
        model: targetModel,
        messages: [{ role: 'user', content: '这是一次巡检系统握手测试，请回复“握手成功”四个字。' }],
        max_tokens: 20
      }

      let res = await fetch(ep, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
      })
      let ret = await res.json()

      // 若商汤返回 model route not found 且当前为 6.8-flash-lite，自动尝试 6.7-flash-lite 兼容
      if (!res.ok && ret && ret.error && (ret.error.message || '').includes('model route not found') && targetModel === 'sensenova-6.8-flash-lite') {
        const fallbackModel = 'sensenova-6.7-flash-lite'
        requestBody.model = fallbackModel
        const fallbackRes = await fetch(ep, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody)
        })
        const fallbackRet = await fallbackRes.json()
        if (fallbackRes.ok && fallbackRet && fallbackRet.choices && fallbackRet.choices[0] && fallbackRet.choices[0].message) {
          return {
            ok: true,
            res: fallbackRes,
            ret: fallbackRet,
            actualModel: fallbackModel,
            autoSwitched: true
          }
        }
      }

      return {
        ok: res.ok,
        res: res,
        ret: ret,
        actualModel: targetModel,
        autoSwitched: false
      }
    },
    async testYoloConnection(rawEndpoint, modelName) {
      let ep = (rawEndpoint || 'http://127.0.0.1:8999/health').trim()
      if (!ep.startsWith('http://') && !ep.startsWith('https://')) {
        ep = 'http://' + ep
      }
      const t0 = Date.now()
      try {
        const res = await fetch(ep, { method: 'GET', mode: 'cors' })
        const cost = Date.now() - t0
        if (res.ok) {
          let data = {}
          try { data = await res.json() } catch(e) {}
          return {
            ok: true,
            cost: cost,
            message: data.message || data.engine || '本地边缘 YOLO 服务正常运行中',
            model: data.model || modelName || 'yolov8n-ocr-digit.pt'
          }
        } else {
          return {
            ok: false,
            cost: cost,
            message: `服务已连通但返回 HTTP ${res.status}`
          }
        }
      } catch (err) {
        return {
          ok: false,
          cost: Date.now() - t0,
          message: `无法连接到本地地址 (${ep})：${err.message || '连接拒绝 (ERR_CONNECTION_REFUSED)'}。请检查本地 8999 端口服务是否正在运行。`
        }
      }
    },
    async testSingleConnection(row) {
      if (row.type === 'vlm') {
        if (!row.apiKey || !row.apiKey.trim()) {
          this.$message.warning(`模型【${row.name}】当前 API Key 为空！请先点击右侧【编辑】填入您的商汤 API Key (sk-...) 后再测试！`)
          return
        }
        const loading = this.$loading({
          lock: true,
          text: `正在向大模型 API 发起真实网络握手 (${row.modelName || 'sensenova-6.8-flash-lite'})...`,
          spinner: 'el-icon-loading',
          background: 'rgba(0, 0, 0, 0.4)'
        })
        const startTime = Date.now()
        try {
          const result = await this.executeHandshake(row.endpoint, row.protocol, row.modelName, row.apiKey)
          const cost = Date.now() - startTime
          if (result.ok && result.ret && result.ret.choices && result.ret.choices[0] && result.ret.choices[0].message) {
            const reply = result.ret.choices[0].message.content || ''
            const usage = result.ret.usage || {}
            if (result.autoSwitched) {
              row.modelName = result.actualModel
              aiStorage.saveModel(row)
              this.loadData()
            }
            this.$notify({
              title: `商汤大模型握手成功 (已产生真实 Token 消耗)`,
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>模型回复：</b>“${reply.trim()}”</div>
                <div style="margin-top: 6px; color: #67C23A; font-weight: bold;">
                  ✔ 实际扣减 Token: ${usage.total_tokens || 0} 个
                  <span style="font-size: 11px; font-weight: normal; color: #909399;">(Prompt: ${usage.prompt_tokens || 0}, Completion: ${usage.completion_tokens || 0})</span>
                </div>
                <div style="font-size: 11px; color: #909399; margin-top: 4px;">模型: ${result.actualModel} · 耗时: ${cost}ms · 可在商汤官方控制台（platform.sensenova.cn）核对调用明细</div>
              </div>`,
              type: 'success',
              duration: 8000
            })
          } else {
            const errMsg = (result.ret && result.ret.error && (result.ret.error.message || JSON.stringify(result.ret.error))) || `HTTP ${result.res.status} 鉴权失败`
            this.$notify({
              title: '商汤大模型握手失败',
              message: `云端接口拒绝了请求：${errMsg}。请检查您的 API Key 是否正确或账户额度。`,
              type: 'error',
              duration: 7000
            })
          }
        } catch (err) {
          this.$notify({
            title: '网络连接异常',
            message: `无法连通接口地址：${err.message || '网络连接超时'}`,
            type: 'error',
            duration: 6000
          })
        } finally {
          loading.close()
        }
      } else {
        // 真正向本地 YOLO 接口发起 HTTP 连通探测
        const loading = this.$loading({
          lock: true,
          text: `正在探测本地边缘 YOLO 服务 (${row.endpoint || 'http://127.0.0.1:8999'})...`,
          spinner: 'el-icon-loading',
          background: 'rgba(0, 0, 0, 0.4)'
        })
        try {
          const res = await this.testYoloConnection(row.endpoint, row.modelName)
          if (res.ok) {
            this.$notify({
              title: '本地边缘 YOLO 真实连通成功',
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>服务状态：</b>✔ ${res.message}</div>
                <div style="margin-top: 4px; color: #67C23A; font-weight: bold;">
                  模型: ${res.model} · 真实响应延迟: ${res.cost}ms
                </div>
                <div style="font-size: 11px; color: #909399; margin-top: 4px;">端口: 8999 · 已通过原生网络真实探测验证</div>
              </div>`,
              type: 'success',
              duration: 6000
            })
          } else {
            this.$notify({
              title: '本地边缘 YOLO 连通失败',
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>错误信息：</b>${res.message}</div>
                <div style="font-size: 11px; color: #E6A23C; margin-top: 4px;">请在后台启动 <code>python yolo_service.py</code> 边缘推理服务。</div>
              </div>`,
              type: 'error',
              duration: 7000
            })
          }
        } finally {
          loading.close()
        }
      }
    },
    async testDialogConnection() {
      if (!this.dialogForm.endpoint) {
        this.$message.warning('请先输入 Base URL 接口地址')
        return
      }
      if (this.dialogForm.type === 'vlm') {
        if (!this.dialogForm.apiKey || !this.dialogForm.apiKey.trim()) {
          this.$message.error('【必须填入 API Key】当前 API Key 为空！不填 Key 无法向商汤发起真实网络鉴权与 Token 消耗，请粘贴您的 Key 后再测。')
          return
        }
      }

      this.testLoading = true
      const startTime = Date.now()
      try {
        if (this.dialogForm.type === 'vlm') {
          const result = await this.executeHandshake(
            this.dialogForm.endpoint,
            this.dialogForm.protocol,
            this.dialogForm.modelName,
            this.dialogForm.apiKey
          )
          const cost = Date.now() - startTime
          if (result.ok && result.ret && result.ret.choices && result.ret.choices[0] && result.ret.choices[0].message) {
            const reply = result.ret.choices[0].message.content || ''
            const usage = result.ret.usage || {}
            if (result.autoSwitched) {
              this.dialogForm.modelName = result.actualModel
              this.$message.info(`已自动适配为可用模型: ${result.actualModel}`)
            }
            this.$notify({
              title: '商汤大模型握手成功 (已真实消耗 Token)',
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>模型回复：</b>“${reply.trim()}”</div>
                <div style="margin-top: 6px; color: #67C23A; font-weight: bold;">
                  ✔ 本次真实扣减 Token: ${usage.total_tokens || 0} 个
                  <span style="font-size: 11px; font-weight: normal; color: #909399;">(Prompt: ${usage.prompt_tokens || 0}, Completion: ${usage.completion_tokens || 0})</span>
                </div>
                <div style="font-size: 11px; color: #909399; margin-top: 4px;">模型: ${result.actualModel} · 真实网络延迟: ${cost}ms · 可在商汤开放平台查对该笔 Token 扣费记录</div>
              </div>`,
              type: 'success',
              duration: 8000
            })
          } else {
            const errMsg = (result.ret && result.ret.error && (result.ret.error.message || JSON.stringify(result.ret.error))) || `HTTP ${result.res.status} 鉴权未通过`
            this.$notify({
              title: '商汤大模型握手失败',
              message: `商汤官方接口返回错误：${errMsg}。请检查 API Key 权限、模型代号或余额。`,
              type: 'error',
              duration: 7000
            })
          }
        } else {
          // 真正向本地 YOLO 接口发起 HTTP 探测
          const res = await this.testYoloConnection(this.dialogForm.endpoint, this.dialogForm.modelName)
          if (res.ok) {
            this.$notify({
              title: '本地边缘 YOLO 真实连通成功',
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>服务状态：</b>✔ ${res.message}</div>
                <div style="margin-top: 4px; color: #67C23A; font-weight: bold;">
                  模型: ${res.model} · 真实响应延迟: ${res.cost}ms
                </div>
                <div style="font-size: 11px; color: #909399; margin-top: 4px;">端口: 8999 · 已通过原生网络真实探测验证</div>
              </div>`,
              type: 'success',
              duration: 6000
            })
          } else {
            this.$notify({
              title: '本地边缘 YOLO 连通失败',
              dangerouslyUseHTMLString: true,
              message: `<div style="line-height: 1.6; font-size: 13px;">
                <div><b>错误信息：</b>${res.message}</div>
                <div style="font-size: 11px; color: #E6A23C; margin-top: 4px;">请在后台启动 <code>python yolo_service.py</code> 边缘推理服务。</div>
              </div>`,
              type: 'error',
              duration: 7000
            })
          }
        }
      } catch (err) {
        this.$notify({
          title: '网络请求异常',
          message: `连通失败：${err.message || '网络连接超时'}`,
          type: 'error',
          duration: 6000
        })
      } finally {
        this.testLoading = false
      }
    },
    async testAllConnection() {
      const loading = this.$loading({
        lock: true,
        text: '正在向所有配置的算法引擎发起真实网络握手...',
        spinner: 'el-icon-loading',
        background: 'rgba(0, 0, 0, 0.4)'
      })
      try {
        let vlmChecked = false
        let totalTokens = 0
        let yoloCount = 0
        let yoloSuccessCount = 0
        for (const m of this.models) {
          if (m.type === 'vlm' && m.apiKey && m.apiKey.trim()) {
            const result = await this.executeHandshake(m.endpoint, m.protocol, m.modelName, m.apiKey)
            if (result.ok && result.ret && result.ret.usage) {
              totalTokens += (result.ret.usage.total_tokens || 0)
            }
            vlmChecked = true
          } else if (m.type === 'yolo') {
            yoloCount++
            const yoloRes = await this.testYoloConnection(m.endpoint, m.modelName)
            if (yoloRes.ok) yoloSuccessCount++
          }
        }
        let msg = []
        if (vlmChecked) {
          msg.push(`云端大模型正常在线 (本次真实消耗 ${totalTokens} Token)`)
        }
        if (yoloCount > 0) {
          msg.push(`本地边缘 YOLO 在线 ${yoloSuccessCount}/${yoloCount} 个`)
        }
        this.$message.success('批量测试完成：' + msg.join('，'))
      } catch (e) {
        this.$message.error('批量检测出现异常：' + e.message)
      } finally {
        loading.close()
      }
    },
    resetToFactory() {
      this.$confirm('确定恢复预设示例数据？', '提示', { type: 'info' }).then(() => {
        aiStorage.resetAll()
        this.$message.success('已恢复示例数据')
        this.loadData()
      })
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
