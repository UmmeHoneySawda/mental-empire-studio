import { ipcMain } from 'electron'
import type { AppSettings, DeepPartial, GoalsPatch, Profile, ThumbnailTemplate } from '../../shared/types'
import { getSettings, setSettings, resetSettings } from '../store/settings'
import { getRepos } from '../db'
import { registerScrapeIpc } from './scrape'
import { registerDownloadIpc } from './download'
import { registerComposeIpc } from './compose'
import { registerThumbnailsIpc } from './thumbnails'
import { registerRenderIpc } from './render'
import { registerNicheIpc } from './niche'
import { registerAutomationIpc, upsertProfileAndWarm } from './automation'
import { tick, start as schedulerStart } from '../services/scheduler'
import { applyLoginItem } from '../services/background'
import { probeRenderCapabilities } from '../services/engine/caps'

// All native capability the renderer can reach is registered here as invoke
// handlers and exposed through the typed preload bridge (window.api.*).

/** Defense-in-depth: assert a renderer-supplied id is a non-empty string before it
 *  reaches the DB/filesystem. The renderer is first-party, so this just hardens the
 *  boundary against a future renderer compromise / malformed call. */
function reqId(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`Invalid ${name}`)
  return v
}

export function registerIpc(): void {
  // ---- settings (electron-store) ----
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: DeepPartial<AppSettings>) => {
    const next = setSettings(patch)
    // React to background/auto-scrape changes: re-register login item + scheduler.
    if (patch.background?.startOnSignIn !== undefined) applyLoginItem(next)
    if (patch.autoScrape !== undefined) schedulerStart()
    return next
  })
  ipcMain.handle('caps:get', (_e, force?: boolean) => probeRenderCapabilities(!!force))
  // Factory reset: settings back to defaults + wipe all projects/profiles/channels/jobs.
  ipcMain.handle('app:reset', () => {
    const next = resetSettings()
    getRepos().resetAll()
    applyLoginItem(next)
    schedulerStart()
    return next
  })
  // Soft reset: wipe data (channels/downloads/projects/jobs) but keep settings + API keys.
  ipcMain.handle('app:softReset', () => {
    getRepos().softReset()
  })

  // ---- domain data (sqlite) ----
  ipcMain.handle('db:myChannels', () => getRepos().myChannels())
  ipcMain.handle('db:sourceChannels', () => getRepos().sourceChannels())
  ipcMain.handle('db:downloads', () => getRepos().downloads())
  ipcMain.handle('db:profiles', () => getRepos().profiles())
  ipcMain.handle('db:templates', () => getRepos().templates())
  ipcMain.handle('db:activity', () => getRepos().activity())
  ipcMain.handle('db:upsertProfile', (_e, p: Profile) => upsertProfileAndWarm(p))
  ipcMain.handle('db:saveTemplate', (_e, t: ThumbnailTemplate) => getRepos().saveTemplate(t))
  ipcMain.handle('db:recentUploads', (_e, limit?: number) => getRepos().recentUploads(limit ?? 8))
  ipcMain.handle('db:updateChannelGoals', (_e, id: string, patch: GoalsPatch) => {
    getRepos().updateChannelGoals(reqId(id), patch)
    return getRepos().myChannels()
  })
  ipcMain.handle('db:deleteMyChannel', (_e, id: string) => {
    getRepos().deleteMyChannel(reqId(id))
    return getRepos().myChannels()
  })

  // ---- scraping + reminders (M3) ----
  registerScrapeIpc()

  // ---- download + compose + transcribe (M4) ----
  registerDownloadIpc()
  registerComposeIpc()

  // ---- thumbnail engine (M5) ----
  registerThumbnailsIpc()

  // ---- render pipeline (M6) ----
  registerRenderIpc()

  // ---- niche b-roll pools (P3) ----
  registerNicheIpc()

  // ---- automation: profiles + scheduler (M7) ----
  registerAutomationIpc()
  ipcMain.handle('automation:tick', () => tick())

  // ---- beta: effect-plan generation via Groq (reuses the transcription key) ----
  ipcMain.handle('effects:generate', async (_e, projectId: string, style: import('../../shared/types').VideoStyle) => {
    const project = getRepos().getProject(reqId(projectId, 'projectId'))
    if (!project) throw new Error('project missing')
    const words = getRepos().getTranscript(projectId)
    const { generatePlanViaGroq } = await import('../services/effects')
    const { json } = await generatePlanViaGroq(getSettings().transcription.apiKey, words, style, project.durationSec)
    return json
  })
}

