import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, DeepPartial, NativeApi, Profile, ThumbnailTemplate } from '../shared/types'

// All native capability is exposed here behind a typed `window.api`. The renderer
// never touches Node directly (contextIsolation on, nodeIntegration off).
const api: NativeApi = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: DeepPartial<AppSettings>) => ipcRenderer.invoke('settings:set', patch)
  },

  db: {
    myChannels: () => ipcRenderer.invoke('db:myChannels'),
    sourceChannels: () => ipcRenderer.invoke('db:sourceChannels'),
    downloads: () => ipcRenderer.invoke('db:downloads'),
    profiles: () => ipcRenderer.invoke('db:profiles'),
    templates: () => ipcRenderer.invoke('db:templates'),
    activity: () => ipcRenderer.invoke('db:activity'),
    upsertProfile: (p: Profile) => ipcRenderer.invoke('db:upsertProfile', p),
    saveTemplate: (t: ThumbnailTemplate) => ipcRenderer.invoke('db:saveTemplate', t)
  }
}

contextBridge.exposeInMainWorld('api', api)
