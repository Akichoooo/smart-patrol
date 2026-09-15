import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// 生产同源 baseURL=''；开发代理 /api→WVP(18978)，/live+/zlm_snap→ZLM(8081, ws)
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:18978', changeOrigin: true },
      '/live': { target: 'http://127.0.0.1:8081', ws: true },
      '/zlm_snap': { target: 'http://127.0.0.1:8081', ws: true },
      '/rtp': { target: 'http://127.0.0.1:8081', ws: true },
      '/record_proxy': { target: 'http://127.0.0.1:18978', changeOrigin: true },
    },
  },
  build: {
    outDir: '../src/main/resources/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // 函数式分包：node_modules 整体进 vendor（react/scheduler/router 等内部互相依赖，
        // 按包名拆会打破初始化顺序导致 "Cannot access before initialization"），
        // 仅把无循环依赖的大件单独拆出。
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](echarts|zrender)[\\/]/.test(id)) return 'charts';
          if (/[\\/]mpegts\.js[\\/]/.test(id)) return 'players';
          if (/[\\/]@douyinfe[\\/]/.test(id)) return 'semi';
          return 'vendor';
        },
      },
    },
  },
});
