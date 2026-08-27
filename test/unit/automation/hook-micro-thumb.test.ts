import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import React from 'react'
import {
  HookMicroThumb,
  getHookMicroType
} from '../../../src/features/automation/HookMicroThumb'
import { REMOTION_HOOK_TEMPLATE_IDS } from '../../../shared/video-engine/hook-style'
import { NEW_HOOK_TEMPLATE_IDS } from '../../../shared/video-engine/new-templates'

describe('HookMicroThumb', () => {
  afterEach(() => cleanup())

  const requiredHookIds = [
    '', // Automatic
    'remotion-hook-kinetic-30',
    'remotion-hook-cinematic-quote-45',
    'remotion-hook-big-bold-20',
    'remotion-hook-typewriter-40',
    'remotion-hook-question-burst-30',
    'remotion-hook-stat-reveal-35',
    'remotion-hook-minimal-fade-25',
    'remotion-hook-cine-title-card',
    'remotion-hook-cine-reel-burn',
    'remotion-hook-cine-hard-light',
    'remotion-hook-cine-trailer-drop',
    'remotion-hook-cine-margin-note'
  ]

  it('renders without crashing for every required hook ID', () => {
    for (const hookId of requiredHookIds) {
      const { container } = render(React.createElement(HookMicroThumb, { hookId }))
      const box = container.querySelector('.hook-micro-box')
      expect(box, `hook ${hookId || '(empty/auto)'} should render .hook-micro-box`).toBeTruthy()
    }
  })

  it('renders without hookId prop defaulting to auto', () => {
    const { container } = render(React.createElement(HookMicroThumb, {}))
    const box = container.querySelector('.hook-micro-box')
    expect(box).toBeTruthy()
    expect(box?.getAttribute('data-hook-type')).toBe('auto')
    expect(container.textContent).toContain('AUTO')
  })

  it('renders all classic hooks in REMOTION_HOOK_TEMPLATE_IDS', () => {
    for (const id of REMOTION_HOOK_TEMPLATE_IDS) {
      const { container } = render(React.createElement(HookMicroThumb, { hookId: id }))
      const box = container.querySelector('.hook-micro-box')
      expect(box, `hook ${id} should render .hook-micro-box`).toBeTruthy()
    }
  })

  it('renders all cinematic hooks in NEW_HOOK_TEMPLATE_IDS', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const { container } = render(React.createElement(HookMicroThumb, { hookId: id }))
      const box = container.querySelector('.hook-micro-box')
      expect(box, `hook ${id} should render .hook-micro-box`).toBeTruthy()
    }
  })

  it('applies active border highlight when active is true', () => {
    const { container: inactiveCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-kinetic-30', active: false })
    )
    const inactiveBox = inactiveCont.querySelector('.hook-micro-box') as HTMLElement
    expect(inactiveBox.style.border).toContain('var(--border-2)')

    const { container: activeCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-kinetic-30', active: true })
    )
    const activeBox = activeCont.querySelector('.hook-micro-box') as HTMLElement
    expect(activeBox.style.border).toContain('var(--accent)')
  })

  it('maps each required hook ID to the expected hook micro type', () => {
    expect(getHookMicroType('')).toBe('auto')
    expect(getHookMicroType(undefined)).toBe('auto')
    expect(getHookMicroType('   ')).toBe('auto')
    expect(getHookMicroType('remotion-hook-kinetic-30')).toBe('kinetic')
    expect(getHookMicroType('remotion-hook-cinematic-quote-45')).toBe('quote')
    expect(getHookMicroType('remotion-hook-big-bold-20')).toBe('big-bold')
    expect(getHookMicroType('remotion-hook-typewriter-40')).toBe('typewriter')
    expect(getHookMicroType('remotion-hook-question-burst-30')).toBe('question-burst')
    expect(getHookMicroType('remotion-hook-stat-reveal-35')).toBe('stat-reveal')
    expect(getHookMicroType('remotion-hook-minimal-fade-25')).toBe('minimal')
    expect(getHookMicroType('remotion-hook-cine-title-card')).toBe('title-card')
    expect(getHookMicroType('remotion-hook-cine-reel-burn')).toBe('reel-burn')
    expect(getHookMicroType('remotion-hook-cine-hard-light')).toBe('hard-light')
    expect(getHookMicroType('remotion-hook-cine-trailer-drop')).toBe('trailer-drop')
    expect(getHookMicroType('remotion-hook-cine-margin-note')).toBe('margin-note')
  })

  it('renders specific text/visual elements for hook types', () => {
    // Typewriter
    const { container: typeCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-typewriter-40' })
    )
    expect(typeCont.textContent).toContain('TYPE')

    // Margin note
    const { container: marginCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-cine-margin-note' })
    )
    expect(marginCont.textContent).toContain('00:12:44')

    // Title card
    const { container: titleCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-cine-title-card' })
    )
    expect(titleCont.textContent).toContain('TITLE')

    // Hard light
    const { container: hardCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-cine-hard-light' })
    )
    expect(hardCont.textContent).toContain('NOIR')

    // Trailer drop
    const { container: trailerCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-cine-trailer-drop' })
    )
    expect(trailerCont.textContent).toContain('DROP')

    // Reel burn
    const { container: reelCont } = render(
      React.createElement(HookMicroThumb, { hookId: 'remotion-hook-cine-reel-burn' })
    )
    expect(reelCont.textContent).toContain('BURN')
  })
})
