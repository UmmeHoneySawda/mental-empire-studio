import type { RenderProgress, RenderQueueRow, RenderStatus } from '@shared/types'

export interface RenderLiveState {
  pct: number
  status: RenderStatus
  progress?: RenderProgress
}

/**
 * Persisted idle/terminal state wins over stale in-memory progress. This prevents
 * a missed final progress event from keeping the UI visually stuck at "rendering"
 * after the DB row has already been refreshed to done/error/queued.
 */
export function renderLiveState(row: RenderQueueRow, progress?: RenderProgress): RenderLiveState {
  if (row.job.status !== 'rendering') return { pct: row.job.pct, status: row.job.status }
  if (!progress) return { pct: row.job.pct, status: row.job.status }
  return {
    pct: progress.pct,
    status: progress.done ? (progress.error ? 'error' : 'done') : 'rendering',
    progress
  }
}

export function dropIdleRenderProgress(
  rows: RenderQueueRow[],
  progress: Record<string, RenderProgress>
): Record<string, RenderProgress> {
  const idle = new Set(rows.filter((r) => r.job.status !== 'rendering').map((r) => r.job.id))
  if (!idle.size) return progress
  let changed = false
  const next = { ...progress }
  for (const id of idle) {
    if (id in next) {
      delete next[id]
      changed = true
    }
  }
  return changed ? next : progress
}
