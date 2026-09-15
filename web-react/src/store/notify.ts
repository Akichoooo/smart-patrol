import { create } from 'zustand';
import { get, post } from '@/api/http';

export interface Notice {
  id: number;
  title: string;
  content: string;
  type: string;
  bizId?: number;
  isRead: boolean;
  createTime: string;
}

interface NotifyState {
  notices: Notice[];
  unread: number;
  panelOpen: boolean;
  setPanelOpen: (v: boolean) => void;
  refresh: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotifyStore = create<NotifyState>((set, getState) => ({
  notices: [],
  unread: 0,
  panelOpen: false,

  setPanelOpen: (v) => {
    set({ panelOpen: v });
    if (v) getState().refresh();
  },

  refresh: async () => {
    try {
      const data = await get<any>('/api/patrol/notification/list', { page: 1, count: 20 });
      const list: Notice[] = Array.isArray(data) ? data : (data?.list ?? []);
      set({ notices: list });
      try {
        const c = await get<any>('/api/patrol/notification/unread/count');
        set({ unread: Number(c) || 0 });
      } catch {
        set({ unread: list.filter((n) => !n.isRead).length });
      }
    } catch {
      // 后端未部署 patrol 包时静默
    }
  },

  markRead: async (id) => {
    await post('/api/patrol/notification/read', { id }).catch(() => {});
    set({
      notices: getState().notices.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      unread: Math.max(0, getState().unread - 1),
    });
  },

  markAllRead: async () => {
    await post('/api/patrol/notification/read', { all: true }).catch(() => {});
    set({ notices: getState().notices.map((n) => ({ ...n, isRead: true })), unread: 0 });
  },
}));
