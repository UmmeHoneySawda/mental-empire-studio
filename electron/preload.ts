import { contextBridge, ipcRenderer } from 'electron'
import type { NativeApi } from '../shared/types'

// All native capability is exposed here behind a typed `window.api`. The renderer
// never touches Node directly (contextIsolation on, nodeIntegration off).
const api: NativeApi = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close')
}

contextBridge.exposeInMainWorld('api', api)
