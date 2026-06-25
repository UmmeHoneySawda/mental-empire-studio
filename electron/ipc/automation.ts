import { ipcMain } from 'electron'
import type { AutomationEvent, Profile, ScrapedVideo } from '../../shared/types'
import { getRepos } from '../db'
import { sourceVideos } from './scrape'
import { startDownloads } from './download'
import { createProject, sendToRender } from './compose'
import { emit, hhmm, pushActivity } from './events'
import { postWebhook } from '../services/webhook'
import { notifyMessage } from '../services/notify'

// Profile run orchestrator (req #2 / #3). Reuses the scrape → download → compose →
// render functions. Interactive runs return the new project ids so the renderer can
// open the first for quick-edit; headless (auto-watch) runs queue them directly.

/** Source videos newer than the cursor. yt-dlp returns newest-first, so new uploads
 *  are the entries *before* the cursor id; an unknown/absent cursor means "all". */
export function newVideos(scraped: ScrapedVideo[], lastSeenId?: string): ScrapedVideo[] {
  if (!lastSeenId) return scraped
  const idx = scraped.findIndex((v) => v.id === lastSeenId)
  return idx === -1 ? scraped : scraped.slice(0, idx)
}

const inFlight = new Set<string>()

function emitA(e: AutomationEvent): void {
  emit('automation:event', e)
}

export async function runProfile(profileId: string, headless = false): Promise<string[]> {
  const repos = getRepos()
  const profile = repos.getProfile(profileId)
  if (!profile) throw new Error(`Unknown profile: ${profileId}`)
  if (inFlight.has(profileId)) return [] // re-entrancy guard
  inFlight.add(profileId)
  try {
    emitA({ profileId, profileName: profile.name, phase: 'scraping', message: 'Checking source' })
    const scraped = await sourceVideos(profile.sourceUrl, profile.sourceOrder, profile.sourceCount)
    const list = headless ? newVideos(scraped, profile.lastSeenVideoId) : scraped
    if (list.length === 0) {
      emitA({ profileId, profileName: profile.name, phase: 'done', message: 'No new uploads', projectIds: [] })
      return []
    }

    emitA({ profileId, profileName: profile.name, phase: 'downloading', message: `Downloading ${list.length}` })
    const dls = await startDownloads(list, { bitrate: 192, sourceUrl: profile.sourceUrl })

    emitA({ profileId, profileName: profile.name, phase: 'composing', message: 'Building projects' })
    const projectIds: string[] = []
    for (const dl of dls) {
      const proj = createProject(dl.id)
      repos.updateProject(proj.id, {
        imageMode: profile.imageMode,
        poolSize: profile.poolSize,
        kenBurns: profile.kenBurns,
        captionPreset: profile.captionPreset,
        captionAspect: profile.captionAspect,
        // Inherit the profile's beta-feature defaults (hook/highlight/overlay/zoom/b-roll/style).
        ...(profile.betaOpts ? { betaOpts: profile.betaOpts } : {})
      })
      projectIds.push(proj.id)
      if (headless) sendToRender(proj.id)
    }

    // advance the auto-watch cursor to the newest video seen this run
    repos.setProfileCursor(profileId, { lastSeenVideoId: scraped[0]?.id, lastRunAt: new Date().toISOString() })
    pushActivity({ t: hhmm(), icon: '▶', color: '#f5b323', text: `${profile.name}: ${dls.length} ${headless ? 'queued for render' : 'staged for edit'}` })
    await postWebhook('profile_run', { profile: profile.name, count: dls.length, headless })
    if (headless) notifyMessage('Auto-watch', `${profile.name}: ${dls.length} new video(s) queued`)

    emitA({ profileId, profileName: profile.name, phase: headless ? 'queued' : 'done', message: `${dls.length} processed`, projectIds })
    return projectIds
  } catch (e) {
    emitA({ profileId, profileName: profile.name, phase: 'error', message: (e as Error).message })
    throw e
  } finally {
    inFlight.delete(profileId)
  }
}

export function registerAutomationIpc(): void {
  ipcMain.handle('automation:runProfile', (_e, id: string, headless?: boolean) => runProfile(id, !!headless))
  ipcMain.handle('automation:upsertProfile', (_e, p: Profile) => getRepos().upsertProfile(p))
  ipcMain.handle('automation:deleteProfile', (_e, id: string) => getRepos().deleteProfile(id))
}
