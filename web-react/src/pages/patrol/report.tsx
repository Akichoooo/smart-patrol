import { useEffect, useState } from 'react';
import { Table, Tag, Button, Space, Input, Select, Modal, Descriptions, Toast, Typography } from '@douyinfe/semi-ui';
import { IconDownload } from '@douyinfe/semi-icons';
import { get as httpGet } from '@/api/http';
import { getToken } from '@/api/token';
import { useAuthStore } from '@/store/auth';

/**
 * 任务报告（对齐旧平台列：报告名称/任务完成时间/巡视类型/点位总数/异常点位总数/审核人/审核时间/操作详情；导出报告）
 */
export default function ReportPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);
  const hasPerm = useAuthStore((s) => s.hasPerm);

  const load = async () => {
    setLoading(true);
    try {
      const l = await httpGet<any[]>('/api/patrol/report/list').catch(() => []);
      setRows(l || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const exportReport = async (row: any) => {
    try {
      const resp = await fetch(`/api/patrol/report/${row.id}/export`, {
        headers: { 'access-token': getToken() || '' },
      });
      if (!resp.ok) throw new Error('导出失败');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `巡检报告-${row.taskName ?? row.id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      Toast.success('报告已导出');
    } catch (e: any) {
      Toast.error(e?.message || '导出失败');
    }
  };

  return (
    <div className="page-root">
      <div className="page-body">
        <Space style={{ marginBottom: 12 }}>
          <Input placeholder="设备区域" style={{ width: 140 }} />
          <Input placeholder="设备间隔" style={{ width: 140 }} />
          <Input placeholder="设备类型" style={{ width: 140 }} />
          <Button theme="solid" onClick={load}>查询</Button>
        </Space>
        <Table
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 15 }}
          empty="任务完成后自动生成报告"
          columns={[
            { title: '报告名称', dataIndex: 'name' },
            { title: '任务', dataIndex: 'taskName' },
            { title: '任务完成时间', dataIndex: 'finishedAt', width: 170 },
            { title: '巡视类型', dataIndex: 'taskType', width: 100, render: (v: string) => <Tag>{v === 'ROUTINE' ? '例行' : v === 'SILENT' ? '静默' : v}</Tag> },
            { title: '点位总数', dataIndex: 'totalPoints', width: 90 },
            { title: '异常点位', dataIndex: 'abnormalPoints', width: 90, render: (v: number) => <b style={{ color: v > 0 ? 'var(--semi-color-danger)' : undefined }}>{v}</b> },
            { title: '审核人', dataIndex: 'reviewedBy', width: 100 },
            { title: '审核时间', dataIndex: 'reviewedAt', width: 170 },
            {
              title: '操作', width: 150,
              render: (_: any, r: any) => (
                <Space>
                  <Button size="small" theme="borderless" onClick={async () => {
                    const d = await httpGet<any>(`/api/patrol/report/${r.id}`).catch(() => r);
                    setDetail(d || r);
                  }}>详情</Button>
                  {hasPerm('patrol.report', 'export') && (
                    <Button size="small" theme="borderless" icon={<IconDownload />} onClick={() => exportReport(r)}>导出</Button>
                  )}
                </Space>
              ),
            },
          ]}
        />

        <Modal title={`报告详情 · ${detail?.name ?? ''}`} visible={!!detail} onCancel={() => setDetail(null)} footer={null} width={680}>
          {detail && (
            <>
              <Descriptions row size="small" data={[
                { key: '任务名称', value: detail.taskName },
                { key: '完成时间', value: detail.finishedAt },
                { key: '点位总数', value: detail.totalPoints },
                { key: '正常', value: detail.normalPoints ?? (detail.totalPoints ?? 0) - (detail.abnormalPoints ?? 0) },
                { key: '异常', value: detail.abnormalPoints },
                { key: '审核人', value: detail.reviewedBy || '-' },
              ]} />
              <div className="text-muted" style={{ fontSize: 12, margin: '10px 0 6px' }}>异常点位明细</div>
              <Table size="small" pagination={false} dataSource={detail.abnormalList || []}
                empty="无异常点位"
                columns={[
                  { title: '点位', dataIndex: 'waypointName' },
                  { title: '识别类型', dataIndex: 'identifyType' },
                  { title: '异常原因', dataIndex: 'anomalyReason', ellipsis: true },
                ]} />
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}
