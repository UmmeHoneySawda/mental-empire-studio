import type { Project, TranscriptWord } from '../../shared/types'
import { textPresetTag, type PlanTextEffect } from '../../shared/effectPlan'

// Pure ASS (Advanced SubStation Alpha) generation for CapCut-style burned captions.
// Word-level karaoke (\kf sweep), per-preset styling, keyword emphasis (scale + color),
// and punch-zoom keyframes for the renderer. Kept dependency-free so it's unit-testable.

export type CaptionAspect = '16:9' | '1:1' | '9:16'

export interface CaptionOptions {
  preset: string
  /** renderer-selected font family; falls back to the preset's default */
  font?: string
  aspect: CaptionAspect
  /** auto-emphasize detected keywords in addition to per-word emphasis flags */
  keywords: boolean
  /** words per on-screen caption group (Word preset forces 1) */
  perGroup?: number
  /** beta: intro "hook" text card shown centered for the first untilSec seconds */
  hook?: { text: string; untilSec: number }
  /** beta: a leading ASS override tag applied to every caption line (the style "feel") */
  styleLead?: string
  /** beta: per-word / hook text-effect presets from the validated effect plan */
  textEffects?: PlanTextEffect[]
  /** vertical caption placement */
  position?: Project['captionPosition']
}

export interface AssResult {
  ass: string
  /** times (seconds) where an emphasized word hits — drives punch-zoom in render.ts */
  zoomHits: number[]
}

interface PresetStyle {
  font: string
  size: number
  /** primary (sung) BGR, secondary (unsung) BGR, outline BGR */
  primary: string
  secondary: string
  outline: string
  back: string
  bold: 0 | 1
  borderStyle: 1 | 3 // 1 = outline+shadow, 3 = opaque box
  outlineW: number
  shadow: number
  /** emphasis colour applied to keywords (BGR) */
  emphasis: string
}

// ASS colours are &HBBGGRR. White=&H00FFFFFF, CapCut yellow #FFD93D=&H003DD9FF.
const PRESETS: Record<string, PresetStyle> = {
  Pop: { font: 'Anton', size: 96, primary: '&H003DD9FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H00000000', bold: 1, borderStyle: 1, outlineW: 4, shadow: 2, emphasis: '&H003DD9FF' },
  Bold: { font: 'Anton', size: 104, primary: '&H003DD9FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&HA0000000', bold: 1, borderStyle: 3, outlineW: 5, shadow: 0, emphasis: '&H003DD9FF' },
  Hormozi: { font: 'Anton', size: 112, primary: '&H003DD9FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H00000000', bold: 1, borderStyle: 1, outlineW: 4, shadow: 1.5, emphasis: '&H003DD9FF' },
  Word: { font: 'Anton', size: 130, primary: '&H003DD9FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H00000000', bold: 1, borderStyle: 1, outlineW: 5, shadow: 2, emphasis: '&H003DD9FF' },
  Neon: { font: 'Montserrat', size: 98, primary: '&H00FFFF00', secondary: '&H00AAAA00', outline: '&H00FF00CC', back: '&H00000000', bold: 1, borderStyle: 1, outlineW: 4, shadow: 0, emphasis: '&H00FF00CC' },
  Minimal: { font: 'Hanken Grotesk', size: 78, primary: '&H003DD9FF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H00000000', bold: 1, borderStyle: 1, outlineW: 3, shadow: 1, emphasis: '&H003DD9FF' }
}

const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'is', 'are', 'was', 'it', 'you', 'your', 'i', 'we', 'they', 'he', 'she', 'for', 'with', 'as', 'at', 'by', 'be', 'this', 'that'])

export function resolutionFor(aspect: CaptionAspect): { w: number; h: number } {
  if (aspect === '1:1') return { w: 1080, h: 1080 }
  if (aspect === '9:16') return { w: 1080, h: 1920 }
  return { w: 1920, h: 1080 }
}

function secToAss(t: number): string {
  const cs = Math.max(0, Math.round(t * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  const c = cs % 100
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`
}

function escapeAss(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ')
}

function safeFontName(font: string | undefined, fallback: string): string {
  const cleaned = (font ?? '').replace(/[,\r\n]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned || fallback
}

/** Is this word a keyword worth emphasizing (explicit flag, or a long non-stopword)? */
function isKeyword(w: TranscriptWord, autoKeywords: boolean): boolean {
  if (w.emphasis) return true
  if (!autoKeywords) return false
  const norm = w.word.toLowerCase().replace(/[^a-z]/g, '')
  return norm.length >= 6 && !STOPWORDS.has(norm)
}

export interface CaptionGroup {
  words: TranscriptWord[]
  start: number
  end: number
}

/** Chunk words into contiguous on-screen groups of at most `perGroup`. */
export function groupWords(words: TranscriptWord[], perGroup: number): CaptionGroup[] {
  const groups: CaptionGroup[] = []
  for (let i = 0; i < words.length; i += perGroup) {
    const chunk = words.slice(i, i + perGroup)
    if (chunk.length === 0) continue
    groups.push({ words: chunk, start: chunk[0].start, end: chunk[chunk.length - 1].end })
  }
  return groups
}

function styleLine(p: PresetStyle, marginV: number, alignment: 2 | 5 | 8): string {
  // Format: Name,Font,Size,Primary,Secondary,Outline,Back,Bold,Italic,Underline,StrikeOut,
  // ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
  return `Style: Default,${p.font},${p.size},${p.primary},${p.secondary},${p.outline},${p.back},${p.bold},0,0,0,100,100,0,0,${p.borderStyle},${p.outlineW},${p.shadow},${alignment},60,60,${marginV},1`
}

export function buildAss(words: TranscriptWord[], opts: CaptionOptions): AssResult {
  const rawPreset = PRESETS[opts.preset] ?? PRESETS.Hormozi
  const { w, h } = resolutionFor(opts.aspect)
  const fontPx = Math.round(Math.max(64, Math.min(opts.aspect === '9:16' ? h * 0.11 : h * 0.085, opts.aspect === '9:16' ? 150 : 108)))
  const preset = { ...rawPreset, font: safeFontName(opts.font, rawPreset.font), size: opts.preset === 'Word' ? Math.round(fontPx * 1.12) : fontPx }
  const defaultGroup = opts.aspect === '9:16' ? 4 : opts.aspect === '1:1' ? 3 : 2
  const perGroup = opts.preset === 'Word' ? 1 : Math.max(1, opts.perGroup ?? defaultGroup)
  const position = opts.position ?? 'bottom'
  const alignment: 2 | 5 | 8 = position === 'top' ? 8 : position === 'middle' ? 5 : 2
  const marginV = position === 'middle'
    ? 0
    : Math.round(h * (position === 'top' ? (opts.aspect === '9:16' ? 0.16 : 0.13) : (opts.aspect === '9:16' ? 0.28 : 0.26)))
  const groups = groupWords(words, perGroup)
  const zoomHits: number[] = []
  // Per-word text-effect presets from the plan → ASS tag, keyed by normalized word.
  const wordFx = new Map<string, string>()
  for (const e of opts.textEffects ?? []) {
    if (e.word) wordFx.set(e.word.toLowerCase().replace(/[^a-z0-9]/g, ''), textPresetTag(e.preset))
  }
  const hookFx = (opts.textEffects ?? []).find((e) => e.scope === 'hook')

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine(preset, marginV, alignment),
    // Hook style: big, centered on screen, heavy outline (alignment 5 = middle-centre).
    `Style: Hook,Anton,${Math.round(h * 0.12)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,8,0,5,80,80,80,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ].join('\n')

  const seenZoomHits = new Set<number>()
  const wordText = (word: TranscriptWord, active: boolean): string => {
        const key = isKeyword(word, opts.keywords)
        if (key && !seenZoomHits.has(word.start)) {
          seenZoomHits.add(word.start)
          zoomHits.push(word.start)
        }
        const body = escapeAss(word.word.toUpperCase())
        const fx = wordFx.get(word.word.toLowerCase().replace(/[^a-z0-9]/g, '')) ?? ''
        const color = active || key ? preset.emphasis : '&H00FFFFFF'
        const pop = active ? '\\t(0,120,\\fscx112\\fscy112)' : ''
        return `${fx}{\\1c${color}${pop}}${body}{\\fscx100\\fscy100}`
  }

  const dialogues = groups.flatMap((g) =>
    g.words.map((activeWord, activeIdx) => {
      const lineStart = activeWord.start
      const lineEnd = Math.max(lineStart + 0.05, g.words[activeIdx + 1]?.start ?? g.end)
      const text = g.words.map((word, idx) => wordText(word, idx === activeIdx)).join(' ')
      return `Dialogue: 0,${secToAss(lineStart)},${secToAss(lineEnd)},Default,,0,0,0,,${opts.styleLead ?? ''}{\\fad(20,20)}${text}`
    })
  )

  // Beta hook: a centered intro card on its own style, fading in/out, on top (layer 1).
  if (opts.hook && opts.hook.text.trim() && opts.hook.untilSec > 0) {
    const body = escapeAss(opts.hook.text.trim().toUpperCase())
    const hookTag = hookFx ? textPresetTag(hookFx.preset) : ''
    dialogues.unshift(`Dialogue: 1,${secToAss(0)},${secToAss(opts.hook.untilSec)},Hook,,0,0,0,,${hookTag}{\\fad(250,250)}${body}`)
  }

  return { ass: `${header}\n${dialogues.join('\n')}\n`, zoomHits: [...new Set(zoomHits)].sort((a, b) => a - b) }
}
