import { describe, it, expect } from 'vitest'
describe('image pool dedup', () => {
  it('dedups canonical paths', async () => {
    const { mergeImagePaths } = await import('../../../src/features/automation/TemplateSheet')
    expect(mergeImagePaths(['/a.jpg', '/b.jpg'], ['/b.jpg', '/c.jpg'])).toEqual(['/a.jpg', '/b.jpg', '/c.jpg'])
  })
  it('handles empty existing', async () => {
    const { mergeImagePaths } = await import('../../../src/features/automation/useAutomationDraft')
    expect(mergeImagePaths([], ['/x.jpg'])).toEqual(['/x.jpg'])
  })
})
