import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AutoBrollJobRecord } from '../../../electron/services/video-engine/broll/job-store'
import { AutoBrollJobStore } from '../../../electron/services/video-engine/broll/job-store'

const roots: string[] = []

async function store(): Promise<AutoBrollJobStore> {
  const root = await mkdtemp(join(tmpdir(), 'mental-empire-auto-broll-jobs-'))
  roots.push(root)
  return new AutoBrollJobStore(root)
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function job(overrides: Partial<AutoBrollJobRecord> = {}): AutoBrollJobRecord {
  return {
    schemaVersion: 1,
    id: 'auto-broll-job-1',
    projectId: 'remotion-project-1',
    downloadId: 'download-1',
    options: {
      density: 'balanced',
      minClipSeconds: 3,
      maxClipSeconds: 6,
      orientation: 'landscape',
    },
    stage: 'downloading',
    message: 'Preparing continuous footage — 1 clips',
    placements: [{
      moment: {
        startSec: 1,
        endSec: 4,
        text: 'a quiet lake',
        query: 'quiet alpine lake sunrise',
        category: 'location',
        reason: 'visual context',
      },
      candidate: {
        id: 'candidate-1',
        provider: 'pexels',
        title: 'Alpine lake',
        sourceUrl: 'https://example.test/video/1',
        downloadUrl: 'https://example.test/video/1.mp4',
        width: 1920,
        height: 1080,
        durationMs: 5_000,
        license: {
          name: 'Test licence',
          url: 'https://example.test/licence',
          attributionRequired: false,
          commercialUseAllowed: true,
        },
        tags: ['alpine', 'lake'],
      },
      asset: {
        id: 'broll:checkpoint',
        name: 'Alpine lake',
        kind: 'video',
        uri: 'file:///D:/Mental%20Empire%20Studio/broll-library/checkpoint.mp4',
        durationFrames: 150,
      },
      startFrame: 30,
      durationFrames: 90,
      score: 42,
    }],
    skipped: [],
    createdAt: '2026-08-02T10:00:00.000Z',
    updatedAt: '2026-08-02T10:01:00.000Z',
    ...overrides,
  }
}

describe('durable Auto B-roll jobs', () => {
  it('round-trips every downloaded placement and finds it after a simulated restart', async () => {
    const firstProcess = await store()
    await firstProcess.save(job())
    const secondProcess = new AutoBrollJobStore(firstProcess.rootPath)

    const recovered = await secondProcess.latestRecoverable('remotion-project-1', 'download-1')

    expect(recovered?.stage).toBe('downloading')
    expect(recovered?.placements).toEqual(job().placements)
    expect(recovered?.message).toContain('1 clips')
  })

  it('returns a ready result until it is acknowledged as saved', async () => {
    const jobs = await store()
    await jobs.save(job({ stage: 'ready', stats: {
      chunks: 2,
      chunksFailed: 0,
      moments: 3,
      searched: 3,
      providerFailures: 0,
      elapsedMs: 1_000,
    } }))

    expect((await jobs.latestRecoverable('remotion-project-1', 'download-1'))?.stage).toBe('ready')
    await jobs.acknowledge('auto-broll-job-1')
    expect(await jobs.latestRecoverable('remotion-project-1', 'download-1')).toBeUndefined()
    expect((await jobs.get('auto-broll-job-1'))?.stage).toBe('applied')
  })

  it('never automatically resumes a failed job', async () => {
    const jobs = await store()
    await jobs.save(job({ stage: 'failed', errorMessage: 'provider rejected the request' }))
    expect(await jobs.latestRecoverable('remotion-project-1', 'download-1')).toBeUndefined()
  })
})
