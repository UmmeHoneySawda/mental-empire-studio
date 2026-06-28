import type { TranscriptWord, VideoStyle } from '../../shared/types'
import { buildMasterPrompt, validateEffectPlan, type EffectPlan } from '../../shared/effectPlan'
import { logger } from './logger'

// Optional in-app effect-plan generation via Groq's free LLM (reuses the Groq key
// already configured for transcription). Produces the same JSON a user would get by
// pasting the master prompt into ChatGPT/Gemini — but hands-free, so it works in
// batch/auto-watch. Always run through validateEffectPlan before use.

const EFFECT_LOG = logger.scope('effects')
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const REQUEST_TIMEOUT_MS = 45_000

function redactSensitive(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
}

export async function generatePlanViaGroq(
  apiKey: string,
  words: TranscriptWord[],
  style: VideoStyle,
  durationSec: number
): Promise<{ plan: EffectPlan; json: string; warnings: string[] }> {
  if (!apiKey) {
    EFFECT_LOG.warn(`generate skipped: missing Groq key style=${style}`)
    throw new Error('No Groq API key (Settings → Transcription)')
  }
  const prompt = buildMasterPrompt(words, style)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  EFFECT_LOG.info(`request start provider=groq model=${GROQ_MODEL} style=${style} words=${words.length} duration=${durationSec.toFixed(2)} url=${GROQ_URL}`)
  try {
    const res = await fetch(GROQ_URL, {
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
    const ms = Date.now() - started
    EFFECT_LOG.info(`response provider=groq status=${res.status} ms=${ms}`)
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${redactSensitive((await res.text()).slice(0, 200))}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = data.choices?.[0]?.message?.content ?? '{}'
    const { plan, warnings } = validateEffectPlan(content, durationSec)
    EFFECT_LOG.info(`validated provider=groq warnings=${warnings.length} transitions=${plan.transitions.length} textEffects=${plan.textEffects.length}`)
    return { plan, json: JSON.stringify(plan, null, 2), warnings }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? `Groq request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      : redactSensitive((e as Error).message)
    EFFECT_LOG.warn(`request failed provider=groq ms=${Date.now() - started} error=${msg}`)
    throw new Error(msg)
  } finally {
    clearTimeout(timeout)
  }
}
