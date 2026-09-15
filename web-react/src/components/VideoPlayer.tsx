import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Spin, Tag } from '@douyinfe/semi-ui';

export interface StreamInfo {
  ws_flv?: string;
  flv?: string;
  hls?: string;
  rtc?: string;
  rtsp?: string;
  streamId?: string;
  mediaServerId?: string;
  [k: string]: any;
}

export interface VideoPlayerHandle {
  /** 抓取当前帧 JPEG base64（dataURL）。mpegts 走 video 元素，Jessibuca 走 canvas */
  snapshot: () => string | null;
}

/** Jessibuca WASM 解码器目录（public/static/js/jessibuca/，decoder.js 与 decoder.wasm 同目录） */
const JESSIBUCA_DECODER = '/static/js/jessibuca/decoder.js';

/**
 * 取 WebSocket-FLV 播放地址。
 * WVP 接口返回的是 ws_flv，但请求层 unwrap() 会把响应键统一转成 camelCase（ws_flv → wsFlv），
 * 只认 ws_flv 会让 play() 在守卫处静默 return——表现为"格子纯黑、无报错、连 video 元素都没有"。
 */
function pickWsFlv(s: StreamInfo | null | undefined): string | undefined {
  if (!s) return undefined;
  const anyS = s as any;
  return anyS.ws_flv || anyS.wsFlv || anyS.wss_flv || anyS.wssFlv || undefined;
}

/**
 * WVP 视频播放器：
 * - 默认 mpegts.js 播放 ws_flv（H.264）
 * - H.265 通道回退 Jessibuca（WASM 解码，全局脚本，index.html 引入）
 */
const VideoPlayer = forwardRef<VideoPlayerHandle, {
  streamInfo: StreamInfo | null;
  onClose?: () => void;
}>(function VideoPlayer({ streamInfo, onClose }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mpegtsRef = useRef<any>(null);
  const jessibucaRef = useRef<any>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle');
  const [engine, setEngine] = useState<string>('');

  useEffect(() => {
    let destroyed = false;

    function removeVideo() {
      if (videoRef.current) {
        try { videoRef.current.remove(); } catch { /* ignore */ }
        videoRef.current = null;
      }
    }

    function destroy() {
      if (mpegtsRef.current) {
        try { mpegtsRef.current.pause(); mpegtsRef.current.unload(); mpegtsRef.current.detachMediaElement(); mpegtsRef.current.destroy(); } catch { /* ignore */ }
        mpegtsRef.current = null;
      }
      if (jessibucaRef.current) {
        try { jessibucaRef.current.destroy(); } catch { /* ignore */ }
        jessibucaRef.current = null;
      }
      removeVideo();
    }

    function ensureJessibuca(): any {
      // jessibuca 为全局脚本（public/static/js/jessibuca/jessibuca.js，index.html 引入）
      if ((window as any).Jessibuca) return (window as any).Jessibuca;
      throw new Error('Jessibuca 未加载');
    }

    /** mpegts.js 播 ws_flv：必须在真实 <video> 上绑定，绑 div 会在 load() 抛错 */
    function startMpegts(mpegts: any, url: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const video = document.createElement('video');
        // 浏览器自动播放策略：非静音时 play() 会被拒（NotAllowedError）
        video.muted = true;
        video.defaultMuted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.background = '#000';
        videoRef.current = video;
        containerRef.current!.appendChild(video);

        const player = mpegts.createPlayer(
          { type: 'flv', isLive: true, url },
          { enableStashBuffer: false, stashInitialSize: 128, liveBufferLatencyChasing: true }
        );
        mpegtsRef.current = player;
        // 编码/网络类错误走事件回调（异步），只在这里兜住才不会静默黑屏
        player.on(mpegts.Events.ERROR, (errorType: string, detail: any) => {
          reject(new Error(`mpegts ${errorType}: ${detail?.info ?? detail?.code ?? ''}`));
        });
        player.attachMediaElement(video);
        player.load();
        player.play().then(() => resolve(), (e: any) => reject(e));
      });
    }

    /** 回退 Jessibuca（WASM），支持 H.265 */
    function startJessibuca(Jessibuca: any, url: string): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        // jessibuca 自带 canvas，先清掉 mpegts 留下的 video，避免盖住画面
        removeVideo();
        const jb = new Jessibuca({
          container: containerRef.current,
          videoBuffer: 0.1,
          isResize: true,
          // 默认 decoder 取相对当前页面的 decoder.js；在 /monitor 路由下会 404 拿到
          // index.html（控制台 "Unexpected token '<'"），必须显式指向静态目录
          decoder: JESSIBUCA_DECODER,
          autoWasm: true,
          loadingText: '加载中',
          debug: false,
        });
        jessibucaRef.current = jb;
        jb.on('error', (e: any) => reject(e instanceof Error ? e : new Error('Jessibuca 播放错误')));
        jb.play(url);
        // jessibuca 的播放是异步的，先按已起播处理，由 error 回调兜底
        resolve();
      });
    }

    async function play() {
      if (!containerRef.current) return;
      const url = pickWsFlv(streamInfo);
      if (!url) {
        // 不要静默 return：地址缺失时必须可见，否则只会看到一个没有任何提示的黑格子
        console.warn('没有可用的播放地址(ws-flv)', streamInfo);
        setStatus('error');
        return;
      }
      setStatus('loading');
      destroy();

      try {
        const mpegts = (await import('mpegts.js')).default;
        if (!mpegts.isSupported()) throw new Error('浏览器不支持 mpegts.js');
        await startMpegts(mpegts, url);
        if (!destroyed) {
          setEngine('mpegts.js ws-flv');
          setStatus('playing');
        }
        return;
      } catch (e) {
        console.warn('mpegts 播放失败，回退 Jessibuca', e);
      }

      try {
        const Jessibuca = ensureJessibuca();
        await startJessibuca(Jessibuca, url);
        if (!destroyed) {
          setEngine('Jessibuca (WASM H265)');
          setStatus('playing');
        }
      } catch (e2) {
        console.warn('Jessibuca 播放失败', e2);
        if (!destroyed) setStatus('error');
      }
    }

    if (streamInfo) play();
    else setStatus('idle');

    return () => {
      destroyed = true;
      destroy();
    };
  }, [streamInfo]);

  useImperativeHandle(ref, () => ({
    snapshot(): string | null {
      const root = containerRef.current;
      if (!root) return null;
      const video = root.querySelector('video') as HTMLVideoElement | null;
      if (video && video.videoWidth > 0) {
        const c = document.createElement('canvas');
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        c.getContext('2d')!.drawImage(video, 0, 0);
        return c.toDataURL('image/jpeg', 0.9);
      }
      const canvas = root.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas && canvas.width > 0) {
        try { return canvas.toDataURL('image/jpeg', 0.9); } catch { return null; }
      }
      return null;
    },
  }));

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#000' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }} />
      {status === 'loading' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" tip="正在拉取视频流..." />
        </div>
      )}
      {status === 'error' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>
          视频播放失败，请检查通道或稍后重试
        </div>
      )}
      {engine && (
        <Tag size="small" style={{ position: 'absolute', right: 6, bottom: 6, opacity: 0.75, pointerEvents: 'none' }}>
          {engine}
        </Tag>
      )}
    </div>
  );
});

export default VideoPlayer;
