import { describe, expect, it } from 'vitest'
import { planCoverage } from '../../electron/services/broll'

// Regression coverage for the B-roll "same clip repeats several times in a row"
// bug. planCoverage round-robins the pool to cover [0, durationSec]; it must
// distribute the available clips evenly and never place the same clip in two
// consecutive slots when another distinct clip exists — even when the incoming
// pool contains duplicate/adjacent entries or is very small.

const clip = (path: string, durationSec = 8) => ({ path, durationSec })

/** Count max run-length of identical consecutive clip paths. */
function maxConsecutive(paths: string[]): number {
  let max = 0
  let run = 0
  let prev = ''
  for (const p of paths) {
    run = p === prev ? run + 1 : 1
    prev = p
    if (run > max) max = run
  }
  return max
}

describe('planCoverage — even distribution, no consecutive repeats', () => {
  it('covers the whole duration with no gaps', () => {
    const segs = planCoverage(60, [clip('a'), clip('b'), clip('c')], { density: 'full' })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs[0].start).toBe(0)
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeCloseTo(segs[i - 1].end, 5)
    }
    expect(segs[segs.length - 1].end).toBeGreaterThanOrEqual(60 - 0.05)
  })

  it('never repeats a clip in consecutive slots when alternatives exist', () => {
    const segs = planCoverage(120, [clip('a'), clip('b'), clip('c'), clip('d')], { density: 'full' })
    expect(maxConsecutive(segs.map((s) => s.path))).toBe(1)
  })

  it('distributes clips evenly (round-robin over distinct)', () => {
    const segs = planCoverage(120, [clip('a'), clip('b'), clip('c')], { density: 'full' })
    const counts = new Map<string, number>()
    for (const s of segs) counts.set(s.path, (counts.get(s.path) ?? 0) + 1)
    const used = [...counts.values()]
    // every clip is used, and no clip is used more than one extra time vs another
    expect(counts.size).toBe(3)
    expect(Math.max(...used) - Math.min(...used)).toBeLessThanOrEqual(1)
  })

  it('collapses a pool full of adjacent duplicates and still uses every distinct clip', () => {
    // This is the exact shape the old libraryCandidates/fetchPool bug produced:
    // the same clip repeated adjacently ahead of the distinct ones.
    const pool = [clip('a'), clip('a'), clip('a'), clip('b'), clip('c')]
    const segs = planCoverage(90, pool, { density: 'full' })
    const paths = segs.map((s) => s.path)
    expect(maxConsecutive(paths)).toBe(1)
    expect(new Set(paths)).toEqual(new Set(['a', 'b', 'c']))
  })

  it('strictly alternates with exactly two distinct clips', () => {
    const segs = planCoverage(80, [clip('a'), clip('b')], { density: 'full' })
    const paths = segs.map((s) => s.path)
    expect(maxConsecutive(paths)).toBe(1)
    for (let i = 1; i < paths.length; i++) expect(paths[i]).not.toBe(paths[i - 1])
  })

  describe('limited B-roll inventory', () => {
    it('a single distinct clip fills full coverage gracefully (unavoidable repeat)', () => {
      const segs = planCoverage(45, [clip('only')], { density: 'full' })
      expect(segs.length).toBeGreaterThan(0)
      expect(segs.every((s) => s.path === 'only')).toBe(true)
      expect(segs[segs.length - 1].end).toBeGreaterThanOrEqual(45 - 0.05)
    })

    it('a single clip supplied as many duplicate entries collapses to one distinct clip', () => {
      const segs = planCoverage(45, [clip('x'), clip('x'), clip('x'), clip('x')], { density: 'full' })
      expect(new Set(segs.map((s) => s.path))).toEqual(new Set(['x']))
    })

    it('two clips where one is duplicated still alternate (no back-to-back)', () => {
      const segs = planCoverage(80, [clip('a'), clip('a'), clip('b')], { density: 'full' })
      expect(maxConsecutive(segs.map((s) => s.path))).toBe(1)
      expect(new Set(segs.map((s) => s.path))).toEqual(new Set(['a', 'b']))
    })

    it('returns nothing for an empty pool or non-positive duration', () => {
      expect(planCoverage(60, [], { density: 'full' })).toEqual([])
      expect(planCoverage(0, [clip('a')], { density: 'full' })).toEqual([])
    })
  })
})
