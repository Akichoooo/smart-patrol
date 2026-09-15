/** YOLO 结果解析：yolo_json 里 [{label, confidence, box:[x1,y1,x2,y2]}]，容忍字段名差异与截断的 JSON */
export interface Detection {
  label: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function parseDetections(yoloJson: any): Detection[] {
  if (!yoloJson) return [];
  const raw = String(yoloJson).trim();
  if (!raw || raw === 'null') return [];

  let arr: any[] = [];
  try {
    const parsed = JSON.parse(raw);
    arr = Array.isArray(parsed) ? parsed : [];
  } catch {
    // 截断容错：逐个提取 {...} 块（忽略尾部的坏块）
    const re = /\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) {
      try { arr.push(JSON.parse(m[0])); } catch { /* 跳过坏块 */ }
    }
  }

  const out: Detection[] = [];
  for (const d of arr) {
    const box = d.box || d.bbox || d.xyxy;
    if (!Array.isArray(box) || box.length < 4) continue;
    const [x1, y1, x2, y2] = box.map((n: any) => Number(n));
    if ([x1, y1, x2, y2].some((n) => Number.isNaN(n))) continue;
    out.push({
      label: String(d.label ?? d.name ?? d.cls ?? '目标'),
      confidence: Number(d.confidence ?? d.conf ?? d.score ?? 0),
      x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2),
    });
  }
  return out;
}
