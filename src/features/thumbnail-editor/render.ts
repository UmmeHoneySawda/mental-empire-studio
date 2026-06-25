import Konva from 'konva'
import {
  THUMB_W,
  THUMB_H,
  type BackgroundLayer,
  type ShapeLayer,
  type SubjectLayer,
  type TextLayer,
  type ThumbnailLayer
} from '@shared/types'

// Shared Konva drawing used by both the on-screen editor and offscreen batch
// rasterization. Each layer kind maps to Konva nodes appended to a group; the
// editor adds interactivity on top, the rasterizer just exports the group to PNG.

const POSTER_FONT = 'Anton, Hanken Grotesk, sans-serif'

/** Parse a CSS linear-gradient(...) into Konva gradient stops, else treat as solid. */
function applyFill(rect: Konva.Rect, fill: string): void {
  const m = fill.match(/linear-gradient\([^,]+,(.+)\)/)
  if (m) {
    const stops = m[1].split(',').map((s) => s.trim().split(/\s+/)[0])
    rect.fillLinearGradientStartPoint({ x: 0, y: 0 })
    rect.fillLinearGradientEndPoint({ x: rect.width(), y: rect.height() })
    rect.fillLinearGradientColorStops(
      stops.flatMap((c, i) => [stops.length === 1 ? 0 : i / (stops.length - 1), c])
    )
  } else {
    rect.fill(fill)
  }
}

function drawBackground(l: BackgroundLayer, imageEl?: HTMLImageElement): Konva.Shape {
  if (l.mode === 'image' && imageEl) {
    return new Konva.Image({ image: imageEl, x: 0, y: 0, width: THUMB_W, height: THUMB_H })
  }
  const rect = new Konva.Rect({ x: 0, y: 0, width: THUMB_W, height: THUMB_H })
  applyFill(rect, l.fill)
  return rect
}

function drawSubject(l: SubjectLayer, imageEl?: HTMLImageElement): Konva.Shape | null {
  if (!imageEl) return null
  const img = new Konva.Image({
    image: imageEl,
    x: l.frame.x,
    y: l.frame.y,
    width: l.frame.width,
    height: l.frame.height,
    rotation: l.frame.rotation
  })
  if (l.shadow) {
    img.shadowColor('black')
    img.shadowBlur(24)
    img.shadowOpacity(0.6)
    img.shadowOffset({ x: 0, y: 8 })
  }
  if (l.glow) {
    img.shadowColor(l.outlineColor)
    img.shadowBlur(40)
    img.shadowOpacity(0.9)
  }
  if (l.outline) img.stroke(l.outlineColor), img.strokeWidth(l.outlineWidth)
  return img
}

function drawShape(l: ShapeLayer): Konva.Group {
  const { x, y, width, height, rotation } = l.frame
  // Wrap every shape in a top-left group so node.x()/y() means the same thing for
  // all shapes (clean drag/transform → frame.x/y mapping).
  const group = new Konva.Group({ x, y, width, height, rotation })
  if (l.shape === 'circle') {
    group.add(
      new Konva.Ring({
        x: width / 2,
        y: height / 2,
        innerRadius: Math.max(2, width / 2 - 10),
        outerRadius: width / 2,
        fill: l.color
      })
    )
  } else if (l.shape === 'arrow') {
    group.add(
      new Konva.Arrow({
        points: [0, height / 2, width, height / 2],
        pointerLength: 22,
        pointerWidth: 22,
        fill: l.color,
        stroke: l.color,
        strokeWidth: 14
      })
    )
  } else {
    group.add(new Konva.Rect({ x: 0, y: 0, width, height, fill: l.color }))
  }
  return group
}

/** A headline text layer: each line stacked, with an optional highlighted word box. */
function drawText(l: TextLayer): Konva.Group {
  const group = new Konva.Group({ x: l.frame.x, y: l.frame.y, rotation: l.frame.rotation })
  const caps = l.effects.caps
  const hw = (l.highlightWord ?? '').toLowerCase()
  let cy = 0
  for (const line of l.lines) {
    const text = caps ? line.text.toUpperCase() : line.text
    const fontSize = line.size
    let cx = 0
    // split into words so the highlighted word can get a box behind it
    const words = text.split(' ')
    for (let i = 0; i < words.length; i++) {
      const w = words[i]
      const isHi = hw.length > 0 && w.toLowerCase().replace(/[^a-z0-9]/g, '') === hw.replace(/[^a-z0-9]/g, '')
      const node = new Konva.Text({
        x: cx,
        y: cy,
        text: w,
        fontFamily: POSTER_FONT,
        fontSize,
        fill: isHi && l.highlightSquare ? '#111111' : isHi ? l.highlightColor : l.color
      })
      const wWidth = node.width()
      if (isHi && l.highlightSquare) {
        group.add(
          new Konva.Rect({ x: cx - 6, y: cy - 2, width: wWidth + 12, height: fontSize * 1.02, fill: l.highlightColor })
        )
      }
      if (l.effects.shadow) {
        node.shadowColor('black')
        node.shadowBlur(0)
        node.shadowOffset({ x: 3, y: 3 })
        node.shadowOpacity(0.55)
      }
      if (l.effects.stroke) {
        node.stroke('#000000')
        node.strokeWidth(Math.max(2, fontSize * 0.04))
      }
      if (l.effects.glow) {
        node.shadowColor(l.highlightColor)
        node.shadowBlur(18)
        node.shadowOpacity(0.9)
      }
      group.add(node)
      cx += wWidth + fontSize * 0.28
    }
    cy += fontSize * 1.02
  }
  return group
}

export interface LayerImages {
  [layerId: string]: HTMLImageElement
}

/** Build a Konva.Group containing every visible layer, drawn in order. */
export function buildLayerGroup(layers: ThumbnailLayer[], images: LayerImages = {}): Konva.Group {
  const group = new Konva.Group()
  // The layers array is front-to-back (index 0 = top of the panel = front-most), so
  // paint in reverse: background first (bottom), headline last (on top).
  for (const l of [...layers].reverse()) {
    if (!l.visible) continue
    let node: Konva.Shape | Konva.Group | null = null
    if (l.kind === 'background') node = drawBackground(l, images[l.id])
    else if (l.kind === 'subject') node = drawSubject(l, images[l.id])
    else if (l.kind === 'shape') node = drawShape(l)
    else if (l.kind === 'text') node = drawText(l)
    if (node) {
      node.setAttr('layerId', l.id)
      group.add(node)
    }
  }
  return group
}

/** Load an image src (path or data URL) into an HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src.startsWith('data:') || src.startsWith('http') || src.startsWith('file:') ? src : `file://${src}`
  })
}

/**
 * Offscreen-rasterize a set of layers to a PNG data URL at full 1280×720. Used by
 * batch generate — the headline text is swapped per title, the rest stays locked.
 */
export async function rasterizeLayers(layers: ThumbnailLayer[]): Promise<string> {
  if (document.fonts && 'ready' in document.fonts) await document.fonts.ready
  const images: LayerImages = {}
  for (const l of layers) {
    const src = l.kind === 'subject' ? l.src : l.kind === 'background' && l.mode === 'image' ? l.src : undefined
    if (src) {
      try {
        images[l.id] = await loadImage(src)
      } catch {
        /* missing image — skip, render without it */
      }
    }
  }
  const container = document.createElement('div')
  const stage = new Konva.Stage({ container, width: THUMB_W, height: THUMB_H })
  const klayer = new Konva.Layer()
  klayer.add(buildLayerGroup(layers, images))
  stage.add(klayer)
  klayer.draw()
  const url = stage.toDataURL({ pixelRatio: 1, mimeType: 'image/png' })
  stage.destroy()
  return url
}

/** Replace the headline text layer's content with a new title (for batch generate). */
export function withHeadline(layers: ThumbnailLayer[], title: string): ThumbnailLayer[] {
  let replaced = false
  return layers.map((l) => {
    if (!replaced && l.kind === 'text') {
      replaced = true
      const words = title.toUpperCase().split(/\s+/)
      const mid = Math.ceil(words.length / 2)
      const lines =
        words.length > 3
          ? [
              { text: words.slice(0, mid).join(' '), size: l.lines[0]?.size ?? 92 },
              { text: words.slice(mid).join(' '), size: l.lines[1]?.size ?? l.lines[0]?.size ?? 110 }
            ]
          : [{ text: title.toUpperCase(), size: l.lines[0]?.size ?? 110 }]
      return { ...l, text: title, lines }
    }
    return l
  })
}
