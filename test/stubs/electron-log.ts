// Minimal electron-log/main stub for unit tests.
const noop = (): void => {}
const scope = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop }
const log = {
  initialize: noop,
  transports: {
    file: { level: 'debug', maxSize: 0, fileName: '', format: '', getFile: () => ({ path: '' }) },
    console: { level: 'debug' }
  },
  scope: () => scope,
  info: noop,
  warn: noop,
  error: noop,
  debug: noop
}
export default log
