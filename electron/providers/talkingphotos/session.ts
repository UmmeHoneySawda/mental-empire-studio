import { BrowserWindow } from 'electron'
import { getRepos } from '../../db'
import { clearProviderSessionStorage, getProviderSession } from './partition'
import { healthCheck, warmUpProviderSession } from './client'
import { emit } from '../../ipc/events'
import {
  TALKINGPHOTOS_BASE_URL,
  TALKINGPHOTOS_CONNECTION_ID,
  TALKINGPHOTOS_PARTITION,
  TALKINGPHOTOS_PROVIDER,
  isAllowedProviderNavigation,
  type ProviderConnection,
  type ProviderConnectionStatus
} from '../../../shared/talkingphotos'
import { L } from '../../services/logger'
import { sentryLog } from '../../services/sentry'

// Connection lifecycle: an isolated, persistent-partition login BrowserWindow plus
// DB-backed connection state. provider_connections never stores cookies/tokens — only
// status metadata (plan §3 / §19). The actual session lives in Chromium's partition
// storage and is managed exclusively through partition.ts.
//
// Everything that happens once the login window is open is communicated exclusively
// through the 'talkingphotos:connectionStatus' push event (see setStatus below) —
// connectTalkingPhotos() itself only opens the window and returns; it never stays
// pending for the whole interactive login.

const HEALTH_POLL_MS = 2_500
// Logins can require CAPTCHA/MFA the user must complete by hand — generous, not silent.
const CONNECT_TIMEOUT_MS = 15 * 60_000
// Coalesce a burst of navigation/cookie-change signals into a single health check.
const HEALTH_DEBOUNCE_MS = 400
// A provider request must never leave the UI parked on "Verifying session…" forever.
const HEALTH_CHECK_TIMEOUT_MS = 12_000
const DOM_PROBE_TIMEOUT_MS = 3_000

const CONNECTION_STATUS_EVENT = 'talkingphotos:connectionStatus'

let loginWindow: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let timeoutTimer: ReturnType<typeof setTimeout> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let detachCookieListener: (() => void) | null = null
let healthCheckInFlight = false
/** True whenever no login flow is currently in progress — guards every timer/listener
 *  callback so a stale one can never fire (or double-finish) after teardown. */
let settled = true

function nowIso(): string {
  return new Date().toISOString()
}

function defaultConnectionRow(): ProviderConnection {
  const now = nowIso()
  return { id: TALKINGPHOTOS_CONNECTION_ID, provider: TALKINGPHOTOS_PROVIDER, partition: TALKINGPHOTOS_PARTITION, status: 'disconnected', createdAt: now, updatedAt: now }
}

function loadConnectionRow(): ProviderConnection {
  return getRepos().providerConnection(TALKINGPHOTOS_CONNECTION_ID) ?? defaultConnectionRow()
}

function saveConnectionRow(patch: Partial<ProviderConnection>): ProviderConnection {
  const next: ProviderConnection = { ...loadConnectionRow(), ...patch, updatedAt: nowIso() }
  getRepos().upsertProviderConnection(next)
  return next
}

/** Statuses worth shipping as Sentry Logs (skip verifying ↔ waiting churn during login). */
const LOGGED_CONNECTION_STATUSES = new Set<ProviderConnectionStatus>([
  'connecting',
  'waiting_for_login',
  'connected',
  'disconnected',
  'reauth_required',
  'attention'
])

/** The single place that changes connection status from here on: persists the row
 *  and pushes it to every renderer window over CONNECTION_STATUS_EVENT so the UI
 *  never has to infer progress/failure from a long-pending IPC promise. */
function setStatus(status: ProviderConnectionStatus, extra: Partial<ProviderConnection> = {}): ProviderConnection {
  const prev = loadConnectionRow().status
  const conn = saveConnectionRow({ status, ...extra })
  emit(CONNECTION_STATUS_EVENT, conn)
  // Skip verifying ↔ waiting_for_login churn (health poll every 2.5s) — that flooded
  // Sentry with identical waiting_for_login rows during a single login attempt.
  const skipChurnLog = status === 'waiting_for_login' && prev === 'verifying'
  if (status !== prev && LOGGED_CONNECTION_STATUSES.has(status) && !skipChurnLog) {
    const level = status === 'attention' || status === 'reauth_required' ? 'warn' : 'info'
    sentryLog[level](sentryLog.fmt`TalkingPhotos connection status: ${status}`, {
      operation: 'session',
      connection_status: status,
      previous_status: prev,
      has_error: !!conn.lastError
    })
  }
  return conn
}

/** Read the persisted connection state. With `refresh`, and only when currently
 *  'connected', also runs a headless health check so a silently-expired session
 *  surfaces promptly instead of waiting for the next real request to fail. */
export async function getConnectionStatus(refresh = false): Promise<ProviderConnection> {
  const current = loadConnectionRow()
  if (!refresh || current.status !== 'connected') return current
  const health = await healthCheck()
  if (health.ok) return saveConnectionRow({ status: 'connected', lastVerifiedAt: nowIso(), lastError: undefined })
  if (health.reauthRequired) {
    // Route through setStatus so reauth gets a structured log + UI push event.
    return setStatus('reauth_required', { lastError: health.message })
  }
  return current // network/other failure: don't destroy the last known good status
}

function clearTimers(): void {
  if (pollTimer) clearInterval(pollTimer)
  if (timeoutTimer) clearTimeout(timeoutTimer)
  if (debounceTimer) clearTimeout(debounceTimer)
  pollTimer = null
  timeoutTimer = null
  debounceTimer = null
}

function closeLoginWindow(): void {
  const win = loginWindow
  loginWindow = null
  if (win && !win.isDestroyed()) win.close()
}

/** Cancels every timer and listener an in-progress login flow attached — the 2.5s
 *  poll, the debounce timer, the partition's cookie-change listener, and the window
 *  itself. Safe to call whether or not a flow is actually in progress (disconnect
 *  calls this unconditionally). */
function teardownLoginFlow(): void {
  clearTimers()
  if (detachCookieListener) {
    detachCookieListener()
    detachCookieListener = null
  }
  closeLoginWindow()
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) }
    )
  })
}

/**
 * The provider currently shows a fully-authenticated home screen before its separate
 * API probe consistently settles on every Windows/Electron network stack. Confirm only
 * non-sensitive page state: title and stable UI labels. Never read localStorage,
 * cookies, account text, tokens, or page payloads.
 */
async function loginWindowLooksAuthenticated(): Promise<boolean> {
  const win = loginWindow
  if (!win || win.isDestroyed()) return false
  const webContents = win.webContents as typeof win.webContents & {
    executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
  }
  if (typeof webContents.executeJavaScript !== 'function') return false

  const probe = webContents.executeJavaScript(`(() => {
    const title = String(document.title || '').toLowerCase();
    const text = String(document.body?.innerText || '').toLowerCase().replace(/\\s+/g, ' ');
    const hasPasswordField = Boolean(document.querySelector('input[type="password"]'));
    const authenticatedTitle = title.includes('home page - talkingphotos') || title.includes('dashboard - talkingphotos');
    const authenticatedShell = text.includes('create video') && (
      text.includes('welcome to talkingphotos.ai') ||
      text.includes('my projects') ||
      text.includes('create a video')
    );
    return Boolean((authenticatedTitle || authenticatedShell) && !hasPasswordField);
  })()`, false)

  try {
    return Boolean(await withTimeout(probe, DOM_PROBE_TIMEOUT_MS, 'TalkingPhotos page-state probe'))
  } catch (error) {
    sentryLog.warn('TalkingPhotos page-state probe failed', {
      operation: 'session',
      error_message: (error as Error).message.slice(0, 200)
    })
    return false
  }
}

/** Coalesce a burst of navigation/cookie-change signals into one health check, fired
 *  at most once per HEALTH_DEBOUNCE_MS — never runs once the flow has settled. */
function scheduleHealthCheck(): void {
  if (settled) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runHealthCheckNow()
  }, HEALTH_DEBOUNCE_MS)
}

async function runHealthCheckNow(): Promise<void> {
  if (settled || healthCheckInFlight) return
  healthCheckInFlight = true
  const startedAt = Date.now()
  setStatus('verifying')

  try {
    // DOM shell is a hint that login may have completed — never authoritative alone.
    // 2026-07-21: DOM said "connected" while net.request still got login HTML because
    // partition cookies were not sent (missing useSessionCookies). Only API success
    // may call finishSuccess.
    const windowLooksAuthed = await loginWindowLooksAuthenticated()

    const health = await withTimeout(healthCheck(), HEALTH_CHECK_TIMEOUT_MS, 'TalkingPhotos API health check')
    if (settled) return
    if (health.ok) {
      sentryLog.info('TalkingPhotos login confirmed by API probe', {
        operation: 'session',
        verification_source: windowLooksAuthed ? 'api_and_window' : 'api',
        duration_ms: Date.now() - startedAt,
        window_looks_authenticated: windowLooksAuthed
      })
      finishSuccess()
    } else {
      if (windowLooksAuthed) {
        // User-visible home without API cookies still means "not connected" for us.
        sentryLog.warn('TalkingPhotos window looks logged in but API still unauthenticated', {
          operation: 'session',
          verification_source: 'window_only',
          duration_ms: Date.now() - startedAt,
          reauth_required: health.reauthRequired,
          has_message: !!health.message
        })
      } else {
        sentryLog.warn('TalkingPhotos verification did not confirm login', {
          operation: 'session',
          verification_source: 'api',
          duration_ms: Date.now() - startedAt,
          reauth_required: health.reauthRequired,
          has_message: !!health.message
        })
      }
      setStatus('waiting_for_login')
    }
  } catch (error) {
    if (!settled) {
      const message = (error as Error).message || 'TalkingPhotos verification failed.'
      L.warn(`talkingphotos verification failed: ${message}`)
      sentryLog.warn('TalkingPhotos verification failed', {
        operation: 'session',
        duration_ms: Date.now() - startedAt,
        error_message: message.slice(0, 200)
      })
      setStatus('waiting_for_login')
    }
  } finally {
    healthCheckInFlight = false
  }
}

/** Resume the job poller after an interactive login succeeds. The reconnect IPC
 *  path only reconciles when headless health already returns connected — when the
 *  user finishes login in the window later, finishSuccess is the only resume hook. */
function resumePollerAfterConnect(): void {
  void import('./poller')
    .then((m) => m.reconcileNonTerminalProviderJobs())
    .catch((error) => {
      L.warn(`talkingphotos post-connect reconcile failed: ${(error as Error).message}`)
      sentryLog.warn('TalkingPhotos post-connect reconcile failed', {
        operation: 'session',
        error_message: ((error as Error).message || 'unknown').slice(0, 200)
      })
    })
}

function finishSuccess(): void {
  if (settled) return
  settled = true
  teardownLoginFlow()
  setStatus('connected', { connectedAt: nowIso(), lastVerifiedAt: nowIso(), lastError: undefined })
  resumePollerAfterConnect()
}

function finishFailure(message: string): void {
  if (settled) return
  settled = true
  teardownLoginFlow()
  L.warn(`talkingphotos connect: ${message}`)
  sentryLog.warn('TalkingPhotos connect failed', {
    operation: 'session',
    error_message: message.slice(0, 200)
  })
  setStatus('attention', { lastError: message })
}

/** User dismissed the login window — not a hard failure. Leave them on
 *  reauth_required so Connect/Reconnect stays one click away instead of a
 *  red "Needs attention" dead-end that looked like a product bug in Sentry. */
function finishCancelled(message: string): void {
  if (settled) return
  settled = true
  teardownLoginFlow()
  L.info(`talkingphotos connect cancelled: ${message}`)
  sentryLog.info('TalkingPhotos connect cancelled', {
    operation: 'session',
    error_message: message.slice(0, 200)
  })
  setStatus('reauth_required', { lastError: message })
}

/** Push reauth into the same setStatus path the UI / Sentry already watch.
 *  Callers outside session (poller, creation) must not write provider_connections
 *  rows directly — that skips the connectionStatus event. */
export function markTalkingPhotosReauthRequired(message: string): ProviderConnection {
  return setStatus('reauth_required', { lastError: message })
}

/** Opens the isolated TalkingPhotos login window, wires up every detection signal,
 *  and immediately reports 'waiting_for_login' — the outcome from here on (verifying,
 *  connected, or a terminal attention state) is reported purely through setStatus.
 *  No application preload, sandboxed, contextIsolation on, nodeIntegration off — this
 *  window never talks to window.api and can only navigate within the TalkingPhotos
 *  app origin over https (unresolved HAR gap: exact login/OAuth/MFA domains — see
 *  plan §20 — so unknown hosts are blocked rather than guessed at). */
function openLoginWindow(): ProviderConnection {
  settled = false
  healthCheckInFlight = false
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    title: 'Connect TalkingPhotos',
    webPreferences: {
      partition: TALKINGPHOTOS_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
      // Deliberately no `preload` here.
    }
  })
  loginWindow = win

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!isAllowedProviderNavigation(url)) e.preventDefault() })
  win.webContents.on('will-redirect', (e, url) => { if (!isAllowedProviderNavigation(url)) e.preventDefault() })
  // Faster-than-the-poll detection: any of these navigation signals can mean the user
  // just finished logging in, so check sooner than the next 2.5s tick (debounced).
  win.webContents.on('did-finish-load', () => scheduleHealthCheck())
  win.webContents.on('did-navigate', () => scheduleHealthCheck())
  win.webContents.on('did-navigate-in-page', () => scheduleHealthCheck())
  win.webContents.on('did-fail-load', (_e, errorCode) => {
    if (errorCode !== -3) finishFailure('TalkingPhotos login page failed to load.') // -3 = ERR_ABORTED, a normal cancelled navigation
  })
  win.on('closed', () => {
    loginWindow = null
    // User closed the Connect window — cancel, do not treat as a hard failure.
    finishCancelled('TalkingPhotos login window closed before authentication was confirmed.')
  })

  // Signal-only: the listener never reads/logs/persists/emits the cookie or cause
  // argument this event carries — it only schedules a debounced health check.
  const onCookieChanged = (): void => scheduleHealthCheck()
  getProviderSession().cookies.on('changed', onCookieChanged)
  detachCookieListener = () => getProviderSession().cookies.removeListener('changed', onCookieChanged)

  pollTimer = setInterval(() => { void runHealthCheckNow() }, HEALTH_POLL_MS)
  timeoutTimer = setTimeout(() => finishFailure('TalkingPhotos login timed out after 15 minutes.'), CONNECT_TIMEOUT_MS)

  const waiting = setStatus('waiting_for_login')
  // loadURL returns a Promise in Electron; Promise.resolve() also covers sync mocks in tests.
  void Promise.resolve(win.loadURL(TALKINGPHOTOS_BASE_URL)).catch(() =>
    finishFailure('TalkingPhotos login page failed to load.')
  )
  return waiting
}

/** Opens the login window and returns as soon as it's up — it does NOT wait for the
 *  interactive login to finish (no 15-minute-long unresolved promise). A second call
 *  while a flow is already in progress focuses the existing window instead of
 *  tearing it down and reopening it. Everything after this point (waiting for the
 *  user, verifying, and the final connected/attention outcome) arrives exclusively
 *  through the 'talkingphotos:connectionStatus' push event. */
export async function connectTalkingPhotos(): Promise<ProviderConnection> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    loginWindow.show()
    sentryLog.info('TalkingPhotos connect focused existing login window', {
      operation: 'session',
      connection_status: loadConnectionRow().status
    })
    return loadConnectionRow()
  }
  sentryLog.info('TalkingPhotos connect started', { operation: 'session' })
  setStatus('connecting', { lastError: undefined })
  return openLoginWindow()
}

/** The partition may still hold a valid session, so try headlessly first — a user who
 *  is still actually logged in should never have to see the window again. Always tears
 *  down any login flow that happened to be in progress before declaring success — this
 *  path bypasses the normal poll/signal machinery, so it can't rely on finishSuccess()'s
 *  `settled` guard (which assumes it's only reached from within an active flow). */
export async function reconnectTalkingPhotos(): Promise<ProviderConnection> {
  sentryLog.info('TalkingPhotos reconnect attempted', { operation: 'session' })
  // Warm-up document request lets REMEMBERME mint a fresh PHPSESSID before the XHR healthCheck (plan M2).
  await warmUpProviderSession()
  const health = await healthCheck()
  if (health.ok) {
    settled = true
    teardownLoginFlow()
    sentryLog.info('TalkingPhotos reconnect succeeded without login window', { operation: 'session' })
    return setStatus('connected', { connectedAt: nowIso(), lastVerifiedAt: nowIso(), lastError: undefined })
  }
  sentryLog.info('TalkingPhotos reconnect needs interactive login', {
    operation: 'session',
    reauth_required: health.reauthRequired
  })
  return connectTalkingPhotos()
}

export async function disconnectTalkingPhotos(): Promise<ProviderConnection> {
  sentryLog.info('TalkingPhotos disconnect started', { operation: 'session' })
  settled = true
  teardownLoginFlow()
  await clearProviderSessionStorage()
  return setStatus('disconnected', { lastError: undefined })
}

const INTERRUPTIBLE_STATUSES: ProviderConnectionStatus[] = ['connecting', 'waiting_for_login', 'verifying']

/** Startup-only: a crash/restart during an in-progress login leaves in-memory state
 *  fresh (settled=true, no window, no timers), but the persisted row can still claim
 *  connecting/waiting_for_login/verifying from before the crash — nothing is actually
 *  happening, yet the UI would show that as if it were. Call once at app startup,
 *  before any window reads connection status, so the user sees an accurate "try
 *  again" state instead of one that looks like a login is silently still in progress. */
export function reconcileInterruptedConnectionOnStartup(): void {
  const current = loadConnectionRow()
  if (INTERRUPTIBLE_STATUSES.includes(current.status)) {
    sentryLog.warn('TalkingPhotos login interrupted by app restart', {
      operation: 'session',
      previous_status: current.status
    })
    setStatus('attention', { lastError: 'TalkingPhotos login was interrupted by an app restart — click Connect to try again.' })
  }
}
