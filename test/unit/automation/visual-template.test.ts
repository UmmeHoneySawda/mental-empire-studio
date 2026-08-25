import { describe, it, expect } from 'vitest'
import { visualTemplateToStyleConfig } from '../../../shared/automationTemplate'

describe('visualTemplateToStyleConfig — new fields', () => {
  it('carries filter/adjust through', () => {
    const cfg = visualTemplateToStyleConfig({
      id: 'tpl-x',
      name: 'X',
      mode: 'Auto B-roll',
      density: 'Full',
      order: 'Shuffle',
      motion: 'Cinematic',
      transition: 'crossfade',
      grade: 'Cinematic',
      captionStyle: 'highlight',
      aspectRatio: '9:16',
      hookLine: '',
      zoomAtStart: true,
      filterPresetId: 'teal-orange',
      adjust: { enabled: true, lutIntensity: 1, exposure: 0.2, contrast: 0.1, saturation: 1.1, temperature: 0.05, tint: 0, vignette: 0, grain: 0.1 }
    } as any)
    expect(cfg.captionPreset).toBeTruthy()
    expect((cfg as any).filterPresetId).toBe('teal-orange')
    expect((cfg as any).adjust?.exposure).toBeCloseTo(0.2)
  })

  it('defaults legacy row without new fields', () => {
    const cfg = visualTemplateToStyleConfig({
      id: 'tpl-legacy',
      name: 'Legacy',
      mode: 'Auto B-roll',
      density: 'Full',
      order: 'In order',
      motion: 'Static',
      transition: 'cut',
      grade: 'Noir',
      captionStyle: 'highlight',
      aspectRatio: '16:9',
      hookLine: '',
      zoomAtStart: false
    } as any)
    expect(cfg.videoStyle).toBeDefined()
  })

  it('respects transitionDurationFrames', () => {
    const cfg = visualTemplateToStyleConfig({
      id: 'tpl-dur',
      name: 'Dur',
      mode: 'Auto B-roll',
      density: 'Full',
      order: 'In order',
      motion: 'Static',
      transition: 'crossfade',
      grade: 'Clean',
      captionStyle: 'highlight',
      aspectRatio: '16:9',
      hookLine: '',
      zoomAtStart: false,
      transitionDurationFrames: 15
    } as any)
    expect(cfg.crossfadeSec).toBeCloseTo(0.5, 1)
  })
})
