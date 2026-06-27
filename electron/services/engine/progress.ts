export interface FfmpegProgress {
  outTimeSec: number
  pct: number
  etaSec?: number
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
    speed: speed && Number.isFinite(speed) ? speed : undefined,
    fps: values.get('fps') ? Number.parseFloat(values.get('fps') as string) : undefined,
    bitrate: values.get('bitrate')?.trim()
  }
}

