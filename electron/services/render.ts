import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AppSettings, Project, ProjectImage, RenderCapabilities } from '../../shared/types'
import { asBetaOpts } from '../../shared/types'
import type { EffectPlan } from '../../shared/effectPlan'
import { resolutionFor, type CaptionAspect } from './captions'
import { FALLBACK_CAPS, selectEncoder } from './engine/encoder'
import { FPS, LONG_FORM_FAST_SEC, crfFor } from './engine/render-config'
import { createProgressSmoother, parseFfmpegProgressBlock, type FfmpegProgress } from './engine/progress'
import { gradeChain } from './engine/grade'
import { masterAudioTwoPass } from './engine/audio-master'
import type { BrollSegment } from './broll'
import { logger } from './logger'
import { ffmpegPath, ffprobePath } from './bin'

// ffmpeg render: image(s) over the mp3 with Ken Burns + crossfades, burned ASS
// captions, optional punch-zoom, encoded H.264 at the chosen quality. The graph is
// built purely (buildRenderArgs) so it's assertable; ME_RENDER_FIXTURE swaps the
// real encode for a stub so the runner is testable without ffmpeg.

/** Video codec args for the chosen encoder. CPU = libx264 (CRF); NVIDIA = h264_nvenc
 *  (constant-quality VBR). Both target visually-equivalent quality at the given level. */
export function videoCodecArgs(settings: AppSettings, crf: string, caps: RenderCapabilities = FALLBACK_CAPS): string[] {
  return selectEncoder(settings, caps, crf).args
}

export function canUseCudaFinalFilters(settings: AppSettings, caps: RenderCapabilities = FALLBACK_CAPS): boolean {
  return settings.encoder === 'nvenc' && caps.hasNvenc && caps.ffmpegHasCuda
}

function longFormFastPath(project: Pick<Project, 'durationSec'>): boolean {
  return project.durationSec >= LONG_FORM_FAST_SEC
}

function punchZoomFilter(project: Project, beta: ReturnType<typeof asBetaOpts> | null, w: number, h: number, allowCpuMotion: boolean): string {
  const requested = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
  return requested && !longFormFastPath(project) && allowCpuMotion
    ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}`
    : ''
}

function stillMotionFilter(project: Project, beta: ReturnType<typeof asBetaOpts> | null, index: number, frames: number, w: number, h: number, allowCpuMotion: boolean): string {
  const requested = project.kenBurns || (beta?.autoZoom.atStart && index === 0)
  return requested && !longFormFastPath(project) && allowCpuMotion
    ? `,zoompan=z='min(zoom+0.0009,1.15)':d=${frames}:s=${w}x${h}:fps=${FPS}`
    : `,fps=${FPS}`
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

function shellQuoteArg(arg: string): string {
  return /\s|["]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function ffmpegCommandLine(args: string[]): string {
  return [ffmpegPath(), '-progress', 'pipe:1', '-nostats', ...args].map(shellQuoteArg).join(' ')
}

function probeOutputLine(outPath: string, expectedSec: number): string {
  const bytes = existsSync(outPath) ? statSync(outPath).size : 0
  const r = spawnSync(ffprobePath(), [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
    '-of', 'json',
    outPath
  ], { encoding: 'utf8' })
  if (r.status !== 0) return `[probe] output=${outPath} bytes=${bytes} expectedSec=${expectedSec.toFixed(2)} error=${(r.stderr || '').trim().slice(0, 240)}\n`
  try {
    const parsed = JSON.parse(r.stdout || '{}') as {
      format?: { duration?: string }
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
    }
    const durationSec = Number(parsed.format?.duration ?? 0)
    const video = parsed.streams?.find((s) => s.codec_type === 'video')
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio')
    const driftSec = Number.isFinite(durationSec) ? durationSec - expectedSec : 0
    return `[probe] output=${outPath} bytes=${bytes} expectedSec=${expectedSec.toFixed(2)} durationSec=${Number.isFinite(durationSec) ? durationSec.toFixed(2) : '0.00'} driftSec=${driftSec.toFixed(2)} video=${video?.codec_name ?? 'none'}:${video?.width ?? 0}x${video?.height ?? 0} audio=${audio?.codec_name ?? 'none'}\n`
  } catch (e) {
    return `[probe] output=${outPath} bytes=${bytes} expectedSec=${expectedSec.toFixed(2)} error=${(e as Error).message.slice(0, 240)}\n`
  }
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

/** Beta "background overlay": smooth alpha ramp cached as a tiny PAM image.
 *  Using a static overlay input avoids per-frame geq math while keeping the fade smooth.
 *  `intensity` (0–100) controls both the gradient extent and the max alpha:
 *  0 = disabled, 50 = default (moderate), 100 = heavy vignette. */
export function overlayGradientPath(o: { bottom: boolean; top: boolean; left: boolean; right: boolean; intensity?: number }, w: number, h: number): string | undefined {
  if (!o.bottom && !o.top && !o.left && !o.right) return undefined
  const intensity = Math.max(0, Math.min(100, o.intensity ?? 50))
  if (intensity === 0) return undefined
  // Map intensity 0–100 to extent ratio 0.12–0.60 and max alpha 0–200.
  const extentRatio = 0.12 + (intensity / 100) * 0.48
  const maxAlpha = Math.round((intensity / 100) * 200)
  const edgeH = Math.max(1, Math.round(h * extentRatio))
  const edgeW = Math.max(1, Math.round(w * extentRatio))
  const dir = join(tmpdir(), 'me-render-overlays')
  mkdirSync(dir, { recursive: true })
  const key = `${w}x${h}-${o.top ? 't' : ''}${o.right ? 'r' : ''}${o.bottom ? 'b' : ''}${o.left ? 'l' : ''}-i${intensity}` || 'none'
  const path = join(dir, `overlay-${key}.pam`)
  if (existsSync(path)) return path

  const header = Buffer.from(`P7\nWIDTH ${w}\nHEIGHT ${h}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`, 'ascii')
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ramps = [
        o.bottom ? Math.min(1, Math.max(0, (y - (h - edgeH)) / edgeH)) : 0,
        o.top ? Math.min(1, Math.max(0, (edgeH - y) / edgeH)) : 0,
        o.left ? Math.min(1, Math.max(0, (edgeW - x) / edgeW)) : 0,
        o.right ? Math.min(1, Math.max(0, (x - (w - edgeW)) / edgeW)) : 0
      ]
      const ramp = Math.max(...ramps)
      const alpha = Math.round(maxAlpha * Math.pow(ramp, 1.7))
      const i = (y * w + x) * 4
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = alpha
    }
  }
  writeFileSync(path, Buffer.concat([header, pixels]))
  return path
}

function pushFinishedVideo(
  parts: string[],
  source: string,
  filters: string[],
  opts: { overlayIdx?: number; assPath: string; punch: string; afterSubtitles?: string; prefix: string }
): void {
  const base = `${opts.prefix}base`
  const activeFilters = filters.filter(Boolean)
  parts.push(`${source}${activeFilters.length ? activeFilters.join(',') : 'null'}[${base}]`)
  let current = base
  if (opts.overlayIdx != null) {
    const over = `${opts.prefix}over`
    parts.push(`[${current}][${opts.overlayIdx}:v]overlay=0:0:format=auto[${over}]`)
    current = over
  }
  parts.push(`[${current}]subtitles='${assForFilter(opts.assPath)}'${opts.punch}${opts.afterSubtitles ?? ''}[v]`)
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
  /** skip the two-pass loudness master (used for fast throwaway previews) */
  skipAudioMaster?: boolean
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
  const longForm = longFormFastPath(project)
  const allowCpuMotion = (settings.encoder ?? 'cpu') === 'cpu'
  const effectiveCf = longForm ? 0 : cf
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
    const overlayPath = beta ? overlayGradientPath(beta.overlay, w, h) : undefined
    const hardwareFrameOutput = useCudaFinal && !overlayPath
    const inputs = [
      ...(useCudaFinal ? ['-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'] : []),
      '-f', 'concat', '-safe', '0', '-i', inp.brollManifestPath,
      '-i', project.mp3Path
    ]
    const sfxIdx = inp.sfxPath ? 2 : null
    if (inp.sfxPath) inputs.push('-i', inp.sfxPath)
    const overlayIdx = overlayPath ? (inp.sfxPath ? 3 : 2) : undefined
    if (overlayPath) inputs.push('-loop', '1', '-i', overlayPath)

    const parts: string[] = []
    const grade = gradeChain(beta?.style, project).replace(/,+$/, '')
    const punch = punchZoomFilter(project, beta, w, h, allowCpuMotion)
    pushFinishedVideo(parts, '[0:v]', useCudaFinal
      ? [`scale_cuda=w=${w}:h=${h}:force_original_aspect_ratio=increase`, 'hwdownload', 'format=nv12', `crop=${w}:${h}`, 'setsar=1', `fps=${FPS}`, grade]
      : [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, 'setsar=1', `fps=${FPS}`, grade], {
      overlayIdx,
      assPath,
      punch,
      afterSubtitles: hardwareFrameOutput ? ',format=nv12,hwupload_cuda' : '',
      prefix: 'bm'
    })
    const aMap = audioWithSfx(parts, 1, sfxIdx)
    const crf = crfFor(settings.quality)

    return [
      '-y',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[v]',
      '-map', aMap,
      ...codecArgsForFilterOutput(settings, crf, caps, hardwareFrameOutput),
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
    const overlayPath = beta ? overlayGradientPath(beta.overlay, w, h) : undefined
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
    const overlayIdx = overlayPath ? segments.length + 1 + (inp.sfxPath ? 1 : 0) : undefined
    if (overlayPath) inputs.push('-loop', '1', '-i', overlayPath)

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

    const grade = gradeChain(beta?.style, project).replace(/,+$/, '')
    const punch = punchZoomFilter(project, beta, w, h, allowCpuMotion)
    pushFinishedVideo(parts, `[${last}]`, [grade], { overlayIdx, assPath, punch, prefix: 'bd' })
    const aMap = audioWithSfx(parts, audioIdx, sfxIdx)
    const crf = crfFor(settings.quality)

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
    const overlayPath = beta ? overlayGradientPath(beta.overlay, w, h) : undefined
    const grade = gradeChain(beta?.style, project).replace(/,+$/, '')
    const punch = punchZoomFilter(project, beta, w, h, allowCpuMotion)
    const crfBed = crfFor(settings.quality)
    const bedParts: string[] = []
    const sfxIdx = inp.sfxPath ? 2 : null
    const overlayIdx = overlayPath ? (inp.sfxPath ? 3 : 2) : undefined
    pushFinishedVideo(bedParts, '[0:v]', [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, 'setsar=1', `fps=${FPS}`, grade], { overlayIdx, assPath, punch, prefix: 'bb' })
    const aMap = audioWithSfx(bedParts, 1, sfxIdx)
    return [
      '-y',
      '-i', inp.videoBedPath,
      '-i', project.mp3Path,
      ...(inp.sfxPath ? ['-i', inp.sfxPath] : []),
      ...(overlayPath ? ['-loop', '1', '-i', overlayPath] : []),
      '-filter_complex', bedParts.join(';'),
      '-map', '[v]', '-map', aMap,
      ...videoCodecArgs(settings, crfBed, caps), '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k',
      '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
      outPath
    ]
  }

  const overlayPath = beta ? overlayGradientPath(beta.overlay, w, h) : undefined
  const inputs: string[] = []
  imgs.forEach((im) => {
    const dur = Math.max(0.5, im.rangeEnd - im.rangeStart) + effectiveCf
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
  const overlayIdx = overlayPath ? imgs.length + 1 + (inp.sfxPath ? 1 : 0) : undefined
  if (overlayPath) inputs.push('-loop', '1', '-i', overlayPath)

  const parts: string[] = []
  imgs.forEach((im, i) => {
    const frames = Math.round((Math.max(0.5, im.rangeEnd - im.rangeStart) + effectiveCf) * FPS)
    // Still-image ffmpeg renders immediately run CPU-only filters later (grade,
    // overlay, libass subtitles). Uploading each still to CUDA just to download it
    // again before those CPU filters is slower on long slideshows; keep filters in
    // CPU memory and hand off once to the selected encoder at the end.
    const baseFilters = [`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}`, 'setsar=1']
    if (longForm) baseFilters.push(`fps=${FPS}`, 'format=yuv420p', 'setpts=PTS-STARTPTS')
    const base = `[${i}:v]${baseFilters.join(',')}`
    // Ken Burns is intentionally disabled on long-form jobs: with burned captions it
    // becomes a second full-video CPU filter pass and made image-only renders as slow
    // as B-roll on the user's 19-minute tests.
    const motion = stillMotionFilter(project, beta, i, frames, w, h, allowCpuMotion)
    parts.push(`${base}${motion}[v${i}]`)
  })

  // Beta: each segment boundary uses the planned transition nearest that cut (per-
  // boundary placement), falling back to the style transition, then 'fade'.
  const fallbackType = (beta && inp.transition) ? inp.transition : 'fade'
  let last = 'v0'
  if (imgs.length > 1) {
    if (longForm) {
      parts.push(`${imgs.map((_, i) => `[v${i}]`).join('')}concat=n=${imgs.length}:v=1:a=0[vcat]`)
      last = 'vcat'
    } else {
      let offset = Math.max(0.5, imgs[0].rangeEnd - imgs[0].rangeStart)
      for (let i = 1; i < imgs.length; i++) {
        const out = `x${i}`
        const tr = beta ? transitionAt(inp.plan, offset, fallbackType, cf || 0.4) : { type: fallbackType, dur: cf || 0.4 }
        parts.push(`[${last}][v${i}]xfade=transition=${tr.type}:duration=${tr.dur.toFixed(2)}:offset=${offset.toFixed(2)}[${out}]`)
        offset += Math.max(0.5, imgs[i].rangeEnd - imgs[i].rangeStart)
        last = out
      }
    }
  }

  // Beta darkening gradient goes under the captions (applied before the subtitles burn).
  const grade = gradeChain(beta?.style, project).replace(/,+$/, '')
  // Burn captions; punch-zoom adds a subtle pulse when enabled (project flag or beta key-phrases).
  const punch = punchZoomFilter(project, beta, w, h, allowCpuMotion)
  pushFinishedVideo(parts, `[${last}]`, [grade], { overlayIdx, assPath, punch, prefix: 'img' })
  const aMap = audioWithSfx(parts, audioIdx, sfxIdx)

  const crf = crfFor(settings.quality)
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
    if (inp.logPath) appendFileSync(inp.logPath, probeOutputLine(inp.outPath, inp.project.durationSec))
    onProgress?.({ outTimeSec: inp.project.durationSec, pct: 100, speed: 1, etaSec: 0, etaState: 'stable' })
    return { outputPath: inp.outPath }
  }

  try {
    const args = buildRenderArgs(inp)
    if (inp.logPath) {
      const enc = (inp.settings.encoder ?? 'cpu')
      const caps = inp.caps ?? FALLBACK_CAPS
      const gpuEncode = enc !== 'cpu'
      const cudaScale = args.some((arg) => arg.includes('scale_cuda') || arg.includes('hwupload_cuda') || arg.includes('hwdownload'))
      const motion = (inp.settings.encoder ?? 'cpu') === 'cpu'
      appendFileSync(inp.logPath, `\n[render] encoder=${enc} encode=${gpuEncode ? 'GPU' : 'CPU'} scale=${cudaScale ? 'GPU(cuda)' : 'CPU'} subtitles=CPU(libass) kenBurns/punch=${motion ? 'on' : 'off (disabled when a GPU encoder is selected, to keep filters light)'} quality=${inp.settings.quality} durationSec=${inp.project.durationSec.toFixed(2)}\n`)
      appendFileSync(inp.logPath, `\n[ffmpeg]\n${ffmpegCommandLine(args)}\n`)
    }
    await spawnFfmpeg(args, inp.project.durationSec, onProgress, inp.jobId)
  } catch (e) {
    if (hasCancelIntent(inp.jobId)) throw e
    if ((inp.settings.encoder ?? 'cpu') === 'cpu') throw e
    const gpuError = (e as Error).message
    if (inp.logPath) appendFileSync(inp.logPath, `\n[ffmpeg:gpu-failed] ${gpuError}\n`)
    logger.scope('render').warn(`GPU encode failed (${inp.settings.encoder}): ${gpuError}`)
    throw new Error(`GPU encode failed for ${inp.settings.encoder.toUpperCase()}; CPU fallback is disabled. Fix the GPU encoder/driver or choose CPU in Settings. ${gpuError}`)
  }
  if (inp.skipAudioMaster) {
    if (inp.logPath) appendFileSync(inp.logPath, probeOutputLine(inp.outPath, inp.project.durationSec))
    return { outputPath: inp.outPath }
  }
  if (inp.logPath) appendFileSync(inp.logPath, '\n[audio-master]\ntwo-pass loudnorm I=-14 TP=-1 LRA=11\n')
  try {
    await masterAudioTwoPass(inp.outPath)
  } catch (e) {
    const msg = (e as Error).message
    if (inp.logPath) appendFileSync(inp.logPath, `[audio-master:warn] ${msg}\n`)
    logger.scope('render').warn(`audio-master failed; keeping rendered MP4: ${msg}`)
  }
  if (inp.logPath) appendFileSync(inp.logPath, probeOutputLine(inp.outPath, inp.project.durationSec))
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
