import { describe, it, expect } from 'vitest'

describe('Template preview components', () => {
  it('exports TemplatePreviewFrame', async () => {
    const mod = await import('../../../src/features/automation/TemplatePreviewFrame')
    expect(mod.TemplatePreviewFrame).toBeDefined()
  })

  it('exports TemplateLiveStage', async () => {
    const mod = await import('../../../src/features/automation/TemplateLiveStage')
    expect(mod.TemplateLiveStage).toBeDefined()
  })

  it('exports TransitionMicroThumb', async () => {
    const mod = await import('../../../src/features/automation/TransitionMicroThumb')
    expect(mod.TransitionMicroThumb).toBeDefined()
  })

  it('exports HookMicroThumb', async () => {
    const mod = await import('../../../src/features/automation/HookMicroThumb')
    expect(mod.HookMicroThumb).toBeDefined()
  })
})
