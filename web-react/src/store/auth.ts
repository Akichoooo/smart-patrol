import { create } from 'zustand';
import { get, post, setUnauthorizedHandler } from '@/api/http';
import { getToken, setToken as persistToken, clearToken } from '@/api/token';
import md5Impl from '@/utils/md5';

export interface AuthUser {
  userId: number;
  username: string;
  roleId: number;
  admin: boolean;
  modules: string[];
  actions: Record<string, string[]>;
  scopeType: string;
  scopeIds: string[];
  channelFuncs: string[];
  loginTimeoutMinutes: number;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  setToken: (t: string) => void;
  login: (username: string, passwordMd5: string) => Promise<void>;
  logout: () => void;
  loadMe: () => Promise<void>;
  /** 模块权限（菜单/路由可见性） */
  hasModule: (m: string) => boolean;
  /** 模块内操作权限（按钮级） */
  hasPerm: (module: string, action: string) => boolean;
  /** 摄像头功能级权限 */
  hasChannelFunc: (func: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, getState) => {
  // 401 时由请求层回调（本模块不反向依赖请求层内部状态，避免循环依赖）
  setUnauthorizedHandler(() => {
    set({ token: null, user: null });
  });

  return {
    token: getToken(),
    user: null,

    setToken: (t: string) => {
      persistToken(t);
      set({ token: t });
    },

    login: async (username: string, passwordMd5: string) => {
      // WVP 登录：GET /api/user/login（UserController 同时标了 Get/Post，Spring 只注册 GET）
      const data = await get<any>('/api/user/login', { username, password: passwordMd5 });
      const token = data?.accessToken;
      if (!token) throw new Error('登录返回缺少 token');
      persistToken(token);
      set({ token });
      // 登录成功审计回调（后端未部署 patrol 包时静默降级）
      post('/api/patrol/auth/login-audit', null, {
        headers: { 'X-Login-Result': 'SUCCESS', 'X-Login-Username': username },
      }).catch(() => {});
      await getState().loadMe();
    },

    logout: () => {
      get('/api/user/logout').catch(() => {});
      clearToken();
      set({ token: null, user: null });
    },

    loadMe: async () => {
      const s = getState();
      if (!s.token) return;
      try {
        const me = await get<AuthUser>('/api/patrol/auth/me');
        set({ user: me });
      } catch {
        // 旧版 WVP 后端（未部署 patrol 包）时降级：仅管理员可用全部功能
        set({
          user: {
            userId: 0,
            username: 'admin',
            roleId: 1,
            admin: true,
            modules: ['*'],
            actions: {},
            scopeType: 'ALL',
            scopeIds: [],
            channelFuncs: ['view', 'ptz', 'preset', 'playback', 'download', 'snapshot', 'talk', 'record'],
            loginTimeoutMinutes: 43200,
          },
        });
      }
    },

    hasModule: (m: string) => {
      const u = getState().user;
      if (!u) return true; // 权限未加载完成前不拦截渲染（守卫层另行处理）
      if (u.admin || u.modules?.includes('*')) return true;
      return (u.modules || []).includes(m);
    },

    hasPerm: (module: string, action: string) => {
      const u = getState().user;
      if (!u) return true;
      if (u.admin || u.modules?.includes('*')) return true;
      const acts = u.actions?.[module];
      if (acts && acts.includes(action)) return true;
      return false;
    },

    hasChannelFunc: (func: string) => {
      const u = getState().user;
      if (!u) return true;
      if (u.admin) return true;
      return (u.channelFuncs || []).includes(func);
    },
  };
});
