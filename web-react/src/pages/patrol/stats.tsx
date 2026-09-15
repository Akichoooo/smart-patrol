import { useEffect, useState } from 'react';
import { Card, Tabs, TabPane, Table, Select, DatePicker, Button, Space, Typography, Tag } from '@douyinfe/semi-ui';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { get as httpGet } from '@/api/http';
import { RingIndicator } from '@/components/StatWidgets';

/**
 * 查询统计（对齐旧平台：可靠性分析统计 / 任务执行情况统计 / 数据分析曲线 历史/常规/自定义）。
 * 曲线数据源：patrol_point_reading 结构化读数。
 */
export default function StatsPage() {
  const [reliability, setReliability] = useState<any>({});
  const [rings, setRings] = useState<any[]>([]);
  const [execStats, setExecStats] = useState<any[]>([]);
  const [waypoints, setWaypoints] = useState<any[]>([]);
  const [curve, setCurve] = useState<any[]>([]);
  const [wp, setWp] = useState<number | undefined>();
  const [days, setDays] = useState(30);

  const loadReliability = async () => {
    const d = await httpGet<any>('/api/patrol/stats/reliability').catch(() => null);
    if (d) {
      setReliability(d);
      setRings(d.rings || []);
    }
  };
  const loadExec = async () => {
    const d = await httpGet<any[]>('/api/patrol/stats/execution').catch(() => []);
    setExecStats(d || []);
  };
  const loadCurve = async () => {
    if (!wp) return;
    const d = await httpGet<any[]>('/api/patrol/stats/curve/history', { waypointId: wp, days }).catch(() => []);
    setCurve(d || []);
  };

  useEffect(() => {
    loadReliability();
    loadExec();
    httpGet<any[]>('/api/patrol/waypoint/list').then((l) => setWaypoints(l || [])).catch(() => {});
  }, []);

  useEffect(() => { loadCurve(); }, [wp, days]);

  const val = (v: any, unit: string) => (v === null || v === undefined ? '未采集' : `${v}${unit}`);
  const reliabilityCards = [
    ['正常巡检天数', val(reliability.normalDays, '天')],
    ['累计连续正常运行天数', val(reliability.continuousDays, '天')],
    ['录像完整率', val(reliability.recordRate, '%')],
    ['累计离线次数', val(reliability.offlineCount, '次')],
    ['累计在线时长', val(reliability.onlineHours, '小时')],
    ['出勤率', val(reliability.attendanceRate, '%')],
  ];

  return (
    <div className="page-root">
      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
        <Tabs type="line">
          {/* 可靠性分析统计 */}
          <TabPane tab="可靠性分析统计" itemKey="reliability">
            <Card size="small" title="运行可靠性" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {reliabilityCards.map(([t, v]: any) => (
                  <Card key={t} size="small" style={{ flex: 1, minWidth: 150 }} bodyStyle={{ padding: '10px 14px' }}>
                    <div className="text-muted" style={{ fontSize: 12 }}>{t}</div>
                    <div className="stat-card-value" style={{ fontSize: v === '未采集' ? 16 : undefined }}>{v}</div>
                  </Card>
                ))}
              </div>
            </Card>
            <Card size="small" title="巡视结果统计查询">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'space-around', padding: 10 }}>
                {(rings.length
                  ? rings
                  : [
                      { title: '巡视点位漏检率', percent: null },
                      { title: '巡视告警人工审核完成率', percent: null },
                      { title: '巡视告警准确率', percent: null },
                      { title: '巡视结果人工审核完成率', percent: null },
                      { title: '任务执行闭环率', percent: null },
                    ]
                ).map((r: any, i: number) => (
                  <RingIndicator key={i} title={r.title} percent={r.percent === null || r.percent === undefined ? null : Math.round(r.percent)} />
                ))}
              </div>
            </Card>
          </TabPane>

          {/* 任务执行情况统计 */}
          <TabPane tab="任务执行情况统计" itemKey="execution">
            <Table
              size="small"
              dataSource={execStats}
              pagination={false}
              empty="暂无任务执行数据"
              columns={[
                { title: '任务', dataIndex: 'taskName' },
                { title: '执行次数', dataIndex: 'execCount' },
                { title: '成功', dataIndex: 'successCount', render: (v: number) => <Tag color="green">{v ?? 0}</Tag> },
                { title: '失败', dataIndex: 'failedCount', render: (v: number) => <Tag color={v ? 'red' : 'grey'}>{v ?? 0}</Tag> },
                { title: '点位总数', dataIndex: 'totalPoints' },
                { title: '异常数', dataIndex: 'abnormalPoints' },
                { title: '平均耗时', dataIndex: 'avgCostSeconds', render: (v: number) => `${Math.round(v ?? 0)}s` },
              ]}
            />
          </TabPane>

          {/* 数据分析曲线 */}
          <TabPane tab="曲线分析" itemKey="curve">
            <Card size="small" title="点位读数历史曲线（VLM 表计读数 · patrol_point_reading）">
              <Space style={{ marginBottom: 10 }}>
                <Select
                  placeholder="选择点位"
                  value={wp}
                  onChange={setWp}
                  style={{ width: 240 }}
                  showClear
                  optionList={waypoints.filter((w: any) => w.partName?.includes('表') || w.name?.includes('表')).map((w: any) => ({ value: w.id, label: w.name }))}
                />
                <Select value={days} onChange={setDays} style={{ width: 120 }}
                  optionList={[{ value: 7, label: '近7天' }, { value: 30, label: '近30天' }, { value: 90, label: '近90天' }]} />
                <Button theme="solid" onClick={loadCurve}>查询</Button>
              </Space>
              <ReactECharts
                style={{ height: 300 }}
                option={{
                  tooltip: { trigger: 'axis' },
                  grid: { top: 30, left: 50, right: 20, bottom: 30 },
                  xAxis: { type: 'category', data: curve.map((x: any) => x.recordedAt) },
                  yAxis: { type: 'value' },
                  series: [{ type: 'line', smooth: true, data: curve.map((x: any) => x.valueNum), areaStyle: { opacity: 0.15 }, itemStyle: { color: '#4e7cff' } }],
                }}
              />
              {curve.length === 0 && (
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', textAlign: 'center' }}>
                  暂无读数数据：执行含「表计读数」识别方案的任务后，VLM 读数将自动落入曲线
                </Typography.Text>
              )}
            </Card>
          </TabPane>
        </Tabs>
      </div>
    </div>
  );
}
