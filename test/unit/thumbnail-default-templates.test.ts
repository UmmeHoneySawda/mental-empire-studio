import { describe, expect, it } from 'vitest'
import { DEFAULT_THUMBNAIL_TEMPLATES } from '../../electron/db/seed'
import { normalizeThumbnailLayers } from '../../shared/thumbnail'

describe('default thumbnail templates', () => {
  it('ships a multi-template starter pack with stable ids', () => {
    expect(DEFAULT_THUMBNAIL_TEMPLATES.map((t) => t.id)).toEqual([
      'tpl-full-bleed',
      'tpl-subject-left',
      'tpl-subject-right',
      'tpl-centered-punch'
    ])
    expect(new Set(DEFAULT_THUMBNAIL_TEMPLATES.map((t) => t.id)).size).toBe(DEFAULT_THUMBNAIL_TEMPLATES.length)
  })

  it('normalizes every default template into editable text and background layers', () => {
    for (const template of DEFAULT_THUMBNAIL_TEMPLATES) {
      const layers = normalizeThumbnailLayers(template.layers)
      expect(layers.some((l) => l.kind === 'text')).toBe(true)
      expect(layers.some((l) => l.kind === 'background')).toBe(true)
      for (const layer of layers) {
        if (layer.kind === 'subject') expect(layer.locked).toBe(false)
        if (layer.kind === 'text') {
          expect(layer.lines.length).toBeGreaterThan(0)
          expect(layer.highlight?.boxColor).toMatch(/^#[0-9a-f]{6}$/i)
        }
      }
    }
  })
})
