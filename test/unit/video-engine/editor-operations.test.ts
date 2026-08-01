import { describe, expect, it } from 'vitest'
import type { AutoBrollPlacement, VideoProject, VideoScene } from '../../../shared/video-engine'
import {
  applyAutoBroll,
  contentEndFrame,
  duplicateClip,
  moveClip,
  overlappingSceneIds,
  snapCandidates,
  snapFrame,
  trimClip,
  withCanvasCoveringContent
} from '../../../src/features/video-studio/editor/operations'
import { clipWidthPx, framesToPx } from '../../../src/features/video-studio/editor/constants'
import { defaultHookPlan } from '../../../src/features/video-studio/editor/hookPlan'
import { createEmptyVideoProject, HookPlanSchema, VideoProjectSchema } from '../../../shared/video-engine'

/* Regression cover for the three timeline bugs and the premade-hook plan.
 *
 * The editor has no DOM test harness (see skills/video-studio-editor/SKILL.md — it is
 * driven live over CDP), so these pin the pure half: the model invariants that, when they
 * broke, produced what the user saw. The DOM half of the width bug is verified against the
 * running app; what is testable here is that the geometry both sides use is one function. */

const fps = 30

function scene(over: Partial<VideoScene> & Pick<VideoScene, 'id'>): VideoScene {
  return {
    kind: 'text',
    trackId: 'v1',
    startFrame: 0,
    durationFrames: 90,
    zIndex: 0,
    text: 'x',
    ...over
  } as VideoScene
}

function project(scenes: VideoScene[], durationFrames = 600): VideoProject {
  return {
    id: 'p1',
    rendererId: 'remotion',
    name: 'p',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: { width: 1920, height: 1080, fps, durationFrames, backgroundColor: '#000000' },
    tracks: [
      { id: 'v1', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false },
      { id: 'v2', name: 'Overlay', kind: 'overlay', order: 1, muted: false, locked: false }
    ],
    assets: [],
    scenes,
    transitions: [],
    grading: {
      enabled: false,
      lutIntensity: 1,
      exposure: 0,
      contrast: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
      vignette: 0,
      grain: 0
    }
  } as unknown as VideoProject
}

describe('moving a clip never resizes it', () => {
  // The reported symptom was "clicking or editing an item appears to shorten it, but the
  // duration is not actually updated". The model half of that has to stay true: a move is
  // a move. (The visual half was `onUp` clearing a React-owned inline width — covered by
  // the geometry test below and verified live.)
  it('keeps durationFrames across a move', () => {
    const before = project([scene({ id: 'a', startFrame: 30, durationFrames: 90 })])
    const after = moveClip(before, 'a', 300)
    const moved = after.scenes.find((candidate) => candidate.id === 'a')!
    expect(moved.startFrame).toBe(300)
    expect(moved.durationFrames).toBe(90)
  })

  it('keeps durationFrames when the move is refused as a no-op', () => {
    const before = project([scene({ id: 'a', startFrame: 30, durationFrames: 90 })])
    expect(moveClip(before, 'a', 30)).toBe(before)
  })

  it('keeps durationFrames when moving to another lane', () => {
    const before = project([scene({ id: 'a', startFrame: 30, durationFrames: 90 })])
    const after = moveClip(before, 'a', 30, 'v2')
    const moved = after.scenes.find((candidate) => candidate.id === 'a')!
    expect(moved.trackId).toBe('v2')
    expect(moved.durationFrames).toBe(90)
  })
})

describe('one definition of a clip’s on-screen width', () => {
  // `clipWidthPx` is what both the render and the gesture's restore use. If they ever
  // diverge again, a gesture that ends without changing the duration leaves the DOM at a
  // width React will not correct, because React's own before/after values are equal.
  it('agrees with the raw frame conversion above the minimum', () => {
    expect(clipWidthPx(90, fps, 1)).toBe(framesToPx(90, fps, 1))
    expect(clipWidthPx(90, fps, 1)).toBe(300)
  })

  it('never returns a width too small to click', () => {
    expect(clipWidthPx(1, fps, 0.25)).toBeGreaterThanOrEqual(4)
  })
})

describe('snapping does not stack a clip on its lane-mate', () => {
  const before = project([
    scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
    scene({ id: 'b', startFrame: 300, durationFrames: 90, trackId: 'v1' }),
    scene({ id: 'c', startFrame: 300, durationFrames: 90, trackId: 'v2' })
  ])

  it('offers a lane-mate’s END to a dragged leading edge, never its start', () => {
    const candidates = snapCandidates(before, { id: 'a', trackId: 'v1' }, -1, 'start')
    expect(candidates).toContain(390) // b's end — the butt-join a drag is reaching for
    // 300 is b's START. It is also a whole second (10s at 30fps), so it is legitimately in
    // the set; what must not happen is a NON-second start becoming an attractor.
    const offGrid = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'b', startFrame: 307, durationFrames: 90 })
    ])
    const offGridCandidates = snapCandidates(offGrid, { id: 'a', trackId: 'v1' }, -1, 'start')
    expect(offGridCandidates).not.toContain(307)
    expect(offGridCandidates).toContain(397)
  })

  it('offers a lane-mate’s START to a dragged trailing edge', () => {
    const offGrid = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'b', startFrame: 307, durationFrames: 90 })
    ])
    const candidates = snapCandidates(offGrid, { id: 'a', trackId: 'v1' }, -1, 'end')
    expect(candidates).toContain(307)
    expect(candidates).not.toContain(397)
  })

  it('still offers both edges of a clip on another lane', () => {
    const offGrid = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'c', startFrame: 307, durationFrames: 90, trackId: 'v2' })
    ])
    const candidates = snapCandidates(offGrid, { id: 'a', trackId: 'v1' }, -1, 'start')
    expect(candidates).toContain(307)
    expect(candidates).toContain(397)
  })

  it('never offers the dragged clip its own edges', () => {
    // Off the whole-second grid on both sides, or the seconds would supply the same
    // numbers and the assertion would pass for the wrong reason.
    const offGrid = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'b', startFrame: 307, durationFrames: 91 })
    ])
    const candidates = snapCandidates(offGrid, { id: 'b', trackId: 'v1' }, -1, 'start')
    expect(candidates).not.toContain(307)
    expect(candidates).not.toContain(398)
  })

  it('leaves a frame alone when nothing is within tolerance', () => {
    expect(snapFrame(147, [0, 90, 300], 2)).toBe(147)
    expect(snapFrame(89, [0, 90, 300], 2)).toBe(90)
  })
})

describe('overlapping clips are detectable', () => {
  it('flags both clips of a same-lane overlap', () => {
    const overlapped = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'b', startFrame: 60, durationFrames: 90 })
    ])
    expect([...overlappingSceneIds(overlapped)].sort()).toEqual(['a', 'b'])
  })

  it('does not flag a butt-join', () => {
    const touching = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'b', startFrame: 90, durationFrames: 90 })
    ])
    expect(overlappingSceneIds(touching).size).toBe(0)
  })

  it('does not flag clips on different lanes', () => {
    const stacked = project([
      scene({ id: 'a', startFrame: 0, durationFrames: 90 }),
      scene({ id: 'c', startFrame: 0, durationFrames: 90, trackId: 'v2' })
    ])
    expect(overlappingSceneIds(stacked).size).toBe(0)
  })
})

describe('duplicating the last clip', () => {
  it('copies it at full length and grows the canvas', () => {
    const before = project([scene({ id: 'a', startFrame: 510, durationFrames: 90 })], 600)
    const after = duplicateClip(before, 'a')
    const copy = after.scenes.find((candidate) => candidate.id !== 'a')!
    // Clamping into the old 600-frame canvas is what used to make this a 2-frame sliver
    // stacked on the final frames — unclickable, in the one place duplicating is common.
    expect(copy.durationFrames).toBe(90)
    expect(copy.startFrame).toBe(600)
    expect(after.canvas.durationFrames).toBe(690)
  })
})

describe('the canvas covers the content', () => {
  it('grows to the last frame any clip occupies', () => {
    const before = project([scene({ id: 'a', startFrame: 700, durationFrames: 90 })], 600)
    const after = withCanvasCoveringContent(before)
    expect(contentEndFrame(after)).toBe(790)
    expect(after.canvas.durationFrames).toBe(790)
  })

  it('never shrinks, and returns the same object when nothing is needed', () => {
    const before = project([scene({ id: 'a', startFrame: 0, durationFrames: 90 })], 600)
    expect(withCanvasCoveringContent(before)).toBe(before)
  })
})

describe('trimming changes the duration', () => {
  it('extends the trailing edge', () => {
    const before = project([scene({ id: 'a', startFrame: 0, durationFrames: 90 })])
    const after = trimClip(before, 'a', 'end', 30)
    expect(after.scenes[0]!.durationFrames).toBe(120)
  })

  it('moves the leading edge and keeps the trailing one still', () => {
    const before = project([scene({ id: 'a', startFrame: 60, durationFrames: 90 })])
    const after = trimClip(before, 'a', 'start', 30)
    const trimmed = after.scenes[0]!
    expect(trimmed.startFrame).toBe(90)
    expect(trimmed.durationFrames).toBe(60)
    expect(trimmed.startFrame + trimmed.durationFrames).toBe(150)
  })
})

describe('the premade hook plan is valid on its own terms', () => {
  const template = {
    id: 'remotion-hook-kinetic-30',
    version: '1.0.0',
    rendererId: 'remotion',
    kind: 'hook',
    name: '30s Kinetic Hook',
    description: '',
    duration: { minimumFrames: 24, defaultFrames: 900, maximumFrames: 7200 },
    parameters: [],
    capabilities: [],
    aspectRatios: [],
    tags: []
  } as never

  // The whole point of building this in the renderer is that the schema is the contract;
  // a plan that fails it would surface as a raw zod complaint about a hook the user never
  // wrote. Every duration the slider can produce has to parse.
  it.each([1, 2, 5, 10, 17, 30])('parses at %is', (seconds) => {
    const plan = defaultHookPlan({ template, title: 'A title', fps, durationFrames: seconds * fps })
    expect(() => HookPlanSchema.parse(plan)).not.toThrow()
  })

  it('fills the budget exactly and orders the beats end to end', () => {
    const plan = defaultHookPlan({ template, title: 'A title', fps, durationFrames: 300 })
    expect(plan.durationFrames).toBe(300)
    let cursor = 0
    for (const beat of plan.beats) {
      expect(beat.startFrame).toBe(cursor)
      cursor += beat.durationFrames
    }
    expect(cursor).toBe(plan.durationFrames)
  })

  it('uses the caller’s title as the opening headline', () => {
    const plan = defaultHookPlan({ template, title: 'Why nobody finishes', fps, durationFrames: 300 })
    expect(plan.beats[0]!.headline).toBe('Why nobody finishes')
  })

  it('never lets a transition outlast its own beat', () => {
    const plan = defaultHookPlan({ template, title: 'T', fps, durationFrames: 30 })
    for (const beat of plan.beats) {
      if (beat.transitionOut) {
        expect(beat.transitionOut.durationFrames).toBeGreaterThan(0)
        expect(beat.transitionOut.durationFrames).toBeLessThanOrEqual(beat.durationFrames)
      }
    }
  })
})

describe('splicing an Auto B-roll run into the timeline', () => {
  function placement(over: Partial<AutoBrollPlacement> = {}): AutoBrollPlacement {
    const id = 'aaaaaaaa'
    return {
      moment: {
        startSec: 10,
        endSec: 14,
        text: 'narration',
        query: 'kettle boiling quiet kitchen',
        category: 'object',
        reason: 'covers the beat'
      },
      candidate: {
        id,
        provider: 'pexels',
        title: 'Kettle boiling',
        sourceUrl: 'https://example.test/1',
        downloadUrl: 'https://example.test/1.mp4',
        width: 1920,
        height: 1080,
        durationMs: 12_000,
        license: { name: 'Pexels', url: 'https://example.test/l', attributionRequired: false, commercialUseAllowed: true },
        tags: []
      },
      asset: {
        id: `broll:${id}`,
        name: 'Kettle boiling',
        kind: 'video',
        uri: `file:///cache/${id}.mp4`,
        durationFrames: 360
      },
      startFrame: 300,
      durationFrames: 120,
      score: 30,
      ...over
    }
  }

  /** A project the engine would actually accept, so the assertions below are about the
   *  operation rather than about a hand-rolled stub. */
  function realProject(): VideoProject {
    return VideoProjectSchema.parse({
      ...createEmptyVideoProject({
        id: 'remotion-p1',
        name: 'A clip',
        rendererId: 'remotion',
        width: 1920,
        height: 1080,
        fps,
        durationFrames: 3600,
        now: '2026-01-01T00:00:00.000Z'
      }),
      assets: [{ id: 'manual-asset', name: 'manual.mp4', kind: 'video', uri: 'file:///manual.mp4', durationFrames: 600 }],
      tracks: [
        { id: 'main-video', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false },
        { id: 'video-engine-broll', name: 'B-roll', kind: 'video', order: 0, muted: false, locked: false }
      ],
      scenes: [
        { id: 'manual-broll', trackId: 'video-engine-broll', kind: 'media', startFrame: 60, durationFrames: 90, zIndex: 1, assetId: 'manual-asset', fit: 'cover', opacity: 1 }
      ]
    })
  }

  it('puts every clip on its own lane above the base video', () => {
    const next = applyAutoBroll(realProject(), [placement()])
    const track = next.tracks.find((candidate) => candidate.id === 'auto-broll')!
    expect(track.order).toBe(10)
    expect(track.kind).toBe('video')
    expect(track.order).toBeGreaterThan(next.tracks.find((candidate) => candidate.id === 'main-video')!.order)
    const scene = next.scenes.find((candidate) => candidate.trackId === 'auto-broll')!
    expect(scene.kind).toBe('media')
    expect(scene.startFrame).toBe(300)
    expect(scene.durationFrames).toBe(120)
    expect(scene.fit).toBe('cover')
  })

  it('mutes every generated clip so the narration keeps the shared audio tags', () => {
    const next = applyAutoBroll(realProject(), [placement(), placement({ startFrame: 900 })])
    const generated = next.scenes.filter((scene) => scene.trackId === 'auto-broll')
    expect(generated).toHaveLength(2)
    expect(generated.every((scene) => scene.volume === 0)).toBe(true)
  })

  it('leaves manually placed b-roll exactly where it was', () => {
    const before = realProject()
    const next = applyAutoBroll(before, [placement()])
    expect(next.scenes.filter((scene) => scene.trackId === 'video-engine-broll'))
      .toEqual(before.scenes.filter((scene) => scene.trackId === 'video-engine-broll'))
    expect(next.tracks.some((track) => track.id === 'video-engine-broll')).toBe(true)
    expect(next.assets.some((asset) => asset.id === 'manual-asset')).toBe(true)
    // The input project is untouched, which is what makes one undo restore it whole.
    expect(before.scenes).toHaveLength(1)
    expect(before.tracks).toHaveLength(2)
  })

  it('adds to the lane on a second run instead of creating another one', () => {
    const first = applyAutoBroll(realProject(), [placement()])
    const second = applyAutoBroll(first, [placement({ startFrame: 1200, asset: { id: 'broll:bbbbbbbb', name: 'Other', kind: 'video', uri: 'file:///b.mp4', durationFrames: 360 } })])
    expect(second.tracks.filter((track) => track.id === 'auto-broll')).toHaveLength(1)
    expect(second.scenes.filter((scene) => scene.trackId === 'auto-broll')).toHaveLength(2)
    expect(second.assets.filter((asset) => asset.id.startsWith('broll:'))).toHaveLength(2)
  })

  it('never adds the same asset twice', () => {
    const next = applyAutoBroll(realProject(), [placement(), placement({ startFrame: 900 })])
    expect(next.assets.filter((asset) => asset.id === 'broll:aaaaaaaa')).toHaveLength(1)
  })

  it('clamps a clip and its source range to the asset the engine will validate against', () => {
    const next = applyAutoBroll(realProject(), [
      placement({
        durationFrames: 900,
        sourceRange: { startFrame: 0, durationFrames: 900 },
        asset: { id: 'broll:cccccccc', name: 'Short', kind: 'video', uri: 'file:///c.mp4', durationFrames: 200 }
      })
    ])
    const scene = next.scenes.find((candidate) => candidate.trackId === 'auto-broll')!
    expect(scene.durationFrames).toBe(200)
    expect(scene.sourceRange).toEqual({ startFrame: 0, durationFrames: 200 })
  })

  it('produces a project the engine accepts, canvas grown to cover the run', () => {
    const spliced = applyAutoBroll(realProject(), [placement({ startFrame: 3550, durationFrames: 120 })])
    const grown = withCanvasCoveringContent(spliced)
    expect(grown.canvas.durationFrames).toBe(3670)
    expect(() => VideoProjectSchema.parse(grown)).not.toThrow()
  })

  it('declines an empty run so it never lands in the undo stack', () => {
    const before = realProject()
    expect(applyAutoBroll(before, [])).toBe(before)
  })
})
