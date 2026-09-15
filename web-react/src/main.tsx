import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ConfigProvider } from '@douyinfe/semi-ui';
import zhCN from '@douyinfe/semi-ui/lib/es/locale/source/zh_CN';
import { router } from './router';
import './styles/global.css';

import { useThemeStore } from './store/theme';

// 初始化主题（深色/浅色模式 + 品牌主题色，支持从 localStorage 恢复）
useThemeStore.getState().initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <RouterProvider router={router} />
    </ConfigProvider>
  </React.StrictMode>
);
