import Store from 'electron-store'
import { DEFAULT_SETTINGS, type AppSettings, type DeepPartial } from '../../shared/types'

// electron-store persists JSON to <userData>/mental-empire-settings.json with atomic writes.
// This is the single source of truth for AppSettings (appearance, render, auto-scrape, background).

type Schema = { settings: AppSettings }

let store: Store<Schema> | null = null

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
  store = new Store<Schema>({
    name: 'mental-empire-settings',
    defaults: { settings: DEFAULT_SETTINGS }
  })
  const reconciled = mergeDeep(DEFAULT_SETTINGS, store.get('settings') as DeepPartial<AppSettings>)
  store.set('settings', reconciled)
  return reconciled
}

export function getSettings(): AppSettings {
  if (!store) return initSettings()
  return store.get('settings')
}

/** Apply a deep patch, persist, and return the full merged settings. */
export function setSettings(patch: DeepPartial<AppSettings>): AppSettings {
  if (!store) initSettings()
  const next = mergeDeep(getSettings(), patch)
  store!.set('settings', next)
  return next
}

/** Restore every setting to its factory default and persist. */
export function resetSettings(): AppSettings {
  if (!store) initSettings()
  store!.set('settings', DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
