import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

import {
  RemotionRendererAdapter,
  chromeModeForGpuProfile,
  chromiumOptionsForGpuProfile,
  defaultGpuRenderProfile,
} from '../../../video-engine/remotion/adapter'
import { createRemotionRenderPlan } from '../../../video-engine/remotion/composition'
import { createRemotionFixtureProject } from '../../../video-engine/remotion/fixture'
import { DEFAULT_GRADE_ENCODER_ARGS } from '../../../electron/services/video-engine/render/postprocess/ffmpeg-grade'
import { packagedRemotionBinariesDirectory } from '../../../electron/services/video-engine/remotion-binaries'

let scratchDirectory: string | undefined

afterEach(async () => {
  rendererMocks.renderMedia.mockClear()
  if (scratchDirectory) await rm(scratchDirectory, { recursive: true, force: true })
  scratchDirectory = undefined
})

async function renderWithAdapter(adapter: RemotionRendererAdapter): Promise<void> {
  scratchDirectory = await mkdtemp(join(tmpdir(), 'mental-empire-remotion-nvenc-'))
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
}

const telemetry = {
  info: () => undefined,
  error: () => undefined,
  captureException: () => undefined
}

describe('Remotion render NVENC policy', () => {
  it('requires hardware acceleration so Remotion cannot fall back to software H.264', async () => {
    await renderWithAdapter(new RemotionRendererAdapter({ telemetry }))

    expect(rendererMocks.renderMedia).toHaveBeenCalledOnce()
    expect(rendererMocks.renderMedia.mock.calls[0]![0].hardwareAcceleration).toBe('required')
  })

  it('uses a supported ANGLE profile and one renderer tab for Windows NVIDIA', async () => {
    await renderWithAdapter(new RemotionRendererAdapter({
      telemetry,
      gpuProfile: 'windows-nvidia'
    }))

    const options = rendererMocks.renderMedia.mock.calls[0]![0]
    expect(options.chromiumOptions).toEqual({ gl: 'angle' })
    expect(options.chromeMode).toBe('headless-shell')
    expect(options.concurrency).toBe(1)
  })

  it('maps explicit Linux GPU profiles to Chrome for Testing', () => {
    expect(chromiumOptionsForGpuProfile('linux-nvidia-angle')).toEqual({ gl: 'angle-egl' })
    expect(chromiumOptionsForGpuProfile('linux-nvidia-vulkan')).toEqual({ gl: 'vulkan' })
    expect(chromeModeForGpuProfile('linux-nvidia-angle')).toBe('chrome-for-testing')
    expect(chromeModeForGpuProfile('linux-nvidia-vulkan')).toBe('chrome-for-testing')
  })

  it('defaults Windows to the NVIDIA profile and leaves other platforms automatic', () => {
    expect(defaultGpuRenderProfile('win32')).toBe('windows-nvidia')
    expect(defaultGpuRenderProfile('linux')).toBe('automatic')
    expect(defaultGpuRenderProfile('darwin')).toBe('automatic')
  })

  it('precomputes the static render plan instead of searching tracks and assets per scene', () => {
    const project = createRemotionFixtureProject()
    const plan = createRemotionRenderPlan(project)

    expect(plan.assetById.size).toBe(project.assets.length)
    expect(plan.sceneDataById.size).toBe(project.scenes.length)
    expect(plan.renderableProject.scenes.some((scene) => scene.kind === 'caption')).toBe(false)
  })

  it('uses h264_nvenc for the grading re-encode with no libx264 fallback', () => {
    expect(DEFAULT_GRADE_ENCODER_ARGS).toContain('h264_nvenc')
    expect(DEFAULT_GRADE_ENCODER_ARGS).not.toContain('libx264')
  })

  it('uses the unpacked Remotion executables in a packaged Electron app', async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'mental-empire-remotion-binaries-'))
    const resourcesPath = join(scratchDirectory, 'resources')
    const binariesDirectory = join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@remotion',
      'compositor-win32-x64-msvc'
    )
    await mkdir(binariesDirectory, { recursive: true })
    await Promise.all(
      ['remotion.exe', 'ffmpeg.exe', 'ffprobe.exe'].map((name) =>
        writeFile(join(binariesDirectory, name), '')
      )
    )

    expect(
      packagedRemotionBinariesDirectory(resourcesPath, 'win32', 'x64')
    ).toBe(binariesDirectory)
  })
})
