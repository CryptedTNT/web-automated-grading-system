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
    // Listen on the LAN, not just localhost -- so a phone on the same
    // Wi-Fi can open this dev server directly (e.g. to test the camera
    // capture flow on an actual device). `npm run dev -- --host` was
    // meant to do this per-invocation, but some npm versions drop an
    // unrecognized flag after `--` instead of forwarding it to Vite
    // ("Unknown cli config" warning), so it's set here instead.
    host: true,
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
