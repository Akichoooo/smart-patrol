import { post } from '@/api/http';

/**
 * AI 检测统一入口（后端 /api/patrol/ai/analyze）：
 * - { source:'CHANNEL', channelId, schemeId?, label? }  平台抓帧识别（台账识别用）
 * - { source:'IMAGE', image:'data:image/jpeg;base64,...', schemeId?, label? }  截图识别（观看单帧研判/回放识别用）
 * 返回：{ ok, result, confidence, identifyType, yolo, vlm, readings, mediaId, mediaUrl }
 *
 * 超时：VLM 复核实测 25~60s，必须覆盖 axios 全局 30s，否则 ECONNABORTED 会先于
 * 调用方的 withTimeout 触发，表现为"识别明明成功入库，弹窗却回到初始态"。
 */
export function analyzeAi(body: {
  source: 'CHANNEL' | 'IMAGE';
  channelId?: number;
  image?: string;
  schemeId?: number;
  label?: string;
}) {
  return post<any>('/api/patrol/ai/analyze', body, { timeout: 90000 });
}
