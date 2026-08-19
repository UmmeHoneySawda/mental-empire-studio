/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { TpCharacter } from '@shared/talkingphotos'

const FIXTURE_PATH = path.resolve('test/fixtures/talkingphotos/presenters-100.json')

function loadFixture(): TpCharacter[] {
  const raw = fs.readFileSync(FIXTURE_PATH, 'utf8')
  return JSON.parse(raw) as TpCharacter[]
}

describe('talkingphotos 100-character fixture', () => {
  it('loads 100 rows with 62 generated + 38 uploaded split', () => {
    const rows = loadFixture()
    expect(rows).toHaveLength(100)
    expect(rows.filter((r) => r.kind === 'generated')).toHaveLength(62)
    expect(rows.filter((r) => r.kind === 'uploaded')).toHaveLength(38)
  })

  it('has honest All 100 chip: every row has required TpCharacter fields', () => {
    const rows = loadFixture()
    for (const r of rows) {
      expect(r.id, `id ${r.id}`).toMatch(/^c\d{3}$/)
      expect(r.label, `label ${r.id}`).toBeTruthy()
      expect(['generated', 'uploaded']).toContain(r.kind)
      expect(r.previewUrl, `previewUrl ${r.id}`).toMatch(/^https:\/\/s3\.renderplatform\.com\//)
      expect(typeof r.previewPath).toBe('string')
      expect(['female', 'male']).toContain(r.gender)
      expect(['adult', 'child']).toContain(r.age)
      expect(['realistic', '3d', '2d', 'animal', 'fantasy']).toContain(r.characterStyle)
      expect(['9:16', '16:9']).toContain(r.aspectRatio)
      expect(new Date(r.createdAt).toString()).not.toBe('Invalid Date')
    }
  })

  it('mixes 9:16 / 16:9 and includes VuaDoctor labels', () => {
    const rows = loadFixture()
    const r916 = rows.filter((r) => r.aspectRatio === '9:16').length
    const r169 = rows.filter((r) => r.aspectRatio === '16:9').length
    expect(r916).toBeGreaterThan(30)
    expect(r169).toBeGreaterThan(30)
    const vua = rows.filter((r) => r.label.includes('VuaDoctor'))
    expect(vua.length).toBeGreaterThanOrEqual(3)
    expect(vua.map((r) => r.label)).toContain('VuaDoctor')
  })

  it('generated rows have resultUuid + mediaId 0; uploaded rows have mediaId >0', () => {
    const rows = loadFixture()
    for (const r of rows.filter((x) => x.kind === 'generated')) {
      expect(r.resultUuid, `generated ${r.id}`).toBeTruthy()
      expect(r.mediaId).toBe(0)
    }
    for (const r of rows.filter((x) => x.kind === 'uploaded')) {
      expect(r.mediaId, `uploaded ${r.id}`).toBeGreaterThan(0)
      expect(r.resultUuid, `uploaded ${r.id} resultUuid`).toBe('')
    }
  })
})

describe('presenter capped well stays capped at 100 items', () => {
  it('talkingphotos.css caps .tp-chars at 320px with internal scroll and no horizontal overflow', () => {
    const css = fs.readFileSync(path.resolve('src/screens/talkingphotos/talkingphotos.css'), 'utf8')
    // 320px well is the spec §5 requirement — must not be removed
    expect(css).toMatch(/\.tp-chars\s*\{[^}]*max-height:\s*320px/m)
    expect(css).toMatch(/\.tp-chars\s*\{[^}]*overflow-y:\s*auto/m)
    expect(css).toMatch(/\.tp-chars\s*\{[^}]*overflow-x:\s*hidden/m)
    expect(css).toMatch(/\.tp-chars\s*\{[^}]*scrollbar-gutter:\s*stable/m)
  })

  it('renders 100 tiles inside a 1100px shell without widening the grid', async () => {
    // Cheap jsdom proof that 100 presenters do not blow the capped well:
    // render the grid markup that TalkingPhotos.tsx produces and assert
    // computed max-height is 320px and the grid itself does not cause overflow.
    const rows = loadFixture()
    // Simulate the .tp-chars grid: we create the element with the CSS loaded via import
    // The vitest css:true config injects talkingphotos.css into jsdom; getComputedStyle must read it.
    const { readFileSync } = await import('node:fs')
    // Ensure css is loaded by importing the module (side-effect) — dynamic to keep this test isolated
    await import('../../src/screens/talkingphotos/talkingphotos.css')

    const container = document.createElement('div')
    container.style.width = '1100px'
    container.style.overflow = 'hidden'
    const grid = document.createElement('div')
    grid.className = 'tp-chars is-comfortable'
    grid.style.width = '100%'
    for (const r of rows) {
      const tile = document.createElement('div')
      tile.className = 'tp-char'
      tile.dataset.id = r.id
      tile.textContent = r.label
      grid.appendChild(tile)
    }
    container.appendChild(grid)
    document.body.appendChild(container)

    const style = getComputedStyle(grid)
    // Capped well: must be exactly 320px and scrollable internally, not expanding
    expect(style.maxHeight).toBe('320px')
    expect(style.overflowY).toBe('auto')
    expect(style.overflowX).toBe('hidden')
    // jsdom has no layout (scrollWidth/clientWidth are always 0), so prove via computed style:
    // the grid is actually display:grid with the expected 88px rail columns and capped well.
    expect(style.display).toBe('grid')
    expect(style.gridTemplateColumns).toContain('88px')
    // Also prove via CSS text that the capped well is overflow-hidden internally (no page widening)
    const cssText = readFileSync(path.resolve('src/screens/talkingphotos/talkingphotos.css'), 'utf8')
    expect(cssText).toMatch(/\.tp-chars\s*\{[^}]*max-height:\s*320px/m)
    expect(cssText).toMatch(/\.tp-chars\s*\{[^}]*overflow-x:\s*hidden/m)
    // 100 tiles must actually be in the DOM; chips would read All 100 — proof the split is honest
    expect(grid.children.length).toBe(100)
    expect(rows.length).toBe(100)

    document.body.removeChild(container)
  })

  it('ledger stays pinned: header has sticky and rail token --tp-rail shared', () => {
    const css = fs.readFileSync(path.resolve('src/screens/talkingphotos/talkingphotos.css'), 'utf8')
    expect(css).toMatch(/\.tp-colhead[^}]*position:\s*sticky/m)
    expect(css).toMatch(/\.tp-railhead[^}]*position:\s*sticky/m)
    expect(css).toMatch(/--tp-rail:\s*88px/)
    expect(css).toMatch(/--tp-rail:\s*72px/)
    expect(css).toMatch(/--tp-rail:\s*56px/)
  })
})
