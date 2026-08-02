import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_GRADING,
  type VideoProject,
} from '../../../shared/video-engine'
import {
  GpuHyperframesRendererAdapter,
  createGpuHyperframesRenderConfig,
  resolveHyperframesWorkers,
  type HyperframesGpuProbe,
} from '../../../video-engine/hyperframes/gpu-adapter'
import {
  HYPERFRAMES_PREPARED_PAYLOAD_KIND,
  type HyperframesPreparedPayload,
} from '../../../video-engine/hyperframes/types'

function project(tags: string[] = []): VideoProject {
  return {
    schemaVersion: 1,
    id: 'gpu-adapter-project',
    name: 'GPU adapter project',
    revision: 0,
    rendererId: 'hyperframes',
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 300,
      backgroundColor: '#000000',
    },
    assets: [],
    tracks: [],
    scenes: [],
    transitions: [],
    grading: { ...DEFAULT_VIDEO_GRADING },
    metadata: { tags },
  }
}

function probe(
  encoder: 'nvenc' | 'qsv' | 'amf' | 'vaapi' | 'videotoolbox' | null,
  browserMode: 'hardware' | 'software',
): HyperframesGpuProbe {
  return {
    detectEncoder: async () => encoder,
    resolveBrowserMode: async () => browserMode,
  }
}

function payload(workers?: number): HyperframesPreparedPayload {
  return {
    kind: HYPERFRAMES_PREPARED_PAYLOAD_KIND,
    workspacePath: '/tmp/hf',
    ownerRoot: '/tmp',
    ownerToken: '0123456789abcdef',
    entryFile: 'index.html',
    durationFrames: 300,
    width: 1920,
    height: 1080,
    fps: 30,
    variables: {
      hfBackground: '#000000',
      hfCaptionText: '#FFFFFF',
      hfCaptionAccent: '#FFD166',
      hfCaptionImportant: '#FF4D4D',
    },
    lintWarnings: [],
    workers,
  }
}

describe('GPU-required HyperFrames adapter', () => {
  it('fails preflight instead of silently falling back to CPU encoding', async () => {
    const adapter = new GpuHyperframesRendererAdapter({}, probe(null, 'hardware'))
    const problems = await adapter.preflight(project())

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'hyperframes-gpu-encoder-unavailable',
      }),
    )
  })

  it('fails preflight when Chromium resolves to software rendering', async () => {
    const adapter = new GpuHyperframesRendererAdapter({}, probe('nvenc', 'software'))
    const problems = await adapter.preflight(project())

    expect(problems).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'hyperframes-browser-gpu-unavailable',
      }),
    )
  })

  it('keeps worker sizing automatic unless the project selects 1, 2, or 4', () => {
    expect(resolveHyperframesWorkers(project())).toBeUndefined()
    expect(resolveHyperframesWorkers(project(['hf-workers:auto']))).toBeUndefined()
    expect(resolveHyperframesWorkers(project(['hf-workers:2']))).toBe(2)
    expect(resolveHyperframesWorkers(project(['hf-workers:3']))).toBeUndefined()
  })

  it('uses automatic source-frame extraction and hardware-only producer settings', () => {
    const config = createGpuHyperframesRenderConfig({
      payload: payload(4),
      quality: 'high',
      strictness: 'strict',
    })

    expect(config.videoFrameFormat).toBe('auto')
    expect(config.useGpu).toBe(true)
    expect(config.workers).toBe(4)
    expect(config.format).toBe('mp4')
    expect(config.producerConfig?.browserGpuMode).toBe('hardware')
  })
})
