import type { AppSettings, ScrapedChannel, ScrapedVideo, ScrapeOrder } from '../../shared/types'
import { runYtdlpJson, ytdlpOptionsFromSettings, type YtdlpEntry, type YtdlpPlaylist } from './ytdlp'

// High-level scraping: turn a channel URL/@handle into typed stats + a video list.
// The "no-API" promise is kept here — everything comes from yt-dlp's parse of the
// public web pages, no API key.

/** Normalise an @handle or partial URL into a full youtube.com channel URL. */
export function channelUrl(handleOrUrl: string): string {
  let u = handleOrUrl.trim()
  if (u.startsWith('@')) return `https://www.youtube.com/${u}`
  if (!/^https?:\/\//.test(u)) u = `https://www.youtube.com/${u}`
  return u
}

/** Target the uploads (videos) tab so yt-dlp returns the flat upload list directly. */
function videosTab(url: string): string {
  const base = url.replace(/\/+$/, '')
  return /\/(videos|streams|shorts|about)$/.test(base) ? base : `${base}/videos`
}

function handleOf(data: YtdlpPlaylist, fallbackUrl: string): string {
  if (data.uploader_id && data.uploader_id.startsWith('@')) return data.uploader_id
  const m = fallbackUrl.match(/@([A-Za-z0-9_.-]+)/)
  return m ? `@${m[1]}` : data.channel ?? fallbackUrl
}

function pickThumb(e: YtdlpEntry): string {
  const list = e.thumbnails ?? []
  if (list.length && list[list.length - 1].url) return list[list.length - 1].url as string
  // yt-dlp --flat-playlist usually omits thumbnails; YouTube's are deterministic from the id.
  return e.id ? `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg` : ''
}

function toScrapedVideo(e: YtdlpEntry): ScrapedVideo {
  return {
    id: e.id ?? '',
    title: e.title ?? '',
    durationSec: Math.round(e.duration ?? 0),
    views: e.view_count ?? 0,
    uploadDate: e.upload_date ?? '',
    thumb: pickThumb(e)
  }
}

/** Compact a raw count to the UI's display form (12400 → "12.4K", 1.2e6 → "1.2M"). */
export function humanizeCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(n)
}

/** Scrape a channel's stats + upload list. Pass `fetch:{ flat:false, limit }` to get
 *  real per-video view counts/durations (slower, count-limited) for the Download picker. */
export async function scrapeChannel(
  handleOrUrl: string,
  settings: AppSettings,
  fetch?: { flat?: boolean; limit?: number }
): Promise<ScrapedChannel> {
  const base = channelUrl(handleOrUrl)
  const data = await runYtdlpJson(videosTab(base), { ...ytdlpOptionsFromSettings(settings), ...fetch })
  const videos = (data.entries ?? []).filter((e): e is YtdlpEntry => !!e).map(toScrapedVideo)
  const summedViews = videos.reduce((a, v) => a + v.views, 0)
  // yt-dlp exposes the channel avatar as `thumbnail` at the playlist level, or as the
  // highest-resolution entry in `thumbnails`. Prefer an https URL; ignore data URIs.
  const rawThumb = data.thumbnail ?? data.thumbnails?.find((t) => t.url?.startsWith('https'))?.url
  const avatar = rawThumb?.startsWith('https') ? rawThumb : undefined
  return {
    handle: handleOf(data, base),
    name: data.channel ?? data.uploader ?? handleOf(data, base),
    channelId: data.channel_id ?? data.id ?? base,
    subs: data.channel_follower_count ?? 0,
    // Lifetime total-views isn't in the flat dump; sum scraped video views as a
    // labeled approximation (an exact about-page scrape can replace this later).
    totalViews: summedViews,
    totalViewsExact: false,
    videos,
    avatar
  }
}

/** Order a video list per the Download picker's tab and cap to `count`. */
export function orderVideos(videos: ScrapedVideo[], order: ScrapeOrder, count: number): ScrapedVideo[] {
  let vids = videos // yt-dlp returns newest-first
  if (order === 'Popular') vids = [...vids].sort((a, b) => b.views - a.views)
  else if (order === 'Oldest') vids = [...vids].reverse()
  return vids.slice(0, Math.max(1, count))
}

/** Scrape a source channel's videos for the Download picker, ordered + capped. */
export async function scrapeSourceVideos(
  handleOrUrl: string,
  order: ScrapeOrder,
  count: number,
  settings: AppSettings
): Promise<ScrapedVideo[]> {
  const ch = await scrapeChannel(handleOrUrl, settings)
  return orderVideos(ch.videos, order, count)
}
