import { safeParseHookPlan, type HookPlan } from '../../../shared/video-engine'
import { logger } from '../logger'
import { VideoEngineError } from './errors'

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
            durationFrames: Math.max(0, Math.round(beat.transitionOut.durationFrames * scale))
          }
        }
      : {})
  }))
  // Re-lay the beats end to end: rounding each one independently can leave a one-frame
  // overlap, which the schema rejects.
  let cursor = 0
  const packed = beats.map((beat) => {
    const next = { ...beat, startFrame: cursor }
    if (next.transitionOut && next.transitionOut.durationFrames > next.durationFrames) {
      next.transitionOut = { ...next.transitionOut, durationFrames: next.durationFrames }
    }
    cursor += next.durationFrames
    return next
  })
  return { ...plan, fps, beats: packed, durationFrames: Math.max(1, Math.min(cursor, durationFrames)) }
}

export interface GenerateHookPlanOptions {
  apiKey: string
  prompt: string
  fps: number
  durationFrames: number
}

/** Asks Groq for a hook plan and returns one that is valid for this project. */
export async function generateHookPlan(options: GenerateHookPlanOptions): Promise<HookPlan> {
  if (!options.apiKey) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      'No Groq API key set. Add one in Settings > Integrations > Transcription, then try again.'
    )
  }
  HOOK_LOG.info(`request start provider=groq model=${GROQ_MODEL} fps=${options.fps} budget=${options.durationFrames}`)

  const first = safeParseHookPlan(await askGroq(options.apiKey, options.prompt))
  if (first.success) return coerceToBudget(first.data, options.fps, options.durationFrames)

  // One repair attempt, quoting the exact validation failures back. Cheaper and far more
  // likely to succeed than making the user read a zod error.
  const issues = first.error.issues
    .slice(0, 12)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  HOOK_LOG.warn(`first answer invalid, repairing issues=${first.error.issues.length}`)

  const repaired = safeParseHookPlan(await askGroq(
    options.apiKey,
    `${options.prompt}\n\nYour previous answer was rejected. Fix exactly these problems and return the corrected JSON only:\n${issues}`
  ))
  if (!repaired.success) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      `The model could not produce a valid hook plan: ${repaired.error.issues[0]?.message ?? 'unknown validation error'}`
    )
  }
  return coerceToBudget(repaired.data, options.fps, options.durationFrames)
}
