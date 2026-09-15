import { useEffect, useState } from 'react';
import {
  Tabs, TabPane, Table, Button, Modal, Input, InputNumber, Select, Space, Tag, Toast, Popconfirm,
  Card, Switch, Typography, TextArea, RadioGroup, Radio, CheckboxGroup, Empty, Upload, Banner,
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconLink, IconDelete, IconBolt as IconFlash, IconEdit, IconUpload } from '@douyinfe/semi-icons';
import { get as httpGet, post, del } from '@/api/http';
import { getToken } from '@/api/token';
import { useAuthStore } from '@/store/auth';
import { Hint } from '@/components/ui';

/**
 * 设置 → 智能算法：算法 | 模型 | 提示词 | 知识库 | 推理服务 | 识别方案
 * 模型管理的连通性测试由后端转发（前端不接触 API Key）
 */
export default function AiPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="推理服务" itemKey="service"><YoloServiceTab /></TabPane>
          <TabPane tab="算法" itemKey="algo"><AlgoTab /></TabPane>
          <TabPane tab="模型" itemKey="model"><ModelTab /></TabPane>
          <TabPane tab="提示词" itemKey="prompt"><PromptTab /></TabPane>
          <TabPane tab="知识库" itemKey="kb"><KnowledgeTab /></TabPane>
          <TabPane tab="识别方案" itemKey="scheme"><SchemeTab /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}

/** 推理服务（YOLO 跑在哪）：与模型/提示词/知识库同级的独立模块，支持多节点 */
function YoloServiceTab() {
  const [services, setServices] = useState<any[]>([]);
  const [algos, setAlgos] = useState<any[]>([]);
  const [svc, setSvc] = useState<any>({ yoloUrl: '' });
  const [testingId, setTestingId] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const hasPerm = useAuthStore((s) => s.hasPerm('settings.ai', 'edit'));

  const load = async () => {
    const [dict, a, cfg] = await Promise.all([
      httpGet<any[]>('/api/patrol/dict/list').catch(() => []),
      httpGet<any[]>('/api/patrol/algo/list').catch(() => []),
      httpGet<any>('/api/patrol/config/inference').catch(() => ({ yoloUrl: '' })),
    ]);
    setServices((dict || []).filter((x: any) => x.type === 'yolo_service')
      .sort((x: any, y: any) => (x.sort ?? 0) - (y.sort ?? 0)));
    setAlgos(a || []);
    setSvc({ yoloUrl: (cfg as any)?.yoloUrl || '' });
  };
  useEffect(() => { load(); }, []);

  /** 算法实际生效地址：算法自带 endpoint 优先，否则回落默认服务 */
  const r2url = (a: any, defUrl: string) => ((a?.endpoint || '').trim() || defUrl || '');

  /** 测试某一行服务是否可达：临时把该地址写为全局再测（后端测试接口按全局地址探测） */
  const testService = async (s: any) => {
    setTestingId(s.id);
    try {
      if (s._default) await post('/api/patrol/config/inference', { yoloUrl: s.label });
      else await post('/api/patrol/config/inference', { yoloUrl: s.label });
      const res = await post<any>('/api/patrol/algo/0/test', {}).catch((e: any) => ({ ok: false, error: e?.message }));
      if (res?.ok) Toast.success(`[${s.code}] 连通 (${res.costMs}ms)`);
      else Toast.error(`[${s.code}] 不可达：${res?.error || ''}`);
    } finally {
      setTestingId(null);
      load();
    }
  };

  const saveService = async () => {
    if (!editing?.code?.trim() || !editing?.label?.trim()) { Toast.warning('服务名称与地址必填'); return; }
    if (editing._default) {
      // 默认服务行就是全局地址：编辑它 = 保存全局配置（不新增节点）
      await post('/api/patrol/config/inference', { yoloUrl: editing.label.trim() });
      Toast.success('默认服务地址已保存');
    } else {
      await post('/api/patrol/dict/save', {
        id: editing.id, type: 'yolo_service', code: editing.code,
        label: editing.label.trim(), sort: editing.sort ?? 0, enabled: 1,
      });
      Toast.success('推理服务已保存');
    }
    setEditing(null);
    load();
  };

  /** 列表 = 默认服务（全局地址，第一行）+ 自建节点，全部在这一张表里管理 */
  const listRows = [
    ...(svc.yoloUrl ? [{ id: 'default', _default: true, code: '默认服务', label: svc.yoloUrl }] : []),
    ...services,
  ];

  return (
    <>
      <Card size="small">
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Button icon={<IconPlus />} theme="solid" disabled={!hasPerm}
            onClick={() => setEditing({ code: '', label: '', sort: services.length + 1 })}>添加服务</Button>
          <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
          <Hint
            text="算法挂到哪个服务，就在哪台机器上推理"
            detail={<>
              推理服务 = 真正跑 YOLO 的进程地址。可以配多个：不同机器、不同显卡、或跑不同权重集的服务各配一条。
              <br />「默认服务」是未指定服务的算法兜底走这里；算法在「算法」页逐条选择它跑在哪个服务。
              <br />docker 部署默认为 http://yolo-service:8999，本机运行 WVP 时用 http://127.0.0.1:8999。
            </>}
          />
        </Space>
        <Table size="small" rowKey="id" dataSource={listRows} pagination={false}
          empty="暂无推理服务"
          columns={[
            { title: '服务', dataIndex: 'code', width: 200, render: (v: string, r: any) => (
                <Space spacing={6}>
                  <span style={{ fontWeight: r._default ? 600 : 400 }}>{v}</span>
                  {r._default && <Tag size="small" color="blue">默认</Tag>}
                </Space>
              ) },
            { title: '服务地址', dataIndex: 'label', render: (v: string) => <span className="mono">{v}</span> },
            { title: '挂载算法', ellipsis: true, render: (_: any, s: any) => {
                const names = algos.filter((a) => r2url(a, svc.yoloUrl) === s.label).map((a) => a.name);
                return names.length ? <span style={{ fontSize: 12 }}>{names.join('、')}</span> : <span className="text-muted" style={{ fontSize: 12 }}>未挂载（该服务不参与识别）</span>;
              } },
            { title: '操作', width: 200, render: (_: any, s: any) => (
                <Space>
                  <Button size="small" loading={testingId === s.id} onClick={() => testService(s)}>测试连通</Button>
                  <Button size="small" disabled={!hasPerm} onClick={() => setEditing({ ...s })}>编辑</Button>
                  {!s._default && (
                    <Popconfirm title="删除该服务节点？（挂载它的算法会回落到默认服务）"
                      onConfirm={async () => { await post(`/api/patrol/dict/${s.id}/delete`, {}); load(); }}>
                      <Button size="small" type="danger" theme="light" disabled={!hasPerm}>删除</Button>
                    </Popconfirm>
                  )}
                </Space>
              ) },
          ]} />
      </Card>

      <Modal title={editing?._default ? '编辑默认服务' : (editing?.id ? '编辑推理服务' : '添加推理服务')}
        visible={!!editing} onCancel={() => setEditing(null)} onOk={saveService} width={520}>
        {editing && (
          <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
            <div style={{ width: '100%' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>服务名称</div>
              <Input value={editing.code} disabled={!!editing._default}
                onChange={(v) => setEditing({ ...editing, code: v })} placeholder="如 边缘盒子-A / GPU服务器" />
            </div>
            <div style={{ width: '100%' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>服务地址</div>
              <Input value={editing.label} onChange={(v) => setEditing({ ...editing, label: v })} placeholder="http://192.168.0.60:8999" />
            </div>
            {!editing._default && (
              <div className="text-muted" style={{ fontSize: 11 }}>
                保存后到「算法」页把算法挂到这个服务；未挂载的算法走默认服务
              </div>
            )}
          </Space>
        )}
      </Modal>
    </>
  );
}

/** 算法（本地 YOLO）— 算法管理（每条算法可指向不同推理服务；服务本身在「推理服务」模块维护） */
function AlgoTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [svc, setSvc] = useState<any>({ yoloUrl: '' });
  const [services, setServices] = useState<any[]>([]);

  const load = async () => {
    const [d, cfg, dict] = await Promise.all([
      httpGet<any[]>('/api/patrol/algo/list').catch(() => []),
      httpGet<any>('/api/patrol/config/inference').catch(() => ({ yoloUrl: '' })),
      httpGet<any[]>('/api/patrol/dict/list').catch(() => []),
    ]);
    setRows(d || []);
    setSvc({ yoloUrl: (cfg as any)?.yoloUrl || '' });
    setServices((dict || []).filter((x: any) => x.type === 'yolo_service')
      .sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0)));
  };
  useEffect(() => { load(); }, []);

  const testAlgo = async (r: any) => {
    const res = await post<any>(`/api/patrol/algo/${r.id}/test`, {}).catch(() => null);
    if (res?.ok) Toast.success(`[${r.name}] 推理服务连通 (${res.costMs}ms)`);
    else Toast.error(`[${r.name}] 服务不可达`);
  };

  return (
    <>
      <Card size="small">
        <Space style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Button icon={<IconPlus />} theme="solid" onClick={() => { setForm({}); setOpen(true); }}>添加算法</Button>
          <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
          <Typography.Text type="tertiary" size="small">
            一条算法 = 一个推理服务地址 + 一个权重文件 + 识别目标说明；服务节点在「推理服务」页维护。
            默认服务：<span className="mono">{svc.yoloUrl || '未配置'}</span>
          </Typography.Text>
        </Space>
        <Table size="small" dataSource={rows} pagination={false}
          empty="暂无算法，点击「添加算法」并上传 .pt 权重"
          columns={[
            { title: '算法名称', dataIndex: 'name' },
            { title: '推理服务', dataIndex: 'endpoint', width: 250, render: (v: string) => {
                const own = v && v.trim();
                const isDefault = !own;
                const svcName = services.find((s: any) => s.label === own)?.code;
                return (
                  <span className="mono" style={{ fontSize: 12 }}>
                    {own || '默认'}
                    {isDefault && <Tag size="small" color="grey" style={{ marginLeft: 6 }}>默认</Tag>}
                    {svcName && <span className="text-muted" style={{ marginLeft: 6 }}>{svcName}</span>}
                  </span>
                );
              } },
            { title: '引擎', dataIndex: 'engine', width: 80, render: (v: string) => <Tag color="blue">{v || 'YOLO'}</Tag> },
            { title: '权重文件', dataIndex: 'filePath', width: 180, render: (v: string) => <span className="mono">{v || 'yolov8n.pt（内置）'}</span> },
            { title: '版本', dataIndex: 'version', width: 90 },
            { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'ENABLED' ? 'green' : 'grey'}>{v === 'ENABLED' ? '启用' : '停用'}</Tag> },
            {
              title: '操作', width: 190,
              render: (_: any, r: any) => (
                <Space>
                  <Button size="small" icon={<IconLink />} onClick={() => testAlgo(r)}>测试</Button>
                  <Button size="small" onClick={() => { setForm({ ...r }); setOpen(true); }}>编辑</Button>
                  <Popconfirm title="确认删除该算法？（识别方案引用会失效）" onConfirm={async () => { await post(`/api/patrol/algo/${r.id}/delete`, {}); load(); }}>
                    <Button size="small" type="danger" theme="light">删除</Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]} />
      </Card>

      {/* 添加/编辑算法（含权重上传与服务选择） */}
      <Modal title={form.id ? '编辑算法' : '添加算法'} visible={open} onCancel={() => setOpen(false)} width={560}
        onOk={async () => {
          if (!form.name?.trim()) { Toast.warning('请输入算法名称'); return; }
          await post('/api/patrol/algo/save', {
            id: form.id || undefined,
            name: form.name,
            engine: 'YOLO',
            endpoint: form.endpoint || '',
            filePath: form.filePath || 'yolov8n.pt',
            labelsJson: form.labelsJson || '[]',
            version: form.version || 'v1',
            status: form.status || 'ENABLED',
          });
          Toast.success('算法已保存');
          setOpen(false);
          load();
        }}>
        <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>算法名称</div>
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="如 车间安全帽检测" />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>跑在哪个推理服务</div>
            <Select style={{ width: '100%' }} showClear placeholder={`不指定（走默认 ${svc.yoloUrl || '未配置'}）`}
              value={form.endpoint || undefined}
              onChange={(v: any) => setForm({ ...form, endpoint: v || '' })}
              optionList={services.map((s: any) => ({ value: s.label, label: `${s.code} · ${s.label}` }))} />
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              多台推理服务时按这里区分；留空 = 用「推理服务」页配的默认地址
            </div>
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>权重文件（.pt，不上传则用内置 yolov8n.pt）</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input value={form.filePath} onChange={(v) => setForm({ ...form, filePath: v })} placeholder="yolov8n.pt" style={{ flex: 1 }} />
              <Upload
                action="/api/patrol/algo/upload"
                accept=".pt"
                showClear={false}
                headers={{ 'access-token': getToken() || '' }}
                onSuccess={async (body: any) => {
                  const d = body?.data || body;
                  if (d?.fileName) {
                    setForm({ ...form, filePath: d.fileName });
                    Toast.success(`权重已上传：${d.fileName}`);
                  }
                }}
                onError={() => Toast.error('上传失败，请检查文件（仅 .pt）')}
              >
                <Button icon={<IconUpload />}>上传 .pt</Button>
              </Upload>
            </div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
              上传后权重存放于该推理服务的共享目录，任务执行时按此文件名动态加载
            </div>
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>识别目标说明（JSON 数组，供界面展示）</div>
            <TextArea
              placeholder={'如 ["安全帽","反光衣","人员"]'}
              value={form.labelsJson}
              onChange={(v) => setForm({ ...form, labelsJson: v })}
              rows={2}
            />
          </div>
          <div>
            <span className="text-muted" style={{ fontSize: 12, marginRight: 8 }}>状态</span>
            <Switch checked={(form.status || 'ENABLED') === 'ENABLED'} onChange={(v: any) => setForm({ ...form, status: v ? 'ENABLED' : 'DISABLED' })} />
          </div>
        </Space>
      </Modal>
    </>
  );
}

/** 模型（云端 VLM）— 供应商列表 + 配置面板 + 模型清单（自定义供应商风格） */
function ModelTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [form, setForm] = useState<any>({});
  const [models, setModels] = useState<any[]>([]);
  /** 正在新建一个空白供应商（未落库）：名称/Base URL/Key/模型都由用户自己填 */
  const [drafting, setDrafting] = useState(false);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [newModel, setNewModel] = useState<any>({ contextWindow: 262144, maxOutput: 4096, inputTypes: ['文本', '图片'], outputTypes: ['文本'] });
  const [testing, setTesting] = useState(false);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [editModelIndex, setEditModelIndex] = useState<number | null>(null);

  const parseModels = (r: any): any[] => {
    try {
      const pj = JSON.parse(r.paramsJson || '{}');
      if (Array.isArray(pj.models) && pj.models.length > 0) return pj.models;
    } catch { /* ignore */ }
    const arr: any[] = [];
    if (r.model) arr.push({ id: r.model, contextWindow: 262144, maxOutput: 4096, inputTypes: ['文本', '图片'], outputTypes: ['文本'] });
    if (r.modelFallback) arr.push({ id: r.modelFallback, contextWindow: 262144, maxOutput: 4096, inputTypes: ['文本', '图片'], outputTypes: ['文本'] });
    return arr;
  };

  const selectProvider = (r: any) => {
    setDrafting(false);
    setCurrentId(r.id);
    setModels(parseModels(r));
    setForm({ ...r, apiKey: '' });
  };

  /** 新建空白供应商：不预置任何厂商/地址/模型，全部由用户填写 */
  const startDraft = () => {
    setDrafting(true);
    setCurrentId(null);
    setModels([]);
    setForm({ name: '', baseUrl: '', protocol: 'chat_completions', status: 'ENABLED', apiKey: '' });
  };

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/model/list').catch(() => []);
    const list = d || [];
    setRows(list);
    // 正在填空白模板时不要自动选中第一个供应商，否则会把用户没填完的表单冲掉
    if (drafting) return;
    if (currentId == null && list.length > 0) {
      selectProvider(list[0]);
    } else if (currentId != null) {
      const c = list.find((x) => x.id === currentId);
      if (c) {
        setModels(parseModels(c));
        setForm((f: any) => ({ ...f, ...c, apiKey: f.apiKey || '' }));
      } else {
        setCurrentId(null);
      }
    }
  };
  useEffect(() => { load(); }, []);

  const current = rows.find((r) => r.id === currentId);

  const persist = async () => {
    if (!form.name?.trim()) { Toast.warning('请填写供应商名称'); return; }
    if (models.length === 0) { Toast.warning('请先「添加模型」——至少填一个模型 ID 才能保存'); return; }
    const primary = models[0]?.id ?? '';
    const fallback = models[1]?.id ?? null;
    const body: any = {
      id: currentId ?? undefined,
      name: form.name,
      provider: form.provider || 'custom',
      baseUrl: form.baseUrl,
      protocol: form.protocol || 'chat_completions',
      model: primary,
      model_fallback: fallback,
      params_json: JSON.stringify({ models }),
      status: form.status || 'ENABLED',
    };
    if (form.apiKey && form.apiKey.trim()) body.api_key = form.apiKey.trim();
    const res = await post<any>('/api/patrol/model/save', body);
    Toast.success('模型配置已保存');
    // 新建时保存后要把新供应商选中，否则会被自动选中第一条冲掉用户刚填的内容
    setDrafting(false);
    const d = await httpGet<any[]>('/api/patrol/model/list').catch(() => []);
    const list = (d as any[]) || [];
    setRows(list);
    const match = list.find((x) => x.id === (res?.id ?? currentId)) || list.find((x) => x.name === body.name);
    if (match) selectProvider(match);
  };

  const testModel = async () => {
    if (!currentId) return;
    setTesting(true);
    try {
      const res = await post<any>(`/api/patrol/model/${currentId}/test`, {}).catch((e: any) => ({ error: e?.message }));
      if (res?.ok) Toast.success(`握手成功：${res.reply ?? ''}（${res.actualModel} · ${res.costMs}ms）`);
      else Toast.error(`握手失败：${res?.error || '请检查 Key/网络/额度'}`);
    } finally {
      setTesting(false);
    }
  };

  const ctxLabel = (n: number) => (n >= 1000000 ? `${Math.round(n / 100000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  const providerDot = (r: any) => (r.apiKeyConfigured ? 'var(--semi-color-success)' : 'var(--semi-color-text-3)');

  return (
    <div style={{ display: 'flex', gap: 12, minHeight: 480 }}>
      <aside style={{ width: 232, flexShrink: 0, borderRight: '1px solid var(--semi-color-border)', overflow: 'auto', paddingRight: 8, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 8 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>我的供应商</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            onClick={() => selectProvider(r)}
            className="flex-between"
            style={{
              padding: '8px 10px', borderRadius: 6, cursor: 'pointer', marginBottom: 4,
              background: r.id === currentId && !drafting ? 'var(--semi-color-primary-light-default)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.name || r.model}
            </span>
            <span title={r.apiKeyConfigured ? 'Key 已配置' : 'Key 未配置'} style={{ width: 8, height: 8, borderRadius: '50%', background: providerDot(r), flexShrink: 0 }} />
          </div>
        ))}
        {rows.length === 0 && !drafting && <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>暂无供应商</div>}
        {/* 添加入口放在列表末尾，随供应商增加自动下移 */}
        <Button
          size="small"
          icon={<IconPlus />}
          theme={drafting ? 'solid' : 'light'}
          onClick={startDraft}
          style={{ marginTop: 4, flexShrink: 0 }}
        >
          添加供应商
        </Button>
      </aside>

      <section style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {current || drafting ? (
          <Card size="small">
            <div className="flex-between" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {form.name || current?.model || '新供应商'}
                </span>
                {!drafting && <Tag color={form.status === 'ENABLED' ? 'green' : 'grey'}>{form.status === 'ENABLED' ? '已启用' : '已禁用'}</Tag>}
                <Switch checked={form.status === 'ENABLED'} size="small" onChange={(v: any) => setForm({ ...form, status: v ? 'ENABLED' : 'DISABLED' })} />
                {/* 删除紧挨着标题，不再甩到卡片最右边 */}
                {!drafting && (
                  <Popconfirm title="确认删除该供应商及其模型配置？" onConfirm={async () => {
                    await post(`/api/patrol/model/${currentId}/delete`, {});
                    setCurrentId(null); setForm({}); setModels([]);
                    await load();
                  }}>
                    <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} />
                  </Popconfirm>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 660 }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>供应商名称</div>
                <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="自定义名称，如 我的视觉模型" />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>Base URL</div>
                <Input value={form.baseUrl} onChange={(v) => setForm({ ...form, baseUrl: v })} placeholder="https://api.example.com/v1" />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>API 格式</div>
                <Select value={form.protocol} onChange={(v) => setForm({ ...form, protocol: v })} style={{ width: '100%' }}
                  optionList={[
                    { value: 'chat_completions', label: 'Chat Completions (/chat/completions)' },
                    { value: 'responses', label: 'Responses (/responses)' },
                    { value: 'anthropic', label: 'Anthropic (/v1/messages)' },
                  ]} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  API Key {current?.apiKeyConfigured ? <Tag size="small" color="green">已配置（加密存储）</Tag> : <Tag size="small" color="orange">未配置</Tag>}
                </div>
                <Input mode="password" value={form.apiKey} onChange={(v) => setForm({ ...form, apiKey: v })}
                  placeholder={current?.apiKeyConfigured ? '已加密保存，输入新值可覆盖' : 'sk-...（后端 AES 加密存储，前端不回显）'} />
              </div>

              <div>
                <div className="text-muted" style={{ fontSize: 12, margin: '8px 0 6px' }}>模型列表（第 1 个为主模型，第 2 个自动作为降级备用）</div>
                {models.map((m, i) => (
                  <div key={i} className="flex-between" style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                      {i === 0 && <Tag size="small" color="blue">主</Tag>}
                      {i === 1 && <Tag size="small" color="cyan">备</Tag>}
                      <span className="mono" style={{ fontSize: 13 }}>{m.id}</span>
                      <Tag size="small" color="grey">{ctxLabel(m.contextWindow ?? 262144)}</Tag>
                      <span className="text-muted" style={{ fontSize: 11 }}>{(m.inputTypes || []).join('/')}</span>
                    </div>
                    <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <Button size="small" theme="borderless" icon={<IconFlash />}
                        loading={testingModelId === m.id}
                        onClick={async () => {
                          if (!currentId) return;
                          if (form.apiKey && form.apiKey.trim()) await persist();
                          setTestingModelId(m.id);
                          try {
                            const res = await post<any>(`/api/patrol/model/${currentId}/test-model`, { model: m.id }).catch((e: any) => ({ error: e?.message }));
                            if (res?.ok) Toast.success(`[${m.id}] 握手成功（${res.costMs}ms）`);
                            else Toast.error(`[${m.id}] ${res?.error || '测试失败'}`);
                          } finally {
                            setTestingModelId(null);
                          }
                        }} />
                      <Button size="small" theme="borderless" icon={<IconEdit />} onClick={() => {
                        setEditModelIndex(i);
                        setNewModel({ ...m });
                        setAddModelOpen(true);
                      }} />
                      {i > 0 && (
                        <Button size="small" theme="borderless" onClick={() => {
                          const arr = [...models];
                          const [x] = arr.splice(i, 1);
                          arr.unshift(x);
                          setModels(arr);
                        }}>设为主</Button>
                      )}
                      <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => setModels(models.filter((_, j) => j !== i))} />
                    </span>
                  </div>
                ))}
                <Button size="small" icon={<IconPlus />} onClick={() => { setNewModel({ contextWindow: 262144, maxOutput: 4096, inputTypes: ['文本', '图片'], outputTypes: ['文本'] }); setAddModelOpen(true); }}>
                  添加模型
                </Button>
              </div>

              <Space style={{ marginTop: 8 }}>
                <Button theme="solid" type="primary" onClick={persist}>保存配置</Button>
              </Space>
            </div>
          </Card>
        ) : (
          <Empty title="未选择供应商" description="从左侧选择或添加一个模型供应商" />
        )}
      </section>


      <Modal title={editModelIndex != null ? '编辑模型' : '添加模型'} visible={addModelOpen}
        onCancel={() => { setAddModelOpen(false); setEditModelIndex(null); }}
        onOk={() => {
          if (!newModel.id?.trim()) { Toast.warning('请输入模型 ID'); return; }
          const dup = models.some((m, j) => m.id === newModel.id && j !== editModelIndex);
          if (dup) { Toast.warning('该模型 ID 已存在'); return; }
          if (editModelIndex != null) {
            const arr = [...models];
            arr[editModelIndex] = newModel;
            setModels(arr);
          } else {
            setModels([...models, newModel]);
          }
          setAddModelOpen(false);
          setEditModelIndex(null);
        }} width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>模型 ID</div>
            <Input value={newModel.id} onChange={(v) => setNewModel({ ...newModel, id: v })} placeholder="如 sensenova-6.8-flash-lite" />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>上下文窗口（tokens）</div>
            <InputNumber value={newModel.contextWindow} onChange={(v: any) => setNewModel({ ...newModel, contextWindow: v })} style={{ width: '100%' }} step={1024} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>最大输出 Token</div>
            <InputNumber value={newModel.maxOutput} onChange={(v: any) => setNewModel({ ...newModel, maxOutput: v })} style={{ width: '100%' }} step={256} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>输入类型（勾选"图片"才能做巡检图像研判）</div>
            <CheckboxGroup value={newModel.inputTypes} onChange={(v: any) => setNewModel({ ...newModel, inputTypes: v })}
              options={['文本', '图片', '视频', 'PDF']} direction="horizontal" />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>输出类型</div>
            <CheckboxGroup value={newModel.outputTypes} onChange={(v: any) => setNewModel({ ...newModel, outputTypes: v })}
              options={['文本']} direction="horizontal" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 提示词：列表 + 编辑。编辑器为"段落 + 结构模板 + 输出格式说明"三段式，
 *  常量（专家身份/输出格式/异常规则）点按钮插入而不是手打，降低手写 JSON 的门槛。 */
function PromptTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ scene: 'general' });

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/prompt/list').catch(() => []);
    setRows(d || []);
  };
  useEffect(() => { load(); }, []);

  /** 按场景预置的结构化输出要求：点一下追加到正文，用户不用手写 JSON */
  const OUTPUT_TEMPLATES: Record<string, string> = {
    general: '按JSON输出：{"findings":[{"item":"检查项名称","anomaly":true/false}],"anomaly":true/false,"confidence":0-1,"reason":"判定原因"}',
    meter: '按JSON输出：{"readings":[{"name":"表计名","value":"读数值","unit":"单位"}],"anomaly":true/false,"confidence":0-1,"reason":"读数是否超限及原因"}',
    indicator_light: '按JSON输出：{"lights":[{"name":"灯名","status":"on/off/unknown","anomaly":true/false}],"anomaly":true/false,"confidence":0-1,"reason":"灯态是否异常"}',
    switch_status: '按JSON输出：{"switches":[{"name":"空开名","state":"closed/open"}],"anomaly":true/false,"confidence":0-1,"reason":"状态是否异常"}',
    text: '按JSON输出：{"text":"识别出的完整文本","anomaly":true/false,"confidence":0-1,"reason":"内容是否异常及原因"}',
  };

  const appendContent = (snippet: string) => {
    const cur = form.content || '';
    const joiner = cur && !cur.endsWith('\n') ? '\n' : '';
    setForm({ ...form, content: cur + joiner + snippet });
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => { setForm({ scene: 'general' }); setOpen(true); }}>新建提示词</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <span className="text-muted" style={{ fontSize: 12 }}>正文 = 你用自然语言写；"输出格式"点按钮插入，不用手写 JSON</span>
      </Space>
      <Table size="small" dataSource={rows} pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '名称', dataIndex: 'name', width: 180 },
          { title: '场景', dataIndex: 'scene', width: 100, render: (v: string) => <Tag>{{ meter: '表计读数', indicator_light: '指示灯', switch_status: '空开状态', general: '通用', text: '文字/铭牌' }[v] ?? v}</Tag> },
          { title: '内容', dataIndex: 'content', ellipsis: true },
          { title: '版本', dataIndex: 'version', width: 70 },
          {
            title: '操作', width: 140,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" onClick={() => { setForm(r); setOpen(true); }}>编辑</Button>
                <Popconfirm title="确认删除？" onConfirm={async () => { await post(`/api/patrol/prompt/${r.id}/delete`, {}); load(); }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title={form.id ? '编辑提示词' : '新建提示词'} visible={open} onCancel={() => setOpen(false)} width={680}
        onOk={async () => {
          if (!form.name?.trim()) { Toast.warning('请输入名称'); return; }
          if (!form.content?.trim()) { Toast.warning('请填写提示词内容'); return; }
          await post('/api/patrol/prompt/save', form); Toast.success('已保存'); setOpen(false); load();
        }}>
        <Space vertical style={{ width: '100%' }} spacing={10}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input placeholder="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} style={{ flex: 1 }} />
            <Select value={form.scene} onChange={(v) => setForm({ ...form, scene: v })} style={{ width: 150 }}
              optionList={[
                { value: 'meter', label: '表计读数' }, { value: 'indicator_light', label: '指示灯' },
                { value: 'switch_status', label: '空开状态' }, { value: 'general', label: '通用巡检' }, { value: 'text', label: '文字/铭牌' },
              ]} />
          </div>
          {/* 常用段落：点插入而不是手打。低频但必要的"套话"在这里点一下就行 */}
          <div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>常用片段（点击追加到正文末尾）</div>
            <Space wrap>
              <Button size="small" onClick={() => appendContent('你是工业设备巡检专家。请仔细识别照片中的设备状态。')}>巡检专家身份</Button>
              <Button size="small" onClick={() => appendContent('图像模糊、反光、遮挡导致无法可靠辨认时，如实降低 confidence 并在 reason 中说明，不要猜测。')}>模糊兜底规则</Button>
              <Button size="small" onClick={() => appendContent('发现异常时在 reason 中给出具体位置与依据。')}>异常依据要求</Button>
            </Space>
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
              输出格式（按当前场景的结构化模板，点击追加；模型按此格式回传，界面才能解析展示）
            </div>
            <Button size="small" theme="light" onClick={() => appendContent(OUTPUT_TEMPLATES[form.scene] || OUTPUT_TEMPLATES.general)}>
              插入「{form.scene}」场景输出模板
            </Button>
          </div>
          <TextArea placeholder="提示词正文：先写角色和任务，再写判定规则；输出格式用上面的按钮插入"
            rows={8} value={form.content} onChange={(v) => setForm({ ...form, content: v })} />
        </Space>
      </Modal>
    </>
  );
}

/** 知识库 */
function KnowledgeTab() {
  const [kbs, setKbs] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [currentKb, setCurrentKb] = useState<number | null>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [kbForm, setKbForm] = useState<any>({});
  const [docForm, setDocForm] = useState<any>({});
  const [ruleOpen, setRuleOpen] = useState(false);
  /** 结构化规则条目（给 VLM 当判定约束：限定范围 / 按标准值纠错 / 超限告警） */
  const [ruleForm, setRuleForm] = useState<any>({ rule_kind: 'RANGE', severity: 'medium', action: 'ALARM' });

  const load = async () => {
    const d = await httpGet<any[]>('/api/patrol/knowledge/list').catch(() => []);
    setKbs(d || []);
    if (currentKb) {
      const docs = await httpGet<any[]>('/api/patrol/knowledge/doc/list', { kbId: currentKb }).catch(() => []);
      setDocs(docs || []);
    } else {
      setDocs([]);
    }
  };
  useEffect(() => { load(); }, [currentKb]);

  return (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setKbOpen(true)}>新建知识库</Button>
        {kbs.map((k) => (
          <Button key={k.id} size="small" theme={currentKb === k.id ? 'solid' : 'light'} onClick={() => setCurrentKb(k.id)}>{k.name}</Button>
        ))}
        {kbs.length > 0 && (
          <Hint
            text="知识库里放两类内容：判定规则（硬约束）和文本知识（背景资料）"
            detail={<>
              判定规则是给大模型的硬约束，用于限定识别范围、按标准值纠错、超出即判异常（异常自动生成告警）。
              <br />例：<code>屏幕温度读数 正常范围 15~35 ℃（超限告警·重要）</code>；<code>设备显示时间 应与当前时间一致（±1 天）</code>。
              <br />文本知识放设备手册、判定经验等，作为补充背景。
              <br />配好后到「识别方案」把知识库绑到方案上，该方案的所有识别任务即按规则判定。
            </>}
          />
        )}
      </Space>
      {kbs.length === 0 && (
        <Banner type="info" closeIcon={null}
          description={
            <span style={{ fontSize: 12 }}>
              还没有知识库。知识库用来给大模型"定标准"：比如规定某个读数的正常范围，模型识别出超范围就判异常并告警；
              也可以给出设备编号/时间的标准值，让模型据此纠错。
              点上方「新建知识库」创建后，在里面添加<b>判定规则</b>或<b>文本知识</b>，再到「识别方案」绑定即可生效。
            </span>
          } />
      )}
      {currentKb && (
        <>
          <Space style={{ marginBottom: 8, flexWrap: 'wrap' }}>
            <Button size="small" icon={<IconPlus />} theme="solid"
              onClick={() => { setRuleForm({ kbId: currentKb, rule_kind: 'RANGE', severity: 'medium', action: 'ALARM' }); setRuleOpen(true); }}>新建判定规则</Button>
            <Button size="small" icon={<IconPlus />} onClick={() => { setDocForm({ kbId: currentKb }); setDocOpen(true); }}>添加文本知识</Button>
            <Hint
              text="判定规则是发给大模型的硬约束：限定识别范围、按标准值纠错、超出即判异常（异常自动告警）"
              detail={<>
                例：规则「屏幕温度读数 正常范围 15~35 ℃，超限告警·重要」→ 模型识别出 62.6 时判异常并产生告警；
                规则「设备时间 应与当前时间一致（±1 天内）」→ 画面时间明显偏离时提示时钟异常或识别错误。
                <br />文本知识（手册/判定经验）作为补充背景一并提供给模型；规则在「识别方案」绑定知识库后对该方案生效。
              </>}
            />
          </Space>
          <Table size="small" dataSource={docs} pagination={false} empty="暂无条目"
            columns={[
              { title: '类型', dataIndex: 'docType', width: 96, render: (v: string) => (
                  (v || 'TEXT') === 'RULE'
                    ? <Tag size="small" color="purple">判定规则</Tag>
                    : <Tag size="small">文本知识</Tag>
                ) },
              { title: '对象 / 标题', dataIndex: 'metric', width: 160, render: (v: string, r: any) => v || r.title },
              { title: '约束内容', render: (_: any, r: any) => {
                  if ((r.docType || 'TEXT') !== 'RULE') return <span style={{ fontSize: 12 }}>{r.content}</span>;
                  const kind = r.ruleKind;
                  const kindText = kind === 'EXPECT' ? '期望值' : kind === 'TIME_WINDOW' ? '时间窗口' : '数值范围';
                  const actText = r.action === 'REVIEW' ? '转人工' : r.action === 'INFO' ? '仅提示' : '超限告警';
                  const sevText = ({ high: '严重', medium: '重要', low: '提示' } as any)[r.severity as string] || '重要';
                  return (
                    <span style={{ fontSize: 12 }}>
                      {kindText}：
                      {kind === 'RANGE'
                        ? (r.minVal == null && r.maxVal == null ? '-' : `${r.minVal ?? '-∞'} ~ ${r.maxVal ?? '+∞'}${r.unit ? ' ' + r.unit : ''}`)
                        : (r.expectValue || '-')}
                      <span className="text-muted" style={{ marginLeft: 8 }}>{actText} · {sevText}</span>
                    </span>
                  );
                } },
              { title: '操作', width: 90, render: (_: any, r: any) => (
                  <Popconfirm title="确认删除？" onConfirm={async () => { await post(`/api/patrol/knowledge-doc/${r.id}/delete`, {}); load(); }}>
                    <Button size="small" type="danger" theme="light">删除</Button>
                  </Popconfirm>
                ) },
            ]} />
        </>
      )}
      <Modal title="新建知识库" visible={kbOpen} onCancel={() => setKbOpen(false)}
        onOk={async () => { await post('/api/patrol/knowledge/save', kbForm); Toast.success('已创建'); setKbOpen(false); load(); }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="知识库名称（如 10kV配电室设备标准值）" value={kbForm.name} onChange={(v) => setKbForm({ ...kbForm, name: v })} />
          <Input placeholder="描述" value={kbForm.description} onChange={(v) => setKbForm({ ...kbForm, description: v })} />
        </Space>
      </Modal>
      {/* 判定规则：结构化约束，直接决定 VLM 怎么判、什么情况告警 */}
      <Modal title="新建判定规则" visible={ruleOpen} onCancel={() => setRuleOpen(false)} width={620}
        onOk={async () => {
          if (!ruleForm.metric?.trim()) { Toast.warning('请填写约束对象（如 屏幕温度读数）'); return; }
          if (ruleForm.rule_kind === 'RANGE' && ruleForm.min_val == null && ruleForm.max_val == null) {
            Toast.warning('数值范围至少要填一个边界'); return;
          }
          if (ruleForm.rule_kind !== 'RANGE' && !ruleForm.expect_value?.trim()) {
            Toast.warning('请填写期望值'); return;
          }
          await post('/api/patrol/knowledge-doc/save', {
            kbId: currentKb, doc_type: 'RULE',
            title: ruleForm.metric, metric: ruleForm.metric,
            rule_kind: ruleForm.rule_kind,
            min_val: ruleForm.rule_kind === 'RANGE' ? ruleForm.min_val : null,
            max_val: ruleForm.rule_kind === 'RANGE' ? ruleForm.max_val : null,
            unit: ruleForm.unit, expect_value: ruleForm.expect_value,
            severity: ruleForm.severity, action: ruleForm.action,
            content: ruleForm.content || '',
          });
          Toast.success('规则已保存，绑定该知识库的识别方案立即生效');
          setRuleOpen(false);
          load();
        }}>
        <Space vertical style={{ width: '100%' }} spacing={12}>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>约束对象（要判断什么）</div>
            <Input placeholder="如 屏幕温度读数 / 设备显示时间 / 铭牌设备编号"
              value={ruleForm.metric} onChange={(v) => setRuleForm({ ...ruleForm, metric: v })} />
          </div>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>约束类型</div>
            <RadioGroup type="button" value={ruleForm.rule_kind}
              onChange={(e) => setRuleForm({ ...ruleForm, rule_kind: e.target.value })}>
              <Radio value="RANGE">数值范围</Radio>
              <Radio value="EXPECT">期望值</Radio>
              <Radio value="TIME_WINDOW">时间窗口</Radio>
            </RadioGroup>
          </div>
          {ruleForm.rule_kind === 'RANGE' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, width: '100%' }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>下限</div>
                <InputNumber style={{ width: '100%' }} value={ruleForm.min_val}
                  onChange={(v: any) => setRuleForm({ ...ruleForm, min_val: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>上限</div>
                <InputNumber style={{ width: '100%' }} value={ruleForm.max_val}
                  onChange={(v: any) => setRuleForm({ ...ruleForm, max_val: v })} />
              </div>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>单位</div>
                <Input placeholder="℃ / % / V" value={ruleForm.unit}
                  onChange={(v) => setRuleForm({ ...ruleForm, unit: v })} />
              </div>
            </div>
          ) : (
            <div style={{ width: '100%' }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>
                {ruleForm.rule_kind === 'EXPECT' ? '期望值（识别结果应等于它）' : '时间要求（如 与当前时间一致，±1 天内）'}
              </div>
              <Input value={ruleForm.expect_value}
                placeholder={ruleForm.rule_kind === 'EXPECT' ? '如 34020000001310000001' : '如 与当前时间一致（±1 天）'}
                onChange={(v) => setRuleForm({ ...ruleForm, expect_value: v })} />
            </div>
          )}
          <Space>
            <span className="text-muted" style={{ fontSize: 12 }}>超出/不符时</span>
            <Select style={{ width: 150 }} value={ruleForm.action} onChange={(v: any) => setRuleForm({ ...ruleForm, action: v })}
              optionList={[{ value: 'ALARM', label: '判异常并告警' }, { value: 'REVIEW', label: '转人工复核' }, { value: 'INFO', label: '仅提示' }]} />
            <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>等级</span>
            <Select style={{ width: 120 }} value={ruleForm.severity} onChange={(v: any) => setRuleForm({ ...ruleForm, severity: v })}
              optionList={[{ value: 'high', label: '严重' }, { value: 'medium', label: '重要' }, { value: 'low', label: '提示' }]} />
          </Space>
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>补充说明（可选，会一并给模型）</div>
            <TextArea rows={2} value={ruleForm.content} onChange={(v) => setRuleForm({ ...ruleForm, content: v })}
              placeholder="如 该读数来自屏幕显示，反光或模糊时读数不可信，应判为识别失败而非超限" />
          </div>
        </Space>
      </Modal>

      <Modal title="添加文档" visible={docOpen} onCancel={() => setDocOpen(false)} width={620}
        onOk={async () => { await post('/api/patrol/knowledge-doc/save', docForm); Toast.success('已添加'); setDocOpen(false); load(); }}>
        <Space vertical style={{ width: '100%' }}>
          <Input placeholder="文档标题" value={docForm.title} onChange={(v) => setDocForm({ ...docForm, title: v })} />
          <TextArea placeholder="文档内容（设备标准值/巡检标准，VLM 复核时作为上下文检索）" rows={6} value={docForm.content} onChange={(v) => setDocForm({ ...docForm, content: v })} />
        </Space>
      </Modal>
    </>
  );
}

/** 识别方案的三档模式：YOLO+VLM / 仅 VLM / 仅 YOLO */
type SchemeMode = 'yolo_vlm' | 'vlm_only' | 'yolo_only';
const MODE_LABEL: Record<SchemeMode, string> = {
  yolo_vlm: 'YOLO 初筛 + VLM 复核',
  vlm_only: '仅 VLM 识别',
  yolo_only: '仅 YOLO 初筛',
};
/** 从方案行推断模式：没有 algo_id 就是"仅 VLM"（后端 algo_id 为空时本就跳过 YOLO） */
const schemeMode = (r: any): SchemeMode => (!r?.algoId ? 'vlm_only' : (r.vlmEnabled ? 'yolo_vlm' : 'yolo_only'));
/** 列表里用的短标签 */
const schemeModeLabel = (r: any) => ({ yolo_vlm: 'YOLO+VLM', vlm_only: '仅 VLM', yolo_only: '仅 YOLO' })[schemeMode(r)];
/** 模式一句话说明（放在分段切换下方，替代原来的三张大卡片） */
const modeHint = (m: SchemeMode): string => ({
  yolo_vlm: '本地 YOLO 先初筛，云端大模型再复核画面：兼顾成本与判定精度，最常用',
  vlm_only: '跳过本地 YOLO，直接由大模型看图判定：适合铭牌读数、外观研判',
  yolo_only: '只跑本地 YOLO，不调用云端模型：零 API 成本，适合"有没有目标"类检测',
}[m]);

/** 模式配置栏：统一的分组容器（标题 + 内容），YOLO / VLM 两栏视觉对等 */
function ConfigPane({ title, subtitle, disabled, children }: {
  title: string; subtitle: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: '12px 14px',
      background: 'var(--semi-color-fill-0)', opacity: disabled ? 0.45 : 1,
      pointerEvents: disabled ? 'none' : 'auto', minWidth: 0, height: '100%',
      display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span className="text-muted" style={{ fontSize: 11 }}>{subtitle}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>{children}</div>
    </div>
  );
}

/** 本地 YOLO 栏：先选推理服务（可多节点），再选该服务下的算法 */
function YoloPane({ form, setForm, algos, services, enabled }: any) {
  const svcUrl = (form.algoId != null ? algos.find((a: any) => a.id === form.algoId)?.endpoint : '') || '';
  return (
    <ConfigPane title="本地 YOLO 初筛" subtitle="先跑本地模型，快速框出目标" disabled={!enabled}>
      <div style={{ width: '100%' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>推理服务</div>
        <Select placeholder="默认推理服务" style={{ width: '100%' }} showClear
          value={services.some((s: any) => s.url === svcUrl) ? svcUrl : undefined}
          onChange={(v: any) => {
            if (!v) return;
            // 选服务后自动挑该服务下第一个可用算法，避免"选了服务还是空算法"
            const cand = algos.find((a: any) => (a.endpoint || '') === v);
            setForm({ ...form, algoId: cand ? cand.id : form.algoId });
          }}
          optionList={services.map((s: any) => ({ value: s.url, label: `${s.name} · ${s.url}` }))} />
      </div>
      <div style={{ width: '100%' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>算法（权重）</div>
        <Select placeholder="选择 YOLO 算法" value={form.algoId} style={{ width: '100%' }} showClear
          onChange={(v: any) => setForm({ ...form, algoId: v })}
          optionList={algos.map((a: any) => ({
            value: a.id,
            label: `${a.name} · ${a.filePath || 'yolov8n.pt（内置）'}${a.status === 'ENABLED' ? '' : '（已停用）'}`,
          }))} />
      </div>
      <div className="text-muted" style={{ fontSize: 11, marginTop: 'auto' }}>
        推理服务在「设置 → 智能算法 → 推理服务」里维护，可配多个节点
      </div>
    </ConfigPane>
  );
}

/** 云端 VLM 栏：模型 + 提示词 + 知识库 */
function VlmPane({ form, setForm, models, prompts, kbs, enabled }: any) {
  return (
    <ConfigPane title="云端 VLM 复核" subtitle="大模型看图判定并给依据" disabled={!enabled}>
      <div style={{ width: '100%' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>模型</div>
        <Select placeholder="VLM 模型" value={form.vlmModelId} onChange={(v: any) => setForm({ ...form, vlmModelId: v })} style={{ width: '100%' }} showClear
          optionList={models.map((m: any) => ({ value: m.id, label: `${m.name} (${m.model})` }))} />
      </div>
      <div style={{ width: '100%' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>提示词</div>
        <Select placeholder="提示词" value={form.promptId} onChange={(v: any) => setForm({ ...form, promptId: v })} style={{ width: '100%' }} showClear
          optionList={prompts.map((p: any) => ({ value: p.id, label: `${p.name} (${p.scene})` }))} />
      </div>
      <div style={{ width: '100%' }}>
        <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>知识库（复核时检索）</div>
        <Select multiple placeholder="不选 = 不检索知识库" value={form.kbIds} onChange={(v: any) => setForm({ ...form, kbIds: v })} style={{ width: '100%' }}
          optionList={kbs.map((k: any) => ({ value: k.id, label: k.name }))} />
      </div>
    </ConfigPane>
  );
}

/** 识别方案列表：模式 + 已选配置（算法/模型/提示词/知识库）都展示出来。
 *  之前只有模式标签，用户在列表页看不出"这个方案到底用了什么"，必须点开编辑才知道。 */
function SchemeTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [algos, setAlgos] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<any[]>([]);
  const [kbs, setKbs] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ mode: 'yolo_vlm', vlmEnabled: true, threshold: 0.6, riskLevel: 'medium', kbIds: [] });

  const load = async () => {
    const [s, a, m, p, k, dict, cfg] = await Promise.all([
      httpGet<any[]>('/api/patrol/scheme/list').catch(() => []),
      httpGet<any[]>('/api/patrol/algo/list').catch(() => []),
      httpGet<any[]>('/api/patrol/model/list').catch(() => []),
      httpGet<any[]>('/api/patrol/prompt/list').catch(() => []),
      httpGet<any[]>('/api/patrol/knowledge/list').catch(() => []),
      // 推理服务池（可多节点）：存 patrol_dict type=yolo_service，code=名称 / label=地址
      httpGet<any[]>('/api/patrol/dict/list').catch(() => []),
      httpGet<any>('/api/patrol/config/inference').catch(() => null),
    ]);
    setRows(s || []); setAlgos(a || []); setModels(m || []); setPrompts(p || []); setKbs(k || []);
    const pool = (dict || [])
      .filter((d: any) => d.type === 'yolo_service')
      .sort((x: any, y: any) => (x.sort ?? 0) - (y.sort ?? 0))
      .map((d: any) => ({ name: d.code || '推理服务', url: d.label || '', id: d.id }));
    const defUrl = (cfg as any)?.yoloUrl;
    const merged = defUrl && !pool.some((x: any) => x.url === defUrl)
      ? [{ name: '默认服务', url: defUrl, id: null }, ...pool]
      : pool;
    setServices(merged);
  };
  useEffect(() => { load(); }, []);

  // 已选配置摘要：算出"算法/模型/提示词/知识库"实际选中了什么名字（未选的显示 —）
  const cfgOf = (r: any) => {
    const algo = algos.find((a: any) => a.id === r.algoId);
    const model = models.find((m: any) => m.id === r.vlmModelId);
    const prompt = prompts.find((p: any) => p.id === r.promptId);
    let kbIds: any[] = [];
    try { kbIds = JSON.parse(r.kbIdsJson || '[]'); } catch { /* ignore */ }
    const kbNames = kbIds.map((id: any) => kbs.find((k: any) => k.id === id)?.name).filter(Boolean);
    const m = schemeMode(r);
    return {
      algo: m === 'vlm_only' ? '—（仅 VLM）' : (algo?.name || (r.algoId ? `#${r.algoId}（已被删除）` : '—')),
      model: m === 'yolo_only' ? '—（仅 YOLO）' : (model ? `${model.name} · ${model.model}` : (r.vlmModelId ? `#${r.vlmModelId}（已被删除）` : '—')),
      prompt: m === 'yolo_only' ? '—（仅 YOLO）' : (prompt ? prompt.name : '—'),
      kb: m === 'yolo_only' ? '—' : (kbNames.length ? kbNames.join('、') : '—'),
    };
  };

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<IconPlus />} theme="solid" onClick={() => { setForm({ mode: 'yolo_vlm', vlmEnabled: true, threshold: 0.6, riskLevel: 'medium', kbIds: [] }); setOpen(true); }}>新建识别方案</Button>
        <Button icon={<IconRefresh />} onClick={load}>刷新</Button>
        <Typography.Text type="tertiary" size="small">三档模式：YOLO 初筛 + VLM 复核 / 仅 VLM / 仅 YOLO；任务中一键套用到多点位</Typography.Text>
      </Space>
      <Table size="small" dataSource={rows} pagination={false} empty="暂无识别方案"
        columns={[
          { title: '方案名称', dataIndex: 'name', width: 150, render: (v: string, r: any) => (
              <div>
                <div style={{ fontWeight: 600 }}>{v}</div>
                <div className="text-muted" style={{ fontSize: 11 }}>{schemeModeLabel(r)} · 阈值 {Number(r.threshold ?? 0).toFixed(2)}</div>
              </div>
            ) },
          {
            title: '已选配置（算法 / 模型 / 提示词 / 知识库）',
            render: (_: any, r: any) => {
              const c = cfgOf(r);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                    <span className="text-muted" style={{ fontSize: 11, width: 42, flexShrink: 0 }}>算法</span>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.algo}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                    <span className="text-muted" style={{ fontSize: 11, width: 42, flexShrink: 0 }}>模型</span>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.model}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                    <span className="text-muted" style={{ fontSize: 11, width: 42, flexShrink: 0 }}>提示词</span>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.prompt}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                    <span className="text-muted" style={{ fontSize: 11, width: 42, flexShrink: 0 }}>知识库</span>
                    <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.kb}</span>
                  </div>
                </div>
              );
            },
          },
          { title: '模式', width: 96, render: (_: any, r: any) => {
              const m = schemeMode(r);
              return <Tag size="small" color={m === 'vlm_only' ? 'purple' : m === 'yolo_only' ? 'cyan' : 'blue'}>{m === 'vlm_only' ? '仅VLM' : m === 'yolo_only' ? '仅YOLO' : 'YOLO+VLM'}</Tag>;
            } },
          { title: '风险', width: 84, dataIndex: 'riskLevel', render: (v: string) => <Tag size="small" color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'blue'}>{{ high: '严重', medium: '重要', low: '提示' }[v]}</Tag> },
          {
            title: '操作', width: 140,
            render: (_: any, r: any) => (
              <Space>
                <Button size="small" onClick={() => { setForm({ ...r, mode: schemeMode(r), kbIds: (() => { try { return JSON.parse(r.kbIdsJson || '[]'); } catch { return []; } })() }); setOpen(true); }}>编辑</Button>
                <Popconfirm title="确认删除方案？" onConfirm={async () => { await post(`/api/patrol/scheme/${r.id}/delete`, {}); load(); }}>
                  <Button size="small" type="danger" theme="light">删除</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]} />
      <Modal title={form.id ? '编辑识别方案' : '新建识别方案'} visible={open} onCancel={() => setOpen(false)} width={720}
        onOk={async () => {
          const m: SchemeMode = form.mode || 'yolo_vlm';
          if (m !== 'vlm_only' && !form.algoId) { Toast.warning('请选择 YOLO 算法（或用"仅 VLM 识别"模式）'); return; }
          if (m !== 'yolo_only' && !form.vlmModelId) { Toast.warning('请选择 VLM 模型（或用"仅 YOLO 初筛"模式）'); return; }
          // 只提交库表真实存在的列：mode/kbIds 是界面态，直接 {...form} 会拼出不存在的列导致 SQL 报错
          await post('/api/patrol/scheme/save', {
            id: form.id,
            name: form.name,
            description: form.description,
            vlmModelId: form.vlmModelId,
            promptId: form.promptId,
            vlmEnabled: m !== 'yolo_only',
            threshold: form.threshold,
            riskLevel: form.riskLevel,
            // 仅 VLM：必须显式清空 algo_id（后端约定空串 = 置 NULL，否则改不回纯 VLM 模式）
            algoId: m === 'vlm_only' ? '' : form.algoId,
            kbIdsJson: JSON.stringify(form.kbIds || []),
          });
          Toast.success('方案已保存，可在新建任务时一键套用');
          setOpen(false);
          load();
        }}>
        {/* 用普通 flex 容器而不是 Semi Space：Space 的子项宽度收缩，
            会让内部 grid 撑不满弹窗（表现为内容整体偏右、左侧一大片空白） */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, width: '100%' }}>
            <Input placeholder="方案名称（如 指针电表识别方案）" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Input placeholder="描述（可选）" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          </div>

          {/* 识别模式：顶部分段（胶囊）切换。官方规范——切换后下方关联区域内容随之变化，
              所以放在配置区最上方，而不是用三张大卡片占掉半屏 */}
          <div style={{ width: '100%' }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>识别模式</div>
            <RadioGroup type="button" buttonSize="middle" value={form.mode || 'yolo_vlm'}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}>
              <Radio value="yolo_vlm">YOLO 初筛 + VLM 复核</Radio>
              <Radio value="vlm_only">仅 VLM 识别</Radio>
              <Radio value="yolo_only">仅 YOLO 初筛</Radio>
            </RadioGroup>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 6 }}>{modeHint(form.mode || 'yolo_vlm')}</div>
          </div>

          {/* 两栏：本地 YOLO 维度 / 云端 VLM 维度，各自成组；模式不含的一侧整体禁用（灰显而不是消失，切换不跳版） */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'stretch', width: '100%' }}>
            <YoloPane form={form} setForm={setForm} algos={algos} services={services} enabled={(form.mode || 'yolo_vlm') !== 'vlm_only'} />
            <VlmPane form={form} setForm={setForm} models={models} prompts={prompts} kbs={kbs} enabled={(form.mode || 'yolo_vlm') !== 'yolo_only'} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', flexWrap: 'wrap' }}>
            <span className="text-muted" style={{ fontSize: 12 }}>置信度阈值</span>
            <InputNumber value={form.threshold} onChange={(v: any) => setForm({ ...form, threshold: v })} min={0.3} max={0.95} step={0.05} style={{ width: 110 }} />
            <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>风险等级</span>
            <Select value={form.riskLevel} onChange={(v) => setForm({ ...form, riskLevel: v })} style={{ width: 140 }}
              optionList={[{ value: 'high', label: '严重(红级)' }, { value: 'medium', label: '重要(黄级)' }, { value: 'low', label: '提示(蓝级)' }]} />
          </div>
        </div>
      </Modal>
    </>
  );
}
