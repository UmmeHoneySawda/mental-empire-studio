import { beforeEach, describe, expect, it } from 'vitest'
import { useData } from '../../src/store/useData'
import type { Project, ProjectImage, TranscriptWord } from '../../shared/types'

function project(id = 'proj-dl-video1'): Project {
  return {
    id,
    downloadId: 'dl-video1',
    title: 'Title',
    channel: 'Channel',
    mp3Path: 'audio.mp3',
    durationSec: 60,
    imageMode: 'sequence',
    poolSize: 1,
    kenBurns: false,
    seed: 1,
    crossfade: 0,
    captionPreset: 'Hormozi',
    captionFont: 'Anton',
    captionAnim: 'Pop-in',
    captionAspect: '16:9',
    emphasis: true,
    keywords: true,
    punchZoom: false,
    stage: 'composing',
    createdAt: ''
  }
}

function image(id = 'img-1'): ProjectImage {
  return { id, projectId: 'proj-dl-video1', ord: 0, path: 'image.jpg', thumb: 'image-small.jpg', rangeStart: 0, rangeEnd: 60, manual: false }
}

function word(id = 'w-1'): TranscriptWord {
  return { id, projectId: 'proj-dl-video1', ord: 0, word: 'Hello', start: 0, end: 0.4, emphasis: false }
}

describe('preview-safe project refresh', () => {
  beforeEach(() => {
    useData.setState({
      activeProject: project(),
      projectImages: [image()],
      transcript: [word()],
      transcribeError: 'old error',
      transcribeMessage: 'old message'
    })
  })

  it('preserves non-empty editor assets when a preview refresh returns empty arrays', async () => {
    ;(globalThis as unknown as { window: unknown }).window = {
      api: {
        compose: {
          get: async () => project(),
          images: async () => []
        },
        transcribe: {
          get: async () => []
        }
      }
    }

    await useData.getState().refreshActiveProjectSnapshot('proj-dl-video1')

    expect(useData.getState().projectImages).toEqual([image()])
    expect(useData.getState().transcript).toEqual([word()])
    expect(useData.getState().transcribeError).toBe('')
    expect(useData.getState().transcribeMessage).toBe('')
  })

  it('accepts refreshed assets when the native bridge returns non-empty arrays', async () => {
    const nextImage = image('img-2')
    const nextWord = word('w-2')
    ;(globalThis as unknown as { window: unknown }).window = {
      api: {
        compose: {
          get: async () => project(),
          images: async () => [nextImage]
        },
        transcribe: {
          get: async () => [nextWord]
        }
      }
    }

    await useData.getState().refreshActiveProjectSnapshot('proj-dl-video1')

    expect(useData.getState().projectImages).toEqual([nextImage])
    expect(useData.getState().transcript).toEqual([nextWord])
  })
})
