import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Tabs, TabPane, Table, Button, Modal, Input, InputNumber, Select, Space, Tag, Toast, Popconfirm,
  Descriptions, Card, RadioGroup, Radio, TreeSelect, Upload, Checkbox, Banner,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSync, IconDownload, IconUpload, IconSearch, IconPlay, IconStop } from '@douyinfe/semi-icons';
import { get as httpGet, post, del, postForm, download, withTimeout } from '@/api/http';
import { fetchPullingMap } from '@/api/pulling';
import { analyzeAi } from '@/api/ai';
import AiResultView from '@/components/AiResultView';
import { getToken } from '@/api/token';
import { useAuthStore } from '@/store/auth';
import { Hint } from '@/components/ui';

export default function AccessPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="摄像机台账" itemKey="ledger"><CameraLedgerTab /></TabPane>
          <TabPane tab="录像计划" itemKey="record"><RecordPlanTab /></TabPane>
          <TabPane tab="录像设备(NVR)" itemKey="nvr"><NvrTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

/* ================= 摄像机台账（面向摄像机对象的简化视图：一台摄像机一行） =================
 * 把「国标注册 / RTSP拉流 / 挂NVR / 平台录像」这些底层细节收敛为一行的属性和按钮：
 * 位置 = 行政区划（无则显示挂载的NVR）；接入方式由系统自动识别；录像一键开关；播放直达实时监控。
 * 后面的页签都是高级管理，日常不需要进。
 */
function CameraLedgerTab() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [regionMap, setRegionMap] = useState<Record<string, string>>({});
  const [regionTree, setRegionTree] = useState<any[]>([]);
  const [bindings, setBindings] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [nvrs, setNvrs] = useState<any[]>([]);
  const [recordSet, setRecordSet] = useState<Set<string>>(new Set());
  const [kw, setKw] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [editing, setEditing] = useState<any>(null);
  const [editingDev, setEditingDev] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [storageMap, setStorageMap] = useState<Record<string, any>>({});
  const [storageNodes, setStorageNodes] = useState<any[]>([]);
  const [pullMap, setPullMap] = useState<Record<string, boolean>>({});
  const [recognize, setRecognize] = useState<any>(null);   // { gbId, name, schemeId, result }
  const [recognizing, setRecognizing] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  /** 从设备行"加通道"进来时预填（该设备的 IP/名称），避免手抄 IP */
  const [wizardPreset, setWizardPreset] = useState<any>(null);
  // 设备-通道两级：设备来自国标设备表，通道来自通用通道表，靠 dataDeviceId 关联
  const [devices, setDevices] = useState<any[]>([]);
  const [proxies, setProxies] = useState<any[]>([]);
  const hasPerm = useAuthStore((s) => s.hasPerm('settings.media', 'edit'));

  const flattenRegions = (nodes: any[], prefix?: string): any[] => {
    const out: any[] = [];
    (nodes || []).forEach((n) => {
      const label = prefix ? prefix + ' / ' + (n.name || n.deviceId) : (n.name || n.deviceId || String(n.id));
      out.push({ value: String(n.deviceId ?? n.id), label });
      if (n.children) out.push(...flattenRegions(n.children, label));
    });
    return out;
  };

  const load = async () => {
    const [chs, tree, binds, pl, nv, rec, sch, stor, nodes, devs, px] = await Promise.all([
      httpGet<any>('/api/common/channel/list', { page: 1, count: 1000 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any[]>('/api/region/tree/list', { query: 1 }).catch(() => []),
      httpGet<any[]>('/api/patrol/access/nvr/bindings').catch(() => []),
      httpGet<any>('/api/record/plan/query', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any[]>('/api/patrol/access/nvr/list').catch(() => []),
      // 通道列表的 recordPLan 字段在 WVP 里映射不上（上游命名笔误），用 hasRecordPlan 过滤得到已开录像集合
      httpGet<any>('/api/common/channel/list', { page: 1, count: 1000, hasRecordPlan: true }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any[]>('/api/patrol/scheme/list').catch(() => []),
      httpGet<any[]>('/api/patrol/access/storage/list').catch(() => []),
      httpGet<any[]>('/api/patrol/access/storage-nodes').catch(() => []),
      // 设备表（父）：国标设备台账，通道按 dataDeviceId 挂到设备
      httpGet<any>('/api/device/query/devices', { page: 1, count: 500 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      // 拉流代理（子）：RTSP 通道没有父设备号，用代理源地址的 IP 与设备 IP 匹配来归组
      httpGet<any>('/api/proxy/list', { page: 1, count: 500 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
    ]);
    const flat = flattenRegions(tree || []);
    const map: Record<string, string> = {};
    flat.forEach((f) => { map[String(f.value)] = f.label; });
    setRegionMap(map);
    setRegionTree(flat);
    setBindings(binds || []);
    setPlans(pl || []);
    setNvrs(nv || []);
    setRows(chs || []);
    setRecordSet(new Set((rec || []).map((c: any) => String(c.gbId))));
    setSchemes(sch || []);
    const sm: Record<string, any> = {};
    (stor || []).forEach((s: any) => { sm[String(s.channelId)] = s; });
    setStorageMap(sm);
    setStorageNodes(nodes || []);
    setDevices(devs || []);
    setProxies(px || []);
    fetchPullingMap().then(setPullMap);
  };
  useEffect(() => { load(); }, []);

  const bindMap = useMemo(() => {
    const m: Record<string, any> = {};
    (bindings || []).forEach((b) => { m[String(b.channelId)] = b; });
    return m;
  }, [bindings]);

  const filtered = useMemo(() => rows
    .filter((r) => !kw || (r.name || '').includes(kw) || (r.gbName || '').includes(kw) || (r.gbDeviceId || '').includes(kw))
    .filter((r) => !status || (r.status ?? r.gbStatus) === status), [rows, kw, status]);

  /** 设备 → 通道 分组：国标通道按 dataDeviceId 挂设备；RTSP 代理通道按源地址 IP 匹配设备（见 groupChannelsByDevice） */
  const deviceGroups = useMemo(() => {
    const matchDev = (d: any) => kw && ((d.name || '').includes(kw) || (d.deviceId || '').includes(kw));
    return groupChannelsByDevice(devices, filtered, proxies)
      .filter((g: any) => g.channels.length > 0 || (!status && g._type === 'device' && matchDev(g.dev)));
  }, [filtered, devices, proxies, kw, status]);

  const channelCount = (g: any) => g.channels.length;

  const locationOf = (r: any) => {
    const region = regionMap[String(r.gbCivilCode)];
    if (region) return region;
    const b = bindMap[String(r.gbId)];
    return b ? `挂载:${b.nvrName}·通${b.nvrChannelNo}` : '—';
  };

  const ensure24hPlan = async (): Promise<number> => {
    let plan = plans.find((x) => x.name === '全天候录像');
    if (!plan) {
      const planItemList = [1, 2, 3, 4, 5, 6, 7].map((w) => ({ weekDay: w, start: 0, stop: 86399 }));
      await post('/api/record/plan/add', { name: '全天候录像', planItemList });
      const l = await httpGet<any>('/api/record/plan/query', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
      plan = (l || []).find((x: any) => x.name === '全天候录像');
      setPlans(l || []);
    }
    return plan?.id;
  };

  const toggleRecord = async (r: any) => {
    setBusyId(String(r.gbId));
    try {
      if (recordSet.has(String(r.gbId))) {
        await post(`/api/patrol/access/record/unlink?channelId=${r.gbId}`, {});
        Toast.success(`[${r.name || r.gbName}] 已关闭平台录像`);
      } else {
        const planId = await ensure24hPlan();
        if (!planId) throw new Error('计划创建失败');
        await post('/api/record/plan/link', { planId, channelIds: [r.gbId] });
        Toast.success(`[${r.name || r.gbName}] 已开启 7×24 平台录像（存媒体服务器磁盘）`);
      }
      load();
    } catch (e: any) {
      Toast.error('操作失败：' + (e?.message || ''));
    } finally { setBusyId(null); }
  };

  /** 手动识别：抓帧 → YOLO+VLM → 结果/告警 */
  const doRecognize = async () => {
    if (!recognize) return;
    setRecognizing(true);
    try {
      const r = await withTimeout(
        analyzeAi({ source: 'CHANNEL', channelId: recognize.gbId, schemeId: recognize.schemeId, label: recognize.name || '' }),
        60000, '识别');
      setRecognize((s: any) => ({ ...s, result: r }));
      if (r?.ok === false) Toast.error(r.error || '识别失败');
      else Toast.success(`识别完成：${r.result === 'NORMAL' ? '正常' : r.result === 'ABNORMAL' ? '异常' : r.result}`);
    } catch (e: any) {
      setRecognize((s: any) => ({ ...s, result: { ok: false, error: e?.message || '识别失败' } }));
    } finally { setRecognizing(false); }
  };

  const saveEdit = async () => {
    const e = editing;
    if (e.name !== e._oldName) {
      await post('/api/common/channel/update', { ...e._raw, name: e.name });
    }
    if (String(e.region ?? '') !== String(e._raw.gbCivilCode ?? '')) {
      await post(`/api/patrol/access/record/region?channelId=${e.gbId}${e.region ? '&civilCode=' + encodeURIComponent(e.region) : ''}`, {});
    }
    // 录像归属（ZLM 平台存储 / 厂商 NVR / 不录）：同时决定取流与云台是否经 NVR
    const storeType = e.storageType || 'ZLM';
    await post(`/api/patrol/access/storage/assign?channelId=${e.gbId}&storageType=${storeType}`
      + (storeType === 'NVR' ? `&nvrId=${e.nvrId}&nvrChannelNo=${e.nvrChannelNo ?? 1}` : ''), {});
    Toast.success('已保存');
    setEditing(null);
    load();
  };

  const saveDeviceEdit = async () => {
    if (!editingDev) return;
    try {
      await post('/api/device/query/device/update', {
        ...editingDev,
        name: editingDev.customName || editingDev.name,
        customName: editingDev.customName || editingDev.name,
      });
      Toast.success('设备信息已更新');
      setEditingDev(null);
      load();
    } catch (e: any) {
      Toast.error('更新失败：' + (e?.message || ''));
    }
  };

  const deleteDevice = async (dev: any) => {
    try {
      await del(`/api/device/query/devices/${dev.deviceId}/delete`);
      Toast.success(`设备 [${dev.name || dev.deviceId}] 已删除`);
      load();
    } catch (e: any) {
      Toast.error('删除失败：' + (e?.message || ''));
    }
  };

  const syncGbDevices = async () => {
    setBusyId('__sync__');
    try {
      const d = await httpGet<any>('/api/device/query/devices', { page: 1, count: 100 })
        .then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
      let ok = 0;
      for (const dv of d || []) {
        try { await httpGet(`/api/device/query/devices/${dv.deviceId}/sync`); ok++; } catch { /* 单台失败继续 */ }
      }
      Toast.success(`已向 ${ok}/${(d || []).length} 台国标设备发起目录同步`);
      setTimeout(load, 3000);
    } finally { setBusyId(null); }
  };

  /** 勾选的通道（批量删除用）：通道子表的 rowSelection 回写 */
  const [checkedChannels, setCheckedChannels] = useState<any[]>([]);
  /** 展开的设备行（受控）：点设备名也能展开/收起，不必非点箭头 */
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const deleteBatch = async () => {
    if (!checkedChannels.length) return;
    setBusyId('__batch__');
    try {
      let ok = 0;
      for (const c of checkedChannels) {
        try { await deleteChannelRow(c); ok++; } catch { /* 单条失败继续，最后汇总 */ }
      }
      Toast.success(`已删除 ${ok}/${checkedChannels.length} 条通道`);
      setCheckedChannels([]);
      load();
    } finally { setBusyId(null); }
  };

  /** 通道子表的列（挂在设备行展开区里）。列数刻意压到 5 个：通道/状态/平台录像/操作 + 勾选列，
   *  之前 8 列会把子表撑得比父表宽、必须横向拖动才能看到"操作" */
  const channelColumns: any[] = [
    { title: '通道', dataIndex: 'name', render: (v: string, r: any) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v || r.gbName}</div>
          <div className="mono text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{r.gbDeviceId}</div>
        </div>
      ) },
    { title: '状态', width: 150, render: (_: any, r: any) => {
        const on = (r.status ?? r.gbStatus) === 'ON';
        const pulling = r.dataType === 3 && !!pullMap[`live/${r.streamId}`];
        const online = r.dataType === 3 ? pulling : on;
        return (
          <Space spacing={4}>
            <Tag size="small" color={online ? 'green' : 'grey'}>
              {r.dataType === 3 ? (pulling ? '拉流中' : '未拉流') : (on ? '在线' : '离线')}
            </Tag>
            <Tag size="small" color={r.dataType === 3 ? 'cyan' : r.dataType === 2 ? 'purple' : 'blue'}>
              {r.dataType === 3 ? 'RTSP' : r.dataType === 2 ? '推流' : '国标'}
            </Tag>
          </Space>
        );
      } },
    { title: '平台录像', width: 240, render: (_: any, r: any) => {
        const st = storageMap[String(r.gbId)]?.storageType;
        if (st === 'NVR') return <span className="text-muted" style={{ fontSize: 12 }}>NVR 本机录制（在 NVR 上配）</span>;
        if (st === 'NONE') return <span className="text-muted" style={{ fontSize: 12 }}>不录</span>;
        return recordSet.has(String(r.gbId)) ? (
          <Space spacing={6}>
            <Tag size="small" color="green">7×24 录像中</Tag>
            <Button size="small" theme="borderless" type="danger" loading={busyId === String(r.gbId)} disabled={!hasPerm}
              onClick={() => toggleRecord(r)}>关闭</Button>
          </Space>
        ) : (
          <Button size="small" theme="solid" loading={busyId === String(r.gbId)} disabled={!hasPerm} onClick={() => toggleRecord(r)}>开启录像</Button>
        );
      } },
    {
      title: '操作', width: 250,
      render: (_: any, r: any) => (
        <Space spacing={4}>
          <Button size="small" theme="solid" type="primary" onClick={() => navigate('/monitor/video?channelId=' + r.gbId)}>播放</Button>
          <Button size="small" onClick={() => setRecognize({
            gbId: r.gbId,
            name: r.name || r.gbName,
            schemeId: (schemes[0] && schemes[0].id) || undefined,
            result: null,
          })}>识别</Button>
          <Button size="small" disabled={!hasPerm} onClick={() => setEditing({
            gbId: r.gbId,
            name: r.name || r.gbName || '',
            region: r.gbCivilCode ? String(r.gbCivilCode) : undefined,
            storageType: storageMap[String(r.gbId)]?.storageType || 'ZLM',
            nvrId: storageMap[String(r.gbId)]?.nvrId ?? bindMap[String(r.gbId)]?.nvrId,
            nvrChannelNo: storageMap[String(r.gbId)]?.nvrChannelNo ?? bindMap[String(r.gbId)]?.nvrChannelNo ?? 1,
            _raw: r,
            _oldName: r.name || r.gbName || '',
          })}>编辑</Button>
          <Popconfirm
            title={r.dataType === 3 ? '删除该拉流代理通道？（停止拉流，ZLM 已录的 MP4 保留）' : '删除整台国标设备（含其全部通道）？设备端仍开着注册会自动回来'}
            onConfirm={async () => { await deleteChannelRow(r); load(); }}>
            <Button size="small" type="danger" theme="light" disabled={!hasPerm}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Input prefix={<IconSearch />} placeholder="搜索名称/编号" value={kw} onChange={setKw} style={{ width: 200 }} showClear />
        <Select placeholder="在线状态" value={status} onChange={setStatus} showClear style={{ width: 110 }}
          optionList={[{ value: 'ON', label: '在线' }, { value: 'OFF', label: '离线' }]} />
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Button icon={<IconSync />} loading={busyId === '__sync__'} onClick={syncGbDevices}>同步国标目录</Button>
        <Button icon={<IconDownload />} onClick={() => download('/api/patrol/access/export', { type: 'channels' }, '摄像机清单.xlsx')}>导出</Button>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setWizardOpen(true)}>接入摄像机</Button>
        {checkedChannels.length > 0 && (
          <Popconfirm title={`删除选中的 ${checkedChannels.length} 条通道？（国标通道会连同其设备一起注销）`}
            onConfirm={deleteBatch}>
            <Button type="danger" theme="light" loading={busyId === '__batch__'}>
              批量删除（{checkedChannels.length}）
            </Button>
          </Popconfirm>
        )}
      </Space>
      {/* 设备表（父）→ 展开是通道表（子）：一行一台设备，展开看它名下所有通道 */}
      <Table size="small" rowKey="_rowKey" dataSource={deviceGroups}
        expandedRowKeys={expandedKeys}
        onExpandedRowsChange={(keys: any) => setExpandedKeys(Array.isArray(keys) ? keys : [...(keys || [])])}
        pagination={{ pageSize: 10, showTotal: true }}
        empty="暂无设备。点「接入摄像机」接第一台，或在设备端配国标注册自动上线"
        expandedRowRender={(g: any) => (
          // 子表宽度锁在父表内（之前子表列多会把整页撑出横向滚动条）
          <div style={{ padding: '6px 0 6px 20px', maxWidth: '100%', overflowX: 'auto' }}>
            <Table size="small" rowKey="gbId" dataSource={g.channels} pagination={false}
              rowSelection={{
                selectedRowKeys: checkedChannels.map((c: any) => c.gbId),
                onChange: (_: any, rows: any[]) => setCheckedChannels((prev) => {
                  // 子表分属不同设备，选中集要跨设备累积（直接覆盖会丢别的设备的勾选）
                  const others = prev.filter((p: any) => !g.channels.some((c: any) => c.gbId === p.gbId));
                  return [...others, ...(rows || [])];
                }),
                getCheckboxProps: (r: any) => ({ disabled: !hasPerm, 'aria-label': `选择 ${r.name || r.gbName || r.gbId}` }),
              }}
              empty={g._type === 'orphan' ? '无' : '该设备下暂无通道'} columns={channelColumns} />
          </div>
        )}
        columns={[
          // 设备名 + 编号压在一行；点名字也能展开/收起子表（不必非点箭头）
          { title: '设备', render: (_: any, g: any) => {
              if (g._type === 'orphan') return <span className="text-muted">未关联设备（通道未挂到任何设备台账）</span>;
              const toggle = () => setExpandedKeys((ks) => ks.includes(g._rowKey) ? ks.filter((k) => k !== g._rowKey) : [...ks, g._rowKey]);
              return (
                <div style={{ display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', gap: 8, minWidth: 0, whiteSpace: 'nowrap', marginLeft: 6 }}>
                  <a onClick={toggle} style={{ fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>{g.dev.customName || g.dev.name || '未命名设备'}</a>
                  <span className="mono text-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.dev.deviceId}</span>
                </div>
              );
            } },
          { title: 'IP', width: 140, render: (_: any, g: any) => g._type === 'orphan'
              ? <span className="text-muted">—</span> : <span className="mono">{g.dev?.ip || (g.dev?.hostAddress ? g.dev.hostAddress.split(':')[0] : '—')}</span> },
          { title: '型号', width: 170, render: (_: any, g: any) => g._type === 'orphan' ? '—' : (
              <span title={g.dev.model} style={{ display: 'inline-block', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.dev.model || '—'}</span>
            ) },
          { title: '状态', width: 80, render: (_: any, g: any) => g._type === 'orphan'
              ? <Tag size="small" color="orange">待关联</Tag>
              : <Tag size="small" color={g.dev.onLine ? 'green' : 'grey'}>{g.dev.onLine ? '在线' : '离线'}</Tag> },
          { title: '通道', width: 170, render: (_: any, g: any) => {
              const kinds = new Set(g.channels.map((c: any) => c.dataType));
              return (
                <Space spacing={4}>
                  <span style={{ fontSize: 12 }}>{channelCount(g)} 条</span>
                  {kinds.has(1) && <Tag size="small" color="blue">国标</Tag>}
                  {kinds.has(2) && <Tag size="small" color="purple">推流</Tag>}
                  {kinds.has(3) && <Tag size="small" color="cyan">RTSP</Tag>}
                </Space>
              );
            } },
          { title: '操作', width: 220, render: (_: any, g: any) => g._type === 'orphan' ? null : (
              <Space spacing={4}>
                <Button size="small" disabled={!g.channels.length}
                  onClick={() => navigate('/monitor/video?channelId=' + g.channels[0]?.gbId)}>播放</Button>
                <Button size="small" disabled={!hasPerm}
                  onClick={() => setEditingDev({
                    ...g.dev,
                    customName: g.dev.customName || g.dev.name || '',
                    charset: g.dev.charset || 'UTF-8',
                    streamMode: g.dev.streamMode || 'UDP',
                    password: g.dev.password || '',
                  })}>编辑</Button>
                <Popconfirm
                  title={`确认删除国标设备 [${g.dev.customName || g.dev.name || g.dev.deviceId}] 及其名下全部通道？`}
                  onConfirm={() => deleteDevice(g.dev)}>
                  <Button size="small" type="danger" theme="light" disabled={!hasPerm}>删除</Button>
                </Popconfirm>
              </Space>
            ) },
        ]} />

      <Modal title={'编辑摄像机 · ' + (editing?.name ?? '')} visible={!!editing} onCancel={() => setEditing(null)}
        onOk={saveEdit} width={520}>
        {editing && (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="名称" />
            <TreeSelect style={{ width: '100%' }} dropdownStyle={{ maxHeight: 300, overflow: 'auto' }}
              placeholder="归属行政区划（可清空）" treeData={regionTree} value={editing.region}
              onChange={(v: any) => setEditing({ ...editing, region: v })} showClear />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 8, width: '100%' }}>
              <Select placeholder="录像归属" value={editing.storageType || 'ZLM'}
                onChange={(v: any) => setEditing({ ...editing, storageType: v })}
                optionList={[
                  { value: 'ZLM', label: 'ZLM 存储节点（平台录像）' },
                  { value: 'NVR', label: '厂商 NVR（本机录像，平台只读）' },
                  { value: 'NONE', label: '不录' },
                ]} />
              <InputNumber placeholder="NVR通道" min={1} style={{ width: '100%' }}
                disabled={editing.storageType !== 'NVR'}
                value={editing.nvrChannelNo ?? 1}
                onChange={(v: any) => setEditing({ ...editing, nvrChannelNo: v })} />
            </div>
            {editing.storageType === 'NVR' && (
              <Select placeholder="选择厂商 NVR" style={{ width: '100%' }} value={editing.nvrId}
                onChange={(v: any) => setEditing({ ...editing, nvrId: v })}
                optionList={nvrs.map((n) => ({ value: n.id, label: `${n.name}（${n.ip}）` }))} />
            )}
            <span className="text-muted" style={{ fontSize: 12 }}>
              归属 ZLM = 平台录像（一键开关，存平台磁盘）；归属厂商 NVR = 录像在 NVR 上配，平台只读检索，且取流/云台经该 NVR。
            </span>
          </Space>
        )}
      </Modal>

      <Modal title={'编辑设备 · ' + (editingDev?.customName || editingDev?.name || editingDev?.deviceId || '')}
        visible={!!editingDev} onCancel={() => setEditingDev(null)} onOk={saveDeviceEdit} width={500}>
        {editingDev && (
          <Space vertical align="start" style={{ width: '100%', gap: 14 }}>
            <div style={{ width: '100%' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>国标设备编号</div>
              <Input disabled value={editingDev.deviceId} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>设备 IP 地址</div>
                <Input value={editingDev.ip || (editingDev.hostAddress ? editingDev.hostAddress.split(':')[0] : '')}
                  onChange={(v) => setEditingDev({ ...editingDev, ip: v })} placeholder="192.168.x.x" />
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>SIP 端口 (Port)</div>
                <InputNumber style={{ width: '100%' }} value={editingDev.port || 5060}
                  onChange={(v: any) => setEditingDev({ ...editingDev, port: v })} />
              </div>
            </div>
            <div style={{ width: '100%' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>设备自定义名称（如：厂区西门球机）</div>
              <Input placeholder="输入设备名称" value={editingDev.customName}
                onChange={(v) => setEditingDev({ ...editingDev, customName: v, name: v })} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>收流模式</div>
                <Select style={{ width: '100%' }} value={editingDev.streamMode}
                  onChange={(v: any) => setEditingDev({ ...editingDev, streamMode: v })}
                  optionList={[
                    { value: 'UDP', label: 'UDP（推荐，兼容性最好）' },
                    { value: 'TCP-PASSIVE', label: 'TCP 被动模式' },
                    { value: 'TCP-ACTIVE', label: 'TCP 主动模式' },
                  ]} />
              </div>
              <div>
                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>字符集编码</div>
                <Select style={{ width: '100%' }} value={editingDev.charset}
                  onChange={(v: any) => setEditingDev({ ...editingDev, charset: v })}
                  optionList={[
                    { value: 'UTF-8', label: 'UTF-8' },
                    { value: 'GB2312', label: 'GB2312' },
                  ]} />
              </div>
            </div>
            <div style={{ width: '100%' }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--semi-color-text-2)' }}>设备访问密码</div>
              <Input placeholder="若设备配置了独立密码请输入" value={editingDev.password}
                onChange={(v) => setEditingDev({ ...editingDev, password: v })} />
            </div>
          </Space>
        )}
      </Modal>

      {/* 手动识别：抓帧 + YOLO/VLM 结果（原图+检测框+结论） */}
      <Modal title={'手动识别 · ' + (recognize?.name ?? '')} visible={!!recognize}
        onCancel={() => { setRecognize(null); }} footer={null} width={760}>
        {recognize && (
          <>
            <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              <Select placeholder="识别方案" style={{ width: 260 }} value={recognize.schemeId}
                onChange={(v: any) => setRecognize({ ...recognize, schemeId: v })}
                optionList={schemes.map((s) => ({ value: s.id, label: s.name }))} />
              <Button theme="solid" type="primary" loading={recognizing} onClick={doRecognize}>开始识别</Button>
              {recognize.result?.ok && recognize.result.costMs != null && (
                <Tag size="large">耗时 {recognize.result.costMs}ms</Tag>
              )}
            </Space>
            {recognize.result && <AiResultView data={recognize.result} />}
          </>
        )}
      </Modal>
      <AccessWizard visible={wizardOpen} preset={wizardPreset}
        onClose={() => { setWizardOpen(false); setWizardPreset(null); }}
        onDone={() => { setWizardOpen(false); setWizardPreset(null); load(); }} />
    </>
  );
}

/** 解析 yoloJson：[{label, confidence, box:[x1,y1,x2,y2]}] */
/* ================= 录像设备（NVR）下拉数据 Hook ================= */
function useNvrList(visible = true) {
  const [nvrs, setNvrs] = useState<any[]>([]);
  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/access/nvr/list').catch(() => []);
    setNvrs(d || []);
    return d || [];
  };
  useEffect(() => { if (visible) load(); }, [visible]);
  return { nvrs, reloadNvrs: load };
}

/* ================= 接入向导（单页：协议 → 参数/挂载 → 测试 → 接入） ================= */
function AccessWizard({ visible, preset, onClose, onDone }: {
  visible: boolean; preset?: { ip?: string; name?: string } | null; onClose: () => void; onDone: () => void;
}) {
  const [vendor, setVendor] = useState('hik');
  const [p, setP] = useState<any>({ port: 554, channelNo: 1, subtype: 0, enableAudio: false, mount: 'direct' });
  const [regions, setRegions] = useState<any[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const { nvrs, reloadNvrs } = useNvrList(visible);
  const [showNvrForm, setShowNvrForm] = useState(false);
  const [nvrForm, setNvrForm] = useState<any>({ vendor: 'hik', rtspPort: 554, apiPort: 80, channelCount: 16 });
  const [nvrSaving, setNvrSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setTestResult(null); setShowNvrForm(false);
      // 从设备行"加通道"进来：预填该设备 IP / 名称，避免手抄 20 位编号对应的地址
      setP({ port: 554, channelNo: 1, subtype: 0, enableAudio: false, mount: 'direct', ip: preset?.ip, name: preset?.name ? `${preset.name} 通道2` : undefined });
      httpGet<any[]>('/api/region/tree/list', { query: 1 }).then((d) => setRegions(flattenRegions(d || []))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const flattenRegions = (nodes: any[], prefix?: string): any[] => {
    const out: any[] = [];
    (nodes || []).forEach((n) => {
      const label = prefix ? prefix + ' / ' + (n.name || n.deviceId) : (n.name || n.deviceId || String(n.id));
      // 区划节点的绑定键是 deviceId（国标编码），通道侧存在 gb_civil_code
      out.push({ value: String(n.deviceId ?? n.id), label });
      if (n.children) out.push(...flattenRegions(n.children, label));
    });
    return out;
  };

  const doTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await post<any>('/api/patrol/access/test', { vendor, ...p, channelNo: p.mount === 'nvr' ? undefined : p.channelNo });
      setTestResult(r);
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.message });
    } finally { setTesting(false); }
  };

  const saveNvr = async () => {
    if (!nvrForm.name || !nvrForm.ip) { Toast.warning('请填写录像设备名称和 IP'); return; }
    setNvrSaving(true);
    try {
      await post('/api/patrol/access/nvr/save', nvrForm);
      Toast.success('录像设备已保存');
      const list = await reloadNvrs();
      setShowNvrForm(false);
      if (list.length > 0) setP((s: any) => ({ ...s, mount: 'nvr', nvrId: list[0].id }));
    } catch { /* 请求层已提示 */ } finally { setNvrSaving(false); }
  };

  const doCreate = async () => {
    if (!testResult?.ok && !window.confirm('尚未测试连通或测试未通过，确认仍要接入？')) return;
    setCreating(true);
    try {
      const r = await post<any>('/api/patrol/access/add', { vendor, ...p, channelNo: p.mount === 'nvr' ? undefined : p.channelNo });
      // 录像归属：平台录像(ZLM) / 厂商NVR / 不录
      if (r?.channelId) {
        const storageType = p.mount === 'nvr' ? 'NVR' : (p.storage ?? 'ZLM');
        await post(`/api/patrol/access/storage/assign?channelId=${r.channelId}&storageType=${storageType}`
          + (storageType === 'NVR' ? `&nvrId=${p.nvrId}&nvrChannelNo=${p.nvrChannelNo ?? 1}` : ''), {});
      }
      Toast.success('接入成功，通道已生成');
      onDone(); onClose();
    } catch { /* 请求层已提示 */ } finally { setCreating(false); }
  };

  const vendors = [
    { v: 'hik', name: '海康威视', desc: '自动拼接 RTSP（/Streaming/Channels）' },
    { v: 'dahua', name: '大华', desc: '自动拼接 RTSP（cam/realmonitor）' },
    { v: 'univ', name: '宇视', desc: '自动拼接 RTSP（media/video）' },
    { v: 'generic', name: '通用 RTSP / ONVIF', desc: '直接粘贴完整 RTSP 地址' },
  ];
  const mountedNvr = nvrs.find((n) => String(n.id) === String(p.nvrId));

  return (
    <Modal title="设备接入向导" visible={visible} onCancel={onClose} footer={null} width={780}>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 14 }}
        description="GB28181 国标设备不走本向导：在设备 Web 页配置 SIP 指向本平台，注册后自动出现在「国标设备」。" />

      {/* ① 接入协议 */}
      <SectionTitle index={1} title="接入协议" />
      <RadioGroup value={vendor} onChange={(e) => { setVendor(e.target.value); setTestResult(null); }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {vendors.map((v) => (
            <div key={v.v} onClick={() => setVendor(v.v)}
              style={{
                border: '1px solid ' + (vendor === v.v ? 'var(--semi-color-primary)' : 'var(--semi-color-border)'),
                borderRadius: 8, padding: '8px 12px', cursor: 'pointer',
                background: vendor === v.v ? 'var(--semi-color-primary-light-default)' : 'transparent',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Radio value={v.v} />
                <b>{v.name}</b>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>{v.desc}</div>
            </div>
          ))}
        </div>
      </RadioGroup>

      {/* ② 取流方式与录像归属（对用户统一成一个选择） */}
      <SectionTitle index={2} title="取流方式与录像归属" />
      <RadioGroup value={p.mount} onChange={(e) => {
        const mount = e.target.value;
        setP((s: any) => ({ ...s, mount, nvrId: mount === 'nvr' ? (s.nvrId ?? nvrs[0]?.id) : undefined }));
        setTestResult(null);
      }}>
        <Radio value="direct">平台取流 + <b>平台录像</b>（ZLM 存储节点，推荐）</Radio>
        <Radio value="nvr">经录像设备（NVR）取流 + <b>NVR 本机录像</b>（平台只读）</Radio>
      </RadioGroup>

      <div style={{ marginTop: 12 }}>
        {p.mount === 'nvr' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px 1fr', gap: 12 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>录像设备（NVR）</div>
                <Select style={{ width: '100%' }} placeholder="选择 NVR" value={p.nvrId}
                  onChange={(v: any) => { setP((s: any) => ({ ...s, nvrId: v })); setTestResult(null); }}
                  optionList={nvrs.map((n) => ({ value: n.id, label: `${n.name}（${n.ip}）` }))} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>NVR 侧通道号</div>
                <InputNumber value={p.nvrChannelNo ?? 1} min={1} style={{ width: '100%' }}
                  onChange={(v: any) => setP((s: any) => ({ ...s, nvrChannelNo: v }))} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>码流</div>
                <Select value={p.subtype} onChange={(v: any) => setP((s: any) => ({ ...s, subtype: v }))} style={{ width: '100%' }}
                  optionList={[{ value: 0, label: '主码流（高清，推荐巡检）' }, { value: 1, label: '子码流（流畅）' }]} />
              </div>
            </div>
            <div className="flex-between" style={{ marginTop: 8 }}>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {mountedNvr
                  ? `取流地址将指向 ${mountedNvr.ip}，通道管理/云台控制经 NVR（${mountedNvr.vendor === 'hik' ? 'ISAPI' : '厂商 CGI'}）下发`
                  : '尚无录像设备，请在下方新增'}
              </span>
              <Button size="small" theme="borderless" onClick={() => setShowNvrForm(!showNvrForm)}>
                {showNvrForm ? '收起' : '＋ 新增录像设备'}
              </Button>
            </div>
            {showNvrForm && (
              <Card size="small" style={{ marginTop: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <Input placeholder="名称（如 1号NVR）" value={nvrForm.name} onChange={(v) => setNvrForm({ ...nvrForm, name: v })} />
                  <Input placeholder="IP" value={nvrForm.ip} onChange={(v) => setNvrForm({ ...nvrForm, ip: v })} />
                  <Select value={nvrForm.vendor} onChange={(v: any) => setNvrForm({ ...nvrForm, vendor: v })}
                    optionList={[{ value: 'hik', label: '海康' }, { value: 'dahua', label: '大华' }, { value: 'univ', label: '宇视' }, { value: 'generic', label: '其他' }]} />
                  <Input placeholder="管理账号" value={nvrForm.username} onChange={(v) => setNvrForm({ ...nvrForm, username: v })} />
                  <Input mode="password" placeholder="管理密码" value={nvrForm.password} onChange={(v) => setNvrForm({ ...nvrForm, password: v })} />
                  <Button theme="solid" type="primary" loading={nvrSaving} onClick={saveNvr}>保存</Button>
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>
                  端口默认 RTSP 554 / 管理(ISAPI) 80，可在「录像设备(NVR)」页修改。
                </div>
              </Card>
            )}
          </>
        ) : vendor === 'generic' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>设备名称</div>
              <Input value={p.name} onChange={(v) => setP({ ...p, name: v })} placeholder="如 现场南门球机" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>完整 RTSP 地址</div>
              <Input value={p.customUrl} onChange={(v) => setP({ ...p, customUrl: v })} placeholder="rtsp://admin:pass@ip:554/..." />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>设备名称</div>
              <Input value={p.name} onChange={(v) => setP({ ...p, name: v })} placeholder="如 现场南门球机" />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>设备 IP</div>
              <Input value={p.ip} onChange={(v) => setP({ ...p, ip: v })} placeholder="192.168.0.64" />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>RTSP 端口</div>
              <InputNumber value={p.port} onChange={(v: any) => setP({ ...p, port: v })} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>账号</div>
              <Input value={p.user} onChange={(v) => setP({ ...p, user: v })} placeholder="admin" />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>密码（特殊字符自动处理）</div>
              <Input mode="password" value={p.password} onChange={(v) => setP({ ...p, password: v })} />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>通道号</div>
              <InputNumber value={p.channelNo} onChange={(v: any) => setP({ ...p, channelNo: v })} min={1} style={{ width: '100%' }} />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>码流</div>
              <Select value={p.subtype} onChange={(v: any) => setP({ ...p, subtype: v })} style={{ width: '100%' }}
                optionList={[{ value: 0, label: '主码流（高清，推荐巡检）' }, { value: 1, label: '子码流（流畅）' }]} />
            </div>
          </div>
        )}
      </div>

      {/* ③ 测试连通 + 归属 */}
      <SectionTitle index={3} title="测试连通与归属" />
      <Space style={{ marginBottom: 10 }}>
        <Button theme="solid" loading={testing} onClick={doTest}
          disabled={p.mount === 'nvr' ? !p.nvrId : vendor === 'generic' ? !p.customUrl : !p.ip}>
          测试连通
        </Button>
        {testResult?.ok && <Tag color="green" size="large">连通成功（{testResult.costMs}ms）</Tag>}
        {testResult && !testResult.ok && <Tag color="red" size="large">{testResult.error || '测试失败'}</Tag>}
      </Space>
      {testResult?.resolvedUrl && (
        <div className="text-muted mono" style={{ fontSize: 11, marginBottom: 10 }}>
          实际取流地址：{testResult.resolvedUrl.replace(/:[^:@/]+@/, ':****@')}
        </div>
      )}
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
        归属行政区划（省/市/区树，在 设置→组织与地图 维护）。不选则通道只在「全部设备」出现。
      </div>
      <TreeSelect style={{ width: '100%' }} dropdownStyle={{ maxHeight: 300, overflow: 'auto' }}
        placeholder="选择行政区划（可空）" treeData={regions} value={p.regionCivilCode}
        onChange={(v: any) => setP({ ...p, regionCivilCode: v })} showClear />

      <div className="flex-between" style={{ marginTop: 18 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          接入摘要：{p.name || (p.mount === 'nvr' ? mountedNvr?.name : p.ip || p.customUrl) || '-'} ·{' '}
          {p.mount === 'nvr' ? `挂载NVR ${mountedNvr?.name || '-'} 通道${p.nvrChannelNo ?? 1}` : vendors.find((v) => v.v === vendor)?.name || vendor}
        </span>
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button theme="solid" type="primary" loading={creating} onClick={doCreate}>确认接入</Button>
        </Space>
      </div>
    </Modal>
  );
}

function SectionTitle({ index, title }: { index: number; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 8px' }}>
      <span style={{
        width: 20, height: 20, borderRadius: '50%', background: 'var(--semi-color-primary)', color: '#fff',
        fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{index}</span>
      <b style={{ fontSize: 14 }}>{title}</b>
    </div>
  );
}

/* ================= 批量导入 ================= */
function BatchImport({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<any>(null);
  return (
    <Modal title="批量导入设备接入" visible={visible} onCancel={() => { setResult(null); onClose(); }} footer={null} width={560}>
      <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
        1. 下载模板 → 2. 按行填写（厂商 hik/dahua/univ/generic）→ 3. 上传导入。generic 行第 10 列填完整 RTSP 地址。
        直连方式导入；需挂载 NVR 的通道导入后在「通道管理」编辑归属。
      </div>
      <Space style={{ marginBottom: 14 }}>
        <Button icon={<IconDownload />} onClick={() => {
          download('/api/patrol/access/template', {}, '设备批量接入模板.xlsx')
            .then(() => Toast.success('模板已下载'))
            .catch((e) => Toast.error(e.message));
        }}>下载模板</Button>
        <Upload
          action="/api/patrol/access/import"
          accept=".xlsx"
          headers={{ 'access-token': getToken() || '' }}
          showClear={false}
          onSuccess={(body: any) => {
            const d = body?.data || body;
            setResult(d);
            if (d?.success > 0) onDone();
          }}
          onError={() => Toast.error('导入失败')}>
          <Button theme="solid" type="primary" icon={<IconUpload />}>上传 Excel</Button>
        </Upload>
      </Space>
      {result && (
        <Card size="small">
          <div style={{ marginBottom: 6 }}>
            共 {result.total} 行：成功 <b style={{ color: 'var(--semi-color-success)' }}>{result.success}</b> / 失败 <b style={{ color: 'var(--semi-color-danger)' }}>{result.fail}</b>
          </div>
          {(result.errors || []).slice(0, 8).map((e: string, i: number) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--semi-color-danger)' }}>{e}</div>
          ))}
        </Card>
      )}
    </Modal>
  );
}

/* ================= 录像设备（NVR）档案 ================= */
function NvrTab() {
  const { nvrs, reloadNvrs } = useNvrList();
  const [bindings, setBindings] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [testing, setTesting] = useState<number | 'form' | null>(null);
  const [testOut, setTestOut] = useState<any>(null);
  const [mediaServers, setMediaServers] = useState<any[]>([]);
  const hasPerm = useAuthStore((s) => s.hasPerm('settings.access', 'edit'));

  const load = async () => {
    await reloadNvrs();
    const [b, ms] = await Promise.all([
      httpGet<any[]>('/api/patrol/access/nvr/bindings').catch(() => []),
      httpGet<any[]>('/api/server/media_server/list').catch(() => []),
    ]);
    setBindings(b || []);
    setMediaServers(ms || []);
  };
  useEffect(() => { load(); }, []);

  const doTest = async (payload: any, key: number | 'form') => {
    setTesting(key); setTestOut(null);
    try {
      const r = await post<any>('/api/patrol/access/nvr/test', payload);
      setTestOut({ key, ...r });
    } catch (e: any) {
      setTestOut({ key, ok: false, error: e.message });
    } finally { setTesting(null); }
  };

  const mountedNames = (id: number) =>
    bindings.filter((b) => String(b.nvrId) === String(id))
      .map((b) => `${b.channelName || b.channelId}(通${b.nvrChannelNo})`).join('、');

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button theme="solid" type="primary" icon={<IconPlus />} disabled={!hasPerm}
          onClick={() => { setEditing({ vendor: 'hik', rtspPort: 554, apiPort: 80, channelCount: 16 }); setTestOut(null); }}>新增录像设备</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" rowKey="id"
        dataSource={[
          ...mediaServers.map((m) => ({
            id: `zlm-${m.id}`, _zlm: true, name: m.id, vendor: 'zlm',
            ip: m.ip, rtspPort: m.rtspPort, apiPort: m.httpPort,
            channelCount: '不限', mountedCount: null, _status: m.status,
          })),
          ...nvrs,
        ]}
        pagination={{ pageSize: 10 }}
        empty="暂无录像设备。摄像头可不挂载（直连取流），挂载后取流与云台走 NVR"
        columns={[
          { title: '类型', dataIndex: 'vendor', width: 110, render: (v: string, r: any) => (
              r._zlm
                ? <Tag size="small" color="blue">平台内置 NVR</Tag>
                : <Tag size="small" color="purple">硬件 NVR</Tag>
            ) },
          { title: '名称', dataIndex: 'name', render: (v: string, r: any) => r._zlm
              ? <span>{v} <span className="text-muted" style={{ fontSize: 11 }}>（平台默认录像池）</span></span>
              : v },
          { title: '厂商', dataIndex: 'vendor', width: 90, render: (v: string, r: any) => r._zlm ? '系统内置' : (({ hik: '海康', dahua: '大华', univ: '宇视', generic: '其他' } as any)[v] || v) },
          { title: 'IP', dataIndex: 'ip', render: (v: string) => <span className="mono">{v}</span> },
          { title: '取流端口', dataIndex: 'rtspPort', width: 90 },
          { title: '管理端口', dataIndex: 'apiPort', width: 90 },
          { title: '账号', dataIndex: 'username', width: 90, render: (v: string, r: any) => r._zlm ? <span className="text-muted">—</span> : v },
          { title: '通道容量', dataIndex: 'channelCount', width: 90 },
          { title: '已挂载', dataIndex: 'mountedCount', width: 90, render: (v: number, r: any) => {
              if (r._zlm) return <span className="text-muted">—</span>;
              const names = mountedNames(r.id);
              return <span title={names}>{v ?? 0} 通道</span>;
            } },
          { title: '状态', dataIndex: '_status', width: 80, render: (v: any, r: any) => (
              r._zlm ? <Tag size="small" color={r._status ? 'green' : 'grey'}>{r._status ? '在线' : '离线'}</Tag> : null
            ) },
          {
            title: '操作', width: 220,
            render: (_: any, r: any) => (
              r._zlm ? (
                <Tag size="small" color="cyan">系统默认录像池</Tag>
              ) : (
                <Space>
                  <Button size="small" loading={testing === r.id}
                    onClick={() => doTest({ ip: r.ip, apiPort: r.apiPort, username: r.username, password: '' }, r.id)}>测试连通</Button>
                  <Button size="small" disabled={!hasPerm} onClick={() => setEditing({ ...r, password: '' })}>编辑</Button>
                  <Popconfirm title="删除后其下挂载绑定一并解除，确认？" onConfirm={async () => {
                    await del(`/api/patrol/access/nvr/delete?id=${r.id}`); Toast.success('已删除'); load();
                  }}>
                    <Button size="small" type="danger" theme="light">删除</Button>
                  </Popconfirm>
                </Space>
              )
            ),
          },
        ]} />
      {testOut && testOut.key !== 'form' && (
        <Banner style={{ marginTop: 10 }} type={testOut.ok ? 'success' : 'danger'} closeIcon={null}
          description={testOut.ok
            ? `连通成功（${testOut.costMs}ms）：${testOut.info?.deviceName || ''} ${testOut.info?.model || ''}`
            : `测试失败：${testOut.error || '未知错误'}`} />
      )}

      <Modal title={editing?.id ? '编辑录像设备 · ' + editing.name : '新增录像设备(NVR)'}
        visible={!!editing} onCancel={() => setEditing(null)} footer={null} width={620}>
        {editing && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>名称</div>
                <Input value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="如 泵房1号NVR" />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>厂商</div>
                <Select style={{ width: '100%' }} value={editing.vendor} onChange={(v: any) => setEditing({ ...editing, vendor: v })}
                  optionList={[{ value: 'hik', label: '海康' }, { value: 'dahua', label: '大华' }, { value: 'univ', label: '宇视' }, { value: 'generic', label: '其他' }]} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>IP</div>
                <Input value={editing.ip} onChange={(v) => setEditing({ ...editing, ip: v })} placeholder="192.168.0.100" />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>RTSP 取流端口</div>
                <InputNumber style={{ width: '100%' }} value={editing.rtspPort} onChange={(v: any) => setEditing({ ...editing, rtspPort: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>管理端口(ISAPI/CGI)</div>
                <InputNumber style={{ width: '100%' }} value={editing.apiPort} onChange={(v: any) => setEditing({ ...editing, apiPort: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>管理账号</div>
                <Input value={editing.username} onChange={(v) => setEditing({ ...editing, username: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>管理密码{editing.id ? '（留空=不修改）' : ''}</div>
                <Input mode="password" value={editing.password} onChange={(v) => setEditing({ ...editing, password: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>通道容量</div>
                <InputNumber style={{ width: '100%' }} value={editing.channelCount} onChange={(v: any) => setEditing({ ...editing, channelCount: v })} />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>备注</div>
                <Input value={editing.remark} onChange={(v) => setEditing({ ...editing, remark: v })} />
              </div>
            </div>
            {testOut && testOut.key === 'form' && (
              <Banner style={{ marginTop: 10 }} type={testOut.ok ? 'success' : 'danger'} closeIcon={null}
                description={testOut.ok
                  ? `连通成功（${testOut.costMs}ms）：${testOut.info?.deviceName || ''} ${testOut.info?.model || ''}`
                  : `测试失败：${testOut.error || '未知错误'}`} />
            )}
            <div className="flex-between" style={{ marginTop: 16 }}>
              <Button loading={testing === 'form'}
                onClick={() => doTest({ ip: editing.ip, apiPort: editing.apiPort, username: editing.username, password: editing.password }, 'form')}>
                测试连通（ISAPI 设备信息）
              </Button>
              <Space>
                <Button onClick={() => setEditing(null)}>取消</Button>
                <Button theme="solid" type="primary" onClick={async () => {
                  if (!editing.name || !editing.ip) { Toast.warning('名称和 IP 必填'); return; }
                  await post('/api/patrol/access/nvr/save', editing);
                  Toast.success('已保存');
                  setEditing(null);
                  load();
                }}>保存</Button>
              </Space>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/* ================= 录像计划（一个录像机一页，内含通道列表） ================= */
function RecordPlanTab() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [proxies, setProxies] = useState<any[]>([]);
  const [currentGroup, setCurrentGroup] = useState<string | null>(null);
  /** 通道 → 已绑定的录像计划（按计划反查通道得到） */
  const [planMap, setPlanMap] = useState<Record<string, any>>({});

  const load = async () => {
    const [p, chs, devs, px] = await Promise.all([
      httpGet<any>('/api/record/plan/query', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any>('/api/common/channel/list', { page: 1, count: 500 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any>('/api/device/query/devices', { page: 1, count: 200 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any>('/api/proxy/list', { page: 1, count: 500 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
    ]);
    setPlans(p || []);
    setChannels(chs || []);
    setDevices(devs || []);
    setProxies(px || []);
    await rebuildPlanMap(p || []);
  };
  useEffect(() => { load(); }, []);

  // 与「摄像机台账」同一套分组逻辑，两页看到的"设备→通道"结构一致
  const groups = useMemo(() => groupChannelsByDevice(devices, channels, proxies).filter((g) => g.channels.length > 0),
    [devices, channels, proxies]);
  useEffect(() => {
    if (!currentGroup && groups.length > 0) setCurrentGroup(groups[0]._rowKey);
  }, [groups, currentGroup]);

  const currentChannels = groups.find((g) => g._rowKey === currentGroup)?.channels || [];

  const ensure24hPlan = async (): Promise<number> => {
    let plan = plans.find((x) => x.name === '全天候录像');
    if (!plan) {
      const planItemList = [1, 2, 3, 4, 5, 6, 7].map((w) => ({ weekDay: w, start: 0, stop: 86399 }));
      await post('/api/record/plan/add', { name: '全天候录像', planItemList });
      const l = await httpGet<any>('/api/record/plan/query', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
      plan = (l || []).find((x: any) => x.name === '全天候录像');
      setPlans(l || []);
    }
    return plan?.id;
  };

  /** 选计划即绑定；清空 = 解绑（不录）。planId = 'new24h' 表示新建 7×24 全天候计划再绑定 */
  const bindPlan = async (ch: any, planId: any) => {
    const name = ch.name || ch.gbName;
    try {
      if (!planId) {
        await post(`/api/patrol/access/record/unlink?channelId=${ch.gbId}`, {});
        Toast.success(`[${name}] 已取消平台录像`);
      } else {
        let pid = planId;
        if (planId === 'new24h') {
          pid = await ensure24hPlan();
          if (!pid) throw new Error('计划创建失败');
        }
        await post('/api/record/plan/link', { planId: pid, channelIds: [ch.gbId] });
        const pname = plans.find((x) => String(x.id) === String(pid))?.name || '所选计划';
        Toast.success(`[${name}] 已按「${pname}」录像（存媒体服务器本地）`);
      }
      load();
    } catch (e: any) {
      Toast.error('操作失败：' + (e?.message || ''));
    }
  };

  /** 反查每个计划下的通道，得到"通道 → 计划"映射（计划数量少，逐个查可接受） */
  const rebuildPlanMap = async (list: any[]) => {
    const map: Record<string, any> = {};
    for (const p of list || []) {
      const chs = await httpGet<any>('/api/record/plan/channel/list', { planId: p.id, page: 1, count: 1000 })
        .then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
      (chs || []).forEach((c: any) => { if (c.gbId != null) map[String(c.gbId)] = p; });
    }
    setPlanMap(map);
  };

  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <aside style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', paddingRight: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>第 1 步：选择设备</div>
        {groups.map((g: any) => (
          <div key={g._rowKey}
            onClick={() => setCurrentGroup(g._rowKey)}
            className="flex-between"
            style={{
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, gap: 8,
              background: currentGroup === g._rowKey ? 'var(--semi-color-primary-light-default)' : 'transparent',
            }}>
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {g._type === 'orphan' ? '未关联设备的通道' : (g.dev?.name || '未命名设备')}
            </span>
            <Tag size="small" color="grey">{g.channels.length} 通道</Tag>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="text-muted" style={{ fontSize: 12, lineHeight: '18px' }}>
            还没有可用通道。先到「摄像机台账」接入摄像机。
          </div>
        )}
      </aside>
      <section style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>第 2 步：给通道开启录像</span>
          <Hint
            text="开启后按 7×24 录到媒体服务器本地，可在「录像回放」检索"
            detail={<>
              点通道行的「开启」即创建/挂上「全天候录像」计划（7×24）。
              <br />需要自定义时段（如只在夜间录）请到「媒体与级联 → 录制计划」新建计划后再绑定。
            </>}
          />
        </div>
        {currentChannels.length === 0 && (
          <Banner type="info" closeIcon={null} style={{ marginBottom: 10 }}
            description={
              <span style={{ fontSize: 12 }}>
                这台设备下暂无通道。先到 <a onClick={() => navigate('/settings/access')} style={{ cursor: 'pointer' }}>摄像机台账</a> 把摄像机的「录像归属」设为这台设备（或点设备行的「加通道」），通道就会出现在这里。
              </span>
            } />
        )}
        <Table size="small" rowKey="gbId" dataSource={currentChannels} pagination={false}
          empty="该设备下暂无通道"
          columns={[
            { title: '通道', dataIndex: 'name', render: (v: string, r: any) => v || r.gbName },
            { title: '国标编号', dataIndex: 'gbDeviceId', render: (v: string) => <span className="mono">{v}</span> },
            { title: '状态', dataIndex: 'status', render: (v: string, r: any) => <Tag color={(v ?? r.gbStatus) === 'ON' ? 'green' : 'grey'}>{(v ?? r.gbStatus) === 'ON' ? '在线' : '离线'}</Tag> },
            {
              title: '录像计划', width: 260,
              render: (_: any, r: any) => {
                const cur = planMap[String(r.gbId)];
                return (
                  <Select
                    size="small" style={{ width: 230 }} showClear
                    placeholder="选择计划（不选=不录）"
                    value={cur ? cur.id : undefined}
                    onChange={(v: any) => bindPlan(r, v)}
                    optionList={[
                      { value: 'new24h', label: '＋ 全天候录像（7×24，自动创建）' },
                      ...plans.map((p: any) => ({ value: p.id, label: `${p.name}（${p.channelCount ?? 0} 通道）` })),
                    ]}
                  />
                );
              },
            },
          ]} />
        <Card size="small" title="已有录像计划" style={{ marginTop: 12 }}>
          {plans.length === 0 ? <span className="text-muted" style={{ fontSize: 12 }}>暂无计划（开启录像后自动创建"全天候录像"）</span> :
            plans.map((p) => (
              <div key={p.id} className="flex-between" style={{ padding: '4px 0', fontSize: 12 }}>
                <span>#{p.id} {p.name}（{p.channelCount ?? 0} 通道）</span>
                <Space>
                  <Button size="small" theme="borderless" onClick={() => navigate('/settings/media')}>管理层计划</Button>
                  <Popconfirm title="确认删除该计划并解除全部关联？" onConfirm={async () => { await del('/api/record/plan/delete', { planId: p.id }); load(); }}>
                    <Button size="small" type="danger" theme="light">删除</Button>
                  </Popconfirm>
                </Space>
              </div>
            ))}
        </Card>
      </section>
    </div>
  );
}

/* ================= 设备 ↔ 通道 分组（台账与录像计划共用） ================= */

/** RTSP 源地址里的主机 IP（rtsp://user:pwd@host:port/path），用于把代理通道挂到设备 */
function hostOfUrl(srcUrl?: string): string {
  if (!srcUrl) return '';
  try {
    const lastAt = srcUrl.lastIndexOf('@');
    if (lastAt !== -1) {
      const rest = srcUrl.substring(lastAt + 1);
      const m = /^([^:/]+)/.exec(rest);
      if (m) return m[1];
    }
  } catch {}
  const m = /@([^:/@]+)(?::\d+)?\//.exec(srcUrl) || /:\/\/(?:[^@/]*@)?([^:/@]+)/.exec(srcUrl);
  return m ? m[1] : '';
}

/**
 * 设备 → 通道 分组。一台物理设备常同时以国标注册和 RTSP 拉流两种方式接入，两条通道必须挂在同一设备下：
 * - 国标/推流通道：dataDeviceId = 设备表主键 id
 * - RTSP 拉流代理：dataDeviceId = proxy id → proxy.srcUrl 的主机 IP 与设备 ip 匹配
 * 归不到设备的通道进"未关联设备"组（不丢数据）。
 */
function groupChannelsByDevice(devices: any[], channels: any[], proxies: any[]) {
  const proxyById = new Map((proxies || []).map((p: any) => [String(p.id), p]));
  const devById = new Map((devices || []).map((d: any) => [String(d.id), d]));
  const devByIp = new Map((devices || []).filter((d: any) => d.ip).map((d: any) => [String(d.ip), d]));
  const byDev = new Map<string, any[]>();
  const orphans: any[] = [];
  (channels || []).forEach((c: any) => {
    let dev: any = null;
    if (c.dataType === 3) {
      const p = proxyById.get(String(c.dataDeviceId));
      const ip = hostOfUrl(p?.srcUrl);
      dev = ip ? devByIp.get(ip) : null;
      // 容错：如果只有一台物理设备，或 IP 包含在 hostAddress 中，自动归组
      if (!dev && (devices || []).length === 1) {
        dev = devices[0];
      }
    } else {
      dev = devById.get(String(c.dataDeviceId));
      if (!dev && (devices || []).length === 1) {
        dev = devices[0];
      }
    }
    if (dev) {
      if (!byDev.has(dev.deviceId)) byDev.set(dev.deviceId, []);
      byDev.get(dev.deviceId)!.push(c);
    } else {
      orphans.push(c);
    }
  });
  const groups = (devices || []).map((d: any) => ({
    _rowKey: `dev-${d.deviceId}`, _type: 'device' as const, dev: d, channels: byDev.get(d.deviceId) || [],
  }));
  if (orphans.length > 0) groups.push({ _rowKey: 'orphan', _type: 'orphan' as any, dev: null as any, channels: orphans });
  return groups;
}

/* ================= 拉流代理（平台主动去设备/NVR拉RTSP形成的流） ================= */
function maskUrl(u: string) {
  return String(u || '').replace(/:[^:@/]+@/, ':****@');
}

/** 台账/通道管理共用删除：RTSP直连=整体清理（停拉流+删代理+删通道）；国标=删整台设备（设备端注册还开着会回来） */
async function deleteChannelRow(r: any) {
  if (r.dataType === 3) {
    await del(`/api/patrol/access/channel?channelId=${r.gbId}`);
    Toast.success('已删除拉流代理通道');
  } else {
    await del(`/api/device/query/devices/${r.deviceId ?? r.dataDeviceId}/delete`);
    Toast.success('已删除国标设备');
  }
}

/* ================= 公共小件 ================= */
function KV({ k, v, mono }: { k: string; v: any; mono?: boolean }) {
  return (
    <div className="flex-between" style={{ padding: '3px 0', fontSize: 12 }}>
      <span className="text-muted" style={{ flexShrink: 0 }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={{ textAlign: 'right', wordBreak: 'break-all' }}>{String(v ?? '-')}</span>
    </div>
  );
}

function fmtTime(ts: any): string {
  if (ts == null || ts === '-' || ts === '') return '-';
  if (typeof ts === 'string' && /[^0-9]/.test(ts)) return ts;
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '-';
  return new Date(n * (n < 1e12 ? 1000 : 1)).toLocaleString('zh-CN', { hour12: false });
}
