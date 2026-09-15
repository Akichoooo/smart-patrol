import { useState } from 'react';
import { Card, Tag, Typography, Descriptions } from '@douyinfe/semi-ui';
import { get as httpGet } from '@/api/http';

/** 通用统计卡片（信息总览用） */
export function StatCard({
  title,
  value,
  suffix,
  color,
  onClick,
}: {
  title: string;
  value: number | string;
  suffix?: string;
  color?: string;
  onClick?: () => void;
}) {
  return (
    <Card
      size="small"
      style={{ cursor: onClick ? 'pointer' : 'default', flex: 1, minWidth: 120 }}
      bodyStyle={{ padding: '10px 14px' }}
      onClick={onClick}
    >
      <div className="text-muted" style={{ fontSize: 12 }}>{title}</div>
      <div className="stat-card-value" style={{ color: color || 'var(--semi-color-primary)' }}>
        {value}
        {suffix && <span style={{ fontSize: 12, marginLeft: 4, color: 'var(--semi-color-text-2)' }}>{suffix}</span>}
      </div>
    </Card>
  );
}

/** 环形进度指标（可靠性统计的漏检率等） */
export function RingIndicator({ title, percent }: { title: string; percent: number | null }) {
  if (percent === null || percent === undefined) {
    return (
      <div style={{ textAlign: 'center', minWidth: 110 }}>
        <div style={{ width: 84, height: 84, margin: '0 auto 8px', borderRadius: '50%', border: '2px dashed var(--semi-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-3)', fontSize: 12 }}>未采集</div>
        <div className="text-muted" style={{ fontSize: 12 }}>{title}</div>
      </div>
    );
  }
  const deg = Math.min(100, Math.max(0, percent));
  return (
    <div style={{ textAlign: 'center', minWidth: 110 }}>
      <div
        style={{
          width: 84,
          height: 84,
          margin: '0 auto 8px',
          borderRadius: '50%',
          background: `conic-gradient(var(--semi-color-primary) ${deg * 3.6}deg, rgba(140,150,165,0.15) 0)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 66,
            height: 66,
            borderRadius: '50%',
            background: 'var(--semi-color-bg-1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          {deg}%
        </div>
      </div>
      <div className="text-muted" style={{ fontSize: 12 }}>{title}</div>
    </div>
  );
}

/** 简单时间占位（对齐旧平台顶部日期时间显示） */
export function useNow() {
  const [now, setNow] = useState(new Date());
  setInterval(() => setNow(new Date()), 1000);
  return now.toLocaleString('zh-CN', { hour12: false });
}

export const LevelTag = ({ level }: { level: string }) => {
  const map: Record<string, { color: string; text: string }> = {
    GENERAL: { color: 'blue', text: '一般告警' },
    SERIOUS: { color: 'orange', text: '严重告警' },
    DANGER: { color: 'red', text: '危险告警' },
  };
  const it = map[level] || { color: 'grey', text: level };
  return <Tag color={it.color}>{it.text}</Tag>;
};
