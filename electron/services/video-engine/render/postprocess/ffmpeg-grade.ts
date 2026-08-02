import { copyFile, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
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

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback
}

function fixed(value: number): string {
  return Number(value.toFixed(4)).toString()
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
  if (exposure !== 0) chain.push(`exposure=exposure=${fixed(exposure)}`)
  if (contrast !== 1 || saturation !== 1) {
    chain.push(`eq=contrast=${fixed(contrast)}:saturation=${fixed(saturation)}`)
  }
  if (temperature !== 0 || tint !== 0) {
    const red = temperature * 0.16 + tint * 0.04
    const green = -tint * 0.12
    const blue = -temperature * 0.16 + tint * 0.04
    chain.push(`colorbalance=rm=${fixed(red)}:gm=${fixed(green)}:bm=${fixed(blue)}:pl=1`)
  }
  if (vignette > 0) chain.push(`vignette=angle=${fixed((Math.PI / 3) * vignette)}:eval=frame`)
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
