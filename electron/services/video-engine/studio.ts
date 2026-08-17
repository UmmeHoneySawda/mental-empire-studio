import { app } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createCaptionDocument,
  DEFAULT_VIDEO_GRADING,
  HookPlanSchema,
  rescaleHookPlan,
  VideoProjectSchema,
  VideoSceneSchema,
  type CaptionWord,
  type RendererId,
  type VideoAsset,
  type VideoAssetKind,
  type VideoCanvasPatch,
  type VideoGradingPreset,
  type VideoProject,
  type VideoRenderJob,
  type VideoRendererCapabilities,
  type VideoStudioBinding
} from '../../../shared/video-engine'
import type { Project, ProjectImage, TranscriptWord } from '../../../shared/types'
import { getRepos } from '../../db'
import { getSettings } from '../../store/settings'
import { ffmpegPath, ffprobePath } from '../bin'
import { cacheDir, envLibraryRoot, envVideoEngineRoot } from '../storage'
import { brollLibraryDir } from '../broll'
import { createVideoEngine } from './factory'
import { VideoEngineError } from './errors'
import { ensureDirectory, resolveInside } from './paths'
import type { PreparedRender, RendererAdapter, RenderJobRecord } from './render/types'
import type { VideoEngineService } from './service'

/* Main-process glue between the UI-free video engine and the Compose studio.
 *
 * The engine itself stays framework-agnostic; everything Electron-specific —
 * where data lives, which b-roll providers are configured, how a downloaded clip
 * becomes an engine project, and how a live preview is staged — lives here. */

const BINDING_KEY_PREFIX = 've.binding.'

let enginePromise: Promise<VideoEngineService> | null = null
let engineOptionsKey = ''
let engineFailure = ''

let _cachedVideoEngineDProbe: boolean | null = null
function hasDDrive(): boolean {
  if (_cachedVideoEngineDProbe !== null) return _cachedVideoEngineDProbe
  try { _cachedVideoEngineDProbe = existsSync('D:\\') } catch { _cachedVideoEngineDProbe = false }
  return _cachedVideoEngineDProbe
}
export function __resetVideoEngineDProbeForTests(): void { _cachedVideoEngineDProbe = null }

export function videoEngineDataRoot(): string {
  const env = envVideoEngineRoot() ?? (() => {
    const libEnv = envLibraryRoot()
    if (libEnv) return join(libEnv, 'video-engine')
    return undefined
  })()
  if (env) return resolve(env)
  const s = getSettings()
  const chosen = (s.libraryFolder || '').trim() || (s.outputFolder || '').trim()
  if (chosen) return resolve(join(chosen, 'video-engine'))
  // Prefer D: drive when present; this is the "nothing on C" guarantee (memoized)
  if (hasDDrive()) return resolve('D:\\MentalEmpireStudio\\video-engine')
  return join(app.getPath('userData'), 'video-engine')
}

function localBrollDirectories(): string[] {
  const directories: string[] = []
  // The classic pipeline already warms a b-roll library on disk; surfacing it as a
  // local provider means the studio can place clips with no API key at all.
  //
  // Both roots matter. `broll-library` is the real warmed pool the classic downloader
  // fills, organised as <sourceKey>/<keyword>/<file>; the studio used to point only at
  // the per-render scratch cache, which is normally empty, so the always-registered
  // local provider returned zero results for every query — and because "no matches" is
  // a success, it also masked genuine Pexels/Pixabay failures behind the misleading
  // "No footage matched that search."
  for (const root of [brollLibraryDir(), cacheDir('broll')]) {
    try {
      mkdirSync(root, { recursive: true })
      directories.push(root)
    } catch {
      /* an unavailable pool is optional */
    }
  }
  return directories
}

/** Any change here means the engine must be rebuilt so new credentials/providers
 *  take effect without an app restart. */
function engineOptionsFingerprint(): string {
  const beta = getSettings().beta
  return JSON.stringify({
    root: videoEngineDataRoot(),
    pexels: beta.pexelsKey ? 'on' : 'off',
    pixabay: beta.pixabayKey ? 'on' : 'off',
    coverr: beta.coverrKey ? 'on' : 'off',
    local: localBrollDirectories()
  })
}

export function resetVideoEngine(): void {
  const previous = enginePromise
  enginePromise = null
  engineOptionsKey = ''
  engineFailure = ''
  if (previous) void previous.then((engine) => engine.shutdown()).catch(() => undefined)
}

export async function shutdownVideoEngine(): Promise<void> {
  const previous = enginePromise
  enginePromise = null
  engineOptionsKey = ''
  if (!previous) return
  await previous.then((engine) => engine.shutdown()).catch(() => undefined)
}

export function getVideoEngine(): Promise<VideoEngineService> {
  const fingerprint = engineOptionsFingerprint()
  if (enginePromise && fingerprint === engineOptionsKey) return enginePromise
  if (enginePromise) resetVideoEngine()
  engineOptionsKey = fingerprint
  const beta = getSettings().beta
  enginePromise = createVideoEngine({
    dataRoot: videoEngineDataRoot(),
    brollCacheRoot: brollLibraryDir(),
    renderConcurrency: 1,
    localBrollDirectories: localBrollDirectories(),
    brollCredentials: {
      pexelsApiKey: beta.pexelsKey || undefined,
      pixabayApiKey: beta.pixabayKey || undefined,
      coverrApiKey: beta.coverrKey || undefined
    }
  }).catch((error: unknown) => {
    engineFailure = error instanceof Error ? error.message : String(error)
    enginePromise = null
    engineOptionsKey = ''
    throw error
  })
  return enginePromise
}

export function lastVideoEngineFailure(): string {
  return engineFailure
}

// ------------------------------------------------------------------- bindings

function bindingKey(downloadId: string): string {
  return `${BINDING_KEY_PREFIX}${downloadId}`
}

export function readBinding(downloadId: string): VideoStudioBinding {
  const raw = getRepos().appMeta(bindingKey(downloadId))
  if (!raw) return { downloadId }
  try {
    const parsed = JSON.parse(raw) as Partial<VideoStudioBinding>
    return {
      downloadId,
      remotionProjectId: typeof parsed.remotionProjectId === 'string' ? parsed.remotionProjectId : undefined,
      hyperframesProjectId:
        typeof parsed.hyperframesProjectId === 'string' ? parsed.hyperframesProjectId : undefined
    }
  } catch {
    return { downloadId }
  }
}

function writeBinding(binding: VideoStudioBinding): VideoStudioBinding {
  getRepos().setAppMeta(bindingKey(binding.downloadId), JSON.stringify(binding))
  return binding
}

function bindingProjectId(binding: VideoStudioBinding, rendererId: RendererId): string | undefined {
  return rendererId === 'remotion' ? binding.remotionProjectId : binding.hyperframesProjectId
}

function withBindingProjectId(
  binding: VideoStudioBinding,
  rendererId: RendererId,
  projectId: string | undefined
): VideoStudioBinding {
  return rendererId === 'remotion'
    ? { ...binding, remotionProjectId: projectId }
    : { ...binding, hyperframesProjectId: projectId }
}

// -------------------------------------------------------------------- probing

interface ProbedMedia {
  width?: number
  height?: number
  durationSec?: number
  hasAudio: boolean
  hasVideo: boolean
}

function probeMedia(path: string): ProbedMedia {
  const empty: ProbedMedia = { hasAudio: false, hasVideo: false }
  try {
    const probe = spawnSync(
      ffprobePath(),
      [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        path
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
    )
    if (probe.status !== 0 || !probe.stdout) return empty
    const parsed = JSON.parse(probe.stdout) as {
      streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>
      format?: { duration?: string }
    }
    const streams = parsed.streams ?? []
    const video = streams.find((stream) => stream.codec_type === 'video')
    const durationRaw = parsed.format?.duration ?? video?.duration
    const durationSec = durationRaw ? Number(durationRaw) : undefined
    return {
      width: video?.width && video.width > 0 ? video.width : undefined,
      height: video?.height && video.height > 0 ? video.height : undefined,
      durationSec: Number.isFinite(durationSec) && (durationSec as number) > 0 ? durationSec : undefined,
      hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
      hasVideo: !!video
    }
  } catch {
    return empty
  }
}

const ASSET_KIND_BY_EXTENSION: Record<string, VideoAssetKind> = {
  '.mp4': 'video', '.mov': 'video', '.mkv': 'video', '.webm': 'video', '.m4v': 'video', '.avi': 'video',
  '.mp3': 'audio', '.m4a': 'audio', '.wav': 'audio', '.aac': 'audio', '.flac': 'audio', '.ogg': 'audio', '.opus': 'audio',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.bmp': 'image', '.avif': 'image',
  '.woff2': 'font', '.woff': 'font', '.ttf': 'font', '.otf': 'font',
  '.cube': 'lut', '.3dl': 'lut'
}

export function assetKindForPath(path: string): VideoAssetKind {
  return ASSET_KIND_BY_EXTENSION[extname(path).toLowerCase()] ?? 'other'
}

/** Asset ids must satisfy `StableIdSchema`; derive one that is stable for a given
 *  source path so re-importing the same file replaces rather than duplicates. */
function assetIdFor(kind: VideoAssetKind, path: string): string {
  const stem = basename(path, extname(path))
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  let hash = 0x811c9dc5
  for (const character of resolve(path).toLowerCase()) {
    hash = ((hash ^ character.charCodeAt(0)) * 0x01000193) >>> 0
  }
  return `${kind}-${stem || 'asset'}-${hash.toString(16).padStart(8, '0')}`
}

function assetFileName(assetId: string, path: string): string {
  const extension = extname(path).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin'
  return `${assetId}${extension}`
}

// ------------------------------------------------------------ asset importing

export interface ImportAssetResult {
  project: VideoProject
  skipped: Array<{ path: string; reason: string }>
}

export async function importProjectAssets(
  projectId: string,
  paths: readonly string[]
): Promise<ImportAssetResult> {
  const engine = await getVideoEngine()
  let project = await engine.openProject(projectId)
  const assetsDirectory = await ensureDirectory(engine.projects.assetsDirectory(projectId))
  const skipped: Array<{ path: string; reason: string }> = []
  const imported: VideoAsset[] = []

  for (const raw of paths) {
    const source = resolve(raw)
    try {
      const info = await stat(source)
      if (!info.isFile()) {
        skipped.push({ path: source, reason: 'Not a file' })
        continue
      }
      const kind = assetKindForPath(source)
      if (kind === 'other') {
        skipped.push({ path: source, reason: `Unsupported file type: ${extname(source) || 'no extension'}` })
        continue
      }
      const id = assetIdFor(kind, source)
      const destination = resolveInside(assetsDirectory, assetFileName(id, source))
      await copyFile(source, destination)
      const probe = kind === 'video' || kind === 'audio' ? probeMedia(destination) : { hasAudio: false, hasVideo: false }
      imported.push({
        id,
        name: basename(source),
        kind,
        uri: pathToFileURL(destination).toString(),
        mimeType: mimeTypeFor(kind, destination),
        width: probe.width,
        height: probe.height,
        durationFrames: probe.durationSec
          ? Math.max(1, Math.round(probe.durationSec * project.canvas.fps))
          : undefined,
        source: { kind: 'local' }
      })
    } catch (error) {
      skipped.push({ path: source, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  if (imported.length > 0) {
    const importedIds = new Set(imported.map((asset) => asset.id))
    project = await engine.saveProject(
      VideoProjectSchema.parse({
        ...project,
        assets: [...project.assets.filter((asset) => !importedIds.has(asset.id)), ...imported]
      }),
      { expectedRevision: project.revision }
    )
  }
  return { project, skipped }
}

function mimeTypeFor(kind: VideoAssetKind, path: string): string | undefined {
  const extension = extname(path).toLowerCase()
  const table: Record<string, string> = {
    '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac',
    '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf'
  }
  return table[extension] ?? (kind === 'lut' ? 'text/plain' : undefined)
}

// --------------------------------------------------------- binding a download

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
}

export function dimensionsForAspect(aspect: string | undefined): { width: number; height: number } {
  return ASPECT_DIMENSIONS[aspect ?? '16:9'] ?? ASPECT_DIMENSIONS['16:9']!
}

export function captionWordsFromTranscript(
  words: readonly TranscriptWord[],
  fps: number,
  durationFrames: number
): { words: CaptionWord[]; dropped: number } {
  const output: CaptionWord[] = []
  let dropped = 0
  let previousEnd = 0
  const hasIncompleteStart = words.some((word) => !Number.isFinite(word.start))
  const ordered = [...words].sort((a, b) =>
    hasIncompleteStart ? a.ord - b.ord : a.start - b.start || a.ord - b.ord,
  )
  const nextKnownStarts: Array<number | undefined> = new Array(ordered.length)
  let nextKnownStart: number | undefined
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    nextKnownStarts[index] = nextKnownStart
    const candidate = ordered[index]!
    if (Number.isFinite(candidate.start)) nextKnownStart = candidate.start
  }
  for (let index = 0; index < ordered.length; index += 1) {
    const word = ordered[index]!
    const text = word.word.trim()
    if (!text) { dropped += 1; continue }
    const rawStart = Number.isFinite(word.start)
      ? Math.round(word.start * fps)
      : previousEnd
    let startFrame = Math.max(previousEnd, rawStart)
    const nextKnownStart = nextKnownStarts[index]
    const readingFrames = Math.max(
      1,
      Math.min(Math.round(fps * 1.2), Math.round(fps * Math.max(0.24, [...text].length / 14))),
    )
    const rawEnd = Number.isFinite(word.end) && word.end > (Number.isFinite(word.start) ? word.start : -1)
      ? Math.round(word.end * fps)
      : nextKnownStart !== undefined && Math.round(nextKnownStart * fps) > startFrame
        ? Math.round(nextKnownStart * fps)
        : startFrame + readingFrames
    let endFrame = Math.max(startFrame + 1, rawEnd)
    if (startFrame >= durationFrames) { dropped += 1; continue }
    endFrame = Math.min(endFrame, durationFrames)
    if (endFrame <= startFrame) {
      startFrame = Math.max(0, endFrame - 1)
      if (endFrame <= startFrame) { dropped += 1; continue }
    }
    // Provider timestamps occasionally overlap by a frame or arrive with one missing
    // boundary. Advancing by the repaired end guarantees one active word at a time.
    previousEnd = endFrame
    output.push({
      id: `word-${String(index + 1).padStart(6, '0')}`,
      text: text.slice(0, 500),
      startFrame,
      endFrame,
      importance: word.emphasis ? 2 : 0
    })
  }
  return { words: output, dropped }
}

function classicProjectFor(downloadId: string): { project: Project | null; title: string; durationSec: number; audioPath: string; channel: string } {
  const repos = getRepos()
  const project = repos.getProject(`proj-${downloadId}`) ?? null
  if (project) {
    return {
      project,
      title: project.title,
      durationSec: project.durationSec,
      audioPath: project.mp3Path,
      channel: project.channel
    }
  }
  const download = repos.download(downloadId)
  if (!download) throw new VideoEngineError('PROJECT_NOT_FOUND', `Unknown download: ${downloadId}`)
  return {
    project: null,
    title: download.title,
    durationSec: download.durationSec ?? 0,
    audioPath: download.filePath ?? '',
    channel: download.channel
  }
}

/** Builds (or reopens) the engine project that backs one downloaded clip for one
 *  renderer, seeded with the clip's audio, image sequence, and transcript so the
 *  studio opens on something immediately renderable. */
export async function bindDownload(
  downloadId: string,
  rendererId: RendererId,
  options: { reseed?: boolean } = {}
): Promise<{ binding: VideoStudioBinding; project: VideoProject }> {
  const engine = await getVideoEngine()
  let binding = readBinding(downloadId)
  const existingId = bindingProjectId(binding, rendererId)
  if (existingId && !options.reseed) {
    try {
      return { binding, project: await engine.openProject(existingId) }
    } catch {
      binding = writeBinding(withBindingProjectId(binding, rendererId, undefined))
    }
  }

  const classic = classicProjectFor(downloadId)
  const repos = getRepos()
  const fps = 30
  const { width, height } = dimensionsForAspect(classic.project?.captionAspect)
  const audioProbe = classic.audioPath && existsSync(classic.audioPath) ? probeMedia(classic.audioPath) : undefined
  const durationSec = classic.durationSec || audioProbe?.durationSec || 30
  const durationFrames = Math.max(fps, Math.round(durationSec * fps))
  const projectId = `${rendererId}-${downloadId}`.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120)

  if (existingId) await engine.deleteProject(existingId).catch(() => undefined)
  await engine.deleteProject(projectId).catch(() => undefined)

  let project = await engine.createProject({
    id: projectId,
    name: classic.title.slice(0, 200) || 'Untitled video',
    rendererId,
    width,
    height,
    fps,
    durationFrames
  })

  // Voice-over: the downloaded MP3 becomes the project's audio bed.
  if (classic.audioPath && existsSync(classic.audioPath)) {
    const audio = await importProjectAssets(project.id, [classic.audioPath])
    project = audio.project
  }
  // Image sequence: reuse the classic project's ordered stills and their ranges.
  const images: ProjectImage[] = classic.project ? repos.getProjectImages(classic.project.id) : []
  const existingPaths = images.map((image) => image.path).filter((path) => existsSync(path))
  if (existingPaths.length > 0) {
    const stills = await importProjectAssets(project.id, existingPaths)
    project = stills.project
  }

  const audioAsset = project.assets.find((asset) => asset.kind === 'audio')
  const imageAssets = project.assets.filter((asset) => asset.kind === 'image')
  const tracks = [
    { id: 'main-audio', name: 'Voice-over', kind: 'audio' as const, order: -10, muted: false, locked: false },
    { id: 'main-video', name: 'Visuals', kind: 'video' as const, order: 0, muted: false, locked: false }
  ]
  const scenes = []
  if (audioAsset) {
    scenes.push(VideoSceneSchema.parse({
      id: 'main-audio-scene',
      trackId: 'main-audio',
      kind: 'audio',
      startFrame: 0,
      durationFrames,
      zIndex: 0,
      assetId: audioAsset.id,
      volume: 1
    }))
  }
  for (let index = 0; index < imageAssets.length; index += 1) {
    const asset = imageAssets[index]!
    const image = images.find((candidate) => basename(candidate.path) === asset.name)
    const startFrame = image
      ? Math.min(durationFrames - 1, Math.max(0, Math.round(image.rangeStart * fps)))
      : Math.round((index / Math.max(1, imageAssets.length)) * durationFrames)
    const endFrame = image
      ? Math.min(durationFrames, Math.max(startFrame + 1, Math.round(image.rangeEnd * fps)))
      : Math.min(durationFrames, Math.round(((index + 1) / Math.max(1, imageAssets.length)) * durationFrames))
    scenes.push(VideoSceneSchema.parse({
      id: `still-${String(index + 1).padStart(4, '0')}`,
      trackId: 'main-video',
      kind: 'media',
      startFrame,
      durationFrames: Math.max(1, endFrame - startFrame),
      zIndex: 0,
      assetId: asset.id,
      fit: 'cover',
      opacity: 1
    }))
  }

  project = await engine.saveProject(
    VideoProjectSchema.parse({ ...project, tracks, scenes }),
    { expectedRevision: project.revision }
  )

  // Captions: the existing Groq transcript already has word timings.
  const transcript: TranscriptWord[] = classic.project ? repos.getTranscript(classic.project.id) : []
  if (transcript.length > 0) {
    const converted = captionWordsFromTranscript(transcript, fps, durationFrames)
    if (converted.words.length > 0) {
      const styleId = classic.project?.captionPreset || 'motivation-bold'
      const cleanStyleId = styleId.replace(/^(remotion|hyperframes)-caption-/u, '')
      const candidateTemplateId = `${rendererId}-caption-${cleanStyleId}`
      const templates = engine.templates.list({ rendererId })
      const templateExists = templates.some((t) => t.id === candidateTemplateId)
      const templateId = templateExists ? candidateTemplateId : `${rendererId}-caption-motivation-bold`

      project = await engine.setCaptions({
        projectId: project.id,
        language: 'en',
        templateId,
        words: converted.words
      })
    }
  }

  // Transitions: apply chosen transition template between consecutive media scenes if set
  if (classic.project?.transition && scenes.length > 1) {
    const transPreset = classic.project.transition
    const cleanTransId = transPreset.replace(/^(remotion|hyperframes)-transition-/u, '')
    const candidateTransId = `${rendererId}-transition-${cleanTransId}`
    const templates = engine.templates.list({ rendererId })
    const transExists = templates.some((t) => t.id === candidateTransId)
    if (transExists) {
      for (let i = 0; i < scenes.length - 1; i++) {
        const fromScene = project.scenes.find((s) => s.id === `still-${String(i + 1).padStart(4, '0')}`)
        const toScene = project.scenes.find((s) => s.id === `still-${String(i + 2).padStart(4, '0')}`)
        if (fromScene && toScene && fromScene.kind === 'media' && toScene.kind === 'media') {
          try {
            project = await engine.applyTransitionTemplate(project.id, {
              templateId: candidateTransId,
              fromSceneId: fromScene.id,
              toSceneId: toScene.id,
              startFrame: Math.max(0, toScene.startFrame)
            })
          } catch {
            // Ignore alignment mismatch in binding
          }
        }
      }
    }
  }

  binding = writeBinding(withBindingProjectId(binding, rendererId, project.id))
  return { binding, project }
}

export async function unbindDownload(
  downloadId: string,
  rendererId: RendererId
): Promise<VideoStudioBinding> {
  const binding = readBinding(downloadId)
  const projectId = bindingProjectId(binding, rendererId)
  if (projectId) {
    const engine = await getVideoEngine().catch(() => null)
    if (engine) await engine.deleteProject(projectId).catch(() => undefined)
  }
  return writeBinding(withBindingProjectId(binding, rendererId, undefined))
}

// ------------------------------------------------------------------- canvas

/** Retimes a scene's embedded hook plan to a new frame rate, or leaves it alone.
 *
 *  Leaving it alone is the failure mode on purpose: a plan that cannot be expressed at the
 *  new rate (a 30-second plan scaled up past the schema's 30-second ceiling) is worth a
 *  preflight complaint the user can act on, and is not worth deleting their hook over. */
function rescaledHookTemplate(
  scene: VideoProject['scenes'][number],
  fps: number,
  scale: number
): Partial<VideoProject['scenes'][number]> {
  const props = scene.template?.props
  const embedded = props?.['hookPlan']
  if (!scene.template || !props || !embedded) return {}
  const parsed = HookPlanSchema.safeParse(embedded)
  if (!parsed.success) return {}
  try {
    return {
      template: { ...scene.template, props: { ...props, hookPlan: rescaleHookPlan(parsed.data, fps, scale) } }
    }
  } catch {
    return {}
  }
}

export async function patchCanvas(projectId: string, patch: VideoCanvasPatch): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const fps = patch.fps === undefined ? project.canvas.fps : Math.round(patch.fps)
  // Every timing in the project is a frame count, so changing the frame rate has to
  // rescale all of them or the edit silently retimes. Duration is rescaled first, then
  // the explicit duration in the patch (already expressed at the new rate) wins.
  const scale = fps / project.canvas.fps
  const rescale = (frames: number): number => Math.max(0, Math.round(frames * scale))
  const scaledDuration = Math.max(1, rescale(project.canvas.durationFrames))
  const canvas = {
    ...project.canvas,
    fps,
    durationFrames:
      patch.durationFrames === undefined ? scaledDuration : Math.max(1, Math.round(patch.durationFrames)),
    ...(patch.width === undefined ? {} : { width: Math.round(patch.width) }),
    ...(patch.height === undefined ? {} : { height: Math.round(patch.height) }),
    ...(patch.backgroundColor === undefined ? {} : { backgroundColor: patch.backgroundColor })
  }

  // Shrinking the canvas would orphan scenes/captions past the new end; clamp both so
  // a duration change can never produce an unparseable project.
  const scenes = project.scenes
    .map((scene) => ({
      ...scene,
      startFrame: rescale(scene.startFrame),
      durationFrames: Math.max(1, rescale(scene.durationFrames)),
      sourceRange: scene.sourceRange
        ? {
            startFrame: rescale(scene.sourceRange.startFrame),
            durationFrames: Math.max(1, rescale(scene.sourceRange.durationFrames))
          }
        : undefined,
      // A hook plan embedded in a template's props carries its OWN fps and its own beat
      // frames, and nothing here used to touch it: changing the frame rate rescaled the
      // scene around the plan and left the plan behind, so preflight then reported both
      // `hook-plan.fps-mismatch` and `hook-plan.too-long` and the render was dead with no
      // hook UI to repair it. `rescaleHookPlan` exists for exactly this and had no caller.
      ...(scale === 1 ? {} : rescaledHookTemplate(scene, fps, scale))
    }))
    .filter((scene) => scene.startFrame < canvas.durationFrames)
    .map((scene) => VideoSceneSchema.parse({
      ...scene,
      // A caption scene always spans the whole video, so it follows the new duration
      // rather than being clipped to a stale length.
      durationFrames: scene.kind === 'caption'
        ? canvas.durationFrames - scene.startFrame
        : Math.max(1, Math.min(scene.durationFrames, canvas.durationFrames - scene.startFrame))
    }))
  const keptScenes = new Map(scenes.map((scene) => [scene.id, scene]))

  const captions = project.captions
    ? (() => {
        const words = project.captions.words
          .map((word) => ({
            ...word,
            startFrame: rescale(word.startFrame),
            endFrame: Math.max(rescale(word.startFrame) + 1, rescale(word.endFrame))
          }))
          .filter((word) => word.startFrame < canvas.durationFrames)
          .map((word) => ({ ...word, endFrame: Math.min(word.endFrame, canvas.durationFrames) }))
          .filter((word) => word.endFrame > word.startFrame)
        return words.length > 0
          ? createCaptionDocument({
              id: project.captions.id,
              language: project.captions.language,
              templateId: project.captions.templateId,
              words
            })
          : undefined
      })()
    : undefined

  const transitions = project.transitions
    .map((transition) => ({
      ...transition,
      startFrame: rescale(transition.startFrame),
      durationFrames: transition.type === 'cut' ? 0 : Math.max(1, rescale(transition.durationFrames))
    }))
    .filter((transition) => {
      const from = keptScenes.get(transition.fromSceneId)
      const to = keptScenes.get(transition.toSceneId)
      if (!from || !to) return false
      // The schema rejects a transition longer than either scene it joins.
      return transition.durationFrames <= Math.min(from.durationFrames, to.durationFrames)
    })

  return engine.saveProject(
    VideoProjectSchema.parse({ ...project, canvas, scenes, captions, transitions }),
    { expectedRevision: project.revision }
  )
}

// ------------------------------------------------------------------ previewing

/* Assets live outside the renderer's origin, and `file:` is not reachable under the
 * app CSP. `mestudio://` (registered in main.ts) serves approved engine and B-roll
 * media roots, so the preview sees the real media. Two hosts:
 *
 *   mestudio://asset/<base64url absolute path>   one file, no relative resolution
 *   mestudio://hf/<projectId>/<relative path>    a staged HyperFrames workspace,
 *                                                where `./vendor/gsap.min.js` and
 *                                                `./assets/*` must keep resolving */
export const PREVIEW_PROTOCOL = 'mestudio'

export function encodePreviewPath(absolutePath: string): string {
  return Buffer.from(resolve(absolutePath), 'utf8').toString('base64url')
}

export function decodePreviewPath(token: string): string {
  return Buffer.from(token, 'base64url').toString('utf8')
}

export function previewUrlForPath(absolutePath: string): string {
  return `${PREVIEW_PROTOCOL}://asset/${encodePreviewPath(absolutePath)}`
}

/** The URL a stage is served from. The stamp is a real path segment, not a query, so the
 *  document's own relative `./assets/x` and `./vendor/y` resolve back into the exact
 *  workspace it was compiled against — a `?v=` buster would change the entry URL while
 *  leaving every asset request pointed at whatever workspace is current. */
export function hyperframesPreviewUrl(projectId: string, stamp: string): string {
  return `${PREVIEW_PROTOCOL}://hf/${encodeURIComponent(projectId)}/${encodeURIComponent(stamp)}/${PREVIEW_ENTRY_FILE}`
}

/** Resolves a `mestudio://` request to a real file, or throws. Both hosts are
 *  confined: `asset` to the engine data root or persistent B-roll library, `hf` to
 *  that project's staged workspace, so a crafted URL cannot read arbitrary disk. */
export function resolvePreviewRequest(
  url: string,
  assetRoots: readonly string[] = [videoEngineDataRoot(), brollLibraryDir()]
): string {
  const parsed = new URL(url)
  const segments = parsed.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  if (parsed.hostname === 'asset') {
    const token = segments[0]
    if (!token) throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', 'Empty preview path')
    const absolutePath = resolve(decodePreviewPath(token))
    for (const root of assetRoots) {
      try {
        return resolveInside(root, absolutePath)
      } catch (error) {
        if (!(error instanceof VideoEngineError) || error.code !== 'PATH_OUTSIDE_WORKSPACE') {
          throw error
        }
      }
    }
    throw new VideoEngineError(
      'PATH_OUTSIDE_WORKSPACE',
      `Preview asset is outside approved preview roots: ${absolutePath}`
    )
  }
  if (parsed.hostname === 'hf') {
    const [projectId, stamp, ...rest] = segments
    if (!projectId) throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', 'Missing preview project')
    if (!stamp) throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', 'Missing preview stamp')
    // Looked up by stamp, so a document keeps reading the workspace it was compiled
    // against even after a newer stage has been published for the same project.
    const staged = stagedPreviews.get(stageKey(projectId, stamp))
    if (!staged) throw new VideoEngineError('PROJECT_NOT_FOUND', `No staged preview ${projectId}/${stamp}`)
    return resolveInside(staged.workspacePath, ...(rest.length > 0 ? rest : [staged.entryFile]))
  }
  throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', `Unknown preview host: ${parsed.hostname}`)
}

export function projectForPreview(project: VideoProject): VideoProject {
  return VideoProjectSchema.parse({
    ...project,
    assets: project.assets.map((asset) => {
      if (!asset.uri.startsWith('file:')) return asset
      try {
        const absolute = fileURLToPath(new URL(asset.uri))
        return { ...asset, uri: previewUrlForPath(absolute) }
      } catch {
        return asset
      }
    })
  })
}

interface StagedPreview {
  workspacePath: string
  prepared: PreparedRender
  warnings: string[]
  /** The entry the player loads — `preview.html`, never the render entry. */
  entryFile: string
  /** Unique per stage. Appears in the URL, so a rebuild produces a URL the iframe
   *  actually navigates to instead of one React sees as unchanged. */
  stamp: string
  url: string
}

/** Keyed `projectId/stamp`, not `projectId`: several stages of one project can be alive
 *  at once, which is what lets the outgoing document keep serving its own assets while
 *  the replacement loads. */
const stagedPreviews = new Map<string, StagedPreview>()

/** In-flight stages, so two concurrent refreshes of one project share a single compile
 *  instead of racing each other through the same work directory. */
const stagingInFlight = new Map<string, Promise<StagedPreview>>()

/** How many stages of a single project stay resolvable. Two is enough to cover the
 *  hand-off; more just leaks disk. */
const PREVIEW_STAGE_RETENTION = 2

let previewStageCounter = 0

function stageKey(projectId: string, stamp: string): string {
  return `${projectId}/${stamp}`
}

const PREVIEW_ENTRY_FILE = 'preview.html'
const PREVIEW_RUNTIME_FILE = 'hyperframe.runtime.iife.js'

/**
 * A compiled composition ships its DOM, GSAP, and a paused timeline — but every
 * `.clip` starts `visibility: hidden`, and it is HyperFrames' browser runtime that
 * reveals them according to `data-start`/`data-duration`. The renderer injects that
 * runtime itself, so `index.html` does not carry it and would paint black on its own.
 *
 * Rather than change what gets rendered, this writes a second entry beside it with
 * the runtime appended. `index.html` stays byte-identical to what the renderer sees.
 */
async function writePreviewEntry(workspacePath: string): Promise<void> {
  const requireFromHere = createRequire(import.meta.url)
  const coreRoot = dirname(requireFromHere.resolve('@hyperframes/core/package.json'))
  const runtimeSource = join(coreRoot, 'dist', PREVIEW_RUNTIME_FILE)
  const vendorTarget = resolveInside(workspacePath, 'vendor', PREVIEW_RUNTIME_FILE)
  await ensureDirectory(join(workspacePath, 'vendor'))
  await copyFile(runtimeSource, vendorTarget)

  const entry = resolveInside(workspacePath, 'index.html')
  const html = await readFile(entry, 'utf8')
  const runtimeTag = `<script src="./vendor/${PREVIEW_RUNTIME_FILE}"></script>`
  // After the timeline script, so `window.__timelines` is populated before the
  // runtime bootstraps on DOMContentLoaded.
  const withRuntime = html.includes('</body>')
    ? html.replace('</body>', `  ${runtimeTag}\n</body>`)
    : `${html}\n${runtimeTag}`
  await writeFile(resolveInside(workspacePath, PREVIEW_ENTRY_FILE), withRuntime, 'utf8')
}

/** Drops every stage of this project except the newest `PREVIEW_STAGE_RETENTION`. Runs
 *  only after a replacement has been published, so a failed rebuild never takes the
 *  working preview down with it. */
async function evictOldStages(projectId: string, adapter: RendererAdapter): Promise<void> {
  const mine = [...stagedPreviews.entries()].filter(([key]) => key.startsWith(`${projectId}/`))
  if (mine.length <= PREVIEW_STAGE_RETENTION) return
  for (const [key, staged] of mine.slice(0, mine.length - PREVIEW_STAGE_RETENTION)) {
    stagedPreviews.delete(key)
    if (adapter.cleanup) await adapter.cleanup(staged.prepared).catch(() => undefined)
    else await rm(staged.workspacePath, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function stageHyperframesPreview(projectId: string): Promise<StagedPreview> {
  const running = stagingInFlight.get(projectId)
  if (running) return running
  const task = stageHyperframesPreviewOnce(projectId)
  stagingInFlight.set(projectId, task)
  try {
    return await task
  } finally {
    if (stagingInFlight.get(projectId) === task) stagingInFlight.delete(projectId)
  }
}

async function stageHyperframesPreviewOnce(projectId: string): Promise<StagedPreview> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  if (project.rendererId !== 'hyperframes') {
    throw new VideoEngineError('INVALID_PROJECT', 'Only HyperFrames projects have a staged preview')
  }
  const adapter = engine.rendererAdapter('hyperframes')
  if (!adapter) throw new VideoEngineError('RENDERER_UNAVAILABLE', 'HyperFrames renderer is not registered')

  const stamp = `r${project.revision}-${(previewStageCounter += 1).toString(36)}`
  // Each stage compiles into its own directory. Sharing one `preview` directory is what
  // let a rebuild overwrite the files the live document was still fetching.
  const workDirectory = await ensureDirectory(
    join(engine.projects.workDirectory(projectId), 'preview', stamp)
  )
  const controller = new AbortController()
  const prepared = await adapter.prepare(project, {
    workDirectory,
    signal: controller.signal,
    onProgress: () => undefined
  })
  const payload = prepared.payload as { workspacePath?: string; lintWarnings?: string[] }
  if (!payload?.workspacePath) {
    throw new VideoEngineError('RENDER_FAILED', 'HyperFrames preview did not produce a workspace')
  }
  await writePreviewEntry(payload.workspacePath)
  const staged: StagedPreview = {
    workspacePath: payload.workspacePath,
    prepared,
    warnings: payload.lintWarnings ?? [],
    entryFile: PREVIEW_ENTRY_FILE,
    stamp,
    url: hyperframesPreviewUrl(projectId, stamp)
  }
  stagedPreviews.set(stageKey(projectId, stamp), staged)
  await evictOldStages(projectId, adapter)
  return staged
}

export async function discardStagedPreviews(): Promise<void> {
  const engine = await getVideoEngine().catch(() => null)
  const adapter = engine?.rendererAdapter('hyperframes')
  for (const [key, staged] of stagedPreviews) {
    stagedPreviews.delete(key)
    if (adapter?.cleanup) await adapter.cleanup(staged.prepared).catch(() => undefined)
    else await rm(staged.workspacePath, { recursive: true, force: true }).catch(() => undefined)
  }
}

// --------------------------------------------------------------- render jobs

export function toRenderJobDto(job: RenderJobRecord): VideoRenderJob {
  return {
    id: job.id,
    projectId: job.projectId,
    projectName: job.projectSnapshot.name,
    projectRevision: job.projectRevision,
    rendererId: job.rendererId,
    outputPath: job.outputPath,
    stage: job.stage,
    progress: job.progress,
    attempt: job.attempt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    artifact: job.artifact,
    canvas: {
      width: job.projectSnapshot.canvas.width,
      height: job.projectSnapshot.canvas.height,
      fps: job.projectSnapshot.canvas.fps,
      durationFrames: job.projectSnapshot.canvas.durationFrames
    }
  }
}

/** `assertSafeId` rejects spaces and punctuation in output file names, so titles
 *  have to be slugged before they reach the queue. */
export function renderFileName(project: VideoProject, extension = '.mp4'): string {
  const stem = project.name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return `${stem || 'render'}-r${project.revision}${extension}`
}

// ------------------------------------------------------------------- grading

export const VIDEO_GRADING_PRESETS: readonly VideoGradingPreset[] = Object.freeze([
  {
    id: 'off',
    name: 'None',
    description: 'Pass the renderer output through untouched.',
    grading: { ...DEFAULT_VIDEO_GRADING }
  },
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    description: 'The blockbuster split-tone: cool shadows, warm skin, firm contrast.',
    grading: {
      enabled: true, lutIntensity: 1, exposure: 0.03, contrast: 0.16,
      saturation: 1.12, temperature: 0.12, tint: -0.05, vignette: 0.2, grain: 0.03
    }
  },
  {
    id: 'bleach-noir',
    name: 'Bleach Noir',
    description: 'Desaturated, high-contrast monochrome lean for tension segments.',
    grading: {
      enabled: true, lutIntensity: 1, exposure: -0.04, contrast: 0.3,
      saturation: 0.42, temperature: -0.06, tint: 0.02, vignette: 0.34, grain: 0.08
    }
  },
  {
    id: 'warm-doc',
    name: 'Warm Documentary',
    description: 'Gentle warmth and lifted mids — reads honest, not stylized.',
    grading: {
      enabled: true, lutIntensity: 1, exposure: 0.07, contrast: 0.06,
      saturation: 1.04, temperature: 0.16, tint: 0.03, vignette: 0.12, grain: 0.02
    }
  },
  {
    id: 'cold-clinical',
    name: 'Cold Clinical',
    description: 'Blue-shifted and clean, for data and explainer segments.',
    grading: {
      enabled: true, lutIntensity: 1, exposure: 0.02, contrast: 0.12,
      saturation: 0.94, temperature: -0.18, tint: -0.04, vignette: 0.08, grain: 0
    }
  },
  {
    id: 'retro-film',
    name: 'Retro Film',
    description: 'Faded blacks, heavier grain, and a warm cast for archival texture.',
    grading: {
      enabled: true, lutIntensity: 1, exposure: 0.05, contrast: -0.08,
      saturation: 0.88, temperature: 0.22, tint: 0.06, vignette: 0.28, grain: 0.14
    }
  }
])

// -------------------------------------------------------------------- status

export async function videoEngineCapabilities(): Promise<VideoRendererCapabilities[]> {
  const engine = await getVideoEngine()
  return engine
    .listRendererIds()
    .map((id) => engine.rendererAdapter(id)?.capabilities())
    .filter((capabilities): capabilities is VideoRendererCapabilities => !!capabilities)
}

export function missingBrollCredentials(): string[] {
  const beta = getSettings().beta
  const missing: string[] = []
  if (!beta.pexelsKey) missing.push('pexels')
  if (!beta.pixabayKey) missing.push('pixabay')
  if (!beta.coverrKey) missing.push('coverr')
  return missing
}

export function engineBinaryPaths(): { ffmpegPath: string; ffprobePath: string } {
  return { ffmpegPath: ffmpegPath(), ffprobePath: ffprobePath() }
}
