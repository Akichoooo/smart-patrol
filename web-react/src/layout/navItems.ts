/**
 * 顶部主导航（原「实时监控 / 巡视管理」左栏二级菜单上移到顶栏）。
 * 为什么放顶栏：这些是每天反复用的作业页，左栏 208px 常驻会白吃掉可视宽度；上移后内容区全宽。
 * 分组只影响视觉分隔，不改变路由与权限模型。
 */
export interface MainNavItem {
  path: string;
  text: string;
  /** 模块权限码，与 hasModule 对齐 */
  module: string;
  group: 'monitor' | 'patrol';
}

export const MAIN_NAV: MainNavItem[] = [
  // 实时监控
  { path: '/monitor/video', text: '视频监控', module: 'monitor.video', group: 'monitor' },
  { path: '/monitor/robot', text: '机器人监控', module: 'monitor.robot', group: 'monitor' },
  { path: '/monitor/drone', text: '无人机监控', module: 'monitor.drone', group: 'monitor' },
  { path: '/monitor/playback', text: '录像回放', module: 'monitor.playback', group: 'monitor' },
  // 巡视管理
  { path: '/patrol/task', text: '巡检任务', module: 'patrol.task', group: 'patrol' },
  { path: '/patrol/execution', text: '任务执行', module: 'patrol.execution', group: 'patrol' },
  { path: '/patrol/result', text: '巡检结果', module: 'patrol.result', group: 'patrol' },
  { path: '/patrol/report', text: '任务报告', module: 'patrol.report', group: 'patrol' },
  { path: '/patrol/alarm', text: '告警管理', module: 'patrol.alarm', group: 'patrol' },
  { path: '/patrol/stats', text: '查询统计', module: 'patrol.stats', group: 'patrol' },
];

/**
 * 当前路径命中的导航项：取最长前缀匹配，子页也能正确高亮
 * （如 /patrol/task/edit/3 → 高亮「巡检任务」，/patrol/task/create 同理）。
 */
export function matchMainNav(pathname: string): string | null {
  let best: string | null = null;
  for (const it of MAIN_NAV) {
    if (pathname === it.path || pathname.startsWith(it.path + '/')) {
      if (!best || it.path.length > best.length) best = it.path;
    }
  }
  return best;
}
