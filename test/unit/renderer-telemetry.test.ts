import { describe, expect, it, vi } from 'vitest'
import { startRendererTelemetry } from '../../src/lib/rendererTelemetry'

describe('renderer telemetry startup', () => {
  it('contains a rejected SDK chunk load so app bootstrap can continue', async () => {
    const cacheFailure = new TypeError('Failed to fetch dynamically imported module')
    const reportFailure = vi.fn()

    expect(() => {
      startRendererTelemetry(
        true,
        async () => { throw cacheFailure },
        reportFailure
      )
    }).not.toThrow()

    await vi.waitFor(() => expect(reportFailure).toHaveBeenCalledWith(cacheFailure))
  })

  it('does not load the SDK when telemetry is disabled', () => {
    const loadTelemetry = vi.fn(async () => ({ initSentryRenderer: vi.fn() }))
    startRendererTelemetry(false, loadTelemetry)
    expect(loadTelemetry).not.toHaveBeenCalled()
  })
})
