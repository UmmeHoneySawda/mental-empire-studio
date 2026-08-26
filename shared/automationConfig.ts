import type {
  AutomationJobConfig,
  AutomationRules,
  AutomationStyleConfig,
  BrollDensity,
  CaptionStyleId,
  ImageMode,
  MotionPreset,
  VideoStyle
} from './types'
import type { JsonObject } from './video-engine/common'

export const DEFAULT_AUTOMATION_STYLE: AutomationStyleConfig = {
  videoStyle: 'Clean',
  captionPreset: 'Hormozi',
  captionFont: 'Montserrat',
  captionAnimation: 'Pop-in',
  captionPosition: 'bottom',
  captionLines: 1,
  captionPace: 'auto',
  wordsPerCaption: 2,
  highlightColor: '#f5b323',
  boxColor: '#111111',
  imageMode: 'sequence',
  imageDurationSec: 5,
  imageShuffle: false,
  transition: 'crossfade',
  crossfadeSec: 0.8,
  motionPreset: 'subtle',
  gradientEdge: 'none',
  gradientIntensity: 50,
  aspectRatio: '16:9',
  hookText: '',
  hookEnabled: false,
  zoomAtStart: true,
  hookTemplateId: '',
  hookProps: {},
  hookSeconds: 0,
  captionTemplateId: '',
  captionProps: {},
  brollMode: 'off',
  brollDensity: 'sparse',
  brollPoolSize: 18,
  brollFallbackPolicy: 'prefer-selected',
  brollShufflePolicy: 'per-video'
}

export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  minDurationSec: 0,
  skipDownloaded: true,
  continueOnError: true,
  maxRetries: 2,
  minimumFreeSpaceGb: 2,
  captions: true,
  autoBroll: false,
  removeSilence: false,
  reduceFillerWords: false,
  keepAwake: true,
  skipUploaded: true,
  fillSkippedSelections: false,
  allowStaleUploadCache: true,
  uploadFreshnessMinutes: 360,
  downloadDelaySec: 3,
  retryBaseDelaySec: 10,
  retryMaxDelaySec: 90
}

export function finiteNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  const safe = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.min(max, safe))
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function color(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

/** A registry template id. Length-capped rather than validated: this module has no access to
 *  the template registry, which lives in the Electron service. The pipeline resolves the id
 *  against the manifests it actually has and falls back to automatic for anything unknown —
 *  that is the only place the check can be honest. */
function templateId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : ''
}

/** Per-template manifest props, stored as an opaque record. Sanitised, not validated: only the
 *  manifest knows which keys are legal, and `resolveTemplateProps` is the thing that enforces
 *  it. This caps the shape so a corrupt row cannot bloat the persisted config blob, and drops
 *  anything a template parameter can never be (objects, arrays, booleans, NaN). */
function templateProps(value: unknown): JsonObject {
  const raw = record(value)
  const out: JsonObject = {}
  for (const key of Object.keys(raw).slice(0, 24)) {
    if (key.length > 64) continue
    const entry = raw[key]
    if (typeof entry === 'string') out[key] = entry.slice(0, 500)
    else if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
  }
  return out
}

function captionAnimation(value: unknown): string {
  if (value === 'Pop-in' || value === 'Fade' || value === 'None') return value
  if (value === 'Bounce' || value === 'Type') return 'Pop-in'
  if (value === 'Slide') return 'Fade'
  return DEFAULT_AUTOMATION_STYLE.captionAnimation
}

export function normalizeAutomationStyle(value: unknown, legacy: Partial<AutomationJobConfig> = {}): AutomationStyleConfig {
  const raw = record(value)
  const legacyStyle = oneOf<VideoStyle>(legacy.style, ['None', 'Cinematic', 'Intense', 'Heartfelt', 'Clean'], DEFAULT_AUTOMATION_STYLE.videoStyle)
  const legacyAspect = Array.isArray(legacy.aspectRatios) ? legacy.aspectRatios[0] : undefined
  const offsetRaw = raw.captionOffsetY
  const offset = offsetRaw == null || offsetRaw === '' ? undefined : finiteNumber(offsetRaw, 82, 4, 96)
  const videoStyle = oneOf<VideoStyle>(raw.videoStyle, ['None', 'Cinematic', 'Intense', 'Heartfelt', 'Clean'], legacyStyle)
  const captionStyle = typeof raw.captionStyle === 'string' && raw.captionStyle.trim() ? raw.captionStyle.trim() as CaptionStyleId : undefined
  const transition = typeof raw.transition === 'string' && raw.transition.trim() ? raw.transition.trim() : undefined
  return {
    videoStyle,
    ...(captionStyle ? { captionStyle } : {}),
    captionPreset: typeof raw.captionPreset === 'string' && raw.captionPreset.trim() ? raw.captionPreset.trim().slice(0, 80) : legacy.captionPreset || DEFAULT_AUTOMATION_STYLE.captionPreset,
    captionFont: typeof raw.captionFont === 'string' && raw.captionFont.trim() ? raw.captionFont.trim().slice(0, 80) : DEFAULT_AUTOMATION_STYLE.captionFont,
    captionAnimation: captionAnimation(raw.captionAnimation),
    captionPosition: oneOf(raw.captionPosition, ['top', 'middle', 'bottom'], DEFAULT_AUTOMATION_STYLE.captionPosition),
    ...(offset === undefined ? {} : { captionOffsetY: offset }),
    captionLines: Math.round(finiteNumber(raw.captionLines, DEFAULT_AUTOMATION_STYLE.captionLines, 1, 3)) as 1 | 2 | 3,
    captionPace: oneOf(raw.captionPace, ['auto', 'word', 'phrase'], DEFAULT_AUTOMATION_STYLE.captionPace),
    wordsPerCaption: Math.round(finiteNumber(raw.wordsPerCaption, DEFAULT_AUTOMATION_STYLE.wordsPerCaption, 1, 3)) as 1 | 2 | 3,
    highlightColor: color(raw.highlightColor, DEFAULT_AUTOMATION_STYLE.highlightColor),
    boxColor: color(raw.boxColor, DEFAULT_AUTOMATION_STYLE.boxColor),
    imageMode: oneOf<ImageMode>(raw.imageMode, ['sequence', 'pool'], DEFAULT_AUTOMATION_STYLE.imageMode),
    imageDurationSec: finiteNumber(raw.imageDurationSec, DEFAULT_AUTOMATION_STYLE.imageDurationSec, 1, 60),
    imageShuffle: bool(raw.imageShuffle, DEFAULT_AUTOMATION_STYLE.imageShuffle),
    ...(transition ? { transition } : {}),
    crossfadeSec: finiteNumber(raw.crossfadeSec, DEFAULT_AUTOMATION_STYLE.crossfadeSec, 0, 5),
    motionPreset: oneOf<MotionPreset>(raw.motionPreset, ['off', 'subtle', 'cinematic'], DEFAULT_AUTOMATION_STYLE.motionPreset),
    gradientEdge: oneOf(raw.gradientEdge, ['none', 'top', 'bottom', 'left', 'right'], DEFAULT_AUTOMATION_STYLE.gradientEdge),
    gradientIntensity: finiteNumber(raw.gradientIntensity, DEFAULT_AUTOMATION_STYLE.gradientIntensity, 0, 100),
    aspectRatio: oneOf(raw.aspectRatio ?? legacyAspect, ['16:9', '1:1', '9:16'], DEFAULT_AUTOMATION_STYLE.aspectRatio),
    hookText: typeof raw.hookText === 'string' ? raw.hookText.trim().slice(0, 200) : DEFAULT_AUTOMATION_STYLE.hookText,
    hookEnabled: typeof raw.hookEnabled === 'boolean' ? raw.hookEnabled : DEFAULT_AUTOMATION_STYLE.hookEnabled,
    // Legacy rows predate the field; the old behaviour derived the opening zoom from the style.
    zoomAtStart: typeof raw.zoomAtStart === 'boolean' ? raw.zoomAtStart : videoStyle !== 'None',
    hookTemplateId: templateId(raw.hookTemplateId),
    hookProps: templateProps(raw.hookProps),
    hookSeconds: finiteNumber(raw.hookSeconds, DEFAULT_AUTOMATION_STYLE.hookSeconds, 0, 30),
    captionTemplateId: templateId(raw.captionTemplateId),
    captionProps: templateProps(raw.captionProps),
    brollMode: oneOf(raw.brollMode, ['off', 'full', 'overlay'], legacy.rules?.autoBroll ? 'full' : DEFAULT_AUTOMATION_STYLE.brollMode),
    brollDensity: oneOf<BrollDensity>(raw.brollDensity, ['full', 'sparse', 'keywords'], DEFAULT_AUTOMATION_STYLE.brollDensity),
    brollPoolSize: Math.round(finiteNumber(raw.brollPoolSize, DEFAULT_AUTOMATION_STYLE.brollPoolSize, 1, 200)),
    ...(typeof raw.brollPoolKey === 'string' && raw.brollPoolKey.trim() ? { brollPoolKey: raw.brollPoolKey.trim().slice(0, 160) } : {}),
    brollFallbackPolicy: oneOf(raw.brollFallbackPolicy, ['selected-only', 'prefer-selected', 'all-sources'], DEFAULT_AUTOMATION_STYLE.brollFallbackPolicy),
    brollShufflePolicy: oneOf(raw.brollShufflePolicy, ['per-video', 'ranked'], DEFAULT_AUTOMATION_STYLE.brollShufflePolicy),
    ...(typeof raw.filterPresetId === 'string' && raw.filterPresetId.trim() ? { filterPresetId: raw.filterPresetId.trim().slice(0, 64) } : {}),
    ...(Array.isArray(raw.effectsPresetIds)
      ? { effectsPresetIds: [...new Set(raw.effectsPresetIds.filter((v): v is string => typeof v === 'string'))].slice(0, 20) }
      : {}),
    ...(typeof raw.transitionDurationFrames === 'number' && Number.isFinite(raw.transitionDurationFrames)
      ? { transitionDurationFrames: Math.round(finiteNumber(raw.transitionDurationFrames, 30, 0, 90)) }
      : {}),
    ...(raw.adjust && typeof raw.adjust === 'object' && !Array.isArray(raw.adjust) ? { adjust: normalizeAdjust(raw.adjust as Record<string, unknown>) } : {}),
    ...(raw.scrim && typeof raw.scrim === 'object' && !Array.isArray(raw.scrim) ? { scrim: normalizeScrim(raw.scrim as Record<string, unknown>) } : {}),
    ...(Array.isArray(raw.textOverlays) ? { textOverlays: normalizeTextOverlays(raw.textOverlays) } : {})
  }
}

function normalizeAdjust(value: Record<string, unknown>): import('./video-engine').VideoGrading {
  const out: Record<string, unknown> = { enabled: true }
  const ranges: Record<string, [number, number, number]> = {
    exposure: [0, -5, 5],
    contrast: [0, -1, 1],
    saturation: [1, 0, 2],
    temperature: [0, -1, 1],
    tint: [0, -1, 1],
    vignette: [0, 0, 1],
    grain: [0, 0, 1],
    lutIntensity: [1, 0, 1]
  }
  for (const k of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const v = (value as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      const [def, min, max] = ranges[k]!
      out[k] = finiteNumber(v, def, min, max)
    }
  }
  return out as import('./video-engine').VideoGrading
}

function normalizeScrim(value: Record<string, unknown>): { enabled: boolean; direction: 'bottom' | 'top' | 'left' | 'right'; size: number; opacity: number } {
  return {
    enabled: bool((value as Record<string, unknown>).enabled, false),
    direction: oneOf((value as Record<string, unknown>).direction as string, ['bottom', 'top', 'left', 'right'], 'bottom' as const),
    size: finiteNumber((value as Record<string, unknown>).size, 0.5, 0, 1),
    opacity: finiteNumber((value as Record<string, unknown>).opacity, 0.5, 0, 1)
  }
}

function normalizeTextOverlays(value: unknown[]): Array<{ id: string; text: string; preset: string; animation?: string; at: 'hook' | 'persistent' }> {
  const out: Array<{ id: string; text: string; preset: string; animation?: string; at: 'hook' | 'persistent' }> = []
  for (const entry of value.slice(0, 20)) {
    const r = record(entry)
    const id = typeof r.id === 'string' ? r.id.slice(0, 80) : `to-${Date.now()}`
    const text = typeof r.text === 'string' ? r.text.slice(0, 500) : ''
    const preset = typeof r.preset === 'string' ? r.preset.slice(0, 80) : 'display'
    const at = r.at === 'persistent' ? 'persistent' : 'hook'
    if (!text) continue
    out.push({ id, text, preset, ...(typeof r.animation === 'string' ? { animation: r.animation.slice(0, 80) } : {}), at })
  }
  return out
}

export function normalizeAutomationRules(value: unknown): AutomationRules {
  const raw = record(value)
  return {
    minDurationSec: finiteNumber(raw.minDurationSec, DEFAULT_AUTOMATION_RULES.minDurationSec, 0, 36_000),
    skipDownloaded: bool(raw.skipDownloaded, DEFAULT_AUTOMATION_RULES.skipDownloaded),
    continueOnError: bool(raw.continueOnError, DEFAULT_AUTOMATION_RULES.continueOnError),
    maxRetries: Math.round(finiteNumber(raw.maxRetries, DEFAULT_AUTOMATION_RULES.maxRetries, 0, 8)),
    minimumFreeSpaceGb: finiteNumber(raw.minimumFreeSpaceGb, DEFAULT_AUTOMATION_RULES.minimumFreeSpaceGb, 1, 100),
    captions: bool(raw.captions, DEFAULT_AUTOMATION_RULES.captions),
    autoBroll: bool(raw.autoBroll, DEFAULT_AUTOMATION_RULES.autoBroll),
    removeSilence: bool(raw.removeSilence, DEFAULT_AUTOMATION_RULES.removeSilence),
    reduceFillerWords: bool(raw.reduceFillerWords, DEFAULT_AUTOMATION_RULES.reduceFillerWords),
    keepAwake: bool(raw.keepAwake, DEFAULT_AUTOMATION_RULES.keepAwake),
    // Missing fields belong to a pre-feature persisted job: preserve its old no-skip,
    // no-pacing behavior. New drafts pass the explicit defaults above.
    skipUploaded: bool(raw.skipUploaded, false),
    fillSkippedSelections: bool(raw.fillSkippedSelections, DEFAULT_AUTOMATION_RULES.fillSkippedSelections),
    allowStaleUploadCache: bool(raw.allowStaleUploadCache, DEFAULT_AUTOMATION_RULES.allowStaleUploadCache),
    uploadFreshnessMinutes: Math.round(finiteNumber(raw.uploadFreshnessMinutes, DEFAULT_AUTOMATION_RULES.uploadFreshnessMinutes, 5, 43_200)),
    downloadDelaySec: finiteNumber(raw.downloadDelaySec, 0, 0, 600),
    retryBaseDelaySec: finiteNumber(raw.retryBaseDelaySec, DEFAULT_AUTOMATION_RULES.retryBaseDelaySec, 1, 120),
    retryMaxDelaySec: finiteNumber(raw.retryMaxDelaySec, DEFAULT_AUTOMATION_RULES.retryMaxDelaySec, 1, 300)
  }
}

export function normalizeAutomationConfig(config: Partial<AutomationJobConfig>): AutomationJobConfig {
  const styleConfig = normalizeAutomationStyle(config.styleConfig, config)
  const ratios = Array.isArray(config.aspectRatios) ? config.aspectRatios.filter((v): v is '16:9' | '1:1' | '9:16' => v === '16:9' || v === '1:1' || v === '9:16') : []
  return {
    sourceKind: config.sourceKind === 'youtube-url' || config.sourceKind === 'local-files' ? config.sourceKind : 'saved-source',
    sourceId: typeof config.sourceId === 'string' ? config.sourceId : '',
    sourceUrl: typeof config.sourceUrl === 'string' ? config.sourceUrl : '',
    sourceName: typeof config.sourceName === 'string' ? config.sourceName : '',
    sourceOrder: config.sourceOrder === 'Popular' || config.sourceOrder === 'Oldest' ? config.sourceOrder : 'Latest',
    sourceCount: Math.round(finiteNumber(config.sourceCount, 1, 1, 50)),
    selectedVideoIds: Array.isArray(config.selectedVideoIds) ? [...new Set(config.selectedVideoIds.filter((v): v is string => typeof v === 'string'))].slice(0, 50) : [],
    localMediaPaths: Array.isArray(config.localMediaPaths) ? [...new Set(config.localMediaPaths.filter((v): v is string => typeof v === 'string'))].slice(0, 50) : [],
    assetPaths: Array.isArray(config.assetPaths) ? [...new Set(config.assetPaths.filter((v): v is string => typeof v === 'string'))].slice(0, 200) : [],
    style: styleConfig.videoStyle,
    captionPreset: styleConfig.captionPreset,
    aspectRatios: ratios.length ? ratios : [styleConfig.aspectRatio],
    styleConfig,
    rules: normalizeAutomationRules(config.rules),
    notify: {
      desktop: bool(config.notify?.desktop, false),
      webhook: bool(config.notify?.webhook, false),
      sound: bool(config.notify?.sound, false),
      email: bool(config.notify?.email, false)
    },
    execution: 'local',
    ...(typeof config.scheduledFor === 'string' && config.scheduledFor ? { scheduledFor: config.scheduledFor } : {})
  }
}
