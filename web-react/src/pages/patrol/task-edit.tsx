import { useEffect, useMemo, useState } from 'react';
import {
  Card, Button, Toast, Input, Select, Space, Tree, Typography, Table, Tag,
  Modal, InputNumber, RadioGroup, Radio, Spin,
} from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { get as httpGet, post } from '@/api/http';
import md5 from '@/utils/md5';

const TYPE_MAP: Record<string, string> = { ROUTINE: '例行巡视', SILENT: '静默任务', LINKAGE: '联动任务' };

/**
 * 新建/编辑任务（对齐旧平台：基本信息 + 任务时间 + 巡视内容点位树/表格 + 一键套用识别方案）。
 * 核心交互：
 * 1. 左侧点位树勾选 → 右侧点位表格（可逐点覆盖方案）
 * 2. 「批量套用识别方案」一键把默认方案写入所有点位
 * 3. 点位级 schemeId 优先于任务级 defaultSchemeId
 */
export default function TaskEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState<any>({
    name: '', type: 'ROUTINE', priority: '1', robotDeviceId: undefined,
    defaultSchemeId: undefined, timePlans: [], remark: '',
  });
  const [waypoints, setWaypoints] = useState<any[]>([]);
  const [schemes, setSchemes] = useState<any[]>([]);
  const [robots, setRobots] = useState<any[]>([]);
  const [selected, setSelected] = useState<Record<number, any>>({}); // waypointId -> {captureMode, schemeId}
  const [treeData, setTreeData] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [timeDialog, setTimeDialog] = useState(false);
  const [newPlan, setNewPlan] = useState<any>({ type: 'daily', time: '08:00' });

  const load = async () => {
    try {
      const [wps, sch, rbs] = await Promise.all([
        httpGet<any[]>('/api/patrol/waypoint/list').catch(() => []),
        httpGet<any[]>('/api/patrol/scheme/list').catch(() => []),
        httpGet<any[]>('/api/patrol/robot/list').catch(() => []),
      ]);
      setWaypoints(wps || []);
      setSchemes(sch || []);
      setRobots(rbs || []);
      // 点位树：按区域分组
      const areaMap = new Map<string, any[]>();
      (wps || []).forEach((w: any) => {
        const area = w.area || '未分组';
        if (!areaMap.has(area)) areaMap.set(area, []);
        areaMap.get(area)!.push(w);
      });
      setTreeData(
        [...areaMap.entries()].map(([area, list]) => ({
          key: `area-${area}`,
          label: area,
          children: list.map((w) => ({ key: `wp-${w.id}`, label: `${w.name}（${w.partName || '通用'}）`, waypoint: w })),
        }))
      );
      if (isEdit) {
        const t = await httpGet<any>(`/api/patrol/task/${id}`);
        setForm(t);
        const pts = await httpGet<any[]>(`/api/patrol/task/${id}/points`).catch(() => []);
        const sel: Record<number, any> = {};
        (pts || []).forEach((p: any) => {
          sel[p.waypointId] = { captureMode: p.captureMode || 'PHOTO', schemeId: p.schemeId ?? null };
        });
        setSelected(sel);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const selectedIds = Object.keys(selected).map(Number);
  const selectedRows = useMemo(
    () => waypoints.filter((w) => selected[w.id]),
    [waypoints, selected]
  );

  const applySchemeToAll = () => {
    if (!form.defaultSchemeId) {
      Toast.warning('请先选择任务级识别方案');
      return;
    }
    if (selectedIds.length === 0) {
      Toast.warning('请先在左侧选择点位');
      return;
    }
    set_selected_clear();
    Toast.success(`已将识别方案批量套用到 ${selectedIds.length} 个点位（个别点位可单独修改）`);
  };

  const set_selected_clear = () => {
    const next: Record<number, any> = {};
    selectedIds.forEach((wid) => {
      next[wid] = { ...(selected[wid] ?? { captureMode: 'PHOTO' }), schemeId: null }; // null=跟随任务级
    });
    setSelected(next);
  };

  const save = async () => {
    if (!form.name?.trim()) {
      Toast.warning('请输入任务名称（0/50）');
      return;
    }
    if (selectedIds.length === 0) {
      Toast.warning('请在左侧选择电力点位增加巡视内容');
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        points: selectedIds.map((wid) => ({
          waypointId: wid,
          captureMode: selected[wid]?.captureMode || 'PHOTO',
          schemeId: selected[wid]?.schemeId ?? null,
        })),
      };
      if (isEdit) await post(`/api/patrol/task/${id}/update`, body);
      else await post('/api/patrol/task/save', body);
      Toast.success('任务保存成功');
      navigate('/patrol/task');
    } catch { /* 请求层已提示 */ } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;

  return (
    <div className="page-root">
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
        {/* 基本信息 */}
        <Card size="small" title="基本信息">
          <Space style={{ flexWrap: 'wrap' }}>
            <span>任务名称</span>
            <Input maxLength={50} value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="0/50" style={{ width: 220 }} />
            <span>任务类型</span>
            <Select value={form.type} onChange={(v) => setForm({ ...form, type: v })} style={{ width: 130 }} optionList={Object.entries(TYPE_MAP).map(([v, l]) => ({ value: v, label: l }))} />
            <span>任务优先级</span>
            <RadioGroup type="button" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <Radio value="1">1级</Radio><Radio value="2">2级</Radio><Radio value="3">3级</Radio>
            </RadioGroup>
            <span>执行装备</span>
            <Select value={form.robotDeviceId} onChange={(v) => setForm({ ...form, robotDeviceId: v })} style={{ width: 180 }} showClear
              optionList={(robots || []).map((r: any) => ({ value: r.id, label: `${r.name} (${r.type === 'DRONE' ? '无人机' : '机器狗'})` }))} />
            <span>编制人</span>
            <Input value={form.creator} onChange={(v) => setForm({ ...form, creator: v })} style={{ width: 120 }} />
          </Space>
        </Card>

        {/* 任务时间 */}
        <Card
          size="small"
          title="任务时间"
          headerExtraContent={<Button size="small" icon={<IconPlus />} onClick={() => setTimeDialog(true)}>增加时间方案</Button>}
        >
          {(form.timePlans || []).length === 0 ? (
            <span className="text-muted" style={{ fontSize: 12 }}>未配置定时方案（可立即手动执行）</span>
          ) : (
            form.timePlans.map((p: any, i: number) => (
              <div key={i} className="flex-between" style={{ padding: '4px 0' }}>
                <Tag size="small">{p.type === 'daily' ? '每日' : p.type === 'weekly' ? '每周' : '单次'} {p.time}</Tag>
                <Button size="small" theme="borderless" type="danger" icon={<IconDelete />}
                  onClick={() => setForm({ ...form, timePlans: form.timePlans.filter((_: any, j: number) => j !== i) })} />
              </div>
            ))
          )}
        </Card>

        {/* 巡视内容（点位） */}
        <Card size="small" title="巡视内容">
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ width: 260, borderRight: '1px solid var(--semi-color-border)', maxHeight: 400, overflow: 'auto' }}>
              <Typography.Text type="tertiary" size="small">点位树（区域/设备/部件）</Typography.Text>
              <Tree
                treeData={treeData}
                multiple
                checkable
                checkedKeys={selectedIds.map((x) => `wp-${x}`)}
                onCheck={(keys: any, opt: any) => {
                  const next: Record<number, any> = {};
                  const walk = (nodes: any[]) => nodes.forEach((n) => {
                    if (n.waypoint && (keys || []).includes(`wp-${n.waypoint.id}`)) {
                      next[n.waypoint.id] = selected[n.waypoint.id] ?? { captureMode: 'PHOTO', schemeId: null };
                    }
                    if (n.children) walk(n.children);
                  });
                  walk(treeData);
                  setSelected(next);
                }}
              />
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <Space style={{ marginBottom: 8 }}>
                <span className="text-muted" style={{ fontSize: 12 }}>任务级识别方案</span>
                <Select value={form.defaultSchemeId} onChange={(v) => setForm({ ...form, defaultSchemeId: v })} style={{ width: 220 }} showClear
                  optionList={(schemes || []).map((s: any) => ({ value: s.id, label: s.name }))} placeholder="选择识别方案" />
                <Button size="small" theme="solid" onClick={applySchemeToAll}>批量套用到全部点位</Button>
              </Space>
              {selectedRows.length === 0 ? (
                <Typography.Text type="tertiary" style={{ display: 'block', padding: 32, textAlign: 'center' }}>
                  请在左侧选择电力点位增加
                </Typography.Text>
              ) : (
                <Table size="small" pagination={false} dataSource={selectedRows} columns={[
                  { title: '编号', dataIndex: 'id', width: 60 },
                  { title: '区域', dataIndex: 'area', width: 120 },
                  { title: '设备', dataIndex: 'deviceName', width: 120 },
                  { title: '部件', dataIndex: 'partName', width: 100 },
                  { title: '点位名称', dataIndex: 'name' },
                  {
                    title: '采集方式',
                    width: 110,
                    render: (_: any, r: any) => (
                      <Select size="small" value={selected[r.id]?.captureMode || 'PHOTO'} onChange={(v) => setSelected({ ...selected, [r.id]: { ...(selected[r.id] ?? {}), captureMode: v } })}
                        optionList={[{ value: 'PHOTO', label: '拍照' }, { value: 'VIDEO', label: '录像' }]} />
                    ),
                  },
                  {
                    title: '识别方案',
                    width: 200,
                    render: (_: any, r: any) => (
                      <Select size="small" value={selected[r.id]?.schemeId ?? ''} onChange={(v) => setSelected({ ...selected, [r.id]: { ...(selected[r.id] ?? {}), schemeId: v || null } })}
                        showClear placeholder="跟随任务级" optionList={[{ value: '', label: '跟随任务级' }, ...schemes.map((s: any) => ({ value: s.id, label: s.name }))]} />
                    ),
                  },
                  {
                    title: '操作',
                    width: 70,
                    render: (_: any, r: any) => (
                      <Button size="small" type="danger" theme="borderless" icon={<IconDelete />} onClick={() => {
                        const next = { ...selected }; delete next[r.id]; setSelected(next);
                      }} />
                    ),
                  },
                ]} />
              )}
            </div>
          </div>
        </Card>

        <Space>
          <Button theme="solid" type="primary" loading={saving} onClick={save}>保存任务</Button>
          <Button onClick={() => navigate('/patrol/task')}>取消</Button>
        </Space>
      </div>

      {/* 时间方案弹窗 */}
      <Modal title="增加时间方案" visible={timeDialog} onCancel={() => setTimeDialog(false)}
        onOk={() => {
          setForm({ ...form, timePlans: [...(form.timePlans || []), newPlan] });
          setTimeDialog(false);
          setNewPlan({ type: 'daily', time: '08:00' });
        }}>
        <Space vertical>
          <Select value={newPlan.type} onChange={(v) => setNewPlan({ ...newPlan, type: v })} style={{ width: 200 }}
            optionList={[{ value: 'daily', label: '每日' }, { value: 'weekly', label: '每周(周一)' }, { value: 'once', label: '单次' }]} />
          <Input value={newPlan.time} onChange={(v) => setNewPlan({ ...newPlan, time: v })} placeholder="如 08:00" style={{ width: 200 }} />
        </Space>
      </Modal>
    </div>
  );
}
