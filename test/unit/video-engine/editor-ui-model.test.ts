import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_DESTINATIONS,
  EDIT_ACTIONS,
  EDITOR_DESTINATIONS,
  editActionState,
  isImmersiveVideoStudio,
  panelForAutomation,
  panelForDestination,
  previewAspectLabel,
  transcriptRows
} from '../../../src/features/video-studio/editor/editorUiModel'

describe('video editor UI model', () => {
  it('routes every reference destination to the existing editor panel that owns it', () => {
    expect(panelForDestination('media')).toBe('media')
    expect(panelForDestination('text')).toBe('text')
    expect(panelForDestination('transitions')).toBe('transitions')
    expect(panelForDestination('effects')).toBe('effects')
    expect(panelForDestination('filters')).toBe('grade')
    expect(panelForDestination('adjust')).toBe('grade')
    expect(panelForDestination('automation')).toBeNull()
  })

  it('routes every Sparkle workflow to its existing editor implementation', () => {
    expect(panelForAutomation('broll')).toBe('broll')
    expect(panelForAutomation('images')).toBe('media')
    expect(panelForAutomation('captions')).toBe('captions')
    expect(panelForAutomation('hooks')).toBe('hook')
  })

  it('enables only editing controls backed by current editor operations', () => {
    expect(editActionState('split', true, true).enabled).toBe(true)
    expect(editActionState('delete', false, true).enabled).toBe(false)
    expect(editActionState('snap', false, true)).toMatchObject({ enabled: true, active: true })
    expect(editActionState('link', true, true).reason).toBe('Not available in this editor version')
    expect(editActionState('group', true, true).enabled).toBe(false)
    expect(editActionState('keyframe', true, true).enabled).toBe(false)
  })

  it('hides the product sidebar only for an open Compose project', () => {
    expect(isImmersiveVideoStudio('compose', true)).toBe(true)
    expect(isImmersiveVideoStudio('compose', false)).toBe(false)
    expect(isImmersiveVideoStudio('home', true)).toBe(false)
  })

  it('keeps every reference destination and editing surface addressable', () => {
    expect(EDITOR_DESTINATIONS).toEqual([
      'media', 'automation', 'text', 'transitions', 'effects', 'filters', 'adjust'
    ])
    expect(AUTOMATION_DESTINATIONS).toEqual(['broll', 'images', 'captions', 'hooks'])
    expect(EDIT_ACTIONS).toEqual([
      'select', 'split', 'trim', 'delete', 'link', 'group', 'snap', 'keyframe'
    ])
  })

  it('shows the real reduced project aspect ratio in the preview chrome', () => {
    expect(previewAspectLabel({ width: 1920, height: 1080 })).toBe('16:9')
    expect(previewAspectLabel({ width: 1080, height: 1920 })).toBe('9:16')
    expect(previewAspectLabel({ width: 1080, height: 1080 })).toBe('1:1')
    expect(previewAspectLabel({ width: 0, height: 1080 })).toBe('—')
  })

  it('projects only valid real caption words into the transcript panel', () => {
    expect(transcriptRows({
      captions: {
        words: [
          { text: 'Cities', startFrame: 30, endFrame: 42 },
          { text: ' ', startFrame: 42, endFrame: 43 },
          { text: 'sleep', startFrame: 43, endFrame: 55 },
          { text: 'broken', startFrame: 80, endFrame: 70 }
        ]
      }
    })).toEqual([
      { text: 'Cities', startFrame: 30, endFrame: 42 },
      { text: 'sleep', startFrame: 43, endFrame: 55 }
    ])
    expect(transcriptRows({})).toEqual([])
  })
})
