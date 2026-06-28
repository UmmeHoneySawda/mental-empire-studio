import { getSettings } from '../store/settings'
import { logger } from './logger'

// Fire-and-forget webhook POST (Pushover / calendar / Zapier etc). Gated by the
// Background → Webhook setting; never blocks or crashes the pipeline.

/** Captured webhook payloads for the headless harness. */
export const firedWebhooks: Array<{ url: string; body: Record<string, unknown> }> = []
const WEBHOOK_LOG = logger.scope('webhook')

function redactWebhookUrl(url: string): string {
  return url
    .replace(/([?&](?:key|api_key|token|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/[^/@\s]+:)[^/@\s]+@/gi, '$1[redacted]@')
}

export async function postWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = getSettings().background.webhook
  if (!url) return
  const body = { event, ...payload, at: new Date().toISOString() }
  firedWebhooks.push({ url, body })
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
    if (!res.ok) WEBHOOK_LOG.warn(`post failed event=${event} status=${res.status} url=${redactWebhookUrl(url)}`)
  } catch (e) {
    WEBHOOK_LOG.warn(`post failed event=${event} url=${redactWebhookUrl(url)} error=${(e as Error).message}`)
  } finally {
    clearTimeout(t)
  }
}
