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
  /** renderer-selected animation preset */
  animation?: string
  aspect: CaptionAspect
  /** auto-emphasize detected keywords in addition to per-word emphasis flags */
  keywords: boolean
  /** words per on-screen caption group (Word preset forces 1) */
  perGroup?: number
  /** number of stacked caption lines the user wants on screen */
  lines?: 1 | 2 | 3
  /** word mode keeps active-word highlighting; phrase mode reduces long-form CPU burn */
  mode?: 'word' | 'phrase'
  /** beta: intro "hook" text card shown centered for the first untilSec seconds */
  hook?: { text: string; untilSec: number }
  /** beta: a leading ASS override tag applied to every caption line (the style "feel") */
  styleLead?: string
  /** beta: per-word / hook text-effect presets from the validated effect plan */
  textEffects?: PlanTextEffect[]
  /** vertical caption placement */
  position?: Project['captionPosition']
  /** active/highlighted word text colour, as #rrggbb */
  highlightColor?: string
  /** active-word box settings, used by the Submagic preset */
  highlightBox?: { enabled: boolean; boxColor: string; textColor: string; radius?: number; padding?: number }
  /** Submagic phrase-window size */
  wordsPerPage?: 1 | 2 | 3
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
  Submagic: { font: 'Anton', size: 108, primary: '&H00111111', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H003DD9FF', bold: 1, borderStyle: 3, outlineW: 7, shadow: 0, emphasis: '&H00111111' },
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

function hexToAssColor(hex: string | undefined, fallback: string): string {
  const m = (hex ?? '').trim().match(/^#?([0-9a-f]{6})$/i)
  if (!m) return fallback
  const s = m[1].toUpperCase()
  return `&H00${s.slice(4, 6)}${s.slice(2, 4)}${s.slice(0, 2)}`
}

function clampWordsPerPage(v: unknown): 1 | 2 | 3 {
  return v === 2 || v === 3 ? v : 1
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

function clampLines(v: unknown): 1 | 2 | 3 {
  return v === 2 || v === 3 ? v : 1
}

function animationWordTag(animation: string | undefined, active: boolean): string {
  if (!active) return ''
  switch (animation) {
    case 'Bounce':
      return '\\t(0,80,\\fscx120\\fscy120)\\t(80,150,\\fscx96\\fscy96)\\t(150,230,\\fscx108\\fscy108)'
    case 'Slide':
      return '\\t(0,140,\\fscx108\\fscy108)'
    case 'Type':
      return '\\t(0,80,\\fscx106\\fscy106)'
    case 'Pop-in':
    default:
      return '\\t(0,120,\\fscx112\\fscy112)'
  }
}

function animationLineLead(animation: string | undefined, w: number, h: number, marginV: number, alignment: 2 | 5 | 8, fadeIn = true, fadeOut = true): string {
  // In word mode this lead is only attached to the first/last word of a group, so the
  // line fades in once and out once. Applying \fad to every per-word event made libass
  // tear down and rebuild the whole line on each word boundary -> visible flicker.
  const inMs = fadeIn ? 20 : 0
  const outMs = fadeOut ? 20 : 0
  const fad = `\\fad(${inMs},${outMs})`
  if (animation !== 'Slide' || !fadeIn) return `{${fad}}`
  const x = Math.round(w / 2)
  const y = alignment === 8 ? marginV : alignment === 5 ? Math.round(h / 2) : h - marginV
  return `{${fad}\\move(${x},${y + 34},${x},${y},0,150)}`
}

function wordsWithLineBreaks(words: string[], lines: 1 | 2 | 3): string {
  if (lines <= 1 || words.length <= 2) return words.join(' ')
  const perLine = Math.ceil(words.length / lines)
  const out: string[] = []
  for (let i = 0; i < words.length; i += perLine) out.push(words.slice(i, i + perLine).join(' '))
  return out.join('\\N')
}

export function buildAss(words: TranscriptWord[], opts: CaptionOptions): AssResult {
  const rawPreset = PRESETS[opts.preset] ?? PRESETS.Hormozi
  const { w, h } = resolutionFor(opts.aspect)
  const fontPx = Math.round(Math.max(64, Math.min(opts.aspect === '9:16' ? h * 0.11 : h * 0.085, opts.aspect === '9:16' ? 150 : 108)))
  const hasHighlightBox = opts.preset === 'Submagic' || !!opts.highlightBox?.enabled
  const preset = {
    ...rawPreset,
    font: safeFontName(opts.font, rawPreset.font),
    size: opts.preset === 'Word' ? Math.round(fontPx * 1.12) : opts.preset === 'Submagic' ? Math.round(fontPx * 1.04) : fontPx,
    primary: hasHighlightBox ? hexToAssColor(opts.highlightBox?.textColor ?? opts.highlightColor, rawPreset.primary) : rawPreset.primary,
    emphasis: hasHighlightBox ? hexToAssColor(opts.highlightBox?.textColor ?? opts.highlightColor, rawPreset.emphasis) : hexToAssColor(opts.highlightColor, rawPreset.emphasis),
    back: hasHighlightBox ? hexToAssColor(opts.highlightBox?.boxColor, rawPreset.back) : rawPreset.back,
    borderStyle: hasHighlightBox ? 3 as const : rawPreset.borderStyle,
    outlineW: hasHighlightBox ? Math.max(rawPreset.outlineW, 7) : rawPreset.outlineW,
    shadow: hasHighlightBox ? 0 : rawPreset.shadow
  }
  const lines = hasHighlightBox ? 1 : clampLines(opts.lines)
  const wordsPerLine = opts.aspect === '9:16' ? 3 : opts.aspect === '1:1' ? 3 : 4
  const defaultGroup = wordsPerLine * lines
  const perGroup = hasHighlightBox ? clampWordsPerPage(opts.wordsPerPage) : opts.preset === 'Word' && lines === 1 ? 1 : Math.max(1, opts.perGroup ?? defaultGroup)
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
        const pop = animationWordTag(opts.animation, active)
        return `${fx}{\\1c${color}${pop}}${body}{\\fscx100\\fscy100}`
  }

  const mode = hasHighlightBox ? 'word' : (opts.mode ?? 'word')
  const dialogues = mode === 'phrase'
    ? groups.map((g) => {
      const lineStart = g.start
      const lineEnd = Math.max(lineStart + 0.3, g.end)
      const text = wordsWithLineBreaks(g.words.map((word) => wordText(word, false)), lines)
      return `Dialogue: 0,${secToAss(lineStart)},${secToAss(lineEnd)},Default,,0,0,0,,${opts.styleLead ?? ''}${animationLineLead(opts.animation, w, h, marginV, alignment)}${text}`
    })
    : groups.flatMap((g) =>
      g.words.map((activeWord, activeIdx) => {
      const lineStart = activeWord.start
      const lineEnd = Math.max(lineStart + 0.05, g.words[activeIdx + 1]?.start ?? g.end)
      const visibleWords = hasHighlightBox ? [activeWord] : opts.animation === 'Type' ? g.words.slice(0, activeIdx + 1) : g.words
      const text = wordsWithLineBreaks(visibleWords.map((word) => wordText(word, word.id === activeWord.id)), lines)
      // Fade the line in only on the first word and out only on the last word of the
      // group. Mid-group word swaps carry no \fad, so libass updates the active word in
      // place instead of fading the whole line out and back in (the flicker bug).
      const isFirst = activeIdx === 0
      const isLast = activeIdx === g.words.length - 1
      const lead = isFirst || isLast
        ? animationLineLead(opts.animation, w, h, marginV, alignment, isFirst, isLast)
        : ''
      return `Dialogue: 0,${secToAss(lineStart)},${secToAss(lineEnd)},Default,,0,0,0,,${opts.styleLead ?? ''}${lead}${text}`
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
