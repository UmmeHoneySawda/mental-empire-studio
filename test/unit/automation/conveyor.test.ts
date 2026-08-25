import { describe, it, expect } from 'vitest'
describe('Conveyor mapping', () => {
  it('maps job status to tp-mark', async () => {
    const { statusToMark } = await import('../../../src/features/automation/Conveyor')
    expect(statusToMark('running')).toBe('active')
    expect(statusToMark('completed')).toBe('done')
    expect(statusToMark('failed')).toBe('void')
    expect(statusToMark('queued')).toBe('queued')
  })
})
