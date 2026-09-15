import { useEffect, useState } from 'react';
import {
  Table, Tag, Button, Space, Input, TextArea, Select, Modal, Descriptions, Image, RadioGroup, Radio,
  Popconfirm, Toast, Tabs, TabPane, Typography,
} from '@douyinfe/semi-ui';
import { get as httpGet, post } from '@/api/http';
import { LevelTag } from '@/components/StatWidgets';
import { useAuthStore } from '@/store/auth';

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'red', text: '待确认' },
  DISPATCHED: { color: 'orange', text: '已派单' },
  CLOSED: { color: 'green', text: '已归档' },
  FALSE_POSITIVE: { color: 'grey', text: '误报' },
  SILENCED: { color: 'cyan', text: '已免打扰' },
};

function AlarmList({ source }: { source: 'INSPECT' | 'DEVICE' | 'MONITOR' | 'COMPARE' }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);
  const [dispatch, setDispatch] = useState<any>({ decision: 'real', assignee: '张工 (巡检运行一班)', priority: '高', note: '', falseReason: '' });
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const load = async () => {
    setLoading(true);
    try {
      const l = await httpGet<any[]>('/api/patrol/alarm/list', { source }).catch(() => []);
      setRows(l || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [source]);

  /** 批量复归 */
  const recoverAll = async () => {
    await post('/api/patrol/alarm/recover', { source }).catch(() => {});
    Toast.success('已批量复归');
    load();
  };

  const confirm = async (id: number, body: any) => {
    try {
      await post(`/api/patrol/alarm/${id}/confirm`, body);
      Toast.success('处置完成');
      setDetail(null);
      load();
    } catch { /* 请求层已提示 */ }
  };

  const columns = source === 'DEVICE'
    ? [
        { title: '告警内容', dataIndex: 'description' },
        { title: '来源装备', dataIndex: 'deviceName', width: 140 },
        { title: '告警时间', dataIndex: 'alarmTime', width: 170 },
        {
          title: '操作', width: 100,
          render: (_: any, r: any) => (
            <Popconfirm title="确认归档该设备告警？" onConfirm={() => confirm(r.id, { action: 'CLOSED' })}>
              <Button size="small">归档</Button>
            </Popconfirm>
          ),
        },
      ]
    : [
        { title: '点位名称', dataIndex: 'waypointName' },
        { title: '告警时间', dataIndex: 'alarmTime', width: 170 },
        { title: '告警描述', dataIndex: 'description', ellipsis: true },
        { title: '告警等级', dataIndex: 'level', width: 100, render: (v: string) => <LevelTag level={v} /> },
        {
          title: '状态', dataIndex: 'status', width: 100,
          render: (v: string) => <Tag color={STATUS_TAG[v]?.color}>{STATUS_TAG[v]?.text ?? v}</Tag>,
        },
        {
          title: '操作', width: 250,
          render: (_: any, r: any) => (
            <Space>
              {r.channelId != null && (
                <Button size="small" theme="borderless" onClick={() => window.open(`/monitor/video?ch=${r.channelId}`, '_blank')}>监控画面</Button>
              )}
              <Popconfirm title="确认复归该告警？" onConfirm={() => confirm(r.id, { action: 'CLOSED' })}>
                <Button size="small" theme="borderless">复归</Button>
              </Popconfirm>
              <Button size="small" theme="borderless" onClick={() => setDetail(r)}>详情</Button>
              <Button size="small" theme="borderless" onClick={() => confirm(r.id, { action: 'SILENCE' })}>告警免打扰</Button>
            </Space>
          ),
        },
      ];

  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Typography.Text type="tertiary" size="small">告警信息数量：{rows.length}</Typography.Text>
        <div style={{ flex: 1 }} />
        {hasPerm('patrol.alarm', 'confirm') && source !== 'DEVICE' && (
          <Popconfirm title="确认批量复归全部待确认告警？" onConfirm={recoverAll}>
            <Button size="small" type="warning" theme="solid">批量复归</Button>
          </Popconfirm>
        )}
      </Space>
      <Table size="small" loading={loading} dataSource={rows} pagination={{ pageSize: 15 }} columns={columns} empty="暂无告警" />

      {/* 核验与处置工作台（对齐旧平台：真实隐患派单 / 误报排除 / 结单归档） */}
      <Modal
        title="告警核验与闭环处置"
        visible={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={820}
      >
        {detail && (
          <>
            <Descriptions row size="small" data={[
              { key: '告警单号', value: detail.alarmNo ?? detail.id },
              { key: '点位', value: detail.waypointName },
              { key: '等级', value: <LevelTag level={detail.level} /> },
              { key: '告警时间', value: detail.alarmTime },
            ]} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
              <div style={{ width: 320 }}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>证据抓拍图</div>
                <Image width={320} src={detail.mediaUrl || ''} alt="告警抓拍"
                  fallback="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iMTgwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWIyMTI5Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZpbGw9IiM2YmNlOTUiIGZvbnQtc2l6ZT0iMTQiIHRleHQtYW5jaG9yPSJtaWRkbGUi+5pS55Y+R5paH5pWw6aG6PC90ZXh0Pjwvc3ZnPg==" />
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>识别类型：{detail.identifyType || '-'} · 子类：{detail.identifySubType || '-'}</div>
              </div>
              <div style={{ flex: 1 }}>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>VLM 研判结论</div>
                <div style={{ background: 'var(--semi-color-primary-light-default)', padding: '8px 10px', borderRadius: 4, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
                  {detail.anomalyReason || detail.description || '（无研判描述）'}
                </div>
                {detail.status === 'PENDING' ? (
                  <div style={{ marginTop: 12 }}>
                    <RadioGroup value={dispatch.decision} onChange={(e) => setDispatch({ ...dispatch, decision: e.target.value })}>
                      <Radio value="real">真实隐患（派发工单）</Radio>
                      <Radio value="false">误报排除</Radio>
                    </RadioGroup>
                    {dispatch.decision === 'real' ? (
                      <Space vertical align="start" style={{ marginTop: 10, width: '100%' }}>
                        <Select value={dispatch.assignee} onChange={(v) => setDispatch({ ...dispatch, assignee: v })} style={{ width: 240 }}
                          optionList={['张工 (巡检运行一班)', '李工 (防汛应急工程组)', '王工 (水工设备维修班)', '刘工 (安全环保督导组)'].map((x) => ({ value: x, label: x }))} />
                        <RadioGroup type="button" value={dispatch.priority} onChange={(e) => setDispatch({ ...dispatch, priority: e.target.value })}>
                          <Radio value="紧急">紧急</Radio><Radio value="高">高</Radio><Radio value="普通">普通</Radio>
                        </RadioGroup>
                        <TextArea placeholder="处置指令说明" rows={2} value={dispatch.note} onChange={(v) => setDispatch({ ...dispatch, note: v })} style={{ width: '100%' }} />
                        <Button theme="solid" type="danger" onClick={() => confirm(detail.id, { action: 'DISPATCH', ...dispatch })}>
                          下发工单并闭环派单
                        </Button>
                      </Space>
                    ) : (
                      <Space vertical align="start" style={{ marginTop: 10, width: '100%' }}>
                        <Input placeholder="误报排除说明（如：表盘反光阴影扰动）" value={dispatch.falseReason} onChange={(v) => setDispatch({ ...dispatch, falseReason: v })} style={{ width: '100%' }} />
                        <Button theme="solid" type="warning" onClick={() => confirm(detail.id, { action: 'FALSE_POSITIVE', note: dispatch.falseReason })}>
                          确认误报并归档
                        </Button>
                      </Space>
                    )}
                  </div>
                ) : (
                  <div className="text-muted" style={{ marginTop: 12, fontSize: 12 }}>
                    工单状态：{STATUS_TAG[detail.status]?.text}
                    {detail.dispatchJson && (
                      <Typography.Paragraph size="small" copyable style={{ whiteSpace: 'pre-wrap' }}>
                        {detail.dispatchJson}
                      </Typography.Paragraph>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

/** 告警管理（对齐旧平台4个告警确认页：巡视结果/静默监视/对比分析/巡视设备） */
export default function AlarmPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="巡视结果告警" itemKey="INSPECT"><AlarmList source="INSPECT" /></TabPane>
          <TabPane tab="静默监视告警" itemKey="MONITOR"><AlarmList source="MONITOR" /></TabPane>
          <TabPane tab="对比分析告警" itemKey="COMPARE"><AlarmList source="COMPARE" /></TabPane>
          <TabPane tab="巡视设备告警" itemKey="DEVICE"><AlarmList source="DEVICE" /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}
