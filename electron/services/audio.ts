import { spawnSync } from 'node:child_process'
import { parseFile } from 'music-metadata'
import { ffprobePath } from './bin'
import { logger } from './logger'

// Audio helpers: duration probing and the even-split image range math that drives
// the Compose timeline. ffprobe is the source of truth because VBR MP3 headers can
// mislead music-metadata and produce short final renders.
const AUDIO_LOG = logger.scope('audio')

function probeDurationWithFfprobe(filePath: string): number {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath], { encoding: 'utf8' })
  const n = Number.parseFloat((r.stdout ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Read an audio file's duration. ffprobe wins when it disagrees with headers. */
export async function probeDuration(filePath: string): Promise<number> {
  const ffprobeSec = probeDurationWithFfprobe(filePath)
  let metaSec = 0
  try {
    const meta = await parseFile(filePath)
    metaSec = meta.format.duration ?? 0
  } catch (e) {
    AUDIO_LOG.debug(`metadata duration read failed path=${filePath}: ${(e as Error).message}`)
  }
  if (ffprobeSec > 0 && (!metaSec || Math.abs(ffprobeSec - metaSec) / ffprobeSec > 0.02)) {
    return Math.round(ffprobeSec * 100) / 100
  }
  return Math.round((metaSec || ffprobeSec || 0) * 100) / 100
}

export interface Range {
  rangeStart: number
  rangeEnd: number
}

/** Evenly split a duration into n contiguous ranges (single image = full length). */
export function splitRanges(durationSec: number, n: number): Range[] {
  if (n <= 1) return [{ rangeStart: 0, rangeEnd: durationSec }]
  const step = durationSec / n
  return Array.from({ length: n }, (_, i) => ({
    rangeStart: Math.round(i * step * 100) / 100,
    rangeEnd: i === n - 1 ? durationSec : Math.round((i + 1) * step * 100) / 100
  }))
}

/** Apply a manual range override to a base set, keeping the rest even. */
export function applyOverride(base: Range[], index: number, override: Range): Range[] {
  return base.map((r, i) => (i === index ? override : r))
}

/** Render the output file name from the Settings template ({channel}/{title}/{date}). */
export function formatOutputName(template: string, vars: { channel: string; title: string; date?: string }): string {
  const date = vars.date ?? new Date().toISOString().slice(0, 10)
  const raw = template
    .replace(/\{channel\}/g, vars.channel)
    .replace(/\{title\}/g, vars.title)
    .replace(/\{date\}/g, date)
  // strip characters that are illegal in file names across win/mac/linux
  return raw.replace(/[\\/:*?"<>|]/g, '_').trim()
}
