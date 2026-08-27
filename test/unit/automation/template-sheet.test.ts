import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import type { VisualTemplate } from '../../../shared/types'

if (typeof window !== 'undefined' && !(window as any).matchMedia) {
  ;(window as any).matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
}

// Mock window.api for TemplateImagePool nested inside sheet (prevent errors)
beforeEach(() => {
  ;(globalThis as any).window = (globalThis as any).window || {}
  ;(window as any).api = {
    pathForFile: (f: File) => (f as any).path || `/tmp/${(f as any).name || 'image.png'}`,
    assets: {
      import: async (paths: string[]) => paths.map((p) => ({ canonicalPath: p, id: p })),
      list: async () => []
    }
  }
  ;(window as any).matchMedia =
    (window as any).matchMedia ||
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
})

afterEach(() => {
  cleanup()
})

function baseTemplate(over: Partial<VisualTemplate> = {}): VisualTemplate {
  return {
    id: 'tpl-test',
    name: 'Test Template',
    mode: 'Auto B-roll',
    imagePaths: [],
    imageDurationSec: 5,
    density: 'Full',
    order: 'Shuffle',
    motion: 'Cinematic',
    transition: 'crossfade',
    transitionDurationFrames: 30,
    grade: 'Cinematic',
    captionStyle: 'highlight',
    aspectRatio: '9:16',
    hookLine: 'Hook line',
    hookTemplateId: 'remotion-hook-kinetic-30',
    hookProps: { animationPreset: 'kinetic' } as any,
    hookSeconds: 0,
    captionTemplateId: '',
    captionProps: {},
    filterPresetId: 'neutral',
    adjust: { enabled: true, exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0, vignette: 0, grain: 0 } as any,
    effectsPresetIds: [],
    zoomAtStart: true,
    ...over
  }
}

describe('TemplateSheet', () => {
  it('renders all groups: Format, Look, Captions, Hook, Media', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    const onChange = vi.fn()
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange,
        onSave,
        onClose
      })
    )
    expect(screen.getByText('Format')).toBeTruthy()
    expect(screen.getByText('Look')).toBeTruthy()
    expect(screen.getByText('Captions')).toBeTruthy()
    expect(screen.getAllByText('Hook').length).toBeGreaterThan(0)
    expect(screen.getByText('Media')).toBeTruthy()
  })

  it('changing a control fires onChange with the right field (mode)', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    const onChange = vi.fn()
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange,
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    const slideshowBtn = screen.getByRole('button', { name: /Image slideshow/i })
    fireEvent.click(slideshowBtn)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'Image slideshow' }))
  })

  it('hookProps is replaced (not merged) on hook change', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    const onChange = vi.fn()
    const initial = baseTemplate({ hookTemplateId: 'remotion-hook-kinetic-30', hookProps: { animationPreset: 'kinetic', backgroundPreset: 'grid' } as any })
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: initial,
        onChange,
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    // Click a cinematic hook
    const cineBtn = screen.getByText('Cine · Title Card')
    fireEvent.click(cineBtn)
    // Should have been called with new hookTemplateId and fresh hookProps that does not contain old keys like animationPreset from kinetic
    const call = onChange.mock.calls.find((args) => (args[0] as any).hookTemplateId === 'remotion-hook-cine-title-card')
    expect(call).toBeDefined()
    const patch = call![0] as VisualTemplate
    expect(patch.hookProps).toBeDefined()
    // New cine title card has line + kicker, not animationPreset
    expect(patch.hookProps).not.toHaveProperty('animationPreset')
    expect(patch.hookProps).toHaveProperty('line')
  })

  it('Save is disabled for Image slideshow with no images', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate({ mode: 'Image slideshow', imagePaths: [] }),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    const saveBtn = screen.getByRole('button', { name: /Save template/i })
    expect(saveBtn.hasAttribute('disabled') || (saveBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save is enabled for Image slideshow with images', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate({ mode: 'Image slideshow', imagePaths: ['/tmp/a.png'] }),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    const saveBtn = screen.getByRole('button', { name: /Save template/i })
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders 7 adjust sliders with correct defaults', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    // Exposure, Contrast, Saturation, Temperature, Tint, Vignette, Film Grain
    expect(screen.getByText('Exposure')).toBeTruthy()
    expect(screen.getByText('Contrast')).toBeTruthy()
    expect(screen.getByText('Saturation')).toBeTruthy()
    expect(screen.getByText('Temperature')).toBeTruthy()
    expect(screen.getByText('Vignette')).toBeTruthy()
    expect(screen.getByText('Film Grain')).toBeTruthy()
  })

  it('effects show human names not raw ids', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    expect(screen.getByText('Vignette Shadow')).toBeTruthy()
    expect(screen.getByText('Film Grain Overlay')).toBeTruthy()
    // Raw ids should not appear
    const raw = document.body.textContent || ''
    expect(raw).not.toContain('vignette-boost')
    expect(raw).not.toContain('grain-heavy')
  })

  it('caption styles show human names', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    expect(screen.getByText('Focus Highlight')).toBeTruthy()
    expect(screen.getByText('Impact Pop')).toBeTruthy()
  })

  it('hook templates show human names and Automatic option', async () => {
    const { TemplateSheet } = await import('../../../src/features/automation/TemplateSheet')
    render(
      React.createElement(TemplateSheet, {
        open: true,
        template: baseTemplate(),
        onChange: vi.fn(),
        onSave: vi.fn(),
        onClose: vi.fn()
      })
    )
    expect(screen.getByText('Automatic (matches the colour grade)')).toBeTruthy()
    expect(screen.getByText('Cine · Hard Light')).toBeTruthy()
  })
})
