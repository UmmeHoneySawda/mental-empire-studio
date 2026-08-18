import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Store from 'electron-store'
import { app, safeStorage } from 'electron'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '../../shared/types'

// electron-store persists JSON to <userData>/mental-empire-settings.json with atomic writes.
// This is the single source of truth for AppSettings (appearance, render, auto-scrape, background).
//
// Secrets (Groq + stock-footage API keys) are encrypted AT REST via Electron safeStorage
// (OS keychain/DPAPI). Plaintext stays in memory for the renderer UI; only the on-disk
// JSON is ciphertext. Legacy plaintext values keep working and are re-encrypted on the
// next write. If the OS has no secure backend, we transparently fall back to plaintext.

type Schema = { settings: AppSettings }

let store: Store<Schema> | null = null

// Field names (anywhere in the settings tree) whose string values are secrets.
// `password` and `session` are the TalkingPhotos account password and its cookie jar; both are
// bearer-equivalent, so both are encrypted at rest exactly like an API key.
const SECRET_FIELDS = new Set(['apiKey', 'pexelsKey', 'pixabayKey', 'coverrKey', 'geminiKey', 'metaKey', 'password', 'session'])
const ENC_PREFIX = 'enc:v1:'

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encryptValue(v: string): string {
  if (!v || v.startsWith(ENC_PREFIX) || !canEncrypt()) return v
  try {
    return ENC_PREFIX + safeStorage.encryptString(v).toString('base64')
  } catch {
    return v
  }
}

// Ciphertext we could not read this session, keyed by its dotted path in the settings
// tree. DPAPI can fail transiently (no keychain backend, a different Windows profile,
// a machine-key rotation), and decryptValue answers '' so the UI shows the key as unset
// rather than leaking ciphertext. Without this map the very next persist() would write
// that '' straight over the ciphertext and destroy the user's API key for good — the
// read path must never be able to delete a secret it merely failed to open.
const unreadableSecrets = new Map<string, string>()

function decryptValue(v: string, path: string): string {
  if (!v.startsWith(ENC_PREFIX)) {
    unreadableSecrets.delete(path)
    return v // plaintext (legacy / no-keychain machine)
  }
  const remember = (): string => {
    unreadableSecrets.set(path, v)
    return '' // ciphertext we can't read here — surface as unset, don't leak
  }
  if (!canEncrypt()) return remember()
  try {
    const plain = safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'))
    unreadableSecrets.delete(path)
    return plain
  } catch {
    return remember()
  }
}

/** Deep-clone settings, applying `fn` to every secret string field. `fn` also receives
 *  the field's dotted path so the caller can correlate a value with its location. */
function transformSecrets(obj: unknown, fn: (val: string, path: string) => string, prefix = ''): unknown {
  if (Array.isArray(obj)) return obj.map((v, i) => transformSecrets(v, fn, `${prefix}[${i}]`))
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k
      out[k] = SECRET_FIELDS.has(k) && typeof v === 'string' ? fn(v, path) : transformSecrets(v, fn, path)
    }
    return out
  }
  return obj
}

function decodeSecrets<T>(obj: T): T {
  return transformSecrets(obj, decryptValue) as T
}

/** Re-encrypt for storage. A secret that reads back as empty at a path we know holds
 *  unreadable ciphertext is not a cleared key — it is the failed decrypt round-tripping,
 *  so the original ciphertext is preserved. Typing a real value still overwrites it. */
function encodeSecrets<T>(obj: T): T {
  return transformSecrets(obj, (value, path) => {
    if (value === '') {
      const preserved = unreadableSecrets.get(path)
      if (preserved) return preserved
    }
    return encryptValue(value)
  }) as T
}

/** Encrypt secrets then persist to disk. */
function persist(settings: AppSettings): void {
  store!.set('settings', encodeSecrets(settings) as AppSettings)
}

/** Recursively merge a (possibly partial) patch onto a base object, returning a new object. */
export function mergeDeep<T>(base: T, patch?: DeepPartial<T>): T {
  if (!patch) return base
  const out: Record<string, unknown> = Array.isArray(base) ? [...(base as unknown[])] as never : { ...(base as object) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = (out as Record<string, unknown>)[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object') {
      out[key] = mergeDeep(current, value as DeepPartial<unknown>)
    } else if (value !== undefined) {
      out[key] = value
    }
  }
  return out as T
}

/** Open the store and reconcile any newly-added default keys onto the persisted object. */
export function initSettings(): AppSettings {
  const settingsFileExisted = (() => {
    try {
      if (existsSync(join(app.getPath('userData'), 'mental-empire-settings.json'))) return true
    } catch {}
    // Test stub: electron-store is in-memory via globalThis.__meStoreFiles; check there too
    try {
      const g = globalThis as unknown as { __meStoreFiles?: Map<string, Record<string, unknown>> }
      const f = g.__meStoreFiles?.get('mental-empire-settings')
      if (f && Object.prototype.hasOwnProperty.call(f, 'settings')) return true
    } catch {}
    return false
  })()
  store = new Store<Schema>({
    name: 'mental-empire-settings',
    defaults: { settings: DEFAULT_SETTINGS }
  })
  const decoded = decodeSecrets(store.get('settings') as DeepPartial<AppSettings>)
  const reconciled = mergeDeep(DEFAULT_SETTINGS, decoded)
  if (!reconciled.libraryFolder && !reconciled.outputFolder && !settingsFileExisted) {
    try { if (existsSync('D:\\')) reconciled.libraryFolder = 'D:\\MentalEmpireStudio' } catch {}
  }
  persist(reconciled) // re-encrypts (migrates any legacy plaintext keys)
  return reconciled
}

/** Explicit C: fallback for the "Use C: default" button — preserves user intent
 *  across restarts ('' would be reinterpreted as D: via preferredDefaultRoot). */
export function cFallbackRoot(): string {
  try { return join(app.getPath('documents'), 'MentalEmpireStudio') } catch { return 'C:\\MentalEmpireStudio' }
}

// Env-var fallbacks for secret fields left blank in the Settings UI — lets any locally
// installed agent/tool share one set of API keys via the OS environment instead of every
// user re-pasting them. Never persisted: applied only on read, after decoding.
function applyEnvFallback(settings: AppSettings): AppSettings {
  const out = { ...settings, transcription: { ...settings.transcription }, beta: { ...settings.beta } }
  if (!out.transcription.apiKey) out.transcription.apiKey = process.env.GROQ_API_KEY ?? ''
  if (!out.beta.pexelsKey) out.beta.pexelsKey = process.env.PEXELS_API_KEY ?? ''
  if (!out.beta.pixabayKey) out.beta.pixabayKey = process.env.PIXABAY_API_KEY ?? ''
  if (!out.beta.coverrKey) out.beta.coverrKey = process.env.COVERR_API_KEY ?? ''
  if (!out.beta.geminiKey) out.beta.geminiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ''
  if (!out.beta.metaKey) out.beta.metaKey = process.env.META_API_KEY ?? process.env.MODEL_API_KEY ?? ''
  return out
}

export function getSettings(): AppSettings {
  if (!store) return initSettings()
  return applyEnvFallback(decodeSecrets(store.get('settings')))
}

/** Apply a deep patch, persist, and return the full merged settings. */
export function setSettings(patch: DeepPartial<AppSettings>): AppSettings {
  if (!store) initSettings()
  const next = mergeDeep(decodeSecrets(store!.get('settings')), patch)
  persist(next)
  return applyEnvFallback(next)
}

/** Restore every setting to its factory default and persist. */
export function resetSettings(): AppSettings {
  if (!store) initSettings()
  persist(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
