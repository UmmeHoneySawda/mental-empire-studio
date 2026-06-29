import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectImage, TranscribeProgress, TranscriptWord } from '../../shared/types'
import { asBetaOpts } from '../../shared/types'
import { deriveStylePlan, EMPTY_PLAN, styleCaptionLead, styleTransition, validateEffectPlan } from '../../shared/effectPlan'
import { getSettings } from '../store/settings'
import { getRepos } from '../db'
import { splitRanges } from '../services/audio'
import { importImages, seededShuffle } from '../services/images'
import { transcribeAudio } from '../services/transcribe'
import { emit, hhmm, pushActivity } from './events'
import { outputDir } from '../services/queue'
import { buildAss } from '../services/captions'
import { runRender } from '../services/render'
import { probeRenderCapabilities } from '../services/engine/caps'

// Compose orchestration: build a project from a downloaded mp3, manage its image
// ranges + caption recipe, run transcription (Groq), and push to the render queue.

function projectsDir(): string {
  return join(app.getPath('userData'), 'projects')
}

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
    seed: Math.floor(Math.random() * 9000) + 1000,
    crossfade: 0.8,
    captionPreset: 'Hormozi',
    captionFont: 'Montserrat',
    captionAnim: 'Pop-in',
    captionAspect: '16:9',
    captionLines: 2,
    captionPosition: 'bottom',
    captionPace: 'auto',
    emphasis: true,
    keywords: true,
    punchZoom: true,
    stage: 'composing',
    createdAt: new Date().toISOString()
  }
}

function safeName(name: string): string {
  return (name.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || 'thumbnail').slice(0, 120)
}

function effectiveThumbnailPath(project: Project): string | null {
  if (project.thumbPath) return project.thumbPath
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
  return p
}

function setImages(projectId: string, paths: string[]): ProjectImage[] {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  let copied = importImages(join(projectsDir(), projectId), paths)
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

async function previewProject(projectId: string): Promise<string> {
  const repos = getRepos()
  const project = repos.getProject(projectId)
  if (!project) throw new Error(`Unknown project: ${projectId}`)
  validateDownloadedAudio(project.downloadId, project.mp3Path, project.durationSec)

  const settings = getSettings()
  const previewSettings = { ...settings, quality: '720p' as const }
  const caps = probeRenderCapabilities()
  const previewSec = Math.max(1, Math.min(5, project.durationSec || 5))
  const dir = join(outputDir(), 'previews')
  mkdirSync(dir, { recursive: true })
  const base = `${safeName(project.title)}-preview-${Date.now()}`
  const assPath = join(dir, `${base}.ass`)
  const outPath = join(dir, `${base}.mp4`)
  const logPath = join(dir, `${base}.render.log`)

  const beta = settings.beta?.enabled ? asBetaOpts(project.betaOpts) : null
  const words = repos.getTranscript(projectId).filter((w) => w.start < previewSec)
  const hookText = beta?.hook.enabled
    ? (beta.hook.text.trim() || words.slice(0, 8).map((w) => w.word).join(' '))
    : ''
  const style = beta?.style ?? 'None'
  const styleLead = beta ? styleCaptionLead(style) : undefined
  const plan = beta
    ? (beta.effectPlanJson.trim() ? validateEffectPlan(beta.effectPlanJson, previewSec).plan : deriveStylePlan(words, style, previewSec))
    : EMPTY_PLAN
  const { ass } = buildAss(words, {
    preset: project.captionPreset,
    font: project.captionFont,
    animation: project.captionAnim,
    aspect: project.captionAspect,
    lines: project.captionLines ?? 1,
    position: project.captionPosition ?? 'bottom',
    keywords: project.keywords || !!beta?.autoHighlight,
    hook: hookText ? { text: hookText, untilSec: Math.min(2.6, previewSec) } : undefined,
    styleLead,
    textEffects: beta ? plan.textEffects : undefined
  })
  writeFileSync(assPath, ass)

  const existingImages = repos.getProjectImages(projectId)
  const images: ProjectImage[] = existingImages[0]
    ? [{
        ...existingImages[0],
        path: existingImages[0].thumb || existingImages[0].path,
        thumb: existingImages[0].thumb || existingImages[0].path,
        rangeStart: 0,
        rangeEnd: previewSec
      }]
    : []
  const previewBeta = beta ? { ...beta, broll: { ...beta.broll, enabled: false } } : project.betaOpts

  await runRender({
    project: { ...project, durationSec: previewSec, kenBurns: false, punchZoom: false, betaOpts: previewBeta },
    images,
    assPath,
    outPath,
    settings: previewSettings,
    caps,
    transition: beta && style !== 'None' ? styleTransition(style) : undefined,
    plan,
    jobId: `preview-${projectId}`,
    logPath
  })
  pushActivity({ t: hhmm(), icon: '▶', color: '#8b7cff', text: `Preview rendered: ${project.title.slice(0, 42)}` })
  return outPath
}

export function registerComposeIpc(): void {
  const repos = () => getRepos()
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
  ipcMain.handle('compose:setMedia', (_e, projectId: string, patch: Partial<Project>) => repos().updateProject(projectId, patch))
  ipcMain.handle('compose:setCaptions', (_e, projectId: string, patch: Partial<Project>) => repos().updateProject(projectId, patch))
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
