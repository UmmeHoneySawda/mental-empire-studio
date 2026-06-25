import { THUMB_W, THUMB_H, type LayerFrame, type TextLayer } from './types'

// Pure thumbnail layout helpers — shared by the renderer editor and the headless
// smoke. "Auto-arrange" lays a multi-line headline out in the most eye-catching
// way: balanced lines, the highlighted word scaled up, and the block parked in the
// largest empty region (opposite the subject) within a title-safe inset.

export interface StageSize {
  w: number
  h: number
}

export const SAFE_INSET = 0.06 // title-safe margin as a fraction of width
const CHAR_W = 0.62 // rough average glyph width as a fraction of font size
const MAX_SIZE = 120
const MIN_SIZE = 40

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Split words into 1–2 lines minimizing the length difference between them. */
export function balanceLines(words: string[]): string[][] {
  if (words.length <= 1) return [words]
  let best: string[][] = [words]
  let bestDiff = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const diff = Math.abs(a.length - b.length)
    if (diff < bestDiff) {
      bestDiff = diff
      best = [words.slice(0, i), words.slice(i)]
    }
  }
  return best
}

export interface AutoArrangeResult {
  frame: LayerFrame
  lines: { text: string; size: number }[]
}

/**
 * Compute a fresh layout for a headline text layer. Returns the new frame +
 * per-line sizes; deterministic so it can be asserted headlessly.
 */
export function autoArrangeText(
  layer: TextLayer,
  stage: StageSize = { w: THUMB_W, h: THUMB_H },
  subjectBounds?: LayerFrame | null
): AutoArrangeResult {
  const raw = (layer.text || layer.lines.map((l) => l.text).join(' ')).trim()
  const words = raw.split(/\s+/).filter(Boolean)
  const grouped = balanceLines(words)

  const hw = norm(layer.highlightWord ?? '')
  const hasHighlight = hw.length > 0 && grouped.some((g) => g.some((w) => norm(w) === hw))

  const inset = Math.round(stage.w * SAFE_INSET)
  const availW = stage.w - inset * 2
  const maxLen = Math.max(1, ...grouped.map((g) => g.join(' ').length))
  // When a word is highlighted, leave headroom so it can scale up past the base
  // without both lines pinning to the max size.
  const baseCeil = hasHighlight ? Math.floor(MAX_SIZE / 1.25) : MAX_SIZE
  const base = clamp(Math.floor(availW / (maxLen * CHAR_W)), MIN_SIZE, baseCeil)

  const lines = grouped.map((g) => {
    const text = g.join(' ')
    const highlighted = hw.length > 0 && g.some((w) => norm(w) === hw)
    const size = highlighted ? Math.min(MAX_SIZE, Math.round(base * 1.25)) : base
    return { text, size }
  })

  const blockW = Math.max(...lines.map((l) => Math.round(l.text.length * CHAR_W * l.size)))
  const blockH = lines.reduce((a, l) => a + l.size, 0)

  // Place the block opposite the subject (largest empty region), bottom-aligned.
  const subjectCenter = subjectBounds ? subjectBounds.x + subjectBounds.width / 2 : stage.w
  const subjectOnLeft = subjectCenter < stage.w / 2
  const x = subjectOnLeft ? stage.w - inset - blockW : inset
  const y = stage.h - inset - blockH

  return { frame: { x, y, width: blockW, height: blockH, rotation: 0 }, lines }
}
