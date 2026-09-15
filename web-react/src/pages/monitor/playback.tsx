import { useEffect, useRef, useState } from 'react';
import { Card, Button, DatePicker, Toast, Table, Empty, Modal, Select } from '@douyinfe/semi-ui';
import { IconPlay } from '@douyinfe/semi-icons';
import ChannelTree, { TreeChannel } from '@/components/ChannelTree';
import VideoPlayer, { StreamInfo, VideoPlayerHandle } from '@/components/VideoPlayer';
import { get as httpGet } from '@/api/http';
import { analyzeAi } from '@/api/ai';
import AiResultView from '@/components/AiResultView';
import { parseDetections } from '@/utils/detections';
import dayjs from 'dayjs';

/**
 * 录像回放（WVP 直连）：
 * - 设备录像：/api/gb_record/query → /api/playback/start → 暂停/恢复/seek/倍速
 * - 云端录像：/api/cloud/record/list
 * - 下载：/api/gb_record/download/start + progress
 * - AI 识别：对正在播放的回放画面截图 → YOLO+VLM 分析（ingest/media，与手动识别同一管线）
 */
export default function PlaybackPage() {
  const [channel, setChannel] = useState<TreeChannel | null>(null);
  const [date, setDate] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [records, setRecords] = useState<any[]>([]);
  const [stream, setStream] = useState<StreamInfo | null>(null);
  const [cloudPlaying, setCloudPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const playerRef = useRef<VideoPlayerHandle | null>(null);

  // AI 识别（回放画面）
  const [schemes, setSchemes] = useState<any[]>([]);
  const [schemeId, setSchemeId] = useState<any>(undefined);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  useEffect(() => {
    httpGet<any[]>('/api/patrol/scheme/list').then((x) => {
      const list = Array.isArray(x) ? x : [];
      setSchemes(list);
      if (list.length > 0) setSchemeId(list[0].id);
    }).catch(() => {});
  }, []);

  /** 统一录像查询：厂商/国标设备录像（NVR 本机） + 平台录像（ZLM 存储节点）合并成一份列表，用户无感 */
  const queryRecords = async () => {
    if (!channel) {
      Toast.warning('请先选择通道');
      return;
    }
    setLoading(true);
    setStream(null);
    setCloudPlaying(false);
    const merged: any[] = [];
    // 1) 设备侧（NVR 本机 / 国标录像检索）
    try {
      const start = `${date} 00:00:00`;
      const end = `${date} 23:59:59`;
      const data = await httpGet<any>(
        `/api/gb_record/query/${channel.deviceId}/${channel.gbDeviceId ?? channel.deviceId}`,
        { startTime: start, endTime: end }
      );
      (data?.recordList || data || []).forEach((r: any) => merged.push({ ...r, _src: 'DEVICE' }));
    } catch { /* 设备侧无录像或未接入 */ }
    // 2) 平台侧（ZLM 存储节点 mp4）
    const s = cloudStreamOf(channel);
    if (s) {
      try {
        const data = await httpGet<any>('/api/cloud/record/list', { app: s.app, stream: s.stream, query: date, page: 1, count: 200 });
        const rows = (Array.isArray(data) ? data : data?.list) || [];
        rows.forEach((r: any) => merged.push({
          _src: 'ZLM', id: r.id, startTime: r.startTime, endTime: r.endTime,
          fileName: r.fileName, fileSize: r.fileSize, mediaServerId: r.mediaServerId,
        }));
      } catch { /* 平台侧无录像 */ }
    }
    merged.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
    setRecords(merged);
    setLoading(false);
    if (merged.length === 0) Toast.info('该日期没有录像');
  };

  const playRecord = async (rec: any) => {
    if (!channel) return;
    // 平台录像（ZLM 存储节点）走文件点播；设备录像（NVR 本机）走国标回放
    if (rec._src === 'ZLM') {
      await playCloud(rec);
      return;
    }
    setLoading(true);
    setCloudPlaying(false);
    try {
      const startTime = rec.startTime ?? `${date} 00:00:00`;
      const endTime = rec.endTime ?? `${date} 23:59:59`;
      const data = await httpGet<any>(
        `/api/playback/start/${channel.deviceId}/${channel.gbDeviceId ?? channel.deviceId}`,
        { startTime, endTime }
      );
      const s = (data && (data as any).streamInfo) || data;
      setStream(s);
    } finally {
      setLoading(false);
    }
  };

  const ctrl = (action: string, streamId?: string, param?: any) => {
    const sid = streamId ?? (stream?.streamId as string);
    if (!sid) return;
    httpGet(`/api/playback/${action}/${sid}`, param).catch(() => {});
  };

  /** 回放画面 AI 识别：截当前帧 → ingest/media（YOLO+VLM，与手动识别同一管线） */
  const doAi = async () => {
    const shot = playerRef.current?.snapshot();
    if (!shot) {
      Toast.error('未能抓取画面，请等视频播放出来再试');
      return;
    }
    if (!schemeId) {
      Toast.warning('请先选择识别方案（智能算法页配置）');
      return;
    }
    setAnalyzing(true);
    try {
      const r = await analyzeAi({ source: 'IMAGE', image: shot, schemeId });
      setAiResult(r || {});
      Toast.success(`识别完成：${r?.result === 'NORMAL' ? '正常' : r?.result === 'ABNORMAL' ? '异常' : r?.result || ''}`);
    } catch (e: any) {
      Toast.error(e?.message || '识别失败');
    } finally {
      setAnalyzing(false);
    }
  };



  /** 通道对应的 ZLM 录像流标识：拉流代理=live/{streamId}；国标=rtp/{deviceId}_{gbDeviceId} */
  const cloudStreamOf = (ch: TreeChannel | null): { app: string; stream: string } | null => {
    if (!ch) return null;
    if (ch.dataType === 3) {
      if (!ch.streamId) return null;
      return { app: 'live', stream: ch.streamId };
    }
    return { app: 'rtp', stream: `${ch.deviceId}_${ch.gbDeviceId ?? ch.deviceId}` };
  };



  /** 播放平台录像 mp4：WVP 把文件加载进 ZLM 形成点播流 */
  const playCloud = async (rec: any) => {
    const s = cloudStreamOf(channel);
    if (!s) return;
    setLoading(true);
    try {
      const data = await httpGet<any>('/api/cloud/record/loadRecord', { app: s.app, stream: s.stream, cloudRecordId: rec.id });
      const content = (data && (data as any).streamInfo) ? data : (data && (data as any).data) || data;
      const si = (content && (content as any).streamInfo) || content;
      setStream(si);
      setCloudPlaying(true);
      Toast.success('已加载平台录像');
    } catch { /* 请求层已提示 */ } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <div style={{ width: 250, borderRight: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
        <ChannelTree onSelect={(ch) => setChannel(ch)} />
      </div>

      <div style={{ flex: 1, padding: 12, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card size="small">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>通道：{channel?.name || '未选择'}</span>
            <DatePicker type="date" value={date} onChange={(d: any) => setDate(dayjs(d).format('YYYY-MM-DD'))} />
            <Button size="small" theme="solid" onClick={queryRecords} loading={loading}>查询录像</Button>
          </div>
        </Card>

        <div className="video-cell" style={{ height: 380 }}>
          <div className="video-cell-header">
            <span>回放画面</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Select size="small" style={{ width: 180 }} placeholder="识别方案" value={schemeId}
                onChange={(v: any) => setSchemeId(v)}
                optionList={schemes.map((s) => ({ value: s.id, label: s.name }))} />
              <Button size="small" theme="solid" type="primary" icon={<IconPlay />} loading={analyzing}
                disabled={!stream} onClick={doAi}>AI识别</Button>
            </span>
            {stream && cloudPlaying && (
              <Button size="small" theme="borderless" onClick={() => { setStream(null); setCloudPlaying(false); }}>停止</Button>
            )}
            {stream && !cloudPlaying && (
              <span style={{ display: 'flex', gap: 6 }}>
                <Button size="small" theme="borderless" onClick={() => ctrl('pause')}>暂停</Button>
                <Button size="small" theme="borderless" onClick={() => ctrl('resume')}>恢复</Button>
                <Button size="small" theme="borderless" onClick={() => ctrl('seek', undefined, { seekTime: Math.floor(Date.now() / 1000) - 3600 })}>快进</Button>
                <Button size="small" theme="borderless" onClick={() => ctrl('speed', undefined, { speed: 4 })}>4x</Button>
                <Button size="small" theme="borderless" onClick={() => ctrl('stop')}>停止</Button>
              </span>
            )}
          </div>
          <div className="video-cell-body">
            {stream ? <VideoPlayer ref={playerRef} streamInfo={stream} /> : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#5a6b85', fontSize: 12 }}>
                选择通道并点击录像进行回放
              </div>
            )}
          </div>
        </div>

        <Card size="small" title={`录像（${records.length}）`}>
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>
            该通道的录像已合并展示（含本机硬盘与平台存储），无需区分来源，点击即可回放。
          </div>
          {records.length === 0 ? (
            <Empty description="暂无录像。选通道+日期后点「查询录像」；平台录像需先在摄像机台账开启" />
          ) : (
            <Table
              size="small"
              pagination={{ pageSize: 20 }}
              dataSource={records}
              rowKey={(r: any) => `${r._src}-${r.id ?? r.startTime}`}
              columns={[
                { title: '开始时间', dataIndex: 'startTime', render: (v: any) => fmtRecTime(v) },
                { title: '结束时间', dataIndex: 'endTime', render: (v: any) => fmtRecTime(v) },
                {
                  title: '时长', width: 90,
                  render: (_: any, r: any) => {
                    const s = Number(r.startTime), e = Number(r.endTime);
                    if (!s || !e) return '-';
                    const sec = Math.max(0, Math.round((e - s) / 1000));
                    return `${Math.floor(sec / 60)}分${sec % 60}秒`;
                  },
                },
                {
                  title: '大小', width: 100,
                  render: (_: any, r: any) => (r.fileSize ? `${(Number(r.fileSize) / 1024 / 1024).toFixed(1)} MB` : '-'),
                },
                {
                  title: '操作', width: 120,
                  render: (_: any, rec: any) => (
                    <Button size="small" theme="solid" type="primary" onClick={() => playRecord(rec)}>回放</Button>
                  ),
                },
              ]}
            />
          )}
        </Card>

        {/* 回放画面 AI 识别结果（统一渲染组件） */}
        <Modal title="回放画面 AI 识别" visible={!!aiResult} onCancel={() => setAiResult(null)} footer={null} width={720}>
          {aiResult && <AiResultView data={{ ...aiResult, mediaUrl: aiResult.mediaUrl || aiResult.url }} />}
        </Modal>
      </div>
    </div>
  );
}

function fmtRecTime(v: any): string {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : (String(v).includes('-') ? Date.parse(String(v).replace(' ', 'T')) : Number(v));
  if (!n || Number.isNaN(n)) return String(v);
  return new Date(n).toLocaleString('zh-CN', { hour12: false });
}
