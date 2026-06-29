import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Project, ProjectImage, RenderJob, RenderProgress, RenderStage } from '../../shared/types'
import { asBetaOpts } from '../../shared/types'
import { styleCaptionLead, styleTransition, deriveStylePlan, validateEffectPlan, EMPTY_PLAN } from '../../shared/effectPlan'
import { buildSfxTrack } from './sfx'
import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { formatOutputName, probeDuration } from './audio'
import { buildAss } from './captions'
import { runRender, dimensions, consumeCancelIntent, hasCancelIntent, canUseCudaFinalFilters } from './render'
import { buildBrollManifest } from './broll'
import { probeRenderCapabilities } from './engine/caps'
import { selectEncoder } from './engine/encoder'
import type { FfmpegProgress } from './engine/progress'
import { emit, hhmm, pushActivity } from '../ipc/events'
import { safeName } from '../../shared/sanitize'

// Concurrency-limited render runner. Pulls queued render_jobs, renders up to
// settings.concurrency at once, writes the .ass + mp4, and streams render:progress.

export function outputDir(): string {
  const s = getSettings()
  return s.outputFolder || join(app.getPath('downloads'), 'MentalEmpire_out')
}

function emitR(p: RenderProgress): void {
  emit('render:progress', p)
}

const STAGE_WEIGHTS: Array<{ stage: RenderStage; weight: number }> = [
  { stage: 'preparing', weight: 5 },
  { stage: 'captioning', weight: 5 },
  { stage: 'fetching-broll', weight: 15 },
  { stage: 'assembling', weight: 15 },
  { stage: 'encoding', weight: 55 },
  { stage: 'finalizing', weight: 5 }
]

function stagePct(stage: RenderStage, localPct: number): number {
  let offset = 0
  for (const item of STAGE_WEIGHTS) {
    if (item.stage === stage) return Math.max(0, Math.min(99, Math.round(offset + (Math.max(0, Math.min(100, localPct)) / 100) * item.weight)))
    offset += item.weight
  }
  return Math.max(0, Math.min(100, Math.round(localPct)))
}

function alignImagesToDuration(images: ProjectImage[], durationSec: number): ProjectImage[] {
  if (!images.length || durationSec <= 0) return images
  const next = images.map((im) => ({ ...im }))
  next[next.length - 1].rangeEnd = durationSec
  return next
}

function captionRenderMode(project: Pick<Project, 'durationSec' | 'captionPace'>, wordCount: number): 'word' | 'phrase' {
  if (project.captionPace === 'word') return 'word'
  if (project.captionPace === 'phrase') return 'phrase'
  const durationSec = project.durationSec
  return durationSec >= 600 || wordCount >= 1500 ? 'phrase' : 'word'
}

let maxActive = 0
/** Peak parallelism observed during the last runAll — asserted by the smoke. */
export function lastMaxActive(): number {
  return maxActive
}

export async function runJob(job: RenderJob): Promise<void> {
  const repos = getRepos()
  const project = repos.getProject(job.projectId)
  if (!project) {
    repos.setRenderStatus(job.id, { status: 'error', pct: 0, error: 'project missing' })
    emitR({ jobId: job.id, pct: 0, stage: 'error', done: true, error: 'project missing' })
    return
  }
  let images = repos.getProjectImages(job.projectId)
  const words = repos.getTranscript(job.projectId)
  const settings = getSettings()
  const caps = probeRenderCapabilities()
  const enc = selectEncoder(settings, caps)
  let filterDevice: RenderProgress['filterDevice'] = 'cpu'
  let encoderDetail = enc.device === 'gpu' ? `${enc.label} encode · CPU filters` : `${enc.label} encode`
  let filterDetail = enc.device === 'gpu' ? 'CPU filters/captions' : undefined
  const dir = outputDir()
  mkdirSync(dir, { recursive: true })
  // Base output name. If a *different* project shares the same channel+title, append the
  // video id so the two don't overwrite each other's .mp4/.ass/.log (re-rendering the
  // same project keeps the same name, so it overwrites itself as expected).
  let base = formatOutputName(settings.namingTemplate, { channel: project.channel, title: project.title })
  const dupe = repos.listProjects().some((p) => p.id !== project.id && p.channel === project.channel && p.title === project.title)
  if (dupe) base = `${base} (${project.downloadId.replace(/^dl-/, '').slice(0, 11)})`
  const assPath = join(dir, `${base}.ass`)
  const outPath = join(dir, `${base}.mp4`)
  const logPath = join(dir, `${base}.render.log`)
  let renderLogPath = logPath
  let activeLogStage: RenderStage | undefined
  let activeLogStageStartedAt = 0
  writeFileSync(logPath, `[render]\njob=${job.id}\nproject=${project.id}\ntitle=${project.title}\nstarted=${new Date().toISOString()}\nencoder=${enc.label}\n`)
  const finishStageLog = (status: 'done' | 'error' | 'cancelled'): void => {
    if (!renderLogPath || !activeLogStage || !activeLogStageStartedAt) return
    const now = Date.now()
    appendFileSync(renderLogPath, `[stage:end] ${activeLogStage} ms=${now - activeLogStageStartedAt} status=${status}\n`)
    appendFileSync(renderLogPath, `[render:end] status=${status} at=${new Date(now).toISOString()}\n`)
    activeLogStage = undefined
    activeLogStageStartedAt = 0
  }
  const finishCancelled = (intent: 'cancel' | 'delete'): void => {
    finishStageLog('cancelled')
    if (intent === 'cancel') repos.setRenderStatus(job.id, { status: 'queued', pct: 0, error: '' })
    emitR({ jobId: job.id, pct: 0, stage: 'done', done: true })
    pushActivity({ t: hhmm(), icon: '⊘', color: '#8a909c', text: `Render ${intent === 'cancel' ? 'cancelled' : 'removed'}: ${project.title.slice(0, 42)}` })
  }
  const emitStage = (stage: RenderStage, localPct: number, stageDetail?: string, ffmpeg?: FfmpegProgress): void => {
    const pct = stagePct(stage, localPct)
    repos.setRenderStatus(job.id, { status: 'rendering', pct })
    emitR({
      jobId: job.id,
      pct,
      stage,
      stageDetail,
      done: false,
      etaSec: ffmpeg?.etaSec,
      etaState: ffmpeg?.etaState,
      speed: ffmpeg?.speed,
      fps: ffmpeg?.fps,
      bitrate: ffmpeg?.bitrate,
      device: enc.device,
      filterDevice,
      filterDetail,
      encoder: enc.label
    })
    if (renderLogPath) {
      const now = Date.now()
      if (activeLogStage !== stage) {
        if (activeLogStage && activeLogStageStartedAt) appendFileSync(renderLogPath, `[stage:end] ${activeLogStage} ms=${now - activeLogStageStartedAt} status=transition\n`)
        activeLogStage = stage
        activeLogStageStartedAt = now
        appendFileSync(renderLogPath, `[stage:start] ${stage} at=${new Date(now).toISOString()}\n`)
      }
      appendFileSync(renderLogPath, `[stage] ${stage} ${pct}% ${stageDetail ?? ''}${ffmpeg?.speed ? ` speed=${ffmpeg.speed}` : ''}${ffmpeg?.etaSec != null ? ` eta=${ffmpeg.etaSec}` : ''}\n`)
    }
  }
  // Only the audio is truly required to produce a video: the graph falls back to a
  // solid background when there are no images, captions are optional (no subtitles),
  // and the thumbnail is a separate PNG deliverable that never enters the mp4. So we
  // no longer block a render on images/captions/thumbnail — they're advisory only.
  const preflightMissing: string[] = []
  if (!project.mp3Path || !existsSync(project.mp3Path)) preflightMissing.push('MP3')
  if (preflightMissing.length) {
    const msg = `Missing required render assets: ${preflightMissing.join(', ')}`
    repos.setRenderStatus(job.id, { status: 'error', pct: 0, error: msg })
    emitR({ jobId: job.id, pct: 0, stage: 'error', done: true, error: msg })
    pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Render blocked: ${project.title.slice(0, 42)} — ${msg}` })
    return
  }

  repos.setRenderStatus(job.id, { status: 'rendering', pct: 0 })
  emitStage('preparing', 0, `Checking audio duration · ${encoderDetail}`)

  const probedDuration = await probeDuration(project.mp3Path).catch(() => project.durationSec)
  const trueDuration = probedDuration > 0 ? probedDuration : project.durationSec
  if (!trueDuration || trueDuration <= 0) {
    const msg = 'Missing required render assets: duration'
    repos.setRenderStatus(job.id, { status: 'error', pct: 0, error: msg })
    emitR({ jobId: job.id, pct: 0, stage: 'error', done: true, error: msg })
    pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Render blocked: ${project.title.slice(0, 42)} — ${msg}` })
    return
  }
  const renderProject = Math.abs(trueDuration - project.durationSec) > 1
    ? { ...project, durationSec: trueDuration }
    : project
  if (renderProject !== project) repos.updateProject(project.id, { durationSec: trueDuration })
  images = alignImagesToDuration(images, renderProject.durationSec)
  emitStage('preparing', 100, `Audio duration ${Math.round(renderProject.durationSec)}s · ${encoderDetail}`)

  // Beta: fold hook + auto-highlight into the caption options when beta mode is on.
  const beta = settings.beta?.enabled ? asBetaOpts(project.betaOpts) : null
  // Surface exactly which beta effects will be applied so a render is never silently
  // "cinematic"/"b-roll" — shown on the queue row detail and written to the log.
  const effectsSummary = beta
    ? [
        beta.style !== 'None' ? beta.style : null,
        beta.broll.enabled ? `B-roll ${beta.broll.density}` : null,
        beta.autoZoom.atStart || beta.autoZoom.atKeyPhrases ? 'auto-zoom' : null,
        (beta.overlay.bottom || beta.overlay.top || beta.overlay.left || beta.overlay.right) ? 'overlay' : null,
        beta.autoHighlight ? 'highlight' : null,
        beta.hook.enabled ? 'hook' : null
      ].filter(Boolean).join(' · ') || 'no effects'
    : 'plain (images + captions)'
  if (renderLogPath) appendFileSync(renderLogPath, `effects=${effectsSummary}\n`)
  encoderDetail = `${encoderDetail} · ${effectsSummary}`
  const hookText = beta?.hook.enabled
    ? (beta.hook.text.trim() || words.slice(0, 8).map((w) => w.word).join(' '))
    : ''
  // Beta style → transitions + caption "feel". A pasted/LLM effect plan overrides the
  // built-in rule engine; both pass through validateEffectPlan's guardrails.
  const style = beta?.style ?? 'None'
  const styleLead = beta ? styleCaptionLead(style) : undefined
  const transition = beta && style !== 'None' ? styleTransition(style) : undefined
  // The effect plan (pasted/LLM JSON overrides the rule engine) drives per-boundary
  // transitions + the SFX track. Both go through validateEffectPlan's guardrails.
  const plan = beta
    ? (beta.effectPlanJson.trim() ? validateEffectPlan(beta.effectPlanJson, renderProject.durationSec).plan : deriveStylePlan(words, style, renderProject.durationSec))
    : EMPTY_PLAN
  const sfxPath = beta ? buildSfxTrack(plan.transitions, renderProject.durationSec) ?? undefined : undefined

  emitStage('captioning', 20, 'Building caption file')
  const captionMode = captionRenderMode(renderProject, words.length)
  const { ass } = buildAss(words, {
    preset: renderProject.captionPreset,
    font: renderProject.captionFont,
    animation: renderProject.captionAnim,
    aspect: renderProject.captionAspect,
    lines: renderProject.captionLines ?? 1,
    position: renderProject.captionPosition ?? 'bottom',
    mode: captionMode,
    keywords: renderProject.keywords || !!beta?.autoHighlight,
    hook: hookText ? { text: hookText, untilSec: 2.6 } : undefined,
    styleLead,
    textEffects: beta ? plan.textEffects : undefined
  })
  writeFileSync(assPath, ass)
  const dialogueCount = (ass.match(/^Dialogue:/gm) ?? []).length
  if (renderLogPath) appendFileSync(renderLogPath, `[captions]\nmode=${captionMode}\npace=${renderProject.captionPace ?? 'auto'}\nwords=${words.length}\ndialogues=${dialogueCount}\nlines=${renderProject.captionLines ?? 1}\n`)
  emitStage('captioning', 100, captionMode === 'phrase' ? `Caption file ready · steady phrases (${dialogueCount} events)` : 'Caption file ready')

  // Beta auto-B-roll v2: normalize selected stock segments to a resumable concat
  // manifest, then feed that manifest into the final render as one continuous input.
  //
  // B2 (perf) note — evaluated, intentionally kept: this normalizes each segment to its
  // own mp4 (encode #1) and the final render re-encodes the concat (encode #2). A true
  // single-pass `assembleBed`/`brollSegments` graph exists, but the manifest approach is
  // kept deliberately because it's RESUMABLE (normalizeSegment caches `seg-NNN.mp4` per
  // job dir, so a cancelled/failed render reuses finished segments) and it isolates
  // per-clip codec/timebase quirks. The cheap win already in place is that cache; a
  // cross-render segment cache (keyed by clip+dims+fps+style) is the next step if B-roll
  // encode time becomes the bottleneck. Switching to single-pass is deferred as it would
  // need real ffmpeg validation that isn't available in CI.
  let brollManifestPath: string | undefined
  // Tracks whether requested B-roll silently degraded to the image track, so the render
  // row + log can say so instead of the user wondering why the output looks different.
  let brollFallback = false
  if (beta?.broll.enabled) {
    const hasStockSource = !!(settings.beta.pexelsKey || settings.beta.pixabayKey || settings.beta.coverrKey || process.env['ME_BROLL_LOCAL'] || process.env['ME_BROLL_FIXTURE'])
    if (!hasStockSource) {
      const msg = 'Stock B-roll unavailable: add a Pexels, Pixabay, or Coverr key in Settings'
      if (renderLogPath) appendFileSync(renderLogPath, `[broll:warn] ${msg}\n`)
      brollFallback = true
      emitStage('fetching-broll', 100, 'B-roll unavailable: missing stock API key')
      emitStage('assembling', 100, 'Using image track')
      pushActivity({ t: hhmm(), icon: '!', color: '#f5b323', text: `B-roll skipped: add a stock-footage API key for ${project.title.slice(0, 36)}` })
    } else try {
      const dims = dimensions(settings.quality, renderProject.captionAspect)
      const maxSegments = renderProject.durationSec > 600 ? 36 : 48
      const planned = await buildBrollManifest({
        settings,
        caps,
        words,
        durationSec: renderProject.durationSec,
        density: beta.broll.density,
        poolSize: beta.broll.poolSize,
        dims,
        fps: 24,
        style,
        jobId: job.id,
        maxSegments,
        shouldCancel: () => hasCancelIntent(job.id),
        logPath,
        onProgress: (phase, done, total, ffmpeg) => {
          if (phase === 'normalize') {
            const pct = total > 0 ? (done / total) * 100 : 0
            emitStage('assembling', ffmpeg?.pct ?? pct, `Normalizing B-roll ${Math.min(total, Math.floor(done) + 1)}/${total}`, ffmpeg)
          } else if (phase === 'manifest') {
            emitStage('assembling', 100, 'B-roll manifest ready')
          } else {
            emitStage('fetching-broll', total > 0 ? (done / total) * 100 : 0, `${phase === 'download' ? 'Downloading' : 'Fetching'} B-roll ${done}/${total}`)
          }
        }
      })
      if (planned?.segments.length) {
        brollManifestPath = planned.manifestPath
        if (enc.device === 'gpu' && canUseCudaFinalFilters(settings, caps)) {
          encoderDetail = `${enc.label} encode · CUDA scale + CPU captions`
          filterDetail = 'CUDA scale + CPU captions'
          filterDevice = 'gpu'
        }
        if (renderLogPath) appendFileSync(renderLogPath, `[broll]\nmanifest=${planned.manifestPath}\njson=${planned.jsonPath}\nsegments=${planned.segments.length}\n`)
        emitStage('assembling', 100, `Using B-roll manifest (${planned.segments.length} clips)`)
      } else {
        const msg = 'No downloadable B-roll clips found'
        if (renderLogPath) appendFileSync(renderLogPath, `[broll:warn] ${msg}\n`)
        brollFallback = true
        emitStage('fetching-broll', 100, 'B-roll unavailable: no clips found')
        emitStage('assembling', 100, 'Using image track')
        pushActivity({ t: hhmm(), icon: '!', color: '#f5b323', text: `B-roll skipped: no stock clips found for ${project.title.slice(0, 36)}` })
      }
    } catch (e) {
      if (hasCancelIntent(job.id)) {
        const intent = consumeCancelIntent(job.id)
        if (intent) {
          finishCancelled(intent)
          return
        }
        throw e
      }
      const msg = (e as Error).message
      if (renderLogPath) appendFileSync(renderLogPath, `[broll:warn] ${msg}\n`)
      brollFallback = true
      emitStage('fetching-broll', 100, 'B-roll unavailable; using image track')
      emitStage('assembling', 100, 'Using image track')
      pushActivity({ t: hhmm(), icon: '!', color: '#f5b323', text: `B-roll skipped: ${msg.slice(0, 90)}` })
    }
  } else {
    emitStage('fetching-broll', 100, 'B-roll disabled')
    emitStage('assembling', 100, 'Using image track')
  }

  try {
    if (hasCancelIntent(job.id)) throw new Error('render cancelled')
    await runRender({ project: renderProject, images, assPath, outPath, settings, caps, brollManifestPath, transition, plan, sfxPath, jobId: job.id, logPath }, (p) => {
      emitStage('encoding', p.pct, `Encoding with ${encoderDetail}`, p)
    })
    emitStage('finalizing', 90, 'Writing output')
    finishStageLog('done')
    repos.setRenderStatus(job.id, { status: 'done', pct: 100, outputPath: outPath })
    repos.updateProject(job.projectId, { stage: 'rendered' })
    const doneDetail = brollFallback ? 'Done · B-roll unavailable, used images' : 'Done'
    emitR({ jobId: job.id, pct: 100, stage: 'done', stageDetail: doneDetail, done: true, outputPath: outPath, device: enc.device, filterDevice, filterDetail, encoder: enc.label, etaSec: 0, etaState: 'stable' })
    pushActivity({ t: hhmm(), icon: '✓', color: '#36c98e', text: `Rendered ${project.title} → ${base}.mp4` })
  } catch (e) {
    // A ffmpeg failure caused by the user cancelling/deleting the job isn't an error:
    // restore it to 'queued' (cancel) or leave the now-deleted row alone (delete).
    const intent = consumeCancelIntent(job.id)
    if (intent) {
      finishCancelled(intent)
      return
    }
    const msg = (e as Error).message
    finishStageLog('error')
    repos.setRenderStatus(job.id, { status: 'error', pct: 0, error: msg })
    emitR({ jobId: job.id, pct: 0, stage: 'error', done: true, error: msg })
    pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Render failed: ${project.title}` })
  }
}

/** Render every queued job, at most `settings.concurrency` in flight at a time. */
export async function runAll(): Promise<void> {
  const jobs = getRepos().queuedJobs()
  const settings = getSettings()
  const requested = Math.max(1, settings.concurrency)
  // Consumer GPUs cap concurrent hardware-encode sessions (often 2–3 on GeForce) and a
  // single encoder ASIC means parallel HW encodes mostly contend rather than speed up.
  // So when a GPU encoder is selected, cap effective parallelism for the encode stage.
  const enc = selectEncoder(settings, probeRenderCapabilities())
  const concurrency = enc.device === 'gpu' ? Math.min(requested, 2) : requested
  let idx = 0
  let active = 0
  maxActive = 0

  await new Promise<void>((resolve) => {
    const pump = (): void => {
      if (idx >= jobs.length && active === 0) {
        resolve()
        return
      }
      while (active < concurrency && idx < jobs.length) {
        const job = jobs[idx++]
        active++
        maxActive = Math.max(maxActive, active)
        void runJob(job).finally(() => {
          active--
          pump()
        })
      }
    }
    pump()
  })
}
