import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ActivityRow,
  AppSettings,
  DeepPartial,
  NativeApi,
  Profile,
  ScrapeOrder,
  ScrapeProgress,
  ThumbnailTemplate
} from '../shared/types'

/** Subscribe to a main→renderer event; returns an unsubscribe fn. */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

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
  },

  scrape: {
    channel: (url: string) => ipcRenderer.invoke('scrape:channel', url),
    addMyChannel: (url: string, linkedSourceId?: string) =>
      ipcRenderer.invoke('scrape:addMyChannel', url, linkedSourceId),
    refreshChannel: (id: string) => ipcRenderer.invoke('scrape:refreshChannel', id),
    all: () => ipcRenderer.invoke('scrape:all'),
    sourceVideos: (url: string, order: ScrapeOrder, count: number) =>
      ipcRenderer.invoke('scrape:sourceVideos', url, order, count)
  },

  reminders: {
    check: () => ipcRenderer.invoke('reminders:check')
  },

  onScrapeProgress: (cb: (p: ScrapeProgress) => void) => subscribe('scrape:progress', cb),
  onActivity: (cb: (row: ActivityRow) => void) => subscribe('activity:new', cb)
}

contextBridge.exposeInMainWorld('api', api)
