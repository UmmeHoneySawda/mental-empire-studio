import type { AutomationStyleConfig } from './types'
import type { AutoBrollDensity, HookPlan, JsonObject, TemplateManifest, VideoGradingPreset, VideoProject } from './video-engine'
import {
  NEW_HOOK_DEFINITIONS,
  isNewCaptionTemplateId,
  isNewHookTemplateId,
  newCaptionDraftFromProps,
  newCaptionProps,
  newHookDraftFromProps,
  newHookPlan
} from './video-engine'

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

/** The opening line, in one place. A stored headline prop wins because it is the most specific
 *  thing the operator typed; then the preset's own hook line; then this video's transcript, which
 *  is the only part of a batch's hook that varies per video; then the project name as a last
 *  resort. Mirrors what the pre-Cinematic builder did, with the prop added on top. */
function automationHookHeadline(project: VideoProject, style: AutomationStyleConfig): string {
  const words = project.captions?.words.slice(0, 8).map((word) => word.text).join(' ').trim() ?? ''
  return (style.hookText.trim() || words || project.name).slice(0, 500)
}

export function automationRemotionHookPlan(
  project: VideoProject,
  style: AutomationStyleConfig,
  template?: TemplateManifest
): HookPlan | null {
  if (!style.hookEnabled) return null
  const title = automationHookHeadline(project, style)

  /* The Cinematic set has one component per template, each of which reads ONLY beats[0]. Its plan
   * must therefore come from `newHookPlan` — the accordion's single-beat builder — and not from the
   * grade-derived shape below. Same builder, same clamps, same props as Compose; the only automation
   * difference is that an empty headline field means "write one from this video's transcript". */
  if (template && isNewHookTemplateId(template.id)) {
    const definition = NEW_HOOK_DEFINITIONS[template.id]
    // The headline is the preset's `hookLine` (→ `style.hookText`), which is the single "Hook text
    // line" input in the preset editor. Nothing in the UI writes the headline key into `hookProps`
    // — the per-template field block filters `role === 'headline'` — so `hookProps` never carries a
    // headline to display. Passing `headline: title` unconditionally keeps the draft the UI shows
    // and the plan the pipeline builds in agreement; a hand-edited `hookProps` carrying a headline
    // is intentionally ignored in favour of the explicit `hookLine`.
    // Clamp the hook to the video length so the plan does not lengthen the canvas — the compiler
    // at `hook-compiler.ts:113` would otherwise extend it rather than reject.
    const canvasSeconds = project.canvas.durationFrames / project.canvas.fps
    const chosen = style.hookSeconds > 0 ? style.hookSeconds : definition.defaultSeconds
    const draft = newHookDraftFromProps({
      definition,
      props: style.hookProps,
      headline: title,
      seconds: Math.min(chosen, canvasSeconds)
    })
    return newHookPlan({ template, definition, draft, fps: project.canvas.fps })
  }

  /* Everything else: the pre-Cinematic shape, unchanged. `template` is only present here when the
   * operator explicitly picked one of the classic hooks, in which case its id replaces the
   * grade-derived guess and nothing else moves. */
  const templateId = template?.id
    ?? (style.videoStyle === 'Intense' ? 'remotion-hook-kinetic-30' : 'remotion-hook-cinematic-30')
  const durationFrames = Math.min(project.canvas.durationFrames, Math.max(1, Math.round(project.canvas.fps * 3)))
  const props: JsonObject = {}
  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId,
    templateVersion: template?.version ?? '1.0.0',
    fps: project.canvas.fps,
    title,
    durationFrames,
    props,
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

export interface AutomationCaptionChoice {
  templateId: string
  props: JsonObject
}

/** The caption template a batch should apply, or `null` to keep whatever `bindDownload` chose.
 *
 *  `bindDownload` already derives a caption template from the classic project's `captionPreset`
 *  (electron/services/video-engine/studio.ts:549-561), which is where a preset's `captionStyle`
 *  lands. That path cannot carry per-template props and cannot express the Cinematic ids, so an
 *  explicit `captionTemplateId` overrides it here.
 *
 *  Unknown ids resolve to `null` rather than throwing: a preset saved against a renderer build
 *  that no longer ships a template should render with the pipeline's own default, not fail the
 *  batch. The id list comes from the registry the render will actually use. */
export function automationCaptionChoice(
  style: AutomationStyleConfig,
  availableTemplateIds: readonly string[]
): AutomationCaptionChoice | null {
  const id = style.captionTemplateId.trim()
  if (!id || !availableTemplateIds.includes(id)) return null
  if (!isNewCaptionTemplateId(id)) return { templateId: id, props: {} }
  // The Cinematic styles own their colours, grain and paging; resolve the stored control values
  // through the same bounded builders the Compose accordion writes with.
  return { templateId: id, props: newCaptionProps(id, newCaptionDraftFromProps(id, style.captionProps)) }
}
