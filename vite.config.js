import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  base: '/manga-translator-viewer/',
  server: {
    port: 5174
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        try: resolve(__dirname, 'try/index.html'),
        privacy: resolve(__dirname, 'privacy/index.html'),
      }
    }
  }
})
