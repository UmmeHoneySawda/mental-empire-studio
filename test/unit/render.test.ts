import { describe, it, expect } from 'vitest'
import { buildRenderArgs, canUseCudaFinalFilters, videoCodecArgs } from '../../electron/services/render'
import type { AppSettings, Project, ProjectImage, RenderCapabilities } from '../../shared/types'

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

describe('buildRenderArgs — GPU image path', () => {
  const project = {
    id: 'p1',
    title: 'GPU image path',
    downloadId: 'dl-video123',
    channel: 'test',
    mp3Path: 'voice.mp3',
    durationSec: 12,
    imageMode: 'sequence',
    seed: 1,
    kenBurns: true,
    punchZoom: true,
    crossfade: 0,
    captionPreset: 'Hormozi',
    captionFont: 'Anton',
    captionAnim: 'Pop-in',
    captionAspect: '16:9',
    captionLines: 1,
    captionPosition: 'bottom',
    captionPace: 'auto',
    keywords: false,
    betaOpts: null,
    stage: 'queued'
  } as unknown as Project
  const image = { id: 'im1', projectId: 'p1', ord: 0, path: 'still.png', thumb: 'still-thumb.jpg', rangeStart: 0, rangeEnd: 12, manual: false } as ProjectImage

  it('uses CUDA scale and NVENC for ordinary still-image renders when available', () => {
    const args = buildRenderArgs({
      project,
      images: [image],
      assPath: 'captions.ass',
      outPath: 'out.mp4',
      settings: { encoder: 'nvenc', quality: '1080p' } as AppSettings,
      caps: caps({ hasNvenc: true, ffmpegHasCuda: true })
    })
    const joined = args.join(' ')
    expect(joined).toContain('scale_cuda')
    expect(joined).toContain('hwupload_cuda')
    expect(joined).toContain('h264_nvenc')
    expect(joined).not.toContain('zoompan')
  })

  it('does not use CUDA filters on CPU renders', () => {
    const args = buildRenderArgs({
      project,
      images: [image],
      assPath: 'captions.ass',
      outPath: 'out.mp4',
      settings: { encoder: 'cpu', quality: '1080p' } as AppSettings,
      caps: caps({ hasNvenc: true, ffmpegHasCuda: true })
    })
    const joined = args.join(' ')
    expect(joined).not.toContain('scale_cuda')
    expect(joined).toContain('libx264')
  })
})
