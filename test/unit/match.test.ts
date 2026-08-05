import { describe, it, expect } from 'vitest'
import { titleMatchScore, matchUploads, titleTokens, uploadStatusOf, DEFAULT_UPLOAD_MATCH_THRESHOLD } from '../../shared/match'

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
    expect(res[0].confidence).toBe('high')
  })
  it('returns pending matches in the confirmation band', () => {
    const res = matchUploads([{ videoId: 'v-pending', title: 'When Stop Contacting Narcissist' }], uploads)
    expect(res).toHaveLength(1)
    expect(res[0].score).toBeGreaterThanOrEqual(0.6)
    expect(res[0].score).toBeLessThan(0.82)
    expect(res[0].confidence).toBe('pending')
  })
  it('omits items with no match above threshold', () => {
    const res = matchUploads([{ videoId: 'v2', title: 'How to Build a Gaming PC' }], uploads)
    expect(res).toHaveLength(0)
  })
  it('respects a custom threshold', () => {
    const items = [{ videoId: 'v3', title: 'When You Stop the Narcissist' }]
    expect(matchUploads(items, uploads, 0.99, 0.99)).toHaveLength(0)
    expect(matchUploads(items, uploads, 0.5).length).toBeGreaterThan(0)
  })
})

describe('uploadStatusOf', () => {
  const DETECTED = '2026-08-05T10:00:00.000Z'
  // What setDetectedUploads writes when detection ran and matched nothing: a row with an empty
  // uploadedTo and a detectedAt stamp. That stamp is the only thing separating a real "not
  // uploaded" from "never checked", and the screen renders them as different answers.
  const checkedNoMatch = { uploadedTo: [], uploadMatchScore: 0, uploadConfidence: undefined, detectedAt: DETECTED, uploadedManual: null }

  it('reports unchecked when detection has never written a row', () => {
    expect(uploadStatusOf(undefined)).toBe('unchecked')
  })
  it('reports unchecked for a row that exists but was never detected against', () => {
    // e.g. setWorkItemArchived created the row; detection itself never ran on this item
    expect(uploadStatusOf({ uploadedTo: [], uploadConfidence: undefined, uploadedManual: null })).toBe('unchecked')
  })
  it('distinguishes a real "detection ran, no match" from unchecked', () => {
    expect(uploadStatusOf(checkedNoMatch)).toBe('not-uploaded')
  })
  it('reports uploaded on a high-confidence match', () => {
    expect(uploadStatusOf({ uploadedTo: ['ch-1'], uploadMatchScore: 0.91, uploadConfidence: 'high', detectedAt: DETECTED, uploadedManual: null })).toBe('uploaded')
  })
  it('reports maybe-uploaded inside the confirm band instead of asserting uploaded', () => {
    expect(uploadStatusOf({ uploadedTo: ['ch-1'], uploadMatchScore: 0.68, uploadConfidence: 'pending', detectedAt: DETECTED, uploadedManual: null })).toBe('maybe-uploaded')
  })
  it('lets a manual mark win over detection in both directions', () => {
    // Manual is checked before detectedAt on purpose: marking a video uploaded is an answer
    // even when detection has never run, so it must not read back as "not checked".
    expect(uploadStatusOf({ uploadedTo: [], uploadedManual: true })).toBe('uploaded')
    expect(uploadStatusOf({ uploadedTo: ['ch-1'], uploadMatchScore: 0.95, uploadConfidence: 'high', detectedAt: DETECTED, uploadedManual: false })).toBe('not-uploaded')
  })
  it('never claims uploaded for a mid-band title overlap (the retired 0.5-threshold false positive)', () => {
    // Two genuinely different videos on a single-niche channel routinely share most of their
    // words. The retired Publish matcher took max-over-the-whole-back-catalogue at >= 0.5 and
    // rendered a confident green "Uploaded" for a video still sitting unpublished on disk.
    const mine = 'Why Quiet People Always Win With Narcissists'
    const theirs = 'Why Quiet People Always Win Arguments'
    const score = titleMatchScore(mine, theirs)
    expect(score).toBeGreaterThanOrEqual(0.5)          // the old threshold would have fired
    expect(score).toBeLessThan(DEFAULT_UPLOAD_MATCH_THRESHOLD)
    const [match] = matchUploads([{ videoId: 'v1', title: mine }], [{ channelId: 'ch-1', title: theirs }])
    // Mapped field by field on purpose: matchUploads returns `confidence`/`score`, the
    // persisted work_item_state shape reads `uploadConfidence`/`uploadMatchScore`, and a
    // spread that silently drops the rename reads back as a confident "uploaded".
    expect(uploadStatusOf({
      uploadedTo: match.uploadedTo,
      uploadMatchScore: match.score,
      uploadConfidence: match.confidence,
      detectedAt: DETECTED,
      uploadedManual: null
    })).toBe('maybe-uploaded')
  })
})
