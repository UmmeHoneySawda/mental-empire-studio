// TalkingPhotos HTTP client. Plain-fetch against app.talkingphotos.ai from the main process.
//
// Why not a browser: the vendor's login is an ordinary Symfony form (`_csrf_token`, `_username`,
// `_password`, `_remember_me`) and every app call is same-origin JSON with cookie auth and no CSRF
// header. Verified live 2026-08-18 from a non-browser client: login, an authenticated JSON GET, and
// a multipart mp3 upload all succeeded with no Cloudflare, no JS challenge, no bot check. Driving
// the Angular wizard instead would be slower, brittler, and could not solve the actual problems
// here (concurrency gating, resumability, polling).
//
// Two vendor facts shape this file:
//   1. The account permits only THREE simultaneous logins. Past that, login fails with
//      "Maximum number of simultaneous logins exceeded". So the session is persisted and reused;
//      it is never re-established per request, and a lost session is re-established exactly once.
//   2. `POST /project` and `POST /project/merge_videos` are NOT idempotent. A blind retry after a
//      client timeout produced duplicate renders in a previous session. Those two calls are
//      therefore marked non-retryable and callers read the project list back instead.

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { getSettings, setSettings } from '../../store/settings'
import { sentryLog, captureException } from '../sentry'
import type { TpCredentialSource, TpErrorCode } from '../../../shared/talkingphotos'
import { TP_MAX_SESSIONS } from '../../../shared/talkingphotos'

const HOST = 'https://app.talkingphotos.ai'
const LOGIN_PATH = '/login'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = 60_000
const UPLOAD_TIMEOUT_MS = 300_000

export class TpError extends Error {
  readonly code: TpErrorCode
  readonly status: number
  constructor(code: TpErrorCode, message: string, status = 0) {
    super(message)
    this.name = 'TpError'
    this.code = code
    this.status = status
  }
}

/** Cookie jar. Only the vendor's own cookies, keyed by name; no domain/path logic is needed. */
type Jar = Record<string, string>

let jar: Jar = {}
let jarLoaded = false
/** Single-flight guard: concurrent callers hitting a dead session must not each log in. */
let loginInFlight: Promise<void> | null = null

function loadJar(): void {
  if (jarLoaded) return
  jarLoaded = true
  const raw = getSettings().talkingphotos?.session ?? ''
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as Jar
    if (parsed && typeof parsed === 'object') jar = parsed
  } catch {
    // A corrupt jar is not worth surfacing; the next call just logs in again.
    jar = {}
  }
}

function persistJar(): void {
  // `session` is registered in SECRET_FIELDS, so this lands encrypted via safeStorage.
  setSettings({ talkingphotos: { session: Object.keys(jar).length ? JSON.stringify(jar) : '' } })
}

function cookieHeader(): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

/**
 * Absorb `set-cookie` into the jar. Node exposes multiple set-cookie headers through
 * `getSetCookie()`; the `raw()` fallback covers older runtimes.
 */
function absorbCookies(res: Response): void {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  const all = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  const list = all.length ? all : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : [])
  for (const line of list) {
    const [pair] = line.split(';')
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const name = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    // An expiry in the past is a delete instruction.
    if (/expires=Thu, 01 Jan 1970/i.test(line) || value === '') delete jar[name]
    else jar[name] = value
  }
}

export function hasSession(): boolean {
  loadJar()
  return Boolean(jar.PHPSESSID || jar.REMEMBERME)
}

/** Drop the local session without telling the vendor. Used when a session is provably dead. */
export function forgetSession(): void {
  jar = {}
  jarLoaded = true
  persistJar()
}

// ---- Credentials ----------------------------------------------------------------------------

export interface TpCredentials {
  email: string
  password: string
  source: TpCredentialSource
}

/**
 * Resolve credentials env-first, then Settings, then fail.
 *
 * Env-first inverts the app's usual `applyEnvFallback` order (where a saved setting wins) because
 * the user asked for the OS environment to be authoritative. Note for anyone reading this later:
 * `setx` stores the password as plaintext in `HKCU\Environment`, which is weaker at rest than the
 * DPAPI-encrypted Settings field, and env vars are only visible after a full app restart.
 */
export function resolveCredentials(): TpCredentials {
  const envEmail = (process.env.TALKINGPHOTOS_EMAIL ?? '').trim()
  const envPassword = process.env.TALKINGPHOTOS_PASSWORD ?? ''
  if (envEmail && envPassword) return { email: envEmail, password: envPassword, source: 'env' }

  const s = getSettings().talkingphotos
  const email = (s?.email ?? '').trim()
  const password = s?.password ?? ''
  if (email && password) return { email, password, source: 'settings' }

  throw new TpError(
    'NO_CREDENTIALS',
    'No TalkingPhotos sign-in details. Set TALKINGPHOTOS_EMAIL and TALKINGPHOTOS_PASSWORD, or fill them in Settings.'
  )
}

/** Which source would be used, without throwing — for the Settings UI to label its fields. */
export function credentialSource(): TpCredentialSource {
  try {
    return resolveCredentials().source
  } catch {
    return 'none'
  }
}

// ---- Login ----------------------------------------------------------------------------------

function classifyLoginFailure(body: string): TpError {
  if (/simultaneous logins/i.test(body)) {
    return new TpError(
      'SESSION_LIMIT',
      `TalkingPhotos allows ${TP_MAX_SESSIONS} signed-in sessions at once and all of them are in use. Sign out of the site in your browser, or wait about 15 minutes for an idle session to expire.`
    )
  }
  if (/too many|throttl|try again later|attempts/i.test(body)) {
    return new TpError('THROTTLED', 'TalkingPhotos is rate-limiting sign-in attempts. Wait a minute before trying again.')
  }
  if (/invalid credentials|bad credentials|incorrect/i.test(body)) {
    return new TpError('BAD_CREDENTIALS', 'TalkingPhotos rejected that email and password.')
  }
  return new TpError('BAD_CREDENTIALS', 'TalkingPhotos would not sign in with those details.')
}

function extractCsrf(html: string): string {
  const m = /name="_csrf_token"[^>]*value="([^"]+)"/.exec(html)
  return m ? m[1] : ''
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' })
  } catch (e) {
    const msg = (e as Error).name === 'AbortError' ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : (e as Error).message
    throw new TpError('NETWORK', `Could not reach TalkingPhotos: ${msg}`)
  } finally {
    clearTimeout(timer)
  }
}

async function performLogin(): Promise<void> {
  const creds = resolveCredentials()
  // A fresh login needs a fresh session cookie; the CSRF token is bound to it.
  jar = {}
  jarLoaded = true

  const page = await timedFetch(`${HOST}${LOGIN_PATH}`, {
    method: 'GET',
    headers: { 'User-Agent': UA, Accept: 'text/html' }
  }, REQUEST_TIMEOUT_MS)
  absorbCookies(page)
  const csrf = extractCsrf(await page.text())
  if (!csrf) throw new TpError('VENDOR_REJECTED', 'The TalkingPhotos sign-in page did not include a CSRF token; the site may have changed.')

  const body = new URLSearchParams({
    _csrf_token: csrf,
    _username: creds.email,
    _password: creds.password,
    _remember_me: 'on'
  })

  const res = await timedFetch(`${HOST}${LOGIN_PATH}`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      Cookie: cookieHeader()
    },
    body
  }, REQUEST_TIMEOUT_MS)
  absorbCookies(res)

  const location = res.headers.get('location') ?? ''
  const bouncedBack = res.status === 302 && /\/login(\?|$)/.test(location)

  if (res.status !== 302 || bouncedBack) {
    // The reason lives in a flash message on the re-rendered login page, not in this response.
    const followUp = await timedFetch(`${HOST}${LOGIN_PATH}`, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader() }
    }, REQUEST_TIMEOUT_MS)
    const html = await followUp.text()
    forgetSession()
    const err = classifyLoginFailure(html)
    sentryLog.warn('TalkingPhotos sign-in refused', { operation: 'tp_login', error_code: err.code, credential_source: creds.source })
    throw err
  }

  persistJar()
  sentryLog.info('TalkingPhotos signed in', {
    operation: 'tp_login',
    credential_source: creds.source,
    remember_me: Boolean(jar.REMEMBERME)
  })
}

/** Log in, collapsing concurrent callers onto one attempt so the 3-session cap is not burned. */
export async function login(): Promise<void> {
  if (loginInFlight) return loginInFlight
  loginInFlight = performLogin().finally(() => { loginInFlight = null })
  return loginInFlight
}

/** Tell the vendor to end this session, freeing one of the three slots immediately. */
export async function logout(): Promise<void> {
  loadJar()
  if (!hasSession()) return
  try {
    await timedFetch(`${HOST}/logout`, {
      method: 'GET',
      headers: { 'User-Agent': UA, Cookie: cookieHeader() }
    }, REQUEST_TIMEOUT_MS)
  } catch {
    // Signing out locally still matters even if the vendor call fails.
  }
  forgetSession()
  sentryLog.info('TalkingPhotos signed out', { operation: 'tp_logout' })
}

// ---- Request --------------------------------------------------------------------------------

export interface TpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** JSON body. Mutually exclusive with `form`. */
  json?: unknown
  /** Multipart body, already assembled. */
  form?: FormData
  /**
   * Set for calls whose side effect cannot be replayed (`POST /project`,
   * `POST /project/merge_videos`). A timeout on one of these throws instead of retrying, and the
   * caller reconciles by reading the project list.
   */
  nonIdempotent?: boolean
  timeoutMs?: number
}

function isAuthBounce(res: Response): boolean {
  if (res.status === 401 || res.status === 403) return true
  if (res.status !== 302) return false
  return /\/login(\?|$)/.test(res.headers.get('location') ?? '')
}

async function rawRequest(path: string, opts: TpRequestOptions): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json, text/plain, */*',
    Cookie: cookieHeader()
  }
  let body: FormData | string | undefined
  if (opts.form) {
    body = opts.form
    // fetch sets the multipart boundary itself; setting Content-Type here would break it.
  } else if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  }
  const url = path.startsWith('http') ? path : `${HOST}${path.startsWith('/') ? '' : '/'}${path}`
  return timedFetch(url, { method: opts.method ?? 'GET', headers, body }, opts.timeoutMs ?? (opts.form ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS))
}

async function readBody(res: Response): Promise<{ text: string; json: unknown }> {
  const text = await res.text()
  if (!text) return { text, json: null }
  try {
    return { text, json: JSON.parse(text) }
  } catch {
    return { text, json: null }
  }
}

function vendorMessage(json: unknown, text: string): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    for (const key of ['error', 'message', 'msg']) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  // Vendor error pages are HTML; a raw dump is not useful to the user.
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('<')) return ''
  return trimmed.slice(0, 300)
}

function classifyVendorError(status: number, message: string): TpError {
  if (/please wait until your existing videos/i.test(message)) {
    return new TpError('CONCURRENCY_FULL', message, status)
  }
  if (/reached your daily/i.test(message)) {
    return new TpError('QUOTA_EXHAUSTED', message, status)
  }
  return new TpError('VENDOR_REJECTED', message || `TalkingPhotos returned HTTP ${status}.`, status)
}

/**
 * Authenticated request. Signs in when there is no session, and on an auth bounce re-signs in
 * exactly once before retrying. A second bounce is a hard failure: retrying further would burn
 * session slots against a problem retries cannot fix.
 */
export async function tpRequest<T = unknown>(path: string, opts: TpRequestOptions = {}): Promise<T> {
  loadJar()
  if (!hasSession()) await login()

  let res = await rawRequest(path, opts)

  if (isAuthBounce(res)) {
    if (opts.nonIdempotent) {
      // The request may already have taken effect server-side. Never replay it.
      forgetSession()
      throw new TpError('AUTH_LOST', 'The TalkingPhotos session expired while submitting. Reconciling instead of resubmitting, so nothing is duplicated.')
    }
    sentryLog.info('TalkingPhotos session lost; signing in again', { operation: 'tp_reauth', path })
    forgetSession()
    await login()
    res = await rawRequest(path, opts)
    if (isAuthBounce(res)) {
      forgetSession()
      throw new TpError('AUTH_LOST', 'TalkingPhotos signed us out again immediately after signing in. Check the account in a browser.')
    }
  }

  absorbCookies(res)
  const { text, json } = await readBody(res)

  if (res.status >= 400) {
    const err = classifyVendorError(res.status, vendorMessage(json, text))
    if (err.code === 'VENDOR_REJECTED') {
      sentryLog.warn('TalkingPhotos rejected a request', { operation: 'tp_request', path, status: res.status, error_code: err.code })
    }
    throw err
  }

  // Redirects other than an auth bounce are unexpected on the JSON API.
  if (res.status >= 300 && res.status < 400) {
    throw new TpError('VENDOR_REJECTED', `TalkingPhotos redirected ${path} unexpectedly.`, res.status)
  }

  return json as T
}

/** Authenticated request returning raw text, for the HTML app shell (`appSettings` lives inline). */
export async function tpRequestText(path: string): Promise<string> {
  loadJar()
  if (!hasSession()) await login()
  let res = await rawRequest(path, {})
  if (isAuthBounce(res)) {
    forgetSession()
    await login()
    res = await rawRequest(path, {})
    if (isAuthBounce(res)) {
      forgetSession()
      throw new TpError('AUTH_LOST', 'TalkingPhotos signed us out again immediately after signing in.')
    }
  }
  absorbCookies(res)
  return res.text()
}

/**
 * Some vendor endpoints answer HTTP 200 with `{success:false}` and an empty message —
 * `create_image_from_prompt` does exactly this for an unsupported aspect ratio. Always branch on
 * the body, never on the status alone.
 */
export function assertSuccess<T extends { success?: boolean; message?: string }>(body: T, what: string): T {
  if (body && body.success === false) {
    throw new TpError('VENDOR_REJECTED', body.message?.trim() || `TalkingPhotos could not ${what}, and gave no reason.`)
  }
  return body
}

/** Multipart upload of a local file. Reads into memory: chunks are megabytes, not gigabytes. */
export async function tpUploadFile<T = unknown>(path: string, filePath: string, field: string, extra?: Record<string, string>): Promise<T> {
  const bytes = await readFile(filePath)
  const form = new FormData()
  const name = basename(filePath)
  form.append(field, new Blob([bytes]), name)
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v)
  return tpRequest<T>(path, { method: 'POST', form })
}

/** Download a vendor URL to a Buffer. Cookie is sent so `/project/download/{id}` works. */
export async function tpDownload(url: string, timeoutMs = UPLOAD_TIMEOUT_MS): Promise<Buffer> {
  loadJar()
  if (!hasSession()) await login()
  let res = await timedFetch(url, {
    method: 'GET',
    headers: { 'User-Agent': UA, Cookie: cookieHeader() }
  }, timeoutMs)

  // CDN links redirect; follow them, carrying the cookie only on the vendor's own host.
  let hops = 0
  while (res.status >= 300 && res.status < 400 && hops < 5) {
    const next = res.headers.get('location')
    if (!next) break
    if (/\/login(\?|$)/.test(next)) {
      forgetSession()
      await login()
      res = await timedFetch(url, { method: 'GET', headers: { 'User-Agent': UA, Cookie: cookieHeader() } }, timeoutMs)
      hops += 1
      continue
    }
    const absolute = next.startsWith('http') ? next : `${HOST}${next.startsWith('/') ? '' : '/'}${next}`
    const sameHost = absolute.startsWith(HOST)
    res = await timedFetch(absolute, {
      method: 'GET',
      headers: sameHost ? { 'User-Agent': UA, Cookie: cookieHeader() } : { 'User-Agent': UA }
    }, timeoutMs)
    hops += 1
  }

  if (res.status !== 200) {
    throw new TpError('VENDOR_REJECTED', `Downloading the finished video failed with HTTP ${res.status}.`, res.status)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0) throw new TpError('VENDOR_REJECTED', 'TalkingPhotos returned an empty file.')
  return buf
}

/** Turn any thrown value into a user-facing sentence plus a code, for IPC boundaries. */
export function describeTpError(e: unknown): { code: TpErrorCode; message: string } {
  if (e instanceof TpError) return { code: e.code, message: e.message }
  captureException(e)
  return { code: 'NETWORK', message: (e as Error)?.message || 'Something went wrong talking to TalkingPhotos.' }
}
