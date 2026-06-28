import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, Project, ProjectImage, RenderCapabilities } from '../../shared/types'
import { asBetaOpts } from '../../shared/types'
import type { EffectPlan } from '../../shared/effectPlan'
import { resolveBinDir } from './ytdlp'
import { resolutionFor, type CaptionAspect } from './captions'
import { FALLBACK_CAPS, selectEncoder } from './engine/encoder'
import { createProgressSmoother, parseFfmpegProgressBlock, type FfmpegProgress } from './engine/progress'
import { gradeChain } from './engine/grade'
import { masterAudioTwoPass } from './engine/audio-master'
import type { BrollSegment } from './broll'
import { logger } from './logger'

// ffmpeg render: image(s) over the mp3 with Ken Burns + crossfades, burned ASS
// captions, optional punch-zoom, encoded H.264 at the chosen quality. The graph is
// built purely (buildRenderArgs) so it's assertable; ME_RENDER_FIXTURE swaps the
// real encode for a stub so the runner is testable without ffmpeg.

const FPS = 30

/** Video codec args for the chosen encoder. CPU = libx264 (CRF); NVIDIA = h264_nvenc
 *  (constant-quality VBR). Both target visually-equivalent quality at the given level. */
export function videoCodecArgs(settings: AppSettings, crf: string, caps: RenderCapabilities = FALLBACK_CAPS): string[] {
  return selectEncoder(settings, caps, crf).args
}

export function canUseCudaFinalFilters(settings: AppSettings, caps: RenderCapabilities = FALLBACK_CAPS): boolean {
  return settings.encoder === 'nvenc' && caps.hasNvenc && caps.ffmpegHasCuda
}

function codecArgsForFilterOutput(settings: AppSettings, crf: string, caps: RenderCapabilities, hardwareFrames: boolean): string[] {
  const args = videoCodecArgs(settings, crf, caps)
  if (!hardwareFrames) return args
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-pix_fmt') {
      i++
      continue
    }
    out.push(args[i])
  }
  return out
}

// Live ffmpeg children keyed by render-job id, so the Render Queue's cancel/delete
// actions can actually terminate a running encode (otherwise ffmpeg keeps pegging the
// CPU after the row is gone). `intents` records why a child was killed so runJob can
// set the right post-kill status instead of marking it a render error.
const running = new Map<string, ChildProcess>()
const intents = new Map<string, 'cancel' | 'delete'>()

/** Kill the ffmpeg encode for a job (if running) and record why. Returns true if one was killed. */
export function cancelRender(jobId: string, mode: 'cancel' | 'delete'): boolean {
  const child = running.get(jobId)
  if (!child) return false
  intents.set(jobId, mode)
  child.kill('SIGKILL')
  running.delete(jobId)
  return true
}

/** Record a cancel/delete request while the job is between ffmpeg children. */
export function markCancelIntent(jobId: string, mode: 'cancel' | 'delete'): void {
  intents.set(jobId, mode)
}

/** Whether a job's last failure was an intentional cancel/delete (consumes the flag). */
export function consumeCancelIntent(jobId: string): 'cancel' | 'delete' | undefined {
  const m = intents.get(jobId)
  if (m) intents.delete(jobId)
  return m
}

/** Non-consuming check used before hardware fallback retries. */
export function hasCancelIntent(jobId?: string): boolean {
  return !!jobId && intents.has(jobId)
}

export function ffmpegPath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const vendored = join(resolveBinDir(), exe)
  return existsSync(vendored) ? vendored : exe // else rely on PATH
}

export function ffprobePath(): string {
  const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const vendored = join(resolveBinDir(), exe)
  return existsSync(vendored) ? vendored : exe // else rely on PATH
}

/** Output dimensions for a quality + aspect (even numbers for yuv420p). */
export function dimensions(quality: AppSettings['quality'], aspect: CaptionAspect): { w: number; h: number } {
  const base = quality === '720p' ? 720 : quality === '1440p' ? 1440 : 1080
  const res = resolutionFor(aspect)
  const factor = base / 1080
  const even = (n: number): number => Math.round((n * factor) / 2) * 2
  return { w: even(res.w), h: even(res.h) }
}

/** Escape an .ass path for use inside the subtitles= filter. */
function assForFilter(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

/** Beta "background overlay": a simple darkening gradient on the chosen edges,
 *  approximated by many thin drawboxes (pure-filter, no extra inputs).
 *  Returns a filter fragment ending in a comma, or '' when no edge is enabled. */
function overlayGradient(o: { bottom: boolean; top: boolean; left: boolean; right: boolean }, w: number, h: number): string {
  const boxes: string[] = []
  const steps = 24
  const edgeH = Math.max(1, Math.round(h * 0.36))
  const edgeW = Math.max(1, Math.round(w * 0.36))
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps
    const t1 = (i + 1) / steps
    const alpha = 0.5 * Math.pow(t1, 1.7)
    const c = `black@${alpha.toFixed(3)}`
    const y0 = Math.round(h - edgeH + edgeH * t0)
    const y1 = Math.round(h - edgeH + edgeH * t1)
    const x0 = Math.round(w - edgeW + edgeW * t0)
    const x1 = Math.round(w - edgeW + edgeW * t1)
    const bandH = Math.max(1, y1 - y0)
    const bandW = Math.max(1, x1 - x0)
    if (o.bottom) boxes.push(`drawbox=x=0:y=${y0}:w=${w}:h=${bandH}:color=${c}:t=fill`)
    if (o.top) boxes.push(`drawbox=x=0:y=${edgeH - y1}:w=${w}:h=${bandH}:color=${c}:t=fill`)
    if (o.left) boxes.push(`drawbox=x=${edgeW - x1}:y=0:w=${bandW}:h=${h}:color=${c}:t=fill`)
    if (o.right) boxes.push(`drawbox=x=${x0}:y=0:w=${bandW}:h=${h}:color=${c}:t=fill`)
  }
  return boxes.length ? `${boxes.join(',')},` : ''
}

export interface RenderInputs {
  project: Project
  images: ProjectImage[]
  assPath: string
  outPath: string
  settings: AppSettings
  caps?: RenderCapabilities
  /** render_jobs row id — lets cancel/delete find & kill the running ffmpeg child */
  jobId?: string
  /** beta auto-B-roll: a pre-assembled full-length video bed used instead of stills */
  videoBedPath?: string
  /** beta auto-B-roll v2: concat-demuxer manifest of normalized segments */
  brollManifestPath?: string
  /** beta auto-B-roll segments composed directly in the final graph (single-pass path) */
  brollSegments?: BrollSegment[]
  /** beta style: fallback xfade transition type between image segments (default 'fade') */
  transition?: string
  /** beta: validated effect plan — places per-boundary transitions + drives SFX */
  plan?: EffectPlan
  /** beta: low-gain WAV of transition SFX to mix under the voice track */
  sfxPath?: string
  /** optional per-job render log for args/fallback diagnostics */
  logPath?: string
}

/** The transition type/duration to use at a segment boundary: the nearest planned
 *  transition within tolerance, else the style/default fallback. */
function transitionAt(plan: EffectPlan | undefined, timeSec: number, fallbackType: string, fallbackDur: number): { type: string; dur: number } {
  let best: { type: string; dur: number } | null = null
  let bestDist = 1.6 // seconds tolerance for snapping a plan transition to a cut
  for (const t of plan?.transitions ?? []) {
    const d = Math.abs(t.atSec - timeSec)
    if (d < bestDist) { bestDist = d; best = { type: t.type, dur: t.durationSec } }
  }
  return best ?? { type: fallbackType, dur: fallbackDur }
}

/** Append an SFX-mix audio chain to a filtergraph; returns the [label] to map for audio. */
function audioWithSfx(parts: string[], mp3Idx: number, sfxIdx: number | null): string {
  if (sfxIdx == null) {
    return `${mp3Idx}:a`
  }
  parts.push(`[${mp3Idx}:a][${sfxIdx}:a]amix=inputs=2:normalize=0:duration=first[aout]`)
  return '[aout]'
}

/** Build the full ffmpeg argument list for a render (pure — unit-asserted). */
export function buildRenderArgs(inp: RenderInputs): string[] {
  const { project, images, assPath, outPath, settings } = inp
  const caps = inp.caps ?? FALLBACK_CAPS
  const { w, h } = dimensions(settings.quality, project.captionAspect)
  const cf = typeof project.crossfade === 'number' ? project.crossfade : 0
  // Beta options only apply when beta mode is on; otherwise the graph is unchanged.
  const beta = settings.beta?.enabled ? asBetaOpts(project.betaOpts) : null
  const imgs: ProjectImage[] =
    images.length > 0
      ? images
      : [{ id: 'x', projectId: project.id, ord: 0, path: '', thumb: '', rangeStart: 0, rangeEnd: project.durationSec, manual: false }]

  // Beta auto-B-roll v2 path: normalized segment files are listed in a concat
  // demuxer manifest and enter the final graph as one continuous video input.
  if (inp.brollManifestPath) {
    const useCudaFinal = canUseCudaFinalFilters(settings, caps)
    const inputs = [
      ...(useCudaFinal ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : []),
      '-f', 'concat', '-safe', '0', '-i', inp.brollManifestPath,
      '-i', project.mp3Path
    ]
    const sfxIdx = inp.sfxPath ? 2 : null
    if (inp.sfxPath) inputs.push('-i', inp.sfxPath)

    const parts: string[] = []
    const grad = beta ? overlayGradient(beta.overlay, w, h) : ''
    const grade = gradeChain(beta?.style)
    const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
    const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
    const videoChain = useCudaFinal
      ? `[0:v]scale_cuda=w=${w}:h=${h}:force_original_aspect_ratio=increase,hwdownload,format=nv12,crop=${w}:${h},setsar=1,fps=${FPS},${grade}${grad}subtitles='${assForFilter(assPath)}'${punch},format=nv12,hwupload_cuda[v]`
      : `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},${grade}${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`
    parts.push(videoChain)
    const aMap = audioWithSfx(parts, 1, sfxIdx)
    const crf = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'

    return [
      '-y',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[v]',
      '-map', aMap,
      ...codecArgsForFilterOutput(settings, crf, caps, useCudaFinal),
      '-r', String(FPS),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
      outPath
    ]
  }

  // Beta auto-B-roll single-pass path: planned stock clips become direct video inputs
  // in the final graph, so the job avoids a pre-encoded full-length bed.
  if (inp.brollSegments?.length) {
    const segments = inp.brollSegments
    const inputs: string[] = []
    const parts: string[] = []
    segments.forEach((s, i) => {
      const dur = Math.max(0.5, s.end - s.start)
      const extra = inp.transition && i < segments.length - 1 ? 0.3 : 0
      inputs.push('-stream_loop', '-1', '-ss', s.srcStart.toFixed(2), '-t', (dur + extra).toFixed(2), '-i', s.path)
      parts.push(`[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS}[bv${i}]`)
    })
    inputs.push('-i', project.mp3Path)
    const audioIdx = segments.length
    const sfxIdx = inp.sfxPath ? segments.length + 1 : null
    if (inp.sfxPath) inputs.push('-i', inp.sfxPath)

    let last = 'bv0'
    if (segments.length > 1) {
      if (inp.transition) {
        let offset = segments[0].end - segments[0].start
        for (let i = 1; i < segments.length; i++) {
          const out = `bx${i}`
          parts.push(`[${last}][bv${i}]xfade=transition=${inp.transition}:duration=0.30:offset=${offset.toFixed(2)}[${out}]`)
          offset += segments[i].end - segments[i].start
          last = out
        }
      } else {
        parts.push(`${segments.map((_, i) => `[bv${i}]`).join('')}concat=n=${segments.length}:v=1:a=0[bv]`)
        last = 'bv'
      }
    }

    const grad = beta ? overlayGradient(beta.overlay, w, h) : ''
    const grade = gradeChain(beta?.style)
    const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
    const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
    parts.push(`[${last}]${grade}${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`)
    const aMap = audioWithSfx(parts, audioIdx, sfxIdx)
    const crf = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'

    return [
      '-y',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[v]',
      '-map', aMap,
      ...videoCodecArgs(settings, crf, caps),
      '-r', String(FPS),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
      outPath
    ]
  }

  // Beta auto-B-roll fallback: a single full-length video bed replaces the still-image track.
  if (inp.videoBedPath) {
    const grad = beta ? overlayGradient(beta.overlay, w, h) : ''
    const grade = gradeChain(beta?.style)
    const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
    const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
    const crfBed = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'
    const bedParts = [`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},${grade}${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`]
    const sfxIdx = inp.sfxPath ? 2 : null
    const aMap = audioWithSfx(bedParts, 1, sfxIdx)
    return [
      '-y',
      '-i', inp.videoBedPath,
      '-i', project.mp3Path,
      ...(inp.sfxPath ? ['-i', inp.sfxPath] : []),
      '-filter_complex', bedParts.join(';'),
      '-map', '[v]', '-map', aMap,
      ...videoCodecArgs(settings, crfBed, caps), '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k',
      '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
      outPath
    ]
  }

  const inputs: string[] = []
  imgs.forEach((im) => {
    const dur = Math.max(0.5, im.rangeEnd - im.rangeStart) + cf
    if (im.path) {
      inputs.push('-loop', '1', '-t', dur.toFixed(2), '-i', im.path)
    } else {
      // No image (hands-free auto-watch staged a render before images were added):
      // fall back to a solid background so the render still produces valid video.
      inputs.push('-f', 'lavfi', '-t', dur.toFixed(2), '-i', `color=c=0x111316:s=${w}x${h}:r=${FPS}`)
    }
  })
  inputs.push('-i', project.mp3Path)
  const audioIdx = imgs.length
  // Beta SFX track (if any) is the next input; mixed under the voice at low gain.
  const sfxIdx = inp.sfxPath ? imgs.length + 1 : null
  if (inp.sfxPath) inputs.push('-i', inp.sfxPath)

  const parts: string[] = []
  imgs.forEach((im, i) => {
    const frames = Math.round((Math.max(0.5, im.rangeEnd - im.rangeStart) + cf) * FPS)
    const base = `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`
    // Ken Burns zooms every segment; beta "auto-zoom at start" adds the same ramp to
    // just the first segment when Ken Burns is off.
    const zoom = project.kenBurns || (beta?.autoZoom.atStart && i === 0)
    const motion = zoom
      ? `,zoompan=z='min(zoom+0.0009,1.15)':d=${frames}:s=${w}x${h}:fps=${FPS}`
      : `,fps=${FPS}`
    parts.push(`${base}${motion}[v${i}]`)
  })

  // Beta: each segment boundary uses the planned transition nearest that cut (per-
  // boundary placement), falling back to the style transition, then 'fade'.
  const fallbackType = (beta && inp.transition) ? inp.transition : 'fade'
  let last = 'v0'
  if (imgs.length > 1) {
    let offset = Math.max(0.5, imgs[0].rangeEnd - imgs[0].rangeStart)
    for (let i = 1; i < imgs.length; i++) {
      const out = `x${i}`
      const tr = beta ? transitionAt(inp.plan, offset, fallbackType, cf || 0.4) : { type: fallbackType, dur: cf || 0.4 }
      parts.push(`[${last}][v${i}]xfade=transition=${tr.type}:duration=${tr.dur.toFixed(2)}:offset=${offset.toFixed(2)}[${out}]`)
      offset += Math.max(0.5, imgs[i].rangeEnd - imgs[i].rangeStart)
      last = out
    }
  }

  // Beta darkening gradient goes under the captions (applied before the subtitles burn).
  const grad = beta ? overlayGradient(beta.overlay, w, h) : ''
  const grade = gradeChain(beta?.style)
  // Burn captions; punch-zoom adds a subtle pulse when enabled (project flag or beta key-phrases).
  const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
  const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
  parts.push(`[${last}]${grade}${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`)
  const aMap = audioWithSfx(parts, audioIdx, sfxIdx)

  const crf = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'
  return [
    '-y',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[v]',
    '-map', aMap,
    ...videoCodecArgs(settings, crf, caps),
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    // Clamp the output to the authoritative audio length. Short side inputs are
    // padded/mixed in the graph; using -shortest here can truncate long MP3 renders.
    '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
    outPath
  ]
}

export interface RenderResult {
  outputPath: string
}

export async function runRender(inp: RenderInputs, onProgress?: (p: FfmpegProgress) => void): Promise<RenderResult> {
  mkdirSync(dirname(inp.outPath), { recursive: true })

  // Dry-run seam: no ffmpeg in the sandbox → write a stub mp4 so the runner / DB /
  // naming / ASS file are all exercised for real; the real encode runs on the user's box.
  if (process.env['ME_RENDER_FIXTURE']) {
    writeFileSync(inp.outPath, Buffer.from('\x00\x00\x00\x18ftypmp42stub-render'))
    onProgress?.({ outTimeSec: inp.project.durationSec, pct: 100, speed: 1, etaSec: 0, etaState: 'stable' })
    return { outputPath: inp.outPath }
  }

  try {
    const args = buildRenderArgs(inp)
    if (inp.logPath) appendFileSync(inp.logPath, `\n[ffmpeg]\n${args.join(' ')}\n`)
    await spawnFfmpeg(args, inp.project.durationSec, onProgress, inp.jobId)
  } catch (e) {
    if (hasCancelIntent(inp.jobId)) throw e
    if ((inp.settings.encoder ?? 'cpu') === 'cpu') throw e
    const fallbackSettings = { ...inp.settings, encoder: 'cpu' as const }
    const args = buildRenderArgs({ ...inp, settings: fallbackSettings, caps: FALLBACK_CAPS })
    if (inp.logPath) appendFileSync(inp.logPath, `\n[ffmpeg:fallback-cpu]\n${args.join(' ')}\n`)
    await spawnFfmpeg(args, inp.project.durationSec, onProgress, inp.jobId)
  }
  if (inp.logPath) appendFileSync(inp.logPath, '\n[audio-master]\ntwo-pass loudnorm I=-14 TP=-1 LRA=11\n')
  try {
    await masterAudioTwoPass(inp.outPath)
  } catch (e) {
    const msg = (e as Error).message
    if (inp.logPath) appendFileSync(inp.logPath, `[audio-master:warn] ${msg}\n`)
    logger.scope('render').warn(`audio-master failed; keeping rendered MP4: ${msg}`)
  }
  return { outputPath: inp.outPath }
}

function spawnFfmpeg(args: string[], durationSec: number, onProgress?: (p: FfmpegProgress) => void, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true })
    const smooth = createProgressSmoother(durationSec)
    if (jobId) running.set(jobId, child)
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      const p = parseFfmpegProgressBlock(d.toString(), durationSec)
      if (p) onProgress?.(smooth(p))
    })
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', (e) => {
      if (jobId) running.delete(jobId)
      reject(e)
    })
    child.on('close', (code) => {
      if (jobId) running.delete(jobId)
      if (code === 0) {
        onProgress?.({ outTimeSec: durationSec, pct: 100, speed: 1, etaSec: 0, etaState: 'stable' })
        resolve()
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
      }
    })
  })
}
