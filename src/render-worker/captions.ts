import type { CaptionFrameModel, CaptionGroupModel } from '@shared/renderSpec'
import { activeCaptionGroup, activeWordInGroup } from '@shared/renderSpec'

// GPU caption layer — replaces libass. Draws the active caption group onto a 2D canvas
// (word-by-word highlight + simple pop animation) which is then uploaded as a texture and
// composited in the WebGL pass. Everything is driven by frame-time (seconds), never
// wall-clock, so output is deterministic and reproducible.

const FONT_FALLBACK = 'Anton, Impact, sans-serif'

function withFont(family: string): string {
  // Caption fonts are bundled via @fontsource and registered on the worker document.
  return `${family}, ${FONT_FALLBACK}`
}

/** Font size in px derived from height + preset (mirrors the ffmpeg/ASS sizing). Pure so
 *  preview (smaller canvas) and final (larger canvas) provably share one sizing formula —
 *  the only difference between them is the height it's evaluated at. */
export function captionFontSizePx(width: number, height: number, preset: CaptionFrameModel['preset']): number {
  const aspectTall = height > width
  const base = aspectTall ? height * 0.11 : height * 0.085
  const px = Math.round(Math.max(64, Math.min(aspectTall ? 150 : 108, base)))
  if (preset === 'Submagic') return Math.round(px * 1.04)
  return preset === 'Word' ? Math.round(px * 1.12) : px
}

export class CaptionLayer {
  readonly canvas: OffscreenCanvas
  private ctx: OffscreenCanvasRenderingContext2D
  private lastKey = ''

  constructor(private model: CaptionFrameModel, private width: number, private height: number) {
    this.canvas = new OffscreenCanvas(width, height)
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable for caption layer')
    this.ctx = ctx
  }

  /** Swap in a new caption model without reallocating the canvas — used when only
   *  captions/text-effects change so the compositor doesn't need a full rebuild. */
  setModel(model: CaptionFrameModel): void {
    this.model = model
    this.lastKey = ' ' // force the next draw() to repaint even if timeSec is unchanged
  }

  private fontSizePx(): number {
    return captionFontSizePx(this.width, this.height, this.model.preset)
  }

  /** Vertical baseline anchor for the caption block, by position. */
  private anchorY(): number {
    switch (this.model.position) {
      case 'top': return Math.round(this.height * (this.height > this.width ? 0.16 : 0.13))
      case 'middle': return Math.round(this.height / 2)
      default: return this.height - Math.round(this.height * (this.height > this.width ? 0.28 : 0.26))
    }
  }

  /** Greedily wrap words into lines so no line exceeds maxWidth — keeps captions inside the
   *  frame regardless of phrase length (the old count-based split could overflow horizontally
   *  and push text off-screen). Word order is preserved so the flat active-word index still
   *  maps to group.words. `ctx.font` must already be set. */
  private wrapByWidth(words: string[], maxWidth: number, spaceW: number): string[][] {
    const lines: string[][] = []
    let cur: string[] = []
    let curW = 0
    for (const word of words) {
      const w = this.ctx.measureText(word).width
      const add = cur.length ? spaceW + w : w
      if (cur.length && curW + add > maxWidth) {
        lines.push(cur)
        cur = [word]
        curW = w
      } else {
        cur.push(word)
        curW += add
      }
    }
    if (cur.length) lines.push(cur)
    return lines.length ? lines : [words]
  }

  /**
   * Draw the caption state for time `t`. Returns true if the canvas changed (so the
   * compositor can skip re-uploading the texture when nothing moved).
   */
  draw(timeSec: number): boolean {
    const hook = this.model.hook
    // Hook card takes precedence during its window.
    if (hook && timeSec < hook.untilSec) {
      const key = `hook:${hook.text}`
      if (key === this.lastKey) return false
      this.lastKey = key
      this.clear()
      this.drawHook(hook.text.toUpperCase())
      return true
    }

    const gi = activeCaptionGroup(this.model, timeSec)
    if (gi < 0) {
      if (this.lastKey === '') return false
      this.lastKey = ''
      this.clear()
      return true
    }
    const group = this.model.groups[gi]
    const wi = this.model.mode === 'word' || this.model.highlightBox?.enabled ? activeWordInGroup(group, timeSec) : -1
    const key = `${gi}:${wi}`
    if (key === this.lastKey) return false
    this.lastKey = key

    this.clear()
    this.drawGroup(group, wi)
    return true
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  private drawHook(text: string): void {
    const ctx = this.ctx
    const size = Math.round(this.height * 0.12)
    ctx.save()
    ctx.font = `700 ${size}px ${withFont('Anton')}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size * 0.14
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.fillStyle = '#ffffff'
    const cx = this.width / 2
    const cy = this.height / 2
    ctx.strokeText(text, cx, cy)
    ctx.fillText(text, cx, cy)
    ctx.restore()
  }

  private roundedRect(x: number, y: number, w: number, h: number, radius: number): void {
    const ctx = this.ctx
    const r = Math.max(0, Math.min(radius, w / 2, h / 2))
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  private drawGroup(group: CaptionGroupModel, activeWordIdx: number): void {
    const ctx = this.ctx
    // Emphasis "pop": the active word is drawn slightly larger. Layout reserves this scaled
    // width so the enlarged (yellow) word never overlaps its neighbours — the old code only
    // reserved the unscaled width, which is why highlighted words collided.
    const ACTIVE_SCALE = 1.1
    let size = this.fontSizePx()
    ctx.save()
    ctx.font = `700 ${size}px ${withFont(this.model.font)}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2

    const words = group.words.map((w) => w.text.toUpperCase())
    // Keep captions inside a title-safe width. If a single word is still too wide (long
    // compound word on a narrow 9:16 frame), shrink the font so it fits rather than clip.
    const safeMaxW = this.width * 0.9
    const widestWord = words.reduce((m, w) => Math.max(m, ctx.measureText(w).width), 0)
    if (widestWord > safeMaxW && widestWord > 0) {
      size = Math.max(28, Math.floor((size * safeMaxW) / (widestWord * ACTIVE_SCALE)))
      ctx.font = `700 ${size}px ${withFont(this.model.font)}`
    }
    const lineH = size * 1.16
    const spaceW = ctx.measureText(' ').width
    const lines = this.wrapByWidth(words, safeMaxW, spaceW)
    const totalH = lines.length * lineH
    const startY = this.anchorY() - totalH / 2 + lineH / 2
    const cx = this.width / 2

    // Flatten word index across lines so the active-word highlight maps correctly.
    let flat = 0
    lines.forEach((line, li) => {
      const y = startY + li * lineH
      const widths = line.map((w) => ctx.measureText(w).width)
      // Reserve the *scaled* width for the active word so nothing overlaps it.
      const effWidths = line.map((w, wi) => widths[wi] * (flat + wi === activeWordIdx ? ACTIVE_SCALE : 1))
      const lineW = effWidths.reduce((a, b) => a + b, 0) + spaceW * (line.length - 1)
      let x = cx - lineW / 2
      line.forEach((word, wi) => {
        const globalIdx = flat + wi
        const isActive = globalIdx === activeWordIdx
        const wordModel = group.words[globalIdx]
        const emphasized = !!wordModel?.emphasis
        const wx = x + effWidths[wi] / 2
        const scale = isActive ? ACTIVE_SCALE : 1
        const box = this.model.highlightBox
        const boxed = isActive && !!box?.enabled
        ctx.save()
        ctx.translate(wx, y)
        ctx.scale(scale, scale)
        if (boxed) {
          const pad = Math.max(0, box?.padding ?? 0)
          const boxW = widths[wi] + pad * 2
          const boxH = size * 1.04 + pad * 1.25
          this.roundedRect(-boxW / 2, -boxH / 2, boxW, boxH, box?.radius ?? 0)
          ctx.fillStyle = box?.boxColor ?? this.model.highlightColor
          ctx.fill()
        }
        // Cleaner, more professional finish: a crisp outline plus a soft drop shadow for
        // separation from the footage (instead of a single flat heavy stroke).
        if (!boxed) {
          ctx.shadowColor = 'rgba(0,0,0,0.55)'
          ctx.shadowBlur = size * 0.10
          ctx.shadowOffsetX = 0
          ctx.shadowOffsetY = Math.round(size * 0.04)
        }
        ctx.lineWidth = boxed ? Math.max(1.5, size * 0.03) : size * 0.11
        ctx.strokeStyle = boxed ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.92)'
        ctx.strokeText(word, 0, 0)
        // Turn the shadow off for the fill so glyph interiors stay crisp.
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetY = 0
        ctx.fillStyle = boxed ? (box?.textColor ?? '#111111') : isActive || emphasized ? this.model.highlightColor : '#ffffff'
        ctx.fillText(word, 0, 0)
        ctx.restore()
        x += effWidths[wi] + spaceW
      })
      flat += line.length
    })
    ctx.restore()
  }
}
