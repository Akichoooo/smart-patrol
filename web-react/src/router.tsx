import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from './App';
import LoginPage from './pages/login';
import OverviewPage from './pages/overview';
import MonitorLayout from './layout/MonitorLayout';
import VideoMonitorPage from './pages/monitor/video';
import RobotMonitorPage from './pages/monitor/robot';
import DroneMonitorPage from './pages/monitor/drone';
import PlaybackPage from './pages/monitor/playback';
import PatrolLayout from './layout/PatrolLayout';
import TaskPage from './pages/patrol/task';
import TaskEditPage from './pages/patrol/task-edit';
import ExecutionPage from './pages/patrol/execution';
import ResultPage from './pages/patrol/result';
import ReportPage from './pages/patrol/report';
import AlarmPage from './pages/patrol/alarm';
import StatsPage from './pages/patrol/stats';
import SettingsLayout from './layout/SettingsLayout';
import SecurityPage from './pages/settings/security';
import AccessPage from './pages/settings/access';
import MediaPage from './pages/settings/media';
import OrgPage from './pages/settings/org';
import AssetPage from './pages/settings/asset';
import AiPage from './pages/settings/ai';
import PatrolConfPage from './pages/settings/patrol';
import SystemPage from './pages/settings/system';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/overview" replace /> },
      { path: 'overview', element: <OverviewPage /> },
      // 实时监控
      {
        path: 'monitor',
        element: <MonitorLayout />,
        children: [
          { index: true, element: <Navigate to="/monitor/video" replace /> },
          { path: 'video', element: <VideoMonitorPage /> },
          { path: 'robot', element: <RobotMonitorPage /> },
          { path: 'drone', element: <DroneMonitorPage /> },
          { path: 'playback', element: <PlaybackPage /> },
        ],
      },
      // 巡视管理
      {
        path: 'patrol',
        element: <PatrolLayout />,
        children: [
          { index: true, element: <Navigate to="/patrol/task" replace /> },
          { path: 'task', element: <TaskPage /> },
          { path: 'task/create', element: <TaskEditPage /> },
          { path: 'task/edit/:id', element: <TaskEditPage /> },
          { path: 'execution', element: <ExecutionPage /> },
          { path: 'result', element: <ResultPage /> },
          { path: 'report', element: <ReportPage /> },
          { path: 'alarm', element: <AlarmPage /> },
          { path: 'stats', element: <StatsPage /> },
        ],
      },
      // 设置（8 个分组，组内 Tab）
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="/settings/security" replace /> },
          { path: 'security', element: <SecurityPage /> },
          { path: 'access', element: <AccessPage /> },
          { path: 'media', element: <MediaPage /> },
          { path: 'org', element: <OrgPage /> },
          { path: 'asset', element: <AssetPage /> },
          { path: 'ai', element: <AiPage /> },
          { path: 'patrol', element: <PatrolConfPage /> },
          { path: 'system', element: <SystemPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/overview" replace /> },
]);
