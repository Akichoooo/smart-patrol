import { Outlet } from 'react-router-dom';

/**
 * 巡视管理分区容器。
 * 二级菜单（巡检任务/任务执行/巡检结果/任务报告/告警管理/查询统计）已上移到顶部栏，
 * 这里不再渲染左栏——内容区因此拿到全宽。保留该组件是为了维持既有路由层级。
 */
export default function PatrolLayout() {
  return (
    <div className="app-layout">
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
