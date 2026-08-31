import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const channelRoot = process.argv[2]
const libraryManifestPath = process.argv[3]
if (!channelRoot || !libraryManifestPath) {
  throw new Error('Usage: node plan-mindcipher.mjs <channel-root> <broll-library-manifest>')
}

const apiKey = process.env.META_API_KEY || ''
if (!apiKey) throw new Error('META_API_KEY is unavailable')

const exactModel = 'muse-spark-1.2-contributor'
const reasoningEffort = 'xhigh'
const wordsPath = join(channelRoot, 'transcript', 'words.json')
const planPath = join(channelRoot, 'intermediate', 'broll-plan.json')
const timelinePath = join(channelRoot, 'intermediate', 'broll-timeline.json')
const provenancePath = join(channelRoot, 'intermediate', 'broll-provenance.json')

function atomicJson(path, value) {
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function validSavedPlan() {
  if (!existsSync(planPath) || !existsSync(timelinePath) || !existsSync(provenancePath)) return false
  try {
    const plan = loadJson(planPath)
    const timeline = loadJson(timelinePath)
    return plan.model === exactModel
      && plan.reasoningEffort === reasoningEffort
      && Array.isArray(plan.scenes) && plan.scenes.length === 24
      && Array.isArray(timeline.slots) && timeline.slots.length > 0
  } catch {
    return false
  }
}

if (validSavedPlan()) {
  console.log(`MindCipher: reused verified ${exactModel} plan`)
  process.exit(0)
}

const wordsDoc = loadJson(wordsPath)
const words = wordsDoc.words
if (!Array.isArray(words) || words.length === 0) throw new Error('MindCipher transcript has no words')
const library = loadJson(libraryManifestPath)
const keywordRows = library.keywords.filter((row) => Array.isArray(row.clips) && row.clips.some((clip) => existsSync(clip.path)))
const keywordMap = new Map(keywordRows.map((row) => [row.keyword, row]))
const keywords = [...keywordMap.keys()].filter((keyword) => !keyword.startsWith('same one-per-line'))
if (keywords.length === 0) throw new Error('B-roll library manifest has no usable keywords')

const duration = Math.max(...words.map((word) => Number(word.end) || 0))
const sceneCount = 24
const sceneSpan = duration / sceneCount
const excerpts = []
for (let index = 0; index < sceneCount; index += 1) {
  const start = index * sceneSpan
  const end = index === sceneCount - 1 ? duration : (index + 1) * sceneSpan
  const text = words
    .filter((word) => Number(word.start) < end && Number(word.end) >= start)
    .map((word) => word.word)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  excerpts.push({ index: index + 1, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), text })
}

const prompt = `You are planning B-roll for a psychology video titled "The Psychology of People Who Waste Their Potential".

Choose exactly one visual keyword for each of the 24 numbered transcript scenes below. You MUST copy each keyword exactly from the AVAILABLE KEYWORDS list. Prefer metaphorical matches when a literal match does not exist. Vary the choices; do not use the same keyword in adjacent scenes.

Return only valid JSON with this shape:
{"selections":[{"index":1,"keyword":"exact available keyword","rationale":"short visual reason"}]}

AVAILABLE KEYWORDS:
${keywords.map((keyword) => `- ${keyword}`).join('\n')}

TIMED TRANSCRIPT SCENES:
${excerpts.map((scene) => `[${scene.index}] ${scene.start}-${scene.end}s\n${scene.text}`).join('\n\n')}

Provide all 24 selections, ordered by index.`

const request = {
  model: exactModel,
  input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
  stream: true,
  temperature: 1,
  max_output_tokens: 16000,
  top_p: 1,
  reasoning: { effort: reasoningEffort }
}
if (request.model !== exactModel || request.reasoning.effort !== reasoningEffort) {
  throw new Error('Refusing to send a non-Contributor or non-xhigh Meta request')
}

const response = await fetch('https://api.meta.ai/v1/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream'
  },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(180000)
})
if (!response.ok || !response.body) {
  const detail = (await response.text()).slice(0, 500)
  throw new Error(`Meta Contributor planning failed HTTP ${response.status}: ${detail}`)
}

const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let outputText = ''
let completed = false
while (true) {
  const { value, done } = await reader.read()
  buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
  const lines = buffer.split(/\r?\n/)
  buffer = lines.pop() || ''
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    let event
    try { event = JSON.parse(data) } catch { continue }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') outputText += event.delta
    if (event.type === 'response.completed') {
      completed = true
      if (!outputText && event.response?.output) {
        outputText = event.response.output
          .flatMap((item) => item.content || [])
          .map((content) => content.text || '')
          .join('')
      }
    }
    if (event.type === 'response.failed') throw new Error(`Meta Contributor returned response.failed: ${JSON.stringify(event).slice(0, 500)}`)
  }
  if (done) break
}
if (!completed) throw new Error('Meta Contributor stream ended without response.completed')

const jsonText = outputText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
let modelPlan
try { modelPlan = JSON.parse(jsonText) } catch { throw new Error(`Meta Contributor returned invalid JSON: ${jsonText.slice(0, 500)}`) }
const selections = Array.isArray(modelPlan.selections) ? modelPlan.selections : []

const fallbackKeywords = [
  'person trapped in thoughts',
  'dark office late night',
  'person walking alone at night',
  'rainy window emotional scene',
  'mysterious hand writing notes',
  'person investigating documents',
  'dark city street at night',
  'smoke in dark room cinematic'
].filter((keyword) => keywordMap.has(keyword))

const scenes = excerpts.map((excerpt, arrayIndex) => {
  const selection = selections.find((item) => Number(item.index) === excerpt.index)
  let keyword = typeof selection?.keyword === 'string' ? selection.keyword.trim() : ''
  if (!keywordMap.has(keyword)) keyword = fallbackKeywords[arrayIndex % fallbackKeywords.length] || keywords[arrayIndex % keywords.length]
  return {
    index: excerpt.index,
    startSec: excerpt.start,
    endSec: excerpt.end,
    keyword,
    rationale: String(selection?.rationale || 'Deterministic local-library fallback').slice(0, 240)
  }
})

// Avoid referring to the array being initialized when checking adjacency.
for (let index = 1; index < scenes.length; index += 1) {
  if (scenes[index].keyword === scenes[index - 1].keyword) {
    scenes[index].keyword = fallbackKeywords[(index + 1) % fallbackKeywords.length] || keywords[(index + 1) % keywords.length]
  }
}

const plan = {
  title: 'The Psychology of People Who Waste Their Potential',
  model: exactModel,
  reasoningEffort,
  durationSec: duration,
  createdAt: new Date().toISOString(),
  scenes
}
atomicJson(planPath, plan)

const slots = []
let slotIndex = 0
for (const scene of scenes) {
  const row = keywordMap.get(scene.keyword)
  const clips = row.clips.filter((clip) => existsSync(clip.path))
  for (let start = scene.startSec; start < scene.endSec - 0.001; start += 7) {
    const end = Math.min(scene.endSec, start + 7)
    const clip = clips[(slotIndex + scene.index) % clips.length]
    const clipDuration = Number(clip.durationSec) || 7
    const slotDuration = end - start
    const maxSourceStart = Math.max(0, clipDuration - slotDuration)
    const sourceStart = maxSourceStart ? (slotIndex * 3.173) % maxSourceStart : 0
    slots.push({
      index: slotIndex + 1,
      startSec: Number(start.toFixed(3)),
      endSec: Number(end.toFixed(3)),
      durationSec: Number(slotDuration.toFixed(3)),
      sceneIndex: scene.index,
      keyword: scene.keyword,
      provider: clip.provider,
      providerId: clip.id,
      sourcePath: clip.path,
      sourceStartSec: Number(sourceStart.toFixed(3)),
      width: clip.width,
      height: clip.height
    })
    slotIndex += 1
  }
}
atomicJson(timelinePath, { version: 1, durationSec: duration, slots })

const unique = new Map()
for (const slot of slots) {
  const key = `${slot.provider}:${slot.providerId}`
  if (unique.has(key)) continue
  const licensePath = `${slot.sourcePath}.license.json`
  unique.set(key, {
    provider: slot.provider,
    providerId: slot.providerId,
    sourcePath: slot.sourcePath,
    licensePath: existsSync(licensePath) ? licensePath : null,
    keyword: slot.keyword
  })
}
atomicJson(provenancePath, { generatedAt: new Date().toISOString(), assets: [...unique.values()] })
console.log(`MindCipher: ${exactModel}/${reasoningEffort} planned ${scenes.length} scenes and ${slots.length} B-roll slots`)
