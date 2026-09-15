import { get as httpGet } from '@/api/http';

/**
 * 拉流代理的实时拉流状态：key = `${app}/${stream}`。
 * 数据源是 ZLM getMediaList（后端 /api/patrol/access/stream-online）——
 * 通道表的 gbStatus 是接入快照、WVP 的 proxy.pulling 在 WVP 重启后会被复位且无事件纠正，
 * 都不能作为"当前是否在拉流"的事实源；按我们定的架构原则：状态是问 ZLM 要的。
 */
export async function fetchPullingMap(): Promise<Record<string, boolean>> {
  try {
    const keys = await httpGet<string[]>('/api/patrol/access/stream-online');
    const map: Record<string, boolean> = {};
    ((keys as any[]) || []).forEach((k: any) => { if (typeof k === 'string') map[k] = true; });
    return map;
  } catch {
    return {};
  }
}
