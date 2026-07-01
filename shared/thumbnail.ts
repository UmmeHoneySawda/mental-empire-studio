import {
  DEFAULT_GLOW,
  DEFAULT_OUTLINE,
  DEFAULT_SCRIM,
  DEFAULT_SHADOW,
  DEFAULT_TEXT_HIGHLIGHT,
  THUMB_W,
  THUMB_H,
  asGlow,
  asOutline,
  asShadow,
  type BackgroundLayer,
  type FxGlow,
  type FxOutline,
  type FxShadow,
  type LayerFrame,
  type ShapeLayer,
  type SubjectLayer,
  type TextHighlight,
  type TextLayer,
  type ThumbnailLayer
} from './types'

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

function finite(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

function text(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}

function normalizeFrame(v: unknown, fallback: LayerFrame): LayerFrame {
  const r = obj(v)
  return {
    x: finite(r.x, fallback.x),
    y: finite(r.y, fallback.y),
    width: Math.max(1, finite(r.width, fallback.width)),
    height: Math.max(1, finite(r.height, fallback.height)),
    rotation: finite(r.rotation, fallback.rotation)
  }
}

function normalizeShadow(v: unknown, fallbackColor = DEFAULT_SHADOW.color): FxShadow {
  const s = asShadow(v, fallbackColor)
  return {
    enabled: bool(s.enabled, DEFAULT_SHADOW.enabled),
    color: text(s.color, fallbackColor),
    size: clamp(finite(s.size, DEFAULT_SHADOW.size), 0, 200),
    opacity: clamp(finite(s.opacity, DEFAULT_SHADOW.opacity), 0, 1),
    distance: clamp(finite(s.distance, DEFAULT_SHADOW.distance), 0, 400),
    angle: finite(s.angle, DEFAULT_SHADOW.angle)
  }
}

function normalizeGlow(v: unknown, fallbackColor = DEFAULT_GLOW.color): FxGlow {
  const g = asGlow(v, fallbackColor)
  return {
    enabled: bool(g.enabled, DEFAULT_GLOW.enabled),
    color: text(g.color, fallbackColor),
    size: clamp(finite(g.size, DEFAULT_GLOW.size), 0, 200),
    opacity: clamp(finite(g.opacity, DEFAULT_GLOW.opacity), 0, 1)
  }
}

function normalizeOutline(v: unknown, fallbackColor = DEFAULT_OUTLINE.color, fallbackSize = DEFAULT_OUTLINE.size): FxOutline {
  const o = asOutline(v, fallbackColor, fallbackSize)
  return {
    enabled: bool(o.enabled, DEFAULT_OUTLINE.enabled),
    color: text(o.color, fallbackColor),
    size: clamp(finite(o.size, fallbackSize), 0, 120),
    opacity: clamp(finite(o.opacity, DEFAULT_OUTLINE.opacity), 0, 1)
  }
}

function normalizeTextLines(raw: Record<string, unknown>, fallbackText: string): Array<{ text: string; size: number }> {
  const fromLines = Array.isArray(raw.lines)
    ? raw.lines.map((line) => {
        if (typeof line === 'string') return { text: line, size: 72 }
        const row = obj(line)
        return { text: text(row.text, ''), size: clamp(finite(row.size, 72), 8, 260) }
      })
    : []
  const clean = fromLines.filter((line) => line.text !== '' || fromLines.length === 1)
  if (clean.length) return clean
  const rawText = text(raw.text, fallbackText)
  const rows = rawText.split(/\r?\n/).filter((row) => row.trim() !== '')
  return (rows.length ? rows : [rawText || fallbackText]).map((line) => ({ text: line, size: 72 }))
}

function normalizeHighlightWords(raw: Record<string, unknown>): string[] {
  const words = Array.isArray(raw.highlightWords) ? raw.highlightWords : []
  const clean = words.map((w) => text(w, '').trim()).filter(Boolean)
  const legacy = text(raw.highlightWord, '').trim()
  if (legacy && !clean.some((w) => w.toLowerCase() === legacy.toLowerCase())) clean.push(legacy)
  return clean
}

function normalizeTextHighlight(raw: unknown, legacyEnabled: boolean, legacyColor: string): TextHighlight {
  const fallback: TextHighlight = {
    ...DEFAULT_TEXT_HIGHLIGHT,
    enabled: legacyEnabled,
    boxColor: legacyColor
  }
  const h = obj(raw)
  return {
    enabled: bool(h.enabled, fallback.enabled),
    boxColor: text(h.boxColor, fallback.boxColor),
    textColor: text(h.textColor, fallback.textColor),
    radius: clamp(finite(h.radius, fallback.radius), 0, 80),
    padding: clamp(finite(h.padding, fallback.padding), 0, 80),
    opacity: clamp(finite(h.opacity, fallback.opacity), 0, 1)
  }
}

function layerKind(raw: Record<string, unknown>): ThumbnailLayer['kind'] | null {
  if (raw.kind === 'text' || raw.kind === 'subject' || raw.kind === 'shape' || raw.kind === 'background') return raw.kind
  if ('lines' in raw || 'text' in raw || 'effects' in raw) return 'text'
  if ('fill' in raw || 'mode' in raw || 'scrim' in raw) return 'background'
  if ('src' in raw || 'outline' in raw || 'glow' in raw) return 'subject'
  if ('shape' in raw || 'color' in raw) return 'shape'
  return null
}

const DEFAULT_TEXT_FRAME: LayerFrame = { x: 80, y: 426, width: 780, height: 250, rotation: 0 }
const DEFAULT_SUBJECT_FRAME: LayerFrame = { x: 96, y: 80, width: 470, height: 640, rotation: 0 }
const DEFAULT_SHAPE_FRAME: LayerFrame = { x: 520, y: 280, width: 180, height: 180, rotation: 0 }
const FULL_FRAME: LayerFrame = { x: 0, y: 0, width: THUMB_W, height: THUMB_H, rotation: 0 }

export function normalizeThumbnailLayer(layer: unknown, index = 0): ThumbnailLayer | null {
  const raw = obj(layer)
  const kind = layerKind(raw)
  if (!kind) return null
  const id = text(raw.id, `${kind}-${index}`)
  const base = {
    id,
    kind,
    name: text(raw.name, kind === 'text' ? 'Headline' : kind === 'background' ? 'Background' : kind === 'subject' ? 'Subject' : 'Shape'),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, kind === 'background')
  }

  if (kind === 'text') {
    const lines = normalizeTextLines(raw, 'NEW TEXT')
    const joined = lines.map((line) => line.text).join(' ').trim()
    const highlightWords = normalizeHighlightWords(raw)
    const effects = obj(raw.effects)
    const legacyHighlightColor = text(raw.highlightColor, '#ffffff')
    const legacyHighlightSquare = bool(raw.highlightSquare, false)
    const highlight = normalizeTextHighlight(raw.highlight, legacyHighlightSquare, legacyHighlightColor)
    return {
      ...base,
      kind,
      frame: normalizeFrame(raw.frame, DEFAULT_TEXT_FRAME),
      text: text(raw.text, joined || 'NEW TEXT'),
      lines,
      highlightWord: highlightWords[0] ?? text(raw.highlightWord, ''),
      highlightWords,
      highlight,
      highlightColor: legacyHighlightColor,
      highlightSquare: legacyHighlightSquare,
      color: text(raw.color, '#ffffff'),
      fontFamily: text(raw.fontFamily, 'Anton'),
      align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
      lineGap: raw.lineGap === undefined ? undefined : clamp(finite(raw.lineGap, 0), 0, 200),
      lineHeight: raw.lineHeight === undefined ? undefined : clamp(finite(raw.lineHeight, 0), 0, 4),
      effects: {
        shadow: normalizeShadow(effects.shadow, '#000000'),
        stroke: normalizeOutline(effects.stroke, '#000000', 6),
        glow: normalizeGlow(effects.glow, text(raw.highlightColor, '#ffffff')),
        caps: bool(effects.caps, true)
      }
    }
  }

  if (kind === 'subject') {
    return {
      ...base,
      kind,
      frame: normalizeFrame(raw.frame, DEFAULT_SUBJECT_FRAME),
      src: text(raw.src, ''),
      outline: normalizeOutline(raw.outline, '#ffffff', 6),
      shadow: normalizeShadow(raw.shadow, '#000000'),
      glow: normalizeGlow(raw.glow, '#19c3d6')
    }
  }

  if (kind === 'shape') {
    const shape = raw.shape === 'circle' || raw.shape === 'arrow' ? raw.shape : 'rect'
    return {
      ...base,
      kind,
      frame: normalizeFrame(raw.frame, DEFAULT_SHAPE_FRAME),
      shape,
      color: text(raw.color, '#e8403a')
    }
  }

  const mode = raw.mode === 'image' || raw.mode === 'solid' || raw.mode === 'gradient'
    ? raw.mode
    : text(raw.fill, '').startsWith('linear-gradient') ? 'gradient' : 'solid'
  const scrim = obj(raw.scrim)
  const direction = scrim.direction === 'top' || scrim.direction === 'left' || scrim.direction === 'right' ? scrim.direction : 'bottom'
  return {
    ...base,
    kind,
    frame: normalizeFrame(raw.frame, FULL_FRAME),
    fill: text(raw.fill, 'linear-gradient(135deg,#2a2540,#46243a)'),
    mode,
    src: raw.src === undefined ? undefined : text(raw.src, ''),
    scrim: {
      enabled: bool(scrim.enabled, DEFAULT_SCRIM.enabled),
      direction,
      size: clamp(finite(scrim.size, DEFAULT_SCRIM.size), 0, 1),
      opacity: clamp(finite(scrim.opacity, DEFAULT_SCRIM.opacity), 0, 1)
    }
  }
}

function fallbackLayers(): ThumbnailLayer[] {
  return [
    normalizeThumbnailLayer({
      id: 'headline',
      kind: 'text',
      name: 'Headline',
      frame: DEFAULT_TEXT_FRAME,
      text: 'NEW TEXT',
      lines: [{ text: 'NEW TEXT', size: 92 }],
      highlightColor: '#ffffff',
      highlightSquare: false,
      color: '#ffffff',
      fontFamily: 'Anton',
      align: 'left',
      effects: { shadow: { enabled: true, color: '#000000', size: 0, opacity: 0.55, distance: 5, angle: 45 }, stroke: false, glow: false, caps: true }
    }, 0),
    normalizeThumbnailLayer({
      id: 'bg',
      kind: 'background',
      name: 'Background',
      locked: true,
      frame: FULL_FRAME,
      fill: 'linear-gradient(135deg,#2a2540,#46243a)',
      mode: 'gradient'
    }, 1)
  ].filter((l): l is ThumbnailLayer => !!l)
}

export function normalizeThumbnailLayers(layers: unknown): ThumbnailLayer[] {
  const normalized = Array.isArray(layers)
    ? layers.map((layer, index) => normalizeThumbnailLayer(layer, index)).filter((layer): layer is ThumbnailLayer => !!layer)
    : []
  if (!normalized.length) return fallbackLayers()
  if (!normalized.some((layer) => layer.kind === 'background')) {
    const bg = normalizeThumbnailLayer({ id: 'bg', kind: 'background', locked: true, frame: FULL_FRAME, fill: 'linear-gradient(135deg,#2a2540,#46243a)', mode: 'gradient' }, normalized.length)
    if (bg) normalized.push(bg)
  }
  if (!normalized.some((layer) => layer.kind === 'text')) {
    const textLayer = normalizeThumbnailLayer({ id: 'headline', kind: 'text', frame: DEFAULT_TEXT_FRAME, text: 'NEW TEXT', lines: [{ text: 'NEW TEXT', size: 92 }] }, normalized.length)
    if (textLayer) normalized.unshift(textLayer)
  }
  return normalized
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

export function scaleTextLayerBy(layer: TextLayer, scale: number, framePatch: Partial<LayerFrame> = {}): Pick<TextLayer, 'frame' | 'lines'> {
  const factor = clamp(finite(scale, 1), 0.1, 5)
  const lines = layer.lines.map((line) => ({
    ...line,
    size: clamp(Math.round(line.size * factor), 8, 260)
  }))
  return {
    frame: normalizeFrame({ ...layer.frame, ...framePatch }, layer.frame),
    lines
  }
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
