import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, Project, ProjectImage } from '../../shared/types'
import { asBetaOpts } from '../../shared/types'
import type { EffectPlan } from '../../shared/effectPlan'
import { resolveBinDir } from './ytdlp'
import { resolutionFor, type CaptionAspect } from './captions'

// ffmpeg render: image(s) over the mp3 with Ken Burns + crossfades, burned ASS
// captions, optional punch-zoom, encoded H.264 at the chosen quality. The graph is
// built purely (buildRenderArgs) so it's assertable; ME_RENDER_FIXTURE swaps the
// real encode for a stub so the runner is testable without ffmpeg.

const FPS = 30

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
 *  approximated by 3 stacked drawboxes (smooth enough, pure-filter, no extra inputs).
 *  Returns a filter fragment ending in a comma, or '' when no edge is enabled. */
function overlayGradient(o: { bottom: boolean; top: boolean; left: boolean; right: boolean }, w: number, h: number): string {
  const steps = [
    { frac: 0.34, a: 0.22 },
    { frac: 0.22, a: 0.34 },
    { frac: 0.11, a: 0.5 }
  ]
  const boxes: string[] = []
  for (const s of steps) {
    const bh = Math.round(h * s.frac)
    const bw = Math.round(w * s.frac)
    const c = `black@${s.a}`
    if (o.bottom) boxes.push(`drawbox=x=0:y=${h - bh}:w=${w}:h=${bh}:color=${c}:t=fill`)
    if (o.top) boxes.push(`drawbox=x=0:y=0:w=${w}:h=${bh}:color=${c}:t=fill`)
    if (o.left) boxes.push(`drawbox=x=0:y=0:w=${bw}:h=${h}:color=${c}:t=fill`)
    if (o.right) boxes.push(`drawbox=x=${w - bw}:y=0:w=${bw}:h=${h}:color=${c}:t=fill`)
  }
  return boxes.length ? `${boxes.join(',')},` : ''
}

export interface RenderInputs {
  project: Project
  images: ProjectImage[]
  assPath: string
  outPath: string
  settings: AppSettings
  /** beta auto-B-roll: a pre-assembled full-length video bed used instead of stills */
  videoBedPath?: string
  /** beta style: fallback xfade transition type between image segments (default 'fade') */
  transition?: string
  /** beta: validated effect plan — places per-boundary transitions + drives SFX */
  plan?: EffectPlan
  /** beta: low-gain WAV of transition SFX to mix under the voice track */
  sfxPath?: string
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
  if (sfxIdx == null) return `${mp3Idx}:a`
  parts.push(`[${mp3Idx}:a][${sfxIdx}:a]amix=inputs=2:normalize=0:duration=first[aout]`)
  return '[aout]'
}

/** Build the full ffmpeg argument list for a render (pure — unit-asserted). */
export function buildRenderArgs(inp: RenderInputs): string[] {
  const { project, images, assPath, outPath, settings } = inp
  const { w, h } = dimensions(settings.quality, project.captionAspect)
  const cf = project.crossfade ? 0.6 : 0
  // Beta options only apply when beta mode is on; otherwise the graph is unchanged.
  const beta = settings.beta?.enabled ? asBetaOpts(project.betaOpts) : null
  const imgs: ProjectImage[] =
    images.length > 0
      ? images
      : [{ id: 'x', projectId: project.id, ord: 0, path: '', thumb: '', rangeStart: 0, rangeEnd: project.durationSec, manual: false }]

  // Beta auto-B-roll: a single full-length video bed replaces the still-image track.
  if (inp.videoBedPath) {
    const grad = beta ? overlayGradient(beta.overlay, w, h) : ''
    const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
    const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
    const crfBed = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'
    const bedParts = [`[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`]
    const sfxIdx = inp.sfxPath ? 2 : null
    const aMap = audioWithSfx(bedParts, 1, sfxIdx)
    return [
      '-y',
      '-i', inp.videoBedPath,
      '-i', project.mp3Path,
      ...(inp.sfxPath ? ['-i', inp.sfxPath] : []),
      '-filter_complex', bedParts.join(';'),
      '-map', '[v]', '-map', aMap,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', crfBed, '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-c:a', 'aac', '-b:a', '192k',
      '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
      '-shortest', outPath
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
  // Burn captions; punch-zoom adds a subtle pulse when enabled (project flag or beta key-phrases).
  const punchOn = project.punchZoom || !!beta?.autoZoom.atKeyPhrases
  const punch = punchOn ? `,zoompan=z='min(zoom+0.0015,1.08)':d=1:s=${w}x${h}:fps=${FPS}` : ''
  parts.push(`[${last}]${grad}subtitles='${assForFilter(assPath)}'${punch}[v]`)
  const aMap = audioWithSfx(parts, audioIdx, sfxIdx)

  const crf = settings.quality === '1440p' ? '20' : settings.quality === '720p' ? '23' : '21'
  return [
    '-y',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[v]',
    '-map', aMap,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    // Clamp the output to the audio length: Ken Burns zoompan + xfade overlaps make
    // the filtered video slightly longer than the mp3, and -shortest doesn't reliably
    // trim it, so pin the duration to the audio explicitly.
    '-t', project.durationSec > 0 ? project.durationSec.toFixed(2) : '1',
    '-shortest',
    outPath
  ]
}

export interface RenderResult {
  outputPath: string
}

export async function runRender(inp: RenderInputs, onProgress?: (pct: number) => void): Promise<RenderResult> {
  mkdirSync(dirname(inp.outPath), { recursive: true })

  // Dry-run seam: no ffmpeg in the sandbox → write a stub mp4 so the runner / DB /
  // naming / ASS file are all exercised for real; the real encode runs on the user's box.
  if (process.env['ME_RENDER_FIXTURE']) {
    writeFileSync(inp.outPath, Buffer.from('\x00\x00\x00\x18ftypmp42stub-render'))
    onProgress?.(100)
    return { outputPath: inp.outPath }
  }

  await spawnFfmpeg(buildRenderArgs(inp), inp.project.durationSec, onProgress)
  return { outputPath: inp.outPath }
}

function spawnFfmpeg(args: string[], durationSec: number, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true })
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      // ffmpeg -progress reports out_time_us (microseconds, despite the legacy _ms alias).
      const m = d.toString().match(/out_time_us=(\d+)/) ?? d.toString().match(/out_time_ms=(\d+)/)
      if (m && durationSec > 0) {
        const seconds = parseInt(m[1], 10) / 1_000_000
        onProgress?.(Math.max(0, Math.min(99, Math.round((seconds / durationSec) * 100))))
      }
    })
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        onProgress?.(100)
        resolve()
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${err.slice(-300)}`))
      }
    })
  })
}
