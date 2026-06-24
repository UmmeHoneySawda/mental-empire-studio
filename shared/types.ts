// Domain + IPC types shared between the Electron main process and the React renderer.
// The native backend (yt-dlp, ffmpeg, scraper, scheduler) is wired in later milestones;
// these types define the contract the UI is built against now.

export type AccentName = 'Amber' | 'Violet' | 'Emerald' | 'Crimson'

export type ScreenKey =
  | 'library'
  | 'channels'
  | 'download'
  | 'compose'
  | 'thumb'
  | 'render'
  | 'profiles'
  | 'settings'

export type UploadStatus = 'Uploaded' | 'Scheduled' | 'Draft'

export interface MyChannel {
  id: string
  name: string
  handle: string
  mono: string
  avatar: string
  views: string
  subs: string
  total: number
  /** id of the linked SourceChannel this channel republishes from */
  linkedSourceId?: string
  source: string
  mapDone: number
  mapTotal: number
  weekDone: number
  weekGoal: number
  monthDone: number
  monthGoal: number
  reminder: string
  reminderNote: string
  /** ISO timestamp of the last successful scrape (M3) */
  lastScrapedAt?: string
}

export interface SourceChannel {
  id: string
  url: string
  handle: string
  name: string
}

export interface DownloadedVideo {
  id: string
  sourceId: string
  title: string
  channel: string
  size: string
  when: string
  /** pipeline stage label, e.g. "Downloaded only" | "Needs thumbnail" | "Captioned" | "Uploaded" */
  stage: string
  pct: string
  action: 'Resume' | 'Open'
  thumb: string
  /** id of the Upload this download was fuzzy-matched to (M3 mapping) */
  matchedUploadId?: string
}

/** A video published on one of my own channels (scraped from its uploads tab). */
export interface Upload {
  id: string
  myChannelId: string
  title: string
  youtubeVideoId: string
  publishedAt: string
  views: string
  /** id of the DownloadedVideo this upload was fuzzy-matched to, if any */
  matchedDownloadId?: string
}

// ---- Scraping (M3) ----
export type ScrapeOrder = 'Popular' | 'Latest' | 'Oldest'

/** One video parsed from a yt-dlp flat-playlist entry. */
export interface ScrapedVideo {
  id: string
  title: string
  durationSec: number
  views: number
  uploadDate: string
  thumb: string
}

/** Channel-level stats + video list returned by a scrape. */
export interface ScrapedChannel {
  handle: string
  name: string
  channelId: string
  subs: number
  /** lifetime views — best-effort (about page) with a labeled fallback to summed video views */
  totalViews: number
  totalViewsExact: boolean
  videos: ScrapedVideo[]
}

/** Streamed progress for a long scrape (one channel at a time). */
export interface ScrapeProgress {
  channelId: string
  channelName: string
  phase: 'start' | 'stats' | 'uploads' | 'mapping' | 'done' | 'error'
  message: string
}

/** Result of fuzzy-matching downloaded source videos against my uploads. */
export interface MappingResult {
  mapDone: number
  mapTotal: number
  matches: { downloadId: string; uploadId: string }[]
}

/** A channel flagged as behind pace by the reminder check. */
export interface ReminderHit {
  channelId: string
  channelName: string
  pending: number
  message: string
}

export interface Profile {
  id: string
  name: string
  mono: string
  avatar: string
  rule: string
  images: string
  thumb: string
  cap: string
  out: string
  autoWatch: boolean
}

// ---- Thumbnail editor model (req #4) ----
export type LayerKind = 'background' | 'subject' | 'text' | 'shape'

export interface BaseLayer {
  id: string
  kind: LayerKind
  name: string
  visible: boolean
  locked: boolean
}

export interface TextLayer extends BaseLayer {
  kind: 'text'
  text: string
  lines: { text: string; size: number }[]
  highlightWord?: string
  highlightColor: string
  highlightSquare: boolean
  effects: { shadow: boolean; stroke: boolean; glow: boolean; caps: boolean }
}

export interface SubjectLayer extends BaseLayer {
  kind: 'subject'
  mode: 'cutout' | 'image'
  outline: boolean
  shadow: boolean
  glow: boolean
}

export interface ShapeLayer extends BaseLayer {
  kind: 'shape'
  shape: 'rect' | 'circle' | 'arrow'
  color: string
}

export interface BackgroundLayer extends BaseLayer {
  kind: 'background'
  fill: string
  mode: 'solid' | 'gradient' | 'image'
}

export type ThumbnailLayer = TextLayer | SubjectLayer | ShapeLayer | BackgroundLayer

export interface ThumbnailTemplate {
  id: string
  name: string
  layers: ThumbnailLayer[]
}

export interface ActivityRow {
  t: string
  icon: string
  color: string
  text: string
}

// ---- Settings (persisted via electron-store) ----
export interface AppSettings {
  accent: AccentName
  ambientGlow: boolean
  showActivityRail: boolean
  defaultScreen: ScreenKey
  namingTemplate: string
  concurrency: number
  quality: '720p' | '1080p' | '1440p'
  autoScrape: { enabled: boolean; frequency: string; delaySec: number; retries: number; proxy: string; cookiesPath: string }
  background: { tray: boolean; startOnSignIn: boolean; notifications: boolean; webhook: string }
}

/** Canonical defaults — shared by the main-process store and the renderer's initial state. */
export const DEFAULT_SETTINGS: AppSettings = {
  accent: 'Amber',
  ambientGlow: true,
  showActivityRail: true,
  defaultScreen: 'library',
  namingTemplate: '{channel} - {title}',
  concurrency: 2,
  quality: '1080p',
  autoScrape: { enabled: true, frequency: 'Every 6 hours', delaySec: 1.5, retries: 3, proxy: '', cookiesPath: '' },
  background: { tray: true, startOnSignIn: true, notifications: true, webhook: '' }
}

/** Recursive partial — used for settings patches that touch only nested keys. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

// ---- Native bridge surface ----
export interface NativeApi {
  platform: NodeJS.Platform | 'web'
  minimize(): void
  maximize(): void
  close(): void
  settings: {
    get(): Promise<AppSettings>
    set(patch: DeepPartial<AppSettings>): Promise<AppSettings>
  }
  db: {
    myChannels(): Promise<MyChannel[]>
    sourceChannels(): Promise<SourceChannel[]>
    downloads(): Promise<DownloadedVideo[]>
    profiles(): Promise<Profile[]>
    templates(): Promise<ThumbnailTemplate[]>
    activity(): Promise<ActivityRow[]>
    upsertProfile(profile: Profile): Promise<Profile[]>
    saveTemplate(template: ThumbnailTemplate): Promise<ThumbnailTemplate[]>
  }
  scrape: {
    /** preview a channel's stats without persisting */
    channel(url: string): Promise<ScrapedChannel>
    /** scrape + persist a new owned channel, optionally linking a source */
    addMyChannel(url: string, linkedSourceId?: string): Promise<MyChannel>
    /** re-scrape one owned channel: stats, uploads, mapping */
    refreshChannel(id: string): Promise<MyChannel>
    /** re-scrape every owned channel */
    all(): Promise<MyChannel[]>
    /** fetch a source channel's videos for the Download picker (cached to DB) */
    sourceVideos(url: string, order: ScrapeOrder, count: number): Promise<ScrapedVideo[]>
  }
  reminders: {
    /** evaluate behind-pace channels, firing desktop notifications */
    check(): Promise<ReminderHit[]>
  }
  /** subscribe to live scrape progress; returns an unsubscribe fn */
  onScrapeProgress(cb: (p: ScrapeProgress) => void): () => void
  /** subscribe to new activity-log entries; returns an unsubscribe fn */
  onActivity(cb: (row: ActivityRow) => void): () => void
}

declare global {
  interface Window {
    api: NativeApi
  }
}
