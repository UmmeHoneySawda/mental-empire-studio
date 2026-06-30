import { describe, expect, it } from 'vitest'
import { normalizeThumbnailLayer, normalizeThumbnailLayers, autoArrangeText } from '../../shared/thumbnail'
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
