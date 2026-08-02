import { rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rendererMocks = vi.hoisted(() => ({
  renderMedia: vi.fn(async () => undefined)
}))

vi.mock('@remotion/renderer', async () => {
  const actual = await vi.importActual<typeof import('@remotion/renderer')>('@remotion/renderer')
  return { ...actual, renderMedia: rendererMocks.renderMedia }
})

import { RemotionRendererAdapter } from '../../../video-engine/remotion/adapter'
import { DEFAULT_GRADE_ENCODER_ARGS } from '../../../electron/services/video-engine/render/postprocess/ffmpeg-grade'

let scratchDirectory: string | undefined

afterEach(async () => {
  rendererMocks.renderMedia.mockClear()
  if (scratchDirectory) await rm(scratchDirectory, { recursive: true, force: true })
  scratchDirectory = undefined
})

describe('Remotion render NVENC policy', () => {
  it('requires hardware acceleration so Remotion cannot fall back to software H.264', async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'mental-empire-remotion-nvenc-'))
    const adapter = new RemotionRendererAdapter({
      telemetry: {
        info: () => undefined,
        error: () => undefined,
        captureException: () => undefined
      }
    })

    await adapter.render({
      rendererId: 'remotion',
      durationFrames: 1,
      width: 64,
      height: 64,
      payload: {
        kind: 'mental-empire-remotion-v1',
        projectId: 'nvenc-test',
        serveUrl: 'http://127.0.0.1:3000',
        inputProps: { project: {} },
        composition: {}
      }
    }, join(scratchDirectory, 'output.mp4'), {
      workDirectory: scratchDirectory,
      signal: new AbortController().signal,
      onProgress: () => undefined
    })

    expect(rendererMocks.renderMedia).toHaveBeenCalledOnce()
    expect(rendererMocks.renderMedia.mock.calls[0]![0].hardwareAcceleration).toBe('required')
  })

  it('uses h264_nvenc for the grading re-encode with no libx264 fallback', () => {
    expect(DEFAULT_GRADE_ENCODER_ARGS).toContain('h264_nvenc')
    expect(DEFAULT_GRADE_ENCODER_ARGS).not.toContain('libx264')
  })
})
