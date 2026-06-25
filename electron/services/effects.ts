import type { TranscriptWord, VideoStyle } from '../../shared/types'
import { buildMasterPrompt, validateEffectPlan, type EffectPlan } from '../../shared/effectPlan'

// Optional in-app effect-plan generation via Groq's free LLM (reuses the Groq key
// already configured for transcription). Produces the same JSON a user would get by
// pasting the master prompt into ChatGPT/Gemini — but hands-free, so it works in
// batch/auto-watch. Always run through validateEffectPlan before use.

export async function generatePlanViaGroq(
  apiKey: string,
  words: TranscriptWord[],
  style: VideoStyle,
  durationSec: number
): Promise<{ plan: EffectPlan; json: string; warnings: string[] }> {
  if (!apiKey) throw new Error('No Groq API key (Settings → Transcription)')
  const prompt = buildMasterPrompt(words, style)
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content ?? '{}'
  const { plan, warnings } = validateEffectPlan(content, durationSec)
  return { plan, json: JSON.stringify(plan, null, 2), warnings }
}
