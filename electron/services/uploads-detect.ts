import { getRepos } from '../db'
import { matchUploads } from '../../shared/match'
import { getSettings } from '../store/settings'

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

/** Match every work item's title against all my-channel uploads; persist the results.
 *  Returns the number of items detected as uploaded. */
export function runUploadDetection(opts: { force?: boolean } = {}): number {
  if (!opts.force && getSettings().detection?.auto === false) return 0
  const repos = getRepos()
  const items = repos.workItems().map((w) => ({ videoId: w.videoId, title: w.title }))
  const uploads = repos.allUploadsForMatch()
  if (!items.length) return 0
  if (!uploads.length) {
    repos.setDetectedUploads(items.map((item) => ({ videoId: item.videoId, uploadedTo: [], score: 0, confidence: null })))
    return 0
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
  return matches.length
}
