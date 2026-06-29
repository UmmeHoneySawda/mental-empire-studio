import { ipcMain } from 'electron'
import type {
  MyChannel,
  ReminderHit,
  ScrapeOrder,
  ScrapeProgress,
  ScrapedChannel,
  Upload
} from '../../shared/types'
import { getSettings } from '../store/settings'
import { getRepos } from '../db'
import { channelUrl, humanizeCount, orderVideos, scrapeChannel } from '../services/scraper'
import { matchDownloadsToUploads } from '../services/mapping'
import { runUploadDetection } from '../services/uploads-detect'
import { goalProgressFromUploads } from '../../shared/goals'
import { notify, reminderHit } from '../services/notify'
import { warmBrollLibraryFromTitles } from '../services/broll'
import { L } from '../services/logger'
import { emit, hhmm, pushActivity } from './events'

// Orchestration layer: the services are pure; here we wire scrape → DB → mapping →
// notify and stream progress/activity events to the renderer. (Screens consume these
// in M4; the M3 harness exercises them now.)

const AVATARS = [
  'linear-gradient(135deg,#f5b323,#b9780a)',
  'linear-gradient(135deg,#8b7cff,#5b4fd6)',
  'linear-gradient(135deg,#36c98e,#1f9c6b)',
  'linear-gradient(135deg,#ff5a6e,#d23146)',
  'linear-gradient(135deg,#2d3340,#1a1e26)'
]

function avatarFor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATARS[h % AVATARS.length]
}

function monoFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (name.slice(0, 2) || '?').toUpperCase()
}

function emitProgress(p: ScrapeProgress): void {
  emit('scrape:progress', p)
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const BROLL_LIBRARY_TITLE_COUNT = 80
const warmingSources = new Set<string>()

function hasStockBrollSource(): boolean {
  const settings = getSettings()
  return !!(settings.beta.pexelsKey || settings.beta.pixabayKey || settings.beta.coverrKey || process.env['ME_BROLL_LOCAL'] || process.env['ME_BROLL_FIXTURE'])
}

export async function warmSourceBrollLibrary(
  url: string,
  order: ScrapeOrder = 'Popular',
  opts: { sourceKey?: string; displayName?: string; seedTitles?: string[] } = {}
): Promise<void> {
  if (!url.trim() || !hasStockBrollSource()) return
  const settings = getSettings()
  const sourceKey = opts.sourceKey ?? `src-${channelUrl(url).replace(/[^A-Za-z0-9]+/g, '_')}`
  if (warmingSources.has(sourceKey)) return
  warmingSources.add(sourceKey)
  let titles = opts.seedTitles ?? []
  let displayName = opts.displayName || url
  try {
    if (titles.length < 50) {
      const ch = await scrapeChannel(url, settings, { flat: true, limit: BROLL_LIBRARY_TITLE_COUNT })
      titles = orderVideos(ch.videos, order, BROLL_LIBRARY_TITLE_COUNT).map((v) => v.title)
      displayName = opts.displayName || ch.name || displayName
    }
    const res = await warmBrollLibraryFromTitles(settings, titles, {
      sourceKey,
      targetClips: 80,
      dims: { w: 1920, h: 1080 }
    })
    if (res) pushActivity({ t: hhmm(), icon: '▣', color: '#8b7cff', text: `B-roll library warmed: ${res.clips} clips for ${displayName}` })
  } catch (e) {
    L.warn(`B-roll library warm failed for ${url}: ${(e as Error).message}`)
  } finally {
    warmingSources.delete(sourceKey)
  }
}

/** Persist a scrape result against an existing my_channels row: stats, uploads, mapping, notify. */
function persistScrape(channelId: string, scraped: ScrapedChannel): MyChannel {
  const repos = getRepos()
  const settings = getSettings()
  const now = new Date().toISOString()
  const current = repos.myChannel(channelId)
  const stats = {
    views: scraped.totalViews > 0 ? humanizeCount(scraped.totalViews) : '',
    subs: humanizeCount(scraped.subs),
    total: scraped.videos.length,
    lastScrapedAt: now
  }

  emitProgress({ channelId, channelName: scraped.name, phase: 'stats', message: 'Saving stats' })
  if (current) {
    const name = scraped.name || current.name
    repos.upsertMyChannel({
      ...current,
      name,
      handle: scraped.handle || current.handle,
      mono: monoFor(name),
      avatar: scraped.avatar ?? current.avatar ?? avatarFor(channelId),
      ...stats
    })
  } else {
    repos.setChannelStats(channelId, stats)
  }

  emitProgress({ channelId, channelName: scraped.name, phase: 'uploads', message: 'Saving uploads' })
  const uploads: Upload[] = scraped.videos.map((v) => ({
    id: v.id,
    myChannelId: channelId,
    title: v.title,
    youtubeVideoId: v.id,
    publishedAt: v.uploadDate,
    views: v.views > 0 ? humanizeCount(v.views) : '',
    thumb: v.thumb
  }))
  repos.replaceUploads(channelId, uploads)

  // A4: derive real weekly/monthly publishing progress from the upload dates so the
  // "behind pace" reminder reflects actual output instead of a static seeded number.
  repos.setChannelGoalProgress(channelId, ...goalProgressFromUploads(uploads))

  emitProgress({ channelId, channelName: scraped.name, phase: 'mapping', message: 'Mapping uploads' })
  const channel = repos.myChannel(channelId)
  const linkedSourceId = channel?.linkedSourceId
  if (linkedSourceId) {
    const downloads = repos.getDownloadsBySource(linkedSourceId)
    const mapping = matchDownloadsToUploads(
      downloads.map((d) => ({ id: d.id, title: d.title })),
      uploads.map((u) => ({ id: u.id, title: u.title }))
    )
    repos.setChannelMapping(channelId, mapping.mapDone, mapping.mapTotal)
    repos.markDownloadMatches(mapping.matches)
  } else {
    repos.setChannelMapping(channelId, 0, 0)
  }

  const updated = repos.myChannel(channelId) as MyChannel
  const hit = reminderHit(updated)
  if (hit) notify(hit, settings)

  // Now that this channel's uploads are saved, refresh which processed videos look
  // already-uploaded (fuzzy title match across all owned channels).
  try { runUploadDetection() } catch { /* detection is advisory */ }

  pushActivity({ t: hhmm(), icon: '↻', color: '#8b7cff', text: `Scraped ${updated.name} — ${uploads.length} uploads` })
  emitProgress({ channelId, channelName: updated.name, phase: 'done', message: 'Done' })
  return updated
}

export async function addMyChannel(url: string, linkedSourceId?: string): Promise<MyChannel> {
  const repos = getRepos()
  const settings = getSettings()
  emitProgress({ channelId: url, channelName: url, phase: 'start', message: 'Scraping channel' })
  const scraped = await scrapeChannel(url, settings)
  const id = scraped.channelId || `mc-${scraped.handle.replace(/^@/, '')}`
  const source = linkedSourceId ? repos.sourceChannels().find((s) => s.id === linkedSourceId) : undefined

  const base: MyChannel = {
    id,
    name: scraped.name,
    handle: scraped.handle,
    mono: monoFor(scraped.name),
    // Prefer the real channel avatar URL when yt-dlp provides one; fall back to the
    // deterministic CSS gradient so the card always has something to render.
    avatar: scraped.avatar ?? avatarFor(id),
    views: scraped.totalViews > 0 ? humanizeCount(scraped.totalViews) : '',
    subs: humanizeCount(scraped.subs),
    total: scraped.videos.length,
    linkedSourceId,
    source: source?.handle ?? '',
    mapDone: 0,
    mapTotal: 0,
    weekDone: 0,
    weekGoal: 5,
    monthDone: 0,
    monthGoal: 20,
    reminder: 'On track',
    reminderNote: 'Newly added',
    lastScrapedAt: new Date().toISOString()
  }
  repos.upsertMyChannel(base)
  return persistScrape(id, scraped)
}

export async function refreshChannel(id: string): Promise<MyChannel> {
  const repos = getRepos()
  const settings = getSettings()
  const channel = repos.myChannel(id)
  if (!channel) throw new Error(`Unknown channel: ${id}`)
  emitProgress({ channelId: id, channelName: channel.name, phase: 'start', message: 'Re-scraping' })
  const scraped = await scrapeChannel(channelUrl(channel.handle), settings)
  return persistScrape(id, scraped)
}

export async function scrapeAll(): Promise<MyChannel[]> {
  const repos = getRepos()
  const settings = getSettings()
  const ids = repos.myChannels().map((c) => c.id)
  const out: MyChannel[] = []
  for (let i = 0; i < ids.length; i++) {
    out.push(await refreshChannel(ids[i]))
    if (i < ids.length - 1) await sleep((settings.autoScrape.delaySec || 0) * 1000) // throttle
  }
  return out
}

export async function sourceVideos(url: string, order: ScrapeOrder, count: number) {
  const repos = getRepos()
  const settings = getSettings()
  // "Popular" needs real per-video view counts, which the fast flat dump omits (so it
  // used to be a no-op that just returned latest order). Fetch a bounded non-flat pool
  // for Popular and sort it; Latest/Oldest stay on the fast flat path.
  const popular = order === 'Popular'
  const poolLimit = popular ? Math.min(Math.max(count * 4, 20), 40) : count
  const ch = await scrapeChannel(url, settings, { flat: !popular, limit: poolLimit })
  const ordered = orderVideos(ch.videos, order, count)
  const existing = repos.sourceChannelByUrl(channelUrl(url))
  const sourceId = existing?.id ?? `src-${ch.handle.replace(/^@/, '')}`
  repos.upsertSourceChannel({ id: sourceId, url: channelUrl(url), handle: ch.handle, name: ch.name })
  repos.replaceSourceVideos(sourceId, ordered)
  void warmSourceBrollLibrary(url, order, { sourceKey: sourceId, displayName: ch.name, seedTitles: ordered.map((v) => v.title) })
  return ordered
}

export function checkReminders(): ReminderHit[] {
  const settings = getSettings()
  const hits: ReminderHit[] = []
  for (const c of getRepos().myChannels()) {
    const hit = reminderHit(c)
    if (hit) {
      notify(hit, settings)
      hits.push(hit)
    }
  }
  return hits
}

export function registerScrapeIpc(): void {
  ipcMain.handle('scrape:channel', (_e, url: string) => scrapeChannel(url, getSettings()))
  ipcMain.handle('scrape:addMyChannel', (_e, url: string, linkedSourceId?: string) => addMyChannel(url, linkedSourceId))
  ipcMain.handle('scrape:refreshChannel', (_e, id: string) => refreshChannel(id))
  ipcMain.handle('scrape:all', () => scrapeAll())
  ipcMain.handle('scrape:sourceVideos', (_e, url: string, order: ScrapeOrder, count: number) => sourceVideos(url, order, count))
  ipcMain.handle('reminders:check', () => checkReminders())
}
