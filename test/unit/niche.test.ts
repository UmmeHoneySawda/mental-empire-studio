import { describe, it, expect } from 'vitest'
import { poolKeyForNiche, nicheSearchThemes, dimsForOrientation, normalizeNiche } from '../../electron/services/niche'

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
