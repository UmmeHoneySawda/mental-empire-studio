import { Notification } from 'electron'
import type { AppSettings, MyChannel, ReminderHit } from '../../shared/types'
import { getSettings } from '../store/settings'

// Behind-pace detection + desktop notifications (req #1 / #3). A channel is "behind
// pace" when it hasn't met its weekly upload goal. The hands-free scheduler that
// calls this on a timer is M7; here we expose the check + the notification.

/** Records every fired reminder so the headless smoke harness can assert on them. */
export const firedNotifications: ReminderHit[] = []

/** Captured generic notifications (title/body) for the headless harness. */
export const firedMessages: Array<{ title: string; body: string }> = []

/** Generic desktop notification for run/render events, gated by the user setting. */
export function notifyMessage(title: string, body: string): void {
  if (!getSettings().background.notifications) return
  firedMessages.push({ title, body })
  if (process.env['ME_SMOKE']) return // headless: capture only
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  } catch {
    /* notifications unavailable — non-fatal */
  }
}

export function pendingUploads(c: MyChannel): number {
  return Math.max(0, c.mapTotal - c.mapDone)
}

export function behindPace(c: MyChannel): boolean {
  return c.weekDone < c.weekGoal
}

export function reminderHit(c: MyChannel): ReminderHit | null {
  if (!behindPace(c)) return null
  const left = Math.max(0, c.weekGoal - c.weekDone)
  const pending = pendingUploads(c)
  return {
    channelId: c.id,
    channelName: c.name,
    pending,
    message: `${c.name}: ${left} to hit weekly goal · ${pending} downloaded not yet uploaded`
  }
}

/** Show a desktop notification for a behind-pace channel, gated by the user setting. */
export function notify(hit: ReminderHit, settings: AppSettings): void {
  if (!settings.background.notifications) return
  firedNotifications.push(hit)
  if (process.env['ME_SMOKE']) return // headless: capture only, no real toast
  try {
    if (Notification.isSupported()) {
      new Notification({ title: 'Behind pace', body: hit.message }).show()
    }
  } catch {
    /* notifications unavailable on this platform — non-fatal */
  }
}
