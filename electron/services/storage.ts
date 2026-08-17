import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSettings } from '../store/settings'
import { safeName } from '../../shared/sanitize'
import type { Project } from '../../shared/types'

// Single source of truth for every on-disk path the app writes (P0 of the workflow
// redesign). Before this, paths were duplicated across download/compose/queue/thumbnails/
// broll/sfx and scattered across <Downloads>, <userData> and the OS temp dir. Everything
// now hangs off ONE configurable library root with a deterministic, per-video layout:
//
//   <LibraryRoot>/
//     <Channel>/
//       <videoId>__<slug>/
//         audio/  images/  captions/  broll/  thumb/  output/   project.json
//     _cache/            transient scratch (sfx, previews, broll-cache) — safe to wipe
//
// Keeping it in one module means the per-video reorg + future phases are a one-file change
// plus call-site swaps, and the reorganize-existing migration (storage-migrate.ts) can
// reuse the exact same builders so new + migrated items land in identical places.

/** Folder under the library root for transient scratch that is safe to delete. */
export const CACHE_DIR = '_cache'

const LIBRARY_ENV_KEYS = [
  'MENTAL_EMPIRE_LIBRARY',
  'ME_LIBRARY_ROOT',
  'ME_LIBRARY_DIR',
  'MENTAL_EMPIRE_OUTPUT',
  'ME_OUTPUT_DIR'
] as const

/** First non-empty trim of the Windows env vars above; used to redirect the library to D:. */
export function envLibraryRoot(): string | undefined {
  for (const key of LIBRARY_ENV_KEYS) {
    const v = (process.env[key] || '').trim()
    if (v) return v
  }
  return undefined
}

export const VIDEO_ENGINE_ENV_KEYS = [
  'MENTAL_EMPIRE_VIDEO_ENGINE',
  'ME_VIDEO_ENGINE_DIR',
  'ME_VIDEO_ENGINE_ROOT',
] as const

export function envVideoEngineRoot(): string | undefined {
  for (const key of VIDEO_ENGINE_ENV_KEYS) {
    const v = (process.env[key] || '').trim()
    if (v) return v
  }
  // Derive from library env: libraryRoot already on D: → video-engine lives beside it
  const lib = envLibraryRoot()
  if (lib) return join(lib, 'video-engine')
  return undefined
}

export function preferredDefaultRoot(): string {
  // User asked: D: is preferred, C: is legacy fallback. Probe D: existence.
  try {
    if (existsSync('D:\\')) return join('D:\\', 'MentalEmpireStudio')
  } catch {}
  return join(app.getPath('documents'), 'MentalEmpireStudio')
}

/** The master library root. Precedence: Windows env var → settings.libraryFolder → legacy
 *  outputFolder → <Documents>/MentalEmpireStudio (C: default). Env wins so a system
 *  variable like `setx MENTAL_EMPIRE_LIBRARY "D:\MentalEmpireStudio"` moves all automation
 *  renders to D: without touching Settings; unsetting the var falls straight back to C:. */
export function libraryRoot(): string {
  const env = envLibraryRoot()
  if (env) return env
  const s = getSettings()
  const chosen = (s.libraryFolder || '').trim() || (s.outputFolder || '').trim()
  return chosen || join(app.getPath('documents'), 'MentalEmpireStudio')
}

/** A URL/filename-safe, lowercase slug for the per-video folder suffix. */
export function slug(title: string): string {
  const base = (title || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return base || 'untitled'
}

/** A download id is `dl-<videoId>`; recover the bare video id (the stable workspace key). */
export function videoIdFromDownloadId(downloadId: string): string {
  return downloadId.replace(/^dl-/, '') || downloadId
}

/** A project id is `proj-dl-<videoId>`; recover the bare video id. */
export function videoIdFromProjectId(projectId: string): string {
  return projectId.replace(/^proj-/, '').replace(/^dl-/, '') || projectId
}

export interface ItemRef {
  channel: string
  /** bare YouTube video id (NOT prefixed) — the stable per-item key */
  videoId: string
  title: string
}

/** mkdir -p, returning the path for chaining. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

export function channelDir(channel: string): string {
  return join(libraryRoot(), safeName(channel, 'Unknown'))
}

/** Folder name for one video item, e.g. `dQw4w9WgXcQ__never-gonna-give-you-up`. */
export function itemFolderName(ref: ItemRef): string {
  return `${safeName(ref.videoId, 'item')}__${slug(ref.title)}`
}

export function itemDir(ref: ItemRef): string {
  return join(channelDir(ref.channel), itemFolderName(ref))
}

/** Build an ItemRef from a Project (channel + title + downloadId → videoId). */
export function itemRefForProject(p: Pick<Project, 'channel' | 'title' | 'downloadId'>): ItemRef {
  return { channel: p.channel, videoId: videoIdFromDownloadId(p.downloadId), title: p.title }
}

export function itemDirForProject(p: Pick<Project, 'channel' | 'title' | 'downloadId'>): string {
  return itemDir(itemRefForProject(p))
}

// ---- per-item sub-folders (named item* to avoid clashing with queue.outputDir) ----
export function itemAudioDir(item: string): string { return join(item, 'audio') }
export function itemImagesDir(item: string): string { return join(item, 'images') }
export function itemCaptionsDir(item: string): string { return join(item, 'captions') }
export function itemBrollDir(item: string): string { return join(item, 'broll') }
export function itemThumbDir(item: string): string { return join(item, 'thumb') }
export function itemOutputDir(item: string): string { return join(item, 'output') }

/** Transient scratch dir (e.g. cacheDir('sfx'), cacheDir('previews'), cacheDir('broll')). */
export function cacheDir(sub: string): string {
  return join(libraryRoot(), CACHE_DIR, sub)
}

// ---- per-item project.json manifest (portable, human-browsable snapshot) ----
export interface ProjectManifest {
  schema: 1
  videoId: string
  channel: string
  title: string
  durationSec: number
  stage: string
  createdAt: string
  updatedAt: string
  audioPath?: string
  imagePaths?: string[]
  thumbPath?: string
  outputPath?: string
}

export function projectJsonPath(item: string): string {
  return join(item, 'project.json')
}

/** Write/merge the per-item manifest. Best-effort: never throws into the caller's flow. */
export function writeProjectManifest(item: string, patch: Partial<ProjectManifest>): void {
  try {
    ensureDir(item)
    const path = projectJsonPath(item)
    let current: Partial<ProjectManifest> = {}
    if (existsSync(path)) {
      try { current = JSON.parse(readFileSync(path, 'utf8')) as Partial<ProjectManifest> } catch { current = {} }
    }
    const merged: ProjectManifest = {
      schema: 1,
      videoId: '',
      channel: '',
      title: '',
      durationSec: 0,
      stage: '',
      createdAt: current.createdAt ?? new Date().toISOString(),
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    writeFileSync(path, JSON.stringify(merged, null, 2))
  } catch {
    /* manifest is advisory; ignore write failures */
  }
}
