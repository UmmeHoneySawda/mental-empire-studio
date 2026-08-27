import { describe, it, expect } from 'vitest'
import { resolveTemplatePreview, aspectToCanvas } from '../../../src/features/automation/templatePreviewModel'
import type { VisualTemplate } from '../../../shared/types'

function baseTemplate(over: Partial<VisualTemplate> = {}): VisualTemplate {
  return {
    id: 't1',
    name: 'Test',
    mode: 'Image slideshow',
    imagePaths: ['/tmp/a.jpg'],
    imageDurationSec: 5,
    density: 'Full',
    order: 'In order',
    motion: 'Static',
    transition: 'cut',
    grade: 'Cinematic',
    captionStyle: 'highlight',
    aspectRatio: '16:9',
    hookLine: 'hello',
    zoomAtStart: false,
    filterPresetId: 'neutral',
    adjust: undefined,
    effectsPresetIds: [],
    captionTemplateId: '',
    captionProps: {},
    hookTemplateId: '',
    hookProps: {},
    hookSeconds: 0,
    ...over,
  } as VisualTemplate
}

describe('resolveTemplatePreview', () => {
  it('Noir and Cinematic produce identical grading (preview tells truth)', () => {
    const a = resolveTemplatePreview(baseTemplate({ grade: 'Noir' }))
    const b = resolveTemplatePreview(baseTemplate({ grade: 'Cinematic' }))
    expect(a.grading).toEqual(b.grading)
  })

  it('Gold and Heartfelt produce identical grading', () => {
    const a = resolveTemplatePreview(baseTemplate({ grade: 'Gold' }))
    const b = resolveTemplatePreview(baseTemplate({ grade: 'Heartfelt' }))
    expect(a.grading).toEqual(b.grading)
  })

  it('Intense differs from Cinematic when no filter overrides grade', () => {
    const a = resolveTemplatePreview(baseTemplate({ grade: 'Intense', filterPresetId: undefined as any }))
    const b = resolveTemplatePreview(baseTemplate({ grade: 'Cinematic', filterPresetId: undefined as any }))
    expect(a.grading).not.toEqual(b.grading)
  })

  it('filterPresetId changes grading', () => {
    const neutral = resolveTemplatePreview(baseTemplate({ filterPresetId: 'neutral' }))
    const noir = resolveTemplatePreview(baseTemplate({ filterPresetId: 'noir' }))
    expect(neutral.grading).not.toEqual(noir.grading)
  })

  it('adjust overrides grading', () => {
    const base = resolveTemplatePreview(baseTemplate({ adjust: undefined }))
    const withAdjust = resolveTemplatePreview(baseTemplate({ adjust: { exposure: 0.5 } as any }))
    expect(withAdjust.grading.exposure).toBe(0.5)
    expect(base.grading.exposure).not.toBe(0.5)
  })

  it('effectsPresetIds add grain', () => {
    const base = resolveTemplatePreview(baseTemplate({ effectsPresetIds: [] }))
    const withGrain = resolveTemplatePreview(baseTemplate({ effectsPresetIds: ['grain-heavy'] }))
    expect(withGrain.grading.grain).toBeGreaterThan(base.grading.grain)
    expect(withGrain.caveat).toMatch(/grain/)
  })

  it('backdrop is broll for Auto B-roll', () => {
    expect(resolveTemplatePreview(baseTemplate({ mode: 'Auto B-roll' as any })).backdrop.kind).toBe('broll')
  })

  it('backdrop is image when pool has path', () => {
    const m = resolveTemplatePreview(baseTemplate({ mode: 'Image slideshow' as any, imagePaths: ['/tmp/x.jpg'] }))
    expect(m.backdrop).toEqual({ kind: 'image', path: '/tmp/x.jpg' })
  })

  it('backdrop is empty when pool empty', () => {
    expect(resolveTemplatePreview(baseTemplate({ mode: 'Image slideshow' as any, imagePaths: [] })).backdrop.kind).toBe('empty')
  })

  it('caption resolves cinematic vs classic', () => {
    const cinematic = resolveTemplatePreview(baseTemplate({ captionTemplateId: 'remotion-caption-cine-word-pop' }))
    expect(cinematic.caption.isCinematic).toBe(true)
    const classic = resolveTemplatePreview(baseTemplate({ captionStyle: 'highlight', captionTemplateId: '' }))
    expect(classic.caption.isCinematic).toBe(false)
    expect(classic.caption.definition).toBeDefined()
  })
})

describe('aspectToCanvas', () => {
  it('9:16 is portrait', () => {
    expect(aspectToCanvas('9:16')).toEqual({ width: 1080, height: 1920 })
  })
  it('1:1 is square', () => {
    expect(aspectToCanvas('1:1')).toEqual({ width: 1080, height: 1080 })
  })
  it('16:9 is landscape', () => {
    expect(aspectToCanvas('16:9')).toEqual({ width: 1920, height: 1080 })
  })
})
