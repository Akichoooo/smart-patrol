import { useEffect, useState } from 'react';
import { Tabs, TabPane, Card, Table, Tag, Button, Descriptions, Typography, Toast } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { get as httpGet } from '@/api/http';
import ReactECharts from 'echarts-for-react';

/** 设置 → 系统：平台信息 | 运行日志（WVP 直连） */
export default function SystemPage() {
  const [info, setInfo] = useState<any>(null);
  const [logFiles, setLogFiles] = useState<any[]>([]);
  const [logText, setLogText] = useState<string>('');
  const [resInfo, setResInfo] = useState<any>(null);

  const load = async () => {
    const [i, files, res] = await Promise.all([
      httpGet<any>('/api/server/system/info').catch(() => null),
      httpGet<any[]>('/api/log/list').then((x) => (Array.isArray(x) ? x : x?.list ?? [])).catch(() => []),
      httpGet<any>('/api/server/resource/info').catch(() => null),
    ]);
    setInfo(i);
    setLogFiles(files || []);
    setResInfo(res);
  };
  useEffect(() => { load(); }, []);

  const openLog = async (f: any) => {
    const name = typeof f === 'string' ? f : (f.fileName ?? f.name);
    const text = await httpGet<string>(`/api/log/file/${name}`, {}, { responseType: 'text' }).catch(() => '日志读取失败');
    setLogText(String(text ?? '').slice(-50000));
  };

  return (
    <div className="page-root">
      <div className="page-body">
        <Tabs type="line">
          <TabPane tab="平台信息" itemKey="info">
            <SpaceButtons onRefresh={load} />
            {info && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Card size="small" title="基础信息">
                  <Descriptions row size="small" data={[
                    { key: '平台版本', value: info.version ?? '-' },
                    { key: '系统', value: `${info.os?.name ?? '-'} ${info.os?.arch ?? ''}` },
                    { key: 'CPU', value: `${info.os?.cpu?.intel ?? info.os?.cpu?.amd ?? '-'}` },
                    { key: '运行时间', value: info.os?.uptime ?? '-' },
                    { key: '创建时间', value: info.createTime ?? '-' },
                  ]} />
                </Card>
                {resInfo && (
                  <Card size="small" title="资源占用">
                    <ReactECharts style={{ height: 220 }} option={{
                      tooltip: { trigger: 'item' },
                      series: [{
                        type: 'pie', radius: ['45%', '70%'],
                        data: [
                          { name: '已用内存(MB)', value: resInfo.memory?.used ?? 0, itemStyle: { color: '#4e7cff' } },
                          { name: '空闲内存(MB)', value: Math.max(0, (resInfo.memory?.total ?? 0) - (resInfo.memory?.used ?? 0)), itemStyle: { color: 'rgba(140,150,165,0.3)' } },
                        ],
                      }],
                    }} />
                  </Card>
                )}
              </div>
            )}
          </TabPane>
          <TabPane tab="运行日志" itemKey="logs">
            <SpaceButtons onRefresh={load} />
            <Table size="small" dataSource={logFiles} pagination={false} empty="暂无日志文件"
              columns={[
                { title: '日志文件', dataIndex: 'fileName', render: (v: string, r: any) => v ?? r.name ?? String(r) },
                {
                  title: '操作', width: 100,
                  render: (_: any, r: any) => <Button size="small" onClick={() => openLog(r)}>查看</Button>,
                },
              ]} />
            {logText && (
              <Card size="small" title="日志内容（尾部）" style={{ marginTop: 12 }}>
                <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 420, overflow: 'auto' }}>{logText}</pre>
              </Card>
            )}
          </TabPane>
        </Tabs>
      </div>
    </div>
  );
}

function SpaceButtons({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Button icon={<IconRefresh />} onClick={onRefresh}>刷新</Button>
    </div>
  );
}
