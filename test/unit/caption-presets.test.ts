import { describe, expect, it } from 'vitest'
import { CAPTION_PRESETS, QUICK_CAPTION_PRESETS, captionPresetPatch } from '../../src/features/compose/gallery/captionPresets'

describe('captionPresetPatch', () => {
  it('keeps ordinary presets to the selected preset only', () => {
    expect(captionPresetPatch({ captionFont: 'Montserrat' }, 'Pop')).toEqual({ captionPreset: 'Pop' })
  })

  it('applies Submagic defaults without needing duplicate UI logic', () => {
    expect(captionPresetPatch(null, 'Submagic')).toEqual({
      captionPreset: 'Submagic',
      captionPace: 'word',
      captionLines: 1,
      captionFont: 'Anton',
      captionHighlightColor: '#111111',
      captionBoxColor: '#ffd93d',
      captionWordsPerPage: 1
    })
  })

  it('preserves existing Submagic colors and words-per-page choices', () => {
    expect(captionPresetPatch({
      captionFont: 'Impact',
      captionHighlightColor: '#222222',
      captionBoxColor: '#00ff00',
      captionWordsPerPage: 3
    }, 'Submagic')).toMatchObject({
      captionFont: 'Impact',
      captionHighlightColor: '#222222',
      captionBoxColor: '#00ff00',
      captionWordsPerPage: 3
    })
  })

  it('exports the full and quick preset sets used by the galleries', () => {
    expect(CAPTION_PRESETS).toContain('Submagic')
    expect(QUICK_CAPTION_PRESETS).toEqual(['Hormozi', 'Submagic', 'Pop', 'Minimal'])
  })
})
