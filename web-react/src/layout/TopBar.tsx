import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Tag, Dropdown, Badge, Avatar, Modal, Typography, Tooltip } from '@douyinfe/semi-ui';
import {
  IconBell,
  IconSetting,
  IconUser,
  IconExit,
  IconLock,
  IconMoon,
  IconSun,
} from '@douyinfe/semi-icons';
import { useAuthStore } from '@/store/auth';
import { useNotifyStore } from '@/store/notify';
import { useThemeStore } from '@/store/theme';
import { MAIN_NAV, matchMainNav } from '@/layout/navItems';

/**
 * 顶部栏：品牌 → 主导航（原左栏二级菜单上移，两组间一条分隔线）→ 通知 / 设置 / 用户
 * 侧栏取消后内容区拿到全宽，这是本次导航重构的主要收益。
 */
export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasModule = useAuthStore((s) => s.hasModule);
  const unread = useNotifyStore((s) => s.unread);
  const setPanelOpen = useNotifyStore((s) => s.setPanelOpen);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);

  const inSettings = location.pathname.startsWith('/settings');
  const activeKey = matchMainNav(location.pathname);
  const items = MAIN_NAV.filter((it) => hasModule(it.module));

  const { mode, toggleMode } = useThemeStore();

  return (
    <header className="topbar">
      <div className="topbar-brand" title="返回总览" onClick={() => navigate('/overview')}>
        <div className="brand-logo-badge">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
            <circle cx="12" cy="13" r="4"></circle>
          </svg>
        </div>
        <span>智能巡检监控平台</span>
      </div>

      <nav className="topbar-nav">
        {items.map((it, i) => {
          const prev = items[i - 1];
          return (
            <span key={it.path} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {prev && prev.group !== it.group && <i className="nav-sep" />}
              <button
                type="button"
                className={`nav-item${activeKey === it.path ? ' active' : ''}`}
                onClick={() => navigate(it.path)}
              >
                {it.text}
                {/* 告警未读直接标在菜单上：这是"要马上处理"的页面，不该只躲在铃铛里 */}
                {it.path === '/patrol/alarm' && unread > 0 && (
                  <Badge count={unread} type="danger" style={{ marginLeft: 6 }} />
                )}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="topbar-actions">
        {/* 一键明暗主题切换 */}
        <Tooltip content={mode === 'dark' ? '切换为明亮模式' : '切换为深色模式'} position="bottom">
          <span
            className="theme-toggle-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              cursor: 'pointer',
              color: 'var(--semi-color-text-2)',
              transition: 'all .2s ease',
            }}
            onClick={toggleMode}
          >
            {mode === 'dark' ? <IconSun style={{ fontSize: 18 }} /> : <IconMoon style={{ fontSize: 18 }} />}
          </span>
        </Tooltip>

        {/* 通知（未读角标） */}
        <Badge count={unread} type="danger">
          <IconBell
            style={{ fontSize: 18, cursor: 'pointer', color: 'var(--semi-color-text-2)' }}
            onClick={() => setPanelOpen(true)}
          />
        </Badge>

        {/* 设置齿轮 */}
        <IconSetting
          style={{
            fontSize: 18,
            cursor: 'pointer',
            color: inSettings ? 'var(--semi-color-primary)' : 'var(--semi-color-text-2)',
          }}
          onClick={() => navigate('/settings/security')}
        />

        {/* 用户下拉 */}
        <Dropdown
          trigger="click"
          position="bottomRight"
          render={
            <Dropdown.Menu>
              <Dropdown.Item icon={<IconUser />} onClick={() => setInfoOpen(true)}>
                个人信息
              </Dropdown.Item>
              <Dropdown.Item icon={<IconLock />} onClick={() => setPwdOpen(true)}>
                修改密码
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item icon={<IconExit />} onClick={() => { logout(); window.location.href = '/login'; }}>
                退出登录
              </Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <Avatar size="small" style={{ background: 'var(--semi-color-primary)' }}>
              {(user?.username || 'U').slice(0, 1).toUpperCase()}
            </Avatar>
            <span style={{ fontSize: 13 }}>{user?.username || '-'}</span>
          </div>
        </Dropdown>
      </div>

      {/* 个人信息弹窗 */}
      <Modal
        title="个人信息"
        visible={infoOpen}
        onCancel={() => setInfoOpen(false)}
        footer={null}
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="flex-between">
            <span className="text-muted">用户名</span>
            <Typography.Text copyable>{user?.username}</Typography.Text>
          </div>
          <div className="flex-between">
            <span className="text-muted">角色</span>
            <Tag>{user?.admin ? '管理员' : `角色 ${user?.roleId}`}</Tag>
          </div>
          <div className="flex-between">
            <span className="text-muted">数据权限</span>
            <Tag>{user?.scopeType === 'ALL' ? '全部数据' : (user?.scopeType || '-')}</Tag>
          </div>
          <div className="flex-between">
            <span className="text-muted">会话有效期</span>
            <span>{user?.loginTimeoutMinutes ? `${Math.round(user.loginTimeoutMinutes)} 分钟（滑动续签）` : '-'}</span>
          </div>
        </div>
      </Modal>

      {/* 修改密码弹窗 */}
      <PwdModal visible={pwdOpen} onClose={() => setPwdOpen(false)} />
    </header>
  );
}

/** 修改密码：WVP /api/user/changePassword (旧密码MD5 + 新密码明文) */
function PwdModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [loading, setLoading] = useState(false);
  return (
    <Modal
      title="修改密码"
      visible={visible}
      onCancel={onClose}
      onOk={async () => {
        if (!oldPwd || !newPwd) return;
        setLoading(true);
        try {
          const { postForm } = await import('@/api/http');
          const { default: md5 } = await import('@/utils/md5');
          await postForm('/api/user/changePassword', {
            oldPassword: md5(oldPwd),
            password: newPwd,
          });
          const { Toast } = await import('@douyinfe/semi-ui');
          Toast.success('密码修改成功');
          onClose();
        } catch {
          // Toast 已由请求层弹出
        } finally {
          setLoading(false);
        }
      }}
      okText="确认修改"
      confirmLoading={loading}
      width={420}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          className="semi-input"
          placeholder="原密码"
          type="password"
          value={oldPwd}
          onChange={(e) => setOldPwd((e.target as HTMLInputElement).value)}
          style={{ height: 32, borderRadius: 4, border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', color: 'var(--semi-color-text-0)', padding: '0 10px' }}
        />
        <input
          className="semi-input"
          placeholder="新密码（需复杂度校验）"
          type="password"
          value={newPwd}
          onChange={(e) => setNewPwd((e.target as HTMLInputElement).value)}
          style={{ height: 32, borderRadius: 4, border: '1px solid var(--semi-color-border)', background: 'var(--semi-color-bg-1)', color: 'var(--semi-color-text-0)', padding: '0 10px' }}
        />
      </div>
    </Modal>
  );
}
