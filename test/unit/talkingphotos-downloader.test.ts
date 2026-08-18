import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readdirSync, type WriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS } from '../../shared/talkingphotos'

// Output downloader: .part-file lifecycle, media validation, and "always refresh
// before retry" (signed CDN URLs are not durable — plan §17). Network (net.request),
// the DB repo, the remote project lookup, and ffprobe duration are all faked so the
// test exercises the real node:fs .part -> validate -> atomic-rename flow on disk.

const userDataDir = mkdtempSync(join(tmpdir(), 'me-tp-dl-userdata-'))

const trackedWriteStreams = vi.hoisted(() => [] as WriteStream[])
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createWriteStream: ((...args: unknown[]) => {
      const stream = (actual.createWriteStream as unknown as (...writeArgs: unknown[]) => WriteStream)(...args)
      trackedWriteStreams.push(stream)
      return stream
    }) as typeof actual.createWriteStream
  }
})

let nextStreamBehavior:
  | 'ok'
  | 'network-error'
  | 'request-error-after-response'
  | 'http-error'
  | 'hang'
  | 'slow-active'
  | 'stalled-after-data'
  | 'active-until-overall-timeout' = 'ok'
let streamBody = Buffer.from('fake-mp4-bytes')
let lastRequestedUrl = ''
let requestedUrls: string[] = []
/** Fails only the request whose URL matches this predicate — lets a test make the
 *  preferred route fail while the CDN fallback still succeeds. */
let failWhenUrlMatches: ((url: string) => boolean) | null = null

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
  net: {
    request: (opts: { url: string }) => {
      lastRequestedUrl = opts.url
      requestedUrls.push(opts.url)
      const behavior = failWhenUrlMatches?.(opts.url) ? 'http-error' : nextStreamBehavior
      const req = new EventEmitter() as EventEmitter & { setHeader: () => void; write: () => void; end: () => void }
      req.setHeader = () => {}
      req.write = () => {}
      req.end = () => {
        queueMicrotask(() => {
          // 'hang': never emits response/error/end — the stalled net.request that used
          // to hold a download slot forever, because downloadOnce had no timeout.
          if (behavior === 'hang') return
          if (behavior === 'network-error') { req.emit('error', new Error('ECONNRESET')); return }
          const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
          res.statusCode = behavior === 'http-error' ? 403 : 200
          res.headers = { 'content-disposition': 'attachment; filename="server-suggested ../evil.mp4"' }
          req.emit('response', res)
          if (behavior === 'ok') {
            queueMicrotask(() => {
              res.emit('data', streamBody)
              res.emit('end')
            })
          } else if (behavior === 'slow-active') {
            for (let chunk = 1; chunk <= 5; chunk++) {
              setTimeout(() => {
                res.emit('data', streamBody)
                if (chunk === 5) res.emit('end')
              }, chunk * 30_000)
            }
          } else if (behavior === 'stalled-after-data') {
            res.emit('data', streamBody)
          } else if (behavior === 'active-until-overall-timeout') {
            for (let chunk = 1; chunk <= 60; chunk++) {
              setTimeout(() => res.emit('data', streamBody), chunk * 30_000)
            }
          } else if (behavior === 'request-error-after-response') {
            res.emit('data', streamBody)
            const out = trackedWriteStreams.at(-1)
            if (!out) throw new Error('Expected the downloader to open its partial file before streaming.')
            out.once('open', () => req.emit('error', new Error('ECONNRESET after response started')))
          }
        })
      }
      return req
    }
  },
  session: { fromPartition: () => ({ __sentinel: 'session' }) }
}))

let remoteProject: { id: string; mediaUrl?: string; mediaDurationSec?: number } | null = null
vi.mock('../../electron/providers/talkingphotos/client', () => ({
  getProject: vi.fn(async () => remoteProject)
}))

let nextProbedDuration = 275.5
vi.mock('../../electron/services/audio', () => ({
  probeDuration: vi.fn(async () => nextProbedDuration)
}))

interface FakeJob {
  id: string
  remoteProjectId?: string
  status: string
  localOutputPath?: string
  downloadedAt?: string
  errorMessage?: string
  errorCode?: string
  downloadAttempts?: number
  remoteMediaUrl?: string
}
const jobStore = new Map<string, FakeJob>()
vi.mock('../../electron/db', () => ({
  getRepos: () => ({
    providerJob: (id: string) => jobStore.get(id),
    updateProviderJob: (id: string, patch: Partial<FakeJob>) => {
      const current = jobStore.get(id)
      if (current) jobStore.set(id, { ...current, ...patch })
    }
  })
}))

const { downloadProviderJobOutput, ProviderDownloadFailure } = await import('../../electron/providers/talkingphotos/downloader')
const { getProject } = await import('../../electron/providers/talkingphotos/client')

function outputDir(): string {
  return join(userDataDir, 'talkingphotos-output')
}

beforeEach(() => {
  jobStore.clear()
  jobStore.set('job-1', { id: 'job-1', remoteProjectId: 'proj-1', status: 'downloading' })
  remoteProject = { id: 'proj-1', mediaUrl: 'https://cdn.talkingphotos.ai/v1/out.mp4', mediaDurationSec: 275.5 }
  nextStreamBehavior = 'ok'
  nextProbedDuration = 275.5
  lastRequestedUrl = ''
  requestedUrls = []
  failWhenUrlMatches = null
  trackedWriteStreams.length = 0
  vi.mocked(getProject).mockClear()
})

describe('TalkingPhotos output downloader', () => {
  it('downloads, validates, and atomically completes — the .part file is gone and only the final file remains', async () => {
    const job = await downloadProviderJobOutput('job-1')
    expect(job.status).toBe('completed')
    expect(job.localOutputPath).toBeTruthy()
    expect(existsSync(job.localOutputPath!)).toBe(true)
    expect(existsSync(`${job.localOutputPath}.part`)).toBe(false)
    // Only trustworthy, non-cookie fields ever leave this module.
    expect(Object.keys(job).sort()).toEqual(['downloadAttempts', 'downloadedAt', 'errorCode', 'errorMessage', 'id', 'localOutputPath', 'remoteMediaUrl', 'remoteProjectId', 'status'].sort())
  })

  it('always refreshes the project detail before (re)downloading — never reuses a stale stored URL', async () => {
    await downloadProviderJobOutput('job-1')
    remoteProject = { id: 'proj-1', mediaUrl: 'https://cdn.talkingphotos.ai/v2/refreshed.mp4', mediaDurationSec: 275.5 }
    await downloadProviderJobOutput('job-1')
    expect(getProject).toHaveBeenCalledTimes(2)
    expect(lastRequestedUrl).toBe('https://cdn.talkingphotos.ai/v2/refreshed.mp4')
  })

  it('cleans up the .part file and keeps the job retryable (not "failed") on a network error', async () => {
    nextStreamBehavior = 'network-error'
    await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
    const job = jobStore.get('job-1')!
    expect(job.status).toBe('downloading') // preserved for retry, not flipped to 'failed'
    expect(job.errorMessage).toBeTruthy()
    const leftoverParts = readdirSync(outputDir()).filter((f) => f.endsWith('.part'))
    expect(leftoverParts).toEqual([])
  })

  it('closes the partial-file handle before rejecting a request error after the response starts', async () => {
    nextStreamBehavior = 'request-error-after-response'
    try {
      await expect(downloadProviderJobOutput('job-1')).rejects.toThrow(/ECONNRESET/)
      const out = trackedWriteStreams.at(-1)
      expect(out).toBeDefined()
      expect(out?.destroyed).toBe(true)
      expect(out?.closed).toBe(true)
      expect(readdirSync(outputDir()).filter((f) => f.endsWith('.part'))).toEqual([])
    } finally {
      for (const out of trackedWriteStreams) {
        if (!out.destroyed) out.destroy()
      }
    }
  })

  it('cleans up the .part file on an HTTP error from the CDN', async () => {
    nextStreamBehavior = 'http-error'
    await expect(downloadProviderJobOutput('job-1')).rejects.toThrow(/403/)
    const leftoverParts = readdirSync(outputDir()).filter((f) => f.endsWith('.part'))
    expect(leftoverParts).toEqual([])
  })

  it('rejects a downloaded file that is not a readable media container (ffprobe duration 0) and does not mark the job completed', async () => {
    nextProbedDuration = 0
    await expect(downloadProviderJobOutput('job-1')).rejects.toThrow(ProviderDownloadFailure)
    const job = jobStore.get('job-1')!
    expect(job.status).not.toBe('completed')
    expect(job.localOutputPath).toBeUndefined()
  })

  it('refuses to stream from a host other than the TalkingPhotos CDN', async () => {
    remoteProject = { id: 'proj-1', mediaUrl: 'https://attacker.example.com/out.mp4' }
    await expect(downloadProviderJobOutput('job-1')).rejects.toThrow(ProviderDownloadFailure)
  })

  it('throws (rather than silently no-oping) when the project has no output yet', async () => {
    remoteProject = { id: 'proj-1' }
    await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
  })

  // A failed download used to reset status to 'downloading' forever: the poller
  // re-derived 'downloading' from the completed remote and re-fired, once per ladder
  // tick, for the life of the process. The attempt counter is what makes it finite.
  describe('retry bounding', () => {
    it('stays retryable while under the attempt cap, incrementing the counter each failure', async () => {
      nextStreamBehavior = 'network-error'
      await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
      expect(jobStore.get('job-1')!.downloadAttempts).toBe(1)
      expect(jobStore.get('job-1')!.status).toBe('downloading')

      await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
      expect(jobStore.get('job-1')!.downloadAttempts).toBe(2)
      expect(jobStore.get('job-1')!.status).toBe('downloading')
    })

    it('parks the job in attention once the cap is reached, ending the infinite retry loop', async () => {
      nextStreamBehavior = 'network-error'
      for (let i = 0; i < TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS; i++) {
        await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
      }
      const job = jobStore.get('job-1')!
      expect(job.downloadAttempts).toBe(TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS)
      expect(job.status).toBe('attention')
      expect(job.errorCode).toBe('download_failed')
    })

    it('resets the counter on a success, so an earlier bad patch does not park a healthy job later', async () => {
      nextStreamBehavior = 'network-error'
      await expect(downloadProviderJobOutput('job-1')).rejects.toThrow()
      expect(jobStore.get('job-1')!.downloadAttempts).toBe(1)

      nextStreamBehavior = 'ok'
      const job = await downloadProviderJobOutput('job-1')
      expect(job.status).toBe('completed')
      expect(job.downloadAttempts).toBe(0)
    })

    it('allows a healthy download to run past two minutes while bytes keep arriving', async () => {
      vi.useFakeTimers()
      try {
        nextStreamBehavior = 'slow-active'
        const pending = downloadProviderJobOutput('job-1')
        const assertion = expect(pending).resolves.toMatchObject({ status: 'completed' })
        await vi.advanceTimersByTimeAsync(151_000)
        await assertion
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    })

    it('times out after 60 seconds without receiving another byte', async () => {
      vi.useFakeTimers()
      try {
        nextStreamBehavior = 'stalled-after-data'
        const pending = downloadProviderJobOutput('job-1')
        const assertion = expect(pending).rejects.toThrow(/stalled for 60000ms/i)
        await vi.advanceTimersByTimeAsync(61_000)
        await assertion
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      expect(readdirSync(outputDir()).filter((f) => f.endsWith('.part'))).toEqual([])
    })

    it('keeps a separate 30-minute ceiling even while bytes continue arriving', async () => {
      vi.useFakeTimers()
      try {
        nextStreamBehavior = 'active-until-overall-timeout'
        let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
        const pending = downloadProviderJobOutput('job-1')
        const observed = pending.then(
          () => { outcome = 'resolved' },
          () => { outcome = 'rejected' }
        )

        await vi.advanceTimersByTimeAsync(30 * 60_000 - 1000)
        expect(outcome).toBe('pending')
        await vi.advanceTimersByTimeAsync(2000)
        await observed
        expect(outcome).toBe('rejected')
        await expect(pending).rejects.toThrow(/maximum duration of 1800000ms/i)
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
    })

    it('times out a request that never receives a response', async () => {
      vi.useFakeTimers()
      try {
        nextStreamBehavior = 'hang'
        const pending = downloadProviderJobOutput('job-1')
        let rejection: Error | undefined
        let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
        void pending.then(
          () => { outcome = 'resolved' },
          (error: Error) => { outcome = 'rejected'; rejection = error }
        )
        await vi.advanceTimersByTimeAsync(61_000)
        expect(outcome).toBe('rejected')
        expect(rejection?.message).toMatch(/stalled for 60000ms/i)
      } finally {
        vi.clearAllTimers()
        vi.useRealTimers()
      }
      expect(readdirSync(outputDir()).filter((f) => f.endsWith('.part'))).toEqual([])
    })
  })

  describe('Phase 9: preferred /project/download/{id} route', () => {
    beforeEach(() => {
      jobStore.set('job-numeric', { id: 'job-numeric', remoteProjectId: '98765', status: 'downloading' })
      remoteProject = { id: '98765', mediaUrl: 'https://cdn.talkingphotos.ai/v1/out.mp4', mediaDurationSec: 275.5 }
    })

    it('tries the app-origin preferred route before the CDN for a numeric project id', async () => {
      await downloadProviderJobOutput('job-numeric')
      expect(requestedUrls[0]).toBe('https://app.talkingphotos.ai/project/download/98765')
    })

    it('falls back to the refreshed CDN url when the preferred route fails', async () => {
      failWhenUrlMatches = (url) => url.includes('/project/download/')
      const job = await downloadProviderJobOutput('job-numeric')
      expect(requestedUrls).toEqual(['https://app.talkingphotos.ai/project/download/98765', 'https://cdn.talkingphotos.ai/v1/out.mp4'])
      expect(job.status).toBe('completed')
    })

    it('never requests the preferred route for a non-numeric project id, going straight to the CDN', async () => {
      await downloadProviderJobOutput('job-1') // remoteProjectId 'proj-1' is not numeric
      expect(requestedUrls).toEqual(['https://cdn.talkingphotos.ai/v1/out.mp4'])
    })

    it('rejects a manipulated preferred-route URL outside the strict allowlist even if constructed', async () => {
      // Sanity check on the underlying validator the downloader relies on — a URL
      // that isn't exactly https://app.talkingphotos.ai/project/download/<id> must
      // never be attempted as the "preferred" route.
      const { isAllowedProjectDownloadUrl } = await import('../../shared/talkingphotos')
      expect(isAllowedProjectDownloadUrl('https://app.talkingphotos.ai/admin/download/98765')).toBe(false)
      expect(isAllowedProjectDownloadUrl('https://app.talkingphotos.ai/project/download/98765/../../etc/passwd')).toBe(false)
    })
  })
})
