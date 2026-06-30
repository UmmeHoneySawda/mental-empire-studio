import { describe, expect, it } from 'vitest'
import { dropIdleRenderProgress, renderLiveState } from '../../src/lib/renderProgress'
import type { RenderProgress, RenderQueueRow, RenderStatus } from '../../shared/types'

function row(status: RenderStatus, pct = 0): RenderQueueRow {
  return {
    job: {
      id: `job-${status}`,
      title: 'Title',
      channel: 'Channel',
      status,
      pct,
      projectId: 'proj-1',
      createdAt: ''
    },
    images: 0,
    hasMp3: true,
    hasThumb: false,
    hasCaptions: false,
    isReady: true,
    missing: [],
    projectDurationSec: 10
  }
}

function progress(jobId: string, pct: number, done = false): RenderProgress {
  return { jobId, pct, stage: done ? 'done' : 'encoding', done }
}

describe('render progress UI state', () => {
  it('lets persisted terminal/idle status override stale live progress', () => {
    const done = row('done', 100)
    expect(renderLiveState(done, progress(done.job.id, 42)).status).toBe('done')
    expect(renderLiveState(done, progress(done.job.id, 42)).pct).toBe(100)

    const queued = row('queued', 0)
    expect(renderLiveState(queued, progress(queued.job.id, 64)).status).toBe('queued')
    expect(renderLiveState(queued, progress(queued.job.id, 64)).pct).toBe(0)
  })

  it('uses live progress only while the persisted row is rendering', () => {
    const active = row('rendering', 12)
    expect(renderLiveState(active, progress(active.job.id, 64))).toMatchObject({ status: 'rendering', pct: 64 })
  })

  it('drops live progress for rows no longer rendering', () => {
    const done = row('done', 100)
    const active = row('rendering', 12)
    const all = {
      [done.job.id]: progress(done.job.id, 42),
      [active.job.id]: progress(active.job.id, 64)
    }
    expect(dropIdleRenderProgress([done, active], all)).toEqual({ [active.job.id]: all[active.job.id] })
  })
})
