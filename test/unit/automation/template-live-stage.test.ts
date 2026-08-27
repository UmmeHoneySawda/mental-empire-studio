import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { TemplateLiveStage } from '../../../src/features/automation/TemplateLiveStage'
import { CINEMATIC_PORTRAIT_MOCKUP } from '../../../src/features/automation/mockupBackdrops'
import { previewUrlForPath } from '../../../src/features/video-studio/editor/assetUrl'
import type { VisualTemplate } from '../../../shared/types'

function mockTemplate(over: Partial<VisualTemplate> = {}): VisualTemplate {
  return {
    id: 't-test',
    name: 'Live Stage Test Template',
    mode: 'Image slideshow',
    imagePaths: ['/test/assets/photo.jpg'],
    imageDurationSec: 5,
    density: 'Full',
    order: 'In order',
    motion: 'Static',
    transition: 'fade',
    grade: 'Cinematic',
    captionStyle: 'highlight',
    aspectRatio: '9:16',
    hookLine: 'Hook Headline Text',
    zoomAtStart: false,
    filterPresetId: 'neutral',
    effectsPresetIds: [],
    captionTemplateId: '',
    captionProps: {},
    hookTemplateId: '',
    hookProps: {},
    hookSeconds: 3,
    ...over,
  } as VisualTemplate
}

describe('TemplateLiveStage', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders region container with aria-label', () => {
    const { container } = render(React.createElement(TemplateLiveStage, { template: mockTemplate() }))
    const region = container.querySelector('[role="region"]')
    expect(region).toBeTruthy()
    expect(region?.getAttribute('aria-label')).toBe('Template live preview')
  })

  describe('Aspect Ratio rendering', () => {
    it('renders 9:16 portrait aspect ratio', () => {
      const { container } = render(React.createElement(TemplateLiveStage, { template: mockTemplate({ aspectRatio: '9:16' }) }))
      const innerFrame = container.querySelector('[data-testid="stage-inner-frame"]') as HTMLElement
      expect(innerFrame).toBeTruthy()
      expect(innerFrame.getAttribute('data-aspect-ratio')).toBe('9:16')
      expect(innerFrame.style.aspectRatio).toBe('9 / 16')
    })

    it('renders 1:1 square aspect ratio', () => {
      const { container } = render(React.createElement(TemplateLiveStage, { template: mockTemplate({ aspectRatio: '1:1' }) }))
      const innerFrame = container.querySelector('[data-testid="stage-inner-frame"]') as HTMLElement
      expect(innerFrame).toBeTruthy()
      expect(innerFrame.getAttribute('data-aspect-ratio')).toBe('1:1')
      expect(innerFrame.style.aspectRatio).toBe('1 / 1')
    })

    it('renders 16:9 landscape aspect ratio', () => {
      const { container } = render(React.createElement(TemplateLiveStage, { template: mockTemplate({ aspectRatio: '16:9' }) }))
      const innerFrame = container.querySelector('[data-testid="stage-inner-frame"]') as HTMLElement
      expect(innerFrame).toBeTruthy()
      expect(innerFrame.getAttribute('data-aspect-ratio')).toBe('16:9')
      expect(innerFrame.style.aspectRatio).toBe('16 / 9')
    })
  })

  describe('Backdrop rendering', () => {
    it('renders backdrop image from pool image when available', () => {
      const testPath = '/custom/pool/slide1.jpg'
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ mode: 'Image slideshow', imagePaths: [testPath] }),
        })
      )
      const img = container.querySelector('[data-testid="stage-backdrop-img"]') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.src).toContain(previewUrlForPath(testPath))

      const badge = container.querySelector('[data-testid="stage-backdrop-badge"]')
      expect(badge?.textContent).toBe('Pool image')
    })

    it('renders mockup SVG backdrop when mode is Auto B-roll', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ mode: 'Auto B-roll', imagePaths: ['/ignored/path.jpg'] }),
        })
      )
      const img = container.querySelector('[data-testid="stage-backdrop-img"]') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.src).toBe(CINEMATIC_PORTRAIT_MOCKUP)

      const badge = container.querySelector('[data-testid="stage-backdrop-badge"]')
      expect(badge?.textContent).toBe('Auto B-roll sample')
    })

    it('renders sample preview backdrop when pool is empty', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ mode: 'Image slideshow', imagePaths: [] }),
        })
      )
      const img = container.querySelector('[data-testid="stage-backdrop-img"]') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.src).toBe(CINEMATIC_PORTRAIT_MOCKUP)

      const badge = container.querySelector('[data-testid="stage-backdrop-badge"]')
      expect(badge?.textContent).toBe('Sample preview')
    })

    it('falls back to CINEMATIC_PORTRAIT_MOCKUP and updates badge when pool image encounters error', () => {
      const testPath = 'C:\\missing\\broken-image.jpg'
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ mode: 'Image slideshow', imagePaths: [testPath] }),
        })
      )
      const img = container.querySelector('[data-testid="stage-backdrop-img"]') as HTMLImageElement
      expect(img).toBeTruthy()
      expect(img.src).toContain(previewUrlForPath(testPath))

      // Trigger image error
      fireEvent.error(img)

      expect(img.src).toBe(CINEMATIC_PORTRAIT_MOCKUP)
      const badge = container.querySelector('[data-testid="stage-backdrop-badge"]')
      expect(badge?.textContent).toBe('Sample fallback')
    })
  })

  describe('Color grading, tint, vignette, and caveat rendering', () => {
    it('renders CSS filter on frame when grading is enabled with non-neutral parameters', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({
            adjust: {
              enabled: true,
              exposure: 0.5,
              contrast: 0.3,
              saturation: 1.2,
              temperature: 0,
              tint: 0,
              vignette: 0,
              grain: 0,
            } as any,
          }),
        })
      )
      const mediaLayer = container.querySelector('[data-testid="stage-media-layer"]') as HTMLElement
      expect(mediaLayer.style.filter).toContain('brightness')
      expect(mediaLayer.style.filter).toContain('contrast')
      expect(mediaLayer.style.filter).toContain('saturate')
    })

    it('renders tint layer when temperature or tint is active', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({
            adjust: {
              enabled: true,
              exposure: 0,
              contrast: 0,
              saturation: 1,
              temperature: 0.6,
              tint: -0.2,
              vignette: 0,
              grain: 0,
            } as any,
          }),
        })
      )
      const tintEl = container.querySelector('[data-testid="grade-tint"]') as HTMLElement
      expect(tintEl).toBeTruthy()
      expect(tintEl.style.mixBlendMode).toBe('soft-light')
    })

    it('renders vignette overlay when vignette is greater than 0', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({
            adjust: {
              enabled: true,
              exposure: 0,
              contrast: 0,
              saturation: 1,
              temperature: 0,
              tint: 0,
              vignette: 0.45,
              grain: 0,
            } as any,
          }),
        })
      )
      const vignetteEl = container.querySelector('[data-testid="grade-vignette"]') as HTMLElement
      expect(vignetteEl).toBeTruthy()
      expect(vignetteEl.style.background).toContain('radial-gradient')
    })

    it('displays caveat note when grain is enabled', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({
            effectsPresetIds: ['grain-heavy'],
          }),
        })
      )
      const caveatBadge = container.querySelector('[data-testid="stage-caveat-badge"]')
      expect(caveatBadge).toBeTruthy()
      expect(caveatBadge?.textContent).toContain('grain')
    })
  })

  describe('Caption typography and active styling in Composite mode', () => {
    it('renders caption layer in default Composite mode', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'highlight' }),
        })
      )
      const captionLayer = container.querySelector('[data-testid="stage-caption-layer"]')
      expect(captionLayer).toBeTruthy()
      expect(container.textContent?.toLowerCase()).toContain('rent')
    })

    it('renders active word with highlight styling for highlight caption style', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'highlight' }),
        })
      )
      const activeWord = container.querySelector('[data-testid="caption-active-word"]') as HTMLElement
      expect(activeWord).toBeTruthy()
      expect(activeWord.getAttribute('data-active-treatment')).toBe('highlight')
    })

    it('renders active word with pill styling for clip-wipe caption style', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'clip-wipe' }),
        })
      )
      const activeWord = container.querySelector('[data-testid="caption-active-word"]') as HTMLElement
      expect(activeWord).toBeTruthy()
      expect(activeWord.getAttribute('data-active-treatment')).toBe('pill')
    })

    it('renders active word with underline styling for progress-underline caption style', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'progress-underline' }),
        })
      )
      const activeWord = container.querySelector('[data-testid="caption-active-word"]') as HTMLElement
      expect(activeWord).toBeTruthy()
      expect(activeWord.getAttribute('data-active-treatment')).toBe('underline')
    })

    it('renders active word with neon styling for neon-accent caption style', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'neon-accent' }),
        })
      )
      const activeWord = container.querySelector('[data-testid="caption-active-word"]') as HTMLElement
      expect(activeWord).toBeTruthy()
      expect(activeWord.getAttribute('data-active-treatment')).toBe('neon')
    })

    it('renders center placement for emoji-pop caption style', () => {
      const { container } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionStyle: 'emoji-pop' }),
        })
      )
      const captionLayer = container.querySelector('[data-testid="stage-caption-layer"]') as HTMLElement
      expect(captionLayer.getAttribute('data-placement')).toBe('center')
    })

    it('renders cinematic caption typography (Cinzel, JetBrains Mono, etc.)', () => {
      const { container: stackCont } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionTemplateId: 'remotion-caption-cine-keyword-stack' }),
        })
      )
      const stackCaption = stackCont.querySelector('[data-testid="stage-caption-layer"]') as HTMLElement
      expect(stackCaption.getAttribute('data-font-family')).toContain('Cinzel')

      cleanup()

      const { container: scrimCont } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ captionTemplateId: 'remotion-caption-cine-scrim-roll' }),
        })
      )
      const scrimCaption = scrimCont.querySelector('[data-testid="stage-caption-layer"]') as HTMLElement
      expect(scrimCaption.getAttribute('data-font-family')).toContain('JetBrains Mono')
    })
  })

  describe('Mode switching (Composite, Hook, Transition)', () => {
    it('allows switching between Composite, Hook, and Transition preview modes', () => {
      const { container, getByRole } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({
            hookLine: 'Master Your Focus Today',
            hookTemplateId: 'remotion-hook-cine-title-card',
            transition: 'wipe-left',
          }),
        })
      )

      // Initial: Composite mode
      expect(container.querySelector('[data-testid="stage-caption-layer"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="stage-hook-overlay"]')).toBeNull()
      expect(container.querySelector('[data-testid="stage-transition-overlay"]')).toBeNull()

      // Switch to Hook mode
      const hookBtn = getByRole('tab', { name: 'Hook' })
      fireEvent.click(hookBtn)
      expect(hookBtn.getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector('[data-testid="stage-caption-layer"]')).toBeNull()
      const hookOverlay = container.querySelector('[data-testid="stage-hook-overlay"]')
      expect(hookOverlay).toBeTruthy()
      expect(hookOverlay?.getAttribute('data-hook-type')).toBe('title-card')
      expect(container.textContent).toContain('Master Your Focus Today')

      // Switch to Transition mode
      const trBtn = getByRole('tab', { name: 'Transition' })
      fireEvent.click(trBtn)
      expect(trBtn.getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector('[data-testid="stage-hook-overlay"]')).toBeNull()
      const trOverlay = container.querySelector('[data-testid="stage-transition-overlay"]')
      expect(trOverlay).toBeTruthy()
      expect(trOverlay?.getAttribute('data-transition-preset')).toBe('wipe-left')
      expect(container.textContent).toContain('NEXT SCENE')

      // Switch back to Composite mode
      const compBtn = getByRole('tab', { name: 'Composite' })
      fireEvent.click(compBtn)
      expect(compBtn.getAttribute('aria-selected')).toBe('true')
      expect(container.querySelector('[data-testid="stage-caption-layer"]')).toBeTruthy()
    })

    it('renders diverse hook choreographies in Hook mode', () => {
      const hooks = [
        { id: 'remotion-hook-cine-title-card', type: 'title-card' },
        { id: 'remotion-hook-cine-reel-burn', type: 'reel-burn' },
        { id: 'remotion-hook-cine-hard-light', type: 'hard-light' },
        { id: 'remotion-hook-cine-trailer-drop', type: 'trailer-drop' },
        { id: 'remotion-hook-kinetic-30', type: 'kinetic' },
        { id: 'remotion-hook-typewriter-40', type: 'typewriter' },
      ]

      for (const { id, type } of hooks) {
        cleanup()
        const { container, getByRole } = render(
          React.createElement(TemplateLiveStage, {
            template: mockTemplate({ hookTemplateId: id, hookLine: 'Test Hook Line' }),
          })
        )
        fireEvent.click(getByRole('tab', { name: 'Hook' }))
        const hookOverlay = container.querySelector('[data-testid="stage-hook-overlay"]')
        expect(hookOverlay?.getAttribute('data-hook-type')).toBe(type)
        expect(container.textContent).toContain('Test Hook Line')
      }
    })

    it('renders fallback hookLine text when template.hookLine is empty', () => {
      const { container, getByRole } = render(
        React.createElement(TemplateLiveStage, {
          template: mockTemplate({ hookLine: '', hookTemplateId: 'remotion-hook-cine-title-card' }),
        })
      )
      fireEvent.click(getByRole('tab', { name: 'Hook' }))
      expect(container.textContent).toContain('First line of your video')
    })
  })
})
