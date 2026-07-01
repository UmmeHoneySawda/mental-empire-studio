import { describe, expect, it } from 'vitest'
import { normalizeThumbnailLayer, normalizeThumbnailLayers, autoArrangeText, scaleTextLayerBy } from '../../shared/thumbnail'
import { asBetaOpts } from '../../shared/types'

describe('normalizeThumbnailLayer', () => {
  it('fills legacy text layers so editor controls and render helpers can read them', () => {
    const layer = normalizeThumbnailLayer({
      id: 'legacy-title',
      kind: 'text',
      text: 'Never explain yourself',
      highlightWord: 'Never',
      effects: { shadow: true }
    })

    expect(layer?.kind).toBe('text')
    if (layer?.kind !== 'text') throw new Error('expected text layer')
    expect(layer.lines).toEqual([{ text: 'Never explain yourself', size: 72 }])
    expect(layer.highlightWords).toEqual(['Never'])
    expect(layer.highlight).toEqual({
      enabled: false,
      boxColor: '#ffffff',
      textColor: '#111111',
      radius: 0,
      padding: 6,
      opacity: 1
    })
    expect(layer.effects.caps).toBe(true)
    expect(layer.effects.shadow.enabled).toBe(true)
    expect(layer.frame.width).toBeGreaterThan(0)

    const arranged = autoArrangeText(layer)
    expect(arranged.lines.length).toBeGreaterThan(0)
    expect(arranged.frame.height).toBeGreaterThan(0)
  })

  it('adds a background and text fallback when saved layers are incomplete', () => {
    const layers = normalizeThumbnailLayers([
      { id: 'badge', kind: 'shape', frame: { x: 1, y: 2, width: 80, height: 80, rotation: 0 }, shape: 'circle' }
    ])

    expect(layers.some((l) => l.kind === 'shape')).toBe(true)
    expect(layers.some((l) => l.kind === 'text')).toBe(true)
    expect(layers.some((l) => l.kind === 'background')).toBe(true)
  })

  it('migrates legacy highlight boxes into independent V2 box controls', () => {
    const layer = normalizeThumbnailLayer({
      id: 'legacy-highlight-box',
      kind: 'text',
      text: 'Stop explaining',
      highlightWord: 'Stop',
      highlightColor: '#f2c200',
      highlightSquare: true
    })

    expect(layer?.kind).toBe('text')
    if (layer?.kind !== 'text') throw new Error('expected text layer')
    expect(layer.highlight).toEqual({
      enabled: true,
      boxColor: '#f2c200',
      textColor: '#111111',
      radius: 0,
      padding: 6,
      opacity: 1
    })
    expect(layer.highlightSquare).toBe(true)
    expect(layer.highlightColor).toBe('#f2c200')
  })

  it('normalizes explicit V2 highlight controls without collapsing legacy fields', () => {
    const layer = normalizeThumbnailLayer({
      id: 'v2-highlight-box',
      kind: 'text',
      text: 'Stop explaining',
      highlightWords: ['Stop'],
      highlightColor: '#ffffff',
      highlightSquare: false,
      highlight: {
        enabled: true,
        boxColor: '#19c3d6',
        textColor: '#000000',
        radius: 999,
        padding: 999,
        opacity: 2
      }
    })

    expect(layer?.kind).toBe('text')
    if (layer?.kind !== 'text') throw new Error('expected text layer')
    expect(layer.highlight?.enabled).toBe(true)
    expect(layer.highlight?.boxColor).toBe('#19c3d6')
    expect(layer.highlight?.textColor).toBe('#000000')
    expect(layer.highlight?.radius).toBe(80)
    expect(layer.highlight?.padding).toBe(80)
    expect(layer.highlight?.opacity).toBe(1)
    expect(layer.highlightSquare).toBe(false)
    expect(layer.highlightColor).toBe('#ffffff')
  })

  it('round-trips inline multiline text into separate normalized rows', () => {
    const layer = normalizeThumbnailLayer({
      id: 'multiline',
      kind: 'text',
      text: 'Line one\nLine two'
    })

    expect(layer?.kind).toBe('text')
    if (layer?.kind !== 'text') throw new Error('expected text layer')
    expect(layer.lines.map((l) => l.text)).toEqual(['Line one', 'Line two'])
  })

  it('commits text transformer scale into real line font sizes', () => {
    const layer = normalizeThumbnailLayer({
      id: 'resize-text',
      kind: 'text',
      text: 'Big\nSmall',
      lines: [{ text: 'Big', size: 80 }, { text: 'Small', size: 48 }],
      frame: { x: 10, y: 20, width: 300, height: 120, rotation: 0 }
    })

    expect(layer?.kind).toBe('text')
    if (layer?.kind !== 'text') throw new Error('expected text layer')
    const scaled = scaleTextLayerBy(layer, 1.5, { width: 450, height: 180 })
    expect(scaled.lines.map((l) => l.size)).toEqual([120, 72])
    expect(scaled.frame.width).toBe(450)
    expect(scaled.frame.height).toBe(180)
  })
})

describe('asBetaOpts', () => {
  it('clamps malformed persisted beta options to supported values', () => {
    const opts = asBetaOpts({
      hook: { enabled: 'yes', text: 42 },
      overlay: { bottom: true, intensity: 999 },
      autoZoom: { atStart: true, atKeyPhrases: 'no' },
      broll: { enabled: true, density: 'wild', poolSize: -5, mode: 'sideways' },
      style: 'Explosive',
      effectPlanJson: 123
    })

    expect(opts.hook.enabled).toBe(false)
    expect(opts.overlay.bottom).toBe(true)
    expect(opts.overlay.intensity).toBe(100)
    expect(opts.autoZoom.atKeyPhrases).toBe(false)
    expect(opts.broll.density).toBe('sparse')
    expect(opts.broll.poolSize).toBe(1)
    expect(opts.broll.mode).toBe('full')
    expect(opts.style).toBe('None')
    expect(opts.effectPlanJson).toBe('')
  })
})
