import { useEffect, useRef, useState } from 'react';
import { Button, Toast, Slider, Card, Divider, Tag, Empty } from '@douyinfe/semi-ui';
import { get as httpGet, post } from '@/api/http';
import { useAuthStore } from '@/store/auth';
import type { TreeChannel } from './ChannelTree';

/**
 * 云台控制面板：
 * - 国标通道：/api/front-end/ptz/{deviceId}/{channelId}?cmdCode=...
 * - 拉流代理通道（dataType=3，挂载了 NVR）：经 NVR 的 ISAPI 下发 /api/patrol/access/nvr-ptz
 * - 光圈聚焦 /api/front-end/fi/iris|focus
 * - 预置位 /api/front-end/preset/query|add|call|delete
 * 权限：hasChannelFunc('ptz') / ('preset') 禁用按钮（后端另有强制校验）
 */
export default function PtzPanel({ channel }: { channel: TreeChannel | null }) {
  const hasFunc = useAuthStore((s) => s.hasChannelFunc);
  const [speed, setSpeed] = useState(50);
  const [presets, setPresets] = useState<any[]>([]);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拉流代理通道：云台经 NVR（ISAPI 连续控制）
  const isProxy = (channel as any)?.dataType === 3 || (channel as any)?.data_type === 3;

  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
  }, []);

  const canPtz = hasFunc('ptz');
  const canPreset = hasFunc('preset');

  const nvrPtz = (pan: number, tilt: number, zoom: number, iris = 0, focus = 0) => {
    if (!channel) return;
    if (!canPtz) {
      Toast.warning('无云台控制权限');
      return;
    }
    const chId = (channel as any).gbId ?? channel.id;
    post(`/api/patrol/access/nvr-ptz?channelId=${chId}`, {
      pan, tilt, zoom, ...(iris ? { iris } : {}), ...(focus ? { focus } : {}),
    }).catch(() => {});
    // 连续控制：500ms 后自动停止（防止设备持续转动）
    if (stopTimer.current) clearTimeout(stopTimer.current);
    if (pan || tilt || zoom || iris || focus) {
      stopTimer.current = setTimeout(() => {
        post(`/api/patrol/access/nvr-ptz?channelId=${chId}`, { pan: 0, tilt: 0, zoom: 0 }).catch(() => {});
      }, 500);
    }
  };

  const cmd = (code: number) => {
    if (!channel) return;
    if (isProxy) {
      const s = speed;
      switch (code) {
        case 2101: nvrPtz(0, 0, 0); break;                 // 停止
        case 2102: nvrPtz(0, s, 0); break;                 // 上
        case 2103: nvrPtz(0, -s, 0); break;                // 下
        case 2203: nvrPtz(s, 0, 0); break;                 // 右
        case 2204: nvrPtz(-s, 0, 0); break;                // 左
        case 2104: nvrPtz(0, 0, s); break;                 // 变倍 +
        case 2105: nvrPtz(0, 0, -s); break;                // 变倍 −
        case 2302: nvrPtz(0, 0, 0, s); break;              // 光圈 +
        case 2303: nvrPtz(0, 0, 0, -s); break;             // 光圈 −
        case 2202: nvrPtz(0, 0, 0, 0, s); break;           // 聚焦 +
        case 2201: nvrPtz(0, 0, 0, 0, -s); break;          // 聚焦 −
        default: break;
      }
      return;
    }
    if (!canPtz) {
      Toast.warning('无云台控制权限');
      return;
    }
    httpGet(`/api/front-end/ptz/${channel.deviceId}/${channel.gbDeviceId ?? channel.deviceIdStr ?? channel.deviceId}`, {
      cmdCode: code,
      horizonSpeed: speed,
      verticalSpeed: speed,
      zoomSpeed: speed,
    }).catch(() => {});
  };

  const loadPresets = async () => {
    if (!channel || !canPreset) return;
    try {
      const data = await httpGet<any>(
        `/api/front-end/preset/query/${channel.deviceId}/${channel.gbDeviceId ?? channel.deviceId}`
      );
      setPresets(data ?? []);
    } catch {
      setPresets([]);
    }
  };

  const presetAction = (action: 'add' | 'call' | 'delete', presetId: number, name?: string) => {
    if (!channel) return;
    httpGet(`/api/front-end/preset/${action}/${channel.deviceId}/${channel.gbDeviceId ?? channel.deviceId}`, {
      presetId,
      presetName: name ?? `预置位${presetId}`,
    })
      .then(() => Toast.success(`预置位${action === 'add' ? '添加' : action === 'call' ? '调用' : '删除'}成功`))
      .then(loadPresets)
      .catch(() => {});
  };

  if (!channel) {
    return <Empty title="未选择通道" description="从左侧通道树选择摄像机后可进行云台控制" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card size="small" title="云台方向">
        <div className="ptz-pad">
          <span />
          <Button onClick={() => cmd(2102)} disabled={!canPtz}>↑</Button>
          <span />
          <Button onClick={() => cmd(2204)} disabled={!canPtz}>←</Button>
          <Button type="primary" onClick={() => cmd(2101)} disabled={!canPtz}>停</Button>
          <Button onClick={() => cmd(2203)} disabled={!canPtz}>→</Button>
          <span />
          <Button onClick={() => cmd(2103)} disabled={!canPtz}>↓</Button>
          <span />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 10 }}>
          <Button size="small" onClick={() => cmd(2104)} disabled={!canPtz}>变倍 +</Button>
          <Button size="small" onClick={() => cmd(2105)} disabled={!canPtz}>变倍 −</Button>
          <Button size="small" onClick={() => cmd(2302)} disabled={!canPtz}>光圈 +</Button>
          <Button size="small" onClick={() => cmd(2303)} disabled={!canPtz}>光圈 −</Button>
          <Button size="small" onClick={() => cmd(2202)} disabled={!canPtz}>聚焦 +</Button>
          <Button size="small" onClick={() => cmd(2201)} disabled={!canPtz}>聚焦 −</Button>
        </div>
        <Divider margin={10}>速度 {speed}</Divider>
        <Slider value={speed} onChange={(v: any) => setSpeed(Number(v))} min={1} max={255} step={10} />
      </Card>

      {!isProxy ? (
        <Card
          size="small"
          title="预置位"
          headerExtraContent={
            <Button size="small" theme="borderless" onClick={loadPresets} disabled={!canPreset}>
              刷新
            </Button>
          }
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            <Button size="small" onClick={() => presetAction('add', presets.length + 1, `预置位${presets.length + 1}`)} disabled={!canPreset}>
              添加预置位
            </Button>
          </div>
          {presets.length === 0 ? (
            <span className="text-muted" style={{ fontSize: 12 }}>点击"添加预置位"或刷新查询</span>
          ) : (
            presets.map((p) => (
              <div key={p.presetId} className="flex-between" style={{ padding: '4px 0' }}>
                <span style={{ fontSize: 12 }}>
                  {p.presetId} · {p.presetName}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <Button size="small" theme="borderless" onClick={() => presetAction('call', p.presetId)} disabled={!canPreset}>
                    调用
                  </Button>
                  <Button size="small" theme="borderless" type="danger" onClick={() => presetAction('delete', p.presetId)} disabled={!canPreset}>
                    删除
                  </Button>
                </span>
              </div>
            ))
          )}
        </Card>
      ) : (
        <Card size="small" title="预置位">
          <span className="text-muted" style={{ fontSize: 12 }}>
            拉流代理通道经 NVR/直连 ISAPI 控制云台（海康系），预置位暂不支持；云台指令下发后 0.5s 自动停止。
          </span>
        </Card>
      )}

      <Card size="small" title="通道信息">
        <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="flex-between"><span className="text-muted">名称</span><span>{channel.name}</span></div>
          <div className="flex-between"><span className="text-muted">国标编号</span><span className="mono">{channel.gbDeviceId ?? channel.deviceIdStr}</span></div>
          <div className="flex-between"><span className="text-muted">接入方式</span><Tag size="small">{isProxy ? '拉流代理(经NVR)' : '国标'}</Tag></div>
          <div className="flex-between"><span className="text-muted">状态</span><Tag size="small" color={channel.status === 'ON' ? 'green' : 'grey'}>{channel.status === 'ON' ? '在线' : '离线'}</Tag></div>
        </div>
      </Card>
    </div>
  );
}
