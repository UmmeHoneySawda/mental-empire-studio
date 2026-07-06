import { describe, expect, it } from 'vitest'
import { gpuStatusLabel, type GpuEngineStatus } from '../../shared/gpuStatus'

const status = (over: Partial<GpuEngineStatus> = {}): GpuEngineStatus => ({
  hardware: false,
  supported: false,
  vendor: 'unknown',
  ...over
})

describe('gpuStatusLabel', () => {
  it('shows a checking state while the probe is in flight', () => {
    expect(gpuStatusLabel(null, true)).toMatchObject({ tone: 'warn', text: expect.stringContaining('checking') })
  })

  it('shows an unknown state when the probe never returned', () => {
    expect(gpuStatusLabel(null, false)).toMatchObject({ tone: 'warn' })
  })

  it('reports ok with the GPU name when hardware encode is confirmed', () => {
    const label = gpuStatusLabel(status({ hardware: true, supported: true, vendor: 'nvidia', gpuName: 'RTX 4070' }), false)
    expect(label.tone).toBe('ok')
    expect(label.text).toContain('RTX 4070')
  })

  it('reports an error (never a silent fallback) when only software encode is available', () => {
    const label = gpuStatusLabel(status({ hardware: false, supported: true, vendor: 'nvidia', detail: 'no hw encoder' }), false)
    expect(label.tone).toBe('error')
    expect(label.detail).toContain('CPU fallback is disabled')
    expect(label.detail).toContain('no hw encoder')
  })

  it('reports an error when WebCodecs is not supported at all', () => {
    const label = gpuStatusLabel(status({ hardware: false, supported: false, vendor: 'unknown', detail: 'no VideoEncoder' }), false)
    expect(label.tone).toBe('error')
    expect(label.detail).toBe('no VideoEncoder')
  })
})
