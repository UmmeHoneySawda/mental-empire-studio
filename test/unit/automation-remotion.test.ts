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