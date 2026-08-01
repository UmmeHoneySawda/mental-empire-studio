import { describe, expect, it } from 'vitest'
import type { VideoProject, VideoScene, VideoTransition } from '../../../shared/video-engine'
import { buildRemotionTransitionChains } from '../../../video-engine/remotion/timeline'
import { SUPPORTED_REMOTION_TRANSITIONS } from '../../../video-engine/remotion/constants'

/* Which transitions actually reach `TransitionSeries`.
 *
 * `zoom`, `blur` and `dip-to-black` were implemented in transition.tsx, listed in
 * SUPPORTED_REMOTION_TRANSITIONS, accepted by preflight and offered in the inspector — and
 * silently dropped here, because the chain builder's type test was a hand-written
 * `fade | slide | wipe`. Their scenes fell through to the standalone branch and rendered as
 * a plain overlap: no animation, no warning, in the player and in a headless render alike.
 *
 * These tests exist so the two lists cannot drift apart again. */

const fps = 30

function project(type: VideoTransition['type'], durationFrames = 15): VideoProject {
  const from: VideoScene = {
    id: 'a',
    kind: 'solid',
    trackId: 'v1',
    startFrame: 0,
    durationFrames: 90,
    zIndex: 0,
    color: '#111111'
  } as VideoScene
  const to: VideoScene = {
    ...from,
    id: 'b',
    // TransitionSeries lays the destination over the tail of the source, and
    // `isTransitionTimelineAligned` insists the timeline already describes that overlap.
    startFrame: 90 - durationFrames
  } as VideoScene
  const transition = {
    id: 't1',
    type,
    fromSceneId: 'a',
    toSceneId: 'b',
    startFrame: 90 - durationFrames,
    durationFrames,
    easing: 'linear'
  } as VideoTransition

  return {
    id: 'p1',
    rendererId: 'remotion',
    name: 'p',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: { width: 1920, height: 1080, fps, durationFrames: 600, backgroundColor: '#000000' },
    tracks: [{ id: 'v1', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false }],
    assets: [],
    scenes: [from, to],
    transitions: [transition],
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

const animated = SUPPORTED_REMOTION_TRANSITIONS.filter((type) => type !== 'cut')

describe('every animated transition the renderer supports forms a chain', () => {
  it.each(animated)('%s builds a TransitionSeries chain', (type) => {
    const chains = buildRemotionTransitionChains(project(type as VideoTransition['type']))
    expect(chains).toHaveLength(1)
    expect(chains[0]!.scenes.map((scene) => scene.id)).toEqual(['a', 'b'])
    expect(chains[0]!.transitions.map((transition) => transition.type)).toEqual([type])
  })

  it('includes the three that used to be dropped', () => {
    // Named explicitly: this is the regression, and `animated` deriving from the same
    // constant would still pass if someone shortened that constant.
    for (const type of ['zoom', 'blur', 'dip-to-black'] as const) {
      expect(buildRemotionTransitionChains(project(type))).toHaveLength(1)
    }
  })
})

describe('what must still not form a chain', () => {
  it('a cut has no presentation, so it stays two absolute scenes', () => {
    expect(buildRemotionTransitionChains(project('cut', 0))).toHaveLength(0)
  })

  it('a zero-length animated transition is not a transition', () => {
    expect(buildRemotionTransitionChains(project('fade', 0))).toHaveLength(0)
  })

  it('a transition whose scenes do not actually overlap is left alone', () => {
    const misaligned = project('fade', 15)
    const scenes = [...misaligned.scenes]
    scenes[1] = { ...scenes[1]!, startFrame: 120 }
    expect(
      buildRemotionTransitionChains({ ...misaligned, scenes } as VideoProject)
    ).toHaveLength(0)
  })
})
