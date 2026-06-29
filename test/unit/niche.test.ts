import { describe, it, expect } from 'vitest'
import { poolKeyForNiche, nicheSearchThemes, dimsForOrientation, normalizeNiche, nicheRefreshDue, planPoolPrune } from '../../electron/services/niche'

describe('poolKeyForNiche', () => {
  it('prefixes the id', () => {
    expect(poolKeyForNiche('abc123')).toBe('niche-abc123')
  })
})

describe('nicheSearchThemes', () => {
  it('lowercases, trims, collapses spaces, dedupes, drops too-short', () => {
    expect(nicheSearchThemes({ keywords: ['  Focused   Work ', 'focused work', 'A', 'City At Night', ''] }))
      .toEqual(['focused work', 'city at night'])
  })
  it('handles missing keywords', () => {
    expect(nicheSearchThemes({ keywords: [] })).toEqual([])
  })
})

describe('dimsForOrientation', () => {
  it('maps orientation to a target frame', () => {
    expect(dimsForOrientation('landscape')).toEqual({ w: 1920, h: 1080 })
    expect(dimsForOrientation('any')).toEqual({ w: 1920, h: 1080 })
    expect(dimsForOrientation('portrait')).toEqual({ w: 1080, h: 1920 })
  })
})

describe('normalizeNiche', () => {
  it('fills defaults + clamps targetClips + sanitizes keywords', () => {
    const n = normalizeNiche({ id: 'n1', name: '  ', keywords: ['  Tech ', 'tech', 'AI news'], targetClips: 9999 })
    expect(n.name).toBe('Untitled niche')
    expect(n.keywords).toEqual(['tech', 'ai news'])
    expect(n.targetClips).toBe(200)
    expect(n.orientation).toBe('landscape')
    expect(n.createdAt).toBeTruthy()
    expect(n.updatedAt).toBeTruthy()
  })
  it('clamps low/invalid targetClips and keeps valid orientation', () => {
    expect(normalizeNiche({ id: 'n', targetClips: 0 }).targetClips).toBe(60) // 0 is falsy → default
    expect(normalizeNiche({ id: 'n', targetClips: -5 }).targetClips).toBe(1) // clamped to >= 1
    expect(normalizeNiche({ id: 'n', targetClips: NaN }).targetClips).toBe(60)
    expect(normalizeNiche({ id: 'n', orientation: 'portrait' }).orientation).toBe('portrait')
    expect(normalizeNiche({ id: 'n', orientation: 'bogus' as never }).orientation).toBe('landscape')
  })
  it('preserves a provided createdAt', () => {
    expect(normalizeNiche({ id: 'n', createdAt: '2020-01-01T00:00:00.000Z' }).createdAt).toBe('2020-01-01T00:00:00.000Z')
  })
})

describe('nicheRefreshDue', () => {
  const now = Date.parse('2026-06-29T12:00:00.000Z')
  it('is due when never warmed or unparseable', () => {
    expect(nicheRefreshDue(undefined, now, 24)).toBe(true)
    expect(nicheRefreshDue('not-a-date', now, 24)).toBe(true)
  })
  it('is due only once older than the interval', () => {
    const tenHoursAgo = new Date(now - 10 * 3_600_000).toISOString()
    const thirtyHoursAgo = new Date(now - 30 * 3_600_000).toISOString()
    expect(nicheRefreshDue(tenHoursAgo, now, 24)).toBe(false)
    expect(nicheRefreshDue(thirtyHoursAgo, now, 24)).toBe(true)
  })
})

describe('planPoolPrune', () => {
  const now = Date.parse('2026-06-29T12:00:00.000Z')
  const daysAgo = (d: number): string => new Date(now - d * 86_400_000).toISOString()
  it('prunes clips unused longer than maxAgeDays (lastUsedAt wins over addedAt)', () => {
    const clips = [
      { path: 'fresh.mp4', addedAt: daysAgo(60), lastUsedAt: daysAgo(2) },   // used recently → keep
      { path: 'stale.mp4', addedAt: daysAgo(60), lastUsedAt: daysAgo(40) },  // unused 40d → prune
      { path: 'newish.mp4', addedAt: daysAgo(5) },                            // added 5d, never used → keep
      { path: 'old.mp4', addedAt: daysAgo(45) }                               // added 45d, never used → prune
    ]
    const pruned = planPoolPrune(clips, { nowMs: now, maxAgeDays: 30 }).map((c) => c.path)
    expect(pruned.sort()).toEqual(['old.mp4', 'stale.mp4'])
  })
  it('never prunes clips with no timestamps (legacy/unknown age)', () => {
    expect(planPoolPrune([{ path: 'legacy.mp4' }], { nowMs: now, maxAgeDays: 1 })).toEqual([])
  })
})
