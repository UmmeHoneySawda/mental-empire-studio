import type { AutomationStyleConfig } from './types'
import type { AutoBrollDensity, HookPlan, VideoGradingPreset, VideoProject } from './video-engine'

const GRADE_PRESET_BY_STYLE: Readonly<Record<AutomationStyleConfig['videoStyle'], string>> = {
  None: 'off',
  Clean: 'off',
  Cinematic: 'teal-orange',
  Intense: 'bleach-noir',
  Heartfelt: 'warm-doc'
}

export function automationRemotionGrade(
  style: AutomationStyleConfig,
  presets: readonly VideoGradingPreset[]
): VideoGradingPreset['grading'] {
  const id = GRADE_PRESET_BY_STYLE[style.videoStyle]
  return (presets.find((preset) => preset.id === id) ?? presets.find((preset) => preset.id === 'off'))?.grading
    ?? { enabled: false, lutIntensity: 1, exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0, vignette: 0, grain: 0 }
}

export function automationRemotionBrollDensity(style: AutomationStyleConfig): AutoBrollDensity {
  if (style.brollDensity === 'full') return 'dense'
  if (style.brollDensity === 'keywords') return 'balanced'
  return 'sparse'
}

export function automationRemotionHookPlan(project: VideoProject, style: AutomationStyleConfig): HookPlan | null {
  if (!style.hookEnabled) return null
  const words = project.captions?.words.slice(0, 8).map((word) => word.text).join(' ').trim() ?? ''
  const title = (style.hookText.trim() || words || project.name).slice(0, 500)
  const templateId = style.videoStyle === 'Intense'
    ? 'remotion-hook-kinetic-30'
    : 'remotion-hook-cinematic-30'
  const durationFrames = Math.min(project.canvas.durationFrames, Math.max(1, Math.round(project.canvas.fps * 3)))
  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId,
    templateVersion: '1.0.0',
    fps: project.canvas.fps,
    title,
    durationFrames,
    props: {},
    beats: [{
      id: 'beat-1',
      startFrame: 0,
      durationFrames,
      headline: title,
      variant: style.videoStyle === 'Intense' ? 'urgent' : 'cinematic',
      visual: { kind: 'none' }
    }]
  }
}