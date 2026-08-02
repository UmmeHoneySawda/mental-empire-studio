/* Spreading a handful of stills across a long timeline.
 *
 * Two shapes of the same problem:
 *   - "fill"  — cover the empty stretches with the chosen media, one slot each. Four
 *               images over eight minutes gives four two-minute stretches.
 *   - "cycle" — cover the same stretches but chop them into short segments and rotate
 *               through the media. Four images at eight seconds keeps the frame moving
 *               instead of holding one photo for two minutes.
 *
 * Pure and deterministic: the same inputs always produce the same plan, including the
 * shuffle, because a render must be reproducible from the saved project.
 */

export interface FillSpan {
  /** inclusive */
  startFrame: number
  /** exclusive */
  endFrame: number
}

export interface MediaFillPlanInput {
  /** Media to place, in the order the user picked them. */
  assetIds: readonly string[]
  /** The stretches of timeline to cover. */
  spans: readonly FillSpan[]
  fps: number
  /** Segment length for `cycle`. Zero or less means one slot per asset per span. */
  segmentSeconds: number
  /** Rotate in a shuffled order rather than the picked order. */
  shuffle: boolean
  /** Seeds the shuffle so the plan is reproducible. */
  seed: number
}

export interface PlannedFillScene {
  assetId: string
  startFrame: number
  durationFrames: number
}

/** Shortest segment worth creating. Below this a slot is visual noise, so the remainder
 *  is folded into its neighbour instead. */
const MIN_SEGMENT_FRAMES = 6

/** Small deterministic PRNG (mulberry32) — enough for shuffling a handful of ids, and
 *  reproducible from the seed stored on the project. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable seed for a saved media arrangement. Project revision is deliberately absent:
 *  repeating the same request after an unrelated edit must not reshuffle the pictures. */
export function mediaFillSeed(
  projectId: string,
  assetIds: readonly string[],
  segmentSeconds: number
): number {
  const value = [projectId, String(segmentSeconds), ...assetIds].join('\u0000')
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Splits `total` frames into `count` slots whose lengths differ by at most one frame,
 *  so the slots always sum to exactly `total` — no rounding gap at the end. */
function evenSplit(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const extra = total - base * count
  return Array.from({ length: count }, (_, index) => base + (index < extra ? 1 : 0))
}

/**
 * Picks the asset for each slot. Round-robin keeps the user's order; shuffled draws from
 * a reshuffled deck each pass, and never repeats the asset that just played, so a cycle
 * cannot show the same still twice in a row.
 */
function assetSequence(
  assetIds: readonly string[],
  count: number,
  shuffle: boolean,
  seed: number
): string[] {
  if (assetIds.length === 0) return []
  if (!shuffle) return Array.from({ length: count }, (_, index) => assetIds[index % assetIds.length]!)

  const next = random(seed)
  const out: string[] = []
  let deck: string[] = []
  while (out.length < count) {
    if (deck.length === 0) {
      deck = [...assetIds]
      for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j]!, deck[i]!]
      }
      // A fresh deck starting with the id that just played would read as a stutter.
      if (deck.length > 1 && out.length > 0 && deck[0] === out[out.length - 1]) {
        ;[deck[0], deck[1]] = [deck[1]!, deck[0]!]
      }
    }
    out.push(deck.shift()!)
  }
  return out
}

/** Slot boundaries inside one span. */
function slotsFor(span: FillSpan, assetCount: number, segmentFrames: number): number[] {
  const total = span.endFrame - span.startFrame
  if (total <= 0) return []
  if (segmentFrames > 0) {
    const fullSlots = Math.floor(total / segmentFrames)
    const remainder = total - fullSlots * segmentFrames
    const lengths = Array.from({ length: fullSlots }, () => segmentFrames)
    // The requested interval stays exact. Only the final item is trimmed, including a
    // one-frame remainder: dropping that frame would leave visible background at export.
    if (remainder > 0) lengths.push(remainder)
    return lengths.length > 0 ? lengths : [total]
  }
  const count = Math.max(1, Math.min(assetCount, Math.floor(total / MIN_SEGMENT_FRAMES) || 1))
  return evenSplit(total, count)
}

/**
 * Turns the chosen media plus the empty stretches into a concrete list of clips.
 * Slots tile each span exactly — no gaps, no overlaps — so the result can be handed
 * straight to the project without further arithmetic.
 */
export function planMediaFill(input: MediaFillPlanInput): PlannedFillScene[] {
  const assetIds = [...new Set(input.assetIds.filter(Boolean))]
  if (assetIds.length === 0) return []
  const fps = Math.max(1, input.fps)
  const segmentFrames = input.segmentSeconds > 0 ? Math.max(MIN_SEGMENT_FRAMES, Math.round(input.segmentSeconds * fps)) : 0

  const spans = input.spans
    .map((span) => ({ startFrame: Math.max(0, Math.round(span.startFrame)), endFrame: Math.round(span.endFrame) }))
    // Fill mode still ignores visual-noise gaps. Cycle mode must cover every last frame,
    // because its contract is complete timeline coverage with a trimmed final item.
    .filter((span) => span.endFrame - span.startFrame >= (segmentFrames > 0 ? 1 : MIN_SEGMENT_FRAMES))
    .sort((left, right) => left.startFrame - right.startFrame)
  if (spans.length === 0) return []

  const lengthsPerSpan = spans.map((span) => slotsFor(span, assetIds.length, segmentFrames))
  const totalSlots = lengthsPerSpan.reduce((sum, lengths) => sum + lengths.length, 0)
  // One sequence across every span, so the rotation carries on rather than restarting
  // (and repeating the same still) at each gap.
  const sequence = assetSequence(assetIds, totalSlots, input.shuffle, input.seed)

  const planned: PlannedFillScene[] = []
  let slot = 0
  for (let index = 0; index < spans.length; index += 1) {
    let cursor = spans[index]!.startFrame
    for (const durationFrames of lengthsPerSpan[index]!) {
      planned.push({ assetId: sequence[slot]!, startFrame: cursor, durationFrames })
      cursor += durationFrames
      slot += 1
    }
  }
  return planned
}

/**
 * The stretches of `[0, durationFrames)` not already covered by `occupied`. This is what
 * "fill the empty space" means: existing clips are left alone.
 */
export function emptySpans(
  occupied: ReadonlyArray<{ startFrame: number; durationFrames: number }>,
  durationFrames: number
): FillSpan[] {
  const ranges = occupied
    .map((scene) => ({
      startFrame: Math.max(0, scene.startFrame),
      endFrame: Math.min(durationFrames, scene.startFrame + scene.durationFrames)
    }))
    .filter((range) => range.endFrame > range.startFrame)
    .sort((left, right) => left.startFrame - right.startFrame)

  const gaps: FillSpan[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.startFrame > cursor) gaps.push({ startFrame: cursor, endFrame: range.startFrame })
    cursor = Math.max(cursor, range.endFrame)
  }
  if (cursor < durationFrames) gaps.push({ startFrame: cursor, endFrame: durationFrames })
  return gaps
}
