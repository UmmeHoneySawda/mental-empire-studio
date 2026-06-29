import { describe, it, expect } from 'vitest'
import { parseUploadDate, goalProgressFromUploads } from '../../shared/goals'
import type { Upload } from '../../shared/types'

function up(id: string, publishedAt: string): Upload {
  return { id, myChannelId: 'c', title: id, youtubeVideoId: id, publishedAt, views: '' }
}

// A4: weekly/monthly goal progress is derived from real upload dates.
describe('parseUploadDate', () => {
  it('parses yt-dlp YYYYMMDD', () => {
    const d = parseUploadDate('20260614')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getMonth()).toBe(5) // June (0-indexed)
    expect(d?.getDate()).toBe(14)
  })
  it('parses ISO dates and rejects junk', () => {
    expect(parseUploadDate('2026-06-14')?.getFullYear()).toBe(2026)
    expect(parseUploadDate('')).toBeNull()
    expect(parseUploadDate('not-a-date')).toBeNull()
    expect(parseUploadDate(undefined)).toBeNull()
  })
})

describe('goalProgressFromUploads', () => {
  const now = new Date(2026, 5, 20) // 2026-06-20

  it('counts uploads in the last 7 days as weekDone', () => {
    const uploads = [
      up('a', '20260618'), // 2 days ago → week + month
      up('b', '20260614'), // 6 days ago → week + month
      up('c', '20260610'), // 10 days ago → month only
      up('d', '20260501') // last month → neither
    ]
    const [week, month] = goalProgressFromUploads(uploads, now)
    expect(week).toBe(2)
    expect(month).toBe(3)
  })

  it('ignores future dates and unparseable rows', () => {
    const uploads = [up('a', '20260625'), up('b', 'garbage'), up('c', '20260620')]
    const [week, month] = goalProgressFromUploads(uploads, now)
    expect(week).toBe(1) // only the 20th (today); future + garbage excluded
    expect(month).toBe(2) // the 25th still counts toward the month
  })

  it('returns [0,0] for no uploads', () => {
    expect(goalProgressFromUploads([], now)).toEqual([0, 0])
  })
})
