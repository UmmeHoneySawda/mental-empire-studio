import { ipcMain, shell } from 'electron'
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import type { AppSettings, AutomationLaunchInput, DeepPartial, GoalsPatch, Profile, ThumbnailTemplate, VisualTemplate } from '../../shared/types'
import { countUnpublishedVideos, launchAutomation } from './batch'
import { getSettings, setSettings, resetSettings } from '../store/settings'
import { getRepos } from '../db'
import { registerScrapeIpc } from './scrape'
import { registerDownloadIpc } from './download'
import { registerComposeIpc } from './compose'
import { registerThumbnailsIpc } from './thumbnails'
import { registerRenderIpc } from './render'
import { registerPublishIpc } from './publish'
import { registerAssetsIpc } from './assets'
import { registerLibraryIpc } from './library'
import { registerNicheIpc } from './niche'
import { registerAutomationIpc, upsertProfileAndWarm } from './automation'
import { tick, start as schedulerStart } from '../services/scheduler'
import { applyLoginItem } from '../services/background'
import { probeRenderCapabilities } from '../services/engine/caps'
import { probeGpuEngine } from '../services/engine/gpu/host'
import { runUploadDetection } from '../services/uploads-detect'
import { setSentryEnabled, telemetryForcedOff } from '../services/sentry'
import { registerStorageIpc } from './storage'
import { registerTalkingPhotosIpc } from './talkingphotos'
import { registerVideoEngineIpc } from './video-engine'
import { resetVideoEngine } from '../services/video-engine/studio'
import {
  FAST_PREVIEW_EXPORT_COMMAND,
  exportFastPreview,
} from '../services/video-engine/fast-preview-export'

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
    if (patch.telemetryEnabled !== undefined) setSentryEnabled(!telemetryForcedOff() && next.telemetryEnabled)
    // Stock-footage keys are read when the video engine is constructed, so a key
    // change has to rebuild it or the new provider never appears in the studio.
    if (patch.beta !== undefined) resetVideoEngine()
    return next
  })
  ipcMain.handle('caps:get', (_e, force?: boolean) => probeRenderCapabilities(!!force))
  // Compose's GPU status chip: combine the ffmpeg/nvidia-smi vendor probe (fast, cached)
  // with the actual WebCodecs hardware-encode probe the Compose render path depends on.
  ipcMain.handle('gpu:status', async () => {
    const caps = probeRenderCapabilities()
    const ready = await probeGpuEngine()
    return {
      hardware: ready.hardware,
      supported: ready.supported,
      detail: ready.detail,
      vendor: caps.gpuVendor,
      gpuName: caps.nvidiaGpuName || undefined
    }
  })
  ipcMain.handle('appMeta:get', (_e, key: string) => getRepos().appMeta(reqId(key, 'key')) ?? '')
  ipcMain.handle('appMeta:set', (event, key: string, value: string) => {
    const safeKey = reqId(key, 'key')
    // A deliberately isolated recorder command reuses the tiny appMeta invoke bridge so
    // the normal NativeApi/video-engine contract and deterministic render queue stay
    // unchanged. It never writes this reserved key to the database.
    if (safeKey === FAST_PREVIEW_EXPORT_COMMAND) {
      const senderWithPrefs = event.sender as unknown as { getLastWebPreferences?: () => { preload?: string } }
      const preferences = senderWithPrefs.getLastWebPreferences?.()
      const settings = getSettings()
      return exportFastPreview({
        projectId: reqId(value, 'projectId'),
        sourceUrl: event.sender.getURL(),
        preloadPath: preferences?.preload,
        outputFolder: settings.fastPreviewFolder || settings.libraryFolder || settings.outputFolder || undefined
      })
    }
    getRepos().setAppMeta(safeKey, String(value))
  })
  ipcMain.handle('shell:revealPath', async (_e, targetPath: string) => {
    const p = String(targetPath || '')
    if (!p) return
    if (existsSync(p)) shell.showItemInFolder(p)
    else await shell.openPath(dirname(p))
  })
  ipcMain.handle('shell:openPath', async (_e, targetPath: string) => {
    const p = String(targetPath || '')
    if (!p) return ''
    return shell.openPath(p)
  })
  // Factory reset: settings back to defaults + wipe all projects/profiles/channels/jobs.
  ipcMain.handle('app:reset', async () => {
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
  ipcMain.handle('visualTemplates:list', () => getRepos().visualTemplates())
  ipcMain.handle('visualTemplates:save', (_e, t: VisualTemplate) => getRepos().saveVisualTemplate(t))
  ipcMain.handle('visualTemplates:delete', (_e, id: string) => getRepos().deleteVisualTemplate(reqId(id)))
  ipcMain.handle('sources:unpublishedCount', (_e, sourceIds: string[]) => countUnpublishedVideos(sourceIds))
  ipcMain.handle('batch:launch', (_e, input: AutomationLaunchInput) => launchAutomation(input))
  ipcMain.handle('db:recentUploads', (_e, limit?: number) => getRepos().recentUploads(limit ?? 8))
  ipcMain.handle('db:updateChannelGoals', (_e, id: string, patch: GoalsPatch) => {
    getRepos().updateChannelGoals(reqId(id), patch)
    return getRepos().myChannels()
  })
  ipcMain.handle('db:setChannelSource', (_e, id: string, linkedSourceId: string | null) => {
    getRepos().setChannelSource(reqId(id), linkedSourceId ? reqId(linkedSourceId) : null)
    return getRepos().myChannels()
  })
  ipcMain.handle('db:deleteMyChannel', (_e, id: string) => {
    getRepos().deleteMyChannel(reqId(id))
    return getRepos().myChannels()
  })

  // ---- P1: per-video work items + fuzzy upload detection ----
  ipcMain.handle('db:workItems', () => getRepos().workItems())
  ipcMain.handle('workItems:detect', () => runUploadDetection({ force: true, trigger: 'manual' }))
  ipcMain.handle('workItems:setUploaded', (_e, videoId: string, uploaded: boolean) => {
    getRepos().setWorkItemUploaded(reqId(videoId, 'videoId'), !!uploaded)
  })
  ipcMain.handle('workItems:setArchived', (_e, videoId: string, archived: boolean) => {
    getRepos().setWorkItemArchived(reqId(videoId, 'videoId'), !!archived)
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

  // ---- publish hub: uploaded/not-uploaded + drag-out (P2 H) ----
  registerPublishIpc()

  // ---- image library: reuse images across projects, grouped by channel (P2 I) ----
  registerAssetsIpc()

  // ---- master library: reorganize-existing migration (P0) ----
  registerLibraryIpc()
  // ---- niche b-roll pools (P3) ----
  registerNicheIpc()

  // ---- automation: profiles + scheduler (M7) ----
  registerAutomationIpc()
  ipcMain.handle('automation:tick', () => tick())

  // ---- storage env roots (settings badge + D-aware fallback) ----
  registerStorageIpc()

  // ---- TalkingPhotos long-form: chunk a source audio, render each piece, stitch, download ----
  registerTalkingPhotosIpc()

  // ---- template video engine: Remotion + HyperFrames Compose studio ----
  registerVideoEngineIpc()

  // ---- beta: effect-plan generation (Meta preferred, Groq fallback; reuses transcription key if Meta missing) ----
  ipcMain.handle('effects:generate', async (_e, projectId: string, style: import('../../shared/types').VideoStyle) => {
    const project = getRepos().getProject(reqId(projectId, 'projectId'))
    if (!project) throw new Error('project missing')
    const words = getRepos().getTranscript(projectId)
    const { generatePlanWithFallback } = await import('../services/effects')
    const settings = getSettings()
    const { json } = await generatePlanWithFallback({
      groqKey: settings.transcription.apiKey.trim() || process.env['GROQ_API_KEY'] || '',
      metaKey: settings.beta.metaKey?.trim() || process.env['META_API_KEY'] || process.env['MODEL_API_KEY'] || ''
    }, words, style, project.durationSec)
    return json
  })
}