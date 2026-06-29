import { describe, it, expect } from 'vitest'
import { titleMatchScore, matchUploads, titleTokens } from '../../shared/match'

describe('titleMatchScore', () => {
  it('scores identical titles 1', () => {
    expect(titleMatchScore('When You Stop Contacting the Narcissist', 'When You Stop Contacting the Narcissist')).toBe(1)
  })
  it('is case/punctuation/emoji insensitive', () => {
    expect(titleMatchScore('STOP the Narcissist!!', '🔥 stop the narcissist')).toBe(1)
  })
  it('stays high when one or two words differ', () => {
    const s = titleMatchScore(
      'When You and The Narcissist Both Stop Contacting',
      'When You and The Narcissist Stop Contacting'
    )
    expect(s).toBeGreaterThanOrEqual(0.82)
  })
  it('tolerates pluralization / light edits', () => {
    expect(titleMatchScore('Dealing with Narcissist', 'Dealing with Narcissists')).toBe(1)
    expect(titleMatchScore('Discipline equals freedom', 'Disciplin equals freedom')).toBe(1)
  })
  it('is order-insensitive', () => {
    expect(titleMatchScore('focus and discipline', 'discipline and focus')).toBe(1)
  })
  it('scores unrelated titles low', () => {
    expect(titleMatchScore('How to build a PC', 'When the narcissist stops contacting')).toBeLessThan(0.3)
  })
  it('does not let a short title spuriously match a long one', () => {
    expect(titleMatchScore('stop', 'stop chasing the narcissist and watch what happens next')).toBeLessThan(0.2)
  })
  it('returns 0 for empty input', () => {
    expect(titleMatchScore('', 'anything')).toBe(0)
    expect(titleMatchScore('anything', '')).toBe(0)
  })
})

describe('titleTokens', () => {
  it('drops single chars + symbols', () => {
    expect(titleTokens('A B!! the-narcissist 2024')).toEqual(['the', 'narcissist', '2024'])
  })
})

describe('matchUploads', () => {
  const uploads = [
    { channelId: 'ch-a', title: 'When You Stop Contacting the Narcissist' },
    { channelId: 'ch-b', title: 'When You Stop Contacting the Narcissist (Reupload)' },
    { channelId: 'ch-c', title: 'Morning Routine for Focus' }
  ]
  it('matches an item to every channel it appears on (can be multiple)', () => {
    const res = matchUploads([{ videoId: 'v1', title: 'When You Stop Contacting the Narcissist' }], uploads)
    expect(res).toHaveLength(1)
    expect(res[0].videoId).toBe('v1')
    expect(res[0].uploadedTo.sort()).toEqual(['ch-a', 'ch-b'])
    expect(res[0].score).toBeGreaterThanOrEqual(0.82)
  })
  it('omits items with no match above threshold', () => {
    const res = matchUploads([{ videoId: 'v2', title: 'How to Build a Gaming PC' }], uploads)
    expect(res).toHaveLength(0)
  })
  it('respects a custom threshold', () => {
    const items = [{ videoId: 'v3', title: 'When You Stop the Narcissist' }]
    expect(matchUploads(items, uploads, 0.99)).toHaveLength(0)
    expect(matchUploads(items, uploads, 0.5).length).toBeGreaterThan(0)
  })
})
