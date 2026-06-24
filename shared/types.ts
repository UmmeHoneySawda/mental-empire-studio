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

// ---- Settings (persisted later via electron-store) ----
export interface AppSettings {
  accent: AccentName
  ambientGlow: boolean
  showActivityRail: boolean
  defaultScreen: ScreenKey
  namingTemplate: string
  concurrency: number
  quality: '720p' | '1080p' | '1440p'
  autoScrape: { enabled: boolean; frequency: string; delaySec: number; retries: number; proxy: string }
  background: { tray: boolean; startOnSignIn: boolean; notifications: boolean; webhook: string }
}

// ---- Native bridge surface (implemented in later milestones) ----
export interface NativeApi {
  platform: NodeJS.Platform | 'web'
  minimize(): void
  maximize(): void
  close(): void
  // backend stubs filled in M2+
  getSettings?(): Promise<AppSettings>
  setSettings?(patch: Partial<AppSettings>): Promise<void>
}

declare global {
  interface Window {
    api: NativeApi
  }
}
