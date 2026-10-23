import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 单文件：所有 JS/CSS 内联，file:// 直接打开
  base: './',
  define: {
    'import.meta.env.VITE_SINGLE_FILE': JSON.stringify('1'),
  },
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
