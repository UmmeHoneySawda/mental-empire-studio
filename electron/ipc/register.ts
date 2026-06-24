import { ipcMain } from 'electron'
import type { AppSettings, DeepPartial, Profile, ThumbnailTemplate } from '../../shared/types'
import { getSettings, setSettings } from '../store/settings'
import { getRepos } from '../db'
import { registerScrapeIpc } from './scrape'

// All native capability the renderer can reach is registered here as invoke
// handlers and exposed through the typed preload bridge (window.api.*).
export function registerIpc(): void {
  // ---- settings (electron-store) ----
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: DeepPartial<AppSettings>) => setSettings(patch))

  // ---- domain data (sqlite) ----
  ipcMain.handle('db:myChannels', () => getRepos().myChannels())
  ipcMain.handle('db:sourceChannels', () => getRepos().sourceChannels())
  ipcMain.handle('db:downloads', () => getRepos().downloads())
  ipcMain.handle('db:profiles', () => getRepos().profiles())
  ipcMain.handle('db:templates', () => getRepos().templates())
  ipcMain.handle('db:activity', () => getRepos().activity())
  ipcMain.handle('db:upsertProfile', (_e, p: Profile) => getRepos().upsertProfile(p))
  ipcMain.handle('db:saveTemplate', (_e, t: ThumbnailTemplate) => getRepos().saveTemplate(t))

  // ---- scraping + reminders (M3) ----
  registerScrapeIpc()
}

