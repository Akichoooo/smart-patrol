import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Nav } from '@douyinfe/semi-ui';
import {
  IconShield,
  IconServer,
  IconCameraStroked,
  IconMapPin,
  IconBox,
  IconBolt,
  IconSetting,
  IconDesktop,
} from '@douyinfe/semi-icons';
import { useAuthStore } from '@/store/auth';

/** 设置左侧栏：8 个分组（组内用 Tab） */
export default function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasModule = useAuthStore((s) => s.hasModule);

  const defs = [
    { path: '/settings/security', module: 'settings.security', text: '账号与安全', icon: <IconShield /> },
    { path: '/settings/access', module: 'settings.access', text: '设备接入', icon: <IconServer /> },
    { path: '/settings/media', module: 'settings.media', text: '媒体与级联', icon: <IconCameraStroked /> },
    { path: '/settings/org', module: 'settings.org', text: '组织与地图', icon: <IconMapPin /> },
    { path: '/settings/asset', module: 'settings.asset', text: '机器人与装备', icon: <IconBox /> },
    { path: '/settings/ai', module: 'settings.ai', text: '智能算法', icon: <IconBolt /> },
    { path: '/settings/patrol', module: 'settings.patrol', text: '巡视配置', icon: <IconSetting /> },
    { path: '/settings/system', module: 'settings.system', text: '系统', icon: <IconDesktop /> },
  ];

  const items = defs.filter((d) => hasModule(d.module));

  return (
    <div className="app-layout">
      <aside className="app-sider">
        <Nav
          style={{ flex: 1 }}
          selectedKeys={[location.pathname]}
          items={items.map((d) => ({ itemKey: d.path, text: d.text, icon: d.icon }))}
          onSelect={({ itemKey }) => navigate(String(itemKey))}
        />
      </aside>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
