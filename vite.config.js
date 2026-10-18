import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Тот же относительный /api, что за Caddy в проде: фронт не знает адрес api и обходится без CORS.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
