import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* The Auto B-roll model layer and the honesty of what providers say about a clip.
 *
 * Both halves here are things fixtures could not catch and only real keys exposed
 * (PROGRESS.md §"Live verification with the user's real provider keys"): a tokens-per-day
 * 429 retried as if it were a tokens-per-minute one, and Pexels echoing the search query
 * back as the clip's title so that every candidate matched every query for free.
 */

// The module under test logs through electron-log, which needs a running Electron app.
vi.mock('../../../electron/services/logger', () => ({
  logger: { scope: () => ({ info: () => {}, warn: () => {}, error: () => {} }) }
}))

// Pin the Gemini rungs. What is under test is "one model's daily budget runs out, so try
// the next model" — not which models happen to ship in the default ladder, which is a fact
// about Google's catalogue and will change.
process.env['ME_GEMINI_MODELS'] = 'flash-lite-test,flash-test'

const { backendsFor, createAutoBrollModel, isExhaustedQuota, retryAfterFrom } =
  await import('../../../electron/services/video-engine/broll/auto-model')
const { PexelsBrollProvider } =
  await import('../../../electron/services/video-engine/broll/providers/pexels')
const { PixabayBrollProvider } =
  await import('../../../electron/services/video-engine/broll/providers/pixabay')
const { CoverrBrollProvider } =
  await import('../../../electron/services/video-engine/broll/providers/coverr')

type Reply = { status: number; body: string; headers?: Record<string, string> }

/** Queued replies, consumed in order, keyed by which host was asked. */
let replies: Reply[] = []
const calls: string[] = []

function stubFetch(): void {
  vi.stubGlobal('fetch', async (input: URL | string) => {
    const url = String(input instanceof URL ? input.href : input)
    calls.push(url.includes('groq.com') ? 'groq' : url.includes('googleapis.com') ? 'gemini' : url)
    const reply = replies.shift() ?? { status: 200, body: '{}' }
    return new Response(reply.body, { status: reply.status, headers: reply.headers ?? {} })
  })
}

const groqOk = (content: string): Reply => ({
  status: 200,
  body: JSON.stringify({ choices: [{ message: { content } }] })
})
const geminiOk = (...parts: string[]): Reply => ({
  status: 200,
  body: JSON.stringify({ candidates: [{ content: { parts: parts.map((text) => ({ text })) } }] })
})

beforeEach(() => {
  replies = []
  calls.length = 0
  delete process.env['ME_AUTO_BROLL_FIXTURE']
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Also covers the setTimeout spy below, which would otherwise leak if its test threw.
  vi.restoreAllMocks()
})

describe('a spent daily quota is not waited out', () => {
  it('reads a daily limit out of the 429 body, whatever words it uses', () => {
    expect(isExhaustedQuota(429, 'Rate limit reached: TPD limit for model', 0)).toBe(true)
    expect(isExhaustedQuota(429, 'you have exceeded your requests per day', 0)).toBe(true)
    expect(isExhaustedQuota(429, 'daily quota exceeded', 0)).toBe(true)
    // A per-minute limit is a wait, not a wall — it must stay on the retry ladder.
    expect(isExhaustedQuota(429, 'Rate limit reached: TPM. try again in 8.5s', 8_500)).toBe(false)
    // …and so is anything that is not a 429 at all.
    expect(isExhaustedQuota(500, 'daily quota exceeded', 0)).toBe(false)
  })

  it('recognises a daily wall that only announces itself in CamelCase', () => {
    // Google's real answer to a spent daily budget. The human-readable message promises a
    // 31-second wait; only the machine-readable `quotaId` says the budget is gone until
    // tomorrow. Reading the prose alone means retrying a hard wall until the run times out
    // — which is exactly what happened, and it is the TPD defect in different clothing.
    const body = JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota, please check your plan and billing '
          + 'details. * Quota exceeded for metric: '
          + 'generativelanguage.googleapis.com/generate_content_free_tier_requests, '
          + 'limit: 20, model: gemini-3.6-flash\nPlease retry in 31.490252191s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [{
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }]
        }]
      }
    })
    expect(isExhaustedQuota(429, body, 31_490)).toBe(true)
    // The per-MINUTE quota from the same API is still a wait, not a wall.
    expect(isExhaustedQuota(429, JSON.stringify({
      error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] }
    }), 31_490)).toBe(false)
  })

  const dailyWall = {
    status: 429,
    body: '{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}'
  }

  it('moves to the next Google MODEL when one model’s daily budget is gone', async () => {
    // The free-tier budget is granted per model, so a model that has run out for the day
    // says nothing about the next one. One key is several independent daily budgets.
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [dailyWall, geminiOk('{"moments":[]}')]
    await expect(ask('window one')).resolves.toContain('moments')
    expect(calls).toEqual(['gemini', 'gemini'])
  })

  it('names the model it moved to, since one key is several rungs', async () => {
    const failovers: string[] = []
    const ask = createAutoBrollModel(
      { geminiApiKey: 'AIza_test' },
      { onFailover: (from, to) => { failovers.push(`${from}->${to}`) } }
    )
    replies = [dailyWall, geminiOk('{"moments":[]}')]
    await ask('window one')
    expect(failovers).toEqual(['gemini/flash-lite-test->gemini/flash-test'])
  })

  it('announces the handover once, not once per window in flight', async () => {
    // Both windows in flight meet the same wall before either has marked it. Observed live:
    // the same "flash-latest quota spent" notice twice, which reads as it running out twice.
    const failovers: string[] = []
    const ask = createAutoBrollModel(
      { geminiApiKey: 'AIza_test' },
      { onFailover: (from, to) => { failovers.push(`${from}->${to}`) } }
    )
    replies = [dailyWall, dailyWall, geminiOk('{"moments":[]}'), geminiOk('{"moments":[]}')]
    await Promise.all([ask('window one'), ask('window two')])
    expect(failovers).toEqual(['gemini/flash-lite-test->gemini/flash-test'])
  })

  it('gives up promptly once every rung is spent', async () => {
    const ask = createAutoBrollModel({ groqApiKey: 'gsk_test', geminiApiKey: 'AIza_test' })
    replies = [{ status: 429, body: 'Rate limit reached: TPD limit' }, dailyWall, dailyWall]
    await expect(ask('window one')).rejects.toThrow()
    // One request per rung — not four attempts each against three spent budgets.
    expect(calls).toEqual(['groq', 'gemini', 'gemini'])
  })

  it('says the budget is gone once every rung is spent, instead of “undefined”', async () => {
    // A 22-minute video is eleven windows. Once they are all spent, the remaining windows
    // find nothing to run and would report the literal string "undefined" as the reason —
    // a bug shown to the user in place of the one fact they need.
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [dailyWall, dailyWall]
    await expect(ask('window one')).rejects.toThrow()
    calls.length = 0
    await expect(ask('window two')).rejects.toThrow(/run out of quota/i)
    // And it costs no further requests, because the answer cannot change.
    expect(calls).toEqual([])
  })

  it('drops a model this key cannot reach instead of asking again every window', async () => {
    // A 404 model does not start existing partway through a run; leaving it in the ladder
    // costs one guaranteed failure per window.
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [
      { status: 404, body: 'models/flash-lite-test is not found' },
      geminiOk('{"moments":[]}'),
      geminiOk('{"moments":[]}')
    ]
    await ask('window one')
    await ask('window two')
    expect(calls).toEqual(['gemini', 'gemini', 'gemini'])
  })

  it('offers one rung per Google model, plus Groq', () => {
    expect(backendsFor({ groqApiKey: 'g', geminiApiKey: 'a' }).map((b) => b.name))
      .toEqual(['groq', 'gemini/flash-lite-test', 'gemini/flash-test'])
    expect(backendsFor({ geminiApiKey: 'a' })).toHaveLength(2)
    expect(backendsFor({ groqApiKey: 'g' })).toHaveLength(1)
    expect(backendsFor({})).toHaveLength(0)
  })

  it('treats an hours-long retry-after as a wall even when the body says nothing', () => {
    // The cap on a single wait is 35s. Being asked for four hours and answering with four
    // 35s waits is how a run spent its entire duration sitting out a limit that resets at
    // midnight — and still lost every window.
    expect(isExhaustedQuota(429, 'slow down', 4 * 60 * 60 * 1000)).toBe(true)
    expect(isExhaustedQuota(429, 'slow down', 30_000)).toBe(false)
  })

  it('reads the wait from a header, from either provider’s prose, and from retryDelay', () => {
    const from = (body: string, headers: Record<string, string> = {}): number =>
      retryAfterFrom(new Response('', { headers }), body)
    expect(from('', { 'retry-after': '12' })).toBe(12_000)
    // Groq's wording…
    expect(from('Rate limit reached. Please try again in 7.5s')).toBe(7_500)
    // …and Gemini's, which is different enough to have been missed entirely.
    expect(from('Quota exceeded for metric: … Please retry in 39.5877581s.')).toBe(39_587.7581)
    expect(from('{"error":{"details":[{"retryDelay":"31s"}]}}')).toBe(31_000)
    expect(from('no idea')).toBe(0)
  })

  it('finds the hint even when the provider buries it past a wall of documentation', async () => {
    // Gemini's 429 leads with two paragraphs of links and names the wait at the very end.
    // Parsing a truncated body threw the number away and four windows of a run died for it.
    const body = JSON.stringify({
      error: {
        code: 429,
        message: `You exceeded your current quota, please check your plan and billing `
          + `details. For more information on this error, head to: `
          + `https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current `
          + `usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: `
          + `generativelanguage.googleapis.com/generate_content_free_tier_requests, `
          + `limit: 5\nPlease retry in 39.5877581s.`,
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '39s' }]
      }
    })
    expect(body.length).toBeGreaterThan(400)

    // A named wait is honoured past the 35s guessed-backoff cap, so the window survives.
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [{ status: 429, body }, geminiOk('{"moments":[]}')]
    const waits: number[] = []
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0)
      fn()
      return 0 as unknown as NodeJS.Timeout
    }) as typeof setTimeout)
    await expect(ask('window one')).resolves.toContain('moments')
    expect(waits[0]).toBeGreaterThan(35_000)
    expect(waits[0]).toBeLessThanOrEqual(120_000)
  })

  it('asks a spent provider exactly once, instead of four times per window', async () => {
    const ask = createAutoBrollModel({ groqApiKey: 'gsk_test', geminiApiKey: 'AIza_test' })
    replies = [
      { status: 429, body: 'Rate limit reached: TPD limit for llama-3.3-70b-versatile' },
      geminiOk('{"moments":[]}')
    ]
    await expect(ask('window one')).resolves.toContain('moments')
    expect(calls).toEqual(['groq', 'gemini'])
  })

  it('does not re-test a spent key on every later window', async () => {
    // Eleven windows share one daily budget, so re-testing a spent key is eleven
    // guaranteed failures and eleven wasted round trips.
    const ask = createAutoBrollModel({ groqApiKey: 'gsk_test', geminiApiKey: 'AIza_test' })
    replies = [
      { status: 429, body: 'TPD limit reached' },
      geminiOk('{"moments":[]}'),
      geminiOk('{"moments":[]}'),
      geminiOk('{"moments":[]}')
    ]
    await ask('window one')
    await ask('window two')
    await ask('window three')
    expect(calls).toEqual(['groq', 'gemini', 'gemini', 'gemini'])
  })

  it('announces the handover, which otherwise looks like a stall', async () => {
    const failovers: string[] = []
    const ask = createAutoBrollModel(
      { groqApiKey: 'gsk_test', geminiApiKey: 'AIza_test' },
      { onFailover: (from, to) => { failovers.push(`${from}->${to}`) } }
    )
    replies = [{ status: 429, body: 'TPD limit reached' }, geminiOk('{"moments":[]}')]
    await ask('window one')
    expect(failovers).toEqual(['groq->gemini/flash-lite-test'])
  })

  it('makes one worker’s rate-limit wait apply to all of them', async () => {
    // A rate limit belongs to the key, not to the caller. Without a shared gate the two
    // windows in flight each discover the same closed window, each burn their attempts on
    // it, and each report a lost window — how Gemini's five-requests-a-minute tier lost six
    // of eleven windows across eighteen separate waits.
    const at: number[] = []
    vi.stubGlobal('fetch', async () => {
      at.push(Date.now())
      const reply = replies.shift() ?? { status: 200, body: '{}' }
      return new Response(reply.body, { status: reply.status })
    })
    replies = [
      { status: 429, body: 'Quota exceeded. Please retry in 0.5s.' },
      geminiOk('{"moments":[]}'),
      geminiOk('{"moments":[]}')
    ]

    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    const first = ask('window one')
    // Let the first window meet the limit and publish the wait before the second starts.
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    const second = ask('window two')
    await Promise.all([first, second])

    expect(at).toHaveLength(3)
    // The second window never fires into the window it was already told was closed: both
    // remaining requests land after the wait, not one of them during it.
    expect(Math.min(at[1]!, at[2]!) - at[0]!).toBeGreaterThanOrEqual(400)
  }, 20_000)

  it('still waits out a per-minute 429 rather than burning the second key on it', async () => {
    // A limit that clears itself in seconds must not cost the fallback's budget.
    const ask = createAutoBrollModel({ groqApiKey: 'gsk_test', geminiApiKey: 'AIza_test' })
    replies = [
      { status: 429, body: 'Rate limit reached: TPM. Please try again in 0.1s' },
      groqOk('{"moments":[]}')
    ]
    await expect(ask('window one')).resolves.toContain('moments')
    expect(calls).toEqual(['groq', 'groq'])
  }, 20_000)
})

describe('the model ladder', () => {
  it('runs on Gemini alone when that is the only key', async () => {
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [geminiOk('{"moments":[]}')]
    await expect(ask('window one')).resolves.toContain('moments')
    expect(calls).toEqual(['gemini'])
  })

  it('joins Gemini answer parts, which arrive split when the model reasons first', async () => {
    const ask = createAutoBrollModel({ geminiApiKey: 'AIza_test' })
    replies = [geminiOk('{"moments":', '[{"startSec":0,"endSec":4,"query":"misty forest path"}]}')]
    await expect(ask('window one')).resolves
      .toBe('{"moments":[{"startSec":0,"endSec":4,"query":"misty forest path"}]}')
  })

  it('refuses to start with no key at all', () => {
    expect(() => createAutoBrollModel({})).toThrow(/API key/i)
  })

  it('keeps the API key out of the error it reports', async () => {
    const ask = createAutoBrollModel({ geminiApiKey: 'AIzaSyD_secret_key_value_here' })
    // A 400 is terminal per rung, so this is one call each and no waiting. Both rungs are
    // fed it, because the last error is the one reported.
    replies = [
      { status: 400, body: 'bad key AIzaSyD_secret_key_value_here rejected' },
      { status: 400, body: 'bad key AIzaSyD_secret_key_value_here rejected' }
    ]
    const failure = await ask('window one').catch((error: unknown) => error as Error)
    expect(failure.message).toContain('[redacted]')
    expect(failure.message).not.toContain('AIzaSyD_secret')
  })

  it('still short-circuits to a recorded answer for the E2E', async () => {
    process.env['ME_AUTO_BROLL_FIXTURE'] = 'test/fixtures/broll/auto-answer.json'
    const ask = createAutoBrollModel({})
    await expect(ask('window one')).resolves.toContain('moments')
    expect(calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------- providers

describe('a provider describes the clip, never the query', () => {
  const query = {
    query: 'dog waiting by door',
    perPage: 3,
    orientation: 'landscape' as const,
    minDurationMs: 3000
  }

  it('reads a real description out of the Pexels URL slug', async () => {
    // Pexels' video endpoint returns no title and an empty `tags` array, so `title` used to
    // be set to the search query — which handed every Pexels candidate a perfect relevance
    // match on content it had never been compared against. The public URL carries the only
    // description the provider offers, and it is a good one.
    replies = [{
      status: 200,
      body: JSON.stringify({
        videos: [{
          id: 5357497,
          width: 3840,
          height: 2160,
          duration: 8,
          url: 'https://www.pexels.com/video/dog-in-front-of-the-door-5357497/',
          image: 'https://images.pexels.com/videos/5357497/dog.jpeg',
          tags: [],
          user: { name: 'Digi sim', url: 'https://www.pexels.com/@iofilms' },
          video_files: [{
            id: 1, quality: 'hd', file_type: 'video/mp4',
            width: 1920, height: 1080,
            link: 'https://videos.pexels.com/video-files/5357497/x-hd.mp4'
          }]
        }]
      })
    }]
    const [candidate] = await new PexelsBrollProvider('key').search(query)
    expect(candidate!.title).toBe('dog in front of the door')
    expect(candidate!.title).not.toBe(query.query)
    expect(candidate!.tags).toEqual(['dog', 'in', 'front', 'of', 'the', 'door'])
  })

  it('falls back to something content-free, not to the query', async () => {
    // If the URL shape ever changes, the honest answer is "we do not know what this shows".
    // Falling back to the query would silently restore the free relevance bonus.
    replies = [{
      status: 200,
      body: JSON.stringify({
        videos: [{
          id: 42, width: 1920, height: 1080, duration: 8,
          url: 'https://www.pexels.com/', image: 'x', tags: [],
          user: { name: 'A', url: 'b' },
          video_files: [{ id: 1, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'x.mp4' }]
        }]
      })
    }]
    const [candidate] = await new PexelsBrollProvider('key').search(query)
    expect(candidate!.title).toBe('Pexels video 42')
    expect(candidate!.tags).toEqual([])
  })

  it('does not let Pixabay or Coverr fall back to the query either', async () => {
    replies = [{
      status: 200,
      body: JSON.stringify({
        hits: [{
          id: 7, pageURL: 'https://pixabay.com/videos/x-7/', tags: '', duration: 9, user: 'u',
          videos: { large: { url: 'x.mp4', width: 1920, height: 1080, size: 1, thumbnail: 't.jpg' } }
        }]
      })
    }]
    const [fromPixabay] = await new PixabayBrollProvider('key').search(query)
    expect(fromPixabay!.title).toBe('Pixabay video 7')

    replies = [{
      status: 200,
      body: JSON.stringify({
        hits: [{
          id: 'cv1', title: '', description: 'a quiet street at dawn',
          max_width: 1920, max_height: 1080, duration: 9,
          urls: { mp4_download: 'x.mp4' }
        }]
      })
    }]
    const [fromCoverr] = await new CoverrBrollProvider('key').search(query)
    expect(fromCoverr!.title).toBe('a quiet street at dawn')
    expect(fromCoverr!.tags).toEqual([])
  })
})
