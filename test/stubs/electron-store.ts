// Minimal electron-store stub for unit tests. Only needs to satisfy the module import
// for code paths that transitively load the settings store (e.g. storage.ts). Tests do
// not exercise persistence; they call pure path/plan functions that take inputs directly.
export default class Store<T = unknown> {
  private data: Record<string, unknown> = {}
  get(key: string): T { return this.data[key] as T }
  set(key: string, value: unknown): void { this.data[key] = value }
}
