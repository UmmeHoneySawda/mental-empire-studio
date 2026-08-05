import { getRepos } from '../db'
import { matchUploads } from '../../shared/match'
import { getSettings } from '../store/settings'
import { sentryLog } from './sentry'

// Upload detection (workflow plan §2.2a): figure out which processed source videos have
// already been published on one of the user's own channels, by fuzzy-matching titles
// against the uploads we already scrape for My Channels. No extra API calls — it just
// joins data already in the DB. Idempotent; safe to run after any scrape.

function confidenceBand(): { floor: number; threshold: number } {
  const [rawFloor, rawThreshold] = getSettings().detection?.confirmBand ?? [0.6, 0.82]
  const floor = Number.isFinite(rawFloor) ? Math.max(0, Math.min(1, rawFloor)) : 0.6
  const threshold = Number.isFinite(rawThreshold) ? Math.max(0, Math.min(1, rawThreshold)) : 0.82
  return { floor: Math.min(floor, threshold), threshold: Math.max(floor, threshold) }
}

export interface UploadDetectionOpts {
  /** run even when settings.detection.auto is off (the manual "Check uploads" action) */
  force?: boolean
  /** what caused this run — lands on every event so triggers can be compared in Sentry */
  trigger?: 'download' | 'scrape' | 'render' | 'manual'
  /** extra snake_case attributes for the wide event, e.g. { job_id } */
  context?: Record<string, unknown>
}

/**
 * Match every work item's title against all my-channel uploads; persist the results.
 * Returns the number of items detected as uploaded.
 *
 * **Never throws.** Detection is advisory — it must not fail the download/scrape/render it
 * hangs off — so the failure path is owned here rather than by each caller. It used to be a
 * bare `catch {}` at three call sites, which made a throw completely invisible and left the
 * stale status it caused unexplainable; a fourth call site (`workItems:detect`) had no catch
 * at all. Being non-throwing is now a property of the function, not a rule callers re-implement.
 */
export function runUploadDetection(opts: UploadDetectionOpts = {}): number {
  // Wide event on every exit. "Ran and matched nothing", "declined to run" and "threw" are
  // otherwise indistinguishable from outside, and the difference is the whole diagnosis when a
  // card shows the wrong upload status. `skipped_reason` is the field that separates them.
  const done = (matched: number, attrs: Record<string, unknown>): number => {
    sentryLog.info('Upload detection finished', {
      operation: 'upload_detection',
      trigger: opts.trigger ?? 'unknown',
      forced: !!opts.force,
      // Defaulted here, not at the success call site, so every event carries the field
      // structurally rather than by convention. Skip paths override it via the spread.
      skipped_reason: 'none',
      matched,
      ...opts.context,
      ...attrs
    })
    return matched
  }
  try {
    if (!opts.force && getSettings().detection?.auto === false) return done(0, { skipped_reason: 'auto_detection_off' })
    const repos = getRepos()
    const items = repos.workItems().map((w) => ({ videoId: w.videoId, title: w.title }))
    const uploads = repos.allUploadsForMatch()
    if (!items.length) return done(0, { skipped_reason: 'no_work_items', items_seen: 0, uploads_seen: uploads.length })
    if (!uploads.length) {
      // Note this still WRITES: every item is reset to "not uploaded". A never-scraped or
      // stale owned channel therefore erases previous detections rather than leaving them.
      repos.setDetectedUploads(items.map((item) => ({ videoId: item.videoId, uploadedTo: [], score: 0, confidence: null })))
      return done(0, { skipped_reason: 'no_uploads_scraped', items_seen: items.length, uploads_seen: 0, cleared: items.length })
    }
    const { floor, threshold } = confidenceBand()
    const matches = matchUploads(items, uploads, threshold, floor)
    const byId = new Map(matches.map((m) => [m.videoId, m]))
    repos.setDetectedUploads(items.map((item) => byId.get(item.videoId) ?? {
      videoId: item.videoId,
      uploadedTo: [],
      score: 0,
      confidence: null
    }))
    return done(matches.length, {
      items_seen: items.length,
      uploads_seen: uploads.length,
      pending: matches.filter((m) => m.confidence === 'pending').length,
      threshold,
      floor
    })
  } catch (e) {
    sentryLog.warn('Upload detection threw', {
      operation: 'upload_detection',
      trigger: opts.trigger ?? 'unknown',
      outcome: 'threw',
      ...opts.context,
      error_message: (e as Error).message
    })
    return 0
  }
}
