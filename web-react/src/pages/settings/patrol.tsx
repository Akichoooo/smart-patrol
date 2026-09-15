import { useEffect, useState } from 'react';
import { Tabs, TabPane, Table, Button, Modal, Input, Space, Tag, Toast, Popconfirm, Switch, TextArea, Card } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { get as httpGet, post } from '@/api/http';

/** 设置 → 巡视配置：检修区域 | 字典 | 告警规则与免打扰 | 通知设置（合并旧平台检修区域+字典+告警规则+通知） */
export default function PatrolConfPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="检修区域" itemKey="maintenance"><MaintenanceTab /></TabPane>
          <TabPane tab="字典" itemKey="dict"><DictTab /></TabPane>
          <TabPane tab="告警规则与免打扰" itemKey="rules"><RulesTab /></TabPane>
          <TabPane tab="通知设置" itemKey="notify"><NotifyTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function MaintenanceTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/maintenance/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>新增检修区域</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={false} empty="暂无检修区域（检修期内对应区域告警自动抑制）"
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '名称', dataIndex: 'name' },
          { title: '区域', dataIndex: 'areaJson', ellipsis: true },
          { title: '开始', dataIndex: 'startAt', width: 160 },
          { title: '结束', dataIndex: 'endAt', width: 160 },
          { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'ACTIVE' ? 'green' : 'grey'}>{{ ACTIVE: '生效中', EXPIRED: '已过期', DISABLED: '已停用' }[v] ?? v}</Tag> },
          {
            title: '操作', width: 130,
            render: (_: any, r: any) => (
              <Space>
                <Switch checked={r.status !== 'DISABLED'} size="small" onChange={(nv: any) => post(`/api/patrol/maintenance/${r.id}/enable`, { enabled: nv }).then(load)} />
                <Popconfirm title="确认删除？" onConfirm={async () => { await post(`/api/patrol/maintenance/${r.id}/delete`, {}); load(); }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title="新增检修区域" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => { await post('/api/patrol/maintenance/save', form); Toast.success('已保存'); setOpen(false); load(); }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="区域名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Input placeholder={'区域范围 JSON（如 ["主厂房B2","5#货梯"]）'} value={form.areaJson} onChange={(v) => setForm({ ...form, areaJson: v })} />
          <Input placeholder="开始时间（2026-09-11 08:00:00）" value={form.startAt} onChange={(v) => setForm({ ...form, startAt: v })} />
          <Input placeholder="结束时间" value={form.endAt} onChange={(v) => setForm({ ...form, endAt: v })} />
        </Space>
      </Modal>
    </>
  );
}

function DictTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/dict/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setOpen(true)}>新增字典</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={false}
        columns={[
          { title: '类型', dataIndex: 'type', render: (v: string) => <Tag>{{ identify_type: '识别类型', alarm_level: '告警等级', point_type: '点位类型', task_type: '任务类型' }[v] ?? v}</Tag> },
          { title: '编码', dataIndex: 'code' },
          { title: '名称', dataIndex: 'label' },
          { title: '排序', dataIndex: 'sort', width: 70 },
          { title: '启用', dataIndex: 'enabled', width: 80, render: (v: number) => <Tag color={v ? 'green' : 'grey'}>{v ? '启用' : '停用'}</Tag> },
          {
            title: '操作', width: 90,
            render: (_: any, r: any) => (
              <Popconfirm title="确认删除？" onConfirm={async () => { await post(`/api/patrol/dict/${r.id}/delete`, {}); load(); }}>
                <Button size="small" type="danger" theme="light">删除</Button>
              </Popconfirm>
            ),
          },
        ]} />
      <Modal title="新增字典" visible={open} onCancel={() => setOpen(false)}
        onOk={async () => { await post('/api/patrol/dict/save', form); Toast.success('已保存'); setOpen(false); load(); }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="类型（identify_type/alarm_level/point_type/task_type）" value={form.type} onChange={(v) => setForm({ ...form, type: v })} />
          <Input placeholder="编码" value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
          <Input placeholder="名称" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
        </Space>
      </Modal>
    </>
  );
}

function RulesTab() {
  const [rules, setRules] = useState<any>(null);

  const load = async () => {
    const d = await httpGet<any>('/api/patrol/alarm/rules').catch(() => ({}));
    setRules(d || {});
  };
  useEffect(() => { load(); }, []);

  return (
    <Card size="small" title="告警规则">
      <Space vertical align="start" style={{ width: '100%' }}>
        <TextArea
          placeholder={'告警规则 JSON：\n{\n  "minIntervalSeconds": 300,\n  "silenceDurationHours": 4,\n  "autoRecoverMinutes": 30\n}'}
          value={rules?.configJson ?? ''}
          onChange={(v) => setRules({ ...rules, configJson: v })}
          rows={8}
          style={{ width: '100%' }}
        />
        <Space>
          <Button theme="solid" onClick={async () => {
            await post('/api/patrol/alarm/rules/save', rules || {});
            Toast.success('告警规则已保存');
          }}>保存规则</Button>
        </Space>
      </Space>
    </Card>
  );
}

function NotifyTab() {
  const [rows, setRows] = useState<any[]>([]);
  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/notification/list', { page: 1, count: 50 }).then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Button onClick={async () => { await post('/api/patrol/notification/read', { all: true }); Toast.success('已全部标记已读'); load(); }}>全部已读</Button>
      </Space>
      <Table size="small" dataSource={rows} pagination={false} empty="暂无通知记录"
        columns={[
          { title: 'ID', dataIndex: 'id', width: 70 },
          { title: '标题', dataIndex: 'title' },
          { title: '内容', dataIndex: 'content', ellipsis: true },
          { title: '类型', dataIndex: 'type', render: (v: string) => <Tag color={v === 'ALARM' ? 'red' : 'blue'}>{{ ALARM: '告警', TASK: '任务', SYSTEM: '系统' }[v] ?? v}</Tag> },
          { title: '已读', dataIndex: 'isRead', render: (v: number) => <Tag color={v ? 'grey' : 'red'}>{v ? '已读' : '未读'}</Tag> },
          { title: '时间', dataIndex: 'createTime', width: 165 },
        ]} />
    </>
  );
}
