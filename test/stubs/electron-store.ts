// Minimal electron-store stub for unit tests. Most callers only need the module import
// to resolve, but the settings-secret tests need real store semantics: `defaults`, and a
// backing "file" that survives constructing a second Store with the same name — that is
// what makes a re-open (initSettings twice) observable.
// Parked on globalThis, not in module scope: tests that exercise settings re-open the
// module with vi.resetModules(), which would otherwise hand the code under test a fresh,
// empty stub — losing the very "file" the test just seeded.
const globals = globalThis as { __meStoreFiles?: Map<string, Record<string, unknown>> }
const files = (globals.__meStoreFiles ??= new Map<string, Record<string, unknown>>())

/** The persisted blob for a store name, created empty on first access. Tests use this to
 *  seed a pre-existing settings file and to assert what was actually written to disk. */
export function __storeFile(name: string): Record<string, unknown> {
  let file = files.get(name)
  if (!file) {
    file = {}
    files.set(name, file)
  }
  return file
}

export function __resetStores(): void {
  files.clear()
}

export default class Store<T = unknown> {
  private readonly file: Record<string, unknown>

  constructor(options: { name?: string; defaults?: Record<string, unknown> } = {}) {
    this.file = __storeFile(options.name ?? 'config')
    // electron-store only applies a default for a key that is absent; it never
    // overwrites what is already on disk.
    for (const [key, value] of Object.entries(options.defaults ?? {})) {
      if (!(key in this.file)) this.file[key] = value
    }
  }

  get(key: string): T {
    return this.file[key] as T
  }

  set(key: string, value: unknown): void {
    this.file[key] = value
  }
}
