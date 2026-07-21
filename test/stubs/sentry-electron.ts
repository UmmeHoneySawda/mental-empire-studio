export function init(): void {}
export function close(): Promise<boolean> { return Promise.resolve(true) }
export function setContext(): void {}
export function addBreadcrumb(): void {}
export function captureException(): void {}
export async function startSpan<T>(_options: unknown, callback: () => T | Promise<T>): Promise<T> { return callback() }
export function getGlobalScope(): { setAttributes: (..._args: unknown[]) => void } {
  return { setAttributes: () => {} }
}
export const logger = {
  trace: (): void => {},
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
  fatal: (): void => {},
  fmt: (strings: TemplateStringsArray, ...values: unknown[]): string =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ''), '')
}
