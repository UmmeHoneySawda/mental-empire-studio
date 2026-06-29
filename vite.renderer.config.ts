import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared')
    }
  },
  build: {
    outDir: 'out/renderer',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'render-worker': resolve(__dirname, 'src/render-worker/index.html')
      }
    }
  }
})
