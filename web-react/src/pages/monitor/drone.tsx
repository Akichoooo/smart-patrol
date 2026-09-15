import { useEffect, useState } from 'react';
import { Card, Tag, Empty, Spin, Button, Toast } from '@douyinfe/semi-ui';
import { IconSend } from '@douyinfe/semi-icons';
import { get as httpGet, post } from '@/api/http';

/** 无人机监控：设备列表 + 遥测 + 指令（能力协商禁用） */
export default function DroneMonitorPage() {
  const [drones, setDrones] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const list = await httpGet<any[]>('/api/patrol/robot/list', { type: 'DRONE' }).catch(() => []);
        setDrones((list || []).filter((d: any) => d.type === 'DRONE'));
        if (list && list.length > 0) setCurrent(list.find((d: any) => d.type === 'DRONE') || null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sendCommand = async (cmd: string) => {
    if (!current) return;
    try {
      const r = await post<any>(`/api/patrol/robot/${current.id}/command`, { command: cmd });
      if (r?.state === 'DISABLED') Toast.warning(`设备能力不支持: ${cmd}`);
      else Toast.success(`指令已下发: ${cmd}`);
    } catch { /* 请求层已提示 */ }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;

  if (drones.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <Empty
          icon={<IconSend style={{ fontSize: 40, color: 'var(--semi-color-text-2)' }} />}
          title="暂无无人机设备"
          description="请先在 设置 → 机器人与装备 → 装备台账 注册无人机（支持大疆机场/通用HTTP占位）"
        />
      </div>
    );
  }

  const caps = new Set<string>((current?.capabilitiesJson ? JSON.parse(current.capabilitiesJson) : []) as string[]);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small">
        <div className="flex-between">
          <div style={{ display: 'flex', gap: 8 }}>
            {drones.map((d) => (
              <Button key={d.id} size="small" theme={current?.id === d.id ? 'solid' : 'light'} onClick={() => setCurrent(d)}>
                {d.name}
                <Tag size="small" color={d.status === 'ONLINE' ? 'green' : 'grey'} style={{ marginLeft: 6 }}>
                  {d.status === 'ONLINE' ? '在线' : '离线'}
                </Tag>
              </Button>
            ))}
          </div>
        </div>
      </Card>

      <div className="video-cell" style={{ height: 320 }}>
        <div className="video-cell-header"><span>相机画面</span><Tag size="small">待接入（大疆 live_start_push / RTSP）</Tag></div>
        <div className="video-cell-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6b85', fontSize: 12 }}>
          等待协议适配接入
        </div>
      </div>

      <Card size="small" title="飞行控制（能力协商）">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            ['startTask', '开始任务'],
            ['pauseTask', '暂停'],
            ['resumeTask', '恢复'],
            ['stopTask', '停止'],
            ['returnHome', '一键返航'],
            ['getMediaList', '拉取媒体'],
          ].map(([cmd, label]) => (
            <Button key={cmd} size="small" disabled={!caps.has(cmd)} onClick={() => sendCommand(cmd)}>
              {label}
              {!caps.has(cmd) && <Tag size="small" style={{ marginLeft: 4 }}>不支持</Tag>}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
