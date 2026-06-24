import { existsSync, readFileSync } from 'node:fs'
import type { AppSettings } from '../../shared/types'

// Word-level transcription via Groq's free Whisper API (OpenAI-compatible). We
// upload the mp3 and ask for word timestamps. Offline seam: ME_WHISPER_FIXTURE
// returns recorded word JSON so the transcript pipeline is testable without network.

export interface RawWord {
  word: string
  start: number
  end: number
}

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'

export async function transcribeAudio(mp3Path: string, settings: AppSettings): Promise<RawWord[]> {
  const fixture = process.env['ME_WHISPER_FIXTURE']
  if (fixture) {
    const data = JSON.parse(readFileSync(fixture, 'utf8')) as { words?: RawWord[] }
    return data.words ?? []
  }

  const { apiKey, model } = settings.transcription
  if (!apiKey) throw new Error('No Groq API key set (Settings → Transcription).')
  if (!existsSync(mp3Path)) throw new Error(`Audio file not found: ${mp3Path}`)

  const buf = readFileSync(mp3Path)
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', model || 'whisper-large-v3-turbo')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Groq transcription failed ${res.status}: ${t.slice(0, 300)}`)
  }
  const json = (await res.json()) as { words?: RawWord[] }
  return json.words ?? []
}
