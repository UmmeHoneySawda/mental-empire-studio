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

  /** Font size in px derived from height + preset (mirrors the ffmpeg/ASS sizing). */
  private fontSizePx(): number {
    const aspectTall = this.height > this.width
    const base = aspectTall ? this.height * 0.11 : this.height * 0.085
    const px = Math.round(Math.max(64, Math.min(aspectTall ? 150 : 108, base)))
    if (this.model.preset === 'Submagic') return Math.round(px * 1.04)
    return this.model.preset === 'Word' ? Math.round(px * 1.12) : px
  }

  /** Vertical baseline anchor for the caption block, by position. */
  private anchorY(): number {
    switch (this.model.position) {
      case 'top': return Math.round(this.height * (this.height > this.width ? 0.16 : 0.13))
      case 'middle': return Math.round(this.height / 2)
      default: return this.height - Math.round(this.height * (this.height > this.width ? 0.28 : 0.26))
    }
  }

  /** Split a group's words into the requested number of lines. */
  private toLines(group: CaptionGroupModel): string[][] {
    const words = group.words.map((w) => w.text.toUpperCase())
    if (this.model.wordsPerPage && words.length <= this.model.wordsPerPage) return [words]
    const lines = this.model.lines
    if (lines <= 1 || words.length <= 2) return [words]
    const perLine = Math.ceil(words.length / lines)
    const out: string[][] = []
    for (let i = 0; i < words.length; i += perLine) out.push(words.slice(i, i + perLine))
    return out
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
    const size = this.fontSizePx()
    const lineH = size * 1.12
    ctx.save()
    ctx.font = `700 ${size}px ${withFont(this.model.font)}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size * 0.12

    const lines = this.toLines(group)
    const totalH = lines.length * lineH
    const startY = this.anchorY() - totalH / 2 + lineH / 2
    const cx = this.width / 2

    // Flatten word index across lines so the active-word highlight maps correctly.
    let flat = 0
    lines.forEach((line, li) => {
      const y = startY + li * lineH
      // measure full line width to position words left-to-right around centre
      const spaceW = ctx.measureText(' ').width
      const widths = line.map((w) => ctx.measureText(w).width)
      const lineW = widths.reduce((a, b) => a + b, 0) + spaceW * (line.length - 1)
      let x = cx - lineW / 2
      line.forEach((word, wi) => {
        const isActive = flat === activeWordIdx
        const wordModel = group.words[flat]
        const emphasized = !!wordModel?.emphasis
        const wx = x + widths[wi] / 2
        const scale = isActive ? 1.12 : 1
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
        ctx.lineWidth = boxed ? Math.max(1.5, size * 0.035) : size * 0.12
        ctx.strokeStyle = boxed ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.9)'
        ctx.fillStyle = boxed ? (box?.textColor ?? '#111111') : isActive || emphasized ? this.model.highlightColor : '#ffffff'
        ctx.strokeText(word, 0, 0)
        ctx.fillText(word, 0, 0)
        ctx.restore()
        x += widths[wi] + spaceW
        flat++
      })
    })
    ctx.restore()
  }
}
