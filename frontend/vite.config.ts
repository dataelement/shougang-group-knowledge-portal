import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendProxyTarget = process.env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:8010'
const bishengWebProxyTarget = process.env.VITE_BISHENG_WEB_PROXY_TARGET || 'http://192.168.106.171:3001'
const bishengApiProxyTarget = process.env.VITE_BISHENG_API_PROXY_TARGET || 'http://192.168.106.171:7860'
const bishengMinioProxyTarget = process.env.VITE_BISHENG_MINIO_PROXY_TARGET || 'http://192.168.106.171:9100'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '/health': {
        target: backendProxyTarget,
        changeOrigin: true,
      },
      '^/workspace/api(/|$)': {
        target: bishengApiProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/workspace/, ''),
      },
      '^/workspace/bisheng|^/tmp-dir': {
        target: bishengMinioProxyTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/workspace/, ''),
      },
      '/workspace/': {
        target: bishengWebProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
