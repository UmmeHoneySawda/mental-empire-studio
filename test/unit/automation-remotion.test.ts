import { describe, expect, it } from 'vitest'
import {
  automationRemotionBrollDensity,
  automationRemotionGrade,
  automationRemotionHookPlan
} from '../../shared/automationRemotion'
import { DEFAULT_AUTOMATION_STYLE } from '../../shared/automationConfig'
import { DEFAULT_VIDEO_GRADING, type VideoGradingPreset, type VideoProject } from '../../shared/video-engine'

const presets: VideoGradingPreset[] = [
  { id: 'off', name: 'None', description: '', grading: { ...DEFAULT_VIDEO_GRADING } },
  { id: 'teal-orange', name: 'Cinema', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, temperature: 0.2 } },
  { id: 'bleach-noir', name: 'Intense', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, saturation: 0.4 } },
  { id: 'warm-doc', name: 'Warm', description: '', grading: { ...DEFAULT_VIDEO_GRADING, enabled: true, temperature: 0.15 } }
]

const project = {
  id: 'remotion-download-1',
  name: 'Why Memory Works',
  rendererId: 'remotion',
  canvas: { fps: 30, durationFrames: 900 }
} as VideoProject

describe('automation Remotion choices', () => {
  it('maps automation grades to existing Remotion grading presets', () => {
    expect(automationRemotionGrade({ ...DEFAULT_AUTOMATION_STYLE, videoStyle: 'Cinematic' }, presets).temperature).toBe(0.2)
    expect(automationRemotionGrade({ ...DEFAULT_AUTOMATION_STYLE, videoStyle: 'Intense' }, presets).saturation).toBe(0.4)
    expect(automationRemotionGrade({ ...DEFAULT_AUTOMATION_STYLE, videoStyle: 'Clean' }, presets).enabled).toBe(false)
  })

  it('maps automation density into the Remotion Auto B-roll vocabulary', () => {
    expect(automationRemotionBrollDensity({ ...DEFAULT_AUTOMATION_STYLE, brollDensity: 'full' })).toBe('dense')
    expect(automationRemotionBrollDensity({ ...DEFAULT_AUTOMATION_STYLE, brollDensity: 'keywords' })).toBe('balanced')
    expect(automationRemotionBrollDensity({ ...DEFAULT_AUTOMATION_STYLE, brollDensity: 'sparse' })).toBe('sparse')
  })

  it('builds a bounded Remotion hook plan from the selected hook text', () => {
    const plan = automationRemotionHookPlan(project, {
      ...DEFAULT_AUTOMATION_STYLE,
      hookEnabled: true,
      hookText: 'STOP SCROLLING',
      videoStyle: 'Intense'
    })
    expect(plan).toMatchObject({
      rendererId: 'remotion',
      templateId: 'remotion-hook-kinetic-30',
      durationFrames: 90,
      title: 'STOP SCROLLING'
    })
    expect(plan?.beats[0]?.headline).toBe('STOP SCROLLING')
  })
})

const registry = (() => {
  try {
    // Lazy so the suite still runs when better-sqlite3 is unavailable in some envs
    const { VideoTemplateRegistry } = require('../../electron/services/video-engine/templates/registry')
    return new VideoTemplateRegistry()
  } catch {
    return null as unknown as import('../../electron/services/video-engine/templates/registry').VideoTemplateRegistry
  }
})()

const transcribed = {
  id: 'remotion-download-2',
  name: 'Why Memory Works',
  rendererId: 'remotion',
  canvas: { fps: 30, durationFrames: 900 },
  captions: {
    words: 'the ending is a tuesday where nothing happens at all ever'
      .split(' ')
      .map((text, index) => ({ id: `w-${index}`, text, startFrame: index * 10, endFrame: index * 10 + 9 }))
  }
} as unknown as VideoProject

describe('automation hook template selection', () => {
  it('still derives the old hook from the grade when nothing is selected', () => {
    const plan = automationRemotionHookPlan(transcribed, {
      ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: '', videoStyle: 'Cinematic'
    })
    expect(plan).toMatchObject({ templateId: 'remotion-hook-cinematic-30', durationFrames: 90 })
    expect(plan?.beats).toHaveLength(1)
  })

  it('honours an explicitly chosen classic hook without changing the old shape', () => {
    if (!registry) return
    const plan = automationRemotionHookPlan(
      transcribed,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: 'STOP SCROLLING', hookTemplateId: 'remotion-hook-motivational' },
      registry.require('remotion-hook-motivational')
    )
    expect(plan).toMatchObject({ templateId: 'remotion-hook-motivational', durationFrames: 90, title: 'STOP SCROLLING' })
    expect(plan?.beats).toHaveLength(1)
  })

  it('builds a single-beat Cinematic plan carrying every manifest prop', () => {
    if (!registry) return
    const plan = automationRemotionHookPlan(
      transcribed,
      {
        ...DEFAULT_AUTOMATION_STYLE,
        hookEnabled: true,
        hookTemplateId: 'remotion-hook-cine-margin-note',
        hookProps: { line: 'The ending is a Tuesday.', reel: 'REEL 09', startTimecodeSeconds: 120 },
        hookSeconds: 5.5
      },
      registry.require('remotion-hook-cine-margin-note')
    )
    expect(plan?.templateId).toBe('remotion-hook-cine-margin-note')
    expect(plan?.beats).toHaveLength(1)
    expect(plan?.durationFrames).toBe(165)
    expect(plan?.props).toMatchObject({ line: 'The ending is a Tuesday.', reel: 'REEL 09', startTimecodeSeconds: 120 })
    expect(plan?.props['grain']).toBe(0.6)
    expect(plan?.props['accentColor']).toBe('#C9553C')
    expect(plan?.beats[0]?.headline).toBe('The ending is a Tuesday.')
  })

  it('writes the transcript line into the headline when the stored one is empty', () => {
    if (!registry) return
    const plan = automationRemotionHookPlan(
      transcribed,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: '', hookTemplateId: 'remotion-hook-cine-title-card', hookProps: { kicker: 'ON LEAVING' } },
      registry.require('remotion-hook-cine-title-card')
    )
    expect(plan?.beats[0]?.headline).toBe('the ending is a tuesday where nothing happens')
    expect(plan?.props['kicker']).toBe('ON LEAVING')
  })

  it('lets the preset hook text beat the transcript, and a stored headline beat both', () => {
    if (!registry) return
    const withHookText = automationRemotionHookPlan(
      transcribed,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: 'FROM THE PRESET', hookTemplateId: 'remotion-hook-cine-title-card' },
      registry.require('remotion-hook-cine-title-card')
    )
    expect(withHookText?.beats[0]?.headline).toBe('FROM THE PRESET')

    const withStoredProp = automationRemotionHookPlan(
      transcribed,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookText: 'FROM THE PRESET', hookTemplateId: 'remotion-hook-cine-title-card', hookProps: { line: 'FROM THE FIELD' } },
      registry.require('remotion-hook-cine-title-card')
    )
    expect(withStoredProp?.beats[0]?.headline).toBe('FROM THE FIELD')
  })

  it('never asks for a hook longer than the video', () => {
    if (!registry) return
    const short = { ...transcribed, canvas: { fps: 30, durationFrames: 45 } } as unknown as VideoProject
    const plan = automationRemotionHookPlan(
      short,
      { ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookTemplateId: 'remotion-hook-cine-trailer-drop', hookSeconds: 6 },
      registry.require('remotion-hook-cine-trailer-drop')
    )
    expect(plan?.durationFrames).toBe(45)
  })

  it('falls back to automatic when the manifest could not be resolved', () => {
    const plan = automationRemotionHookPlan(transcribed, {
      ...DEFAULT_AUTOMATION_STYLE, hookEnabled: true, hookTemplateId: 'remotion-hook-cine-title-card', videoStyle: 'Intense'
    })
    expect(plan?.templateId).toBe('remotion-hook-kinetic-30')
  })
})