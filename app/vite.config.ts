import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相对路径：GitHub Pages 子路径、单文件离线版、file:// 都能用
  base: './',
  plugins: [react()],
  build: {
    // 单页应用只有一个入口 chunk，不需要 modulepreload 运行时；
    // 顺便去掉构建产物里唯一的 fetch() 调用，便于审计
    modulePreload: { polyfill: false },
  },
});
