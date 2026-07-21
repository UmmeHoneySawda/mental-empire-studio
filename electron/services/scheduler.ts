import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { sourceVideos, checkReminders } from '../ipc/scrape'
import { newVideos, runSource } from '../ipc/automation'
import { refreshNichePools } from './pool-refresh'
import { hhmm, pushActivity } from '../ipc/events'
import { logger } from './logger'
import { sentryLog } from './sentry'

// Auto-watch scheduler (Workflow P5). On each tick it checks every watched source
// for new uploads and runs the source-owned automation hands-free. Runs in the main
// process while the app is alive (the tray keeps it alive).

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const SCHED_LOG = logger.scope('scheduler')

/** Map a frequency label to an interval in ms. */
export function frequencyToMs(freq: string): number {
  const f = freq.toLowerCase()
  if (f.includes('15 min')) return 15 * 60_000
  if (f.includes('30 min')) return 30 * 60_000
  if (f.includes('dai') || f.includes('day')) return 24 * 3_600_000 // "Daily" / "per day"
  const hours = f.match(/(\d+)\s*hour/)
  if (hours) return parseInt(hours[1], 10) * 3_600_000
  return 6 * 3_600_000
}

let timer: ReturnType<typeof setTimeout> | null = null
let paused = false
let ticking = false

/** One scheduler pass: per watched source, run on new uploads; baseline on first sight. */
export async function tick(): Promise<void> {
  const settings = getSettings()
  if (!settings.autoScrape.enabled || paused) return
  // Re-entrancy guard: a slow pass (many profiles × scrape/download/render) must not
  // overlap the next, which would double scrape load and reminder work.
  if (ticking) return
  ticking = true
  try {
    const repos = getRepos()
    for (const s of repos.sourceChannels()) {
      if (!s.autoWatch || !s.url) continue
      try {
        const scraped = await sourceVideos(s.url, s.sourceOrder ?? 'Latest', s.sourceCount ?? 5)
        if (!s.lastSeenVideoId) {
          // First time we see this source: set the baseline cursor, don't backfill.
          repos.setSourceCursor(s.id, { lastSeenVideoId: scraped[0]?.id, lastRunAt: s.lastRunAt })
        } else if (newVideos(scraped, s.lastSeenVideoId).length > 0) {
          await runSource(s.id, true)
        }
      } catch (e) {
        const msg = (e as Error).message
        SCHED_LOG.warn(`auto-watch failed source=${s.name || s.handle} url=${s.url}: ${msg}`)
        // Wide event + fmt: name is readable in the message; ids stay filterable attributes.
        const sourceLabel = s.name || s.handle || s.id
        sentryLog.warn(sentryLog.fmt`Auto-watch source failed: ${sourceLabel}`, {
          source_id: s.id,
          source_name: sourceLabel,
          source_order: s.sourceOrder ?? 'Latest',
          error_message: msg.slice(0, 200)
        })
        pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Auto-watch failed: ${s.name || s.handle} — ${msg.slice(0, 80)}` })
      }
      await sleep((settings.autoScrape.delaySec || 0) * 1000)
    }
    checkReminders()
    // Top up + prune niche b-roll pools that are due (no-op when none are stale).
    await refreshNichePools()
  } finally {
    ticking = false
  }
}

export function start(): void {
  stop()
  paused = false
  // Self-scheduling loop: the next tick is queued only AFTER the previous finishes, so
  // a long pass can never pile up behind a fixed setInterval cadence.
  const loop = (): void => {
    timer = setTimeout(() => {
      void tick().finally(loop)
    }, frequencyToMs(getSettings().autoScrape.frequency))
  }
  loop()
}

export function stop(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export function setPaused(value: boolean): void {
  paused = value
}

export function isRunning(): boolean {
  return timer !== null && !paused
}
