import { describe, it, expect } from 'vitest'
describe('TemplateSheet', () => {
  it('exports TemplateSheet', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    expect(TemplateSheet).toBeDefined()
  })
})
