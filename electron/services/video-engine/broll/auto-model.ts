import { readFileSync } from 'node:fs'
import { logger } from '../../logger'
import { VideoEngineError } from '../errors'

/* The language model behind Auto B-roll.
 *
 * Groq's call shape is deliberately the same as `video-engine/hook-generator.ts` and
 * `services/effects.ts` — same endpoint, model, JSON response mode, timeout and redaction —
 * so there is one known-good way this app talks to Groq rather than three that drift.
 *
 * Two things this file has that the hook generator does not, and both are forced by the
 * workload rather than chosen. First a retry ladder: the hook generator makes one call per
 * video, Auto B-roll makes eleven for a 22-minute clip, which on a free-tier key reliably
 * meets a 429. `askGroq` in the hook generator has no retry and must not grow one for this —
 * a hook that fails is one banner, whereas a window that fails is a stretch of video with
 * no footage. Second a SECOND BACKEND: a free Groq key caps tokens per DAY, and a 22-minute
 * video is a large fraction of that budget, so the eleventh window of the second run of the
 * day meets a wall no amount of waiting clears. Gemini's free tier is far roomier, so a run
 * that exhausts Groq continues on Gemini instead of ending with half a timeline.
 */

const AUTO_LOG = logger.scope('auto-broll')
const REQUEST_TIMEOUT_MS = 45_000
const MAX_ATTEMPTS = 4
/** Longest single wait between attempts. A tokens-per-minute window rolls over inside
 *  this, and anything longer stops reading as "working" and starts reading as "hung". */
const MAX_BACKOFF_MS = 35_000

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Google models to try, in order, each on its own rung of the ladder.
 *
 * The free-tier quota is granted **per model** — Google's own words for a spent budget are
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — so a model that has run out for the
 * day says nothing about the next one. One key therefore buys several independent daily
 * budgets, and a run that would have stopped at the first wall simply steps to the next
 * model.
 *
 * Ordered lite-first. The job is writing four concrete words about a paragraph of
 * narration, not reasoning, so a Lite model is the right tool and not merely the cheap one.
 * `gemini-flash-latest` is last because it resolves to `gemini-3.6-flash`, whose free tier
 * is **twenty requests a day** — an eleven-window video is one run with nothing left for
 * retries, which is a decoration rather than a fallback. Verified against the live API:
 * every entry answered 200 or a quota 429, none 404. `ME_GEMINI_MODELS` overrides the list.
 */
const GEMINI_MODELS = (
  process.env['ME_GEMINI_MODELS']
  || 'gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest'
).split(',').map((model) => model.trim()).filter(Boolean)

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, '[redacted]')
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** HTTP statuses worth waiting out. A 400 will fail identically however long we wait. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

/**
 * A 429 that will still be a 429 in an hour.
 *
 * Groq's free tier caps tokens per DAY as well as per minute, and the two arrive under the
 * same status code. Told apart only by status, a daily limit met partway through a run cost
 * four 35s waits per window and lost the window anyway — twenty waits across two workers,
 * essentially the whole run spent sitting out a limit that resets at midnight. The body
 * names it, and so does an oversized `retry-after`: a wait measured in hours is not a
 * per-minute window rolling over, and honouring it is not something a user watching a
 * progress bar would want. Either way the answer is to stop asking THIS provider — which,
 * now that there are two, means moving to the next rather than giving up.
 *
 * Match `PerDay` unspaced as well as "per day". Google reports a spent daily budget as
 * `GenerateRequestsPerDayPerProjectPerModel-FreeTier` while its human-readable message says
 * only "Please retry in 31s" — so a pattern wanting whitespace reads a hard daily wall as a
 * half-minute pause and keeps asking until the run times out. That is the same defect this
 * constant exists to fix, wearing CamelCase.
 */
const DAILY_LIMIT_PATTERN = /\b(?:tpd|rpd)\b|per[\s_-]?day|daily[\s_-]?(?:limit|quota)/i
const LONGEST_WORTH_WAITING_MS = 120_000

class ModelHttpError extends Error {
  constructor(
    readonly status: number,
    /** What the server asked us to wait, in ms; 0 when it did not say. */
    readonly retryAfterMs: number,
    /** The key is spent, not merely busy. Retrying it is wasted time by definition. */
    readonly exhausted: boolean,
    message: string
  ) {
    super(message)
    this.name = 'ModelHttpError'
  }
}

/**
 * How long the server told us to wait.
 *
 * Not a nicety: a fixed 1.5s/3s ladder expires long before a per-minute token window rolls
 * over, which is how five of eleven windows once came back empty and the last two minutes
 * of the video got no footage. The server says exactly how long it needs — in the
 * `retry-after` header, in the prose body, and (Gemini) in a `retryDelay` field.
 */
export function retryAfterFrom(response: Response, body: string): number {
  const header = response.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
    const at = Date.parse(header)
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now())
  }
  // Groq says "try again in 8.5s"; Gemini says "Please retry in 39.5877581s" and repeats it
  // as a `retryDelay` in its `details`. Both wordings, because missing the hint costs the
  // window — see the cap logic in `createAutoBrollModel`.
  const spoken = /(?:try again|retry) in ([\d.]+)\s*(ms|s)\b/i.exec(body)
  if (spoken) return Number(spoken[1]) * (spoken[2]?.toLowerCase() === 'ms' ? 1 : 1000)
  const delay = /"retryDelay"\s*:\s*"([\d.]+)s"/i.exec(body)
  if (delay) return Number(delay[1]) * 1000
  return 0
}

/** True when a 429's own words say the budget is gone for the day rather than the minute. */
export function isExhaustedQuota(status: number, body: string, retryAfterMs: number): boolean {
  return status === 429 &&
    (DAILY_LIMIT_PATTERN.test(body) || retryAfterMs > LONGEST_WORTH_WAITING_MS)
}

async function failureFor(response: Response, label: string): Promise<ModelHttpError> {
  // Read the WHOLE body before parsing. Gemini buries its retry hint behind a paragraph of
  // documentation links, so truncating first — as this did — threw away the one number that
  // makes a per-minute limit survivable, and four windows of a Gemini run died for it.
  const body = await response.text().catch(() => '')
  const retryAfterMs = retryAfterFrom(response, body)
  const exhausted = isExhaustedQuota(response.status, body, retryAfterMs)
  const kind = exhausted ? ' (quota exhausted)' : response.status === 429 ? ' (rate limit)' : ''
  return new ModelHttpError(
    response.status,
    retryAfterMs,
    exhausted,
    `${label} HTTP ${response.status}${kind}: ${redactSensitive(body.slice(0, 200))}`
  )
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

// ------------------------------------------------------------------------- backends

/** One completed call to one provider. Retries and failover live above this. */
export interface ModelBackend {
  readonly name: string
  ask(prompt: string, signal?: AbortSignal): Promise<string>
}

function groqBackend(apiKey: string): ModelBackend {
  return {
    name: 'groq',
    async ask(prompt, signal) {
      const started = Date.now()
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: timeoutSignal(signal),
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: prompt }]
        })
      })
      AUTO_LOG.info(`response provider=groq status=${response.status} ms=${Date.now() - started}`)
      if (!response.ok) throw await failureFor(response, 'Groq')
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content ?? '{}'
    }
  }
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
}

function geminiBackend(apiKey: string, model: string): ModelBackend {
  // `gemini/flash-lite-latest` rather than the full id — this name is what the failover
  // notice shows the user, and "gemini/gemini-flash-lite-latest" reads as a stutter.
  const name = `gemini/${model.replace(/^gemini-/u, '')}`
  return {
    name,
    async ask(prompt, signal) {
      const started = Date.now()
      const response = await fetch(`${GEMINI_BASE}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'X-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        signal: timeoutSignal(signal),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, responseMimeType: 'application/json' }
        })
      })
      AUTO_LOG.info(`response provider=${name} status=${response.status} ms=${Date.now() - started}`)
      if (!response.ok) throw await failureFor(response, `Gemini (${model})`)
      const data = (await response.json()) as GeminiResponse
      if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini refused the prompt (${data.promptFeedback.blockReason})`)
      }
      const candidate = data.candidates?.[0]
      // Several parts come back when the model reasons before answering, and only some
      // carry text — the JSON answer is their concatenation, not the first one.
      const text = (candidate?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('')
        .trim()
      if (!text) throw new Error(`Gemini returned no answer (${candidate?.finishReason ?? 'no candidate'})`)
      return text
    }
  }
}

// --------------------------------------------------------------------------- ladder

export interface AutoBrollModelKeys {
  groqApiKey?: string
  geminiApiKey?: string
}

export interface AutoBrollModelOptions {
  signal?: AbortSignal
  onWait?: (seconds: number) => void
  /** Announced when a spent provider hands the rest of the run to the next one, because
   *  from the outside that is indistinguishable from a stall. */
  onFailover?: (from: string, to: string) => void
}

/** Which providers this run can use, in the order it will try them. One Gemini key becomes
 *  one rung per model, because each model carries its own daily free-tier budget. */
export function backendsFor(keys: AutoBrollModelKeys): ModelBackend[] {
  const backends: ModelBackend[] = []
  if (keys.groqApiKey?.trim()) backends.push(groqBackend(keys.groqApiKey.trim()))
  const geminiKey = keys.geminiApiKey?.trim()
  if (geminiKey) {
    for (const model of GEMINI_MODELS) backends.push(geminiBackend(geminiKey, model))
  }
  return backends
}

/**
 * Returns the `askModel` dependency `planAutoBroll` needs: one prompt in, one JSON string
 * out, with transport failures retried and a spent provider stepped over.
 *
 * Groq leads because it is the key this app already asks for (Settings > Integrations >
 * Transcription, shared with the hook generator) and it is fast. Gemini follows because its
 * free daily budget comfortably covers a 22-minute video, which Groq's does not.
 *
 * A provider is abandoned only when its quota is genuinely spent. A per-minute 429 is still
 * waited out on the ladder, because moving providers for that would spend the second key on
 * a problem that clears itself in thirty seconds. Once abandoned it stays abandoned for the
 * rest of the run: the eleven windows share one budget, so re-testing a spent key on every
 * window is eleven guaranteed failures.
 *
 * `ME_AUTO_BROLL_FIXTURE` short-circuits to a recorded answer, the same seam
 * `ME_YTDLP_FIXTURE` and `ME_WHISPER_FIXTURE` give the milestone smokes. It is what lets
 * the E2E drive the real button through the real IPC path with no key and no quota. The
 * answer's timestamps do not have to match the window: `normalizeMoments` clamps every
 * moment into the chunk it came from, so one recorded answer serves every window.
 */
export function createAutoBrollModel(
  keys: AutoBrollModelKeys,
  options: AutoBrollModelOptions = {}
): (prompt: string) => Promise<string> {
  const { signal, onWait, onFailover } = options
  const fixture = process.env['ME_AUTO_BROLL_FIXTURE']
  if (fixture) {
    AUTO_LOG.info(`using recorded answer from ${fixture}`)
    return async () => readFileSync(fixture, 'utf8')
  }

  const backends = backendsFor(keys)
  if (backends.length === 0) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      'No Groq or Gemini API key set. Add one in Settings > Integrations, then try again.'
    )
  }

  /** Providers whose budget is gone. Shared across every window of the run. */
  const spent = new Set<string>()

  /**
   * When each backend may next be asked.
   *
   * A rate limit belongs to the KEY, not to the caller. Without this, the two windows in
   * flight each discover the same closed window separately, each spend their four attempts
   * on it, and each report a lost window: on Gemini's five-requests-a-minute free tier that
   * meant eighteen waits and six of eleven windows lost, because every wait was re-earned
   * rather than shared. One gate means the second worker waits out the first one's answer
   * instead of paying for it again.
   */
  const readyAt = new Map<string, number>()

  const waitForGate = async (name: string): Promise<void> => {
    const remaining = (readyAt.get(name) ?? 0) - Date.now()
    if (remaining <= 0) return
    if (remaining >= 3000) onWait?.(Math.ceil(remaining / 1000))
    await sleep(remaining)
    signal?.throwIfAborted()
  }

  return async (prompt: string): Promise<string> => {
    // Once every rung is spent the loop below has nothing to run, so it would fall straight
    // through to the throw with no error to report — and every remaining window of the video
    // would be skipped with the literal detail "undefined". The user needs to be told the
    // budget is gone, not shown a bug.
    if (backends.every((backend) => spent.has(backend.name))) {
      throw new VideoEngineError(
        'INVALID_IMPORT',
        'Every configured model has run out of quota. Add another key in '
          + 'Settings > Integrations, or try again once the daily limits reset.'
      )
    }

    let last: unknown
    for (const backend of backends) {
      if (spent.has(backend.name)) continue
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        signal?.throwIfAborted()
        // Never fire into a window another worker has already been told is closed.
        await waitForGate(backend.name)
        try {
          return await backend.ask(prompt, signal)
        } catch (error) {
          last = error
          if (error instanceof Error && error.name === 'AbortError' && signal?.aborted) throw error
          // Gone for the rest of the run, not merely for this attempt: a spent daily
          // budget, a model this key cannot reach, or a key that is not accepted. None of
          // the three changes between windows, so leaving the rung in play costs one
          // guaranteed failure per window — eleven of them on a 22-minute video.
          const finished = error instanceof ModelHttpError &&
            (error.exhausted || error.status === 401 || error.status === 403 || error.status === 404)
          const retryable = !(error instanceof ModelHttpError) || isTransientStatus(error.status)
          AUTO_LOG.warn(
            `request failed provider=${backend.name} attempt=${attempt} retryable=${retryable} `
              + `finished=${finished} `
              + `error=${redactSensitive(error instanceof Error ? error.message : String(error))}`
          )
          if (finished) {
            // Announce the handover once. Both windows in flight meet the same wall before
            // either has marked it, so without this the user is told twice that the same
            // model ran out — which reads as it having run out twice.
            const firstToNotice = !spent.has(backend.name)
            spent.add(backend.name)
            if (firstToNotice) {
              const next = backends.find((entry) => !spent.has(entry.name))
              if (next) onFailover?.(backend.name, next.name)
            }
            break
          }
          if (!retryable || attempt === MAX_ATTEMPTS) break
          const asked = error instanceof ModelHttpError ? error.retryAfterMs : 0
          // A wait the server NAMED is honoured up to the point where it stops being a wait
          // and becomes a wall; only a guessed backoff is held to the shorter cap. Gemini's
          // free tier allows five requests a minute and asks for ~40s, which the 35s cap
          // used to undershoot every single time — turning a survivable limit into a lost
          // window on a provider that is only ever reached because the first one ran out.
          const wait = asked > 0
            ? Math.min(LONGEST_WORTH_WAITING_MS, asked + 250)
            : Math.min(MAX_BACKOFF_MS, 1500 * attempt)
          // Publish it before sleeping, so a worker arriving mid-wait joins this one rather
          // than spending a request to be told the same thing.
          readyAt.set(backend.name, Date.now() + wait)
          if (wait >= 3000) onWait?.(Math.ceil(wait / 1000))
          await sleep(wait)
        }
      }
    }
    const message = last instanceof Error && last.name === 'TimeoutError'
      ? `Model request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : redactSensitive(last instanceof Error ? last.message : String(last))
    throw new VideoEngineError('INVALID_IMPORT', message)
  }
}
