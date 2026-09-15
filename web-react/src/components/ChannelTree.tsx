import { useEffect, useMemo, useRef, useState } from 'react';
import { Tree, Input, Tabs, TabPane, Spin, Typography } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import { get } from '@/api/http';
import { fetchPullingMap } from '@/api/pulling';
import { useAuthStore } from '@/store/auth';

export interface TreeChannel {
  id: number;
  deviceId: string;
  deviceIdStr?: string;
  name: string;
  gbName?: string;
  gbDeviceId?: string;
  status: string;
  key?: string;
  dataType?: number;
  streamId?: string;
  civilCode?: string;
  businessGroupId?: string;
  parentId?: string;
}

interface GroupNode {
  id: number;
  name: string;
  parentId: number;
  deviceId?: string;
  businessGroup?: string;
  children?: GroupNode[];
}

/**
 * 通道树（区划 / 业务分组 两个 Tab，与 WVP 旧前端一致）。
 * 数据权限：非 ALL 时按 scopeIds 过滤区划/分组节点。
 */
export default function ChannelTree({ onSelect }: {
  /** 选中通道播放（单击/双击都走这里，由组件内部仲裁，保证一次手势只播一次） */
  onSelect: (ch: TreeChannel) => void;
}) {
  const [regionTree, setRegionTree] = useState<GroupNode[]>([]);
  const [groupTree, setGroupTree] = useState<GroupNode[]>([]);
  const [channels, setChannels] = useState<TreeChannel[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'region' | 'group'>('all');
  const deviceNamesRef = useRef<Record<string, string>>({});

  // WVP 通用通道接口返回 gbId/gbName/gbDeviceId/gbStatus 等字段，统一归一化
  const norm = (raw: any[]): TreeChannel[] =>
    (raw || []).map((c: any) => ({
      id: c.gbId ?? c.id,
      deviceId: c.deviceId ?? c.deviceIdStr,
      deviceIdStr: c.deviceIdStr,
      name: c.name || c.gbName || '未命名通道',
      gbName: c.gbName,
      gbDeviceId: c.gbDeviceId,
      status: c.status ?? c.gbStatus ?? 'OFF',
      dataType: c.dataType,
      streamId: c.streamId,
      civilCode: c.civilCode || c.gbCivilCode,
      businessGroupId: c.businessGroupId || c.gbBusinessGroupId,
      parentId: c.parentId || c.gbParentId,
    }));

  /**
   * 通道状态标签：拉流代理(dataType=3)的"在线"实义是"当前在拉流"（按需取流，无人观看即回收），
   * 标"离线"会误导为设备故障，统一用"未拉流"。
   */
  const statusSuffix = (c: TreeChannel): string => {
    if (c.status === 'ON') return '';
    return c.dataType === 3 ? ' (未拉流)' : ' (离线)';
  };
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const user = useAuthStore((s) => s.user);

  const scopeFilter = (nodes: GroupNode[]): GroupNode[] => {
    if (!user || user.scopeType === 'ALL' || user.admin || (user.scopeIds || []).length === 0) return nodes;
    const ids = new Set(user.scopeIds);
    const walk = (list: GroupNode[]): GroupNode[] =>
      list
        .filter((n) => ids.has(String(n.id)) || ids.has(String(n.deviceId)))
        .map((n) => ({ ...n, children: n.children ? walk(n.children) : undefined }));
    return walk(nodes);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [regions, groups, chs, pull, devices] = await Promise.all([
          get<GroupNode[]>('/api/region/tree/list', { query: 1 }).catch(() => []),
          get<GroupNode[]>('/api/group/tree/list', { query: 1 }).catch(() => []),
          get<any>('/api/common/channel/list', { page: 1, count: 500 }).then((d) => (Array.isArray(d) ? d : d?.list ?? [])).catch(() => []),
          fetchPullingMap(),
          get<any>('/api/device/query/devices', { page: 1, count: 200 })
            .then((d) => (Array.isArray(d) ? d : d?.list ?? [])).catch(() => []),
        ]);
        // 国标通道的父设备名（PVR/NVR）：设备节点按真实设备命名，避免与直连通道混在一组
        const devName: Record<string, string> = {};
        (devices || []).forEach((d: any) => { devName[String(d.deviceId)] = d.name || d.deviceId; });
        setRegionTree(scopeFilter(regions || []));
        setGroupTree(scopeFilter(groups || []));
        // 拉流代理(dataType=3)正在拉流的按"在线"展示（通道表状态是接入快照，不随拉流变化）
        setChannels(norm(chs || []).map((c) =>
          c.dataType === 3 && pull[`live/${c.streamId ?? ''}`] ? { ...c, status: 'ON' } : c));
        deviceNamesRef.current = devName;
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.scopeType]);

  /** 挂通道到树节点（WVP 的树只挂设备，通道按 device 关联） */
  const toTreeData = (nodes: GroupNode[], type: 'region' | 'group', prefix = ''): any[] =>
    nodes.map((n) => {
      const key = `${type}-${n.id}`;
      const chList = channels.filter((c) => {
        if (type === 'region') {
          return (
            (c.civilCode && (c.civilCode === n.deviceId || String(c.civilCode) === String(n.id))) ||
            (n.deviceId && c.deviceId === n.deviceId) ||
            (c.parentId && c.parentId === n.deviceId)
          );
        } else {
          return (
            (c.businessGroupId && (c.businessGroupId === n.deviceId || String(c.businessGroupId) === String(n.id))) ||
            (n.deviceId && c.deviceId === n.deviceId) ||
            (c.parentId && c.parentId === n.deviceId)
          );
        }
      });
      const matched = kw ? n.name.includes(kw) : false;
      const children = toTreeData(n.children || [], type, key + '-');
      const chNodes = chList
        .filter((c) => !kw || c.name.includes(kw) || (c.gbName || '').includes(kw))
        .map((c) => ({
          key: `ch-${c.id}`,
          label: `${c.name}${statusSuffix(c)}`,
          channel: c,
        }));
      return {
        key,
        label: n.name || n.deviceId || `节点${n.id}`,
        ...(matched || kw ? {} : {}),
        children: [...children, ...chNodes],
      };
    });

  const regionData = useMemo(() => toTreeData(regionTree, 'region'), [regionTree, channels, kw]);
  const groupData = useMemo(() => toTreeData(groupTree, 'group'), [groupTree, channels, kw]);

  // "全部设备"节点：按"取流来源"分组——同一台物理设备（如海康 PVR）同时以
  // 国标注册（FX5719313）和 RTSP 拉流代理（海康高清摄像机）两种方式接入时，
  // 两组通道都要能播；节点名区分身份，避免两个名字不同的节点让人看不出关系。
  const allData = useMemo(() => {
    const shown = channels.filter((c) => !kw || c.name.includes(kw) || (c.gbName || '').includes(kw));
    const byGbDevice = new Map<string, TreeChannel[]>();
    const singles: any[] = [];
    shown.forEach((c) => {
      if (c.dataType === 1 && c.deviceId) {
        if (!byGbDevice.has(c.deviceId)) byGbDevice.set(c.deviceId, []);
        byGbDevice.get(c.deviceId)!.push(c);
      } else {
        singles.push({
          key: `ch-${c.id}`,
          // 通道类型前缀让用户一眼看出"这是 RTSP 拉流代理还是国标通道"，两种通道播的是同一台设备的不同路线
          label: `${c.dataType === 3 ? 'RTSP拉流 · ' : c.dataType === 2 ? '推流 · ' : ''}${c.name}${statusSuffix(c)}`,
          channel: c,
        });
      }
    });
    const deviceNodes = [...byGbDevice.entries()].map(([devId, chs]) => ({
      key: `dev-${devId}`,
      label: `${deviceNamesRef.current[devId] || devId}（${chs.length} 通道）`,
      children: chs.map((c) => ({ key: `ch-${c.id}`, label: `${c.name}${statusSuffix(c)}`, channel: c })),
    }));
    return [...deviceNodes, ...singles];
  }, [channels, kw]);

  // Semi 2.x 的 Tree 回调是 onSelect(selectKey, bool, node)：节点在第 3 个参数。
  // 旧代码读第 2 个参数（一个 boolean）上的 nodeData，永远拿不到 channel，
  // 表现为"点通道树毫无反应"。这里取第 3 参，并兼容把节点放第 2 参的旧形态。
  /**
   * 单击/双击仲裁：双击会产生两次 select + 一次 dblclick，若各自都触发播放，
   * 就会出现"点一下开出两个画面"。这里单击延迟 250ms 执行，
   * 双击到来时先撤销挂起的单击，只播一次。
   */
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPending = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  };
  useEffect(() => cancelPending, []);

  const onSelectTree = (selectKey: any, selected: any, node?: any) => {
    const n = node ?? (selected && typeof selected === 'object' ? selected : null);
    if (!n?.channel) return;
    const ch = n.channel;
    // 双击的第二下也会走到这里：撤销挂起的单击后直接返回，交给 onDoubleClick 播
    if (clickTimerRef.current) {
      cancelPending();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onSelect(ch);
    }, 250);
  };

  const onDoubleClickTree = (_e: any, node: any) => {
    cancelPending();
    if (node?.channel) onSelect(node.channel);
  };

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid var(--semi-color-border)' }}>
        <Input
          prefix={<IconSearch />}
          placeholder="搜索名称"
          value={kw}
          onChange={(v) => setKw(v)}
          size="small"
          showClear
        />
      </div>
      {/* 三个 Tab 永远同一行：采用现代 B 端分段胶囊按钮 (Segmented Control)，彻底根治折行与错位 */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--semi-color-border)' }}>
        <div
          style={{
            display: 'flex',
            background: 'var(--semi-color-fill-0)',
            borderRadius: 6,
            padding: 3,
            gap: 4,
          }}
        >
          {[
            { key: 'all', label: '全部设备' },
            { key: 'region', label: '行政区划' },
            { key: 'group', label: '业务分组' },
          ].map((item) => {
            const active = activeTab === item.key;
            return (
              <div
                key={item.key}
                onClick={() => setActiveTab(item.key as any)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '5px 0',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? '#ffffff' : 'var(--semi-color-text-1)',
                  background: active ? 'var(--semi-color-primary)' : 'transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all .15s ease',
                  whiteSpace: 'nowrap',
                  userSelect: 'none',
                  boxShadow: active ? '0 1px 4px rgba(22, 100, 255, 0.3)' : 'none',
                }}
              >
                {item.label}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', maxHeight: 'calc(100vh - 180px)', padding: '4px 0' }}>
        {activeTab === 'all' && (
          allData.length === 0 ? (
            <Typography.Text type="tertiary" style={{ display: 'block', padding: 16, fontSize: 12 }}>
              暂无通道（请在 设置 → 设备接入 添加设备）
            </Typography.Text>
          ) : (
            <Tree treeData={allData} onSelect={onSelectTree} onDoubleClick={onDoubleClickTree} expandAll />
          )
        )}
        {activeTab === 'region' && (
          regionData.length === 0 ? (
            <Typography.Text type="tertiary" style={{ display: 'block', padding: 16, fontSize: 12 }}>
              暂无区划（请先在 设置→组织与地图 添加）
            </Typography.Text>
          ) : (
            <Tree treeData={regionData} onSelect={onSelectTree} onDoubleClick={onDoubleClickTree} expandAll={false} />
          )
        )}
        {activeTab === 'group' && (
          groupData.length === 0 ? (
            <Typography.Text type="tertiary" style={{ display: 'block', padding: 16, fontSize: 12 }}>
              暂无业务分组（请先在 设置→组织与地图 添加）
            </Typography.Text>
          ) : (
            <Tree treeData={groupData} onSelect={onSelectTree} onDoubleClick={onDoubleClickTree} />
          )
        )}
      </div>
    </div>
  );
}
