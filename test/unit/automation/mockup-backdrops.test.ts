import { describe, it, expect } from 'vitest'
import { getMockupBackdrop, CINEMATIC_PORTRAIT_MOCKUP } from '../../../src/features/automation/mockupBackdrops'
import { previewUrlForPath } from '../../../src/features/video-studio/editor/assetUrl'

describe('mockupBackdrops', () => {
  it('returns pool image when available and mode is Image slideshow', () => {
    const testPath = 'C:/test/photo.jpg'
    const res = getMockupBackdrop('Image slideshow', [testPath])
    expect(res.isMockup).toBe(false)
    expect(res.label).toBe('Pool image')
    expect(res.uri).toBe(previewUrlForPath(testPath))
  })

  it('returns high-quality photographic mockup when mode is Auto B-roll', () => {
    const brollRes = getMockupBackdrop('Auto B-roll', ['C:/test/photo.jpg'])
    expect(brollRes.isMockup).toBe(true)
    expect(brollRes.label).toBe('Auto B-roll sample')
    expect(brollRes.uri).toBe(CINEMATIC_PORTRAIT_MOCKUP)
    expect(brollRes.uri.length).toBeGreaterThan(50)
  })

  it('returns sample preview mockup when pool is empty or undefined', () => {
    const emptyRes = getMockupBackdrop('Image slideshow', [])
    expect(emptyRes.isMockup).toBe(true)
    expect(emptyRes.label).toBe('Sample preview')
    expect(emptyRes.uri).toBe(CINEMATIC_PORTRAIT_MOCKUP)

    const undefRes = getMockupBackdrop('Image slideshow', undefined)
    expect(undefRes.isMockup).toBe(true)
    expect(undefRes.label).toBe('Sample preview')
    expect(undefRes.uri).toBe(CINEMATIC_PORTRAIT_MOCKUP)
  })
})

