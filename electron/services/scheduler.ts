import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { sourceVideos, checkReminders } from '../ipc/scrape'
import { newVideos, runProfile } from '../ipc/automation'
import { hhmm, pushActivity } from '../ipc/events'
import { logger } from './logger'

// Auto-watch scheduler (req #3). On each tick it checks every watched profile's
// linked source for new uploads and runs the profile hands-free. Runs in the main
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

/** One scheduler pass: per watched profile, run on new uploads; baseline on first sight. */
export async function tick(): Promise<void> {
  const settings = getSettings()
  if (!settings.autoScrape.enabled || paused) return
  // Re-entrancy guard: a slow pass (many profiles × scrape/download/render) must not
  // overlap the next, which would double scrape load and reminder work.
  if (ticking) return
  ticking = true
  try {
    const repos = getRepos()
    for (const p of repos.profiles()) {
      if (!p.autoWatch || !p.sourceUrl) continue
      try {
        const scraped = await sourceVideos(p.sourceUrl, p.sourceOrder, p.sourceCount)
        if (!p.lastSeenVideoId) {
          // First time we see this profile: set the baseline cursor, don't backfill.
          repos.setProfileCursor(p.id, { lastSeenVideoId: scraped[0]?.id, lastRunAt: p.lastRunAt })
        } else if (newVideos(scraped, p.lastSeenVideoId).length > 0) {
          await runProfile(p.id, true)
        }
      } catch (e) {
        const msg = (e as Error).message
        SCHED_LOG.warn(`auto-watch failed profile=${p.name} source=${p.sourceUrl}: ${msg}`)
        pushActivity({ t: hhmm(), icon: '!', color: '#ff5a6e', text: `Auto-watch failed: ${p.name} — ${msg.slice(0, 80)}` })
      }
      await sleep((settings.autoScrape.delaySec || 0) * 1000)
    }
    checkReminders()
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
