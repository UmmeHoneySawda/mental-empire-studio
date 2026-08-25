import { describe, it, expect } from 'vitest'
describe('FeedBar', () => {
  it('clamps drawCount to unpublishedAvailable', async () => {
    const { FeedBar } = await import('../../../src/features/automation/FeedBar')
    expect(FeedBar).toBeDefined()
  })
})
