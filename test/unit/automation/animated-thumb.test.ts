import { describe, it, expect } from 'vitest'

describe('AnimatedThumb shell', () => {
  it('exports CaptionThumb', async () => {
    const mod = await import('../../../src/features/automation/AnimatedThumb/CaptionThumb')
    expect(mod.CaptionThumb).toBeDefined()
  })

  it('exports TransitionThumb', async () => {
    const mod = await import('../../../src/features/automation/AnimatedThumb/TransitionThumb')
    expect(mod.TransitionThumb).toBeDefined()
  })

  it('exports GradeThumb', async () => {
    const mod = await import('../../../src/features/automation/AnimatedThumb/GradeThumb')
    expect(mod.GradeThumb).toBeDefined()
  })

  it('exports HookThumb', async () => {
    const mod = await import('../../../src/features/automation/AnimatedThumb/HookThumb')
    expect(mod.HookThumb).toBeDefined()
  })
})
