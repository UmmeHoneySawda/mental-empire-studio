import { describe, it, expect } from 'vitest'
import { validateVisualTemplate } from '../../../src/features/automation/useAutomationDraft'

describe('validateVisualTemplate', () => {
  it('rejects empty name', () => {
    expect(
      validateVisualTemplate({
        id: 'tpl-1',
        name: '  ',
        mode: 'Auto B-roll',
        density: 'Full',
        order: 'Shuffle',
        motion: 'Cinematic',
        transition: 'crossfade',
        grade: 'Cinematic',
        captionStyle: 'highlight',
        aspectRatio: '9:16',
        hookLine: '',
        zoomAtStart: true
      } as any)
    ).toMatch(/name/i)
  })

  it('rejects empty image pool for slideshow', () => {
    expect(
      validateVisualTemplate({
        id: 'tpl-2',
        name: 'OK',
        mode: 'Image slideshow',
        imagePaths: [],
        density: 'Full',
        order: 'Shuffle',
        motion: 'Cinematic',
        transition: 'crossfade',
        grade: 'Cinematic',
        captionStyle: 'highlight',
        aspectRatio: '9:16',
        hookLine: '',
        zoomAtStart: true
      } as any)
    ).toMatch(/image/i)
  })

  it('passes valid template', () => {
    expect(
      validateVisualTemplate({
        id: 'tpl-3',
        name: 'Valid',
        mode: 'Auto B-roll',
        density: 'Full',
        order: 'Shuffle',
        motion: 'Cinematic',
        transition: 'crossfade',
        grade: 'Cinematic',
        captionStyle: 'highlight',
        aspectRatio: '9:16',
        hookLine: '',
        zoomAtStart: true
      } as any)
    ).toBe('')
  })
})
