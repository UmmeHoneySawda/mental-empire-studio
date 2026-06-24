import { ipcMain } from 'electron'
import type { AppSettings, DeepPartial, GoalsPatch, Profile, ThumbnailTemplate } from '../../shared/types'
import { getSettings, setSettings } from '../store/settings'
import { getRepos } from '../db'
import { registerScrapeIpc } from './scrape'
import { registerDownloadIpc } from './download'
import { registerComposeIpc } from './compose'

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
  ipcMain.handle('db:recentUploads', (_e, limit?: number) => getRepos().recentUploads(limit ?? 8))
  ipcMain.handle('db:updateChannelGoals', (_e, id: string, patch: GoalsPatch) => {
    getRepos().updateChannelGoals(id, patch)
    return getRepos().myChannels()
  })

  // ---- scraping + reminders (M3) ----
  registerScrapeIpc()

  // ---- download + compose + transcribe (M4) ----
  registerDownloadIpc()
  registerComposeIpc()
}

