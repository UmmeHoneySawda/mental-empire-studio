import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Session-bound request selection + reauth detection, exercised end-to-end against a
// fake Session.fetch — proves the client always binds to the TalkingPhotos partition
// session (never the global Node/undici fetch other services use) and that auth
// failures are classified before any body is trusted.

let lastRequestOpts: Record<string, unknown> | null = null
let lastHeaders: Record<string, string> = {}
let lastBody = Buffer.alloc(0)
let hangRequest = false
let nextResponse: { statusCode: number; headers: Record<string, string>; body: string } = {
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{}'
}
// Per-path overrides for tests that drive multiple concurrent endpoints (e.g.
// getCapabilities()'s Promise.all) where a single shared `nextResponse` can't
// distinguish which in-flight call is which.
let routedResponses: Record<string, { statusCode: number; headers: Record<string, string>; body: string }> = {}

const SESSION_SENTINEL = {
  __sentinel: 'talkingphotos-partition-session',
  fetch: async (url: string, init?: RequestInit) => {
    lastRequestOpts = {
      url,
      method: init?.method ?? 'GET',
      session: SESSION_SENTINEL,
      redirect: init?.redirect,
      hasAbortSignal: init?.signal instanceof AbortSignal
    }
    const rawHeaders = init?.headers
    lastHeaders = {}
    if (rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        lastHeaders[key.toLowerCase()] = value
      }
    }
    if (init?.body != null) {
      if (typeof init.body === 'string') lastBody = Buffer.from(init.body)
      else if (init.body instanceof Uint8Array) lastBody = Buffer.from(init.body)
      else if (Buffer.isBuffer(init.body)) lastBody = init.body
      else lastBody = Buffer.from(String(init.body))
    } else {
      lastBody = Buffer.alloc(0)
    }

    if (hangRequest) {
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = (): void => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        }
        if (init?.signal?.aborted) {
          onAbort()
          return
        }
        init?.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }

    const pathname = new URL(url).pathname
    const response = routedResponses[pathname] ?? nextResponse
    const headerMap = new Map(
      Object.entries(response.headers).map(([k, v]) => [k.toLowerCase(), v])
    )
    return {
      status: response.statusCode,
      headers: {
        get: (name: string) => headerMap.get(name.toLowerCase()) ?? null
      },
      text: async () => response.body
    } as Response
  }
}

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    getAppMetrics: () => [],
    getPath: () => '/tmp',
    getSystemMemoryInfo: () => ({ free: 0, total: 0 })
  },
  ipcMain: { handle: vi.fn() },
  session: { fromPartition: () => SESSION_SENTINEL }
}))

const { createHumanProject, fetchProviderJson, getCapabilities, getDurationLimit, healthCheck, uploadLibraryMedia } = await import('../../electron/providers/talkingphotos/client')

describe('TalkingPhotos session-bound client', () => {
  beforeEach(() => {
    lastRequestOpts = null
    lastHeaders = {}
    lastBody = Buffer.alloc(0)
    hangRequest = false
    nextResponse = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{}' }
    routedResponses = {}
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('binds every request to the TalkingPhotos partition session fetch, never the global fetch', async () => {
    await fetchProviderJson('/project/video_daily_usage')
    expect(lastRequestOpts?.session).toBe(SESSION_SENTINEL)
    expect(lastRequestOpts?.url).toContain('/project/video_daily_usage')
  })

  // Regression guard for the incident this transport replaced: the previous
  // net.request client paired `redirect: 'follow'` with a manual `followRedirect()`
  // call, which Chromium rejected with net::ERR_INVALID_ARGUMENT on any 3xx and took
  // down every provider call (including capabilities) at once. Session.fetch has no
  // such double-follow hazard, but this locks in the two properties that make it
  // safe: redirects are followed automatically (no manual re-follow to get wrong),
  // and every request carries an abort signal so a hung request can never wedge the
  // capabilities/sync/create paths open forever.
  it('requests redirect:"follow" (no manual re-follow) and a bounded abort signal', async () => {
    await fetchProviderJson('/project/video_daily_usage')
    expect(lastRequestOpts?.redirect).toBe('follow')
    expect(lastRequestOpts?.hasAbortSignal).toBe(true)
  })

  it('treats HTTP 401 as reauth-required, not a generic failure', async () => {
    nextResponse = { statusCode: 401, headers: {}, body: '' }
    await expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({ normalized: { kind: 'authentication' } })
  })

  it('treats HTTP 403 as reauth-required', async () => {
    nextResponse = { statusCode: 403, headers: {}, body: '' }
    await expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({ normalized: { kind: 'authentication' } })
  })

  it('treats an HTML body where JSON was expected as reauth-required', async () => {
    nextResponse = { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>please sign in</body></html>' }
    await expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({ normalized: { kind: 'authentication' } })
  })

  it('rejects malformed JSON as invalid_response rather than trusting a 200 status alone', async () => {
    nextResponse = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: 'not-json{' }
    await expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({ normalized: { kind: 'invalid_response' } })
  })

  it('classifies a 429 as rate_limited', async () => {
    nextResponse = { statusCode: 429, headers: {}, body: '{"message":"slow down"}' }
    await expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({ normalized: { kind: 'rate_limited' } })
  })

  it('parses a valid JSON body on success', async () => {
    nextResponse = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"dailyUsage":3,"dailyLimit":100}' }
    await expect(fetchProviderJson('/project/video_daily_usage')).resolves.toEqual({ dailyUsage: 3, dailyLimit: 100 })
  })

  it('accepts an authenticated health response when quota values are strings or nested', async () => {
    nextResponse = { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"data":{"dailyUsage":"3","dailyLimit":"100"}}' }
    await expect(healthCheck()).resolves.toEqual({ ok: true, reauthRequired: false })
    expect(lastRequestOpts?.url).toContain('/project/video_daily_usage')
  })

  // getCapabilities() is the exact call the original net::ERR_INVALID_ARGUMENT
  // incident died on (it's what the renderer's loadCapabilities() invokes on every
  // Talking Video screen load). It fires three concurrent requests via Promise.all,
  // so route by path rather than relying on a single shared `nextResponse`.
  it('resolves getCapabilities() from its three parallel endpoints', async () => {
    routedResponses = {
      '/project/video_duration_limit': { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"maxDuration":60,"maxCharactersTTS":400}' },
      '/project/concurrent_limit/human': { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"concurrentCount":1,"concurrentLimit":3}' },
      '/project/video_daily_usage': { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"dailyUsage":4,"dailyLimit":20}' }
    }
    const capabilities = await getCapabilities()
    expect(capabilities.limits).toMatchObject({ maxDurationSeconds: 60, maxCharactersTts: 400 })
    expect(capabilities.usage).toMatchObject({ concurrentCount: 1, concurrentLimit: 3, dailyUsage: 4, dailyLimit: 20 })
  })

  it('aborts and rejects a provider request that never responds', async () => {
    vi.useFakeTimers()
    hangRequest = true
    const rejected = expect(fetchProviderJson('/project/video_daily_usage')).rejects.toMatchObject({
      normalized: { kind: 'network' }
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
  })

  it('submits the confirmed Human project JSON through the partition-bound client', async () => {
    nextResponse.body = JSON.stringify({ id: 1041992, title: 'Video', type: 'human', style: 'high_quality', status: 'pending', createdDate: '', updatedDate: '' })
    const payload = { title: 'Video', type: 'human' as const, style: 'high_quality' as const, options: { audioSource: 'library', audioMediaId: 4140999, audioResultUuid: '', audioVocalUrl: '', ttsText: '', motionId: 0 } }
    await expect(createHumanProject(payload)).resolves.toMatchObject({ id: '1041992', type: 'human', status: 'pending' })
    expect(lastRequestOpts).toMatchObject({ method: 'POST', url: 'https://app.talkingphotos.ai/project', session: SESSION_SENTINEL })
    expect(JSON.parse(lastBody.toString())).toEqual(payload)
  })

  it('requests the style-specific Human duration limit', async () => {
    nextResponse.body = '{"maxDuration":60}'
    await expect(getDurationLimit('high_quality')).resolves.toBe(60)
    expect(lastRequestOpts).toMatchObject({ method: 'POST', url: 'https://app.talkingphotos.ai/project/video_duration_limit' })
    expect(JSON.parse(lastBody.toString())).toEqual({ projectType: 'human', projectStyle: 'high_quality' })
  })

  it('uploads multipart media with both file and type fields to the captured category route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'me-tp-client-'))
    const path = join(dir, 'voice.wav')
    writeFileSync(path, Buffer.from('wave-bytes'))
    nextResponse.body = JSON.stringify({ id: 4140998, title: 'voice', type: 'audio', extension: 'wav', categoryId: 163906, data: { duration: 829.2 } })
    try {
      await expect(uploadLibraryMedia(path, 'audio', '163906')).resolves.toMatchObject({ id: '4140998', durationSec: 829.2 })
      expect(lastRequestOpts).toMatchObject({ method: 'POST', url: 'https://app.talkingphotos.ai/library/categories/upload/163906' })
      expect(lastHeaders['content-type']).toContain('multipart/form-data; boundary=')
      expect(lastBody.toString()).toContain('name="file"; filename="voice.wav"')
      expect(lastBody.toString()).toContain('name="type"\r\n\r\naudio')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
