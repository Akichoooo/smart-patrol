/**
 * VLM 输出解析（共享工具）：
 * 后端把 VLM 输出包成 "[模型名] ```json {...}```"，这里拆成模型名 + 结构化 JSON + 纯文本。
 * 与后端 extractJson 同构：括号配平 + 字符串转义感知，从模型输出里抠出第一个可识别的 JSON 对象。
 */

/** 后端可能塞进正文的鉴权/权限错误对象，不能当判定结果渲染 */
export function vlmErrorOf(j: any): string | null {
  return j && typeof j === 'object' && j.error
    ? String(j.error?.message ?? JSON.stringify(j.error))
    : null;
}

export function extractJson(text: string): any {
  const cleaned = text.replace(/```json/g, '').replace(/```/g, '');
  const known = (o: any) => o && typeof o === 'object'
    && ['anomaly', 'reading', 'lights', 'switches', 'findings', 'confidence', 'text'].some((k) => k in o);
  let depth = 0, start = -1, inStr = false, escape = false, first: any = null;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          try {
            const o = JSON.parse(cleaned.slice(start, i + 1));
            if (known(o)) return o;
            if (!first) first = o;
          } catch { /* 不完整片段，继续扫 */ }
          start = -1;
        }
      }
    }
  }
  return first;
}

export function parseVlm(vlm?: string) {
  const raw = (vlm || '').trim();
  if (!raw) return { model: '', json: null as any, text: '' };
  const m = /^\[([^\]]*)\]\s*/.exec(raw);
  const model = m ? m[1] : '';
  const body = m ? raw.slice(m[0].length) : raw;
  return { model, json: extractJson(body), text: body.replace(/```json|```/g, '').trim() };
}
