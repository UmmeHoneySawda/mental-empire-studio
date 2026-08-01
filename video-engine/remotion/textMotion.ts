/* Text-clip entrance motion — the data and the maths, with no React in sight.
 *
 * This is a module rather than a `switch` inside `scene.tsx` because the editor's Text
 * panel offers a list of motions and the composition implements them, and those two lists
 * had drifted: `typewriter`, `word-by-word` and `stagger` were offered in the dropdown,
 * saved onto the scene and accepted by preflight, but `textEntrance` had no case for any of
 * them. They fell through its `default:` and rendered the `rise` curve — the full string,
 * visible from the first frame, sliding up. Three of the ten motions silently did something
 * else, in the player and in a headless render alike.
 *
 * So `TEXT_MOTION_IDS` is the one canonical list. The panel derives its dropdown from it
 * and a regression test asserts every id resolves to a distinct implemented motion, which
 * is the same drift guard `ANIMATED_REMOTION_TRANSITIONS` gives the transitions.
 *
 * Everything here is a pure function of the clip-local frame, so a seek lands on exactly
 * the picture a sequential render would produce.
 */
import { interpolate } from 'remotion'

export const TEXT_MOTION_IDS = [
  'none',
  'fade',
  'rise',
  'drop',
  'scale',
  'typewriter',
  'word-by-word',
  'blur-in',
  'slide-left',
  'stagger',
] as const

export type TextMotionId = (typeof TEXT_MOTION_IDS)[number]

const KNOWN: ReadonlySet<string> = new Set(TEXT_MOTION_IDS)

export function isTextMotionId(value: string): value is TextMotionId {
  return KNOWN.has(value)
}

/** A scene with no `animation` prop predates the Text panel and has always rendered
 *  statically, so absent means `none`. An unrecognised id resolves to `none` too: a name
 *  this build cannot draw should not quietly animate as something else — that is the bug
 *  this module exists to stop. */
export function resolveTextMotion(value: string | undefined): TextMotionId {
  return value !== undefined && isTextMotionId(value) ? value : 'none'
}

/** How the copy is broken up before the motion is applied. `none` animates the whole
 *  block as one unit, which is what seven of the ten motions want. */
export type TextMotionSplit = 'none' | 'word' | 'character'

export function textMotionSplit(id: TextMotionId): TextMotionSplit {
  switch (id) {
    // Typing is a per-character act; anything coarser is not a typewriter.
    case 'typewriter':
      return 'character'
    // Both reveal word by word — they differ in the curve each word arrives on, not in
    // how the copy is cut up.
    case 'word-by-word':
    case 'stagger':
      return 'word'
    default:
      return 'none'
  }
}

export interface TextMotionUnit {
  readonly text: string
  /** Position in the reveal order. Drives this unit's delay. */
  readonly ordinal: number
}

/** A run that must not be broken across lines. Grouping words keeps normal wrapping when
 *  the units are single characters — without it every character is its own inline-block and
 *  a line can break mid-word. */
export interface TextMotionGroup {
  readonly units: readonly TextMotionUnit[]
  readonly whitespace: boolean
}

const WHITESPACE_RUN = /(\s+)/

/** Breaks `text` into the groups and units a motion reveals, in reveal order. */
export function splitForTextMotion(
  text: string,
  split: TextMotionSplit,
): readonly TextMotionGroup[] {
  if (split === 'none') {
    return [{ units: [{ text, ordinal: 0 }], whitespace: false }]
  }

  // `split` with a captured separator keeps the whitespace runs as tokens, so the rendered
  // spacing is identical to the unsplit block.
  const tokens = text.split(WHITESPACE_RUN).filter((token) => token !== '')
  const groups: TextMotionGroup[] = []
  let ordinal = 0

  for (const token of tokens) {
    const whitespace = token.trim() === ''
    if (split === 'character') {
      // A typewriter types its spaces too, so every character takes a beat of its own.
      groups.push({
        units: [...token].map((character) => ({ text: character, ordinal: ordinal++ })),
        whitespace,
      })
      continue
    }
    // Word split: a whitespace run rides along with the word it follows rather than
    // consuming a beat, so the gaps do not stretch the reveal.
    const shared = whitespace ? Math.max(0, ordinal - 1) : ordinal++
    groups.push({ units: [{ text: token, ordinal: shared }], whitespace })
  }

  return groups.length > 0 ? groups : [{ units: [{ text, ordinal: 0 }], whitespace: false }]
}

/** How many beats the reveal is divided into. */
export function textMotionUnitCount(groups: readonly TextMotionGroup[]): number {
  let highest = 0
  for (const group of groups) {
    for (const unit of group.units) {
      if (unit.ordinal > highest) highest = unit.ordinal
    }
  }
  return highest + 1
}

export interface TextMotionStyle {
  readonly opacity: number
  readonly transform: string
  readonly filter?: string
}

/* Roughly a third of a second for a whole-block entrance: long enough to read as motion,
 * short enough that a three-second title is not still animating when it should be
 * legible. */
const BLOCK_RUNWAY_SECONDS = 0.35

/* Total time all units of a split motion take to finish arriving. Fixed rather than
 * per-unit so a long line reveals faster per character instead of running past the end of
 * a short clip. */
const REVEAL_WINDOW_SECONDS = 1.2

function runwayFrames(id: TextMotionId, fps: number): number {
  // A typewriter reveals each character outright — a fade per glyph reads as mush.
  if (id === 'typewriter') return 1
  if (id === 'word-by-word') return Math.max(1, Math.round(fps * 0.18))
  if (id === 'stagger') return Math.max(1, Math.round(fps * 0.3))
  return Math.max(1, Math.round(fps * BLOCK_RUNWAY_SECONDS))
}

/** 0 → 1 for one unit. With `unitCount` 1 the delay is zero and this is the plain
 *  whole-block ramp the block motions have always used. */
function progress(
  id: TextMotionId,
  frame: number,
  fps: number,
  ordinal: number,
  unitCount: number,
): number {
  const step = unitCount > 1 ? (fps * REVEAL_WINDOW_SECONDS) / unitCount : 0
  const start = ordinal * step
  return interpolate(frame, [start, start + runwayFrames(id, fps)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

/**
 * The style for one unit at a clip-local `frame`.
 *
 * `ordinal` / `unitCount` default to a single unit, which is exactly the whole-block case,
 * so the seven unsplit motions keep the numbers they have always rendered.
 */
export function textMotionStyle(
  id: TextMotionId,
  frame: number,
  fps: number,
  ordinal = 0,
  unitCount = 1,
): TextMotionStyle {
  if (id === 'none') return { opacity: 1, transform: 'none' }

  const t = progress(id, frame, fps, ordinal, unitCount)

  switch (id) {
    case 'fade':
      return { opacity: t, transform: 'none' }
    case 'drop':
      return { opacity: t, transform: `translateY(${interpolate(t, [0, 1], [-60, 0])}px)` }
    case 'scale':
      return { opacity: t, transform: `scale(${interpolate(t, [0, 1], [0.9, 1])})` }
    case 'blur-in':
      return {
        opacity: t,
        transform: 'none',
        filter: `blur(${interpolate(t, [0, 1], [14, 0])}px)`,
      }
    case 'slide-left':
      return { opacity: t, transform: `translateX(${interpolate(t, [0, 1], [80, 0])}px)` }
    case 'typewriter':
      // Nothing but presence: the character is either typed or it is not.
      return { opacity: t, transform: 'none' }
    case 'word-by-word':
      return { opacity: t, transform: `scale(${interpolate(t, [0, 1], [0.8, 1])})` }
    case 'stagger':
      return { opacity: t, transform: `translateY(${interpolate(t, [0, 1], [18, 0])}px)` }
    case 'rise':
      return { opacity: t, transform: `translateY(${interpolate(t, [0, 1], [28, 0])}px)` }
  }
}
