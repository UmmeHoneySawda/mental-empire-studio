import type {
  AppSettings,
  AutomationJobDraft,
  AutomationStyleConfig,
  BrollDensity,
  MotionPreset,
  VideoStyle,
  VisualTemplate
} from './types'
import type { CaptionStyleId } from './video-engine/caption-style'
import { DEFAULT_AUTOMATION_STYLE, normalizeAutomationConfig } from './automationConfig'
import { createDefaultDraft } from './automationDraft'
import { resolveTransitionPreset } from './video-engine/transition-presets'

/** The Automations screen writes a `VisualTemplate` — a UI-shaped record. The Supervisor
 *  consumes an `AutomationStyleConfig`. They share no field names, so this is the one
 *  place the two vocabularies meet. Every map below is a total `Record`, so adding a
 *  value to either union is a compile error here rather than a silently dropped field —
 *  which is exactly how the hook fields went missing before (diag-automation F4). */

/** `TRANSITION_PRESETS` measures duration in frames at 30fps — its own table documents
 *  `crossfade` (30 frames) as "One second" and `fade-quick` (15) as "Half a second". */
const PRESET_FPS = 30

/** `VideoStyle` has no desaturated or warm look, so `Noir` and `Gold` land on their
 *  nearest renderable neighbour. Both chips are removed from the wizard in F4. */
const GRADE_TO_VIDEO_STYLE: Record<VisualTemplate['grade'], VideoStyle> = {
  Noir: 'Cinematic',
  Cinematic: 'Cinematic',
  Intense: 'Intense',
  Heartfelt: 'Heartfelt',
  Clean: 'Clean',
  Gold: 'Heartfelt'
}

const MOTION_TO_PRESET: Record<VisualTemplate['motion'], MotionPreset> = {
  Static: 'off',
  Subtle: 'subtle',
  Cinematic: 'cinematic'
}

const DENSITY_TO_BROLL: Record<VisualTemplate['density'], BrollDensity> = {
  Full: 'full',
  Sparse: 'sparse',
  Keywords: 'keywords'
}

/** Two independent caption systems: the template picks a Remotion `CaptionStyleId`,
 *  the Supervisor renders a classic preset from `shared/captionStyle.ts`. */
const CAPTION_STYLE_TO_PRESET: Record<CaptionStyleId, string> = {
  'emoji-pop': 'Beast',
  'clip-wipe': 'Karaoke',
  highlight: 'Hormozi',
  'neon-accent': 'Neon',
  'particle-burst': 'Beast',
  'weight-shift': 'Word',
  'motivation-bold': 'Hormozi',
  'mindset-pill': 'Boxed',
  'progress-underline': 'Karaoke',
  'coach-clean': 'Minimal'
}

export function visualTemplateToStyleConfig(template?: VisualTemplate): AutomationStyleConfig {
  if (!template) return { ...DEFAULT_AUTOMATION_STYLE }
  const autoBroll = template.mode === 'Auto B-roll'
  const baseTransition = resolveTransitionPreset(template.transition)
  const crossfadeSec = template.transitionDurationFrames != null && Number.isFinite(template.transitionDurationFrames)
    ? Math.max(0, Math.min(5, template.transitionDurationFrames / PRESET_FPS))
    : baseTransition.durationFrames / PRESET_FPS
  const cfg: AutomationStyleConfig = {
    ...DEFAULT_AUTOMATION_STYLE,
    videoStyle: GRADE_TO_VIDEO_STYLE[template.grade],
    captionStyle: template.captionStyle,
    captionPreset: CAPTION_STYLE_TO_PRESET[template.captionStyle],
    transition: template.transition,
    aspectRatio: template.aspectRatio,
    imageMode: autoBroll ? 'pool' : 'sequence',
    imageDurationSec: template.imageDurationSec ?? DEFAULT_AUTOMATION_STYLE.imageDurationSec,
    imageShuffle: template.imageShuffleLocked ?? (template.order === 'Shuffle'),
    crossfadeSec,
    motionPreset: MOTION_TO_PRESET[template.motion],
    hookEnabled: true,
    hookText: template.hookLine,
    zoomAtStart: template.zoomAtStart,
    hookTemplateId: template.hookTemplateId ?? '',
    hookProps: { ...(template.hookProps ?? {}) },
    hookSeconds: template.hookSeconds ?? 0,
    captionTemplateId: template.captionTemplateId ?? '',
    captionProps: { ...(template.captionProps ?? {}) },
    brollMode: autoBroll ? 'full' : 'off',
    brollDensity: DENSITY_TO_BROLL[template.density],
    brollShufflePolicy: template.order === 'Shuffle' ? 'per-video' : 'ranked'
  }
  // Pass-through new fields for future pipeline stages — kept as soft extension on the config.
  // They are optional and additive, so legacy consumers ignore them.
  if (template.filterPresetId) (cfg as unknown as Record<string, unknown>).filterPresetId = template.filterPresetId
  if (template.adjust) (cfg as unknown as Record<string, unknown>).adjust = template.adjust
  if (template.effectsPresetIds) (cfg as unknown as Record<string, unknown>).effectsPresetIds = template.effectsPresetIds
  if (template.scrim) (cfg as unknown as Record<string, unknown>).scrim = template.scrim
  if (template.transitionDurationFrames != null) (cfg as unknown as Record<string, unknown>).transitionDurationFrames = template.transitionDurationFrames
  if (template.textOverlays) (cfg as unknown as Record<string, unknown>).textOverlays = template.textOverlays
  return cfg
}

export interface AutomationLaunchSource {
  id: string
  url: string
  name: string
}

/** Rotation policy for an owned channel fed by several sources: least-recently-drawn wins,
 *  so the sources take turns. Previously every linked source was flattened into one
 *  `IN (…) ORDER BY ord` query, so whichever source held the lowest `ord` supplied every
 *  video and the screen's "Rotation Sources" label was fiction (diag-automation F5).
 *  A never-drawn source goes first; ties break on id so the pick is deterministic. */
export function pickRotationSource<T extends { id: string; lastDrawnAt?: string }>(sources: T[]): T | undefined {
  return [...sources].sort((a, b) => {
    const left = a.lastDrawnAt ?? ''
    const right = b.lastDrawnAt ?? ''
    if (left !== right) return left < right ? -1 : 1
    return a.id < b.id ? -1 : 1
  })[0]
}

/** Builds the draft the Supervisor's `preflightAutomation` / `createAutomationJob` expect
 *  from one owned-channel launch. `createDefaultDraft` supplies the notification, retry and
 *  caption defaults so this stays a diff against the canonical baseline, not a second one. */
export function buildAutomationDraft(opts: {
  source: AutomationLaunchSource
  count: number
  template?: VisualTemplate
  channelName?: string
  settings?: Pick<AppSettings, 'background' | 'transcription' | 'autoScrape'>
}): AutomationJobDraft {
  const { draft } = createDefaultDraft(opts.settings)
  const styleConfig = visualTemplateToStyleConfig(opts.template)
  const name = [opts.channelName, opts.template?.name].filter(Boolean).join(' — ')
  return {
    name: name || opts.source.name,
    goal: 'source-to-export',
    config: normalizeAutomationConfig({
      ...draft.config,
      sourceKind: 'saved-source',
      sourceId: opts.source.id,
      sourceUrl: opts.source.url,
      sourceName: opts.source.name,
      // normalizeAutomationConfig clamps this to 1..50 and recomputes the legacy `style`
      // and `captionPreset` mirrors from styleConfig — but NOT `aspectRatios`, which it
      // only defaults when absent (`ratios.length ? ratios : …`). createDefaultDraft
      // already supplies 16:9, so the template's ratio must be written explicitly here.
      sourceCount: opts.count,
      aspectRatios: [styleConfig.aspectRatio],
      assetPaths: opts.template?.imagePaths ?? [],
      styleConfig,
      rules: { ...draft.config.rules, autoBroll: styleConfig.brollMode !== 'off' }
    })
  }
}
