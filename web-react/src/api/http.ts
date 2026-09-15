import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { Toast } from '@douyinfe/semi-ui';
import { getToken, setToken, clearToken } from '@/api/token';

/**
 * 请求层：
 * - 请求头 access-token（WVP 约定，非 Authorization）
 * - 响应拦截器读取响应头 access-token 实现 token 滑动续签（后端 EXPIRING_SOON 时下发）
 * - 401 统一跳登录；网络错误 Semi Toast 提示
 * - 注意：这里只依赖 api/token，不依赖 store（避免循环依赖导致的打包 TDZ 错误）
 */
const http = axios.create({
  baseURL: '',
  timeout: 30000,
});

/** 401 时的跳转回调（由 store/auth 注册，避免本模块反向依赖 store） */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getToken();
  if (token) {
    config.headers.set('access-token', token);
  }
  return config;
});

http.interceptors.response.use(
  (resp: AxiosResponse) => {
    // token 滑动续签：后端在即将过期时下发新 token
    const renewed = resp.headers?.['access-token'] as string | undefined;
    if (renewed) {
      setToken(renewed);
    }
    const body = resp.data;
    // WVP 统一返回 { code, msg, data }；code 非 0 视为业务错误
    if (body && typeof body === 'object' && 'code' in body && body.code !== 0 && body.code !== 200) {
      const msg = (body as { msg?: string }).msg || `请求失败(${body.code})`;
      if (!(resp.config as { skipErrorToast?: boolean }).skipErrorToast) {
        Toast.error(msg);
      }
      return Promise.reject(new Error(msg));
    }
    return resp;
  },
  (err: AxiosError) => {
    const status = err.response?.status;
    if (status === 401) {
      clearToken();
      if (onUnauthorized) onUnauthorized();
      if (!location.pathname.startsWith('/login')) {
        Toast.warning('登录已失效，请重新登录');
        location.href = '/login';
      }
    } else if (status === 403) {
      Toast.error('没有操作权限 (403)');
    } else if (err.code === 'ECONNABORTED') {
      Toast.error('请求超时');
    } else if (!err.response) {
      Toast.error('网络异常，请检查服务连接');
    } else if (status) {
      // 其余 HTTP 错误统一可见（此前 500 静默失败，用户只看到"下载失败"无头绪）
      Toast.error(`请求失败(HTTP ${status})`);
    }
    return Promise.reject(err);
  }
);

/**
 * 给任意请求加硬超时：axios 的 timeout 在部分中断路径下不保证 promise settle，
 * 会让调用方一直停在 loading（按钮永久转圈、界面无法恢复）。AI 抓帧/VLM 这类慢接口必须兜住。
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = '请求'): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(
      () => reject(new Error(`${label}超时（>${Math.round(ms / 1000)}s），请确认通道有画面或稍后重试`)), ms)),
  ]);
}

/** GET：直接返回 WVP 结构里的 data 或整个 body */
export async function get<T = any>(url: string, params?: any, config?: any): Promise<T> {
  const resp = await http.get(url, { params, ...config });
  return unwrap<T>(resp.data);
}

export async function post<T = any>(url: string, data?: any, config?: any): Promise<T> {
  const resp = await http.post(url, data, config);
  return unwrap<T>(resp.data);
}

export async function postForm<T = any>(url: string, params?: any): Promise<T> {
  const resp = await http.post(url, null, { params });
  return unwrap<T>(resp.data);
}

/** body 可选：WVP 有些 DELETE 接口用 @RequestBody 接参（如级联移除通道） */
export async function del<T = any>(url: string, params?: any, body?: any): Promise<T> {
  const resp = await http.delete(url, { params, ...(body !== undefined ? { data: body } : {}) });
  return unwrap<T>(resp.data);
}

/**
 * 文件下载：走 axios（token 在请求头，错误统一进拦截器），成功才落盘并提示。
 * 之前用 <a href> 直链下载：失败时只弹浏览器"无法下载"，且 500 的报错完全看不到。
 */
export async function download(url: string, params: Record<string, any>, filename: string): Promise<void> {
  let resp: AxiosResponse;
  try {
    resp = await http.get(url, { params, responseType: 'blob' });
  } catch (e: any) {
    // 尽力把后端 JSON 错误信息解析出来
    let msg = '';
    if (e?.response?.data instanceof Blob) {
      try {
        const text = await e.response.data.text();
        msg = JSON.parse(text)?.msg || msg;
      } catch { /* 非 JSON 忽略 */ }
    }
    throw new Error(msg || `下载失败(HTTP ${e?.response?.status ?? '?'})`);
  }
  const blob = resp.data as Blob;
  const a = document.createElement('a');
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
}

const snakeToCamel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/** 递归把后端 Map 的 snake_case 键转 camelCase（一次解决列表/详情页字段错位） */
function deepCamel<T>(v: any, seen = new WeakSet()): T {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return v;
  seen.add(v);
  if (Array.isArray(v)) return v.map((x) => deepCamel(x, seen)) as any;
  const out: any = {};
  for (const k of Object.keys(v)) {
    out[snakeToCamel(k)] = deepCamel(v[k], seen);
  }
  return out;
}

function unwrap<T>(body: any): T {
  if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
    return deepCamel<T>((body as { data: T }).data);
  }
  return deepCamel<T>(body);
}

export default http;
