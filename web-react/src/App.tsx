import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import TopBar from '@/layout/TopBar';
import NotificationPanel from '@/layout/NotificationPanel';

/**
 * 应用壳：鉴权守卫 + 顶部栏 + 内容出口。
 * 未登录跳 /login；已登录加载权限(/api/patrol/auth/me)。
 */
export default function App() {
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const loadMe = useAuthStore((s) => s.loadMe);

  useEffect(() => {
    if (!token) {
      window.location.href = '/login';
    } else if (!user) {
      loadMe();
    }
  }, [token, user, loadMe]);

  if (!token) return null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar />
      <NotificationPanel />
      <Outlet />
    </div>
  );
}
