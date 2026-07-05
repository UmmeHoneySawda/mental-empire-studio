import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { performance } from 'node:perf_hooks'
import * as Sentry from '@sentry/electron/main'
import log from 'electron-log/main'

/**
 * Sentry DSN — a write-only ingestion key, safe to ship inside the packaged app
 * (unlike an org auth token, which must never be embedded in client code).
 */
export const SENTRY_DSN = 'https://85d01f4cd2136a24ac4e9d1477aa3aa4@o4511677078044672.ingest.de.sentry.io/4511677090758736'

let enabled = false
let samplerHandle: ReturnType<typeof setInterval> | null = null

/** Headless smokes/screenshots must stay fully offline and deterministic — never touch Sentry. */
export function telemetryForcedOff(): boolean {
  return !!process.env['ME_SMOKE'] || !!process.env['ME_SHOOT']
}

export function isTelemetryEnabled(): boolean {
  return enabled
}

/** Periodic CPU/RAM/GPU snapshot, attached to Sentry as context (visible on any
 *  subsequent error) plus a breadcrumb trail (visible in the timeline leading up to it). */
function sampleResources(): void {
  try {
    const metrics = app.getAppMetrics()
    const browser = metrics.find((m) => m.type === 'Browser')
    const gpu = metrics.find((m) => m.type === 'GPU')
    const sys = process.getSystemMemoryInfo()
    const snapshot = {
      totalCpuPct: Number(metrics.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0).toFixed(2)),
      browserCpuPct: browser?.cpu?.percentCPUUsage ?? 0,
      browserMemKB: browser?.memory?.workingSetSize ?? 0,
      gpuCpuPct: gpu?.cpu?.percentCPUUsage ?? 0,
      gpuMemKB: gpu?.memory?.workingSetSize ?? 0,
      rendererProcessCount: metrics.filter((m) => m.type === 'Tab').length,
      totalProcessCount: metrics.length,
      sysFreeMemKB: sys.free,
      sysTotalMemKB: sys.total
    }
    Sentry.setContext('systemResources', snapshot)
    Sentry.addBreadcrumb({ category: 'resource', level: 'info', message: 'sample', data: snapshot })
  } catch (err) {
    log.warn('[sentry] resource sampler failed', err)
  }
}

function startResourceSampler(): void {
  if (samplerHandle) return
  samplerHandle = setInterval(sampleResources, 20_000)
  samplerHandle.unref?.()
  sampleResources()
}

function stopResourceSampler(): void {
  if (samplerHandle) {
    clearInterval(samplerHandle)
    samplerHandle = null
  }
}

/** The global kill switch. Turning this on/off takes effect immediately, no restart. */
export function setSentryEnabled(next: boolean): void {
  if (telemetryForcedOff()) return
  if (next === enabled) return
  if (next) {
    Sentry.init({
      dsn: SENTRY_DSN,
      release: `mental-empire-studio@${app.getVersion()}`,
      environment: app.isPackaged ? 'production' : 'development',
      tracesSampleRate: 1.0,
      maxBreadcrumbs: 300
    })
    enabled = true
    startResourceSampler()
    log.info('[sentry] telemetry ENABLED')
  } else {
    stopResourceSampler()
    enabled = false
    void Sentry.close(2000)
    log.info('[sentry] telemetry DISABLED')
  }
}

/** No-op when telemetry is off — callers don't need to check the switch themselves. */
export function captureException(err: unknown): void {
  if (!enabled) return
  Sentry.captureException(err)
}

type IpcListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Wraps ipcMain.handle app-wide so every renderer→main call gets a trace span, a
 * timed breadcrumb, and automatic exception capture — without touching each of the
 * dozen electron/ipc/* modules individually. Call ONCE, before any ipcMain.handle(...)
 * registration runs (they all share this same ipcMain singleton).
 */
export function instrumentIpcMain(): void {
  const original = ipcMain.handle.bind(ipcMain)
  const wrapped = (channel: string, listener: IpcListener): void => {
    original(channel, async (event, ...args) => {
      if (!enabled) return listener(event, ...args)
      const start = performance.now()
      return Sentry.startSpan({ name: channel, op: 'ipc.handle' }, async () => {
        try {
          const result = await listener(event, ...args)
          Sentry.addBreadcrumb({ category: 'ipc', level: 'info', message: channel, data: { ms: Math.round(performance.now() - start) } })
          return result
        } catch (err) {
          Sentry.addBreadcrumb({ category: 'ipc', level: 'error', message: `${channel} threw`, data: { ms: Math.round(performance.now() - start) } })
          Sentry.captureException(err, { tags: { ipcChannel: channel } })
          throw err
        }
      })
    })
  }
  ;(ipcMain as unknown as { handle: typeof wrapped }).handle = wrapped
}

/** Wraps every method on an object (e.g. the DB Repositories) with the same
 *  timing + breadcrumb + exception-capture treatment as instrumentIpcMain, for call
 *  sites invoked directly from IPC handlers rather than behind their own channel. */
export function traceObject<T extends object>(obj: T, category: string): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function' || typeof prop !== 'string') return value
      return (...args: unknown[]) => {
        if (!enabled) return value.apply(target, args)
        const start = performance.now()
        const done = (): void => {
          Sentry.addBreadcrumb({ category, level: 'info', message: prop, data: { ms: Math.round(performance.now() - start) } })
        }
        const fail = (err: unknown): void => {
          Sentry.captureException(err, { tags: { [category]: prop } })
        }
        try {
          const result = value.apply(target, args)
          if (result instanceof Promise) {
            return result.then((r) => { done(); return r }).catch((err) => { fail(err); throw err })
          }
          done()
          return result
        } catch (err) {
          fail(err)
          throw err
        }
      }
    }
  })
}
