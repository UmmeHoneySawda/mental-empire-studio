#!/usr/bin/env node

/**
 * Fetch one Sentry issue event for production debugging without storing credentials.
 *
 * Usage:
 *   SENTRY_AUTH_TOKEN=... npm run sentry:event -- \
 *     https://buft.sentry.io/issues/135480745/events/0847a04ea89c4d2187ac775c6c483145/
 *
 * Or:
 *   SENTRY_AUTH_TOKEN=... npm run sentry:event -- 135480745 0847a04ea89c4d2187ac775c6c483145
 *
 * Optional environment:
 *   SENTRY_ORG=buft
 *   SENTRY_REGION=de
 *   SENTRY_API_BASE=https://de.sentry.io/api/0
 *
 * The auth token is read only from the environment and is never printed. Output is a
 * deliberately reduced, recursively scrubbed event snapshot suitable for an AI agent.
 */

const token = process.env.SENTRY_AUTH_TOKEN
const org = process.env.SENTRY_ORG || 'buft'
const region = process.env.SENTRY_REGION || 'de'
const apiBase = (process.env.SENTRY_API_BASE || `https://${region}.sentry.io/api/0`).replace(/\/$/, '')
const args = process.argv.slice(2)

if (!token) {
  console.error('Missing SENTRY_AUTH_TOKEN. Set it in the environment; never pass or commit it as a CLI argument.')
  process.exit(2)
}

function parseTarget(values) {
  const first = values[0] || ''
  try {
    const url = new URL(first)
    const match = url.pathname.match(/\/issues\/(\d+)\/events\/([0-9a-f]{16,}|latest|oldest|recommended)/i)
    if (match) return { issueId: match[1], eventId: match[2] }
  } catch {
    // Not a URL; fall through to positional ids.
  }
  if (/^\d+$/.test(first) && /^([0-9a-f]{16,}|latest|oldest|recommended)$/i.test(values[1] || '')) {
    return { issueId: first, eventId: values[1] }
  }
  return null
}

const target = parseTarget(args)
if (!target) {
  console.error('Usage: npm run sentry:event -- <Sentry event URL>\n   or: npm run sentry:event -- <issue-id> <event-id>')
  process.exit(2)
}

const sensitiveKey = /(^|_)(authorization|cookie|cookies|password|passwd|secret|token|api[_-]?key|session|set-cookie|email|ip_address|ip|username)(_|$)/i
const sensitiveValue = /(bearer\s+[a-z0-9._~-]+|sntryu_[a-z0-9]+|https?:\/\/[^\s:@]+:[^\s@]+@)/ig

function scrub(value, key = '') {
  if (sensitiveKey.test(key)) return '[redacted]'
  if (typeof value === 'string') return value.replace(sensitiveValue, '[redacted]')
  if (Array.isArray(value)) return value.map((item) => scrub(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, scrub(childValue, childKey)]))
  }
  return value
}

function entryType(entry) {
  return entry && typeof entry === 'object' ? entry.type : undefined
}

function reducedEvent(event) {
  const entries = Array.isArray(event.entries) ? event.entries : []
  const usefulEntries = entries.filter((entry) => ['exception', 'breadcrumbs', 'threads', 'message'].includes(entryType(entry)))
  return scrub({
    eventID: event.eventID || event.id,
    groupID: event.groupID,
    title: event.title,
    message: event.message,
    dateCreated: event.dateCreated,
    platform: event.platform,
    projectID: event.projectID,
    release: event.release,
    environment: event.environment,
    culprit: event.culprit,
    level: event.level,
    logger: event.logger,
    tags: event.tags,
    errors: event.errors,
    contexts: event.contexts,
    sdk: event.sdk,
    entries: usefulEntries
  })
}

const endpoint = `${apiBase}/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(target.issueId)}/events/${encodeURIComponent(target.eventId)}/`

try {
  const response = await fetch(endpoint, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json'
    }
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500).replace(sensitiveValue, '[redacted]')
    console.error(`Sentry API request failed: HTTP ${response.status}${body ? ` — ${body}` : ''}`)
    process.exit(1)
  }

  const event = await response.json()
  console.log(JSON.stringify(reducedEvent(event), null, 2))
} catch (error) {
  console.error(`Sentry API request failed: ${String(error?.message || error).replace(sensitiveValue, '[redacted]')}`)
  process.exit(1)
}
