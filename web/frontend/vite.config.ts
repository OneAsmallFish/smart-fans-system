import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WEB-02: dev server 代理 /api → backend 3001（页面内 API 调用统一走相对路径）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
