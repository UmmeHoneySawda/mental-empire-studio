/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../electron/db', () => ({
  getRepos: () => ({
    tpJobs: () => [
      { id: 'j1', characterId: 'c-run', status: 'running' },
      { id: 'j2', characterId: 'c-pause', status: 'paused' }
    ],
    tpCharacters: () => [{ id: 'c1' }, { id: 'c2' }],
    deleteTpCharacter: vi.fn(),
    deleteTpJob: vi.fn()
  })
}))

describe('characterDeleteBulk guard', () => {
  it('blocks when any selected id is in a running job', async () => {
    const mod = await import('../electron/ipc/talkingphotos')
    await expect(mod.__testDeleteBulk(['c-run'])).rejects.toThrow('running')
  })
  it('allows paused jobs but returns their ids for confirm', async () => {
    const mod = await import('../electron/ipc/talkingphotos')
    const res = await mod.__testDeleteBulkDryRun(['c-pause'])
    expect(res.pausedJobIds).toEqual(['j2'])
  })
})
