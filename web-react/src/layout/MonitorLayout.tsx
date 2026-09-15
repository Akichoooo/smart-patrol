import { Outlet } from 'react-router-dom';

/**
 * 实时监控分区容器。
 * 二级菜单（视频监控/机器人监控/无人机监控/录像回放）已上移到顶部栏，
 * 这里不再渲染左栏——内容区因此拿到全宽。保留该组件是为了维持既有路由层级。
 */
export default function MonitorLayout() {
  return (
    <div className="app-layout">
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
