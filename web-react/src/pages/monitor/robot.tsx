import { useEffect, useState } from 'react';
import { Card, Tag, Button, Empty, Spin, Toast, Progress, Descriptions } from '@douyinfe/semi-ui';
import { get as httpGet, post } from '@/api/http';

/**
 * 机器人监控（对齐旧平台三画面 + 状态栏 + 车体控制 + 一键操作 + 运行数据）。
 * 数据源：/api/patrol/robot/list + /api/patrol/robot/{id}/telemetry（WS 推送增量）
 * 控制权开关 → 协议适配器能力协商（不支持的按钮禁用而非报错）
 */
export default function RobotMonitorPage() {
  const [robots, setRobots] = useState<any[]>([]);
  const [current, setCurrent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [control, setControl] = useState(false);

  const loadRobots = async () => {
    try {
      const list = await httpGet<any[]>('/api/patrol/robot/list').catch(() => []);
      setRobots(list || []);
      if (list && list.length > 0 && !current) setCurrent(list[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRobots();
  }, []);

  const sendCommand = async (cmd: string, params?: any) => {
    if (!current) return;
    if (!control) {
      Toast.warning('请先开启控制权');
      return;
    }
    try {
      const r = await post<any>(`/api/patrol/robot/${current.id}/command`, { command: cmd, params });
      if (r?.state === 'DISABLED') {
        Toast.warning(`设备能力不支持: ${cmd}`);
      } else {
        Toast.success(`指令已下发: ${cmd}`);
      }
    } catch { /* 请求层已提示 */ }
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" /></div>;

  if (robots.length === 0) {
    return (
      <div style={{ padding: 40 }}>
        <Empty
          title="暂无机器人设备"
          description="请先在 设置 → 机器人与装备 → 装备台账 注册机器人（型号未定也可先建占位档案）"
        />
      </div>
    );
  }

  const caps = new Set<string>((current?.capabilitiesJson ? JSON.parse(current.capabilitiesJson) : current?.capabilities || []) as string[]);
  const can = (c: string) => caps.has(c);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 设备选择 + 控制权 */}
      <Card size="small">
        <div className="flex-between">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {robots.map((r) => (
              <Button
                key={r.id}
                size="small"
                theme={current?.id === r.id ? 'solid' : 'light'}
                onClick={() => setCurrent(r)}
              >
                {r.name}
                <Tag size="small" color={r.status === 'ONLINE' ? 'green' : 'grey'} style={{ marginLeft: 6 }}>
                  {r.status === 'ONLINE' ? '在线' : '离线'}
                </Tag>
              </Button>
            ))}
          </div>
          <Button
            type={control ? 'warning' : 'primary'}
            theme="solid"
            size="small"
            onClick={() => setControl((v) => !v)}
          >
            {control ? '释放控制权' : '开启控制权'}
          </Button>
        </div>
      </Card>

      {/* 三画面：可见光 / 红外 / 点云地图（占位） */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, minHeight: 260 }}>
        {['可见光', '红外', '点云地图'].map((t) => (
          <div key={t} className="video-cell" style={{ height: 260 }}>
            <div className="video-cell-header"><span>{t}画面</span><Tag size="small">待接入</Tag></div>
            <div className="video-cell-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6b85', fontSize: 12 }}>
              {current.status === 'ONLINE' ? `${t}流等待协议适配接入` : '设备离线'}
            </div>
          </div>
        ))}
      </div>

      {/* 状态栏 */}
      <Card size="small" title="设备状态">
        <Descriptions
          row
          size="small"
          data={[
            { key: '巡视状态', value: current.statusName || '待命' },
            { key: '运行模式', value: current.mode || '遥控' },
            { key: '底盘通信', value: current.status === 'ONLINE' ? '正常' : '中断' },
            { key: '在桩状态', value: current.onDock ? '已上桩' : '离桩' },
            { key: '当前步态', value: current.gait || '行走' },
            { key: '电池电量', value: <Progress percent={current.battery ?? 0} style={{ width: 120 }} showInfo size="small" /> },
            { key: '行驶里程', value: `${current.mileage ?? 0} m` },
            { key: '水平速度', value: `${current.speed ?? 0} m/s` },
          ]}
        />
      </Card>

      {/* 控制区 */}
      <Card size="small" title="机器人控制">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            ['gotoWaypoint', '定点导航'],
            ['stopTask', '取消导航'],
            ['mapSync', '地图同步'],
            ['returnHome', '一键返航'],
            ['pauseTask', '暂停'],
            ['resumeTask', '恢复'],
            ['setPtz', '云台复位'],
          ].map(([cmd, label]) => (
            <Button
              key={cmd}
              size="small"
              disabled={!can(cmd) || !control}
              onClick={() => sendCommand(cmd)}
            >
              {label}
              {!can(cmd) && <Tag size="small" style={{ marginLeft: 4 }}>能力不支持</Tag>}
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
