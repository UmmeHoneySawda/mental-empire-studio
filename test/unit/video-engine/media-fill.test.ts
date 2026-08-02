import { describe, expect, it } from 'vitest'
import { emptySpans, mediaFillSeed, planMediaFill, type FillSpan } from '../../../shared/video-engine/fill'

// The user's case: three or four stills and an eight-minute voiceover. "Fill" gives one
// long slot each; "cycle" keeps the frame moving. Both must tile the timeline exactly,
// because a gap renders as background colour and an overlap renders as a stack.

const FPS = 30

function covers(plan: ReturnType<typeof planMediaFill>, spans: FillSpan[]): boolean {
  const sorted = [...plan].sort((a, b) => a.startFrame - b.startFrame)
  let index = 0
  for (const span of spans) {
    let cursor = span.startFrame
    while (cursor < span.endFrame) {
      const scene = sorted[index]
      if (!scene || scene.startFrame !== cursor) return false
      cursor += scene.durationFrames
      index += 1
    }
    if (cursor !== span.endFrame) return false
  }
  return index === sorted.length
}

describe('emptySpans', () => {
  it('returns the whole timeline when nothing is placed', () => {
    expect(emptySpans([], 900)).toEqual([{ startFrame: 0, endFrame: 900 }])
  })

  it('finds the gaps around existing clips', () => {
    const gaps = emptySpans([
      { startFrame: 100, durationFrames: 100 },
      { startFrame: 400, durationFrames: 100 }
    ], 900)
    expect(gaps).toEqual([
      { startFrame: 0, endFrame: 100 },
      { startFrame: 200, endFrame: 400 },
      { startFrame: 500, endFrame: 900 }
    ])
  })

  it('merges overlapping clips rather than reporting a negative gap', () => {
    const gaps = emptySpans([
      { startFrame: 0, durationFrames: 300 },
      { startFrame: 100, durationFrames: 300 }
    ], 900)
    expect(gaps).toEqual([{ startFrame: 400, endFrame: 900 }])
  })

  it('reports nothing when the timeline is already covered', () => {
    expect(emptySpans([{ startFrame: 0, durationFrames: 900 }], 900)).toEqual([])
  })
})

describe('planMediaFill — fill mode', () => {
  it('gives four stills one equal slot each across eight minutes', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 8 * 60 * FPS }]
    const plan = planMediaFill({
      assetIds: ['a', 'b', 'c', 'd'],
      spans,
      fps: FPS,
      segmentSeconds: 0,
      shuffle: false,
      seed: 1
    })
    expect(plan).toHaveLength(4)
    expect(plan.map((scene) => scene.assetId)).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(plan.map((scene) => scene.durationFrames))).toEqual(new Set([3600]))
    expect(covers(plan, spans)).toBe(true)
  })

  it('tiles exactly when the span does not divide evenly', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 1003 }]
    const plan = planMediaFill({ assetIds: ['a', 'b', 'c'], spans, fps: FPS, segmentSeconds: 0, shuffle: false, seed: 1 })
    expect(plan.reduce((sum, scene) => sum + scene.durationFrames, 0)).toBe(1003)
    expect(covers(plan, spans)).toBe(true)
  })

  it('continues the rotation across separate gaps instead of restarting', () => {
    const spans: FillSpan[] = [
      { startFrame: 0, endFrame: 300 },
      { startFrame: 600, endFrame: 900 }
    ]
    const plan = planMediaFill({ assetIds: ['a', 'b'], spans, fps: FPS, segmentSeconds: 0, shuffle: false, seed: 1 })
    expect(plan.map((scene) => scene.assetId)).toEqual(['a', 'b', 'a', 'b'])
    expect(covers(plan, spans)).toBe(true)
  })
})

describe('planMediaFill — cycle mode', () => {
  it('chops eight minutes into ~8s segments and rotates the stills', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 8 * 60 * FPS }]
    const plan = planMediaFill({
      assetIds: ['a', 'b', 'c', 'd'],
      spans,
      fps: FPS,
      segmentSeconds: 8,
      shuffle: false,
      seed: 1
    })
    expect(plan).toHaveLength(60) // 480s / 8s
    expect(plan.every((scene) => scene.durationFrames === 240)).toBe(true)
    expect(plan.slice(0, 5).map((scene) => scene.assetId)).toEqual(['a', 'b', 'c', 'd', 'a'])
    expect(covers(plan, spans)).toBe(true)
  })

  it('never shows the same still twice in a row when shuffling', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 8 * 60 * FPS }]
    const plan = planMediaFill({
      assetIds: ['a', 'b', 'c', 'd'],
      spans,
      fps: FPS,
      segmentSeconds: 7,
      shuffle: true,
      seed: 4242
    })
    const repeats = plan.filter((scene, index) => index > 0 && plan[index - 1]!.assetId === scene.assetId)
    expect(repeats).toEqual([])
    expect(covers(plan, spans)).toBe(true)
  })

  it('is deterministic for a given seed', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 3000 }]
    const args = { assetIds: ['a', 'b', 'c'], spans, fps: FPS, segmentSeconds: 5, shuffle: true, seed: 7 } as const
    expect(planMediaFill(args)).toEqual(planMediaFill(args))
  })

  it.each([3, 4] as const)('keeps %ss intervals exact and trims only the final item', (seconds) => {
    const segmentFrames = seconds * FPS
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: segmentFrames * 3 + 17 }]
    const plan = planMediaFill({
      assetIds: ['a', 'b'],
      spans,
      fps: FPS,
      segmentSeconds: seconds,
      shuffle: false,
      seed: 1
    })
    expect(plan.map((scene) => scene.durationFrames)).toEqual([
      segmentFrames,
      segmentFrames,
      segmentFrames,
      17
    ])
    expect(plan.map((scene) => scene.assetId)).toEqual(['a', 'b', 'a', 'b'])
    expect(covers(plan, spans)).toBe(true)
  })

  it('covers a project shorter than one interval with one valid trimmed item', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 45 }]
    const plan = planMediaFill({ assetIds: ['a', 'b'], spans, fps: FPS, segmentSeconds: 4, shuffle: false, seed: 1 })
    expect(plan).toEqual([{ assetId: 'a', startFrame: 0, durationFrames: 45 }])
    expect(covers(plan, spans)).toBe(true)
  })

  it('covers the last one-frame remainder instead of leaving a gap', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 271 }]
    const plan = planMediaFill({ assetIds: ['a', 'b'], spans, fps: FPS, segmentSeconds: 3, shuffle: false, seed: 1 })
    expect(plan.map((scene) => scene.durationFrames)).toEqual([90, 90, 90, 1])
    expect(plan.every((scene) => scene.durationFrames > 0)).toBe(true)
    expect(covers(plan, spans)).toBe(true)
  })

  it('tiles a long project without drifting away from the requested interval', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 22 * 60 * FPS + 11 }]
    const plan = planMediaFill({ assetIds: ['a', 'b', 'c'], spans, fps: FPS, segmentSeconds: 3, shuffle: false, seed: 1 })
    expect(plan.slice(0, -1).every((scene) => scene.durationFrames === 90)).toBe(true)
    expect(plan.at(-1)?.durationFrames).toBe(11)
    expect(covers(plan, spans)).toBe(true)
  })

  it('keeps even a tiny final partial slot so coverage stays exact', () => {
    const spans: FillSpan[] = [{ startFrame: 0, endFrame: 20 }]
    const plan = planMediaFill({ assetIds: ['a', 'b', 'c', 'd'], spans, fps: FPS, segmentSeconds: 0.1, shuffle: false, seed: 1 })
    expect(plan.map((scene) => scene.durationFrames)).toEqual([6, 6, 6, 2])
    expect(covers(plan, spans)).toBe(true)
  })

  it('deduplicates selected asset ids before cycling', () => {
    const plan = planMediaFill({
      assetIds: ['a', 'a', 'b'],
      spans: [{ startFrame: 0, endFrame: 270 }],
      fps: FPS,
      segmentSeconds: 3,
      shuffle: false,
      seed: 1
    })
    expect(plan.map((scene) => scene.assetId)).toEqual(['a', 'b', 'a'])
  })

  it('derives the same shuffle seed across unrelated project revisions', () => {
    expect(mediaFillSeed('project-1', ['a', 'b'], 3)).toBe(mediaFillSeed('project-1', ['a', 'b'], 3))
    expect(mediaFillSeed('project-1', ['a', 'b'], 3)).not.toBe(mediaFillSeed('project-1', ['b', 'a'], 3))
  })
})

describe('planMediaFill — guards', () => {
  it('returns nothing without assets', () => {
    expect(planMediaFill({ assetIds: [], spans: [{ startFrame: 0, endFrame: 900 }], fps: FPS, segmentSeconds: 0, shuffle: false, seed: 1 })).toEqual([])
  })

  it('ignores gaps too short to be worth a clip', () => {
    expect(planMediaFill({ assetIds: ['a'], spans: [{ startFrame: 0, endFrame: 3 }], fps: FPS, segmentSeconds: 0, shuffle: false, seed: 1 })).toEqual([])
  })
})
