import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Relative base so the built site works whether it is served from a domain
  // root (Vercel/Netlify) or a subfolder (GitHub Pages project site).
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Proxies /api/* to the FastAPI dev server (backend/) so fetch()
    // calls in src/services/api.js look same-origin to the browser —
    // no CORS configuration needed for local development.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
