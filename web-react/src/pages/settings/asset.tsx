import { useEffect, useState } from 'react';
import {
  Tabs, TabPane, Table, Button, Modal, Input, Select, Space, Tag, Toast, Popconfirm,
  Card, Switch, Form, Typography, TextArea,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconLink } from '@douyinfe/semi-icons';
import { get as httpGet, post, del } from '@/api/http';

/** 设置 → 机器人与装备：装备台账 | 协议管理 | 点位与航线（patrol 后端） */
export default function AssetPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="装备台账" itemKey="devices"><DevicesTab /></TabPane>
          <TabPane tab="装备档案" itemKey="profiles"><ProfilesTab /></TabPane>
          <TabPane tab="协议管理" itemKey="protocol"><ProtocolTab /></TabPane>
          <TabPane tab="点位与航线" itemKey="waypoints"><WaypointsTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function DevicesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ type: 'ROBOT_DOG' });

  const load = async () => {
    const [d, p] = await Promise.all([
      httpGet<any[]>('/api/patrol/robot/list').catch(() => []),
      httpGet<any[]>('/api/patrol/profile/list').catch(() => []),
    ]);
    setRows(d || []);
    setProfiles(p || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>注册装备</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={false} empty="暂无装备（型号未定可先选占位档案注册）"
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'type', render: (v: string) => {
            const map: Record<string, { label: string; color: string }> = {
              ROBOT_DOG: { label: '机器狗', color: 'blue' },
              DRONE: { label: '无人机', color: 'cyan' },
              CAMERA: { label: '监控摄像机/PVR', color: 'purple' },
              ROBOT: { label: '巡检机器人', color: 'indigo' },
            };
            const item = map[v] || { label: v || '-', color: 'grey' };
            return <Tag color={item.color as any}>{item.label}</Tag>;
          } },
          { title: '厂商/型号', render: (_: any, r: any) => `${r.vendor ?? '-'} / ${r.model ?? '-'}` },
          { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'ONLINE' ? 'green' : 'grey'}>{v === 'ONLINE' ? '在线' : '离线'}</Tag> },
          { title: '能力', dataIndex: 'capabilitiesJson', ellipsis: true, render: (v: string) => {
            try { return (JSON.parse(v || '[]') as string[]).join(','); } catch { return '-'; }
          } },
          { title: '最近心跳', dataIndex: 'lastHeartbeat', width: 165 },
          {
            title: '操作', width: 180,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" icon={<IconLink />} onClick={async () => {
                  const res = await post<any>(`/api/patrol/robot/${r.id}/test`, {}).catch((e) => null);
                  if (res?.ok) Toast.success(`连通正常 (${res.costMs}ms)`);
                  else Toast.error('连通失败');
                }}>测试</Button>
                <Popconfirm title="确认删除装备？（历史数据保留）" onConfirm={async () => {
                  await post(`/api/patrol/robot/${r.id}/delete`, {});
                  Toast.success('装备已删除（历史巡检数据保留）');
                  load();
                }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title="注册装备" visible={open} onCancel={() => setOpen(false)} width={520}
        onOk={async () => {
          await post('/api/patrol/robot/save', form);
          Toast.success('装备已注册');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} style={{ width: '100%' }}
            optionList={[
              { value: 'ROBOT_DOG', label: '机器狗' },
              { value: 'DRONE', label: '无人机' },
              { value: 'CAMERA', label: '监控摄像机/PVR' },
              { value: 'ROBOT', label: '巡检机器人' },
            ]} />
          <Select placeholder="选择装备档案（型号未定可选占位档案）" value={form.profileId} onChange={(v) => {
            const p = profiles.find((x) => x.id === v);
            setForm({ ...form, profileId: v, vendor: p?.vendor, model: p?.model, templateId: p?.defaultTemplateId, capabilitiesJson: p?.capabilitiesJson });
          }} style={{ width: '100%' }} showClear
            optionList={profiles.map((p: any) => ({ value: p.id, label: `${p.vendor}/${p.model} (${p.assetType === 'DRONE' ? '无人机' : '机器狗'}${p.remark ? ' · ' + p.remark : ''})` }))} />
          <Input placeholder="装备名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input placeholder="连接信息 JSON（密钥用 secret:// 引用，不落明文）" value={form.connectionJson} onChange={(v) => setForm({ ...form, connectionJson: v })} />
        </Space>
      </Modal>
    </>
  );
}

function ProfilesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/profile/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>新增装备档案</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Typography.Text type="tertiary" size="small">新增型号 = 注册档案，无需写代码；删除型号 = 停用档案，历史数据保留</Typography.Text>
      </Space>
      <Table size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '厂商', dataIndex: 'vendor' },
          { title: '型号', dataIndex: 'model' },
          { title: '装备类型', dataIndex: 'assetType', render: (v: string) => <Tag>{v === 'DRONE' ? '无人机' : v === 'ROBOT_DOG' ? '机器狗' : v}</Tag> },
          { title: '能力', dataIndex: 'capabilitiesJson', ellipsis: true },
          { title: '备注', dataIndex: 'remark', ellipsis: true },
          {
            title: '启用', dataIndex: 'enabled', width: 90,
            render: (v: boolean, r: any) => <Switch checked={v} size="small" onChange={(nv: any) => { post(`/api/patrol/profile/${r.id}/enable`, { enabled: nv }).then(load); }} />,
          },
        ]} />
      <Modal title="新增装备档案" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => {
          await post('/api/patrol/profile/save', form);
          Toast.success('档案已保存');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="厂商（如 unitree / 客户定制）" value={form.vendor} onChange={(v) => setForm({ ...form, vendor: v })} />
          <Input placeholder="型号" value={form.model} onChange={(v) => setForm({ ...form, model: v })} />
          <Select placeholder="装备类型" value={form.assetType} onChange={(v) => setForm({ ...form, assetType: v })} style={{ width: '100%' }}
            optionList={[
              { value: 'ROBOT_DOG', label: '机器狗' }, { value: 'DRONE', label: '无人机' },
              { value: 'CAMERA', label: '摄像机' }, { value: 'SENSOR', label: '传感器' }, { value: 'GATE', label: '机库/机巢' },
            ]} />
          <Input placeholder={'能力集 JSON，如 ["gotoWaypoint","capturePhoto"]'} value={form.capabilitiesJson} onChange={(v) => setForm({ ...form, capabilitiesJson: v })} />
        </Space>
      </Modal>
    </>
  );
}

function ProtocolTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [detail, setDetail] = useState<any>(null);

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/protocol/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>新增协议模板</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Typography.Text type="tertiary" size="small">内置 4 厂商预设 + 3 通用模板；长尾厂商仅配置即可接入</Typography.Text>
      </Space>
      <Table size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '名称', dataIndex: 'name' },
          { title: '协议类型', dataIndex: 'protocolType', render: (v: string) => <Tag>{v}</Tag> },
          { title: '厂商', dataIndex: 'vendor' },
          { title: '能力', dataIndex: 'capabilitiesJson', ellipsis: true },
          { title: '内置', dataIndex: 'builtin', render: (v: number) => v ? <Tag color="blue">内置</Tag> : <Tag>自定义</Tag> },
          {
            title: '启用', dataIndex: 'enabled', width: 90,
            render: (v: number, r: any) => <Switch checked={!!v} size="small" onChange={(nv: any) => { post(`/api/patrol/protocol/${r.id}/enable`, { enabled: nv }).then(load); }} />,
          },
          {
            title: '操作', width: 130,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" onClick={() => setDetail(r)}>查看配置</Button>
                {!r.builtin && (
                  <Popconfirm title="确认删除模板？" onConfirm={async () => { await post(`/api/patrol/protocol/${r.id}/delete`, {}); load(); }}>
                    <Button size="small" type="danger" theme="light">删除</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]} />
      <Modal title="新增协议模板" visible={open} onCancel={() => setOpen(false)} width={620}
        onOk={async () => {
          await post('/api/patrol/protocol/save', form);
          Toast.success('模板已保存');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="模板名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Select placeholder="协议类型" value={form.protocolType} onChange={(v) => setForm({ ...form, protocolType: v })} style={{ width: '100%' }}
            optionList={[
              { value: 'HTTP_REST', label: 'HTTP REST（通用）' },
              { value: 'MQTT', label: 'MQTT' },
              { value: 'TCP', label: 'TCP' },
              { value: 'GRPC', label: 'gRPC' },
              { value: 'DDS', label: 'DDS' },
            ]} />
          <Input placeholder="能力集 JSON" value={form.capabilitiesJson} onChange={(v) => setForm({ ...form, capabilitiesJson: v })} />
          <TextArea placeholder="端点配置 JSON（baseUrl/auth/endpoints，参照云深处预设格式）" rows={5} value={form.configJson} onChange={(v) => setForm({ ...form, configJson: v })} />
        </Space>
      </Modal>
      <Modal title={`模板配置 · ${detail?.name ?? ''}`} visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={640}>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'rgba(140,150,165,0.08)', padding: 10, borderRadius: 6, maxHeight: 400, overflow: 'auto' }}>
          {(() => {
            try { return JSON.stringify(JSON.parse(detail?.configJson || '{}'), null, 2); } catch { return detail?.configJson || '{}'; }
          })()}
        </pre>
      </Modal>
    </>
  );
}

function WaypointsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ captureMode: 'PHOTO', captureSource: 'ONBOARD_CAMERA' });

  const load = async () => {
    const [w, r] = await Promise.all([
      httpGet<any[]>('/api/patrol/waypoint/list').catch(() => []),
      httpGet<any[]>('/api/patrol/route/list').catch(() => []),
    ]);
    setRows(w || []);
    setRoutes(r || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>新增点位</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={{ pageSize: 20 }} empty="暂无点位"
        columns={[
          { title: '编号', dataIndex: 'id', width: 60 },
          { title: '区域', dataIndex: 'area' },
          { title: '设备', dataIndex: 'deviceName' },
          { title: '部件', dataIndex: 'partName', render: (v: string) => v || '-' },
          { title: '点位名称', dataIndex: 'name' },
          { title: '采集方式', dataIndex: 'captureMode', render: (v: string) => <Tag>{v === 'PHOTO' ? '拍照' : v}</Tag> },
          { title: '采集源', dataIndex: 'captureSource', render: (v: string) => v === 'FIXED_CHANNEL' ? <Tag color="blue">固定摄像机</Tag> : <Tag>机器人自带</Tag> },
          { title: '绑定通道', dataIndex: 'captureChannelId', render: (v: number) => v ? `通道${v}` : '-' },
          {
            title: '操作', width: 90,
            render: (_: any, r: any) => (
              <Popconfirm title="确认删除点位？" onConfirm={async () => { await post(`/api/patrol/waypoint/${r.id}/delete`, {}); load(); }}>
                <Button size="small" type="danger" theme="light">删除</Button>
              </Popconfirm>
            ),
          },
        ]} />
      <Card size="small" title="航线（点位序列预设）" style={{ marginTop: 12 }}>
        <Table size="small" dataSource={routes} pagination={false} empty="暂无航线"
          columns={[
            { title: '航线', dataIndex: 'name' },
            { title: '装备', dataIndex: 'robotDeviceId' },
            { title: '点位数', dataIndex: 'waypointIdsJson', render: (v: string) => { try { return JSON.parse(v || '[]').length; } catch { return 0; } } },
            { title: '说明', dataIndex: 'description' },
          ]} />
      </Card>
      <Modal title="新增点位" visible={open} onCancel={() => setOpen(false)} width={560}
        onOk={async () => {
          await post('/api/patrol/waypoint/save', form);
          Toast.success('点位已保存');
          setOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="区域（如 主厂房B2）" value={form.area} onChange={(v) => setForm({ ...form, area: v })} />
          <Input placeholder="设备间隔" value={form.intervalName} onChange={(v) => setForm({ ...form, intervalName: v })} />
          <Input placeholder="设备名称" value={form.deviceName} onChange={(v) => setForm({ ...form, deviceName: v })} />
          <Input placeholder="部件（指示灯/表计/空开…）" value={form.partName} onChange={(v) => setForm({ ...form, partName: v })} />
          <Input placeholder="点位名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Select value={form.captureSource} onChange={(v) => setForm({ ...form, captureSource: v })} style={{ width: '100%' }}
            optionList={[
              { value: 'ONBOARD_CAMERA', label: '机器人自带相机' },
              { value: 'FIXED_CHANNEL', label: '固定摄像机通道' },
              { value: 'PAYLOAD', label: '载荷' },
            ]} />
          {form.captureSource === 'FIXED_CHANNEL' && (
            <Input placeholder="固定摄像机通道ID" value={form.captureChannelId} onChange={(v) => setForm({ ...form, captureChannelId: v })} />
          )}
          <Input placeholder="边缘侧编码（下发用，可空）" value={form.edgeCode} onChange={(v) => setForm({ ...form, edgeCode: v })} />
        </Space>
      </Modal>
    </>
  );
}
