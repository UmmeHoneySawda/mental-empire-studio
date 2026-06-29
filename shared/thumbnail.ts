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

  const inset = Math.round(stage.w * SAFE_INSET)
  const availW = stage.w - inset * 2
  const maxLen = Math.max(1, ...grouped.map((g) => g.join(' ').length))
  // Uniform size for every line so stacked lines space evenly. The highlighted word is
  // emphasized by colour/box at render time, not by enlarging its whole line (which made
  // multi-line headlines look lopsided with big/small gaps).
  const base = clamp(Math.floor(availW / (maxLen * CHAR_W)), MIN_SIZE, MAX_SIZE)

  const lines = grouped.map((g) => ({ text: g.join(' '), size: base }))

  const blockW = Math.max(...lines.map((l) => Math.round(l.text.length * CHAR_W * l.size)))
  // Match render.ts: a uniform line box = base × factor (lineHeight, else legacy lineGap).
  const factor = layer.lineHeight && layer.lineHeight > 0
    ? layer.lineHeight
    : (layer.lineGap && layer.lineGap > 0 ? 1 + layer.lineGap / base : 1.12)
  const blockH = Math.round(lines.length * base * factor)

  // Place the block opposite the subject (largest empty region), bottom-aligned.
  const subjectCenter = subjectBounds ? subjectBounds.x + subjectBounds.width / 2 : stage.w
  const subjectOnLeft = subjectCenter < stage.w / 2
  const x = subjectOnLeft ? stage.w - inset - blockW : inset
  const y = stage.h - inset - blockH

  return { frame: { x, y, width: blockW, height: blockH, rotation: 0 }, lines }
}
