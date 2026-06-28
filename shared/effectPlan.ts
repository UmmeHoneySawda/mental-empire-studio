import type { TranscriptWord, VideoStyle } from './types'

// Transcript-driven transitions + text effects. The "effect plan" can come from the
// built-in rule engine (deriveStylePlan), an external LLM via the master prompt
// (buildMasterPrompt), or a hand-written JSON paste — all funnelled through
// validateEffectPlan, which enforces professional, restrained pacing (known names,
// clamped durations, minimum spacing, a cap per minute). Pure + shared so the
// renderer can validate/preview and the main process can render from the same model.

export const TRANSITION_TYPES = [
  'fade', 'fadeblack', 'fadewhite', 'dissolve', 'wipeleft', 'wiperight',
  'slideup', 'slidedown', 'smoothleft', 'smoothright', 'circleopen', 'circleclose', 'radial', 'zoomin'
] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]

export const TEXT_PRESETS = [
  'cinematic-pop', 'intense-zoom', 'bounce', 'slide-in', 'typewriter', 'soft-fade', 'glow'
] as const
export type TextPreset = (typeof TEXT_PRESETS)[number]

export const SFX = ['whoosh_soft', 'swoosh_soft', 'impact_soft', 'none'] as const
export type Sfx = (typeof SFX)[number]

export interface PlanTransition { atSec: number; type: TransitionType; durationSec: number; sfx?: Sfx }
export interface PlanTextEffect { scope?: 'hook'; word?: string; startSec?: number; endSec?: number; preset: TextPreset }
export interface EffectPlan { mood?: string; transitions: PlanTransition[]; textEffects: PlanTextEffect[] }

export const EMPTY_PLAN: EffectPlan = { transitions: [], textEffects: [] }

// Guardrails — keep edits professional, not "rapid ridiculous effects".
const MIN_SPACING_SEC = 4.5
const MIN_DUR = 0.3
const MAX_DUR = 0.8
const MAX_PER_MIN = 12

/** Parse + sanitize any raw input into a safe EffectPlan, returning what was changed. */
export function validateEffectPlan(raw: unknown, durationSec: number): { plan: EffectPlan; warnings: string[] } {
  const warnings: string[] = []
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) as Record<string, unknown> } catch { return { plan: EMPTY_PLAN, warnings: ['Invalid JSON — ignored.'] } }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }

  const txSet = new Set<string>(TRANSITION_TYPES)
  const psSet = new Set<string>(TEXT_PRESETS)
  const sfxSet = new Set<string>(SFX)
  const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

  // ---- transitions: drop unknown, clamp, sort, enforce spacing + per-minute cap ----
  const rawTx = Array.isArray(obj.transitions) ? (obj.transitions as Record<string, unknown>[]) : []
  let tx: PlanTransition[] = []
  for (const t of rawTx) {
    const type = String(t.type ?? '')
    if (!txSet.has(type)) { warnings.push(`Unknown transition "${type}" dropped.`); continue }
    const at = clamp(Number(t.atSec) || 0, 0, Math.max(0, durationSec - 0.1))
    const sfx = sfxSet.has(String(t.sfx)) ? (t.sfx as Sfx) : undefined
    tx.push({ atSec: at, type: type as TransitionType, durationSec: clamp(Number(t.durationSec) || 0.5, MIN_DUR, MAX_DUR), sfx })
  }
  tx.sort((a, b) => a.atSec - b.atSec)
  const spaced: PlanTransition[] = []
  for (const t of tx) {
    if (spaced.length && t.atSec - spaced[spaced.length - 1].atSec < MIN_SPACING_SEC) { warnings.push('Transition too close to the previous — dropped.'); continue }
    spaced.push(t)
  }
  const cap = Math.max(1, Math.round((durationSec / 60) * MAX_PER_MIN))
  if (spaced.length > cap) { warnings.push(`Too many transitions (${spaced.length}) — capped to ${cap}.`); tx = spaced.slice(0, cap) } else tx = spaced

  // ---- text effects: keep known presets only ----
  const rawTe = Array.isArray(obj.textEffects) ? (obj.textEffects as Record<string, unknown>[]) : []
  const te: PlanTextEffect[] = []
  for (const e of rawTe) {
    const preset = String(e.preset ?? '')
    if (!psSet.has(preset)) { warnings.push(`Unknown text preset "${preset}" dropped.`); continue }
    const item: PlanTextEffect = { preset: preset as TextPreset }
    if (e.scope === 'hook') item.scope = 'hook'
    if (typeof e.word === 'string') item.word = e.word
    if (e.startSec != null) item.startSec = clamp(Number(e.startSec) || 0, 0, durationSec)
    if (e.endSec != null) item.endSec = clamp(Number(e.endSec) || 0, 0, durationSec)
    te.push(item)
  }

  return { plan: { mood: typeof obj.mood === 'string' ? obj.mood : undefined, transitions: tx, textEffects: te }, warnings }
}

// ---- style → look mappings (used by the rule engine + render) ----

/** Crossfade/transition type the style prefers (image-mode segment cuts). */
export function styleTransition(style: VideoStyle): TransitionType {
  switch (style) {
    case 'Cinematic': return 'fadeblack'
    case 'Intense': return 'zoomin'
    case 'Heartfelt': return 'dissolve'
    case 'Clean': return 'smoothleft'
    default: return 'fade'
  }
}

/** A leading ASS override tag applied to every caption line for the style's "feel". */
export function styleCaptionLead(style: VideoStyle): string {
  switch (style) {
    case 'Cinematic': return '{\\fad(150,150)}'
    case 'Intense': return '{\\t(0,110,\\fscx112\\fscy112)}'
    case 'Heartfelt': return '{\\fad(220,180)}'
    case 'Clean': return ''
    default: return ''
  }
}

/** Compile a per-word/group text preset into an ASS override prefix. */
export function textPresetTag(preset: TextPreset): string {
  switch (preset) {
    case 'cinematic-pop': return '{\\fad(120,120)\\t(0,200,\\fscx112\\fscy112)}'
    case 'intense-zoom': return '{\\fscx72\\fscy72\\t(0,120,\\fscx120\\fscy120)}'
    case 'bounce': return '{\\t(0,90,\\fscx116\\fscy116)\\t(90,180,\\fscx100\\fscy100)}'
    case 'slide-in': return '{\\fad(140,0)}'
    case 'typewriter': return ''
    case 'soft-fade': return '{\\fad(200,200)}'
    case 'glow': return '{\\blur3}'
    default: return ''
  }
}

/** Sentence boundaries = gaps in word timing above `gap` seconds. */
function sentenceBoundaries(words: TranscriptWord[], gap = 0.45): number[] {
  const bounds: number[] = []
  for (let i = 1; i < words.length; i++) {
    if (words[i].start - words[i - 1].end >= gap) bounds.push(words[i].start)
  }
  return bounds
}

/**
 * Built-in rule engine: derive a tasteful plan from the transcript + style without an
 * LLM. Transitions land on sentence boundaries (min-spaced); emphasized words get the
 * style's text preset; the hook gets a lead-in. Always passes validateEffectPlan.
 */
export function deriveStylePlan(words: TranscriptWord[], style: VideoStyle, durationSec: number): EffectPlan {
  if (style === 'None' || words.length === 0) return EMPTY_PLAN
  const tType = styleTransition(style)
  const transitions: PlanTransition[] = sentenceBoundaries(words).map((atSec) => ({
    atSec, type: tType, durationSec: style === 'Intense' ? 0.4 : 0.6, sfx: style === 'Intense' ? 'impact_soft' : 'whoosh_soft'
  }))
  const wordPreset: TextPreset = style === 'Intense' ? 'intense-zoom' : style === 'Cinematic' ? 'cinematic-pop' : style === 'Heartfelt' ? 'soft-fade' : 'bounce'
  const textEffects: PlanTextEffect[] = [{ scope: 'hook', preset: style === 'Intense' ? 'intense-zoom' : 'cinematic-pop' }]
  for (const w of words) if (w.emphasis) textEffects.push({ word: w.word, preset: wordPreset })
  return validateEffectPlan({ mood: style.toLowerCase(), transitions, textEffects }, durationSec).plan
}

/** The master prompt the user pastes into ChatGPT/Gemini (transcript + schema injected). */
export function buildMasterPrompt(words: TranscriptWord[], style: VideoStyle): string {
  const transcript = words.map((w) => `[${w.start.toFixed(1)}] ${w.word}`).join(' ')
  return [
    'You are a professional video editor. From the timestamped transcript below, output a JSON "effect plan"',
    'that places TRANSITIONS and TEXT EFFECTS for a polished, restrained edit — like a real professional video,',
    'NOT rapid or gimmicky. Output ONLY valid JSON, no prose.',
    '',
    `Target style/mood: ${style}.`,
    '',
    'Rules:',
    '- Transitions only at sentence/scene boundaries; at most one per ~5 seconds; durations 0.3–0.8s.',
    '- Text effects emphasize meaning: use intense-zoom only on genuinely emphatic words, cinematic-pop on the',
    '  hook/opening, soft-fade for calm passages. Never more than one effect per phrase.',
    '- Match the mood: Cinematic→fadeblack/dissolve + slow text fades; Intense→zoomin/slides + bigger text;',
    '  Heartfelt→dissolve/smooth + gentle fades; Clean→smoothleft/minimal.',
    '- SFX optional and subtle: only *_soft values.',
    '',
    `Allowed transition types: ${TRANSITION_TYPES.join(', ')}.`,
    `Allowed text presets: ${TEXT_PRESETS.join(', ')}.`,
    `Allowed sfx: ${SFX.join(', ')}.`,
    '',
    'Schema:',
    '{ "mood": string, "transitions": [{ "atSec": number, "type": string, "durationSec": number, "sfx"?: string }],',
    '  "textEffects": [{ "scope"?: "hook", "word"?: string, "startSec"?: number, "endSec"?: number, "preset": string }] }',
    '',
    'Transcript:',
    transcript
  ].join('\n')
}
