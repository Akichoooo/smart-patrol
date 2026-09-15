import { useEffect, useState } from 'react';
import { Button, Table, Tag, Modal, Toast, Input, Select, Space, Switch, Popconfirm, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconDelete, IconPlay } from '@douyinfe/semi-icons';
import { useNavigate } from 'react-router-dom';
import { get as httpGet, postForm, del } from '@/api/http';
import { useAuthStore } from '@/store/auth';

const TYPE_MAP: Record<string, string> = { ROUTINE: '例行巡视', SILENT: '静默任务', LINKAGE: '联动任务' };
const RISK = { high: '严重(红级)', medium: '重要(黄级)', low: '提示(蓝级)' };

/**
 * 巡检任务列表（对齐旧平台列：编号/任务名称/巡视类型/编制人/优先级/创建时间/状态/操作）。
 * 操作：立即执行 / 启停 / 详情编辑 / 删除
 */
export default function TaskPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState('');
  const [type, setType] = useState<string | undefined>();
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const load = async () => {
    setLoading(true);
    try {
      const list = await httpGet<any[]>('/api/patrol/task/list', { keyword: kw || undefined, type: type }).catch(() => []);
      setTasks(list || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const execute = async (row: any) => {
    try {
      const r = await postForm<any>(`/api/patrol/task/${row.id}/execute`);
      Toast.success(`任务已下发执行（执行单 ${r?.executionId ?? '-'}），进度可在「任务执行」查看`);
      navigate('/patrol/execution');
    } catch { /* 请求层已提示 */ }
  };

  const toggle = async (row: any, enabled: boolean) => {
    await postForm(`/api/patrol/task/${row.id}/${enabled ? 'enable' : 'disable'}`).catch(() => {});
    load();
  };

  const remove = async (row: any) => {
    await postForm(`/api/patrol/task/${row.id}/delete`).catch(() => {});
    Toast.success('任务已删除');
    load();
  };

  return (
    <div className="page-root">
      <div className="page-body">
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Input placeholder="任务名称" value={kw} onChange={setKw} style={{ width: 180 }} />
          <Select placeholder="任务类型" value={type} onChange={setType} style={{ width: 140 }} optionList={
            Object.entries(TYPE_MAP).map(([v, l]) => ({ value: v, label: l }))
          } showClear />
          <Button theme="solid" onClick={load}>查询</Button>
          <Button onClick={() => { setKw(''); setType(undefined); }}>重置</Button>
          <div style={{ flex: 1 }} />
          {hasPerm('patrol.task', 'create') && (
            <Button icon={<IconPlus />} theme="solid" type="primary" onClick={() => navigate('/patrol/task/create')}>
              新建任务
            </Button>
          )}
          <Button icon={<IconRefresh />} onClick={load} />
        </Space>

        <Table
          size="small"
          loading={loading}
          dataSource={tasks}
          pagination={{ pageSize: 15 }}
          empty="暂无任务，点击右上角新建"
          columns={[
            { title: '编号', dataIndex: 'id', width: 70 },
            {
              title: '任务名称',
              dataIndex: 'name',
              render: (v: string, r: any) => (
                <div>
                  <b>{v}</b>
                  <div className="text-muted" style={{ fontSize: 11 }}>{r.remark || ''}</div>
                </div>
              ),
            },
            { title: '巡视类型', dataIndex: 'type', render: (v: string) => <Tag>{TYPE_MAP[v] ?? v}</Tag> },
            { title: '编制人', dataIndex: 'creator', width: 100 },
            { title: '优先级', dataIndex: 'priority', width: 80, render: (v: string) => <Tag color={v === '1' ? 'red' : v === '2' ? 'orange' : 'blue'}>{v}级</Tag> },
            { title: '默认识别方案', dataIndex: 'schemeName', render: (v: string) => v || '未设置' },
            { title: '创建时间', dataIndex: 'createTime', width: 170 },
            {
              title: '状态',
              dataIndex: 'enabled',
              width: 90,
              render: (v: boolean, r: any) => (
                <Switch checked={v} size="small" onChange={(nv: any) => toggle(r, nv)} disabled={!hasPerm('patrol.task', 'edit')} />
              ),
            },
            {
              title: '操作',
              width: 230,
              render: (_: any, r: any) => (
                <Space>
                  {hasPerm('patrol.task', 'execute') && (
                    <Popconfirm title="确认立即执行该任务？" onConfirm={() => execute(r)}>
                      <Button size="small" type="primary" theme="solid" icon={<IconPlay />}>立即执行</Button>
                    </Popconfirm>
                  )}
                  {hasPerm('patrol.task', 'edit') && (
                    <Button size="small" onClick={() => navigate(`/patrol/task/edit/${r.id}`)}>详情</Button>
                  )}
                  {hasPerm('patrol.task', 'delete') && (
                    <Popconfirm title="确认删除该任务？" onConfirm={() => remove(r)}>
                      <Button size="small" type="danger" theme="light" icon={<IconDelete />}>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
