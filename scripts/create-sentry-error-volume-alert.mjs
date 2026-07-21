#!/usr/bin/env node
/**
 * Create a Sentry workflow alert that fires when error-level events spike.
 *
 * Requires:
 *   SENTRY_AUTH_TOKEN  — org token with alerts:write (or org:write)
 *   SENTRY_ORG         — org slug (e.g. mental-empire)
 *
 * Optional:
 *   SENTRY_REGION      — default "de" (this project's DSN is de.sentry.io)
 *   SENTRY_ALERT_EMAIL — notify this member email (else issue_owners)
 *   SENTRY_ERROR_THRESHOLD — events in window (default 20)
 *   SENTRY_ERROR_INTERVAL  — 1m|5m|15m|1h|1d|1w|30d (default 1h)
 *
 * Usage:
 *   $env:SENTRY_AUTH_TOKEN="sntryu_..."; $env:SENTRY_ORG="your-org"
 *   node scripts/create-sentry-error-volume-alert.mjs
 */

const token = process.env.SENTRY_AUTH_TOKEN
const org = process.env.SENTRY_ORG
const region = process.env.SENTRY_REGION || 'de'
const threshold = Number(process.env.SENTRY_ERROR_THRESHOLD || 20)
// Workflow engine expects short forms: 1m, 5m, 15m, 1h, 1d, 1w, 30d
const rawInterval = process.env.SENTRY_ERROR_INTERVAL || '1h'
const intervalAliases = { '1min': '1m', '5min': '5m', '15min': '15m', '1hr': '1h', '1hour': '1h', '1day': '1d' }
const interval = intervalAliases[rawInterval] || rawInterval
const email = process.env.SENTRY_ALERT_EMAIL || ''

if (!token || !org) {
  console.error(`Missing env. Set SENTRY_AUTH_TOKEN and SENTRY_ORG.

Example (PowerShell):
  $env:SENTRY_AUTH_TOKEN = "sntryu_..."
  $env:SENTRY_ORG = "your-org-slug"
  $env:SENTRY_REGION = "de"
  $env:SENTRY_ALERT_EMAIL = "you@example.com"   # optional
  node scripts/create-sentry-error-volume-alert.mjs

Or create manually in Sentry:
  Alerts → Create Alert → Issues
  - When: event frequency ≥ ${threshold} in ${interval}
  - Filter: level is error or fatal
  - Action: email / Slack`)
  process.exit(1)
}

const API = `https://${region}.sentry.io/api/0/organizations/${org}`
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
}

async function json(url, init) {
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers || {}) } })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) {
    throw new Error(`${init?.method || 'GET'} ${url} → ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function resolveUserId(memberEmail) {
  if (!memberEmail) return null
  const members = await json(`${API}/members/`)
  for (const m of members) {
    const em = m.email || m.user?.email
    if (em && em.toLowerCase() === memberEmail.toLowerCase()) {
      return m.user?.id ?? m.userId ?? m.id
    }
  }
  throw new Error(`No org member found for email: ${memberEmail}`)
}

const targetUserId = await resolveUserId(email)
const action = targetUserId
  ? {
      type: 'email',
      integrationId: null,
      data: {},
      config: {
        targetType: 'user',
        targetIdentifier: String(targetUserId),
        targetDisplay: null
      },
      status: 'active'
    }
  : {
      type: 'email',
      integrationId: null,
      data: {},
      config: {
        targetType: 'issue_owners',
        targetIdentifier: '',
        targetDisplay: null
      },
      status: 'active'
    }

const payload = {
  name: `Error volume ≥ ${threshold}/${interval}`,
  enabled: true,
  environment: null,
  config: { frequency: 30 },
  triggers: {
    logicType: 'any-short',
    conditions: [
      { type: 'first_seen_event', comparison: true, conditionResult: true },
      { type: 'regression_event', comparison: true, conditionResult: true },
      { type: 'reappeared_event', comparison: true, conditionResult: true }
    ],
    actions: []
  },
  actionFilters: [{
    logicType: 'all',
    conditions: [
      // fatal=50, error=40, warning=30 — fire for error and above
      { type: 'level', comparison: { level: 40, match: 'gte' }, conditionResult: true },
      {
        type: 'event_frequency_count',
        comparison: { value: threshold, interval },
        conditionResult: true
      }
    ],
    actions: [action]
  }]
}

const created = await json(`${API}/workflows/`, {
  method: 'POST',
  body: JSON.stringify(payload)
})

const id = created?.id
console.log('Created Sentry volume alert:')
console.log(`  id:   ${id}`)
console.log(`  name: ${payload.name}`)
console.log(`  url:  https://${org}.sentry.io/monitors/alerts/${id}/`)
console.log(`  alt:  https://${org}.sentry.io/alerts/rules/`)
console.log(`
Also useful for structured Logs (UI):
  Explore → Logs → Create alert
  Query: severity:error  (or level:error depending on UI)
  Threshold: ≥ ${threshold} in ${interval}
`)
