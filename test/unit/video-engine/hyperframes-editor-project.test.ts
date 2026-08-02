import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_GRADING,
  type VideoProject,
} from '../../../shared/video-engine'
import { normalizeEditorProject } from '../../../src/features/video-studio/editor/rendererSession'

function project(): VideoProject {
  return {
    schemaVersion: 1,
    id: 'hyperframes-editor-project',
    name: 'HyperFrames editor project',
    revision: 0,
    rendererId: 'hyperframes',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 300,
      backgroundColor: '#000000',
    },
    assets: [],
    tracks: [{
      id: 'overlay-track',
      name: 'Overlay',
      kind: 'overlay',
      order: 1,
      muted: false,
      locked: false,
    }],
    scenes: [{
      id: 'title',
      trackId: 'overlay-track',
      kind: 'text',
      startFrame: 0,
      durationFrames: 90,
      zIndex: 1,
      text: 'Renderer-native text',
      template: {
        id: 'remotion-text-heading',
        version: '1.0.0',
        rendererId: 'remotion',
        props: { animation: 'rise' },
      },
    }],
    transitions: [],
    grading: { ...DEFAULT_VIDEO_GRADING },
  }
}

describe('HyperFrames shared editor project normalization', () => {
  it('converts Remotion text presets before save and preflight', () => {
    const normalized = normalizeEditorProject(project(), 'hyperframes')

    expect(normalized.scenes[0]?.template).toEqual(expect.objectContaining({
      id: 'hyperframes-text-heading',
      rendererId: 'hyperframes',
    }))
  })

  it('preserves identity when the project is already renderer-native', () => {
    const original = normalizeEditorProject(project(), 'hyperframes')
    expect(normalizeEditorProject(original, 'hyperframes')).toBe(original)
  })
})
