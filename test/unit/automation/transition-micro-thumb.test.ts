import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import { TRANSITION_PRESETS } from '../../../shared/video-engine/transition-presets'
import { TransitionMicroThumb } from '../../../src/features/automation/TransitionMicroThumb'

describe('TransitionMicroThumb', () => {
  afterEach(() => cleanup())

  const allPresets = [
    'cut',
    'crossfade',
    'fade-quick',
    'fade-slow',
    'slide-left',
    'slide-right',
    'slide-up',
    'slide-down',
    'wipe-left',
    'wipe-right',
    'zoom',
    'blur',
    'dip-to-black'
  ]

  it('renders without crashing for every required transition preset', () => {
    for (const presetId of allPresets) {
      const { container } = render(React.createElement(TransitionMicroThumb, { presetId }))
      const box = container.querySelector('.tr-micro-box')
      expect(box, `preset ${presetId} should render .tr-micro-box`).toBeTruthy()
      expect(container.textContent).toContain('A')
      expect(container.textContent).toContain('B')
    }
  })

  it('renders all presets defined in TRANSITION_PRESETS', () => {
    for (const preset of TRANSITION_PRESETS) {
      const { container } = render(React.createElement(TransitionMicroThumb, { presetId: preset.id }))
      const box = container.querySelector('.tr-micro-box')
      expect(box, `preset ${preset.id} should render .tr-micro-box`).toBeTruthy()
    }
  })

  it('applies active border highlight when active is true', () => {
    const { container: inactiveCont } = render(React.createElement(TransitionMicroThumb, { presetId: 'crossfade', active: false }))
    const inactiveBox = inactiveCont.querySelector('.tr-micro-box') as HTMLElement
    expect(inactiveBox.style.border).toContain('var(--border-2)')

    const { container: activeCont } = render(React.createElement(TransitionMicroThumb, { presetId: 'crossfade', active: true }))
    const activeBox = activeCont.querySelector('.tr-micro-box') as HTMLElement
    expect(activeBox.style.border).toContain('var(--accent)')
  })

  it('handles cut preset with split representation', () => {
    const { container } = render(React.createElement(TransitionMicroThumb, { presetId: 'cut' }))
    const box = container.querySelector('.tr-micro-box')
    expect(box).toBeTruthy()
    expect(container.textContent).toContain('A')
    expect(container.textContent).toContain('B')
  })

  it('handles dip-to-black preset with black dip overlay', () => {
    const { container } = render(React.createElement(TransitionMicroThumb, { presetId: 'dip-to-black' }))
    const box = container.querySelector('.tr-micro-box')
    expect(box).toBeTruthy()
    expect(container.textContent).toContain('B')
  })
})
