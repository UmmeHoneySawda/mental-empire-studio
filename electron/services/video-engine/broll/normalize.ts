import { spawn, spawnSync } from 'node:child_process'
import { rename, rm, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ffmpegPath, ffprobePath } from '../../bin'

/* Make a cached b-roll clip decodable by Remotion's frame extractor.
 *
 * Chromium (which Remotion uses to seek and decode media inside a per-frame
 * budget) times out on high-frame-rate source clips even though the files are
 * perfectly valid. Measured on this library: every clip above 30 fps failed to
 * yield timeline frame 5 within 40s, while the identical clip resampled to
 * 30 fps rendered in 4s.
 *
 *   59.94 fps @ 26 Mbps  -> FAILED  @ frame 5   -> resampled to 30 fps: OK 4s
 *   50    fps (VFR)      -> FAILED  @ frame 6   -> resampled to 30 fps: OK 4s
 *   50    fps @ 5.7 Mbps -> FAILED  @ frame 6   -> resampled to 30 fps: OK 4s
 *   60    fps @ 13 Mbps  -> FAILED  @ frame 5   -> resampled to 30 fps: OK 4s
 *
 * Two controlled variants isolated frame rate as the cause rather than
 * keyframe spacing or bitrate:
 *
 *   fps kept at 59.94, GOP forced to 30  -> still FAILED (so not GOP length)
 *   fps resampled to 30, GOP left at 250 -> OK in 4s     (so it is the fps)
 *
 * Bitrate only modulates severity: one 59.94 fps clip at 3.1 Mbps did decode,
 * so a bitrate threshold cannot separate good from bad. Frame rate can, and
 * clips at or below the timeline rate have never failed here.
 *
 * This runs unconditionally on files above the ceiling instead of behind an
 * ffprobe "is it corrupt" gate: the failing clips are ordinary H.264 High /
 * yuv420p / 1080p progressive and are indistinguishable from healthy clips on
 * any metadata a gate could read. ffmpeg itself decodes them in ~2s with zero
 * errors, so a probe-based gate would pass them and the render would still
 * hang.
 */

/** Timeline rate every project renders at; also the resample target. */
export const BROLL_TARGET_FPS = 30

/** Clips at or below this rate decode fine and are left byte-identical. */
const FPS_CEILING = BROLL_TARGET_FPS + 0.5

export interface BrollNormalizeResult {
  /** True when the file was re-encoded; false when it was already acceptable. */
  normalized: boolean
  /**
   * Final path on disk. Equal to the input path except when the source
   * container cannot hold H.264 (`.webm`), where the output becomes `.mp4` so
   * the extension keeps matching the bytes — asset mimeType is derived from it.
   */
  path: string
  /** Source frame rate, when ffprobe could read one. */
  sourceFps?: number
  reason?: 'fps-above-timeline' | 'variable-frame-rate' | 'probe-failed'
}

/** Containers that can carry the H.264/AAC output below. */
const H264_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.mkv'])

function parseRate(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '0/0' || trimmed === 'N/A') return undefined
  const [numerator, denominator] = trimmed.split('/')
  const top = Number(numerator)
  const bottom = denominator === undefined ? 1 : Number(denominator)
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return undefined
  const value = top / bottom
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export interface ProbedRates {
  avgFps?: number
  rFps?: number
  /** False when ffprobe could not report any usable frame rate. */
  ok: boolean
}

/** Exported for tests: parse an ffprobe rational such as `60000/1001`. */
export const parseFrameRate = parseRate

function probeRates(path: string): ProbedRates {
  try {
    const probe = spawnSync(
      ffprobePath(),
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=avg_frame_rate,r_frame_rate',
        '-of', 'csv=p=0',
        path
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 20_000 }
    )
    if (probe.status !== 0 || !probe.stdout) return { ok: false }
    const [avg, real] = probe.stdout.trim().split(',')
    const avgFps = parseRate(avg)
    const rFps = parseRate(real)
    if (avgFps === undefined && rFps === undefined) return { ok: false }
    return { avgFps, rFps, ok: true }
  } catch {
    return { ok: false }
  }
}

/** Pure decision: given probed rates, say whether the clip needs resampling. */
export function normalizationReasonForRates(rates: ProbedRates): BrollNormalizeResult['reason'] | undefined {
  // An unreadable frame rate is treated as needing work: the clip is already
  // odd enough that guessing "fine" risks a 40s render stall for one asset.
  if (!rates.ok) return 'probe-failed'
  const effective = Math.max(rates.avgFps ?? 0, rates.rFps ?? 0)
  if (effective > FPS_CEILING) return 'fps-above-timeline'
  // Container-level VFR: r_frame_rate diverging from avg_frame_rate means
  // non-uniform frame durations, which stalls the extractor the same way.
  if (rates.avgFps && rates.rFps && Math.abs(rates.rFps - rates.avgFps) > 0.5) {
    return 'variable-frame-rate'
  }
  return undefined
}

/** Decide whether the clip at `path` needs resampling, and why. */
export function normalizationReasonFor(path: string): BrollNormalizeResult['reason'] | undefined {
  return normalizationReasonForRates(probeRates(path))
}

function encodeArgs(source: string, destination: string): string[] {
  return [
    '-v', 'error',
    '-y',
    '-i', source,
    // CFR resample is the whole fix; the rest just keeps the output in the
    // conservative shape Chromium is happiest decoding.
    '-vf', `fps=${BROLL_TARGET_FPS},setsar=1`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'high',
    '-level', '4.1',
    '-g', String(BROLL_TARGET_FPS),
    '-keyint_min', String(BROLL_TARGET_FPS),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    destination
  ]
}

function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { windowsHide: true })
    let stderr = ''
    const abort = (): void => {
      child.kill()
      reject(new Error('B-roll normalization aborted'))
    }
    if (signal) {
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000)
    })
    child.once('error', (error) => {
      signal?.removeEventListener('abort', abort)
      reject(error)
    })
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code ?? -1}: ${stderr.trim().slice(-400)}`))
    })
  })
}

/**
 * Resample `path` in place when its frame rate would stall Remotion's frame
 * extractor. Returns what happened so callers can log and adjust byte counts.
 *
 * Failure to re-encode is not fatal: the original file is left untouched and
 * `normalized: false` comes back. A clip that renders slowly is strictly better
 * than an ingest that throws away a working download.
 */
export async function normalizeBrollForRemotion(
  path: string,
  options: { signal?: AbortSignal } = {}
): Promise<BrollNormalizeResult> {
  const rates = probeRates(path)
  const reason = normalizationReasonForRates(rates)
  const sourceFps = Math.max(rates.avgFps ?? 0, rates.rFps ?? 0) || undefined
  if (!reason) return { normalized: false, path, sourceFps }

  const sourceExtension = extname(path).toLowerCase()
  // `.webm` cannot hold H.264, so the re-encode lands as a sibling `.mp4` and
  // the original is removed. Anything H.264-capable is replaced in place, which
  // keeps the sha256-derived filename and every existing consumer untouched.
  const keepsContainer = H264_CONTAINERS.has(sourceExtension)
  const finalPath = keepsContainer ? path : `${path.slice(0, path.length - sourceExtension.length)}.mp4`
  const temporary = join(dirname(path), `.${randomUUID()}.normalize${keepsContainer ? sourceExtension : '.mp4'}`)
  try {
    await runFfmpeg(encodeArgs(path, temporary), options.signal)
    const produced = await stat(temporary)
    if (produced.size <= 0) throw new Error('normalized output was empty')
    await rename(temporary, finalPath)
    if (finalPath !== path) await rm(path, { force: true }).catch(() => undefined)
    return { normalized: true, path: finalPath, sourceFps, reason }
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined)
    return { normalized: false, path, sourceFps, reason }
  }
}
