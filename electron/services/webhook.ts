import { getSettings } from '../store/settings'

// Fire-and-forget webhook POST (Pushover / calendar / Zapier etc). Gated by the
// Background → Webhook setting; never blocks or crashes the pipeline.

/** Captured webhook payloads for the headless harness. */
export const firedWebhooks: Array<{ url: string; body: Record<string, unknown> }> = []

export async function postWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = getSettings().background.webhook
  if (!url) return
  const body = { event, ...payload, at: new Date().toISOString() }
  firedWebhooks.push({ url, body })
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    }).catch(() => {})
    clearTimeout(t)
  } catch {
    /* webhook failures must never affect the pipeline */
  }
}
