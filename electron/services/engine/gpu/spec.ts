import type { AppSettings, Project, ProjectImage, TranscriptWord } from '../../../../shared/types'
import { asBetaOpts } from '../../../../shared/types'
import type {
  CaptionFrameModel,
  CaptionGroupModel,
  GpuRenderSpec,
  RenderImageSpec
} from '../../../../shared/renderSpec'
import { groupWords, resolutionFor } from '../../captions'
import { gradeParams } from '../grade'
import { FPS, LONG_FORM_FAST_SEC, CAPTION_PHRASE_WORD_COUNT, gpuBitrateMbpsFor, GPU_KEY_INTERVAL_SEC } from '../render-config'

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
  project: Pick<Project, 'durationSec' | 'captionPace' | 'captionPreset' | 'captionFont' | 'captionAnim' | 'captionAspect' | 'captionLines' | 'captionPosition'>,
  opts: { highlightColor: string; hook?: { text: string; untilSec: number } }
): CaptionFrameModel {
  const mode = gpuCaptionMode(project, words.length)
  const aspect = project.captionAspect
  const lines = (project.captionLines === 2 || project.captionLines === 3 ? project.captionLines : 1)
  const wordsPerLine = aspect === '9:16' ? 3 : aspect === '1:1' ? 3 : 4
  const isWordPreset = project.captionPreset === 'Word' && lines === 1
  const perGroup = isWordPreset ? 1 : Math.max(1, wordsPerLine * lines)
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
    hook: opts.hook && opts.hook.text.trim() ? { text: opts.hook.text.trim(), untilSec: opts.hook.untilSec } : undefined
  }
}

/** Slideshow image windows (pure). Empty list → one full-duration solid frame slot. */
export function buildImageSpecs(images: ProjectImage[], durationSec: number): RenderImageSpec[] {
  if (!images.length) return []
  return images.map((im) => ({
    path: im.path,
    startSec: Math.max(0, im.rangeStart),
    endSec: Math.max(im.rangeStart + 0.5, im.rangeEnd)
  }))
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
}

/**
 * Build a complete GpuRenderSpec from the project model (pure). The queue calls this,
 * hands the result to the GPU host, and on ANY failure falls back to the ffmpeg path.
 */
export function buildGpuRenderSpec(inp: GpuSpecInputs): GpuRenderSpec {
  const { project, settings } = inp
  const beta = settings.beta?.enabled ? asBetaOpts(project.betaOpts) : null
  const { w, h } = gpuDimensions(settings.quality, project.captionAspect)
  const longForm = project.durationSec >= LONG_FORM_FAST_SEC
  const { grade, grain } = gradeParams(beta?.style)

  // Motion mirrors render.ts gating: Ken Burns / punch zoom are disabled on long-form.
  const kenBurns = !longForm && (project.kenBurns || !!beta?.autoZoom.atStart)
  const punchEnabled = !longForm && (project.punchZoom || !!beta?.autoZoom.atKeyPhrases)

  const captions = buildCaptionModel(inp.words, project, {
    highlightColor: '#ffd93d',
    hook: inp.hookText ? { text: inp.hookText, untilSec: 2.6 } : undefined
  })

  return {
    jobId: project.id,
    width: w,
    height: h,
    fps: FPS,
    durationSec: project.durationSec,
    images: buildImageSpecs(inp.images, project.durationSec),
    motion: { kenBurns, punchAtSec: punchEnabled ? [...inp.zoomHits] : [] },
    grade,
    grain,
    overlayPath: inp.overlayPath,
    captions,
    audio: { voicePath: inp.voicePath, sfxPath: inp.sfxPath },
    encoder: { codec: 'avc', bitrateMbps: gpuBitrateMbpsFor(settings.quality), keyIntervalSec: GPU_KEY_INTERVAL_SEC },
    out: inp.out
  }
}
