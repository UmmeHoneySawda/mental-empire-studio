export interface FfmpegProgress {
  outTimeSec: number
  pct: number
  etaSec?: number
  etaState?: 'estimating' | 'stable'
  speed?: number
  fps?: number
  bitrate?: string
}

function parseTimeToSec(v: string): number {
  const m = v.trim().match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/)
  if (!m) return 0
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function parseFfmpegProgressBlock(block: string, durationSec: number): FfmpegProgress | null {
  const values = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    const idx = line.indexOf('=')
    if (idx > 0) values.set(line.slice(0, idx), line.slice(idx + 1))
  }

  const rawUs = values.get('out_time_us') ?? values.get('out_time_ms')
  const rawTime = values.get('out_time')
  const outTimeSec = rawUs
    ? Number.parseInt(rawUs, 10) / 1_000_000
    : rawTime
      ? parseTimeToSec(rawTime)
      : 0
  if (!Number.isFinite(outTimeSec) || outTimeSec <= 0) return null

  const rawSpeed = values.get('speed')?.replace(/x$/, '')
  const speed = rawSpeed ? Number.parseFloat(rawSpeed) : undefined
  const pct = durationSec > 0 ? Math.max(0, Math.min(99, Math.round((outTimeSec / durationSec) * 100))) : 0
  const etaSec = durationSec > 0 && speed && speed > 0
    ? Math.max(0, Math.round((durationSec - outTimeSec) / speed))
    : undefined

  return {
    outTimeSec,
    pct,
    etaSec,
    etaState: etaSec == null ? 'estimating' : 'stable',
    speed: speed && Number.isFinite(speed) ? speed : undefined,
    fps: values.get('fps') ? Number.parseFloat(values.get('fps') as string) : undefined,
    bitrate: values.get('bitrate')?.trim()
  }
}

export interface ProgressSmootherOptions {
  alpha?: number
  minSamples?: number
  minSpeed?: number
  etaClampFactor?: number
  etaClampMinSec?: number
}

/**
 * FFmpeg reports instantaneous `speed`, which can swing wildly during the first
 * few packets. Smooth it and hide ETA until it is based on enough samples.
 */
export function createProgressSmoother(durationSec: number, opts: ProgressSmootherOptions = {}): (p: FfmpegProgress) => FfmpegProgress {
  const alpha = opts.alpha ?? 0.2
  const minSamples = opts.minSamples ?? 3
  const minSpeed = opts.minSpeed ?? 0.05
  const etaClampFactor = opts.etaClampFactor ?? 2.5
  const etaClampMinSec = opts.etaClampMinSec ?? 300
  let emaSpeed: number | undefined
  let samples = 0

  return (p) => {
    const rawSpeed = p.speed && Number.isFinite(p.speed) && p.speed > 0 ? p.speed : undefined
    if (!rawSpeed || durationSec <= 0) {
      return { ...p, etaSec: undefined, etaState: 'estimating' }
    }

    emaSpeed = emaSpeed == null ? rawSpeed : (alpha * rawSpeed) + ((1 - alpha) * emaSpeed)
    samples += 1

    if (samples < minSamples || emaSpeed < minSpeed) {
      return { ...p, speed: emaSpeed, etaSec: undefined, etaState: 'estimating' }
    }

    const remaining = Math.max(0, durationSec - p.outTimeSec)
    const rawEta = Math.round(remaining / emaSpeed)
    const cap = Math.max(etaClampMinSec, Math.round(durationSec * etaClampFactor))
    return {
      ...p,
      speed: emaSpeed,
      etaSec: Math.max(0, Math.min(rawEta, cap)),
      etaState: 'stable'
    }
  }
}
