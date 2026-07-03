import { describe, expect, it } from 'vitest'
import type { ProjectImage, TranscriptWord } from '@shared/types'
import { buildBrollTimeline, buildCaptionTimeline, buildVisualTimeline, clampTimelineSec, rangeToPct } from '../../src/features/video-editor/timelineModel'
import { previewImagesKey } from '../../src/features/video-editor/previewKeys'

function image(patch: Partial<ProjectImage>): ProjectImage {
  return {
    id: 'img-1',
    projectId: 'p',
    ord: 0,
    path: 'C:/assets/first image.png',
    thumb: '',
    rangeStart: 0,
    rangeEnd: 5,
    manual: false,
    ...patch
  }
}

function word(patch: Partial<TranscriptWord>): TranscriptWord {
  return {
    id: 'w-1',
    projectId: 'p',
    ord: 0,
    word: 'Focus',
    start: 1,
    end: 1.4,
    emphasis: false,
    ...patch
  }
}

describe('video timeline model', () => {
  it('clamps playhead time to the project duration', () => {
    expect(clampTimelineSec(-4, 10)).toBe(0)
    expect(clampTimelineSec(12, 10)).toBe(10)
    expect(clampTimelineSec(4, 10)).toBe(4)
  })

  it('converts ranges to safe percentages inside the track', () => {
    expect(rangeToPct(2, 5, 10)).toEqual({ leftPct: 20, widthPct: 30 })
    const tail = rangeToPct(10, 12, 10)
    expect(tail.leftPct).toBeLessThan(100)
    expect(tail.leftPct + tail.widthPct).toBeLessThanOrEqual(100)
  })

  it('builds image timeline blocks from project image ranges', () => {
    const blocks = buildVisualTimeline([image({ rangeStart: 0, rangeEnd: 4 })], 8)
    expect(blocks[0]).toMatchObject({
      id: 'img-1',
      label: 'first image.png',
      kind: 'image',
      startSec: 0,
      endSec: 4,
      leftPct: 0,
      widthPct: 50
    })
  })

  it('builds b-roll video blocks from preview render segments', () => {
    const blocks = buildBrollTimeline([
      { path: 'C:/assets/cache/clip one.mp4', startSec: 2, endSec: 7 },
      { path: 'C:/assets/cache/clip two.mp4', startSec: 7, endSec: 12 }
    ], 12)

    expect(blocks[0]).toMatchObject({
      id: 'broll-0',
      label: 'clip one.mp4',
      kind: 'broll',
      badge: 'video',
      startSec: 2,
      endSec: 7
    })
    expect(blocks[1].leftPct + blocks[1].widthPct).toBeLessThanOrEqual(100)
  })

  it('includes per-image motion overrides in the live-preview image key', () => {
    const auto = previewImagesKey([image({ motionPreset: null })])
    const staticImage = previewImagesKey([image({ motionPreset: 'off' })])
    const cinematicImage = previewImagesKey([image({ motionPreset: 'cinematic' })])
    const directedImage = previewImagesKey([image({ motionPreset: 'cinematic', motionDirection: 'left', motionAmount: 70 })])

    expect(auto).not.toBe(staticImage)
    expect(staticImage).not.toBe(cinematicImage)
    expect(cinematicImage).not.toBe(directedImage)
  })

  it('builds caption word blocks with a minimum visible span', () => {
    const blocks = buildCaptionTimeline([word({ start: 9.98, end: 9.98 })], 10)
    expect(blocks[0].startSec).toBeLessThan(10)
    expect(blocks[0].endSec).toBe(10)
    expect(blocks[0].leftPct + blocks[0].widthPct).toBeLessThanOrEqual(100)
  })
})
