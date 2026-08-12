import type { TranscriptWord, VideoStyle } from '../../shared/types'
import { buildMasterPrompt, validateEffectPlan, type EffectPlan } from '../../shared/effectPlan'
import { logger } from './logger'
import { askMeta } from './llm/meta'

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

async function askGroq(apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
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
    return data.choices?.[0]?.message?.content ?? '{}'
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

export async function generatePlanViaGroq(
  apiKey: string,
  words: TranscriptWord[],
  style: VideoStyle,
  durationSec: number
): Promise<{ plan: EffectPlan; json: string; warnings: string[] }> {
  return generatePlanWithFallback({ groqKey: apiKey }, words, style, durationSec)
}

/** Preferred Meta, fallback Groq. Keeps generatePlanViaGroq API stable for existing callers. */
export async function generatePlanWithFallback(
  keys: { groqKey?: string; metaKey?: string },
  words: TranscriptWord[],
  style: VideoStyle,
  durationSec: number
): Promise<{ plan: EffectPlan; json: string; warnings: string[] }> {
  const groqKey = keys.groqKey?.trim() ?? ''
  const metaKey = keys.metaKey?.trim() ?? ''
  if (!groqKey && !metaKey) {
    EFFECT_LOG.warn(`generate skipped: missing Meta/Groq key style=${style}`)
    throw new Error('No Meta or Groq API key (Settings → Integrations)')
  }
  const prompt = buildMasterPrompt(words, style)
  const preferred = metaKey ? 'meta' : 'groq'
  EFFECT_LOG.info(`request start provider=${preferred} style=${style} words=${words.length} duration=${durationSec.toFixed(2)}`)
  let content: string
  if (metaKey) {
    try {
      content = await askMeta(metaKey, prompt)
      EFFECT_LOG.info(`validated provider=meta style=${style}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!groqKey) throw new Error(msg)
      EFFECT_LOG.warn(`meta failed, falling back to groq style=${style} error=${msg.slice(0, 200)}`)
      content = await askGroq(groqKey, prompt)
    }
  } else {
    content = await askGroq(groqKey, prompt)
  }
  const { plan, warnings } = validateEffectPlan(content, durationSec)
  EFFECT_LOG.info(`validated provider=${preferred} warnings=${warnings.length} transitions=${plan.transitions.length} textEffects=${plan.textEffects.length}`)
  return { plan, json: JSON.stringify(plan, null, 2), warnings }
}
