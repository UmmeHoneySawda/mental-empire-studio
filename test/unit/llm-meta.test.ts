import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/services/logger', () => ({
  logger: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }
}))

const { askMeta, extractMetaContent } = await import('../../electron/services/llm/meta')
const { backendsFor, createAutoBrollModel } = await import('../../electron/services/video-engine/broll/auto-model')
const { generateHookPlan } = await import('../../electron/services/video-engine/hook-generator')
const { generatePlanWithFallback } = await import('../../electron/services/effects')

function stubFetch(reply: { status: number; body: string; headers?: Record<string,string> } | Error) {
  if (reply instanceof Error) {
    vi.stubGlobal('fetch', async () => { throw reply })
  } else {
    vi.stubGlobal('fetch', async () => new Response(reply.body, { status: reply.status, headers: reply.headers ?? {} }))
  }
}

beforeEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env['ME_AUTO_BROLL_FIXTURE'] })

describe('meta header and extract', () => {
  it('extracts from output_text', () => {
    expect(extractMetaContent({ output_text: 'hello' })).toBe('hello')
  })
  it('extracts from output array', () => {
    expect(extractMetaContent({ output: [{ content: [{ text: 'a' }, { text: 'b' }] }] })).toBe('ab')
  })
  it('extracts from choices fallback', () => {
    expect(extractMetaContent({ choices: [{ message: { content: '{"x":1}' } }] })).toBe('{"x":1}')
  })
  it('returns empty on unknown shape (triggers empty-response error)', () => {
    expect(extractMetaContent({})).toBe('')
    expect(extractMetaContent(null)).toBe('')
  })
})

describe('meta error handling — no bug on api down / missing key / empty', () => {
  it('throws when no key', async () => {
    await expect(askMeta('', 'hi')).rejects.toThrow(/No Meta API key/)
  })
  it('redacts Bearer token in error when api returns 401 with body containing key', async () => {
    stubFetch({ status: 401, body: 'bad key Bearer meta_12345_secret' })
    await expect(askMeta('meta_12345_secret', 'hi')).rejects.toThrow(/\[redacted\]/)
    await expect(askMeta('meta_12345_secret', 'hi')).rejects.not.toThrow(/meta_12345/)
  })
  it('throws empty response when json has no text', async () => {
    stubFetch({ status: 200, body: '{}' })
    await expect(askMeta('k', 'hi')).rejects.toThrow(/empty response/i)
  })
  it('throws non-JSON error', async () => {
    vi.stubGlobal('fetch', async () => new Response('not json', { status: 200 }))
    // mock json() to throw — use response that json() fails
    // Our implementation catches json parse failure
    // Simulate by stubbing fetch to return response where json throws
    vi.stubGlobal('fetch', async () => ({
      ok: true, status: 200, headers: new Headers(),
      text: async () => 'not json',
      json: async () => { throw new Error('invalid json') }
    } as unknown as Response))
    await expect(askMeta('k', 'hi')).rejects.toThrow(/no JSON/i)
  })
  it('network down is redacted and not leaked', async () => {
    stubFetch(new Error('fetch failed ECONNREFUSED'))
    await expect(askMeta('k', 'hi')).rejects.toThrow(/fetch failed/i)
  })
  it('timeout is surfaced as timed out (AbortError)', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    stubFetch(abortErr)
    await expect(askMeta('k', 'hi')).rejects.toThrow(/timed out/i)
  })
})

describe('hook-generator falls back meta -> groq', () => {
  it('uses meta when meta key present (groq not called)', async () => {
    const valid = { schemaVersion: 1, rendererId: 'remotion', templateId: 'tpl', fps: 30, title: 'T', durationFrames: 90, beats: [{ id: 'b1', startFrame: 0, durationFrames: 90, visual: { kind: 'none' } }] }
    const hookJson = JSON.stringify(valid)
    let urls: string[] = []
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('api.meta.ai')) return new Response(JSON.stringify({ output_text: hookJson }), { status: 200 })
      return new Response(JSON.stringify({ choices: [{ message: { content: hookJson } }] }), { status: 200 })
    })
    const plan = await generateHookPlan({ apiKey: 'gsk_x', metaApiKey: 'meta_y', prompt: 'p', fps: 30, durationFrames: 90 })
    expect(plan.beats.length).toBe(1)
    expect(urls[0]).toContain('api.meta.ai')
    expect(urls.filter(u=>u.includes('groq.com')).length).toBe(0)
  })
  it('falls back to groq when meta fails', async () => {
    const valid = { schemaVersion: 1, rendererId: 'remotion', templateId: 'tpl', fps: 30, title: 'T', durationFrames: 90, beats: [{ id: 'b1', startFrame: 0, durationFrames: 90, visual: { kind: 'none' } }] }
    const hookJson = JSON.stringify(valid)
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input)
      if (url.includes('api.meta.ai')) return new Response('meta down', { status: 500 })
      return new Response(JSON.stringify({ choices: [{ message: { content: hookJson } }] }), { status: 200 })
    })
    const plan = await generateHookPlan({ apiKey: 'gsk_x', metaApiKey: 'meta_y', prompt: 'p', fps: 30, durationFrames: 90 })
    expect(plan.beats.length).toBe(1)
  })
  it('throws redacted when both missing', async () => {
    await expect(generateHookPlan({ apiKey: '', metaApiKey: '', prompt: 'p', fps: 30, durationFrames: 90 })).rejects.toThrow(/No Meta or Groq/)
  })
  it('throws when api returns empty (no crash)', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({}), { status: 200 }))
    await expect(generateHookPlan({ apiKey: 'gsk_x', prompt: 'p', fps: 30, durationFrames: 90 })).rejects.toThrow()
  })
})

describe('effects fallback', () => {
  it('prefers meta and falls back to groq', async () => {
    const words = [{ id: 'w1', projectId: 'p1', ord: 0, word: 'hello', start: 0, end: 0.5, emphasis: false }]
    // Stub meta to fail then groq to succeed with valid effect plan
    let metaCalled = 0
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input)
      if (url.includes('api.meta.ai')) { metaCalled++; return new Response('down', { status: 500 }) }
      // Groq response must be valid effectPlan JSON
      const valid = JSON.stringify({ transitions: [], textEffects: [] })
      return new Response(JSON.stringify({ choices: [{ message: { content: valid } }] }), { status: 200 })
    })
    const res = await generatePlanWithFallback({ metaKey: 'meta_k', groqKey: 'gsk_k' }, words as any, 'Cinematic', 10)
    expect(res.plan).toBeDefined()
    expect(metaCalled).toBe(1)
  })
  it('throws when both keys missing', async () => {
    await expect(generatePlanWithFallback({ groqKey: '', metaKey: '' }, [], 'None', 5)).rejects.toThrow(/No Meta or Groq/)
  })
})

describe('auto-model ladder includes meta first', () => {
  it('orders meta before groq and gemini', () => {
    const names = backendsFor({ metaApiKey: 'm', groqApiKey: 'g', geminiApiKey: 'a' }).map(b=>b.name)
    expect(names[0]).toBe('meta')
    expect(names[1]).toBe('groq')
  })
  it('uses meta when configured, fails over to groq', async () => {
    process.env['ME_GEMINI_MODELS'] = 'flash-lite-test'
    const calls: string[] = []
    // Meta exhausted (TPD) is finished immediately; ladder steps to groq without 4 retries.
    const replies: Array<{ status: number; body: string }> = [
      { status: 429, body: 'TPD limit reached' },
      { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"moments":[]}' } }] }) }
    ]
    vi.stubGlobal('fetch', async (input: string) => {
      const url = String(input)
      calls.push(url.includes('api.meta.ai') ? 'meta' : url.includes('groq.com') ? 'groq' : url.includes('googleapis.com') ? 'gemini' : url)
      const r = replies.shift()!
      return new Response(r.body, { status: r.status })
    })
    const ask = createAutoBrollModel({ metaApiKey: 'meta_k', groqApiKey: 'gsk_k' })
    await expect(ask('hi')).resolves.toContain('moments')
    expect(calls).toEqual(['meta', 'groq'])
  })
  it('still throws nicely with no keys', () => {
    expect(()=>createAutoBrollModel({})).toThrow(/Meta.*Groq.*Gemini|API key/i)
  })
})
