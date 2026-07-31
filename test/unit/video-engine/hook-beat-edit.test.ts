import { describe, expect, it } from 'vitest'
import {
  applyHookBeatPatch,
  buildHookPlanPrompt,
  HookPlanSchema,
  remapImportantWordIds,
  rescaleHookPlan,
  type HookPlan
} from '../../../shared/video-engine/hook-plan'

// Editing one beat has to keep the whole plan valid: beats stay ordered and
// non-overlapping, nothing runs past the plan's end, and emphasis marks never point at a
// word that is no longer there. HookPlanSchema is the spec — every helper here returns a
// parsed plan, so an edit that cannot be made valid throws instead of being persisted.

const FPS = 30

function plan(overrides: Partial<HookPlan> = {}): HookPlan {
  return HookPlanSchema.parse({
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: 'remotion-hook-bold',
    fps: FPS,
    title: 'Why narcissists go quiet',
    durationFrames: 300,
    beats: [
      { id: 'beat-1', startFrame: 0, durationFrames: 100, headline: 'They go quiet', visual: { kind: 'none' } },
      { id: 'beat-2', startFrame: 100, durationFrames: 100, headline: 'It is not peace', visual: { kind: 'none' } },
      { id: 'beat-3', startFrame: 200, durationFrames: 100, headline: 'It is a tactic', visual: { kind: 'none' } }
    ],
    ...overrides
  })
}

describe('applyHookBeatPatch — text', () => {
  it('rewrites a headline without touching timing', () => {
    const next = applyHookBeatPatch(plan(), 'beat-2', { headline: 'Silence is the point' })
    expect(next.beats[1]!.headline).toBe('Silence is the point')
    expect(next.beats.map((beat) => beat.startFrame)).toEqual([0, 100, 200])
    expect(next.durationFrames).toBe(300)
  })

  it('deletes the key when a field is emptied, rather than saving an empty string', () => {
    // HookBeatSchema requires a non-empty string when the field is present, so '' would
    // fail validation outright.
    const next = applyHookBeatPatch(plan(), 'beat-1', { headline: '   ' })
    expect(next.beats[0]!.headline).toBeUndefined()
  })

  it('trims surrounding whitespace', () => {
    const next = applyHookBeatPatch(plan(), 'beat-1', { headline: '  spaced  ' })
    expect(next.beats[0]!.headline).toBe('spaced')
  })

  it('refuses an unknown beat', () => {
    expect(() => applyHookBeatPatch(plan(), 'beat-9', { headline: 'x' })).toThrow(/unknown hook beat/i)
  })
})

describe('applyHookBeatPatch — timing ripple', () => {
  it('shifts every later beat when one grows', () => {
    const next = applyHookBeatPatch(plan(), 'beat-1', { durationFrames: 160 })
    expect(next.beats.map((beat) => beat.startFrame)).toEqual([0, 160, 260])
    expect(next.durationFrames).toBe(360)
  })

  it('shifts every later beat back when one shrinks', () => {
    const next = applyHookBeatPatch(plan(), 'beat-1', { durationFrames: 40 })
    expect(next.beats.map((beat) => beat.startFrame)).toEqual([0, 40, 140])
    expect(next.durationFrames).toBe(240)
  })

  it('leaves the plan valid against its own schema after a ripple', () => {
    const next = applyHookBeatPatch(plan(), 'beat-2', { durationFrames: 250 })
    expect(() => HookPlanSchema.parse(next)).not.toThrow()
  })

  it('refuses a length that would push the hook past the 30-second ceiling', () => {
    expect(() => applyHookBeatPatch(plan(), 'beat-3', { durationFrames: 890 })).toThrow(/30s/i)
  })

  it('clamps a transition that would outlast its shortened beat', () => {
    const withTransition = plan({
      beats: [
        {
          id: 'beat-1',
          startFrame: 0,
          durationFrames: 100,
          headline: 'A',
          visual: { kind: 'none' },
          transitionOut: { type: 'fade', durationFrames: 40 }
        }
      ],
      durationFrames: 100
    })
    const next = applyHookBeatPatch(withTransition, 'beat-1', { durationFrames: 20 })
    expect(next.beats[0]!.transitionOut?.durationFrames).toBe(20)
  })
})

describe('remapImportantWordIds', () => {
  it('keeps ids that still point at a word', () => {
    const kept = remapImportantWordIds(
      ['beat-1:headline:0', 'beat-1:headline:2'],
      'beat-1',
      'headline',
      'one two three'
    )
    expect(kept).toEqual(['beat-1:headline:0', 'beat-1:headline:2'])
  })

  it('drops ids past the end of the shortened text', () => {
    const kept = remapImportantWordIds(
      ['beat-1:headline:0', 'beat-1:headline:4'],
      'beat-1',
      'headline',
      'one two'
    )
    expect(kept).toEqual(['beat-1:headline:0'])
  })

  it('leaves the other field alone', () => {
    const kept = remapImportantWordIds(['beat-1:body:3'], 'beat-1', 'headline', 'one')
    expect(kept).toEqual(['beat-1:body:3'])
  })

  it('drops the array entirely when nothing survives', () => {
    expect(remapImportantWordIds(['beat-1:headline:9'], 'beat-1', 'headline', 'one')).toBeUndefined()
  })

  it('is applied by the patch, so an edit cannot leave a dangling mark', () => {
    const marked = plan({
      beats: [{
        id: 'beat-1',
        startFrame: 0,
        durationFrames: 100,
        headline: 'one two three four',
        importantWordIds: ['beat-1:headline:3'],
        visual: { kind: 'none' }
      }],
      durationFrames: 100
    })
    const next = applyHookBeatPatch(marked, 'beat-1', { headline: 'one two' })
    expect(next.beats[0]!.importantWordIds).toBeUndefined()
  })
})

describe('rescaleHookPlan', () => {
  it('retimes a plan when the project frame rate changes', () => {
    const next = rescaleHookPlan(plan(), 60, 2)
    expect(next.fps).toBe(60)
    expect(next.beats.map((beat) => beat.startFrame)).toEqual([0, 200, 400])
    expect(next.beats.every((beat) => beat.durationFrames === 200)).toBe(true)
    expect(next.durationFrames).toBe(600)
  })

  it('produces a plan that still validates', () => {
    expect(() => HookPlanSchema.parse(rescaleHookPlan(plan(), 24, 24 / 30))).not.toThrow()
  })
})

describe('buildHookPlanPrompt', () => {
  it('states this project’s real fps in the example, not a hardcoded 30', () => {
    const prompt = buildHookPlanPrompt({
      rendererId: 'remotion',
      templateId: 'remotion-hook-bold',
      fps: 60,
      title: 'T',
      durationSeconds: 10
    })
    expect(prompt).toContain('"fps":60')
    expect(prompt).toContain('"durationFrames":600')
    expect(prompt).toContain('fps MUST be exactly 60')
    expect(prompt).not.toContain('"fps":30')
  })
})
