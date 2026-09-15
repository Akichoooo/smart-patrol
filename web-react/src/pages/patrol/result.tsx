import { useEffect, useMemo, useState } from 'react';
import { Table, Tag, Tabs, TabPane, Button, Input, TextArea, Space, Modal, Image, Typography, Spin, Toast, DatePicker } from '@douyinfe/semi-ui';
import { IconSearch, IconRefresh } from '@douyinfe/semi-icons';
import { get as httpGet, post } from '@/api/http';
import { useAuthStore } from '@/store/auth';
import AiResultView from '@/components/AiResultView';
import { parseVlm } from '@/utils/vlm';
import { RESULT_META, REVIEW_META, shortTime, StatStrip, LoadError } from '@/components/ui';
import dayjs from 'dayjs';

type ResultKind = 'all' | 'abnormal' | 'query';

function isAbnormalRow(r: any) { return r.result === 'ABNORMAL'; }
function isFailedRow(r: any) { return r.result === 'FAILED' || r.result === 'ANALYZING'; }

function ResultTable({ mode }: { mode: ResultKind }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  // 日期筛选（query 模式）：默认近 7 天，结果页是"翻最近几天"的场景，全量 300 条反而难用。
  // Semi DatePicker 的 value 要 Date 对象（dayjs 实例会报 defaultValue 校验错误）
  const [beginDate, setBeginDate] = useState<Date | undefined>(dayjs().subtract(6, 'day').toDate());
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const load = async (kw?: string) => {
    setLoading(true);
    setError(null);
    try {
      // query 模式走带 keyword/日期过滤的 /result/query；其余走全量列表
      const url = mode === 'abnormal' ? '/api/patrol/result/abnormal'
        : mode === 'query' ? '/api/patrol/result/query' : '/api/patrol/result/list';
      const params: any = {};
      if (mode === 'query') {
        if (kw) params.keyword = kw;
        // DatePicker 的值可能是 Date 或字符串；统一格式化成 yyyy-MM-dd
        const fmt = (v: any) => (v ? dayjs(v).format('YYYY-MM-DD') : undefined);
        const b = fmt(beginDate), e = fmt(endDate);
        if (b) params.beginDate = b;
        if (e) params.endDate = e;
      }
      const l = await httpGet<any[]>(url, params);
      setRows(l || []);
    } catch (e: any) {
      setError(e?.message || '加载失败');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [mode]);

  /** 列表行不带 vlm_json 全量详情，点开时拉详情接口 */
  const openDetail = async (r: any, review = false) => {
    setReviewOpen(review);
    setReviewNote('');
    setDetailLoading(true);
    setDetail(r); // 先用行内数据占位渲染，避免白屏闪
    try {
      const full = await httpGet<any>(`/api/patrol/result/${r.id}`);
      setDetail(full || r);
    } catch { /* 占位数据仍在，接口失败不吞掉已有信息 */ }
    finally { setDetailLoading(false); }
  };

  const submitReview = async (decision: string) => {
    try {
      await post(`/api/patrol/result/${detail.id}/review`, { decision, note: reviewNote });
      Toast.success(decision === 'CONFIRMED_NORMAL' ? '已确认正常' : '已确认异常');
      setReviewOpen(false);
      setDetail(null);
      load(mode === 'query' ? keyword : undefined);
    } catch { /* 请求层已提示 */ }
  };

  const columns = useMemo(() => {
    const resultCol = {
      title: '结论', dataIndex: 'result', width: 96,
      render: (v: string) => {
        const meta = RESULT_META[v] ?? { color: 'grey' as const, text: v || '-', kind: 'tag' as const };
        return meta.kind === 'tag'
          ? <Tag color={meta.color} size="large">{meta.text}</Tag>
          : <span style={{ color: 'var(--semi-color-warning)', fontWeight: 600 }}>{meta.text}</span>;
      },
    };
    const base = [
      {
        title: '点位', dataIndex: 'waypointName', width: 150, ellipsis: { showTooltip: true },
        render: (v: string, r: any) => (
          <div>
            <div style={{ fontWeight: 600 }}>{v || '-'}</div>
            {mode !== 'all' && r.reviewStatus && (
              <div className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {REVIEW_META[r.reviewStatus]?.text ?? r.reviewStatus}
              </div>
            )}
          </div>
        ),
      },
      resultCol,
      {
        // 来源说明：异常行 = VLM 给出的判定原因（YOLO 判异常时为"置信度≥阈值"）；
        // 失败行 = 引擎不可用原因（如 VLM 服务不通）。都是识别引擎真实输出，不是人工填的。
        // 长原因单行省略 + 悬停看全文（点开"详情"有完整排版），避免行高被 200 字长文撑爆
        title: '异常 / 失败原因', dataIndex: 'anomalyReason', ellipsis: { showTooltip: { opts: { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxWidth: 420 } } } },
        render: (v: string, r: any) => v
          ? <span style={{ color: isAbnormalRow(r) ? 'var(--semi-color-danger)' : 'var(--semi-color-warning)' }}>{v}</span>
          : <span className="text-muted">—</span>,
      },
      {
        title: '采集时间', dataIndex: 'capturedAt', width: 112,
        render: (v: string) => <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{shortTime(v)}</span>,
      },
      {
        title: '', width: 150,
        render: (_: any, r: any) => (
          <Space spacing={4}>
            <Button size="small" theme="borderless" onClick={() => openDetail(r)}>详情</Button>
            {hasPerm('patrol.result', 'review') && r.reviewStatus === 'PENDING' && (
              <Button size="small" theme="borderless" type="primary" onClick={() => openDetail(r, true)}>人工确认</Button>
            )}
          </Space>
        ),
      },
    ];
    return base as any[];
  }, [mode, hasPerm]);

  return (
    <>
      {mode === 'query' && (
        <div style={{ display: 'flex', gap: 8, paddingBottom: 12, flexWrap: 'wrap' }}>
          <Input prefix={<IconSearch />} placeholder="按点位名称搜索" style={{ width: 200 }}
            value={keyword} onChange={setKeyword}
            onEnterPress={() => load(keyword)} />
          <DatePicker type="date" style={{ width: 140 }} placeholder="开始日期" value={beginDate}
            onChange={(d: any) => setBeginDate(d ? new Date(d) : undefined)} format="yyyy-MM-dd" />
          <span style={{ alignSelf: 'center', color: 'var(--semi-color-text-2)' }}>~</span>
          <DatePicker type="date" style={{ width: 140 }} placeholder="结束日期" value={endDate}
            onChange={(d: any) => setEndDate(d ? new Date(d) : undefined)} format="yyyy-MM-dd" />
          <Button onClick={() => load(keyword)}>查询</Button>
          <Button icon={<IconRefresh />} theme="borderless" onClick={() => { setKeyword(''); setBeginDate(undefined); setEndDate(undefined); load(); }}>重置</Button>
        </div>
      )}

      {!loading && !error && (
        <StatStrip items={[
          { label: '共采集', value: rows.length, color: 'var(--semi-color-text-0)' },
          { label: '正常', value: rows.filter((r) => r.result === 'NORMAL').length, color: 'var(--semi-color-success)' },
          { label: '异常', value: rows.filter(isAbnormalRow).length, color: 'var(--semi-color-danger)', emphasize: rows.some(isAbnormalRow) },
          { label: '识别失败', value: rows.filter(isFailedRow).length, color: 'var(--semi-color-warning)' },
          { label: '待人工确认', value: rows.filter((r) => r.reviewStatus === 'PENDING').length, color: 'var(--semi-color-text-2)' },
        ]} />
      )}

      {error && <LoadError what="结果列表" error={error} onRetry={() => load(mode === 'query' ? keyword : undefined)} />}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <Table size="small" loading={loading} dataSource={rows} pagination={{ pageSize: 15 }}
          columns={columns} empty="暂无巡视结果"
          onRow={(r: any) => ({
            style: isAbnormalRow(r)
              ? { background: 'rgba(244, 63, 94, .10)', boxShadow: 'inset 3px 0 0 var(--semi-color-danger)' }
              : isFailedRow(r)
                ? { background: 'rgba(250, 173, 20, .06)', boxShadow: 'inset 3px 0 0 var(--semi-color-warning)' }
                : undefined,
          })} />
      </div>

      {/* 详情弹窗：统一复用 AiResultView 标注组件，与实时识别完全一致（YOLO 标注框联动、分项发现、判定依据、模型参数） */}
      <Modal title={`点位结果 #${detail?.id ?? ''} · ${detail?.waypointName || detail?.waypoint_name || ''}`} visible={!!detail && !reviewOpen}
        onCancel={() => setDetail(null)} footer={null} width={960} bodyStyle={{ paddingTop: 8 }}>
        {detail && (
          <AiResultView data={detail} image={detail.mediaUrl || detail.media_url} />
        )}
      </Modal>

      {/* 人工审核弹窗 */}
      <Modal title={`人工确认 · ${detail?.waypointName ?? detail?.waypoint_name ?? ''}`} visible={reviewOpen}
        onCancel={() => setReviewOpen(false)} footer={null}>
        <Space vertical style={{ width: '100%' }}>
          <TextArea placeholder="审核说明（如：表盘反光阴影扰动）" value={reviewNote} onChange={setReviewNote} rows={3} />
          <Space>
            <Button type="primary" theme="solid" onClick={() => submitReview('CONFIRMED_NORMAL')}>确认正常</Button>
            <Button type="danger" theme="solid" onClick={() => submitReview('CONFIRMED_ABNORMAL')}>确认异常</Button>
          </Space>
        </Space>
      </Modal>
    </>
  );
}

/** 巡检结果：结果浏览归档 / 识别异常点位 / 结果查询 */
export default function ResultPage() {
  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="结果浏览与归档" itemKey="all"><ResultTable mode="all" /></TabPane>
          <TabPane tab="识别异常点位" itemKey="abnormal"><ResultTable mode="abnormal" /></TabPane>
          <TabPane tab="结果查询" itemKey="query"><ResultTable mode="query" /></TabPane>
        </Tabs>
      </div>
    </div>
  );
}
