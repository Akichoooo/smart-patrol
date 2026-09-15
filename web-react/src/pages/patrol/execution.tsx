import { useEffect, useRef, useState } from 'react';
import { Card, Table, Tag, Progress, Button, Toast, Space, Descriptions, Modal } from '@douyinfe/semi-ui';
import { get as httpGet, postForm } from '@/api/http';
import { getToken } from '@/api/token';

/**
 * 任务执行（实时进度）：WS /api/patrol/ws 推送 EXECUTION_PROGRESS / POINT_RESULT / ALARM。
 * 列：执行单/任务/装备/状态/进度/点位(完成/异常)/开始时间/操作(暂停/恢复/停止/详情)
 */
const STATUS_TAG: Record<string, { color: string; text: string }> = {
  PENDING: { color: 'grey', text: '排队中' },
  RUNNING: { color: 'blue', text: '执行中' },
  PAUSED: { color: 'orange', text: '已暂停' },
  FINISHED: { color: 'green', text: '已完成' },
  STOPPED: { color: 'grey', text: '已停止' },
  FAILED: { color: 'red', text: '失败' },
};

export default function ExecutionPage() {
  const [list, setList] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<any>(null);

  const load = async () => {
    const l = await httpGet<any[]>('/api/patrol/task/executing/list').catch(() => []);
    setList(l || []);
  };

  useEffect(() => {
    load();
    // WebSocket 进度推送
    const token = getToken() || '';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${proto}://${location.host}/api/patrol/ws?access-token=${token}`);
      wsRef.current = ws;
      ws.onopen = () => setWsStatus('open');
      ws.onclose = () => setWsStatus('closed');
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'EXECUTION_PROGRESS') {
            setList((prev) => prev.map((x) => (x.id === msg.data.id ? { ...x, ...msg.data } : x)));
          } else if (msg.type === 'ALARM' || msg.type === 'EXECUTION_FINISHED') {
            load();
          }
        } catch { /* ignore */ }
      };
    } catch {
      setWsStatus('closed');
    }
    // WS 不可用时 5 秒轮询兜底
    timerRef.current = setInterval(() => {
      if (wsRef.current?.readyState !== 1) load();
    }, 5000);
    return () => {
      ws?.close();
      clearInterval(timerRef.current);
    };
  }, []);

  const ctrl = async (execId: number, action: string) => {
    try {
      await postForm(`/api/patrol/task/execution/${execId}/${action}`);
      Toast.success(`${action === 'pause' ? '已暂停' : action === 'resume' ? '已恢复' : '已停止'}`);
      load();
    } catch { /* 请求层已提示 */ }
  };

  const openDetail = async (row: any) => {
    const d = await httpGet<any>(`/api/patrol/task/execution/${row.id}/progress`).catch(() => null);
    setDetail(d || row);
    setDetailOpen(true);
  };

  return (
    <div className="page-root">
      <div className="page-body">
        <Space style={{ marginBottom: 10 }}>
          <Tag color={wsStatus === 'open' ? 'green' : 'grey'} size="small">
            实时推送 {wsStatus === 'open' ? '已连接' : '轮询模式'}
          </Tag>
        </Space>
        <Table
          size="small"
          dataSource={list}
          pagination={false}
          empty="当前没有执行中的任务"
          columns={[
            { title: '执行单', dataIndex: 'id', width: 80 },
            { title: '任务', dataIndex: 'taskName' },
            { title: '装备', dataIndex: 'deviceName', width: 140 },
            {
              title: '状态', dataIndex: 'status', width: 100,
              render: (v: string) => <Tag color={STATUS_TAG[v]?.color}>{STATUS_TAG[v]?.text ?? v}</Tag>,
            },
            {
              title: '进度', width: 220,
              render: (_: any, r: any) => (
                <Progress percent={r.progress ?? 0} showInfo size="small" style={{ width: 160 }} />
              ),
            },
            {
              title: '点位(完成/异常)', width: 130,
              render: (_: any, r: any) => `${r.finishedPoints ?? 0}/${r.totalPoints ?? 0}（异常 ${r.abnormalPoints ?? 0}）`,
            },
            { title: '开始时间', dataIndex: 'startedAt', width: 170 },
            {
              title: '操作', width: 220,
              render: (_: any, r: any) => (
                <Space>
                  <Button size="small" disabled={r.status !== 'RUNNING'} onClick={() => ctrl(r.id, 'pause')}>暂停</Button>
                  <Button size="small" disabled={r.status !== 'PAUSED'} onClick={() => ctrl(r.id, 'resume')}>恢复</Button>
                  <Button size="small" type="danger" theme="light" disabled={['FINISHED', 'STOPPED', 'FAILED'].includes(r.status)} onClick={() => ctrl(r.id, 'stop')}>停止</Button>
                  <Button size="small" theme="borderless" onClick={() => openDetail(r)}>详情</Button>
                </Space>
              ),
            },
          ]}
        />
      </div>

      <Modal title={`执行详情 #${detail?.id ?? ''}`} visible={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={640}>
        {detail && (
          <>
            <Descriptions row size="small" data={[
              { key: '任务', value: detail.taskName },
              { key: '状态', value: STATUS_TAG[detail.status]?.text ?? detail.status },
              { key: '进度', value: `${detail.progress ?? 0}%` },
              { key: '已完成/总点位', value: `${detail.finishedPoints ?? 0}/${detail.totalPoints ?? 0}` },
              { key: '异常点位', value: detail.abnormalPoints ?? 0 },
              { key: '错误信息', value: detail.errorMsg || '-' },
            ]} />
            <Card size="small" title="点位执行明细" style={{ marginTop: 12 }}>
              <Table size="small" pagination={false} dataSource={detail.points || []}
                columns={[
                  { title: '点位', dataIndex: 'waypointName' },
                  { title: '结果', dataIndex: 'result', render: (v: string) => <Tag color={v === 'ABNORMAL' ? 'red' : v === 'ANALYZING' ? 'blue' : 'green'}>{v}</Tag> },
                  { title: '流程记录', dataIndex: 'processNote', ellipsis: true },
                ]} />
            </Card>
          </>
        )}
      </Modal>
    </div>
  );
}
