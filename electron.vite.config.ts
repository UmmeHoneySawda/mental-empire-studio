import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // Keep node deps (better-sqlite3 native addon, electron-store) external — they
    // load from node_modules at runtime rather than being bundled into main.js.
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
      rollupOptions: { output: { format: 'es' } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
      // CommonJS preload (.cjs) loads under any sandbox setting — ESM preloads
      // require sandbox:false and are far more fragile.
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'preload.cjs' } }
    }
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'index.html') }
    }
  }
})
