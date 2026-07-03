import type { AppSettings, MotionDirection, MotionPreset, Project, ProjectImage, TranscriptWord } from '../../../../shared/types'
import { projectVideoOpts } from '../../../../shared/types'
import type {
  CaptionFrameModel,
  CaptionGroupModel,
  GpuRenderSpec,
  ImageMotionSpec,
  RenderImageSpec
} from '../../../../shared/renderSpec'
import { groupWords, resolutionFor } from '../../captions'
import { gradeParamsForProject } from '../grade'
import { FPS, LONG_FORM_FAST_SEC, CAPTION_PHRASE_WORD_COUNT, gpuBitrateMbpsFor, GPU_KEY_INTERVAL_SEC } from '../render-config'
import type { BrollManifestSegment } from '../../broll'

// Pure builder that converts the existing project/images/transcript model into a
// serializable GpuRenderSpec for the WebCodecs render worker. Mirrors the decisions the
// ffmpeg path makes (dimensions, caption mode, grade per style, motion gating) so both
// engines produce comparable output. Kept dependency-free + Node-only-types so it is
// unit-testable without Electron.

/** Output dimensions for a quality + aspect, even numbers for the encoder. Mirrors
 *  render.ts dimensions() but kept here to avoid importing the ffmpeg module. */
export function gpuDimensions(quality: AppSettings['quality'], aspect: Project['captionAspect']): { w: number; h: number } {
  const base = quality === '720p' ? 720 : quality === '1440p' ? 1440 : 1080
  const res = resolutionFor(aspect)
  const factor = base / 1080
  const even = (n: number): number => Math.round((n * factor) / 2) * 2
  return { w: even(res.w), h: even(res.h) }
}

/** Mirror of queue.captionRenderMode (kept pure + local). */
export function gpuCaptionMode(project: Pick<Project, 'durationSec' | 'captionPace'>, wordCount: number): 'word' | 'phrase' {
  if (project.captionPace === 'word') return 'word'
  if (project.captionPace === 'phrase') return 'phrase'
  return project.durationSec >= LONG_FORM_FAST_SEC || wordCount >= CAPTION_PHRASE_WORD_COUNT ? 'phrase' : 'word'
}

/** Build the GPU caption model from transcript words (pure). Groups mirror the ffmpeg
 *  path's word grouping so timing is identical; the worker draws them on a canvas. */
export function buildCaptionModel(
  words: TranscriptWord[],
  project: Pick<Project, 'durationSec' | 'captionPace' | 'captionPreset' | 'captionFont' | 'captionAnim' | 'captionAspect' | 'captionLines' | 'captionPosition' | 'captionWordsPerPage'>,
  opts: { highlightColor: string; highlightBox?: CaptionFrameModel['highlightBox']; hook?: { text: string; untilSec: number } }
): CaptionFrameModel {
  const isSubmagic = project.captionPreset === 'Submagic'
  const mode = isSubmagic ? 'word' : gpuCaptionMode(project, words.length)
  const aspect = project.captionAspect
  const lines = isSubmagic ? 1 : (project.captionLines === 2 || project.captionLines === 3 ? project.captionLines : 1)
  const wordsPerLine = aspect === '9:16' ? 3 : aspect === '1:1' ? 3 : 4
  const isWordPreset = project.captionPreset === 'Word' && lines === 1
  const wordsPerPage = project.captionWordsPerPage === 2 || project.captionWordsPerPage === 3 ? project.captionWordsPerPage : 1
  const perGroup = isSubmagic ? wordsPerPage : isWordPreset ? 1 : Math.max(1, wordsPerLine * lines)
  const rawGroups = groupWords(words, perGroup)
  const groups: CaptionGroupModel[] = rawGroups.map((g) => ({
    startSec: g.start,
    endSec: Math.max(g.start + 0.3, g.end),
    words: g.words.map((w) => ({ text: w.word, startSec: w.start, endSec: w.end, emphasis: w.emphasis }))
  }))
  return {
    groups,
    preset: project.captionPreset,
    font: project.captionFont || 'Anton',
    animation: project.captionAnim || 'Pop-in',
    mode,
    position: project.captionPosition ?? 'bottom',
    lines,
    highlightColor: opts.highlightColor,
    highlightBox: opts.highlightBox,
    wordsPerPage: isSubmagic ? wordsPerPage : undefined,
    hook: opts.hook && opts.hook.text.trim() ? { text: opts.hook.text.trim(), untilSec: opts.hook.untilSec } : undefined
  }
}

export function effectiveMotionPreset(project: Pick<Project, 'kenBurns' | 'motionPreset'>, betaAutoStart = false): MotionPreset {
  if (project.motionPreset) return project.motionPreset
  return project.kenBurns || betaAutoStart ? 'subtle' : 'off'
}

function seededUnit(seed: number, index: number, salt: number): number {
  let x = (seed || 1) ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) / 0xffffffff
}

function motionAmountMultiplier(amount: number | null | undefined): number {
  if (amount == null) return 1
  const clamped = Math.max(0, Math.min(100, Number.isFinite(amount) ? amount : 50))
  return clamped / 50
}

export function imageMotionFor(
  index: number,
  seed: number,
  preset: MotionPreset,
  override?: { direction?: MotionDirection | null; amount?: number | null }
): ImageMotionSpec | undefined {
  if (preset === 'off') return undefined
  const multiplier = motionAmountMultiplier(override?.amount)
  const amount = (preset === 'cinematic' ? 0.18 : 0.08) * multiplier
  const panAmount = (preset === 'cinematic' ? 0.07 : 0.035) * multiplier
  const direction = override?.direction && override.direction !== 'auto' ? override.direction : undefined
  const sidePan = direction === 'left' || direction === 'right' || direction === 'up' || direction === 'down'
  const push = sidePan ? false : direction === 'push' ? true : direction === 'pull' ? false : index % 2 === 0
  const xSign = seededUnit(seed, index, 0) > 0.5 ? 1 : -1
  const ySign = seededUnit(seed, index, 1) > 0.5 ? 1 : -1
  const panX = direction === 'left' ? -panAmount : direction === 'right' ? panAmount : direction === 'up' || direction === 'down' ? 0 : xSign * panAmount * (0.55 + seededUnit(seed, index, 2) * 0.45)
  const panY = direction === 'up' ? -panAmount : direction === 'down' ? panAmount : direction === 'left' || direction === 'right' ? 0 : ySign * panAmount * (0.55 + seededUnit(seed, index, 3) * 0.45)
  return {
    zoomFrom: push || sidePan ? 1 : 1 + amount,
    zoomTo: push ? 1 + amount : sidePan ? 1 + amount * 0.5 : 1,
    panX,
    panY,
    ease: 'easeInOutCubic'
  }
}

/** Slideshow image windows (pure). Empty list → one full-duration solid frame slot. */
export function buildImageSpecs(images: ProjectImage[], durationSec: number, motion?: { preset: MotionPreset; seed: number }): RenderImageSpec[] {
  if (!images.length) return []
  return images.map((im) => {
    const out: RenderImageSpec = {
      path: im.path,
      startSec: Math.max(0, im.rangeStart),
      endSec: Math.max(im.rangeStart + 0.5, im.rangeEnd)
    }
    const preset = im.motionPreset ?? motion?.preset
    const smartMotion = preset ? imageMotionFor(im.ord, motion?.seed ?? 1, preset, { direction: im.motionDirection, amount: im.motionAmount }) : undefined
    if (smartMotion) out.motion = smartMotion
    return out
  })
}

export interface GpuSpecInputs {
  project: Project
  images: ProjectImage[]
  words: TranscriptWord[]
  settings: AppSettings
  /** times (sec) where an emphasized word fires a punch-zoom (from buildAss zoomHits) */
  zoomHits: number[]
  /** optional darkening overlay PNG/PAM path (matches the ffmpeg overlay) */
  overlayPath?: string
  /** mastered/normalized narration audio path (or the raw mp3) */
  voicePath: string
  /** optional transition SFX track */
  sfxPath?: string
  /** intro hook text (already resolved by the queue), '' = no hook */
  hookText?: string
  out: { h264Path: string; finalPath: string }
  brollSegments?: BrollManifestSegment[]
}

/**
 * Build a complete GpuRenderSpec from the project model (pure). The queue calls this,
 * hands the result to the GPU host, and on ANY failure falls back to the ffmpeg path.
 */
export function buildGpuRenderSpec(inp: GpuSpecInputs): GpuRenderSpec {
  const { project, settings } = inp
  const beta = projectVideoOpts(project)
  const { w, h } = gpuDimensions(settings.quality, project.captionAspect)
  const longForm = project.durationSec >= LONG_FORM_FAST_SEC
  const { grade, grain } = gradeParamsForProject(beta.style, project)

  // Motion mirrors render.ts gating: Ken Burns / punch zoom are disabled on long-form.
  const motionPreset = longForm ? 'off' : effectiveMotionPreset(project, beta.autoZoom.atStart)
  const kenBurns = motionPreset !== 'off'
  const punchEnabled = motionPreset !== 'off' && (project.punchZoom || beta.autoZoom.atKeyPhrases)
  const punchAtSec = punchEnabled
    ? [...new Set([...inp.zoomHits, ...inp.words.filter((w) => w.emphasis).map((w) => w.start)])].sort((a, b) => a - b)
    : []

  const captions = buildCaptionModel(inp.words, project, {
    highlightColor: project.captionHighlightColor ?? (project.captionPreset === 'Submagic' ? '#111111' : '#ffd93d'),
    highlightBox: project.captionPreset === 'Submagic'
      ? {
          enabled: true,
          boxColor: project.captionBoxColor ?? '#ffd93d',
          textColor: project.captionHighlightColor ?? '#111111',
          radius: 14,
          padding: 12
        }
      : undefined,
    hook: inp.hookText ? { text: inp.hookText, untilSec: 2.6 } : undefined
  })

  return {
    jobId: project.id,
    width: w,
    height: h,
    fps: FPS,
    durationSec: project.durationSec,
    images: buildImageSpecs(inp.images, project.durationSec, { preset: motionPreset, seed: project.seed }),
    broll: inp.brollSegments?.map((s) => ({
      path: s.normalizedPath,
      startSec: s.start,
      endSec: s.end
    })),
    motion: { kenBurns, punchAtSec },
    grade,
    grain,
    overlayPath: inp.overlayPath,
    captions,
    audio: { voicePath: inp.voicePath, sfxPath: inp.sfxPath },
    encoder: { codec: 'avc', bitrateMbps: gpuBitrateMbpsFor(settings.quality), keyIntervalSec: GPU_KEY_INTERVAL_SEC },
    out: inp.out
  }
}
