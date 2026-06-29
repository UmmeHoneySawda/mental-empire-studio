import type { WorkItem } from '@shared/types'

// Pure helpers for the Channel Workspace board (P2). Kept dependency-free so the column
// classification + "Resume" selection are unit-testable and shared between the Workspace
// screen and the Library pipeline section.

export type WorkColumn = 'todo' | 'inprogress' | 'done'

export interface StageDef { key: keyof WorkItem; label: string }

/** The ordered pipeline stages shown as chips. */
export const WORK_STAGES: StageDef[] = [
  { key: 'downloaded', label: 'Audio' },
  { key: 'hasImages', label: 'Images' },
  { key: 'captioned', label: 'Captions' },
  { key: 'hasThumbnail', label: 'Thumb' },
  { key: 'rendered', label: 'Render' },
  { key: 'uploaded', label: 'Upload' }
]

/**
 * Which board column a work item belongs in:
 * - done: rendered (the video exists)
 * - inprogress: has real production work (images / captions / thumbnail) but isn't rendered
 * - todo: downloaded but nothing produced yet
 */
export function classifyWorkItem(w: WorkItem): WorkColumn {
  if (w.rendered) return 'done'
  if (w.hasImages || w.captioned || w.hasThumbnail) return 'inprogress'
  return 'todo'
}

/** How far through the pipeline an item is (0..5) — used to rank "most advanced". */
export function progressScore(w: WorkItem): number {
  return (
    (w.downloaded ? 1 : 0) +
    (w.hasImages ? 1 : 0) +
    (w.captioned ? 1 : 0) +
    (w.hasThumbnail ? 1 : 0) +
    (w.rendered ? 1 : 0)
  )
}

/**
 * The single most-advanced UNFINISHED item to resume (not rendered, not archived). Ties
 * keep input order (callers pass newest-relevant order). Returns null when nothing's left.
 */
export function resumeCandidate(items: WorkItem[]): WorkItem | null {
  let best: WorkItem | null = null
  let bestScore = -1
  for (const w of items) {
    if (w.archived || w.rendered) continue
    const s = progressScore(w)
    if (s > bestScore) { best = w; bestScore = s }
  }
  return best
}

/** The next screen + (optional) project to open for an item, given its progress. */
export function nextStepFor(w: WorkItem): { screen: 'render' | 'compose' | 'download'; openProjectId?: string } {
  if (w.rendered) return { screen: 'render' }
  if (w.downloaded && w.downloadId) return { screen: 'compose', openProjectId: w.downloadId }
  return { screen: 'download' }
}

/** Short label for the primary action button of an item. */
export function actionLabel(w: WorkItem): string {
  if (w.rendered) return 'Queue'
  if (w.downloaded) return 'Edit'
  return 'Download'
}
