import { ipcMain } from 'electron'
import type { AutomationEvent, Profile, ScrapedVideo } from '../../shared/types'
import { getRepos } from '../db'
import { sourceVideos, warmSourceBrollLibrary } from './scrape'
import { startDownloads } from './download'
import { createProject, runTranscribe, sendToRender } from './compose'
import { emit, hhmm, pushActivity } from './events'
import { getSettings } from '../store/settings'
import { postWebhook } from '../services/webhook'
import { notifyMessage } from '../services/notify'
import { L } from '../services/logger'

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
    const settings = getSettings()
    const canAutoTranscribe = !!settings.transcription.apiKey?.trim()
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
    const succeeded = new Set<string>()
    for (let i = 0; i < dls.length; i++) {
      const dl = dls[i]
      const sourceVideo = list[i]
      try {
        if (!dl.filePath || !dl.durationSec || dl.stage === 'Failed') {
          throw new Error(dl.stage === 'Failed' ? 'download failed' : 'download did not produce a usable MP3')
        }
        const proj = createProject(dl.id)
        repos.updateProject(proj.id, {
          imageMode: profile.imageMode,
          poolSize: profile.poolSize,
          kenBurns: profile.kenBurns,
          captionPreset: profile.captionPreset,
          captionFont: profile.captionFont ?? 'Montserrat',
          captionAnim: profile.captionAnim ?? 'Pop-in',
          captionAspect: profile.captionAspect,
          captionLines: profile.captionLines ?? 1,
          captionPosition: profile.captionPosition ?? 'bottom',
          captionPace: profile.captionPace ?? 'auto',
          // Inherit the profile's beta-feature defaults (hook/highlight/overlay/zoom/b-roll/style).
          ...(profile.betaOpts ? { betaOpts: profile.betaOpts } : {})
        })
        projectIds.push(proj.id)
        succeeded.add(sourceVideo.id)
        if (canAutoTranscribe) {
          emitA({ profileId, profileName: profile.name, phase: 'transcribing', message: `Transcribing ${i + 1}/${dls.length}` })
          try {
            await runTranscribe(proj.id)
          } catch (e) {
            const msg = (e as Error).message
            emitA({ profileId, profileName: profile.name, phase: 'composing', message: `Transcription skipped: ${msg.slice(0, 90)}` })
            pushActivity({ t: hhmm(), icon: '!', color: '#f5b323', text: `${profile.name}: transcription skipped for ${sourceVideo.title.slice(0, 30)} — ${msg.slice(0, 70)}` })
          }
        } else {
          emitA({ profileId, profileName: profile.name, phase: 'composing', message: 'Project ready; add Groq key to auto-transcribe' })
        }
        if (headless) sendToRender(proj.id)
      } catch (e) {
        const msg = (e as Error).message
        emitA({ profileId, profileName: profile.name, phase: 'error', message: `${sourceVideo.title}: ${msg}` })
        pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `${profile.name}: skipped ${sourceVideo.title.slice(0, 34)} — ${msg.slice(0, 70)}` })
      }
    }
    if (projectIds.length === 0) throw new Error('No videos completed successfully')

    // Advance only on a fully successful batch. With YouTube's newest-first cursor,
    // moving past a partial failure can hide older failed uploads forever.
    const cursor = succeeded.size === list.length ? list[0]?.id : profile.lastSeenVideoId
    repos.setProfileCursor(profileId, { lastSeenVideoId: cursor, lastRunAt: new Date().toISOString() })
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

export function upsertProfileAndWarm(p: Profile): Profile[] {
  const profiles = getRepos().upsertProfile(p)
  if (p.sourceUrl?.trim()) {
    void warmSourceBrollLibrary(p.sourceUrl, p.sourceOrder, {
      sourceKey: p.linkedSourceId || `profile-${p.id}`,
      displayName: p.name
    }).catch((e) => {
      L.warn(`profile B-roll warm failed profile=${p.id}: ${(e as Error).message}`)
    })
  }
  return profiles
}

export function registerAutomationIpc(): void {
  ipcMain.handle('automation:runProfile', (_e, id: string, headless?: boolean) => runProfile(id, !!headless))
  ipcMain.handle('automation:upsertProfile', (_e, p: Profile) => upsertProfileAndWarm(p))
  ipcMain.handle('automation:deleteProfile', (_e, id: string) => getRepos().deleteProfile(id))
}
