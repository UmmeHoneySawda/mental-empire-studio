import { describe, it, expect } from 'vitest'
import { canUseCudaFinalFilters, videoCodecArgs } from '../../electron/services/render'
import type { AppSettings, RenderCapabilities } from '../../shared/types'

const caps = (over: Partial<RenderCapabilities>): RenderCapabilities => ({
  hasNvenc: false, hasQsv: false, hasAmf: false, gpuVendor: 'unknown', ffmpegHasLibass: true, ffmpegHasCuda: false, ...over
})
const settings = (encoder: AppSettings['encoder']): AppSettings => ({ encoder } as AppSettings)

// G3: GPU scaling only engages when NVENC is selected AND ffmpeg/driver actually
// support CUDA — never silently, and never on CPU.
describe('canUseCudaFinalFilters', () => {
  it('is true only for nvenc + nvenc-capable + cuda-capable ffmpeg', () => {
    expect(canUseCudaFinalFilters(settings('nvenc'), caps({ hasNvenc: true, ffmpegHasCuda: true }))).toBe(true)
  })
  it('is false when cuda is unavailable', () => {
    expect(canUseCudaFinalFilters(settings('nvenc'), caps({ hasNvenc: true, ffmpegHasCuda: false }))).toBe(false)
  })
  it('is false on CPU', () => {
    expect(canUseCudaFinalFilters(settings('cpu'), caps({ hasNvenc: true, ffmpegHasCuda: true }))).toBe(false)
  })
})

describe('videoCodecArgs', () => {
  it('uses the GPU codec when nvenc is selected', () => {
    expect(videoCodecArgs(settings('nvenc'), '20')).toContain('h264_nvenc')
  })
  it('uses libx264 on CPU', () => {
    expect(videoCodecArgs(settings('cpu'), '20')).toContain('libx264')
  })
})
