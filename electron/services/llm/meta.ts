import { logger } from '../logger'

/**
 * Meta AI Responses API (muse-spark) — shared LLM transport.
 *
 * Docs: POST https://api.meta.ai/v1/responses
 *   Header: Authorization: Bearer $META_API_KEY
 *   Body: { model: "muse-spark-1.2", input: [{role:"user", content:[{type:"input_text", text: prompt}]}], stream:false }
 *
 * Env fallback: META_API_KEY (and MODEL_API_KEY alias) plus Settings > Integrations > Meta key
 * (electron/store/settings.ts applyEnvFallback). Header is Authorization: Bearer.
 *
 * Groq remains the default fallback — this module never throws "no key" when Groq could still serve.
 * Callers decide ordering; this file only knows how to talk to Meta and how to fail safely.
 */

const META_LOG = logger.scope('meta-llm')
export const META_URL = 'https://api.meta.ai/v1/responses'
export const META_MODEL = 'muse-spark-1.2'
export const META_TIMEOUT_MS = 45_000

function redactSensitive(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, 'Bearer [redacted]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Authorization["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1[redacted]')
}

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(META_TIMEOUT_MS)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

/** Extract user-visible text from a Responses API payload, handling known shapes. */
export function extractMetaContent(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  // Direct output_text string (some docs show top-level)
  if (typeof d['output_text'] === 'string' && (d['output_text'] as string).trim()) return d['output_text'] as string
  // Some variants return { output: [{ content: [{ type, text }]}] }
  if (Array.isArray(d['output'])) {
    const parts: string[] = []
    for (const item of d['output'] as Array<Record<string, unknown>>) {
      const content = item?.['content']
      if (Array.isArray(content)) {
        for (const c of content as Array<Record<string, unknown>>) {
          if (typeof c['text'] === 'string') parts.push(c['text'] as string)
          else if (typeof c['output_text'] === 'string') parts.push(c['output_text'] as string)
        }
      } else if (typeof item['text'] === 'string') {
        parts.push(item['text'] as string)
      }
    }
    const joined = parts.join('').trim()
    if (joined) return joined
  }
  // OpenAI-compatible fallback: choices[0].message.content
  const choices = d['choices'] as Array<Record<string, unknown>> | undefined
  if (Array.isArray(choices) && choices[0]) {
    const msg = choices[0]['message'] as Record<string, unknown> | undefined
    if (typeof msg?.['content'] === 'string' && (msg['content'] as string).trim()) return msg['content'] as string
  }
  // Sometimes content is top-level string
  if (typeof d['content'] === 'string' && (d['content'] as string).trim()) return d['content'] as string
  // data field wrapping
  if (typeof d['data'] === 'string' && (d['data'] as string).trim()) return d['data'] as string
  return ''
}

/** Low-level Meta call. Throws with redacted, bounded messages on every failure mode. */
export async function askMeta(apiKey: string, prompt: string, signal?: AbortSignal): Promise<string> {
  if (!apiKey?.trim()) throw new Error('No Meta API key set')
  const started = Date.now()
  const key = apiKey.trim()
  try {
    const response = await fetch(META_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      signal: timeoutSignal(signal),
      body: JSON.stringify({
        model: META_MODEL,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        stream: false
      })
    })
    META_LOG.info(`response provider=meta status=${response.status} ms=${Date.now() - started}`)
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      // Truncate but keep retry hints like "try again in 23s" and retryDelay
      const excerpt = redactSensitive(body.slice(0, 500))
      throw new Error(`Meta HTTP ${response.status}: ${excerpt}`)
    }
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Meta returned no JSON')
    }
    const content = extractMetaContent(data)
    if (!content || !content.trim()) {
      throw new Error('Meta returned empty response')
    }
    return content
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const abortedByCaller = signal?.aborted
      const msg = abortedByCaller ? 'Meta request aborted' : `Meta request timed out after ${META_TIMEOUT_MS / 1000}s`
      META_LOG.warn(`request failed provider=meta ms=${Date.now() - started} error=${msg}`)
      throw new Error(msg)
    }
    // Network/type errors, HTTP errors above — all redacted
    const msg = redactSensitive(error instanceof Error ? error.message : String(error))
    META_LOG.warn(`request failed provider=meta ms=${Date.now() - started} error=${msg.slice(0, 300)}`)
    throw new Error(msg)
  }
}

export function redactForLog(value: string): string {
  return redactSensitive(value)
}
