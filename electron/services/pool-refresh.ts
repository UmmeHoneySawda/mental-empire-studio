import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { warmBrollLibraryFromNiche, pruneNichePool, readNichePoolLastWarmed } from './broll'
import { nicheRefreshDue } from './niche'
import { logger } from './logger'

// Periodic niche b-roll pool maintenance (P4): top each due pool back up to its target
// from its keywords, then prune clips unused for a while. Runs from the scheduler tick
// (due-gated, so most ticks are no-ops) and on demand from the Niches screen.

const REFRESH_INTERVAL_HOURS = 24
const PRUNE_MAX_AGE_DAYS = 30
const POOL_LOG = logger.scope('pools')

let running = false

/** Warm + prune every niche pool that is due (or all, when forced). Returns how many
 *  pools were refreshed. Best-effort: a single niche failing never aborts the rest. */
export async function refreshNichePools(opts: { force?: boolean } = {}): Promise<number> {
  if (running) return 0
  running = true
  try {
    const niches = getRepos().niches()
    if (!niches.length) return 0
    const settings = getSettings()
    let refreshed = 0
    for (const niche of niches) {
      const due = opts.force || nicheRefreshDue(readNichePoolLastWarmed(niche.id), Date.now(), REFRESH_INTERVAL_HOURS)
      if (!due) continue
      try {
        await warmBrollLibraryFromNiche(settings, niche)
        const pruned = pruneNichePool(niche.id, PRUNE_MAX_AGE_DAYS)
        refreshed++
        if (pruned) POOL_LOG.info(`pruned ${pruned} stale clip(s) from niche=${niche.name}`)
      } catch (e) {
        POOL_LOG.warn(`pool refresh failed niche=${niche.name}: ${(e as Error).message}`)
      }
    }
    if (refreshed) POOL_LOG.info(`refreshed ${refreshed} niche pool(s)`)
    return refreshed
  } finally {
    running = false
  }
}
