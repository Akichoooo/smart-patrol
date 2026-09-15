// AI 智能巡检数据中心与持久化存储服务 (纯净真实版)
const STORAGE_KEY_MODELS = 'wvp_ai_models_v4'
const STORAGE_KEY_TASKS = 'wvp_ai_tasks_v4'
const STORAGE_KEY_ALARMS = 'wvp_ai_alarms_v4'

// 自动清理旧版假数据，若存在 v3 中的真实商汤 key，自动迁移
try {
  const v3Models = localStorage.getItem('wvp_ai_models_v3')
  if (v3Models && !localStorage.getItem(STORAGE_KEY_MODELS)) {
    const list = JSON.parse(v3Models)
    const sensetime = list.find(m => m.type === 'vlm' && m.apiKey)
    if (sensetime) {
      DEFAULT_MODELS[1].apiKey = sensetime.apiKey
      DEFAULT_MODELS[1].endpoint = sensetime.endpoint || DEFAULT_MODELS[1].endpoint
      DEFAULT_MODELS[1].modelName = sensetime.modelName || DEFAULT_MODELS[1].modelName
    }
  }
  ['wvp_ai_models_v1', 'wvp_ai_tasks_v1', 'wvp_ai_alarms_v1', 'wvp_ai_models_v2', 'wvp_ai_tasks_v2', 'wvp_ai_alarms_v2', 'wvp_ai_models_v3'].forEach(k => {
    localStorage.removeItem(k)
  })
} catch (e) {
  console.warn(e)
}

// 真实初始模型 (包含本地边缘 YOLO 文字/数字检测与 VLM 多模态大模型复核)
const DEFAULT_MODELS = [
  {
    id: 'm-yolo-ocr',
    name: '本地边缘 YOLO 文字/数字与数显识别',
    type: 'yolo',
    typeName: '本地边缘 YOLO',
    endpoint: 'http://127.0.0.1:8999/v1/ocr_detect',
    modelName: 'yolov8n-ocr-digit.pt',
    apiKey: '',
    confThreshold: 0.60,
    capabilities: ['文本区域定位(text_box)', '数显屏幕定位(digital_screen)', '字符与数字检测(digit_det)', 'OCR文本提取'],
    status: 'online',
    latency: '14ms',
    createTime: '2026-09-09 10:00:00',
    description: '运行在本地边缘端，通过 RTSP/国标视频流毫秒级定位设备铭牌、字符标签(text_box)与数显屏幕(digital_screen)，实现文字与数字高精初筛'
  },
  {
    id: 'm-vlm',
    name: '商汤 SenseNova 多模态复核',
    type: 'vlm',
    typeName: '云端/本地多模态 VLM',
    endpoint: 'https://token.sensenova.cn/v1',
    protocol: 'chat_completions',
    modelName: 'sensenova-6.8-flash-lite',
    apiKey: '',
    confThreshold: 0.75,
    capabilities: ['全图文字OCR多模态精读', '数字/量程语义理解', '设备铭牌解析', '文字异常与篡改判定'],
    status: 'online',
    latency: '320ms',
    createTime: '2026-09-09 10:00:00',
    promptTemplate: '你是一名工业自动化与设备巡检专家。请仔细阅读画面中的文字标签、设备铭牌和数字显示屏，准确提取所有文字、编号、读数数值及单位，并判断是否存在字迹模糊、字符破损或数值越限异常。',
    description: '商汤 SenseNova 多模态大模型，用于文字数字初筛后的二次精准语义复核与文字精读'
  }
]

// 初始任务 (默认直接绑定现场连入的海康高清摄像机 192.168.0.125)
const DEFAULT_TASKS = [
  {
    id: 'tsk-ocr-01',
    name: '海康摄像机文字与数字智能巡检',
    channelId: 1,
    channelName: '海康高清摄像机 (192.168.0.125)',
    primaryModelId: 'm-yolo-ocr',
    primaryModelName: '本地边缘 YOLO 文字/数字与数显识别',
    vlmModelId: 'm-vlm',
    vlmModelName: '商汤 (sensenova-6.8-flash-lite) 多模态复核',
    vlmEnabled: true,
    sampleRate: 2,
    roiType: 'full',
    roiText: '全画面文字/数字OCR检测',
    threshold: 0.60,
    riskLevel: 'medium',
    riskLevelName: '重要 (黄级)',
    enabled: true,
    todayAlarms: 0,
    createTime: '2026-09-09 10:00:00',
    lastCheckTime: '正在运行'
  }
]

// 初始告警 (清空假数据，初始为0条，仅用户点击抽检或真实触发时产生)
const DEFAULT_ALARMS = []

export const aiStorage = {
  // 一键重置清空全部历史假数据
  resetAllData() {
    try {
      localStorage.removeItem(STORAGE_KEY_MODELS)
      localStorage.removeItem(STORAGE_KEY_TASKS)
      localStorage.removeItem(STORAGE_KEY_ALARMS)
      localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(DEFAULT_MODELS))
      localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(DEFAULT_TASKS))
      localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(DEFAULT_ALARMS))
    } catch (e) {
      console.error(e)
    }
  },

  // --- 模型管理 ---
  getModels() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_MODELS)
      if (data) {
        let list = JSON.parse(data)
        // 若包含旧的水利/救生衣假数据，自动清理
        const hasLegacyFake = list.some(m => m.name && (m.name.includes('水利') || m.name.includes('救生衣') || m.id === 'm-1'))
        if (!hasLegacyFake) {
          let updated = false
          list.forEach(m => {
            if (m.modelName === 'sensenova-6.8-flash') {
              m.modelName = 'sensenova-6.8-flash-lite'
              updated = true
            }
            if (!m.status) {
              m.status = 'online'
              updated = true
            }
            if (m.type === 'vlm' && !m.protocol) {
              m.protocol = 'chat_completions'
              updated = true
            }
          })
          if (updated) {
            localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(list))
          }
          return list
        }
      }
    } catch (e) {
      console.error(e)
    }
    localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(DEFAULT_MODELS))
    return DEFAULT_MODELS
  },

  saveModel(model) {
    const list = this.getModels()
    if (model.id) {
      const idx = list.findIndex(m => m.id === model.id)
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...model }
      } else {
        list.unshift(model)
      }
    } else {
      model.id = 'm-' + Date.now()
      model.createTime = new Date().toLocaleString()
      model.status = 'online'
      model.latency = '20ms'
      list.unshift(model)
    }
    localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(list))
    return model
  },

  deleteModel(id) {
    const list = this.getModels().filter(m => m.id !== id)
    localStorage.setItem(STORAGE_KEY_MODELS, JSON.stringify(list))
    return true
  },

  // --- 任务管理 ---
  getTasks() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_TASKS)
      if (data) {
        const list = JSON.parse(data)
        const hasLegacyFake = list.some(t => t.name && (t.name.includes('溢流口') || t.name.includes('漂浮物') || t.id === 'tsk-101'))
        if (!hasLegacyFake) {
          const models = this.getModels()
          const vlmModel = models.find(m => m.type === 'vlm')
          list.forEach(t => {
            if (!t.channelId || t.channelName === '请选择连入的摄像机通道') {
              t.channelId = 1
              t.channelName = '海康高清摄像机 (192.168.0.125)'
            }
            if (vlmModel) {
              t.vlmModelId = vlmModel.id
              t.vlmModelName = vlmModel.name
              t.vlmEnabled = true
            }
          })
          return list
        }
      }
    } catch (e) {
      console.error(e)
    }
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(DEFAULT_TASKS))
    return DEFAULT_TASKS
  },

  saveTask(task) {
    const list = this.getTasks()
    if (task.id) {
      const idx = list.findIndex(t => t.id === task.id)
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...task }
      } else {
        list.unshift(task)
      }
    } else {
      task.id = 'tsk-' + Date.now().toString().slice(-4)
      task.createTime = new Date().toLocaleString()
      task.todayAlarms = 0
      task.lastCheckTime = '刚刚'
      task.enabled = true
      list.unshift(task)
    }
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(list))
    return task
  },

  deleteTask(id) {
    const list = this.getTasks().filter(t => t.id !== id)
    localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(list))
    return true
  },

  toggleTaskStatus(id, enabled) {
    const list = this.getTasks()
    const task = list.find(t => t.id === id)
    if (task) {
      task.enabled = enabled
      localStorage.setItem(STORAGE_KEY_TASKS, JSON.stringify(list))
    }
  },

  // --- 告警管理 ---
  getAlarms() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_ALARMS)
      if (data) {
        const list = JSON.parse(data)
        const hasLegacyFake = list.some(a => a.id && a.id.startsWith('ALM-20260909-001'))
        if (!hasLegacyFake) {
          return list
        }
      }
    } catch (e) {
      console.error(e)
    }
    localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(DEFAULT_ALARMS))
    return DEFAULT_ALARMS
  },

  dispatchAlarm(alarmId, dispatchData) {
    const list = this.getAlarms()
    const alarm = list.find(a => a.id === alarmId)
    if (alarm) {
      alarm.status = 'dispatched'
      alarm.statusName = '已派发工单'
      alarm.dispatchInfo = {
        orderNo: 'WO-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000),
        assignee: dispatchData.assignee,
        priority: dispatchData.priority,
        note: dispatchData.note,
        dispatchTime: new Date().toLocaleString()
      }
      localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(list))
      return alarm
    }
    return null
  },

  markFalseAlarm(alarmId, reason = '人工复核排除') {
    const list = this.getAlarms()
    const alarm = list.find(a => a.id === alarmId)
    if (alarm) {
      alarm.status = 'false_positive'
      alarm.statusName = '已判定误报'
      alarm.vlmReasoning = (alarm.vlmReasoning || '') + `\n【人工复核意见】：${reason}`
      localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(list))
      return alarm
    }
    return null
  },

  closeAlarm(alarmId, resolution = '现场处置完毕') {
    const list = this.getAlarms()
    const alarm = list.find(a => a.id === alarmId)
    if (alarm) {
      alarm.status = 'closed'
      alarm.statusName = '已处置归档'
      if (alarm.dispatchInfo) {
        alarm.dispatchInfo.closeTime = new Date().toLocaleString()
        alarm.dispatchInfo.closeNote = resolution
      }
      localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(list))
      return alarm
    }
    return null
  },

  deleteAlarm(id) {
    const list = this.getAlarms().filter(a => a.id !== id)
    localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(list))
    return true
  },

  createAlarm(alarm) {
    const list = this.getAlarms()
    const newAlarm = {
      id: 'ALM-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(1000 + Math.random() * 9000),
      time: new Date().toLocaleString(),
      status: 'pending',
      statusName: '待人工复核',
      dispatchInfo: null,
      ...alarm
    }
    list.unshift(newAlarm)
    localStorage.setItem(STORAGE_KEY_ALARMS, JSON.stringify(list))
    return newAlarm
  }
}

// 智能解析并映射各大主流云厂商的大模型接口至本地 Nginx 代理，彻底规避浏览器端的 CORS 与 OPTIONS 预检 404 限制
export function resolveAiEndpoint(rawEndpoint, protocol = 'chat_completions') {
  if (!rawEndpoint) {
    if (protocol === 'anthropic') return '/anthropic_proxy/v1/messages'
    return '/sensenova_proxy/v1/chat/completions'
  }
  let ep = rawEndpoint.trim()

  // 映射各大主流云厂商至同源 Nginx 反向代理
  if (ep.includes('token.sensenova.cn')) {
    ep = ep.replace(/https?:\/\/token\.sensenova\.cn/i, '/sensenova_proxy')
  } else if (ep.includes('dashscope.aliyuncs.com')) {
    ep = ep.replace(/https?:\/\/dashscope\.aliyuncs\.com/i, '/dashscope_proxy')
  } else if (ep.includes('open.bigmodel.cn')) {
    ep = ep.replace(/https?:\/\/open\.bigmodel\.cn/i, '/zhipu_proxy')
  } else if (ep.includes('api.openai.com')) {
    ep = ep.replace(/https?:\/\/api\.openai\.com/i, '/openai_proxy')
  } else if (ep.includes('api.siliconflow.cn')) {
    ep = ep.replace(/https?:\/\/api\.siliconflow\.cn/i, '/siliconflow_proxy')
  } else if (ep.includes('api.anthropic.com')) {
    ep = ep.replace(/https?:\/\/api\.anthropic\.com/i, '/anthropic_proxy')
  }

  // 移除尾部斜杠
  ep = ep.replace(/\/$/, '')

  // 根据选定的协议类型规范化最终路由
  if (protocol === 'anthropic' || protocol === '/v1/messages') {
    if (!ep.endsWith('/messages')) {
      ep += ep.endsWith('/v1') ? '/messages' : '/v1/messages'
    }
  } else if (protocol === 'responses' || protocol === '/responses') {
    if (!ep.endsWith('/responses')) {
      ep += '/responses'
    }
  } else {
    // 默认 Chat Completions (/chat/completions)
    if (!ep.endsWith('/chat/completions')) {
      ep += '/chat/completions'
    }
  }
  return ep
}

