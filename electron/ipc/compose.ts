import { ipcMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { LookAdjust, MotionDirection, MotionPreset, Project, ProjectImage, ProjectImageMotionPatch, TranscribeProgress, TranscriptWord } from '../../shared/types'
import { asBetaOpts, projectVideoOpts } from '../../shared/types'
import type { GpuRenderSpec } from '../../shared/renderSpec'
import { safeName } from '../../shared/sanitize'
import { deriveStylePlan, styleCaptionLead, styleTransition, validateEffectPlan } from '../../shared/effectPlan'
import { LOOKS, lookById } from '../../shared/looks'
import { getSettings } from '../store/settings'
import { getRepos } from '../db'
import { splitRanges } from '../services/audio'
import { importImages, seededShuffle } from '../services/images'
import { transcribeAudio } from '../services/transcribe'
import { emit, hhmm, pushActivity } from './events'
import { outputDir } from '../services/queue'
import { itemDirForProject, itemImagesDir, itemThumbDir, cacheDir, ensureDir, writeProjectManifest, videoIdFromProjectId } from '../services/storage'
import { buildAss } from '../services/captions'
import { buildCachedBrollPreviewSegments } from '../services/broll'
import { cancelRender, consumeCancelIntent, overlayGradientPath, runRender } from '../services/render'
import { probeRenderCapabilities } from '../services/engine/caps'
import { buildGpuRenderSpec, gpuDimensions } from '../services/engine/gpu/spec'
import { ffmpegPath } from '../services/bin'

// Compose orchestration: build a project from a downloaded mp3, manage its image
// ranges + caption recipe, run transcription (Groq), and push to the render queue.
// Images live in the per-video library folder (<lib>/<channel>/<id>__<slug>/images).

function emitT(p: TranscribeProgress): void {
  emit('transcribe:progress', p)
}

function defaultProject(downloadId: string, title: string, channel: string, mp3Path: string, durationSec: number): Project {
  return {
    id: `proj-${downloadId}`,
    downloadId,
    title,
    channel,
    mp3Path,
    durationSec,
    imageMode: 'sequence',
    poolSize: 10,
    kenBurns: true,
    motionPreset: 'subtle',
    seed: Math.floor(Math.random() * 9000) + 1000,
    crossfade: 0.8,
    captionPreset: 'Hormozi',
    captionFont: 'Montserrat',
    captionAnim: 'Pop-in',
    captionAspect: '16:9',
    captionLines: 2,
    captionPosition: 'bottom',
    captionPace: 'auto',
    captionHighlightColor: '#ffd93d',
    captionBoxColor: '#ffd93d',
    captionWordsPerPage: 1,
    emphasis: true,
    keywords: true,
    punchZoom: true,
    stage: 'composing',
    createdAt: new Date().toISOString()
  }
}

function effectiveThumbnailPath(project: Project): string | null {
  if (project.thumbPath) return project.thumbPath
  // Per-item thumb (new layout) first, then the legacy flat output/thumbnails path.
  const perItem = join(itemThumbDir(itemDirForProject(project)), `${safeName(project.title)}.png`)
  if (existsSync(perItem)) return perItem
  const computed = join(outputDir(), 'thumbnails', `${safeName(project.title)}.png`)
  return existsSync(computed) ? computed : null
}

function validateDownloadedAudio(downloadId: string, mp3Path: string, durationSec: number): void {
  if (!mp3Path) throw new Error(`Download ${downloadId} has no MP3 path yet. Finish or resume the download first.`)
  if (!existsSync(mp3Path)) throw new Error(`Downloaded MP3 was not found on disk: ${mp3Path}`)
  if (!durationSec || durationSec <= 0) throw new Error(`Download ${downloadId} has no usable audio duration. Re-download or resume it.`)
}

function createProject(downloadId: string): Project {
  const repos = getRepos()
  const existing = repos.getProject(`proj-${downloadId}`)
  if (existing) {
    validateDownloadedAudio(downloadId, existing.mp3Path, existing.durationSec)
    return existing
  }
  const dl = repos.download(downloadId)
  if (!dl) throw new Error(`Unknown download: ${downloadId}`)
  validateDownloadedAudio(downloadId, dl.filePath ?? '', dl.durationSec ?? 0)
  const p = defaultProject(downloadId, dl.title, dl.channel, dl.filePath ?? '', dl.durationSec ?? 0)
  repos.createProject(p)
  writeProjectManifest(itemDirForProject(p), {
    videoId: videoIdFromProjectId(p.id), channel: p.channel, title: p.title,
    durationSec: p.durationSec, stage: p.stage, createdAt: p.createdAt, audioPath: p.mp3Path
  })
  return p
}

function setImages(projectId: string, paths: string[]): ProjectImage[] {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  let copied = importImages(itemImagesDir(itemDirForProject(project)), paths)
  if (project.imageMode === 'pool') copied = seededShuffle(copied, project.seed)
  const ranges = splitRanges(project.durationSec, copied.length)
  const rows: ProjectImage[] = copied.map((path, i) => ({
    id: `${projectId}-img-${i}`,
    projectId,
    ord: i,
    path,
    thumb: path,
    rangeStart: ranges[i].rangeStart,
    rangeEnd: ranges[i].rangeEnd,
    manual: false
  }))
  repos.replaceProjectImages(projectId, rows)
  writeProjectManifest(itemDirForProject(project), { imagePaths: rows.map((r) => r.path) })
  return rows
}

function reorderImages(projectId: string, imageIds: string[]): ProjectImage[] {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  const current = repos.getProjectImages(projectId)
  const byId = new Map(current.map((im) => [im.id, im]))
  const ordered = imageIds.map((id) => byId.get(id)).filter((im): im is ProjectImage => !!im)
  const missing = current.filter((im) => !imageIds.includes(im.id))
  const rows = [...ordered, ...missing]
  const ranges = splitRanges(project.durationSec, rows.length)
  const next = rows.map((im, i) => ({
    ...im,
    ord: i,
    rangeStart: ranges[i].rangeStart,
    rangeEnd: ranges[i].rangeEnd,
    manual: false
  }))
  repos.replaceProjectImages(projectId, next)
  return next
}

function validateRenderReady(projectId: string): void {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  // Only the audio is truly required to queue/produce a video. Images are optional
  // (the render falls back to a solid background, or B-roll supplies the visuals),
  // captions are optional (no subtitles), and the thumbnail is a separate PNG that
  // never enters the mp4. So we don't block "Save & send to render" on them — they're
  // surfaced as advisory checklist items on the Render Queue instead.
  const missing: string[] = []
  if (!project.mp3Path || !existsSync(project.mp3Path)) missing.push('MP3')
  if (!project.durationSec || project.durationSec <= 0) missing.push('audio duration')
  if (missing.length) throw new Error(`Project is not render-ready. Missing: ${missing.join(', ')}.`)
}

function sendToRender(projectId: string): void {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  validateRenderReady(projectId)
  repos.createRenderJob({ id: `job-${projectId}`, title: project.title, channel: project.channel, projectId })
  repos.updateProject(projectId, { stage: 'queued' })
  pushActivity({ t: hhmm(), icon: '→', color: '#f5b323', text: `Queued ${project.title} for render` })
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === 'number' ? n : Number(n)
  return Math.max(min, Math.min(max, Number.isFinite(v) ? v : fallback))
}

function cleanLookAdjust(adjust: LookAdjust | undefined): LookAdjust | undefined {
  if (!adjust) return undefined
  const rawColor = adjust.colorBalance
  const colorBalance = rawColor
    ? {
        r: rawColor.r == null ? undefined : clamp(rawColor.r, -0.5, 0.5, 0),
        g: rawColor.g == null ? undefined : clamp(rawColor.g, -0.5, 0.5, 0),
        b: rawColor.b == null ? undefined : clamp(rawColor.b, -0.5, 0.5, 0)
      }
    : undefined
  const next: LookAdjust = {
    brightness: adjust.brightness == null ? undefined : clamp(adjust.brightness, -0.4, 0.4, 0),
    contrast: adjust.contrast == null ? undefined : clamp(adjust.contrast, 0.4, 2, 1),
    saturation: adjust.saturation == null ? undefined : clamp(adjust.saturation, 0, 2.5, 1),
    colorBalance,
    vignette: adjust.vignette == null ? undefined : clamp(adjust.vignette, 0, 1, 0),
    sharpen: adjust.sharpen == null ? undefined : clamp(adjust.sharpen, 0, 1, 0),
    grain: adjust.grain == null ? undefined : clamp(adjust.grain, 0, 0.2, 0)
  }
  const hasValue = (Object.entries(next) as Array<[keyof LookAdjust, unknown]>).some(([k, v]) => {
    if (k !== 'colorBalance') return v != null
    return !!v && Object.values(v as NonNullable<LookAdjust['colorBalance']>).some((n) => n != null)
  })
  return hasValue ? next : undefined
}

function updateLook(projectId: string, patch: { lut?: string; strength?: number; adjust?: LookAdjust }): Project {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  const nextLook = patch.lut === undefined ? lookById(project.lookLut) : lookById(patch.lut)
  const strength = patch.strength === undefined
    ? project.lookStrength
    : clamp(patch.strength, 0, 1, nextLook.defaultStrength)
  const adjust = patch.adjust === undefined ? project.lookAdjust : cleanLookAdjust(patch.adjust)
  const dbPatch = {
    lookLut: nextLook.id,
    lookStrength: nextLook.id === 'off' ? 0 : (strength ?? nextLook.defaultStrength),
    lookAdjust: patch.adjust === undefined ? adjust : (adjust ?? null)
  } as Partial<Project>
  const updated = repos.updateProject(projectId, dbPatch)
  if (!updated) throw new Error(`Unknown project: ${projectId}`)
  return updated
}

function updateMotion(projectId: string, patch: { preset: MotionPreset }): Project {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  const preset: MotionPreset = patch.preset === 'off' || patch.preset === 'subtle' || patch.preset === 'cinematic'
    ? patch.preset
    : 'subtle'
  const updated = repos.updateProject(projectId, { motionPreset: preset, kenBurns: preset !== 'off' })
  if (!updated) throw new Error(`Unknown project: ${projectId}`)
  return updated
}

function cleanMotionDirection(raw: unknown): MotionDirection | null {
  return raw === 'auto' || raw === 'push' || raw === 'pull' || raw === 'left' || raw === 'right' || raw === 'up' || raw === 'down' ? raw : null
}

function setImageMotion(projectId: string, updates: ProjectImageMotionPatch[]): ProjectImage[] {
  const clean = updates
    .filter((u) => !!u.id)
    .map((u) => {
      const row: ProjectImageMotionPatch = { id: u.id }
      if ('motionPreset' in u) row.motionPreset = u.motionPreset === 'off' || u.motionPreset === 'subtle' || u.motionPreset === 'cinematic' ? u.motionPreset : null
      if ('motionDirection' in u) row.motionDirection = cleanMotionDirection(u.motionDirection)
      if ('motionAmount' in u) {
        const n = Number(u.motionAmount)
        row.motionAmount = u.motionAmount == null ? null : Math.max(0, Math.min(100, Number.isFinite(n) ? n : 50))
      }
      return row
    })
  const repos = getRepos()
  repos.setImageMotion(projectId, clean)
  return repos.getProjectImages(projectId)
}

function updateCaptions(projectId: string, patch: Partial<Project>): Project {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  const updated = repos.updateProject(projectId, patch)
  if (!updated) throw new Error(`Unknown project: ${projectId}`)
  return updated
}

async function runTranscribe(projectId: string): Promise<TranscriptWord[]> {
  const repos = getRepos()
  const settings = getSettings()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)

  try {
    validateDownloadedAudio(project.downloadId, project.mp3Path, project.durationSec)
    emitT({ projectId, phase: 'start', message: 'Starting' })
    emitT({ projectId, phase: 'uploading', message: 'Uploading audio' })
    const words = await transcribeAudio(project.mp3Path, settings, {
      onProgress: (message) => emitT({ projectId, phase: 'transcribing', message })
    })
    emitT({ projectId, phase: 'transcribing', message: 'Aligning words' })

    const rows: TranscriptWord[] = words.map((w, i) => ({
      id: `${projectId}-w-${i}`,
      projectId,
      ord: i,
      word: w.word,
      start: w.start,
      end: w.end,
      emphasis: false
    }))
    repos.replaceTranscript(projectId, rows)
    pushActivity({ t: hhmm(), icon: '↻', color: '#8b7cff', text: `Transcribed ${project.title} — ${rows.length} words` })
    emitT({ projectId, phase: 'done', message: 'Done' })
    return rows
  } catch (e) {
    const msg = (e as Error).message
    emitT({ projectId, phase: 'error', message: msg, error: msg })
    pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Transcription failed: ${project.title.slice(0, 42)} — ${msg.slice(0, 80)}` })
    throw e
  }
}

function previewSpec(projectId: string, draftOverrides?: Partial<Project>): GpuRenderSpec {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  validateDownloadedAudio(project.downloadId, project.mp3Path, project.durationSec)

  const draftProject: Project = {
    ...project,
    ...(draftOverrides ?? {}),
    id: project.id,
    downloadId: project.downloadId,
    mp3Path: project.mp3Path,
    betaOpts: draftOverrides?.betaOpts ?? project.betaOpts
  }
  const settings = { ...getSettings(), quality: '720p' as const }
  const beta = projectVideoOpts(draftProject)
  const words = repos.getTranscript(projectId)
  const hookText = beta.hook.enabled
    ? (beta.hook.text.trim() || words.slice(0, 8).map((w) => w.word).join(' '))
    : ''
  const style = beta.style
  const styleLead = styleCaptionLead(style)
  const plan = beta.effectPlanJson.trim()
    ? validateEffectPlan(beta.effectPlanJson, draftProject.durationSec).plan
    : deriveStylePlan(words, style, draftProject.durationSec)
  const { zoomHits } = buildAss(words, {
    preset: draftProject.captionPreset,
    font: draftProject.captionFont,
    animation: draftProject.captionAnim,
    aspect: draftProject.captionAspect,
    lines: draftProject.captionLines ?? 1,
    position: draftProject.captionPosition ?? 'bottom',
    mode: draftProject.captionPace === 'word' ? 'word' : draftProject.captionPace === 'phrase' ? 'phrase' : undefined,
    keywords: draftProject.keywords || beta.autoHighlight,
    hook: hookText ? { text: hookText, untilSec: 2.6 } : undefined,
    styleLead,
    textEffects: plan.textEffects,
    highlightColor: draftProject.captionHighlightColor,
    highlightBox: draftProject.captionPreset === 'Submagic'
      ? { enabled: true, boxColor: draftProject.captionBoxColor ?? '#ffd93d', textColor: draftProject.captionHighlightColor ?? '#111111' }
      : undefined,
    wordsPerPage: draftProject.captionWordsPerPage
  })
  const dims = gpuDimensions(settings.quality, draftProject.captionAspect)
  const overlayPath = overlayGradientPath(beta.overlay, dims.w, dims.h)
  const dir = cacheDir('preview-specs')
  mkdirSync(dir, { recursive: true })
  const base = `${safeName(draftProject.title)}-${Date.now()}`
  const previewBrollSegments = beta.broll.enabled
    ? buildCachedBrollPreviewSegments({
        words,
        durationSec: draftProject.durationSec,
        density: beta.broll.density,
        poolSize: beta.broll.poolSize,
        dims,
        maxSegments: Math.max(1, Math.min(8, Math.ceil(Math.max(1, draftProject.durationSec) / 9))),
        poolKey: repos.nicheKeyForDownload(draftProject.downloadId)
      })
    : []
  return buildGpuRenderSpec({
    project: draftProject,
    images: repos.getProjectImages(projectId),
    words,
    settings,
    zoomHits,
    overlayPath,
    voicePath: draftProject.mp3Path,
    hookText,
    out: {
      h264Path: join(dir, `${base}.gpu.mp4`),
      finalPath: join(dir, `${base}.mp4`)
    },
    brollSegments: previewBrollSegments.length ? previewBrollSegments : undefined
  })
}

function posterFrame(videoPath: string): Promise<string> {
  if (!videoPath || !existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`)
  const dir = cacheDir('posters')
  mkdirSync(dir, { recursive: true })
  const hash = createHash('sha1').update(videoPath).digest('hex').slice(0, 24)
  const out = join(dir, `${hash}.png`)
  const read = (): string => `data:image/png;base64,${readFileSync(out).toString('base64')}`
  if (existsSync(out)) return Promise.resolve(read())

  return new Promise((resolve, reject) => {
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '0', '-i', videoPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2', out]
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d) => { err += String(d) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && existsSync(out)) resolve(read())
      else reject(new Error(`poster frame ffmpeg ${code ?? 'failed'}: ${err.slice(-300)}`))
    })
  })
}

function previewRenderDimensions(aspect: Project['captionAspect']): { w: number; h: number } {
  if (aspect === '9:16') return { w: 360, h: 640 }
  if (aspect === '1:1') return { w: 480, h: 480 }
  return { w: 640, h: 360 }
}

function previewStillPath(imagePath: string, dir: string, maxWidth: number): Promise<string> {
  if (!imagePath || !existsSync(imagePath)) return Promise.resolve(imagePath)
  let key = ''
  try {
    const st = statSync(imagePath)
    key = createHash('sha1').update(`${imagePath}:${st.size}:${st.mtimeMs}:w${maxWidth}`).digest('hex').slice(0, 24)
  } catch {
    key = createHash('sha1').update(`${imagePath}:w${maxWidth}`).digest('hex').slice(0, 24)
  }
  const out = join(dir, `preview-still-${key}.jpg`)
  if (existsSync(out)) return Promise.resolve(out)

  return new Promise((resolve) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', imagePath,
      '-frames:v', '1',
      '-vf', `scale=${maxWidth}:-2:force_original_aspect_ratio=decrease`,
      '-q:v', '6',
      out
    ]
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    child.stderr.resume()
    child.on('error', () => resolve(imagePath))
    child.on('close', (code) => {
      if (code === 0 && existsSync(out)) resolve(out)
      else resolve(imagePath)
    })
  })
}

async function previewProject(projectId: string): Promise<string> {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  validateDownloadedAudio(project.downloadId, project.mp3Path, project.durationSec)
  // The frontend can re-request a preview for the same project before the previous
  // one finishes (WebGL fallback effects re-firing, rapid style edits). Both attempts
  // share jobId `preview-${projectId}`; without this, they pile up as separate ffmpeg
  // processes and blow past the GPU's concurrent NVENC session limit, producing
  // "invalid argument" encoder-open failures (see ELECTRON-2). Kill the stale one first.
  // cancelRender marks a cancel intent for this jobId; nothing ever consumes it for
  // preview jobs (only the render queue does, per real job), so it would linger and
  // make the *next* preview's real failures look like intentional cancels — skipping
  // the GPU retry/wrap and leaking a raw unhandled ffmpeg error (see ELECTRON-5).
  cancelRender(`preview-${projectId}`, 'cancel')
  consumeCancelIntent(`preview-${projectId}`)

  const settings = getSettings()
  // Previews are throwaway (640x360, <=5s) and always encode on the CPU (libx264
  // ultrafast), regardless of the user's chosen encoder. A GPU encoder buys nothing on
  // a clip this small, and honoring NVENC/QSV/AMF here was the sole source of the
  // preview freeze + "ffmpeg exited null / Could not open encoder" failures: consumer
  // GPUs cap concurrent encode sessions, so rapid previews (and the cancel-stale-then-
  // restart flow) collide on that limit, then the strict-GPU no-fallback policy retries
  // into the same wall and hard-errors (ELECTRON-2 / ELECTRON-5). libx264 has no such
  // session limit and finishes a preview in well under a second. Final/queued renders
  // still honor the user's GPU encoder — only previews are pinned to CPU.
  const previewSettings = { ...settings, encoder: 'cpu' as const, quality: '720p' as const }
  const caps = probeRenderCapabilities()
  const previewSec = Math.max(1, Math.min(5, project.durationSec || 5))
  const dir = cacheDir('previews')
  mkdirSync(dir, { recursive: true })
  const base = `${safeName(project.title)}-preview-${Date.now()}`
  const assPath = join(dir, `${base}.ass`)
  const outPath = join(dir, `${base}.mp4`)
  const logPath = join(dir, `${base}.render.log`)

  const beta = projectVideoOpts(project)
  const words = repos.getTranscript(projectId).filter((w) => w.start < previewSec)
  const hookText = beta.hook.enabled
    ? (beta.hook.text.trim() || words.slice(0, 8).map((w) => w.word).join(' '))
    : ''
  const style = beta.style
  const styleLead = styleCaptionLead(style)
  const plan = beta.effectPlanJson.trim()
    ? validateEffectPlan(beta.effectPlanJson, previewSec).plan
    : deriveStylePlan(words, style, previewSec)
  const { ass } = buildAss(words, {
    preset: project.captionPreset,
    font: project.captionFont,
    animation: project.captionAnim,
    aspect: project.captionAspect,
    lines: project.captionLines ?? 1,
    position: project.captionPosition ?? 'bottom',
    mode: 'phrase',
    keywords: project.keywords || beta.autoHighlight,
    hook: hookText ? { text: hookText, untilSec: Math.min(2.6, previewSec) } : undefined,
    styleLead,
    textEffects: plan.textEffects,
    highlightColor: project.captionHighlightColor,
    highlightBox: project.captionPreset === 'Submagic'
      ? { enabled: true, boxColor: project.captionBoxColor ?? '#ffd93d', textColor: project.captionHighlightColor ?? '#111111' }
      : undefined,
    wordsPerPage: project.captionWordsPerPage
  })
  writeFileSync(assPath, ass)

  const previewDims = previewRenderDimensions(project.captionAspect)
  const existingImages = repos.getProjectImages(projectId)
  const previewImagePath = existingImages[0]
    ? await previewStillPath(existingImages[0].thumb || existingImages[0].path, dir, previewDims.w)
    : ''
  const images: ProjectImage[] = existingImages[0]
    ? [{
        ...existingImages[0],
        path: previewImagePath,
        thumb: previewImagePath,
        rangeStart: 0,
        rangeEnd: previewSec
      }]
    : []
  const previewBeta = { ...beta, broll: { ...beta.broll, enabled: false } }

  await runRender({
    // motionPreset:'off' keeps the preview motion-free (as it always was under the
    // default GPU encoder, where CPU motion filters are skipped) now that previews
    // encode on the CPU — otherwise Ken Burns/punch would suddenly appear in previews
    // but not in a GPU final render, and slow the throwaway encode down.
    project: { ...project, durationSec: previewSec, kenBurns: false, punchZoom: false, motionPreset: 'off', betaOpts: previewBeta },
    images,
    assPath,
    outPath,
    settings: previewSettings,
    caps,
    transition: style !== 'None' ? styleTransition(style) : undefined,
    plan,
    jobId: `preview-${projectId}`,
    logPath,
    skipAudioMaster: true,
    previewDimensions: previewDims,
    cpuPreset: 'ultrafast'
  })
  pushActivity({ t: hhmm(), icon: '▶', color: '#8b7cff', text: `Preview rendered: ${project.title.slice(0, 42)}` })
  return outPath
}

export function registerComposeIpc(): void {
  const repos = () => getRepos()
  ipcMain.handle('looks:list', () => LOOKS)
  ipcMain.handle('compose:createProject', (_e, downloadId: string) => createProject(downloadId))
  ipcMain.handle('compose:get', (_e, id: string) => repos().getProject(id) ?? null)
  ipcMain.handle('compose:list', () => repos().listProjects())
  ipcMain.handle('compose:images', (_e, projectId: string) => repos().getProjectImages(projectId))
  ipcMain.handle('compose:setImages', (_e, projectId: string, paths: string[]) => setImages(projectId, paths))
  ipcMain.handle('compose:reorderImages', (_e, projectId: string, imageIds: string[]) => reorderImages(projectId, imageIds))
  ipcMain.handle('compose:setRanges', (_e, projectId: string, ranges: { id: string; rangeStart: number; rangeEnd: number }[]) => {
    repos().setImageRanges(projectId, ranges)
    return repos().getProjectImages(projectId)
  })
  ipcMain.handle('compose:setImageMotion', (_e, projectId: string, updates: ProjectImageMotionPatch[]) => setImageMotion(projectId, updates))
  ipcMain.handle('compose:setMedia', (_e, projectId: string, patch: Partial<Project>) => repos().updateProject(projectId, patch))
  ipcMain.handle('compose:setCaptions', (_e, projectId: string, patch: Partial<Project>) => repos().updateProject(projectId, patch))
  ipcMain.handle('compose:updateLook', (_e, projectId: string, patch: { lut?: string; strength?: number; adjust?: LookAdjust }) => updateLook(projectId, patch))
  ipcMain.handle('compose:updateMotion', (_e, projectId: string, patch: { preset: MotionPreset }) => updateMotion(projectId, patch))
  ipcMain.handle('compose:updateCaptions', (_e, projectId: string, patch: Partial<Project>) => updateCaptions(projectId, patch))
  ipcMain.handle('compose:previewSpec', (_e, projectId: string, draftOverrides?: Partial<Project>) => previewSpec(projectId, draftOverrides))
  ipcMain.handle('compose:posterFrame', (_e, path: string) => posterFrame(path))
  ipcMain.handle('compose:preview', (_e, projectId: string) => previewProject(projectId))
  ipcMain.handle('compose:sendToRender', (_e, projectId: string) => sendToRender(projectId))

  ipcMain.handle('transcribe:run', (_e, projectId: string) => runTranscribe(projectId))
  ipcMain.handle('transcribe:get', (_e, projectId: string) => repos().getTranscript(projectId))
  ipcMain.handle('transcribe:updateWord', (_e, wordId: string, text: string) => repos().updateWord(wordId, text))
  ipcMain.handle('transcribe:toggleEmphasis', (_e, wordId: string) => repos().toggleEmphasis(wordId))
  ipcMain.handle('transcribe:setEmphasis', (_e, wordIds: string[], emphasis: boolean) => repos().setEmphasis(wordIds, emphasis))
}

// Exported for the headless M4 smoke harness.
export { createProject, setImages, sendToRender, runTranscribe }
