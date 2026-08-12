import { HookPlanSchema, safeParseHookPlan, type HookPlan } from '../../../shared/video-engine'
import { logger } from '../logger'
import { VideoEngineError } from './errors'
import { askMeta } from '../llm/meta'

/* In-app hook generation.
 *
 * The studio's hook was a pure clipboard round trip: build a prompt, the user pastes it
 * into a chat model somewhere else, then pastes JSON back. The app already talks to Groq
 * for transcription and for the classic tab's effect plans, so it can just write the hook
 * itself. The copy/paste path stays as a fallback for people who prefer another model.
 *
 * Deliberately the same call shape as electron/services/effects.ts — same endpoint, model,
 * timeout, JSON response mode and redaction — so there is one known-good way this app
 * talks to Groq rather than two that drift. */

const HOOK_LOG = logger.scope('hook-generator')
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const REQUEST_TIMEOUT_MS = 45_000

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
}

async function askGroq(apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }]
      })
    })
    HOOK_LOG.info(`response provider=groq status=${response.status} ms=${Date.now() - started}`)
    if (!response.ok) {
      throw new Error(`Groq HTTP ${response.status}: ${redactSensitive((await response.text()).slice(0, 200))}`)
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? '{}'
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `Groq request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : redactSensitive(error instanceof Error ? error.message : String(error))
    HOOK_LOG.warn(`request failed provider=groq ms=${Date.now() - started} error=${message}`)
    throw new VideoEngineError('INVALID_IMPORT', message)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Models reliably get two things wrong: they echo the fps from the example, and they
 * overrun the frame budget. Both are mechanical, so they are corrected rather than
 * bounced back to the user — the plan is scaled to fit and the fps is forced to the
 * project's. Anything else invalid goes to one repair round trip.
 */
function coerceToBudget(plan: HookPlan, fps: number, durationFrames: number): HookPlan {
  const scale = plan.durationFrames > durationFrames ? durationFrames / plan.durationFrames : 1
  const beats = plan.beats.map((beat) => ({
    ...beat,
    startFrame: Math.max(0, Math.round(beat.startFrame * scale)),
    durationFrames: Math.max(1, Math.round(beat.durationFrames * scale)),
    ...(beat.transitionOut
      ? {
          transitionOut: {
            ...beat.transitionOut,
            // An animated transition needs a positive duration — the schema says so. Only
            // `cut` may be zero, and scaling a two-frame fade by a third used to round it
            // straight to 0 and fail the whole plan on a rule the model never broke.
            durationFrames:
              beat.transitionOut.type === 'cut'
                ? 0
                : Math.max(1, Math.round(beat.transitionOut.durationFrames * scale))
          }
        }
      : {})
  }))
  // Re-lay the beats end to end: rounding each one independently can leave a one-frame
  // overlap, which the schema rejects.
  //
  // The budget has to be enforced HERE, per beat, not just on the total. Each beat rounds
  // independently and can round up, so seven beats scaled by a third overshot by a frame —
  // and clamping only `durationFrames` at the end left the last beat ending past the plan,
  // which is the one arrangement the schema calls out ("Hook beat extends beyond the plan
  // duration"). The user saw a raw zod complaint about a plan they never wrote.
  let cursor = 0
  const packed: typeof beats = []
  for (const beat of beats) {
    const room = durationFrames - cursor
    if (room < 1) break
    const next = { ...beat, startFrame: cursor, durationFrames: Math.min(beat.durationFrames, room) }
    if (next.transitionOut && next.transitionOut.durationFrames > next.durationFrames) {
      next.transitionOut = { ...next.transitionOut, durationFrames: next.durationFrames }
    }
    cursor += next.durationFrames
    packed.push(next)
  }
  const coerced = {
    ...plan,
    fps,
    beats: packed.length > 0 ? packed : plan.beats.slice(0, 1),
    durationFrames: Math.max(1, Math.min(cursor, durationFrames))
  }
  // Validate what we produced. Returning it unchecked is what turned a coercion bug into a
  // failure the user could only read as "the AI wrote a broken plan".
  return HookPlanSchema.parse(coerced)
}

export interface GenerateHookPlanOptions {
  apiKey: string
  /** Preferred Meta key (muse-spark). When present Meta is tried first; Groq is the fallback. */
  metaApiKey?: string
  prompt: string
  fps: number
  durationFrames: number
}

async function askWithFallback(
  prompt: string,
  keys: { meta?: string; groq: string }
): Promise<string> {
  const meta = keys.meta?.trim()
  const groq = keys.groq?.trim()
  // Prefer Meta when available; otherwise Groq. If preferred fails, fall back.
  if (meta) {
    try {
      HOOK_LOG.info(`request start provider=meta fps=${keys.meta ? 'meta-first' : 'groq'} budget-pending`)
      return await askMeta(meta, prompt)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // If Groq is also available, fall back on any Meta failure (network, 5xx, 429, empty, timeout).
      // If Groq is not configured, surface Meta's own error.
      if (!groq) throw new VideoEngineError('INVALID_IMPORT', msg)
      HOOK_LOG.warn(`meta failed, falling back to groq error=${msg.slice(0, 200)}`)
    }
  }
  return askGroq(groq, prompt)
}

/** Asks Meta (preferred) or Groq for a hook plan and returns one that is valid for this project. */
export async function generateHookPlan(options: GenerateHookPlanOptions): Promise<HookPlan> {
  const metaKey = options.metaApiKey?.trim() ?? ''
  const groqKey = options.apiKey?.trim() ?? ''
  if (!metaKey && !groqKey) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      'No Meta or Groq API key set. Add a Meta key (Settings > Integrations) or a Groq key (Settings > Transcription), then try again.'
    )
  }
  const preferred = metaKey ? 'meta' : 'groq'
  const model = metaKey ? 'muse-spark-1.2' : GROQ_MODEL
  HOOK_LOG.info(`request start provider=${preferred} model=${model} fps=${options.fps} budget=${options.durationFrames}`)

  const firstRaw = await askWithFallback(options.prompt, { meta: metaKey, groq: groqKey })
  const first = safeParseHookPlan(firstRaw)
  if (first.success) return coerceToBudget(first.data, options.fps, options.durationFrames)

  // One repair attempt, quoting the exact validation failures back. Cheaper and far more
  // likely to succeed than making the user read a zod error.
  const issues = first.error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  HOOK_LOG.warn(`first answer invalid, repairing issues=${first.error.issues.length}`)

  const repairedRaw = await askWithFallback(
    `${options.prompt}\n\nYour previous answer was rejected. Fix exactly these problems and return the corrected JSON only:\n${issues}`,
    { meta: metaKey, groq: groqKey }
  )
  const repaired = safeParseHookPlan(repairedRaw)
  if (!repaired.success) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      `The model could not produce a valid hook plan: ${repaired.error.issues[0]?.message ?? 'unknown validation error'}`
    )
  }
  return coerceToBudget(repaired.data, options.fps, options.durationFrames)
}
