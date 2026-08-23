import type { CaptionGroupingOptions } from './captions'
import { HexColorSchema, type JsonObject } from './common'

/* The Cinematic Hooks and Captions set — five hooks and five caption systems delivered as
 * Remotion components and ported in `video-engine/remotion/new-templates/`.
 *
 * This module is the ONLY definition of the set. The Electron manifest builder, the Remotion
 * components and the editor accordion all read it, so a display name, a default line or a
 * paging limit cannot drift between the three layers. It stays free of React and of anything
 * beyond the sibling shared modules, because Electron main imports it too. */

export const NEW_HOOK_TEMPLATE_IDS = [
  'remotion-hook-cine-title-card',
  'remotion-hook-cine-reel-burn',
  'remotion-hook-cine-hard-light',
  'remotion-hook-cine-trailer-drop',
  'remotion-hook-cine-margin-note',
] as const
export type NewHookTemplateId = (typeof NEW_HOOK_TEMPLATE_IDS)[number]

export const NEW_CAPTION_TEMPLATE_IDS = [
  'remotion-caption-cine-word-pop',
  'remotion-caption-cine-keyword-stack',
  'remotion-caption-cine-scrim-roll',
  'remotion-caption-cine-line-build',
  'remotion-caption-cine-held',
] as const
export type NewCaptionTemplateId = (typeof NEW_CAPTION_TEMPLATE_IDS)[number]

const NEW_HOOK_ID_SET: ReadonlySet<string> = new Set(NEW_HOOK_TEMPLATE_IDS)
const NEW_CAPTION_ID_SET: ReadonlySet<string> = new Set(NEW_CAPTION_TEMPLATE_IDS)

export function isNewHookTemplateId(id: string | undefined | null): id is NewHookTemplateId {
  return typeof id === 'string' && NEW_HOOK_ID_SET.has(id)
}

export function isNewCaptionTemplateId(id: string | undefined | null): id is NewCaptionTemplateId {
  return typeof id === 'string' && NEW_CAPTION_ID_SET.has(id)
}

/** Ember. The set allows exactly one accent per video, and this is its default. */
/* Hex is canonicalised to UPPERCASE throughout this module, including every value
 * resolveNewCaptionStyle returns, so the manifest builder, the Remotion components and the
 * accordion can compare colours by identity without one layer's '#c9553c' missing another's
 * '#C9553C'. Case carries no meaning here: CSS is case-insensitive and HexColorSchema takes both. */
export const NEW_TEMPLATE_ACCENT = '#C9553C'
export const NEW_TEMPLATE_BONE = '#ECE5D8'

export interface NewTemplateTextField {
  readonly key: string
  readonly label: string
  readonly default: string
  readonly maxLength: number
  /** headline and body are also written onto the plan's single beat, so the existing Beats
   *  list edits the same line the accordion does. Everything else lives only in props. */
  readonly role: 'headline' | 'body' | 'prop'
  readonly hint?: string
}

export interface NewTemplateNumberField {
  readonly key: string
  readonly label: string
  readonly default: number
  readonly minimum: number
  readonly maximum: number
  readonly integer: boolean
}

export interface NewHookDefinition {
  readonly id: NewHookTemplateId
  readonly name: string
  readonly description: string
  /** The delivered length. Internal beat times scale with dur / defaultSeconds, so the
   *  choreography is byte-identical here and keeps its proportions at any other length. */
  readonly defaultSeconds: number
  readonly grain: number
  readonly usesAccent: boolean
  readonly textFields: readonly NewTemplateTextField[]
  readonly numberFields: readonly NewTemplateNumberField[]
}

const HOOKS: Record<NewHookTemplateId, NewHookDefinition> = {
  'remotion-hook-cine-title-card': {
    id: 'remotion-hook-cine-title-card',
    name: 'Cine · Title Card',
    description:
      'Prestige film open on black. A hairline rule opens, the statement rises, its letterspacing settles, and a monospace kicker lands underneath.',
    defaultSeconds: 4,
    grain: 0.55,
    usesAccent: true,
    textFields: [
      {
        key: 'line',
        label: 'Statement',
        default: "THAT ISN'T THE ENDING.",
        maxLength: 500,
        role: 'headline',
        hint: 'Cinzel has no true lowercase — write this in capitals.',
      },
      { key: 'kicker', label: 'Kicker', default: 'ON LEAVING', maxLength: 120, role: 'prop' },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-reel-burn': {
    id: 'remotion-hook-cine-reel-burn',
    name: 'Cine · Reel Burn',
    description:
      'A 35mm light leak sweeps across your footage and wipes the line in, then a warm flash takes it out.',
    defaultSeconds: 5,
    grain: 0.7,
    usesAccent: true,
    textFields: [
      { key: 'lineA', label: 'First line', default: "They didn't reach out", maxLength: 500, role: 'headline' },
      {
        key: 'lineB',
        label: 'Second line',
        default: 'when you were *falling apart*.',
        maxLength: 500,
        role: 'body',
        hint: 'Wrap one word in *asterisks* to make it the accent word.',
      },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-hard-light': {
    id: 'remotion-hook-cine-hard-light',
    name: 'Cine · Hard Light',
    description:
      'Noir. A shaft rakes in through blinds and condensed slab capitals slide out of the shadow with a hard cut out.',
    defaultSeconds: 3.5,
    grain: 0.45,
    usesAccent: false,
    textFields: [
      { key: 'lineA', label: 'First line', default: "You've been braced", maxLength: 300, role: 'headline' },
      { key: 'lineB', label: 'Second line', default: 'for the explosion.', maxLength: 300, role: 'body' },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-trailer-drop': {
    id: 'remotion-hook-cine-trailer-drop',
    name: 'Cine · Trailer Drop',
    description:
      'Two clipped beats on black, then the line scales up as an anamorphic flare crosses the frame.',
    defaultSeconds: 6,
    grain: 0.5,
    usesAccent: true,
    textFields: [
      { key: 'beatA', label: 'Beat one', default: 'THE SCREAMING MATCH.', maxLength: 200, role: 'prop' },
      { key: 'beatB', label: 'Beat two', default: 'THE BLOCKED NUMBER.', maxLength: 200, role: 'prop' },
      {
        key: 'drop',
        label: 'The drop',
        default: "THAT'S THEM STILL PAYING *RENT* IN YOUR HEAD.",
        maxLength: 500,
        role: 'headline',
        hint: 'Wrap one word in *asterisks* to make it the accent word.',
      },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-margin-note': {
    id: 'remotion-hook-cine-margin-note',
    name: 'Cine · Margin Note',
    description:
      'Documentary column with a running timecode beside your footage; the line builds word by word and slides out left.',
    defaultSeconds: 5.5,
    grain: 0.6,
    usesAccent: true,
    textFields: [
      {
        key: 'line',
        label: 'Line',
        default: 'The ending is a Tuesday where nothing happens at all.',
        maxLength: 500,
        role: 'headline',
      },
      { key: 'reel', label: 'Reel slate', default: 'REEL 04', maxLength: 64, role: 'prop' },
    ],
    numberFields: [
      {
        key: 'startTimecodeSeconds',
        label: 'Start timecode',
        default: 761,
        minimum: 0,
        maximum: 86_399, // 23:59:59 — matches timecodeStamp's hour rollover (see video-engine/remotion/new-templates/hooks.tsx)
        integer: true,
      },
    ],
  },
}

export const NEW_HOOK_DEFINITIONS: Readonly<Record<NewHookTemplateId, NewHookDefinition>> =
  Object.freeze(HOOKS)

export interface NewCaptionDefinition {
  readonly id: NewCaptionTemplateId
  readonly name: string
  readonly description: string
  readonly grain: number
  readonly textColor: string
  readonly accentColor: string
  /** Font size as a share of the canvas's smaller dimension, matching the delivered
   *  1920x1080 sizes. Clamped between 0.037 and 0.082 at render time — 0.037 is the
   *  floor that pins the 40px minimum at 1080p (existing captionLayoutMetrics uses
   *  0.032). */
  readonly fontScale: number
  readonly maxWordsPerCue: number
  readonly maxCharactersPerLine: number
  readonly maxLines: number
  readonly maxDurationSeconds: number
  readonly maxGapSeconds: number
}

const CAPTIONS: Record<NewCaptionTemplateId, NewCaptionDefinition> = {
  'remotion-caption-cine-word-pop': {
    id: 'remotion-caption-cine-word-pop',
    name: 'Cine · Word Pop',
    description:
      'Karaoke in condensed capitals. Every word pops in on its own measured onset and the word being spoken burns accent.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.089,
    maxWordsPerCue: 3,
    maxCharactersPerLine: 18,
    maxLines: 2,
    maxDurationSeconds: 2.4,
    maxGapSeconds: 0.48,
  },
  'remotion-caption-cine-keyword-stack': {
    id: 'remotion-caption-cine-keyword-stack',
    name: 'Cine · Keyword Stack',
    description:
      'Roman capitals, left aligned. The opening line sits dim as setup and the key word turns accent as a rule swipes under it.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.076,
    maxWordsPerCue: 6,
    maxCharactersPerLine: 26,
    maxLines: 2,
    maxDurationSeconds: 3.2,
    maxGapSeconds: 0.55,
  },
  'remotion-caption-cine-scrim-roll': {
    id: 'remotion-caption-cine-scrim-roll',
    name: 'Cine · Scrim Roll',
    description:
      'Lower-third narration in monospace on a soft scrim — no box. Lines rise in sequence behind a blinking accent block.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.037,
    maxWordsPerCue: 9,
    maxCharactersPerLine: 34,
    maxLines: 3,
    maxDurationSeconds: 4,
    maxGapSeconds: 0.7,
  },
  'remotion-caption-cine-line-build': {
    id: 'remotion-caption-cine-line-build',
    name: 'Cine · Line Build',
    description:
      'Lines stack upward as they are spoken; earlier ones drift and dim while the newest lands in accent.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.078,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 22,
    maxLines: 1,
    maxDurationSeconds: 2.8,
    maxGapSeconds: 0.5,
  },
  'remotion-caption-cine-held': {
    id: 'remotion-caption-cine-held',
    name: 'Cine · Held Statement',
    description:
      'A held statement whose letterspacing tightens as it settles, with the emphasised word switching to accent under a hairline rule.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.057,
    maxWordsPerCue: 8,
    maxCharactersPerLine: 30,
    maxLines: 2,
    maxDurationSeconds: 3.4,
    maxGapSeconds: 0.6,
  },
}

export const NEW_CAPTION_DEFINITIONS: Readonly<Record<NewCaptionTemplateId, NewCaptionDefinition>> =
  Object.freeze(CAPTIONS)

export type ResolvedNewCaptionStyle = NewCaptionDefinition

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

function boundedUnit(value: JsonObject[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

/* Uppercases the fallback as well as the accepted value, so every colour this module hands out
 * is canonical no matter which branch produced it. */
function colour(value: JsonObject[string] | undefined, fallback: string): string {
  return typeof value === 'string' && HexColorSchema.safeParse(value).success
    ? value.toUpperCase()
    : fallback.toUpperCase()
}

/** Null for anything that is not one of the five new caption templates, so the caller keeps
 *  using the existing caption layer instead of silently drawing a different style. */
export function resolveNewCaptionStyle(
  templateId: string | undefined,
  props: JsonObject | undefined = undefined,
): ResolvedNewCaptionStyle | null {
  if (!isNewCaptionTemplateId(templateId)) return null
  const base = CAPTIONS[templateId]
  return {
    ...base,
    textColor: colour(props?.['textColor'], base.textColor),
    accentColor: colour(props?.['accentColor'], base.accentColor),
    grain: boundedUnit(props?.['grain'], base.grain),
    maxWordsPerCue: boundedInteger(props?.['maxWordsPerCue'], base.maxWordsPerCue, 1, 12),
    maxCharactersPerLine: boundedInteger(
      props?.['maxCharactersPerLine'],
      base.maxCharactersPerLine,
      10,
      42,
    ),
  }
}

export function captionGroupingOptionsForNewTemplate(
  style: ResolvedNewCaptionStyle,
  fps: number,
): CaptionGroupingOptions {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  /* CaptionGroupingOptionsSchema.maxLines is .min(1).max(3) and CaptionCueSchema.lines is .max(3),
   * so an out-of-band table value would throw when the caption layer parses instead of being
   * caught here. The character budget follows the line count the consumer will actually honour. */
  const safeLines = Math.max(1, Math.min(3, style.maxLines))
  return {
    maxWordsPerCue: style.maxWordsPerCue,
    maxCharactersPerCue: style.maxCharactersPerLine * safeLines,
    maxCharactersPerLine: style.maxCharactersPerLine,
    maxLines: safeLines,
    maxDurationFrames: Math.max(1, Math.round(style.maxDurationSeconds * safeFps)),
    maxGapFrames: Math.max(0, Math.round(style.maxGapSeconds * safeFps)),
    preferSentenceBreaks: true,
  }
}
