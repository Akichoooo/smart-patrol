import { useEffect, useRef, useState } from 'react';
import { Button, RadioGroup, Radio, Toast, Tag, Modal, Space, Select } from '@douyinfe/semi-ui';
import { IconCamera, IconClose, IconMenu, IconVideo } from '@douyinfe/semi-icons';
import ChannelTree, { TreeChannel } from '@/components/ChannelTree';
import VideoPlayer, { StreamInfo, VideoPlayerHandle } from '@/components/VideoPlayer';
import PtzPanel from '@/components/PtzPanel';
import { get as httpGet, withTimeout } from '@/api/http';
import { analyzeAi } from '@/api/ai';
import AiResultView from '@/components/AiResultView';
import { EmptyHint } from '@/components/ui';
import { fetchPullingMap } from '@/api/pulling';
import { useAuthStore } from '@/store/auth';

interface Cell {
  channel: TreeChannel | null;
  stream: StreamInfo | null;
  loading: boolean;
  tip?: string;
  /** 当前播放的码流：sd=子码流(通道载体) hd=临时主码流(仅观看，无人看自动回收) */
  streamKind?: 'sd' | 'hd';
}

const LAYOUTS = [
  { key: 1, cols: '1fr', label: '单屏' },
  { key: 4, cols: '1fr 1fr', label: '4分屏' },
  { key: 9, cols: '1fr 1fr 1fr', label: '9分屏' },
  { key: 16, cols: '1fr 1fr 1fr 1fr', label: '16分屏' },
];

/** 视频监控（WVP 直连）：通道树 + 宫格播放 + 云台 + 预置位
 * 布局范式对齐商业 VMS（Genetec/HikCentral）：左树右墙、分屏器靠右、
 * 黄框=选中格、空格=灰底引导、格子态（拉流中/失败）提示居中显示。
 */
export default function VideoMonitorPage() {
  const [cells, setCells] = useState<Cell[]>([{ channel: null, stream: null, loading: false }]);
  const [split, setSplit] = useState(4);
  const [activeIdx, setActiveIdx] = useState(0);
  const [treeOpen, setTreeOpen] = useState(true);
  const [ai, setAi] = useState<any>(null); // 单帧研判 {idx, shot, data, analyzing, schemeId}
  const [ptzOpen, setPtzOpen] = useState(true);
  const [pullMap, setPullMap] = useState<Record<string, boolean>>({});
  const [schemes, setSchemes] = useState<any[]>([]);
  const playerRefs = useRef<Array<VideoPlayerHandle | null>>([]);

  const refreshPulling = () => fetchPullingMap().then(setPullMap);
  useEffect(() => { refreshPulling(); }, []);
  useEffect(() => {
    httpGet<any[]>('/api/patrol/scheme/list').then((x) => {
      const list = Array.isArray(x) ? x : [];
      setSchemes(list);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setCells((prev) => {
      const next = Array.from({ length: split }, (_, i) => prev[i] ?? { channel: null, stream: null, loading: false });
      return next;
    });
  }, [split]);

  /** 台账「播放」跳转：?channelId=（库内通道ID）→ 自动定位并播放 */
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('channelId');
    if (!id) return;
    httpGet<any>('/api/common/channel/list', { page: 1, count: 500 })
      .then((x) => (Array.isArray(x) ? x : x?.list ?? []))
      .then((list: any[]) => {
        const row = (list || []).find((c) => String(c.gbId) === String(id));
        if (row) {
          playChannel({
            id: row.gbId,
            deviceId: row.deviceId ?? row.dataDeviceId,
            deviceIdStr: row.gbDeviceId,
            name: row.name || row.gbName || String(row.gbId),
            gbName: row.gbName,
            gbDeviceId: row.gbDeviceId,
            status: row.status ?? row.gbStatus ?? 'OFF',
            dataType: row.dataType,
            streamId: row.streamId,
          } as TreeChannel, 0);
        } else {
          Toast.warning('未找到该通道，请从左侧通道树选择');
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 播放：统一走通道接口（拉流代理 / 国标通道都在里面分派） */
  const playChannel = async (ch: TreeChannel, idx = activeIdx) => {
    const dbId = (ch as any).id;
    setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, channel: ch, stream: null, loading: true, tip: '正在拉流...' } : c)));
    try {
      // 以前失败后会回退 /api/play/start/{deviceId}/{channelId}，但国标通道的父设备号
      // 在通道接口里拿不到（只下发数值 dataDeviceId），回退必然拼出错误 URL，
      // 把真实的"收流超时"掩盖成"设备不存在"。统一接口本就覆盖国标，直接去掉这个回退。
      const data = await httpGet<any>('/api/common/channel/play', { channelId: dbId });
      const stream = (data && (data as any).streamInfo) || data;
      // 回写前确认这格还在播这一路：期间被关闭（channel=null）或换了别的通道就丢弃，避免"关闭后画面复活"
      setCells((prev) => prev.map((c, i) => (i === idx && c.channel && (c.channel as any).id === dbId ? { ...c, stream, loading: false, tip: undefined } : c)));
      // 播放会触发按需拉流，几秒后刷新拉流状态（树/角标用）
      setTimeout(refreshPulling, 2500);
    } catch (e: any) {
      // 如实透出后端原因（收流超时/设备无应答…），不再用固定文案盖掉它；已被关闭的格子不写 tip
      const stillThis = (c: Cell) => !!c.channel && (c.channel as any).id === dbId;
      const gb = (ch as any)?.dataType === 1;
      const reason = e?.message || '通道离线或不支持';
      const tip = gb
        ? `国标点播失败：${reason}。同一台设备同时只允许一路取流，先停掉其它画面再试`
        : `拉流失败: ${reason}`;
      Toast.warning(tip);
      setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, loading: false, tip: stillThis(c) ? tip : c.tip } : c)));
    }
  };

  const stopChannel = (idx: number) => {
    // 先取快照再清状态（channel/stream/tip/loading 全清，别留半残状态让关闭后的格子在
    // 在途播放请求回来时"复活"成拉流中/失败态）；停流失败也不阻塞 UI，下次播放会顶掉旧流
    const cell = cells[idx];
    const dbId = (cell?.channel as any)?.id;
    setCells((prev) => prev.map((c, i) => (i === idx ? { channel: null, stream: null, loading: false, tip: undefined, streamKind: undefined } : c)));
    if (dbId != null) {
      httpGet('/api/common/channel/play/stop', { channelId: dbId }).catch(() => {});
    }
  };

  /** 码流切换（拉流代理通道）：高清=按需起临时主码流（无人观看自动回收）；标清=回到通道载体的子码流 */
  const switchStream = async (idx: number, hd: boolean) => {
    const cell = cells[idx];
    const dbId = (cell?.channel as any)?.id;
    if (!dbId) return;
    setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, loading: true, tip: hd ? '正在切换到高清主码流…' : '正在切换到标清子码流…' } : c)));
    try {
      let streamInfo: StreamInfo;
      if (hd) {
        const r = await httpGet<any>('/api/patrol/access/channel/play-stream', { channelId: dbId, hd: 1 });
        const ws = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${r.path}`;
        streamInfo = { ws_flv: ws, streamId: r.stream };
      } else {
        const data = await httpGet<any>('/api/common/channel/play', { channelId: dbId });
        streamInfo = ((data && (data as any).streamInfo) || data) as StreamInfo;
      }
      setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, stream: streamInfo, loading: false, streamKind: hd ? 'hd' : 'sd' } : c)));
    } catch (e: any) {
      setCells((prev) => prev.map((c, i) => (i === idx ? { ...c, loading: false } : c)));
      Toast.error(e?.message || '码流切换失败');
    }
  };

  /** 单帧智能研判：截当前画面 → 统一AI检测入口（YOLO+VLM） */
  const openInstantAi = (idx: number) => {
    const cell = cells[idx];
    if (!cell?.channel || !cell.stream) {
      Toast.warning('请先在当前画面播放一路视频');
      return;
    }
    const shot = playerRefs.current[idx]?.snapshot();
    if (!shot) {
      Toast.error('未能抓取画面，请等视频播放出来再试');
      return;
    }
    setAi({ idx, shot, data: null, analyzing: false, schemeId: schemes[0]?.id });
  };

  const runInstantAi = async () => {
    if (!ai) return;
    if (!ai.schemeId) { Toast.warning('请先选择识别方案'); return; }
    setAi((s: any) => ({ ...s, analyzing: true }));
    try {
      const r = await withTimeout(
        analyzeAi({ source: 'IMAGE', image: ai.shot, schemeId: ai.schemeId, label: cells[ai.idx]?.channel?.name }),
        60000, '识别');
      setAi((s: any) => ({ ...s, data: r, analyzing: false }));
    } catch (e: any) {
      Toast.error(e?.message || '识别失败');
      setAi((s: any) => ({ ...s, analyzing: false }));
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 工具栏：左侧树开关 + 画面计数；右侧分屏器 + 云台开关（商业 VMS：分屏器在右上） */}
      <div className="flex-between" style={{ padding: '6px 10px', borderBottom: '1px solid var(--semi-color-border)', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Button icon={<IconMenu />} size="small" theme="borderless" onClick={() => setTreeOpen((v) => !v)}>
            通道树
          </Button>
          <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            播放中 {cells.filter((c) => c.stream).length}/{cells.length} · 点击格子选中（黄框），双击通道树播放
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button size="small" theme="borderless" onClick={() => setPtzOpen((v) => !v)}>云台</Button>
          <RadioGroup type="button" size="small" value={split} onChange={(e) => setSplit(e.target.value as number)}>
            {LAYOUTS.map((l) => (
              <Radio key={l.key} value={l.key}>{l.label}</Radio>
            ))}
          </RadioGroup>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左：通道树 */}
        <div
          style={{
            width: treeOpen ? 250 : 0,
            flexShrink: 0,
            borderRight: '1px solid var(--semi-color-border)',
            overflow: 'hidden',
            transition: 'width .2s',
          }}
        >
          <ChannelTree onSelect={(ch) => playChannel(ch, activeIdx)} />
        </div>

        {/* 中：宫格 */}
        <div style={{ flex: 1, padding: 6, background: '#0a0f16', overflow: 'hidden' }}>
          <div className="video-grid" style={{ gridTemplateColumns: LAYOUTS.find((l) => l.key === split)!.cols, gridTemplateRows: `repeat(${Math.sqrt(split)}, 1fr)` }}>
            {cells.map((cell, idx) => {
              const idle = !cell.channel && !cell.loading;
              const playing = !idle && !cell.loading && !cell.tip;
              return (
                <div key={idx} className={`video-cell ${idx === activeIdx ? 'active' : ''} ${idle ? 'idle' : ''} ${playing ? 'playing' : ''}`} onClick={() => setActiveIdx(idx)}>
                  <div className="video-cell-header">
                    <span className="video-cell-title">{cell.channel?.name ?? `画面 ${idx + 1}`}</span>
                    <span className="video-cell-actions">
                      {cell.loading && <Tag size="small" color="blue">拉流中</Tag>}
                      {/* 拉流代理通道按 proxy pulling 显示拉流中/未拉流；国标/推流通道按注册状态显示在线/离线 */}
                      {cell.channel && (cell.channel.dataType === 3
                        ? <Tag size="small" color={pullMap[`live/${cell.channel.streamId ?? ''}`] ? 'green' : 'grey'}>{pullMap[`live/${cell.channel.streamId ?? ''}`] ? '拉流中' : '未拉流'}</Tag>
                        : <Tag size="small" color={cell.channel.status === 'ON' ? 'green' : 'grey'}>{cell.channel.status === 'ON' ? '在线' : '离线'}</Tag>)}
                      {/* 码流切换：仅拉流代理通道。标清=载体子码流；高清=临时主码流 */}
                      {cell.channel?.dataType === 3 && cell.stream && (
                        <RadioGroup type="button" size="small" buttonSize="small" value={cell.streamKind ?? 'sd'}
                          onChange={(e: any) => switchStream(idx, e.target.value === 'hd')}>
                          <Radio value="sd">标清</Radio>
                          <Radio value="hd">高清</Radio>
                        </RadioGroup>
                      )}
                      {cell.stream && (
                        <Button size="small" theme="solid" type="primary"
                          onClick={() => { setActiveIdx(idx); openInstantAi(idx); }}>AI研判</Button>
                      )}
                      {cell.channel && <IconClose style={{ cursor: 'pointer' }} onClick={(e: any) => { e.stopPropagation(); stopChannel(idx); }} />}
                    </span>
                  </div>
                  <div className="video-cell-body">
                    {cell.stream ? (
                      <VideoPlayer ref={(el: VideoPlayerHandle | null) => { playerRefs.current[idx] = el; }} streamInfo={cell.stream} />
                    ) : cell.loading ? (
                      <div className="cell-center-tip">
                        <IconVideo size="extra-large" style={{ opacity: 0.35 }} />
                        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>正在拉流：{cell.channel?.name}</span>
                        <span className="text-muted" style={{ fontSize: 11, opacity: 0.7 }}>首次拉流约需 3~10 秒</span>
                      </div>
                    ) : cell.tip ? (
                      // 失败态：如实显示后端原因 + 下一步动作（channel 可能已被关闭置空，重试前判空）
                      <div className="cell-center-tip">
                        <IconCamera size="extra-large" style={{ opacity: 0.3, color: 'var(--semi-color-warning)' }} />
                        <span style={{ color: 'var(--semi-color-warning)', fontSize: 12, maxWidth: '92%' }}>{cell.tip}</span>
                        {cell.channel && (
                          <Button size="small" theme="borderless" type="primary"
                            onClick={(e: any) => { e.stopPropagation(); playChannel(cell.channel!, idx); }}>重试</Button>
                        )}
                      </div>
                    ) : (
                      // 空闲格：引导下一步（商业 VMS gray tile）
                      <div className="cell-center-tip">
                        <IconCamera size="extra-large" style={{ opacity: 0.25 }} />
                        <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>空闲画面</span>
                        <span className="text-muted" style={{ fontSize: 11, opacity: 0.7 }}>在左侧通道树双击摄像机开始播放</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右：云台/预置位 */}
        <div
          style={{
            width: ptzOpen ? 240 : 0,
            flexShrink: 0,
            borderLeft: '1px solid var(--semi-color-border)',
            overflow: 'auto',
            padding: ptzOpen ? 10 : 0,
            transition: 'width .2s',
          }}
        >
          {ptzOpen && <PtzPanel channel={cells[activeIdx]?.channel ?? null} />}
        </div>
      </div>

      {/* 单帧智能研判（统一AI检测入口：截图 → YOLO+VLM） */}
      <Modal title={`单帧智能研判 · ${cells[ai?.idx ?? 0]?.channel?.name ?? ''}`} visible={!!ai}
        onCancel={() => setAi(null)} footer={null} width={1000}>
        {ai && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Space>
              <Select size="small" style={{ width: 220 }} placeholder="识别方案" value={ai.schemeId}
                onChange={(v: any) => setAi((s: any) => ({ ...s, schemeId: v }))}
                optionList={schemes.map((s) => ({ value: s.id, label: s.name }))} />
              <Button theme="solid" type="primary" loading={ai.analyzing} onClick={runInstantAi}>开始识别</Button>
              {ai.analyzing && <span className="text-muted" style={{ fontSize: 12 }}>正在抓帧分析（YOLO + 大模型复核，约 10~30 秒）…</span>}
            </Space>
            {ai.data
              ? <AiResultView data={ai.data} image={ai.shot} />
              : (
                /* 识别前的预览：限高居中，否则竖构图照片会顶出一屏 */
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <img src={ai.shot} alt="当前画面"
                    style={{ maxWidth: '100%', maxHeight: '52vh', width: 'auto', objectFit: 'contain', borderRadius: 6, display: 'block' }} />
                </div>
              )}
          </div>
        )}
      </Modal>
    </div>
  );
}
