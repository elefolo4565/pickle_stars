import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'client',
  base: './',
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    // 開発時は WebSocket をゲームサーバー (3000) へ中継する
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
