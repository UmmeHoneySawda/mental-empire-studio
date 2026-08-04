import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { RemotionRendererAdapter } from '../../../video-engine/remotion/adapter'
import { REMOTION_RENDERER_ID } from '../../../video-engine/remotion/constants'
import { VideoProjectSchema, createCaptionDocument, type VideoProject } from '../../../shared/video-engine'
import { ffprobePath } from '../../../electron/services/bin'

let scratchDirectory: string | undefined

afterEach(async () => {
  if (scratchDirectory) {
    await rm(scratchDirectory, { recursive: true, force: true }).catch(() => undefined)
  }
  scratchDirectory = undefined
})

function probeMedia(filePath: string): {
  durationSec: number
  videoCodec: string
  audioCodec: string
  width: number
  height: number
} {
  const result = spawnSync(
    ffprobePath(),
    [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
      '-of', 'json',
      filePath
    ],
    { encoding: 'utf8', windowsHide: true }
  )
  expect(result.status).toBe(0)
  const parsed = JSON.parse(result.stdout || '{}') as {
    format?: { duration?: string }
    streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number }>
  }
  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const audio = parsed.streams?.find((s) => s.codec_type === 'audio')
  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    videoCodec: video?.codec_name ?? '',
    audioCodec: audio?.codec_name ?? '',
    width: video?.width ?? 0,
    height: video?.height ?? 0
  }
}

describe('Remotion + Mediabunny + NVENC Real Hardware Benchmark', () => {
  it('preflights, prepares and renders a full composition (video, audio, captions, transitions) via NVENC', async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'remotion-hardware-test-'))
    const outputMp4 = join(scratchDirectory, 'rendered_output.mp4')

    const sampleMp3 = resolve('test/fixtures/audio/sample.mp3')
    const sampleBroll = resolve('test/fixtures/broll/test-broll.mp4')
    const sampleImg1 = resolve('test/fixtures/images/img1.png')

    const fps = 30
    const durationFrames = 90 // 3 seconds @ 30 FPS
    const createdAt = '2026-08-05T00:00:00.000Z'

    const captions = createCaptionDocument({
      id: 'cap-doc',
      language: 'en',
      templateId: 'remotion-caption-highlight',
      words: [
        { id: 'w1', text: 'Testing', startFrame: 0, endFrame: 15, importance: 1 },
        { id: 'w2', text: 'Hardware', startFrame: 15, endFrame: 30, importance: 2 },
        { id: 'w3', text: 'NVENC', startFrame: 30, endFrame: 60, importance: 2 },
        { id: 'w4', text: 'Rendering', startFrame: 60, endFrame: 90, importance: 1 }
      ]
    })

    const project: VideoProject = VideoProjectSchema.parse({
      schemaVersion: 1,
      id: 'hardware-benchmark-proj',
      name: 'Real Hardware Benchmark Video',
      revision: 1,
      rendererId: REMOTION_RENDERER_ID,
      createdAt,
      updatedAt: createdAt,
      canvas: {
        width: 1920,
        height: 1080,
        fps,
        durationFrames,
        backgroundColor: '#000000'
      },
      assets: [
        {
          id: 'audio-voice',
          name: 'sample.mp3',
          kind: 'audio',
          uri: `file:///${sampleMp3.replace(/\\/g, '/')}`,
          mimeType: 'audio/mpeg',
          durationFrames
        },
        {
          id: 'broll-clip',
          name: 'test-broll.mp4',
          kind: 'video',
          uri: `file:///${sampleBroll.replace(/\\/g, '/')}`,
          mimeType: 'video/mp4',
          width: 1920,
          height: 1080,
          durationFrames
        },
        {
          id: 'still-img1',
          name: 'img1.png',
          kind: 'image',
          uri: `file:///${sampleImg1.replace(/\\/g, '/')}`,
          mimeType: 'image/png',
          width: 1920,
          height: 1080
        }
      ],
      tracks: [
        { id: 'track-audio', name: 'Voiceover', kind: 'audio', order: -10, muted: false, locked: false },
        { id: 'track-visual', name: 'Visuals', kind: 'video', order: 0, muted: false, locked: false },
        { id: 'track-caption', name: 'Captions', kind: 'caption', order: 100, muted: false, locked: false }
      ],
      scenes: [
        {
          id: 'scene-audio',
          trackId: 'track-audio',
          kind: 'audio',
          startFrame: 0,
          durationFrames,
          zIndex: 0,
          assetId: 'audio-voice',
          volume: 1
        },
        {
          id: 'scene-broll',
          trackId: 'track-visual',
          kind: 'media',
          startFrame: 0,
          durationFrames: 45, // 1.5s
          zIndex: 0,
          assetId: 'broll-clip',
          fit: 'cover',
          opacity: 1,
          sourceRange: { startFrame: 0, durationFrames: 45 }
        },
        {
          id: 'scene-still',
          trackId: 'track-visual',
          kind: 'media',
          startFrame: 30, // Overlaps scene-broll by 15 frames for transition
          durationFrames: 60, // 2s
          zIndex: 0,
          assetId: 'still-img1',
          fit: 'cover',
          opacity: 1,
          transform: {
            x: 0,
            y: 0,
            scaleX: 1.05,
            scaleY: 1.05,
            rotationDeg: 0,
            anchorX: 0.5,
            anchorY: 0.5
          }
        },
        {
          id: 'scene-caption',
          trackId: 'track-caption',
          kind: 'caption',
          startFrame: 0,
          durationFrames,
          zIndex: 0,
          template: {
            id: 'remotion-caption-highlight',
            version: '1.0.0',
            rendererId: REMOTION_RENDERER_ID,
            props: {
              fontFamily: 'Hanken Grotesk',
              textColor: '#FFFFFF',
              activeColor: '#E6FF38',
              importantColor: '#FF5A45',
              maxWordsPerCue: 6
            }
          }
        }
      ],
      captions,
      transitions: [
        {
          id: 'tr-1',
          type: 'fade',
          fromSceneId: 'scene-broll',
          toSceneId: 'scene-still',
          startFrame: 30,
          durationFrames: 15
        }
      ],
      grading: {
        enabled: false,
        lutIntensity: 1,
        exposure: 0,
        contrast: 0,
        saturation: 1,
        temperature: 0,
        tint: 0,
        vignette: 0,
        grain: 0
      }
    })

    const adapter = new RemotionRendererAdapter({
      gpuProfile: 'windows-nvidia',
      telemetry: {
        info: () => undefined,
        error: () => undefined,
        captureException: () => undefined
      }
    })

    // Step 1: Preflight
    const problems = await adapter.preflight(project)
    const errors = problems.filter((p) => p.severity === 'error')
    expect(errors).toEqual([])

    // Step 2: Prepare
    const prepareContext = {
      workDirectory: scratchDirectory,
      signal: new AbortController().signal,
      onProgress: () => undefined
    }
    const prepared = await adapter.prepare(project, prepareContext)
    expect(prepared.rendererId).toBe(REMOTION_RENDERER_ID)
    expect(prepared.durationFrames).toBe(durationFrames)
    expect(prepared.width).toBe(1920)
    expect(prepared.height).toBe(1080)

    // Step 3: Render (NVENC Hardware Acceleration)
    const startTime = Date.now()
    const artifact = await adapter.render(prepared, outputMp4, prepareContext)
    const elapsedMs = Date.now() - startTime

    expect(artifact.path).toBe(outputMp4)
    expect(artifact.mimeType).toBe('video/mp4')
    expect(artifact.width).toBe(1920)
    expect(artifact.height).toBe(1080)

    // Step 4: Cleanup
    await adapter.cleanup(prepared)

    // Step 5: Probe output file using ffprobe
    const probed = probeMedia(outputMp4)
    expect(probed.videoCodec).toBe('h264')
    expect(probed.audioCodec).toBe('aac')
    expect(probed.width).toBe(1920)
    expect(probed.height).toBe(1080)
    expect(probed.durationSec).toBeGreaterThan(2.5)

    const fpsAchieved = (durationFrames / (elapsedMs / 1000)).toFixed(1)
    console.log(`\n=== REAL HARDWARE BENCHMARK COMPLETED ===`)
    console.log(`Output File : ${outputMp4}`)
    console.log(`Render Time : ${elapsedMs} ms`)
    console.log(`Render Speed: ${fpsAchieved} FPS`)
    console.log(`Video Codec : ${probed.videoCodec}`)
    console.log(`Audio Codec : ${probed.audioCodec}`)
    console.log(`Dimensions  : ${probed.width}x${probed.height}`)
    console.log(`Duration    : ${probed.durationSec.toFixed(2)}s`)
  }, 120_000) // 2 minute timeout for full bundle + render
})
