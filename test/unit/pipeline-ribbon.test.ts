import { describe, expect, it } from 'vitest'
import {
  activePipelineStage,
  pipelineCompletedCount,
  pipelineNextAction,
  pipelineStateFrom
} from '../../src/lib/pipelineRibbon'
import type { WorkItem } from '../../shared/types'

function wi(over: Partial<WorkItem>): WorkItem {
  return {
    videoId: 'v',
    channel: 'C',
    title: 'T',
    downloadId: 'dl-v',
    projectId: 'proj-dl-v',
    downloaded: true,
    hasImages: false,
    captioned: false,
    hasThumbnail: false,
    rendered: false,
    uploaded: false,
    uploadedTo: [],
    uploadedManual: null,
    archived: false,
    ...over
  }
}

describe('pipeline ribbon helpers', () => {
  it('merges fresh screen snapshot state over stored work-item state', () => {
    const state = pipelineStateFrom(wi({ hasImages: false }), { hasImages: true })
    expect(state.hasImages).toBe(true)
    expect(pipelineCompletedCount(state)).toBe(2)
  })

  it('marks the first incomplete stage as active', () => {
    expect(activePipelineStage(pipelineStateFrom(wi({ hasImages: true })))).toBe('captioned')
    expect(activePipelineStage(pipelineStateFrom(wi({ hasImages: true, captioned: true, hasThumbnail: true, rendered: true, uploaded: true })))).toBe('uploaded')
  })

  it('routes missing media and captions back to compose', () => {
    expect(pipelineNextAction(pipelineStateFrom(wi({ hasImages: false })))).toMatchObject({
      label: 'Add images',
      screen: 'compose',
      openDownloadId: 'dl-v'
    })
    expect(pipelineNextAction(pipelineStateFrom(wi({ hasImages: true, captioned: false })))).toMatchObject({
      label: 'Fetch captions',
      screen: 'compose',
      openProjectId: 'proj-dl-v'
    })
  })

  it('routes thumbnail, render, and upload stages to their concrete screens', () => {
    expect(pipelineNextAction(pipelineStateFrom(wi({ hasImages: true, captioned: true })))).toMatchObject({ label: 'Make thumbnail', screen: 'thumb' })
    expect(pipelineNextAction(pipelineStateFrom(wi({ hasImages: true, captioned: true, hasThumbnail: true })))).toMatchObject({ label: 'Render video', screen: 'render' })
    expect(pipelineNextAction(pipelineStateFrom(wi({ hasImages: true, captioned: true, hasThumbnail: true, rendered: true })))).toMatchObject({ label: 'Review upload', screen: 'home' })
  })

  it('does not offer navigation after upload is complete', () => {
    const action = pipelineNextAction(pipelineStateFrom(wi({ hasImages: true, captioned: true, hasThumbnail: true, rendered: true, uploaded: true })))
    expect(action).toMatchObject({ label: 'Complete', complete: true })
  })
})
