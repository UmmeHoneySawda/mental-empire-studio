import type { CaptionGroupingOptions, CaptionWord } from './captions'
import type { JsonObject } from './common'

export const LEGACY_CAPTION_STYLE_IDS = [
  'emoji-pop',
  'clip-wipe',
  'highlight',
  'neon-accent',
  'particle-burst',
  'weight-shift',
] as const

export const NEW_CAPTION_STYLE_IDS = [
  'motivation-bold',
  'mindset-pill',
  'progress-underline',
  'coach-clean',
] as const

export const CAPTION_STYLE_IDS = [
  ...LEGACY_CAPTION_STYLE_IDS,
  ...NEW_CAPTION_STYLE_IDS,
] as const

export type CaptionStyleId = (typeof CAPTION_STYLE_IDS)[number]
export type CaptionActiveTreatment =
  | 'punch'
  | 'pill'
  | 'highlight'
  | 'neon'
  | 'burst'
  | 'weight'
  | 'underline'
  | 'clean'
export type CaptionEntrance = 'pop' | 'wipe' | 'rise' | 'fade'
export type CaptionPlacement = 'center' | 'lower'

export interface CaptionStyleDefinition {
  readonly id: CaptionStyleId
  readonly name: string
  readonly description: string
  readonly fontFamily: 'Space Grotesk' | 'Hanken Grotesk' | 'Anton' | 'JetBrains Mono'
  readonly fontWeight: number
  readonly uppercase: boolean
  readonly textColor: string
  readonly activeColor: string
  readonly importantColor: string
  readonly activeTreatment: CaptionActiveTreatment
  readonly entrance: CaptionEntrance
  readonly placement: CaptionPlacement
  readonly fontScale: number
  readonly maxWordsPerCue: number
  readonly maxCharactersPerLine: number
  readonly maxLines: number
  readonly maxDurationSeconds: number
  readonly maxGapSeconds: number
}

const DEFINITIONS: Record<CaptionStyleId, CaptionStyleDefinition> = {
  'emoji-pop': {
    id: 'emoji-pop',
    name: 'Impact Pop',
    description: 'Compact uppercase captions with a crisp active-word punch.',
    fontFamily: 'Anton',
    fontWeight: 400,
    uppercase: true,
    textColor: '#FFFFFF',
    activeColor: '#FFE44D',
    importantColor: '#FF6B4A',
    activeTreatment: 'punch',
    entrance: 'pop',
    placement: 'center',
    fontScale: 0.073,
    maxWordsPerCue: 3,
    maxCharactersPerLine: 18,
    maxLines: 2,
    maxDurationSeconds: 2.4,
    maxGapSeconds: 0.48,
  },
  'clip-wipe': {
    id: 'clip-wipe',
    name: 'Active Pill Sweep',
    description: 'A dark readable plate with a spoken-word pill that sweeps on exact timing.',
    fontFamily: 'Hanken Grotesk',
    fontWeight: 800,
    uppercase: false,
    textColor: '#FFFFFF',
    activeColor: '#E6FF38',
    importantColor: '#FFB928',
    activeTreatment: 'pill',
    entrance: 'wipe',
    placement: 'lower',
    fontScale: 0.056,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 25,
    maxLines: 2,
    maxDurationSeconds: 3,
    maxGapSeconds: 0.55,
  },
  highlight: {
    id: 'highlight',
    name: 'Focus Highlight',
    description: 'A readable baseline with separate spoken and important-word emphasis.',
    fontFamily: 'Hanken Grotesk',
    fontWeight: 800,
    uppercase: false,
    textColor: '#FFFFFF',
    activeColor: '#E6FF38',
    importantColor: '#FF704D',
    activeTreatment: 'highlight',
    entrance: 'rise',
    placement: 'lower',
    fontScale: 0.055,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 25,
    maxLines: 2,
    maxDurationSeconds: 3.2,
    maxGapSeconds: 0.55,
  },
  'neon-accent': {
    id: 'neon-accent',
    name: 'Neon Signal',
    description: 'High-contrast neon accents with restrained glow and exact word timing.',
    fontFamily: 'Anton',
    fontWeight: 400,
    uppercase: true,
    textColor: '#F8FBFF',
    activeColor: '#43F6FF',
    importantColor: '#FF4FD8',
    activeTreatment: 'neon',
    entrance: 'rise',
    placement: 'lower',
    fontScale: 0.062,
    maxWordsPerCue: 4,
    maxCharactersPerLine: 21,
    maxLines: 2,
    maxDurationSeconds: 2.7,
    maxGapSeconds: 0.5,
  },
  'particle-burst': {
    id: 'particle-burst',
    name: 'Accent Burst',
    description: 'Bold active words with deterministic geometric accent marks.',
    fontFamily: 'Anton',
    fontWeight: 400,
    uppercase: true,
    textColor: '#FFFFFF',
    activeColor: '#FFF23D',
    importantColor: '#FF5A45',
    activeTreatment: 'burst',
    entrance: 'pop',
    placement: 'center',
    fontScale: 0.069,
    maxWordsPerCue: 3,
    maxCharactersPerLine: 18,
    maxLines: 2,
    maxDurationSeconds: 2.4,
    maxGapSeconds: 0.48,
  },
  'weight-shift': {
    id: 'weight-shift',
    name: 'Quiet Emphasis',
    description: 'Sentence-case captions that emphasize speech through weight and color.',
    fontFamily: 'Space Grotesk',
    fontWeight: 500,
    uppercase: false,
    textColor: '#F8FAFC',
    activeColor: '#7DD3FC',
    importantColor: '#FBBF24',
    activeTreatment: 'weight',
    entrance: 'fade',
    placement: 'lower',
    fontScale: 0.049,
    maxWordsPerCue: 6,
    maxCharactersPerLine: 28,
    maxLines: 2,
    maxDurationSeconds: 3.4,
    maxGapSeconds: 0.62,
  },
  'motivation-bold': {
    id: 'motivation-bold',
    name: 'Motivation Bold',
    description: 'Warm, decisive uppercase captions for motivational claims and payoffs.',
    fontFamily: 'Anton',
    fontWeight: 400,
    uppercase: true,
    textColor: '#FFFFFF',
    activeColor: '#FFD84D',
    importantColor: '#FF684A',
    activeTreatment: 'punch',
    entrance: 'pop',
    placement: 'lower',
    fontScale: 0.071,
    maxWordsPerCue: 4,
    maxCharactersPerLine: 20,
    maxLines: 2,
    maxDurationSeconds: 2.5,
    maxGapSeconds: 0.5,
  },
  'mindset-pill': {
    id: 'mindset-pill',
    name: 'Mindset Pill',
    description: 'Calm psychological captions with a focused violet spoken-word pill.',
    fontFamily: 'Hanken Grotesk',
    fontWeight: 800,
    uppercase: false,
    textColor: '#F8F7FF',
    activeColor: '#A78BFA',
    importantColor: '#F0ABFC',
    activeTreatment: 'pill',
    entrance: 'rise',
    placement: 'lower',
    fontScale: 0.055,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 25,
    maxLines: 2,
    maxDurationSeconds: 3.1,
    maxGapSeconds: 0.58,
  },
  'progress-underline': {
    id: 'progress-underline',
    name: 'Progress Underline',
    description: 'Grounded self-improvement captions with a timed cyan underline.',
    fontFamily: 'Space Grotesk',
    fontWeight: 700,
    uppercase: false,
    textColor: '#F8FAFC',
    activeColor: '#38D9D9',
    importantColor: '#FBBF24',
    activeTreatment: 'underline',
    entrance: 'rise',
    placement: 'lower',
    fontScale: 0.053,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 26,
    maxLines: 2,
    maxDurationSeconds: 3.2,
    maxGapSeconds: 0.58,
  },
  'coach-clean': {
    id: 'coach-clean',
    name: 'Coach Clean',
    description: 'Calm, minimal captions for educational and serious talking-head video.',
    fontFamily: 'Hanken Grotesk',
    fontWeight: 700,
    uppercase: false,
    textColor: '#FFFFFF',
    activeColor: '#DDE7F0',
    importantColor: '#F5C451',
    activeTreatment: 'clean',
    entrance: 'fade',
    placement: 'lower',
    fontScale: 0.051,
    maxWordsPerCue: 6,
    maxCharactersPerLine: 29,
    maxLines: 2,
    maxDurationSeconds: 3.6,
    maxGapSeconds: 0.65,
  },
}

const STYLE_IDS = new Set<string>(CAPTION_STYLE_IDS)
const APPROVED_FONTS = new Set(CAPTION_STYLE_IDS.map((id) => DEFINITIONS[id].fontFamily))
const HEX_COLOR = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u

export const CAPTION_STYLE_DEFINITIONS: Readonly<Record<CaptionStyleId, CaptionStyleDefinition>> =
  Object.freeze(DEFINITIONS)

export function captionStyleIdFromTemplateId(templateId: string | undefined): CaptionStyleId {
  const normalized = templateId?.trim().toLowerCase() ?? ''
  if (normalized === 'caption-clean') return 'coach-clean'
  if (normalized === 'caption-karaoke') return 'clip-wipe'
  if (normalized === 'caption-punch') return 'emoji-pop'
  if (STYLE_IDS.has(normalized)) return normalized as CaptionStyleId
  for (const id of CAPTION_STYLE_IDS) {
    if (normalized.endsWith(`-${id}`)) return id
  }
  return 'highlight'
}

export interface ResolvedCaptionStyle extends CaptionStyleDefinition {
  readonly maxWordsPerCue: number
  readonly maxCharactersPerLine: number
}

function boundedInteger(
  value: JsonObject[string] | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback
}

function color(value: JsonObject[string] | undefined, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : fallback
}

export function resolveCaptionStyle(
  templateId: string | undefined,
  props: JsonObject | undefined = undefined,
): ResolvedCaptionStyle {
  const base = DEFINITIONS[captionStyleIdFromTemplateId(templateId)]
  const requestedFont = props?.['fontFamily']
  return {
    ...base,
    fontFamily:
      typeof requestedFont === 'string' && APPROVED_FONTS.has(requestedFont as CaptionStyleDefinition['fontFamily'])
        ? requestedFont as CaptionStyleDefinition['fontFamily']
        : base.fontFamily,
    textColor: color(props?.['textColor'], base.textColor),
    activeColor: color(props?.['activeColor'], base.activeColor),
    importantColor: color(props?.['importantColor'], base.importantColor),
    maxWordsPerCue: boundedInteger(props?.['maxWordsPerCue'], base.maxWordsPerCue, 1, 12),
    maxCharactersPerLine: boundedInteger(
      props?.['maxCharactersPerLine'],
      base.maxCharactersPerLine,
      10,
      42,
    ),
  }
}

export interface CaptionStyleTemplateDefaults {
  readonly fontFamily: CaptionStyleDefinition['fontFamily']
  readonly textColor: string
  readonly activeColor: string
  readonly importantColor: string
  readonly maxWordsPerCue: number
  readonly maxCharactersPerLine: number
}

export function captionStyleTemplateDefaults(
  style: CaptionStyleDefinition,
): CaptionStyleTemplateDefaults {
  return {
    fontFamily: style.fontFamily,
    textColor: style.textColor,
    activeColor: style.activeColor,
    importantColor: style.importantColor,
    maxWordsPerCue: style.maxWordsPerCue,
    maxCharactersPerLine: style.maxCharactersPerLine,
  }
}

export function captionGroupingOptionsForStyle(
  style: ResolvedCaptionStyle,
  fps: number,
): CaptionGroupingOptions {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  return {
    maxWordsPerCue: style.maxWordsPerCue,
    maxCharactersPerCue: style.maxCharactersPerLine * style.maxLines,
    maxCharactersPerLine: style.maxCharactersPerLine,
    maxLines: style.maxLines,
    maxDurationFrames: Math.max(1, Math.round(style.maxDurationSeconds * safeFps)),
    maxGapFrames: Math.max(0, Math.round(style.maxGapSeconds * safeFps)),
    preferSentenceBreaks: true,
  }
}

export interface CaptionLayoutMetrics {
  readonly aspect: 'portrait' | 'square' | 'landscape'
  readonly safeInset: number
  readonly bottomOffset: number
  readonly maxWidth: number
  readonly fontSize: number
}

export function captionLayoutMetrics(
  style: CaptionStyleDefinition,
  width: number,
  height: number,
  lineCharacterCounts: readonly number[] = [],
): CaptionLayoutMetrics {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const minimum = Math.min(safeWidth, safeHeight)
  const ratio = safeWidth / safeHeight
  const aspect = ratio < 0.9 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square'
  const bottomRatio = aspect === 'portrait' ? 0.18 : aspect === 'square' ? 0.12 : 0.09
  const maxWidthRatio = aspect === 'landscape' ? 0.78 : 0.84
  const longestLine = Math.max(1, ...lineCharacterCounts)
  const longestFit = longestLine > style.maxCharactersPerLine
    ? Math.max(0.58, style.maxCharactersPerLine / longestLine)
    : 1
  const rawFontSize = minimum * style.fontScale * longestFit
  return {
    aspect,
    safeInset: Math.round(minimum * 0.07),
    bottomOffset: Math.round(safeHeight * bottomRatio),
    maxWidth: Math.round(safeWidth * maxWidthRatio),
    fontSize: Math.round(Math.max(minimum * 0.032, Math.min(minimum * 0.082, rawFontSize))),
  }
}

export function captionWordIsActive(word: CaptionWord, frame: number): boolean {
  return frame >= word.startFrame && frame < word.endFrame
}

export function captionWordProgress(word: CaptionWord, frame: number): number {
  if (!captionWordIsActive(word, frame)) return frame < word.startFrame ? 0 : 1
  return Math.max(0, Math.min(1, (frame - word.startFrame) / Math.max(1, word.endFrame - word.startFrame)))
}

/** Visible-frame progress includes the frame currently being painted. This lets a
 * one-frame word reach its complete pill/underline state before its half-open interval
 * closes, while `captionWordProgress` retains its timeline interpolation semantics. */
export function captionWordRenderProgress(word: CaptionWord, frame: number): number {
  if (!captionWordIsActive(word, frame)) return captionWordProgress(word, frame)
  return Math.max(
    0,
    Math.min(1, (frame - word.startFrame + 1) / Math.max(1, word.endFrame - word.startFrame)),
  )
}

export function captionNeedsLeadingSpace(text: string): boolean {
  return !/^[,.;:!?%)\]}]/u.test(text)
}
