import { contextBridge, ipcRenderer } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { GPU_CHANNELS, type GpuWorkerApi } from '../shared/gpuIpc'
import type { GpuRenderSpec } from '../shared/renderSpec'

// Preload for the hidden render-worker BrowserWindow. Exposes a tiny, typed bridge so
// the worker page can read input files, write the muxed output, and report progress —
// without granting the page direct Node access. The heavy WebGL/WebCodecs work happens
// in the page itself; this only moves bytes to/from disk and relays IPC.

const api: GpuWorkerApi = {
  onRun: (cb: (spec: GpuRenderSpec) => void) => {
    ipcRenderer.on(GPU_CHANNELS.run, (_e, spec: GpuRenderSpec) => cb(spec))
  },
  onCancel: (cb: (jobId: string) => void) => {
    ipcRenderer.on(GPU_CHANNELS.cancel, (_e, jobId: string) => cb(jobId))
  },
  readFile: (path: string): ArrayBuffer => {
    const buf = readFileSync(path)
    // Return a tightly-sliced ArrayBuffer (Node Buffers can share a larger pool).
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  },
  writeFile: (path: string, data: ArrayBuffer): void => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, Buffer.from(data))
  },
  openFile: (path: string): number => {
    mkdirSync(dirname(path), { recursive: true })
    return openSync(path, 'w')
  },
  writeChunk: (fd: number, data: Uint8Array, position: number): void => {
    writeSync(fd, data, 0, data.byteLength, position)
  },
  closeFile: (fd: number): void => {
    closeSync(fd)
  },
  progress: (msg) => ipcRenderer.send(GPU_CHANNELS.progress, msg),
  done: (msg) => ipcRenderer.send(GPU_CHANNELS.done, msg),
  error: (msg) => ipcRenderer.send(GPU_CHANNELS.error, msg),
  ready: (msg) => ipcRenderer.send(GPU_CHANNELS.ready, msg)
}

contextBridge.exposeInMainWorld('gpuWorker', api)

