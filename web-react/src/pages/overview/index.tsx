import { useEffect, useState } from 'react';
import { Card, Table, Tag, Spin, Tabs, TabPane, Typography, Progress } from '@douyinfe/semi-ui';
import ReactECharts from 'echarts-for-react';
import { get as httpGet } from '@/api/http';
import { StatCard, RingIndicator, LevelTag } from '@/components/StatWidgets';

/**
 * 信息总览（对齐旧平台综合看板）：
 * 变电站概况(装备数量+气象) / 地图 / 设备工况 / 巡视统计(本周今日/状态类型/按天柱状) /
 * 告警统计(近3/6/12月·一般/严重/危险) / 告警记录 / 缺陷统计
 * 数据源：GET /api/patrol/overview（后端聚合 WVP + patrol）
 */
export default function OverviewPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await httpGet<any>('/api/patrol/overview').catch(() => null);
        setData(d);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" /></div>;

  const o = data || {};
  const cams = o.cameras ?? { total: 0, online: 0 };
  const robots = o.robots ?? { total: 0, online: 0 };
  const drones = o.drones ?? { total: 0, online: 0 };
  const weather = o.weather ?? {};
  const patrolStats = o.patrol ?? { todayTotal: 0, todayFinished: 0, byStatus: {}, byDay: [], byType: {} };
  const alarmStats = o.alarms ?? { recent3: { GENERAL: 0, SERIOUS: 0, DANGER: 0 }, list: [] };
  const defects = o.defects ?? [];

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 变电站概况 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Card size="small" title="装备概况" style={{ flex: 3 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <StatCard title="摄像机" value={`${cams.online}/${cams.total}`} suffix="在拉流" />
            <StatCard title="机器人" value={`${robots.online}/${robots.total}`} suffix="在线" color="#0fd1b2" />
            <StatCard title="无人机" value={`${drones.online}/${drones.total}`} suffix="在线" color="#f7a336" />
            <StatCard title="巡检点位" value={o.waypoints ?? 0} suffix="个" color="#7c5cff" />
          </div>
        </Card>
        <Card size="small" title="站内环境" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 13 }}>
            <div>温度 {weather.temperature ?? '--'}℃</div>
            <div>湿度 {weather.humidity ?? '--'}%</div>
            <div>风速 {weather.windSpeed ?? '--'}m/s</div>
          </div>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
            气象数据可后续接入传感器装备档案扩展
          </Typography.Text>
        </Card>
      </div>

      {/* 地图占位（2D 电气图说明） */}
      <Card size="small" title="站区地图" headerExtraContent={<Tag size="small" color="grey">电子地图需底图数据</Tag>}>
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6b85', background: 'rgba(140,150,165,0.05)', borderRadius: 6 }}>
          电气接线图 / 点云底图待客户提供数据源后接入（方案文档第十二节已说明差距与接入方式）
        </div>
      </Card>

      {/* 巡视统计 + 设备工况 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Card size="small" title="巡视统计（本周）" style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
            <Progress percent={patrolStats.todayTotal ? (patrolStats.todayFinished / patrolStats.todayTotal) * 100 : 0} showInfo style={{ width: 160 }} />
            <span style={{ fontSize: 12 }}>
              今日 {patrolStats.todayFinished}/{patrolStats.todayTotal} 已完成
            </span>
          </div>
          <ReactECharts
            style={{ height: 180 }}
            option={{
              grid: { top: 24, left: 40, right: 10, bottom: 24 },
              tooltip: { trigger: 'axis' },
              xAxis: { type: 'category', data: (patrolStats.byDay || []).map((x: any) => x.day) },
              yAxis: { type: 'value' },
              series: [
                { name: '进行中', type: 'bar', stack: 't', data: (patrolStats.byDay || []).map((x: any) => x.running), itemStyle: { color: '#4e7cff' } },
                { name: '已完成', type: 'bar', stack: 't', data: (patrolStats.byDay || []).map((x: any) => x.finished), itemStyle: { color: '#0fd1b2' } },
                { name: '有异常', type: 'bar', stack: 't', data: (patrolStats.byDay || []).map((x: any) => x.abnormal), itemStyle: { color: '#f7a336' } },
              ],
            }}
          />
        </Card>

        <Card size="small" title="设备工况" style={{ flex: 1 }}>
          <Tabs type="line" size="small">
            {[
              ['摄像机', cams],
              ['机器人', robots],
              ['无人机', drones],
            ].map(([k, v]: any) => (
              <TabPane tab={k as string} itemKey={k as string} key={k}>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'space-around', padding: '12px 0' }}>
                  <RingIndicator title="在线率" percent={v.total ? Math.round((v.online / v.total) * 100) : 0} />
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6, fontSize: 12 }}>
                    <span>总数：{v.total}</span>
                    <span>在线：<b style={{ color: '#0fd1b2' }}>{v.online}</b></span>
                    <span>未拉流：<b style={{ color: '#f7a336' }}>{v.total - v.online}</b></span>
                  </div>
                </div>
              </TabPane>
            ))}
          </Tabs>
        </Card>
      </div>

      {/* 告警统计 + 告警记录 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <Card size="small" title="告警统计（近3个月）" style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
            {['GENERAL', 'SERIOUS', 'DANGER'].map((lv) => (
              <div key={lv} style={{ textAlign: 'center' }}>
                <LevelTag level={lv} />
                <div className="stat-card-value" style={{ marginTop: 6 }}>
                  {alarmStats.recent3?.[lv] ?? 0}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card size="small" title="最新告警记录" style={{ flex: 2 }}>
          <Table
            size="small"
            pagination={false}
            dataSource={alarmStats.list || []}
            empty="暂无告警"
            columns={[
              { title: '点位', dataIndex: 'waypointName' },
              { title: '等级', dataIndex: 'level', render: (v: string) => <LevelTag level={v} /> },
              { title: '描述', dataIndex: 'description', ellipsis: true },
              { title: '时间', dataIndex: 'alarmTime', width: 170 },
            ]}
          />
        </Card>
      </div>

      {/* 缺陷统计 */}
      <Card size="small" title="缺陷统计（最近转缺陷）">
        <Table
          size="small"
          pagination={false}
          dataSource={defects}
          empty="暂无缺陷记录"
          columns={[
            { title: '点位', dataIndex: 'waypointName' },
            { title: '巡视结果', dataIndex: 'result' },
            { title: '采集时间', dataIndex: 'capturedAt', width: 170 },
            { title: '转缺陷时间', dataIndex: 'defectTime', width: 170 },
          ]}
        />
      </Card>
    </div>
  );
}
