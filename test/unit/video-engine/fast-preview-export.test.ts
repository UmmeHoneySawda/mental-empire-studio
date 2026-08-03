import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoProject } from '../../../shared/video-engine'

vi.mock('electron', () => ({ BrowserWindow: class BrowserWindow {} }))

import {
  buildFastPreviewFfmpegArgs,
  collectFastPreviewAudioInputs,
  fastPreviewOutputSpec,
} from '../../../electron/services/video-engine/fast-preview-export'

let scratch: string | undefined

afterEach(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true })
  scratch = undefined
})

function project(uri = 'file:///missing.mp3'): VideoProject {
  return {
    id: 'fast-preview-project',
    name: 'Fast preview',
    rendererId: 'remotion',
    schemaVersion: 1,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationFrames: 300,
      backgroundColor: '#000000',
    },
    assets: [{ id: 'voice', name: 'Voice', kind: 'audio', uri }],
    tracks: [{ id: 'audio', name: 'Audio', kind: 'audio', order: -1, muted: false, locked: false }],
    scenes: [{
      id: 'voice-scene',
      trackId: 'audio',
      kind: 'audio',
      startFrame: 30,
      durationFrames: 120,
      zIndex: 0,
      assetId: 'voice',
      volume: 0.5,
      sourceRange: { startFrame: 15, durationFrames: 120 },
    }],
    transitions: [],
  } as VideoProject
}

describe('fast preview export', () => {
  it('caps the hidden recorder at 720p and 24fps', () => {
    expect(fastPreviewOutputSpec(project())).toEqual({
      width: 1280,
      height: 720,
      fps: 24,
      frameCount: 240,
      durationSec: 10,
    })
  })

  it('builds an NVENC image-pipe command and mixes delayed timeline audio', () => {
    const spec = fastPreviewOutputSpec(project())
    const args = buildFastPreviewFfmpegArgs({
      outputPath: '/tmp/fast-preview.mp4',
      spec,
      audioInputs: [{
        path: '/tmp/voice.wav',
        sourceStartSec: 0.5,
        durationSec: 4,
        delayMs: 1000,
        volume: 0.5,
      }],
    })
    const joined = args.join(' ')

    expect(joined).toContain('-f image2pipe')
    expect(joined).toContain('-c:v h264_nvenc')
    expect(joined).toContain('atrim=start=0.5:duration=4')
    expect(joined).toContain('adelay=1000:all=1')
    expect(joined).toContain('amix=inputs=1')
    expect(joined).toContain('-frames:v 240')
  })

  it('derives audio timing from the project without reading media in the browser', async () => {
    scratch = await mkdtemp(join(tmpdir(), 'mes-fast-preview-'))
    await mkdir(scratch, { recursive: true })
    const audioPath = join(scratch, 'voice.wav')
    await writeFile(audioPath, '')

    expect(collectFastPreviewAudioInputs(project(pathToFileURL(audioPath).href), () => true)).toEqual([
      {
        path: audioPath,
        sourceStartSec: 0.5,
        durationSec: 4,
        delayMs: 1000,
        volume: 0.5,
      },
    ])
  })
})
