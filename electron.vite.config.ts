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
      // Two preloads: the main window bridge (preload.cjs) and the hidden GPU
      // render-worker bridge (preload-worker.cjs). CommonJS so they load under any
      // sandbox setting.
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'electron/preload.ts'),
          'preload-worker': resolve(__dirname, 'electron/preload-worker.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
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
      // Two HTML entries: the app (index.html) and the hidden GPU render worker.
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          'render-worker': resolve(__dirname, 'src/render-worker/index.html')
        }
      }
    }
  }
})
