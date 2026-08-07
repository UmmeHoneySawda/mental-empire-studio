import { copyFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import type { VideoProject } from '../../../../../shared/video-engine'
import { ffmpegPath } from '../../../bin'
import { errorMessage, VideoEngineError } from '../../errors'
import { ensureParent } from '../../paths'

type GradeTelemetryAttributes = Record<string, string | number | boolean>

export interface GradeTelemetry {
  info(message: string, attributes?: GradeTelemetryAttributes): void
  error(message: string, attributes?: GradeTelemetryAttributes): void
  captureException(error: unknown): void
}

const NOOP_GRADE_TELEMETRY: GradeTelemetry = Object.freeze({
  info: () => undefined,
  error: () => undefined,
  captureException: () => undefined
})

/** Grading is a second full encode and must stay on NVIDIA NVENC. */
export const DEFAULT_GRADE_ENCODER_ARGS: readonly string[] = Object.freeze([
  '-c:v', 'h264_nvenc', '-preset', 'medium', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p'
])

export interface CinematicGrade {
  enabled?: boolean
  lutPath?: string
  lutIntensity?: number
  exposure?: number
  contrast?: number
  saturation?: number
  temperature?: number
  tint?: number
  vignette?: number
  grain?: number
}

/**
 * `colorbalance`'s midtones shift at the peak of its weight curve, in 8-bit code values: the
 * filter scales a midtones parameter by 0.7 where the curve is highest. Kept as the strength
 * of the temperature/tint offset so the look survives the move off that filter — see
 * `buildGradeFilter`.
 */
const TINT_PEAK_CODE_VALUES = 0.7 * 255

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback
}

function fixed(value: number): string {
  return Number(value.toFixed(4)).toString()
}

/** A leading sign, so an offset reads `val-2.092` rather than the valid but ugly `val+-2.092`. */
function signed(value: number): string {
  const text = fixed(value)
  return text.startsWith('-') ? text : `+${text}`
}

/** Escapes a path for FFmpeg filtergraph syntax. Arguments are passed without a shell. */
export function escapeFilterPath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'")
    .replaceAll(',', '\\,')
    .replaceAll(';', '\\;')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

/**
 * The project's renderer-neutral `grading` block as the ffmpeg filter chain understands it.
 *
 * Note the one non-identity mapping: the project stores `contrast` as an offset around 0
 * (schema range -1..1) while the filter wants a multiplier around 1.
 *
 * This lives beside `CinematicGrade` rather than in the render queue so the benchmark
 * (`scripts/bench-render.ts`) grades with exactly what production grades with. A benchmark
 * measuring a differently-derived grade would measure the wrong filter chain.
 */
export function gradeFromProject(project: VideoProject): CinematicGrade {
  const grading = project.grading
  const lut = grading.lutAssetId
    ? project.assets.find((asset) => asset.id === grading.lutAssetId)
    : undefined
  let lutPath: string | undefined
  if (lut) {
    try {
      const uri = new URL(lut.uri)
      if (uri.protocol === 'file:') lutPath = fileURLToPath(uri)
    } catch {
      lutPath = lut.uri
    }
  }
  return {
    enabled: grading.enabled,
    lutPath,
    lutIntensity: grading.lutIntensity,
    exposure: grading.exposure,
    contrast: 1 + grading.contrast,
    saturation: grading.saturation,
    temperature: grading.temperature,
    tint: grading.tint,
    vignette: grading.vignette,
    grain: grading.grain
  }
}

export function isIdentityGrade(grade: CinematicGrade | undefined): boolean {
  if (!grade || grade.enabled === false) return true
  return !grade.lutPath
    && finite(grade.exposure, 0) === 0
    && finite(grade.contrast, 1) === 1
    && finite(grade.saturation, 1) === 1
    && finite(grade.temperature, 0) === 0
    && finite(grade.tint, 0) === 0
    && finite(grade.vignette, 0) === 0
    && finite(grade.grain, 0) === 0
}

export async function buildGradeFilter(grade: CinematicGrade): Promise<string> {
  const chain: string[] = []
  const exposure = Math.min(3, Math.max(-3, finite(grade.exposure, 0)))
  const contrast = Math.min(2.5, Math.max(0.25, finite(grade.contrast, 1)))
  const saturation = Math.min(3, Math.max(0, finite(grade.saturation, 1)))
  const temperature = Math.min(1, Math.max(-1, finite(grade.temperature, 0)))
  const tint = Math.min(1, Math.max(-1, finite(grade.tint, 0)))
  const vignette = Math.min(1, Math.max(0, finite(grade.vignette, 0)))
  const grain = Math.min(1, Math.max(0, finite(grade.grain, 0)))

  if (grade.lutPath) {
    const lut = await stat(grade.lutPath).catch(() => null)
    if (!lut?.isFile()) {
      throw new VideoEngineError('FFMPEG_FAILED', `LUT file does not exist: ${grade.lutPath}`)
    }
    const intensity = Math.min(1, Math.max(0, finite(grade.lutIntensity, 1)))
    if (intensity === 1) {
      chain.push(`lut3d=file='${escapeFilterPath(grade.lutPath)}'`)
    } else if (intensity > 0) {
      // `blend` requires a two-input graph, so wrap the simple chain in a split/merge graph.
      chain.push(
        `split=2[lut_base][lut_input];[lut_input]lut3d=file='${escapeFilterPath(grade.lutPath)}'[lut_applied];`
        + `[lut_base][lut_applied]blend=all_expr='A*${fixed(1 - intensity)}+B*${fixed(intensity)}'`
      )
    }
  }
  // A `lutyuv`, not ffmpeg's `exposure` filter. `exposure` accepts only float RGB, so ffmpeg
  // auto-inserts swscale on both sides of it — yuv420p -> gbrpf32le (a 24.9 MB frame at 1080p)
  // -> yuv444p — and every filter after it then runs at 4:4:4. But `exposure=EV` is just a
  // multiply of the RGB code values by 2^EV, and scaling R, G and B by the same factor scales
  // limited-range Y and the chroma deviation from 128 by that same factor. So a 256-entry LUT,
  // built once at init and applied in native yuv420p, computes it without leaving the format
  // the master is already in.
  //
  // Measured on 6s of 1080p30 as a paired, same-session, back-to-back A/B, with `colorbalance`
  // left out of the chain (it is RGB-only, so it forces a conversion either way and swamps the
  // difference): 5.67/5.93/5.81s -> 2.06/2.07/2.20s, -64% wall clock, -75% net of decode.
  // Against a luma ramp the LUT tracks the `exposure` filter to a mean absolute error of 0.16
  // and a max of 1 code value.
  //
  // Output is NOT byte-identical and cannot be: `exposure` clips per channel in RGB, which
  // desaturates a blown highlight, while a per-component YUV LUT clamps Y and chroma
  // independently. On synthetic 100%-saturated bars that is ~39 dB PSNR; at the |EV| <= 0.07 the
  // studio presets use it only reaches pixels already at the top of the range.
  //
  // The 16/235/240 constants assume limited-range input. That is what the render master is —
  // untagged yuv420p out of h264_nvenc — and what swscale already assumed when feeding
  // `exposure`. A full-range master would need the pivots widened to 0/255.
  if (exposure !== 0) {
    const gain = fixed(Math.pow(2, exposure))
    chain.push(
      `lutyuv=y='clip(16+(val-16)*${gain},16,235)'`
      + `:u='clip(128+(val-128)*${gain},16,240)'`
      + `:v='clip(128+(val-128)*${gain},16,240)'`
    )
  }
  if (contrast !== 1 || saturation !== 1) {
    chain.push(`eq=contrast=${fixed(contrast)}:saturation=${fixed(saturation)}`)
  }
  // A `lutyuv` chroma offset, not `colorbalance`. `colorbalance` accepts only RGB, so ffmpeg
  // wraps it in swscale — yuv420p -> rgb24 -> yuv420p — and every filter between those two
  // conversions runs in rgb24 as well, which in this chain means the vignette.
  //
  // Measured on the 3-minute benchmark fixture as a paired, same-session, back-to-back A/B
  // against one cached master (`npm run bench:render -- --grade-only`): the grade pass went
  // **501.9s -> 74.3s, -85.2%** (labels `colorbalance-before` / `colorbalance-after-rounded`;
  // an earlier run of the same chain shape measured 63.9s, so read the win as -85% and not as
  // three significant figures). On 6s of
  // 1080p30, filter plus NVENC encode, the same swap is 19.09s -> 2.86s; dropping only `pl=1`
  // reaches 11.38s, so the RGB round trip and the preserve-lightness pass cost about the same
  // as each other. Numbers are inlined because the result files live in the gitignored
  // scratchpad/ and do not survive a fresh clone.
  //
  // The replacement is the same rm/gm/bm mix, taken at `colorbalance`'s own midtone-peak
  // weight and pushed through the BT.601 limited-range matrix, so it lands as one offset on Y,
  // U and V in the format the master is already in. BT.601 because that is what swscale used
  // for this untagged master: at temperature=1 the old chain moved a neutral ramp by dU=-17,
  // dV=+15, which is 601's -16.8/+14.6 and not 709's -15.4/+13.7.
  //
  // Two deliberate appearance changes, both measured against the old chain:
  //
  //  - The push is now global. `colorbalance`'s midtones weight is not centred on mid grey: it
  //    is a bump over code values ~26..101 that peaks at 64 and is exactly zero above 101, so
  //    temperature and tint used to tint the darker quarter of the range and leave midtones
  //    and highlights untouched. A constant offset applies that peak strength everywhere. At
  //    the strongest studio preset (Warm film, temperature 0.2) the peak is dU=-3, dV=+3 out of
  //    255, and a whole-frame wash is what the editor already previews — see the soft-light
  //    layer in `gradePreview.ts`, which uses this same mix.
  //  - `pl=1` no longer flattens saturated colour. Preserve-lightness collapses saturated
  //    pixels towards neutral grey: at rm=0.032 the old chain returned SMPTE bars with the
  //    red, blue and magenta patches grey. An offset has no such failure mode.
  //
  // Placement matters. This has to stay after `eq`, because `eq=saturation` multiplies the
  // chroma deviation from 128, so folding the offset into the exposure LUT above would scale
  // it by an unrelated slider.
  //
  // The offsets are rounded here because `lutyuv` floors its expression into an 8-bit table:
  // measured on 20 frames, a -2.092 offset shifted U by a mean of exactly -3.00, and a +0.9311
  // offset shifted V by 0.00. Floor turns a half-code-value offset into a whole one in the
  // negative direction and drops it entirely in the positive, which on a 2-code-value tint is
  // most of the tint. Rounding first also makes the emitted filter say what it does, and it is
  // why a mix too small to survive 8-bit emits no stage at all rather than a no-op pass.
  if (temperature !== 0 || tint !== 0) {
    const red = (temperature * 0.16 + tint * 0.04) * TINT_PEAK_CODE_VALUES
    const green = (-tint * 0.12) * TINT_PEAK_CODE_VALUES
    const blue = (-temperature * 0.16 + tint * 0.04) * TINT_PEAK_CODE_VALUES
    const dy = Math.round(0.257 * red + 0.504 * green + 0.098 * blue)
    const du = Math.round(-0.148 * red - 0.291 * green + 0.439 * blue)
    const dv = Math.round(0.439 * red - 0.368 * green - 0.071 * blue)
    if (dy !== 0 || du !== 0 || dv !== 0) {
      chain.push(
        `lutyuv=y='clip(val${signed(dy)},16,235)'`
        + `:u='clip(val${signed(du)},16,240)'`
        + `:v='clip(val${signed(dv)},16,240)'`
      )
    }
  }
  // `eval=init`, not `eval=frame`. The angle is folded to a constant at build time on the line
  // below — `finite()` rejects any non-number, so it can never be an ffmpeg expression in
  // `n`/`t` — so there is nothing to re-evaluate. `eval=frame` made ffmpeg rebuild the
  // vignette's per-pixel 1920x1080 mask once per output frame to arrive at the same mask.
  //
  // Measured on the 3-minute benchmark fixture as a paired, same-session, back-to-back A/B
  // (`npm run bench:render`): the full grade pass went **802s -> 550s, -31.4%**, and the
  // filter chain alone (no encode) 858s -> 582s. Output is **byte-identical**, not merely
  // equivalent: `framemd5` matches across all 5400 frames in both modes, and both arms plus
  // this function's own output share sha256 d9243ee0b2923ef0131b9d3b580a6b93bd0f320327359c83d8033df043fb0c85.
  // Numbers are inlined here on purpose — the raw result files live in the gitignored
  // scratchpad/ and do not survive a fresh clone.
  //
  // If a future change makes the angle time-varying, `eval=frame` becomes correct again.
  //
  // `dither=0`, but only when grain follows. Dithering is the most expensive thing this filter
  // does, and after the `colorbalance` port left the chain native yuv420p the vignette became the
  // single largest cost in the grade pass. Measured on 30s of 1080p30, decode -> filter -> NVENC,
  // median of 3, on the exact chain this function emits:
  //
  //   whole grade pass:  11.94s -> 9.51s   (-20.3%)
  //   filter alone:       9.86s -> 7.10s
  //
  // For scale, the same measurement prices every other stage in this chain at roughly nothing:
  // decode+encode floor 4.65s, exposure LUT 4.46s, +eq 3.90s, +tint LUT 4.22s, then +vignette
  // 11.20s and +grain 12.45s. The vignette is ~57% of the pass. It is also not slice-threaded —
  // `-filter_threads 1` measures 9.84s against the default's 9.86s — so it occupies one core of
  // four while the rest idle, which is why it dominates despite being simple arithmetic.
  //
  // Dithering exists to hide quantization banding in the vignette's own gradient, so dropping it
  // is only safe when something else already decorrelates that error. Grain does. Measured as the
  // widest run of identical luma along the centre row of a flat mid-grey field — the worst case
  // for banding, sampled in the corner-ward third where the gradient is steepest:
  //
  //   vignette then grain (this order):  dither=1  6px   dither=0  5px
  //   no grain at all:                   dither=1 13px   dither=0 19px
  //
  // With grain the two are indistinguishable; without it the bands widen by half, so grain=0
  // projects keep dithering and pay for it. The two vignettes differ by 51.1 dB on that flat
  // field, where the grain this chain already applies perturbs the same frame by 45.3 dB — the
  // dither is well under the noise floor of the look it sits inside.
  //
  // Numbers are inlined because the result files live in the gitignored scratchpad/ and do not
  // survive a fresh clone.
  if (vignette > 0) {
    const dither = grain > 0 ? ':dither=0' : ''
    chain.push(`vignette=angle=${fixed((Math.PI / 3) * vignette)}:eval=init${dither}`)
  }
  if (grain > 0) chain.push(`noise=alls=${fixed(grain * 28)}:allf=t`)
  return chain.join(',')
}

export interface GradeProgress {
  progress: number
  outTimeMs: number
}

export async function applyCinematicGrade(options: {
  inputPath: string
  outputPath: string
  grade?: CinematicGrade
  durationMs?: number
  signal?: AbortSignal
  onProgress?: (progress: GradeProgress) => void
  ffmpegExecutable?: string
  /** Video codec args for the re-encode. See DEFAULT_GRADE_ENCODER_ARGS. */
  videoEncoderArgs?: readonly string[]
  telemetry?: GradeTelemetry
}): Promise<void> {
  await ensureParent(options.outputPath)
  if (isIdentityGrade(options.grade)) {
    await copyFile(options.inputPath, options.outputPath)
    options.onProgress?.({ progress: 1, outTimeMs: options.durationMs ?? 0 })
    return
  }
  const filter = await buildGradeFilter(options.grade!)
  const args = [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    '-i', options.inputPath,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-vf', filter,
    ...(options.videoEncoderArgs ?? DEFAULT_GRADE_ENCODER_ARGS),
    '-c:a', 'copy',
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    options.outputPath
  ]
  const startedAt = performance.now()
  const telemetry = options.telemetry ?? NOOP_GRADE_TELEMETRY
  telemetry.info('Video engine grading started', {
    has_lut: !!options.grade?.lutPath,
    operation: 'video_grade'
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(options.ffmpegExecutable ?? ffmpegPath(), args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: options.signal
      })
      let stderr = ''
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        const [key, value] = line.split('=', 2)
        if (key !== 'out_time_us' && key !== 'out_time_ms') return
        // Modern FFmpeg reports out_time_us. Older builds used a misleading out_time_ms key.
        const micros = Number(value)
        if (!Number.isFinite(micros)) return
        const outTimeMs = Math.max(0, micros / 1000)
        const progress = options.durationMs ? Math.min(0.99, outTimeMs / options.durationMs) : 0
        options.onProgress?.({ progress, outTimeMs })
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-4000)
      })
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        if (code === 0) {
          options.onProgress?.({ progress: 1, outTimeMs: options.durationMs ?? 0 })
          resolve()
          return
        }
        if (options.signal?.aborted) {
          reject(new VideoEngineError('RENDER_CANCELED', 'Video grading was canceled'))
          return
        }
        reject(new VideoEngineError(
          'FFMPEG_FAILED',
          `FFmpeg grading failed (${signal ?? code ?? 'unknown'}): ${stderr.slice(-800)}`
        ))
      })
    })
    telemetry.info('Video engine grading completed', {
      has_lut: !!options.grade?.lutPath,
      duration_ms: Math.round(performance.now() - startedAt),
      operation: 'video_grade'
    })
  } catch (error) {
    telemetry.error('Video engine grading failed', {
      has_lut: !!options.grade?.lutPath,
      duration_ms: Math.round(performance.now() - startedAt),
      error_message: errorMessage(error).slice(0, 200),
      operation: 'video_grade'
    })
    telemetry.captureException(error)
    throw error
  }
}
