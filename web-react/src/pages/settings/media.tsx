import { useEffect, useState } from 'react';
import { Tabs, TabPane, Table, Button, Modal, Input, Space, Tag, Toast, Popconfirm, Card, Descriptions, Switch, Checkbox, Select, Tooltip, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconEdit, IconDelete } from '@douyinfe/semi-icons';
import { get as httpGet, postForm, post, del } from '@/api/http';

/** 设置 → 媒体与级联：媒体节点（ZLMediaKit 流媒体引擎） | 国标级联（向上级国标平台推送） */
export default function MediaPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="媒体节点" itemKey="server"><MediaServersTab /></TabPane>
          <TabPane tab="国标级联" itemKey="platform"><PlatformsTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function MediaServersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [info, setInfo] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    id: '',
    ip: '',
    httpPort: 8081,
    secret: 'su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf',
    type: 'zlm',
    hookIp: '127.0.0.1',
    sdpIp: '',
    streamIp: '',
    rtspPort: 554,
    rtmpPort: 1935,
    autoConfig: true,
    rtpEnable: true,
    rtpPortRange: '30000,30500',
    defaultServer: false,
  });

  const load = async () => {
    const d = await httpGet<any[]>('/api/server/media_server/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setForm({
      id: `zlm-${Date.now().toString().slice(-4)}`,
      ip: '127.0.0.1',
      httpPort: 8081,
      secret: 'su6TiedN2rVAmBbIDX0aa0QTiBJLBdcf',
      type: 'zlm',
      hookIp: '127.0.0.1',
      sdpIp: '',
      streamIp: '',
      rtspPort: 554,
      rtmpPort: 1935,
      autoConfig: true,
      rtpEnable: true,
      rtpPortRange: '30000,30500',
      defaultServer: false,
    });
    setIsEdit(false);
    setModalOpen(true);
  };

  const openEdit = (row: any) => {
    setForm({
      ...row,
      httpPort: row.httpPort || 8081,
      secret: row.secret || '',
      type: row.type || 'zlm',
      hookIp: row.hookIp || '127.0.0.1',
      sdpIp: row.sdpIp || '',
      streamIp: row.streamIp || '',
      rtspPort: row.rtspPort || 0,
      rtmpPort: row.rtmpPort || 0,
      autoConfig: row.autoConfig !== false,
      rtpEnable: !!row.rtpEnable,
      rtpPortRange: row.rtpPortRange || '30000,30500',
    });
    setIsEdit(true);
    setModalOpen(true);
  };

  const onTest = async (testItem?: any) => {
    const target = testItem || form;
    if (!target.ip || !target.httpPort || !target.secret) {
      Toast.warning('请确保填写 IP、HTTP端口 和 Secret');
      return;
    }
    setTesting(true);
    try {
      const res = await httpGet<any>('/api/server/media_server/check', {
        ip: target.ip,
        port: Number(target.httpPort),
        secret: target.secret,
        type: target.type || 'zlm',
      });
      Toast.success('测试连通成功！已从该节点获取最新能力集');
      if (res && !testItem) {
        setForm((prev: any) => ({
          ...prev,
          rtspPort: res.rtspPort || prev.rtspPort,
          rtmpPort: res.rtmpPort || prev.rtmpPort,
          httpSSlPort: res.httpSSlPort || prev.httpSSlPort,
          rtspSSLPort: res.rtspSSLPort || prev.rtspSSLPort,
          rtmpSSlPort: res.rtmpSSlPort || prev.rtmpSSlPort,
        }));
      }
    } catch {
      // 拦截器已报错
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    if (!form.id || !form.ip || !form.httpPort) {
      Toast.warning('请填写完整的节点 ID、IP 和 HTTP 端口');
      return;
    }
    setSaving(true);
    try {
      await post('/api/server/media_server/save', {
        ...form,
        httpPort: Number(form.httpPort),
        rtspPort: Number(form.rtspPort || 0),
        rtmpPort: Number(form.rtmpPort || 0),
        sdpIp: form.sdpIp || form.ip,
        streamIp: form.streamIp || form.ip,
      });
      Toast.success(isEdit ? '媒体节点已更新' : '媒体节点已成功添加');
      setModalOpen(false);
      load();
    } catch {
      // 拦截器已报错
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (row: any) => {
    try {
      await del('/api/server/media_server/delete', { id: row.id });
      Toast.success('媒体节点已移除');
      load();
    } catch {
      // 拦截器已报错
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={openCreate}>添加节点</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Button onClick={async () => {
          const i = await httpGet<any>('/api/server/system/info').catch(() => null);
          setInfo(i);
        }}>服务器信息</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={false} empty="暂无媒体节点"
        columns={[
          { title: 'ID', dataIndex: 'id', render: (v: string, r: any) => (
            <Space>
              <span className="mono" style={{ fontWeight: 600 }}>{v}</span>
              {r.defaultServer && <Tag color="blue" size="small">默认</Tag>}
            </Space>
          )},
          { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color="cyan">{v ? v.toUpperCase() : 'ZLM'}</Tag> },
          { title: 'IP', dataIndex: 'ip' },
          { title: 'HTTP端口', dataIndex: 'httpPort' },
          { title: 'RTSP端口', dataIndex: 'rtspPort' },
          { title: 'Hook IP', dataIndex: 'hookIp' },
          { title: '状态', dataIndex: 'status', render: (v: boolean) => <Tag color={v ? 'green' : 'grey'}>{v ? '在线' : '离线'}</Tag> },
          { title: 'Hook周期', dataIndex: 'hookAliveInterval', render: (v: any) => `${v ?? 10}s` },
          {
            title: '操作',
            key: 'action',
            render: (_: any, record: any) => (
              <Space>
                <Button size="small" theme="borderless" icon={<IconEdit />} onClick={() => openEdit(record)}>编辑</Button>
                <Button size="small" theme="borderless" onClick={() => onTest(record)}>测试</Button>
                {record.defaultServer ? (
                  <Tooltip content="系统默认节点不可删除">
                    <Button size="small" theme="borderless" disabled icon={<IconDelete />}>删除</Button>
                  </Tooltip>
                ) : (
                  <Popconfirm title="确认删除" content={`确定要移除媒体节点 ${record.id} 吗？`} onConfirm={() => onDelete(record)}>
                    <Button size="small" theme="borderless" type="danger" icon={<IconDelete />}>删除</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]} />

      {/* 添加/编辑媒体节点弹窗 */}
      <Modal
        title={isEdit ? `编辑媒体节点: ${form.id}` : '添加媒体服务节点 (ZLM)'}
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={onSave}
        confirmLoading={saving}
        width={680}
        okText="保存配置"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '8px 12px', background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            💡 <strong>节点连接与同步机制</strong>：新部署 ZLM 节点时，请填写其 IP、HTTP 端口及密钥进行测试连接。填写正确的 <strong>Hook IP</strong>（ZLM 访问本 WVP 系统的 IP 地址），保存后平台将自动向该 ZLM 下发回调地址，实现推流、点播与心跳的双向自动同步。
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>节点 ID *</label>
              <Input
                value={form.id}
                onChange={(v) => setForm({ ...form, id: v })}
                placeholder="例如: zlm-node-2"
                disabled={isEdit}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>引擎类型</label>
              <Select
                value={form.type || 'zlm'}
                onChange={(v) => setForm({ ...form, type: v })}
                style={{ width: '100%' }}
              >
                <Select.Option value="zlm">ZLMediaKit (推荐)</Select.Option>
                <Select.Option value="abl">ABLMediaServer</Select.Option>
              </Select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>节点 IP *</label>
              <Input
                value={form.ip}
                onChange={(v) => setForm({ ...form, ip: v })}
                placeholder="例如: 192.168.1.50"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>HTTP 端口 *</label>
              <Input
                value={form.httpPort}
                onChange={(v) => setForm({ ...form, httpPort: v })}
                placeholder="默认 8081"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>Secret 密钥 *</label>
              <Input
                value={form.secret}
                onChange={(v) => setForm({ ...form, secret: v })}
                placeholder="ZLM config.ini 中的 api.secret"
              />
            </div>
            <Button theme="solid" type="primary" loading={testing} onClick={() => onTest()}>测试连通</Button>
          </div>

          <div style={{ borderTop: '1px dashed var(--semi-color-border)', paddingTop: 10, marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--semi-color-primary)' }}>
              网络与流媒体高级路由（双向同步）
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                  Hook IP (ZLM访问WVP的地址) *
                </label>
                <Input
                  value={form.hookIp}
                  onChange={(v) => setForm({ ...form, hookIp: v })}
                  placeholder="例如: 192.168.1.100 或 host.docker.internal"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                  SDP IP (国标收流IP)
                </label>
                <Input
                  value={form.sdpIp}
                  onChange={(v) => setForm({ ...form, sdpIp: v })}
                  placeholder="留空则自动使用节点 IP"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                  RTSP 端口
                </label>
                <Input
                  value={form.rtspPort}
                  onChange={(v) => setForm({ ...form, rtspPort: v })}
                  placeholder="默认 554 或 5540"
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600 }}>
                  RTMP 端口
                </label>
                <Input
                  value={form.rtmpPort}
                  onChange={(v) => setForm({ ...form, rtmpPort: v })}
                  placeholder="默认 1935 或 10935"
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={form.autoConfig}
                  onChange={(v) => setForm({ ...form, autoConfig: v })}
                />
                <span style={{ fontSize: 12 }}>自动配置 ZLM（下发 Hook 与录像路径）</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Switch
                  checked={form.rtpEnable}
                  onChange={(v) => setForm({ ...form, rtpEnable: v })}
                />
                <span style={{ fontSize: 12 }}>多端口 RTP 收流模式</span>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal title="服务器信息" visible={!!info} onCancel={() => setInfo(null)} footer={null}>
        {info && (
          <>
            <Card size="small" title="系统" style={{ marginBottom: 8 }}>
              <Descriptions row size="small" data={[
                { key: '系统', value: info.os?.name ?? '-' },
                { key: 'CPU', value: `${info.os?.cpu?.intel ?? info.os?.cpu?.amd ?? '-'}` },
                { key: '内存', value: `${info.os?.memory?.total ?? '-'} MB` },
              ]} />
            </Card>
            <Card size="small" title="版本">
              <Descriptions row size="small" data={[
                { key: 'WVP版本', value: info.version ?? '-' },
                { key: '特性', value: info.feature?.join?.(' , ') ?? '-' },
              ]} />
            </Card>
          </>
        )}
      </Modal>
    </>
  );
}

function PlatformsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  // 共享通道（分组级联）：设备树勾选 → 与已共享集合 diff → add/remove → 推送目录
  const [share, setShare] = useState<any>(null);
  const [shareTree, setShareTree] = useState<any[]>([]);
  const [shareOrig, setShareOrig] = useState<number[]>([]);
  const [shareSaving, setShareSaving] = useState(false);

  const load = async () => {
    const d = await httpGet<any>('/api/platform/query', { page: 1, count: 100 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  const leafKeys = shareTree.flatMap((d: any) => (d.children || []).map((c: any) => c.key));
  /** 勾选状态自己管理（Semi Tree 的受控勾选与本项目的 key 结构对不上，实测勾选态收不回来）。
   *  自研两级列表：设备行勾选 = 该设备全部通道；通道行单独勾选。selected 存通道 id。 */
  const [sel, setSel] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const groupIds = (g: any): number[] => (g.children || []).map((c: any) => Number(String(c.key).slice(2)));
  const groupAll = (g: any) => { const ids = groupIds(g); return ids.length > 0 && ids.every((i: number) => sel.includes(i)); };
  const toggleGroup = (g: any) => {
    const ids = groupIds(g);
    if (groupAll(g)) setSel(sel.filter((i) => !ids.includes(i)));
    else setSel([...new Set([...sel, ...ids])]);
  };
  const toggleOne = (id: number) => setSel(sel.includes(id) ? sel.filter((i) => i !== id) : [...sel, id]);
  const checkedLeafCount = () => sel.length;

  /** 打开共享面板：拉设备/通道/已共享三份数据，组成"设备→通道"两级树 */
  const openShare = async (p: any) => {
    setShare(p);
    setSel([]);
    setShareOrig([]);
    const [devs, chs, sh] = await Promise.all([
      httpGet<any>('/api/device/query/devices', { page: 1, count: 500 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any>('/api/common/channel/list', { page: 1, count: 1000 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      // hasShare=true 才只返回"已共享给该平台"的通道；不传会返回全部通道（会被误判成全已共享）
      httpGet<any>('/api/platform/channel/list', { platformId: p.id, hasShare: true, page: 1, count: 1000 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
    ]);
    const chList = chs || [];
    // 已共享集合：返回行带 gbId（= 库内通道 id）；若缺失再用通道国标编号反查兜底
    const byCode = new Map(chList.map((c: any) => [String(c.gbDeviceId), Number(c.gbId)]));
    const shared = (sh || [])
      .map((c: any) => Number(c.gbId) || byCode.get(String(c.gbDeviceId)))
      .filter((n: any) => !!n);
    setShareOrig(shared);
    setSel(shared);

    const byDev = (devId: any) => chList.filter((c: any) => String(c.dataDeviceId) === String(devId));
    const tree = (devs || []).map((d: any) => {
      const kids = byDev(d.id);
      return {
        key: `d:${d.id}`,
        label: `${d.name || d.deviceId}（${kids.length} 通道）`,
        children: kids.map((c: any) => ({ key: `c:${c.gbId}`, label: c.name || c.gbName })),
      };
    }).filter((d: any) => (d.children || []).length > 0);
    // 没挂到设备的通道（如 RTSP 拉流代理）单独一组，避免"消失"
    const devIds = new Set((devs || []).map((d: any) => String(d.id)));
    const orphans = chList.filter((c: any) => !devIds.has(String(c.dataDeviceId)));
    if (orphans.length > 0) {
      tree.push({
        key: 'd:orphan',
        label: `未关联设备（${orphans.length} 通道）`,
        children: orphans.map((c: any) => ({ key: `c:${c.gbId}`, label: c.name || c.gbName })),
      });
    }
    setShareTree(tree);
  };

  const saveShare = async () => {
    if (!share) return;
    setShareSaving(true);
    try {
      const now = new Set(sel);
      const add = [...now].filter((i) => !shareOrig.includes(i));
      const remove = shareOrig.filter((i) => !now.has(i));
      if (add.length) await post('/api/platform/channel/add', { platformId: share.id, channelIds: add });
      if (remove.length) await del('/api/platform/channel/remove', undefined, { platformId: share.id, channelIds: remove });
      // 共享关系已落库；推送目录只是"立刻通知上级"。上级未注册/未在线时推送会失败，
      // 属正常情况（上级上线后会按目录订阅自动同步），所以失败不当作保存失败。
      let pushed = true;
      try { await httpGet('/api/platform/channel/push', { id: share.id }); } catch { pushed = false; }
      const summary = `已共享 ${now.size} 条通道${add.length ? `，新增 ${add.length}` : ''}${remove.length ? `，移除 ${remove.length}` : ''}`;
      if (pushed) Toast.success(summary + '，目录已推送');
      else Toast.warning(summary + '；目录推送未成功（上级未在线时属正常，其上线后会自动同步）');
      setShare(null);
    } catch (e: any) {
      Toast.error('保存失败：' + (e?.message || ''));
    } finally { setShareSaving(false); }
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>添加级联平台</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" rowKey="id" dataSource={rows} pagination={false} empty="暂无级联平台"
        columns={[
          { title: '平台国标编号', dataIndex: 'serverGBId' },
          { title: '名称', dataIndex: 'name' },
          { title: 'IP', dataIndex: 'serverIp' },
          { title: '状态', dataIndex: 'online', render: (v: boolean, r: any) => <Tag color={(v ?? r.status) ? 'green' : 'grey'}>{(v ?? r.status) ? '在线' : '离线'}</Tag> },
          {
            title: '操作', width: 210,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" theme="solid" type="primary" onClick={() => openShare(r)}>共享通道</Button>
                <Popconfirm title="确认删除级联？其下已共享的通道会先解绑"
                  onConfirm={async () => {
                    // 后端删平台不会清理 wvp_platform_channel：先解绑已共享通道再删，避免留脏数据
                    const sh = await httpGet<any>('/api/platform/channel/list',
                      { platformId: r.id, hasShare: true, page: 1, count: 1000 })
                      .then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
                    const ids = (sh || []).map((c: any) => Number(c.gbId)).filter(Boolean);
                    if (ids.length) {
                      await del('/api/platform/channel/remove', undefined, { platformId: r.id, channelIds: ids }).catch(() => {});
                    }
                    await del('/api/platform/delete', { id: r.id });
                    Toast.success('已删除级联平台');
                    load();
                  }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />

      {/* 共享通道：按设备树勾选（同一台设备下的通道整组选/不选），保存后推送目录给上级 */}
      <Modal title={`共享通道给上级 · ${share?.name ?? ''}`} visible={!!share}
        onCancel={() => setShare(null)} footer={null} width={780}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          勾选要共享给该上级平台的通道（按设备分组，勾设备=整台设备全共享）。保存后会调用「推送目录」让上级立即看到变更，
          上级即可按需点播这些通道。已共享 <b style={{ color: 'var(--semi-color-primary)' }}>{shareOrig.length}</b> 条，
          当前勾选 <b style={{ color: 'var(--semi-color-primary)' }}>{checkedLeafCount()}</b> 条。
        </div>
        <Space style={{ marginBottom: 10 }}>
          <Button size="small" onClick={() => setSel(shareTree.flatMap((g: any) => groupIds(g)))}>全选</Button>
          <Button size="small" onClick={() => setSel([])}>清空</Button>
          <Button size="small" icon={<IconRefresh />} onClick={() => share && openShare(share)}>重置</Button>
        </Space>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, maxHeight: 380, overflow: 'auto', padding: 8 }}>
          {shareTree.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 12, padding: 12 }}>暂无通道可共享（先在「设备接入」接入摄像机）</div>
          ) : shareTree.map((g: any) => {
            const ids = groupIds(g);
            const all = groupAll(g);
            const some = !all && ids.some((i: number) => sel.includes(i));
            const folded = !!collapsed[g.key];
            return (
              <div key={g.key} style={{ marginBottom: 4 }}>
                {/* 设备分组行：勾选=整台设备共享；点击名称折叠/展开 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 6, background: 'var(--semi-color-fill-0)' }}>
                  <Checkbox
                    checked={all}
                    indeterminate={some}
                    onChange={() => toggleGroup(g)}
                  />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    onClick={() => setCollapsed({ ...collapsed, [g.key]: !folded })}>
                    {g.label}
                  </span>
                  <Button size="small" theme="borderless" onClick={() => setCollapsed({ ...collapsed, [g.key]: !folded })}>
                    {folded ? '展开' : '收起'}
                  </Button>
                </div>
                {!folded && (g.children || []).map((c: any) => {
                  const id = Number(String(c.key).slice(2));
                  const on = sel.includes(id);
                  return (
                    <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 4px 28px', cursor: 'pointer' }}>
                      <Checkbox checked={on} onChange={() => toggleOne(id)} />
                      <span style={{ fontSize: 13 }}>{c.label}</span>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="flex-between" style={{ marginTop: 14 }}>
          <span className="text-muted" style={{ fontSize: 11 }}>
            取消勾选会在保存时从上级平台移除该通道
          </span>
          <Space>
            <Button onClick={() => setShare(null)}>取消</Button>
            <Button theme="solid" type="primary" loading={shareSaving} onClick={saveShare}>保存并推送</Button>
          </Space>
        </div>
      </Modal>
      <Modal title="添加级联平台（本平台作为下级，向上级注册）" visible={open} onCancel={() => setOpen(false)} width={560}
        onOk={async () => {
          const gb = (v: any) => String(v ?? '').trim();
          if (!/^\d{20}$/.test(gb(form.serverGBId))) { Toast.warning('上级平台国标编号必须是 20 位数字'); return; }
          if (!gb(form.name)) { Toast.warning('请填写平台名称（便于自己识别）'); return; }
          if (!gb(form.serverIp)) { Toast.warning('请填写上级服务器 IP'); return; }
          if (!/^\d{20}$/.test(gb(form.deviceGBId))) { Toast.warning('本机（下级）国标编号必须是 20 位数字，且已在上级平台登记'); return; }
          if (!gb(form.serverPort)) form.serverPort = 5060;
          await post('/api/platform/add', form);
          Toast.success('已保存，正在向上级注册（状态变为「在线」即对接成功）');
          setOpen(false);
          load();
        }}>
        <div className="text-muted" style={{ fontSize: 12, lineHeight: '20px', marginBottom: 12 }}>
          用途：把本平台的摄像机共享给上级平台（如上级监控中心 / 视频专网），上级可按需点播本平台的通道。
          前 4 项由<b>上级平台方提供</b>，"本机国标编号"是<b>本平台在上级那边的身份</b>（需由上级先登记）。
        </div>
        <Space vertical style={{ width: '100%' }} spacing={10}>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>上级平台国标编号（20 位数字）</div>
            <Input placeholder="如 34020000002000000001" value={form.serverGBId} onChange={(v) => setForm({ ...form, serverGBId: v })} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>上级平台名称（自己起名，便于识别）</div>
            <Input placeholder="如 市局视频专网平台" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, width: '100%' }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>上级服务器 IP</div>
              <Input placeholder="如 10.0.0.21" value={form.serverIp} onChange={(v) => setForm({ ...form, serverIp: v })} />
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>SIP 端口</div>
              <Input placeholder="5060" value={form.serverPort} onChange={(v) => setForm({ ...form, serverPort: v })} />
            </div>
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>本机国标编号（本平台在上级的身份，20 位）</div>
            <Input placeholder="如 34020000001110000001" value={form.deviceGBId} onChange={(v) => setForm({ ...form, deviceGBId: v })} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>注册密码（上级平台提供）</div>
            <Input placeholder="上级分配的对接密码" mode="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
          </div>
        </Space>
      </Modal>
    </>
  );
}
