import type { Upload } from './types'

// Pure helpers for deriving real publishing-goal progress from a channel's uploads.
// Kept dependency-free (no electron / no DB) so they're unit-testable in plain Node.

/** Parse yt-dlp's `YYYYMMDD` upload_date (or an ISO date) into a Date, or null. */
export function parseUploadDate(s: string | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim())
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

/** Count uploads published in the last 7 days (week) and the current calendar month. */
export function goalProgressFromUploads(uploads: Upload[], now: Date = new Date()): [weekDone: number, monthDone: number] {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
  let weekDone = 0
  let monthDone = 0
  for (const u of uploads) {
    const d = parseUploadDate(u.publishedAt)
    if (!d) continue
    if (d.getTime() >= weekAgo && d.getTime() <= now.getTime()) weekDone++
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) monthDone++
  }
  return [weekDone, monthDone]
}
