import { getRepos } from '../db'
import { matchUploads } from '../../shared/match'

// Upload detection (workflow plan §2.2a): figure out which processed source videos have
// already been published on one of the user's own channels, by fuzzy-matching titles
// against the uploads we already scrape for My Channels. No extra API calls — it just
// joins data already in the DB. Idempotent; safe to run after any scrape.

/** Match every work item's title against all my-channel uploads; persist the results.
 *  Returns the number of items detected as uploaded. */
export function runUploadDetection(): number {
  const repos = getRepos()
  const items = repos.workItems().map((w) => ({ videoId: w.videoId, title: w.title }))
  const uploads = repos.allUploadsForMatch()
  if (!items.length || !uploads.length) return 0
  const matches = matchUploads(items, uploads)
  if (matches.length) repos.setDetectedUploads(matches)
  return matches.length
}
