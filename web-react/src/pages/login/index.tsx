import { useState } from 'react';
import { Button, Toast, Tooltip } from '@douyinfe/semi-ui';
import { IconUser, IconLock, IconSun, IconMoon } from '@douyinfe/semi-icons';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import md5 from '@/utils/md5';

/** 登录页：WVP 约定 用户名 + 32位MD5密码 → access-token */
export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { mode, toggleMode } = useThemeStore();

  const onSubmit = async () => {
    if (!username || !password) {
      Toast.warning('请输入用户名与密码');
      return;
    }
    setLoading(true);
    try {
      await login(username, md5(password));
      Toast.success('登录成功');
      window.location.href = '/overview';
    } catch (e: any) {
      Toast.error(e?.message || '用户名或密码错误');
      // 登录失败审计（尽力而为）
      try {
        const { post } = await import('@/api/http');
        post('/api/patrol/auth/login-audit', null, {
          headers: { 'X-Login-Result': 'FAIL', 'X-Login-Username': username },
        }).catch(() => {});
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* 登录页明暗模式切换按钮 */}
      <div style={{ position: 'absolute', top: 20, right: 24, zIndex: 10 }}>
        <Tooltip content={mode === 'dark' ? '切换为浅色模式' : '切换为深色模式'} position="bottom">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={toggleMode}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid var(--semi-color-border)',
              background: 'var(--semi-color-bg-1)',
              color: 'var(--semi-color-text-1)',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
              transition: 'all .2s ease',
            }}
          >
            {mode === 'dark' ? <IconSun style={{ fontSize: 18 }} /> : <IconMoon style={{ fontSize: 18 }} />}
          </button>
        </Tooltip>
      </div>

      <div className="login-card">
        <div className="login-title">智能巡检平台</div>
        <div className="login-subtitle">INTELLIGENT PATROL PLATFORM</div>

        <div style={{ position: 'relative', marginBottom: 16 }}>
          <IconUser style={{ position: 'absolute', left: 10, top: 8, color: 'var(--semi-color-text-2)' }} />
          <input
            className="semi-input"
            placeholder="用户名"
            value={username}
            autoFocus
            onChange={(e) => setUsername((e.target as HTMLInputElement).value)}
            style={{ height: 36, width: '100%', paddingLeft: 34, borderRadius: 4, border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', color: 'var(--semi-color-text-0)' }}
          />
        </div>

        <div style={{ position: 'relative', marginBottom: 24 }}>
          <IconLock style={{ position: 'absolute', left: 10, top: 8, color: 'var(--semi-color-text-2)' }} />
          <input
            className="semi-input"
            placeholder="密码"
            type="password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => (e.key === 'Enter' ? onSubmit() : null)}
            style={{ height: 36, width: '100%', paddingLeft: 34, borderRadius: 4, border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', color: 'var(--semi-color-text-0)' }}
          />
        </div>

        <Button theme="solid" type="primary" block loading={loading} onClick={onSubmit} size="large">
          登 录
        </Button>
      </div>
    </div>
  );
}
