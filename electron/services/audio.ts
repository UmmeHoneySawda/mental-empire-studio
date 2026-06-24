import { parseFile } from 'music-metadata'

// Audio helpers: duration probing (pure-JS, no ffmpeg) and the even-split image
// range math that drives the Compose timeline. Kept dependency-light so the range
// logic is unit-testable offline.

/** Read an mp3's duration in seconds via music-metadata (no ffmpeg needed). */
export async function probeDuration(filePath: string): Promise<number> {
  const meta = await parseFile(filePath)
  return Math.round(meta.format.duration ?? 0)
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
