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
  concurrencyForMachine,
  defaultGpuRenderProfile,
} from '../../../video-engine/remotion/adapter'
import { createRemotionRenderPlan } from '../../../video-engine/remotion/composition'
import { createRemotionFixtureProject } from '../../../video-engine/remotion/fixture'
import {
  buildGradeFilter,
  DEFAULT_GRADE_ENCODER_ARGS,
  gradeFromProject
} from '../../../electron/services/video-engine/render/postprocess/ffmpeg-grade'
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

  /* The old invariant here was `concurrency === 1`, which deliberately encoded the policy
     that the GPU profile also picked the tab count. It does not any more: the GL backend and
     the tab count are separate decisions, because pinning every Windows NVIDIA machine to a
     single tab cost ~13% of render throughput on a 4-core box, measured as a paired
     same-sweep A/B (`npm run bench:render`). Do not quote a bigger number from a
     cross-session comparison: fixed-config spread on that box reaches 46%.
     What must still hold is that raising the tab count did not weaken the encoder policy —
     all tabs feed ONE ffmpeg/NVENC process, verified by sampling
     `nvidia-smi encoder.stats.sessionCount` across the sweep and never seeing it exceed 1. */
  it('uses a supported ANGLE profile for Windows NVIDIA, with a machine-derived tab count', async () => {
    await renderWithAdapter(new RemotionRendererAdapter({
      telemetry,
      gpuProfile: 'windows-nvidia'
    }))

    const options = rendererMocks.renderMedia.mock.calls[0]![0]
    expect(options.chromiumOptions).toEqual({ gl: 'angle' })
    expect(options.chromeMode).toBe('headless-shell')
    expect(options.concurrency).toBe(concurrencyForMachine())
    expect(options.hardwareAcceleration).toBe('required')
  })

  it('derives the tab count from cores alone, bounded by the benchmarked range', () => {
    expect(concurrencyForMachine(1)).toBe(1)
    expect(concurrencyForMachine(2)).toBe(1)
    expect(concurrencyForMachine(4)).toBe(2)
    expect(concurrencyForMachine(8)).toBe(4)
    // Nothing above 4 has been benchmarked, so a 32-core machine does not get to guess.
    expect(concurrencyForMachine(32)).toBe(4)
  })

  it('does not let the GPU profile decide the tab count any more', async () => {
    await renderWithAdapter(new RemotionRendererAdapter({ telemetry, gpuProfile: 'windows-nvidia' }))
    const windows = rendererMocks.renderMedia.mock.calls[0]![0].concurrency
    rendererMocks.renderMedia.mockClear()
    await renderWithAdapter(new RemotionRendererAdapter({ telemetry, gpuProfile: 'automatic' }))
    expect(rendererMocks.renderMedia.mock.calls[0]![0].concurrency).toBe(windows)
  })

  it('still lets an explicit null hand the decision back to Remotion', async () => {
    await renderWithAdapter(new RemotionRendererAdapter({
      telemetry,
      gpuProfile: 'windows-nvidia',
      concurrency: null
    }))
    expect(rendererMocks.renderMedia.mock.calls[0]![0].concurrency).toBeNull()
  })

  it('falls back to a single tab when the core count is unavailable', () => {
    // `cpus()` has returned an empty array in containers and under some hypervisors, and a
    // NaN here would reach Remotion as `concurrency: NaN` rather than failing loudly.
    expect(concurrencyForMachine(0)).toBe(1)
    expect(concurrencyForMachine(Number.NaN)).toBe(1)
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

  /* `MES_REMOTION_CONCURRENCY` is the only supported way to override the derived tab count —
     there is deliberately no Settings knob (the value is computable from cores, Remotion
     hard-errors above the core count, and the evidence base behind the clamp is one run per
     arm). That makes these the tests that stand in for a UI. */
  describe('MES_REMOTION_CONCURRENCY override', () => {
    const original = process.env['MES_REMOTION_CONCURRENCY']

    afterEach(() => {
      if (original === undefined) delete process.env['MES_REMOTION_CONCURRENCY']
      else process.env['MES_REMOTION_CONCURRENCY'] = original
    })

    it('wins over the machine-derived default', () => {
      process.env['MES_REMOTION_CONCURRENCY'] = '3'
      expect(concurrencyForMachine(4)).toBe(3)
    })

    it('may exceed the benchmarked ceiling, because the clamp bounds a guess and this is not one', () => {
      process.env['MES_REMOTION_CONCURRENCY'] = '8'
      expect(concurrencyForMachine(4)).toBe(8)
    })

    it.each(['0', '-1', '2.5', 'four', ' '])(
      'rejects %o loudly instead of silently rendering at the default',
      (value) => {
        process.env['MES_REMOTION_CONCURRENCY'] = value
        expect(() => concurrencyForMachine(4)).toThrow(/MES_REMOTION_CONCURRENCY/)
      }
    )

    it('treats an empty value as unset', () => {
      process.env['MES_REMOTION_CONCURRENCY'] = ''
      expect(concurrencyForMachine(4)).toBe(2)
    })
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

describe('cinematic grade filter chain', () => {
  it('evaluates the vignette once at init, not on every frame', async () => {
    const chain = await buildGradeFilter({ enabled: true, vignette: 0.35 })

    expect(chain).toContain('vignette=angle=')
    expect(chain).toContain(':eval=init')
    expect(chain).not.toContain('eval=frame')
  })

  /* This is *why* `eval=init` is safe rather than merely faster: `finite()` rejects anything
     that is not a finite number, so the angle is always a literal decimal and can never be an
     ffmpeg expression in `n`/`t`. If a future change makes the angle time-varying, this test
     is the one that should stop it. */
  it('never emits a time-varying vignette angle', async () => {
    const hostile = { enabled: true, vignette: 'n/100' as unknown as number }
    const chain = await buildGradeFilter(hostile)

    expect(chain).not.toContain('vignette')

    const numeric = await buildGradeFilter({ enabled: true, vignette: 1 })
    const angle = /vignette=angle=([^:]+):/.exec(numeric)?.[1]
    expect(angle).toMatch(/^\d+(\.\d+)?$/)
    expect(Number(angle)).toBeCloseTo(Math.PI / 3, 4)
  })

  it('maps the project contrast offset onto the filter multiplier', () => {
    const project = createRemotionFixtureProject()
    const grade = gradeFromProject({
      ...project,
      grading: { ...project.grading, enabled: true, contrast: 0.2 }
    })

    // The schema stores contrast as an offset around 0; the eq filter wants it around 1.
    expect(grade.contrast).toBeCloseTo(1.2, 6)
    expect(grade.enabled).toBe(true)
  })
})
