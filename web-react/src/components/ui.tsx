import type { ReactNode } from 'react';
import { Tag, Button, Tooltip } from '@douyinfe/semi-ui';
import { IconRefresh, IconHelpCircle } from '@douyinfe/semi-icons';

/**
 * 全站共享 UI 原语（设计系统层）：
 * - StatStrip   页面级"结论先行"统计条（巡检结果/告警/任务等列表页统一用）
 * - RESULT_META 巡检结论的三态语义色（绿正常/红异常/橙失败），表格 Tag 与详情弹窗共用
 * - LoadError   接口失败的统一错误卡片（原因 + 下一步建议 + 重试）
 * - shortTime   时间显示统一为 "MM-dd HH:mm"（分钟粒度，值班场景够用）
 */

export const RESULT_META: Record<string, { color: 'green' | 'red' | 'orange' | 'blue'; text: string; kind: 'tag' | 'text' }> = {
  NORMAL: { color: 'green', text: '正常', kind: 'tag' },
  ABNORMAL: { color: 'red', text: '异常', kind: 'tag' },
  ANALYZING: { color: 'blue', text: '分析中', kind: 'text' },
  FAILED: { color: 'orange', text: '识别失败', kind: 'tag' },
};

export const REVIEW_META: Record<string, { color: 'green' | 'red' | 'grey'; text: string }> = {
  PENDING: { color: 'grey', text: '待人工确认' },
  CONFIRMED_NORMAL: { color: 'green', text: '人工已确认正常' },
  CONFIRMED_ABNORMAL: { color: 'red', text: '人工确认异常' },
};

/** ISO 时间 → "MM-dd HH:mm"；非法/空返回 '-' */
export function shortTime(iso?: string) {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

/** 结论先行统计条：现代 B 端 KPI 指标卡片组，视觉重点鲜明，高亮待办与异常 */
export function StatStrip({ items }: { items: Array<{ label: string; value: ReactNode; color?: string; emphasize?: boolean }> }) {
  return (
    <div className="stat-strip">
      {items.map((c) => (
        <div key={c.label} className={`stat-strip-item${c.emphasize ? ' stat-strip-item-alert' : ''}`}>
          <span className="stat-strip-value" style={{ color: c.color || 'var(--semi-color-text-0)' }}>
            {c.value}
          </span>
          <span className="stat-strip-label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 列表页统一错误态：出错原因、人话解释、下一步动作（重试），而不是一行小字 */
export function LoadError({ what, error, onRetry }: { what: string; error?: string | null; onRetry?: () => void }) {
  return (
    <div className="load-error">
      <div style={{ fontWeight: 600, color: 'var(--semi-color-danger)' }}>{what}加载失败</div>
      <div className="text-muted" style={{ fontSize: 13 }}>
        {error ? `${error}。` : ''}请确认后端服务是否在运行，或稍后重试。
      </div>
      {onRetry && <Button size="small" icon={<IconRefresh />} onClick={onRetry}>重试</Button>}
    </div>
  );
}

/** 空格子/空内容统一样式（商业 VMS 的 Gray tile：深灰底 + 图标 + 一句人话） */
export function EmptyHint({ icon, title, sub }: { icon?: ReactNode; title: string; sub?: string }) {
  return (
    <div className="empty-hint">
      {icon && <div style={{ opacity: 0.4, marginBottom: 8 }}>{icon}</div>}
      <div style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', opacity: 0.65, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/**
 * 页面说明：只留一行关键提示，"为什么/怎么配"这类长解释收进 ? 悬停浮层。
 * 之前各页顶部一大段灰字说明长期占着首屏（用户反馈"占视觉"），
 * 统一收敛成这一种形态：需要时查得到，不需要时不挡视线。
 */
export function Hint({ text, detail }: { text: string; detail?: ReactNode }) {
  return (
    <span className="page-hint">
      <span>{text}</span>
      {detail && (
        <Tooltip
          position="bottomLeft"
          content={<div style={{ maxWidth: 460, fontSize: 12, lineHeight: '19px' }}>{detail}</div>}
        >
          <IconHelpCircle size="small" className="page-hint-icon" />
        </Tooltip>
      )}
    </span>
  );
}
