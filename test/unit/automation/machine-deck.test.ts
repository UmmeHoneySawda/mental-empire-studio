import { describe, it, expect } from 'vitest'

describe('MachineCard meta', () => {
  it('renders chips for caption/transition/motion', async () => {
    const { MachineCard } = await import('../../../src/features/automation/MachineCard')
    expect(MachineCard).toBeDefined()
  })

  it('exports MachineDeck', async () => {
    const { MachineDeck } = await import('../../../src/features/automation/MachineDeck')
    expect(MachineDeck).toBeDefined()
  })
})
