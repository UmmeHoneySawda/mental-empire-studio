import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyVideoProject } from '@shared/video-engine'

const remotionMocks = vi.hoisted(() => ({
  bundle: vi.fn(async () => 'D:/tmp/mental-empire-remotion-bundle'),
  ensureBrowser: vi.fn(async () => ({
    type: 'user-defined-path' as const,
    path: 'D:/tmp/chrome.exe',
  })),
  selectComposition: vi.fn(async () => ({
    id: 'MentalEmpireVideo',
    width: 64,
    height: 64,
    fps: 30,
    durationInFrames: 30,
  })),
}))

vi.mock('@remotion/bundler', () => ({ bundle: remotionMocks.bundle }))
vi.mock('@remotion/renderer', async () => {
  const actual = await vi.importActual<typeof import('@remotion/renderer')>('@remotion/renderer')
  return {
    ...actual,
    ensureBrowser: remotionMocks.ensureBrowser,
    selectComposition: remotionMocks.selectComposition,
  }
})

import {
  clearRemotionRuntimeCaches,
  RemotionRendererAdapter,
} from '../../../video-engine/remotion/adapter'

let scratchDirectory: string | undefined

afterEach(async () => {
  clearRemotionRuntimeCaches()
  vi.clearAllMocks()
  if (scratchDirectory) await rm(scratchDirectory, { recursive: true, force: true })
  scratchDirectory = undefined
})

describe('Remotion local render assets', () => {
  it('serves file assets over loopback HTTP with byte-range support', async () => {
    scratchDirectory = await mkdtemp(join(tmpdir(), 'mental-empire-remotion-assets-'))
    const localVideo = join(scratchDirectory, 'local clip.mp4')
    const entryPoint = join(scratchDirectory, 'entry.tsx')
    await writeFile(localVideo, 'abcdefghij')
    await writeFile(entryPoint, '')
    const project = {
      ...createEmptyVideoProject({
        id: 'local-assets',
        name: 'Local assets',
        rendererId: 'remotion',
        width: 64,
        height: 64,
        fps: 30,
        durationFrames: 30,
      }),
      assets: [
        {
          id: 'local-video',
          name: 'Local video',
          kind: 'video' as const,
          uri: pathToFileURL(localVideo).href,
          mimeType: 'video/mp4',
          width: 64,
          height: 64,
          durationFrames: 30,
          source: { kind: 'local' as const },
        },
        {
          id: 'remote-video',
          name: 'Remote video',
          kind: 'video' as const,
          uri: 'https://cdn.example.test/remote.mp4',
          mimeType: 'video/mp4',
          source: { kind: 'generated' as const, provider: 'test' },
        },
      ],
    }
    const adapter = new RemotionRendererAdapter({
      rootDirectory: scratchDirectory,
      entryPoint,
      publicDirectory: null,
    })
    const prepared = await adapter.prepare(project, {
      workDirectory: join(scratchDirectory, 'work'),
      signal: new AbortController().signal,
      onProgress: () => undefined,
    })

    try {
      const inputProject = remotionMocks.selectComposition.mock.calls[0]![0]
        .inputProps.project
      const localUri = inputProject.assets[0].uri as string

      expect(localUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/asset\/0\.mp4$/u)
      expect(inputProject.assets[1].uri).toBe('https://cdn.example.test/remote.mp4')

      const response = await fetch(localUri, { headers: { Range: 'bytes=2-5' } })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 2-5/10')
      expect(response.headers.get('content-type')).toBe('video/mp4')
      expect(await response.text()).toBe('cdef')
    } finally {
      await adapter.cleanup(prepared)
    }
  })
})
