import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // In dev, the API runs on :8080 (uvicorn). In prod, FastAPI serves
      // this built app on the same origin, so no proxy is needed.
      '/api': 'http://127.0.0.1:8080',
    },
  },
})
