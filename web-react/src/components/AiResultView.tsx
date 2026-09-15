import { useRef, useState } from 'react';
import { Tag, Banner, Typography } from '@douyinfe/semi-ui';
import { IconChevronDown, IconChevronUp } from '@douyinfe/semi-icons';
import { parseDetections } from '@/utils/detections';
import { parseVlm, vlmErrorOf } from '@/utils/vlm';

/** 识别类型字典编码 → 中文（与后端 CompositeAnalyzer.mapScene 对应） */
const TYPE_LABEL: Record<string, string> = {
  general: '通用外观',
  meter_reading: '表计读数',
  indicator_light: '指示灯',
  switch_status: '空开状态',
  text_digit: '文字/数字',
};
/** 识别模式 → 中文 */
const MODE_LABEL: Record<string, string> = {
  yolo_vlm: 'YOLO 初筛 + VLM 复核',
  vlm_only: '仅 VLM 识别',
  yolo_only: '仅 YOLO 初筛',
};
/** YOLO 通用权重（COCO 80 类）→ 中文，展示侧翻译；没映射的保留原文 */
const LABEL_ZH: Record<string, string> = {
  person: '人', bicycle: '自行车', car: '汽车', motorcycle: '摩托车', bus: '公交车', truck: '卡车',
  'cell phone': '手机', laptop: '笔记本电脑', tv: '显示器', keyboard: '键盘', mouse: '鼠标',
  chair: '椅子', 'dining table': '餐桌', bottle: '瓶子', cup: '杯子', 'potted plant': '盆栽植物',
  book: '书', clock: '时钟', 'fire extinguisher': '灭火器', backpack: '背包', umbrella: '雨伞',
  'traffic light': '交通信号灯', 'stop sign': '停车标志', dog: '狗', cat: '猫', bird: '鸟',
};

const labelZh = (l: string) => LABEL_ZH[l] ? `${l} (${LABEL_ZH[l]})` : l;

function resultTag(result: string) {
  if (result === 'NORMAL') return <Tag color="green" size="large">正常</Tag>;
  if (result === 'ABNORMAL') return <Tag color="red" size="large">异常</Tag>;
  if (result === 'FAILED') return <Tag color="orange" size="large">识别失败</Tag>;
  return <Tag color="grey" size="large">{result || '未知'}</Tag>;
}

/** 面板小节标题：统一样式，替代之前多个 Card 的"一片一片"感 */
function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="flex-between" style={{ alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--semi-color-text-1)', whiteSpace: 'nowrap' }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** 检出目标行：hover 联动左侧框高亮 */
function DetectionRow({ d, idx, active, onHover }: {
  d: { label: string; confidence: number };
  idx: number; active: boolean;
  onHover: (i: number | null) => void;
}) {
  return (
    <div onMouseEnter={() => onHover(idx)} onMouseLeave={() => onHover(null)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 6, cursor: 'default',
        background: active ? 'rgba(252,206,20,.12)' : 'var(--semi-color-fill-0)',
        border: `1px solid ${active ? 'rgba(252,206,20,.45)' : 'transparent'}`,
        transition: 'background .12s',
      }}>
      <span style={{
        width: 8, height: 8, borderRadius: 2, flexShrink: 0,
        background: '#ff4d4f',
      }} />
      <span style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {labelZh(d.label)}
      </span>
      <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        {Math.round(d.confidence * 100)}%
      </span>
    </div>
  );
}

/**
 * AI 检测结果统一渲染（台账识别 / 观看单帧研判 / 回放识别共用）。
 * 布局对齐 Label Studio / Roboflow 的检测标注范式：
 *   左列 = 原始画面 + 检测框（占满可用高度）；
 *   右列 = 单一结果面板，从上到下：结论徽章 → 判定依据 → 检出目标 → 分项发现 → 大模型原文；
 *   引擎与参数（模型/阈值/耗时）收到底部一行小字，不与结果抢层级。
 */
export default function AiResultView({ data, image }: { data: any; image?: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [boxActive, setBoxActive] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [imgSize, setImgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  if (!data) return null;
  if (data.ok === false) {
    return <Banner type="danger" closeIcon={null} description={data.error || '识别失败'} />;
  }

  const rawYolo = data.yolo ?? data.yoloJson ?? data.yolo_json;
  const rawVlm = data.vlm ?? data.vlmJson ?? data.vlm_json;
  const detections = parseDetections(rawYolo);
  const vlm = parseVlm(rawVlm);
  const j = vlm.json;
  const src = image || data.mediaUrl || data.media_url;
  const identifyType = data.identifyType ?? data.identify_type;
  const identifySubType = data.identifySubType ?? data.identify_sub_type;
  const typeText = identifyType && identifyType !== 'null' ? (TYPE_LABEL[String(identifyType)] || identifyType) : '';
  const anomalyReason = data.anomalyReason ?? data.anomaly_reason;
  const findings: any[] = Array.isArray(j?.findings) ? j.findings : [];
  const lights: any[] = Array.isArray(j?.lights) ? j.lights : [];
  const switches: any[] = Array.isArray(j?.switches) ? j.switches : [];
  const readings: any[] = Array.isArray(data.readings) ? data.readings : [];
  const isVlmOnly = data.mode === 'vlm_only';
  const modelName = vlm.model || data.vlmModelName || data.vlm_model_name;
  const vlmError: string | null = vlmErrorOf(j);
  const thresholdPct = data.threshold != null ? Math.round(Number(data.threshold) * 100) : null;
  const costMs = data.costMs ?? data.cost_ms;
  const algoName = data.algoName ?? data.algo_name;
  const promptName = data.promptName ?? data.prompt_name;
  const mode = data.mode;

  // 底部引擎参数行：一行小字讲清"这次用什么跑的"，不再展开成大块面板
  const metaBits = [
    mode && (MODE_LABEL[String(mode)] || String(mode)),
    algoName && `算法 ${algoName}`,
    modelName && `模型 ${modelName}`,
    promptName && `提示词 ${promptName}`,
    thresholdPct != null && `阈值 ${thresholdPct}%`,
    costMs != null && `耗时 ${Math.round(Number(costMs) / 100) / 10}s`,
  ].filter(Boolean) as string[];

  // 检测框坐标：YOLO 给的是相对截帧原图的像素值，按图片自然尺寸换算成百分比（渲染尺寸天然自适应）
  const boxStyle = (b: { x1: number; y1: number; x2: number; y2: number }, i: number) => {
    if (!imgSize.w || !imgSize.h) return { display: 'none' };
    const active = boxActive === i;
    return {
      position: 'absolute' as const,
      boxSizing: 'border-box' as const,
      border: `${active ? 3 : 2}px solid ${active ? 'rgb(252,206,20)' : '#ff4d4f'}`,
      borderRadius: 2,
      left: `${(b.x1 / imgSize.w) * 100}%`, top: `${(b.y1 / imgSize.h) * 100}%`,
      width: `${((b.x2 - b.x1) / imgSize.w) * 100}%`, height: `${((b.y2 - b.y1) / imgSize.h) * 100}%`,
      boxShadow: active ? '0 0 0 2px rgba(252,206,20,.3)' : 'none',
      transition: 'border-color .12s',
    };
  };
  // 框标签贴框上沿；目标偏画面右侧/顶部的，标签收进框内，避免溢出裁切
  const boxLabel = (b: { x1: number; y1: number; x2: number; y2: number }, i: number) => {
    const active = boxActive === i;
    const putRight = imgSize.w > 0 && b.x1 / imgSize.w > 0.55;
    const putBottom = imgSize.h > 0 && b.y1 / imgSize.h < 0.03;
    return (
      <span style={{
        position: 'absolute',
        top: putBottom ? 2 : -18, bottom: putBottom ? 'auto' : undefined,
        left: putRight ? undefined : -2, right: putRight ? 2 : undefined,
        fontSize: 11, lineHeight: '16px', padding: '0 5px', borderRadius: 2, whiteSpace: 'nowrap',
        background: active ? 'rgb(252,206,20)' : '#ff4d4f', color: '#16161a', fontWeight: 600,
        maxWidth: '40vw', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {labelZh(detections[i].label)} {Math.round(detections[i].confidence * 100)}%
      </span>
    );
  };

  const imageBlock = (
    <div style={{
      position: 'relative', alignSelf: 'flex-start', maxWidth: '100%', minWidth: 0, borderRadius: 8,
      background: 'var(--semi-color-fill-0)', overflow: 'hidden',
      display: 'flex', justifyContent: 'center',
    }}>
      {src ? (
        <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
          <img ref={imgRef} src={src} alt="识别截图"
            style={{ maxWidth: '100%', maxHeight: '72vh', width: 'auto', objectFit: 'contain', display: 'block' }}
            onLoad={(e: any) => setImgSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
          {detections.map((b, i) => (
            <div key={i} onMouseEnter={() => setBoxActive(i)} onMouseLeave={() => setBoxActive(null)}
              style={{ ...boxStyle(b, i), cursor: 'default' }}>
              {boxLabel(b, i)}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-hint" style={{ padding: '48px 24px', fontSize: 12 }}>未捕获到画面</div>
      )}
    </div>
  );

  // ---- 右侧面板：一列到底，小节之间用标题+分隔，不再各自成 Card ----
  const panel = (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 14, minWidth: 300, maxWidth: 420,
      maxHeight: '72vh', overflowY: 'auto', paddingRight: 4, flex: 1,
    }}>
      {/* ① 结论：最大层级。一眼看到"正常/异常"再往下看细节 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {resultTag(String(data.result))}
        {data.confidence != null && (
          <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            置信度 {Number(data.confidence)}%
          </span>
        )}
        {typeText && <Tag size="large">{typeText}</Tag>}
        {data.identifySubType && <Tag size="large" color="orange">{data.identifySubType}</Tag>}
      </div>

      {/* ② 判定依据：结论的一句话理由 */}
      <Section title="判定依据">
        <div style={{ fontSize: 13, lineHeight: '22px', wordBreak: 'break-word' }}>
          {anomalyReason
            || j?.reason
            || (data.result === 'NORMAL' ? '未发现异常项' : data.result === 'FAILED' ? '识别引擎全部失败' : '—')}
        </div>
      </Section>

      {/* ③ 检出目标：与左侧框联动。未检出时如实说明原因（含真实阈值） */}
      {readings.length > 0 ? (
        <Section title="表计读数">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {readings.map((r: any, i: number) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '4px 8px',
                background: 'var(--semi-color-fill-0)', borderRadius: 6,
              }}>
                <span style={{ color: 'var(--semi-color-text-2)' }}>{r.readingKey || `读数${i + 1}`}</span>
                <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {r.valueNum ?? r.valueText ?? '-'}{r.unit && r.unit !== 'state' ? r.unit : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      ) : detections.length > 0 ? (
        <Section title={`检出目标 · ${detections.length}`} right={
          <span className="text-muted" style={{ fontSize: 11 }}>悬停可在画面上定位</span>
        }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {detections.map((b, i) => (
              <DetectionRow key={i} d={b} idx={i}
                active={boxActive === i} onHover={setBoxActive} />
            ))}
          </div>
        </Section>
      ) : (
        <Section title="目标检测（YOLO）">
          <div style={{ fontSize: 12, lineHeight: '20px', color: 'var(--semi-color-text-2)' }}>
            {isVlmOnly
              ? '本次为「仅 VLM」模式，未跑目标检测'
              : `本帧未检出目标。YOLO 是通用目标检测（人/车/手机等 80 类），${thresholdPct != null ? `置信度阈值 ${thresholdPct}%，` : ''}低于阈值的疑似目标会被过滤；设备外观类巡检主要依赖右侧大模型研判。`}
          </div>
        </Section>
      )}

      {/* ④ 分项发现 / 指示灯 / 空开：VLM 结构化输出 */}
      {findings.length > 0 && (
        <Section title={`分项发现 · ${findings.length}`}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {findings.map((f: any, i: number) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                padding: '4px 8px', borderRadius: 6, fontSize: 13,
                background: f.anomaly ? 'rgba(244,63,94,.10)' : 'var(--semi-color-fill-0)',
                boxShadow: f.anomaly ? 'inset 3px 0 0 var(--semi-color-danger)' : 'none',
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.item || '未命名'}</span>
                <Tag size="small" color={f.anomaly ? 'red' : 'green'} style={{ flexShrink: 0 }}>{f.anomaly ? '异常' : '正常'}</Tag>
              </div>
            ))}
          </div>
        </Section>
      )}
      {lights.length > 0 && (
        <Section title={`指示灯 · ${lights.length}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lights.map((l: any, i: number) => (
              <Tag key={i} size="small" color={l.anomaly ? 'red' : 'green'}>{l.name || '灯'}: {l.status || '-'}</Tag>
            ))}
          </div>
        </Section>
      )}
      {switches.length > 0 && (
        <Section title={`空开状态 · ${switches.length}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {switches.map((s: any, i: number) => <Tag key={i} size="small">{s.name || '空开'}: {s.state || '-'}</Tag>)}
          </div>
        </Section>
      )}

      {/* ⑤ 大模型原文 */}
      {rawVlm && (
        <Section title="大模型研判原文">
          {vlmError ? (
            <div style={{ fontSize: 12, lineHeight: '20px', color: 'var(--semi-color-danger)' }}>
              模型服务返回错误：{vlmError}
              <div className="text-muted" style={{ marginTop: 4 }}>
                常见原因：API Key 无效/过期、账户无额度、该模型未开通。到 设置→智能算法→模型 重新填 Key 后点 ⚡ 测试。
              </div>
            </div>
          ) : j?.reason ? (
            <div style={{
              fontSize: 12, lineHeight: '20px', wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              background: 'var(--semi-color-fill-0)', borderRadius: 6, padding: '8px 10px',
            }}>
              {String(j.reason)}
            </div>
          ) : vlm.text ? (
            <Typography.Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{vlm.text}</Typography.Paragraph>
          ) : null}
          <div onClick={() => setRawOpen((v) => !v)}
            style={{ fontSize: 11, color: 'var(--semi-color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, width: 'fit-content' }}>
            {rawOpen ? <IconChevronUp size="small" /> : <IconChevronDown size="small" />}
            模型原始输出
          </div>
          {rawOpen && (
            <div className="mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 140, overflow: 'auto', background: 'var(--semi-color-fill-0)', borderRadius: 4, padding: '6px 8px' }}>
              {vlm.text || rawVlm}
            </div>
          )}
        </Section>
      )}
    </div>
  );

  // 单屏约束：左右两列各自内部滚动，弹窗整体不超视口
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 160px)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {imageBlock}
        {panel}
      </div>
      {/* 引擎参数：一行小字收尾 */}
      <div className="text-muted" style={{ fontSize: 11, borderTop: '1px solid var(--semi-color-border)', paddingTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {metaBits.map((m, i) => <span key={i} style={{ whiteSpace: 'nowrap' }}>{m}</span>)}
        <span style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>结果已入库（巡检结果/告警可查）</span>
      </div>
    </div>
  );
}
