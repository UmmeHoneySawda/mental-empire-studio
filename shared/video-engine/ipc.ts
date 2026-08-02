/* Renderer-facing contract for the Remotion / HyperFrames video engine.
 *
 * `electron/services/video-engine/*` owns the implementation and keeps its own
 * node-only types. Everything the Compose studio UI touches is re-declared here as
 * plain, structurally-compatible data so the renderer never imports from
 * `electron/` and every payload stays JSON-serializable across the IPC bridge. */

import type { JsonObject, RendererId } from './common'
import type { CaptionCue, CaptionWord } from './captions'
import type { VideoGrading } from './grading'
import type { HookPlan } from './hook-plan'
import type { VideoAsset, VideoProject } from './model'
import type {
  TemplateAspectRatio,
  TemplateCapability,
  TemplateKind,
  TemplateManifest,
} from './templates'
import type { TransitionDirection, TransitionEasing } from './transitions'

/** Which editor the Compose screen is driving. `classic` is the original
 *  ffmpeg/WebCodecs pipeline; the other two are the template engines. */
export type ComposeEngine = 'classic' | RendererId

export const COMPOSE_ENGINES: readonly ComposeEngine[] = ['classic', 'remotion', 'hyperframes']

export function isRendererEngine(engine: ComposeEngine): engine is RendererId {
  return engine === 'remotion' || engine === 'hyperframes'
}

// ---------------------------------------------------------------- engine state

export interface VideoEngineRendererStatus {
  rendererId: RendererId
  /** false when the renderer's runtime (bundle, browser, binaries) is missing */
  available: boolean
  detail?: string
  capabilities?: VideoRendererCapabilities
}

export interface VideoEngineStatus {
  ready: boolean
  /** populated when the engine could not start at all */
  error?: string
  dataRoot: string
  nodeVersion: string
  renderers: VideoEngineRendererStatus[]
  /** provider ids currently registered (`local-1`, `pexels`, …) */
  brollProviders: string[]
  /** provider ids that need an API key before they can be enabled */
  brollMissingCredentials: string[]
  ffmpegPath: string
  ffprobePath: string
}

export interface VideoRendererCapabilities {
  rendererId: RendererId
  maxWidth: number
  maxHeight: number
  supportedFps: number[]
  supportsAudio: boolean
  supportsVideo: boolean
  supportsImages: boolean
  supportsCaptions: boolean
  supportsLuts: boolean
  transitions: string[]
}

// ------------------------------------------------------------------- templates

export interface VideoTemplateFilter {
  rendererId?: RendererId
  kind?: TemplateKind
  aspectRatio?: TemplateAspectRatio
  capabilities?: TemplateCapability[]
}

export type VideoTemplate = TemplateManifest

export interface InstantiateVideoTemplateInput {
  templateId: string
  templateVersion?: string
  instanceId?: string
  trackId?: string
  startFrame: number
  durationFrames?: number
  zIndex?: number
  props?: JsonObject
}

// -------------------------------------------------------------------- projects

export interface CreateVideoProjectInput {
  name: string
  rendererId: RendererId
  width: number
  height: number
  fps: number
  durationFrames: number
}

/** Links a classic Compose project (a downloaded clip) to its per-renderer
 *  engine project so switching the engine toggle reopens the same edit. */
export interface VideoStudioBinding {
  downloadId: string
  remotionProjectId?: string
  hyperframesProjectId?: string
}

export interface VideoCanvasPatch {
  width?: number
  height?: number
  fps?: number
  durationFrames?: number
  backgroundColor?: string
}

export type VideoAspectPreset = '16:9' | '9:16' | '1:1' | '4:5'

export interface VideoScenePatch {
  startFrame?: number
  durationFrames?: number
  zIndex?: number
  trackId?: string
  text?: string
  color?: string
  fit?: 'cover' | 'contain' | 'fill'
  opacity?: number
  volume?: number
  templateProps?: JsonObject
}

export interface AddVideoScenePatch {
  kind: 'media' | 'audio' | 'text' | 'solid'
  trackId?: string
  assetId?: string
  startFrame: number
  durationFrames: number
  zIndex?: number
  text?: string
  color?: string
  fit?: 'cover' | 'contain' | 'fill'
  opacity?: number
  volume?: number
}

/** One saved b-roll fetch: the keywords that produced it and the clips it brought in. */
export interface BrollBatch {
  id: string
  name: string
  createdAt: string
  keywords: string[]
  clips: Array<{
    keyword: string
    provider: string
    title: string
    /** Project asset the clip was imported as, when the import succeeded. */
    assetId?: string
    path: string
  }>
  /** Keywords that returned nothing, so the UI can say so instead of silently dropping them. */
  emptyKeywords: string[]
}

export interface FetchBrollBatchInput {
  /** JSON the model returned: { "batchName": "...", "keywords": ["a", "b"] }. */
  response: string
  /** Clips to download per keyword. */
  perKeyword?: number
}

export interface FetchBrollBatchResult {
  project: VideoProject
  batch: BrollBatch
}

/** Spread chosen media over the empty parts of the timeline. See shared/video-engine/fill.ts. */
export interface FillWithMediaInput {
  assetIds: string[]
  /** 'fill' gives each asset one long slot; 'cycle' chops the gaps into short segments. */
  mode: 'fill' | 'cycle'
  /** Segment length for 'cycle', in seconds. Ignored by 'fill'. */
  segmentSeconds?: number
  /** Rotate in a shuffled order instead of the order the assets were picked. */
  shuffle?: boolean
  /** Visual track to fill. Defaults to the project's main video track. */
  trackId?: string
  /** Drop the track's existing clips first and cover the whole timeline. */
  replaceExisting?: boolean
  fit?: 'cover' | 'contain' | 'fill'
}

export interface FillWithMediaResult {
  project: VideoProject
  /** How many clips were created — the studio reports this back to the user. */
  placed: number
  /** Frames of timeline that were empty and are now covered. */
  coveredFrames: number
}

// ---------------------------------------------------------------------- assets

export type VideoAssetKind = VideoAsset['kind']

export interface ImportedVideoAssets {
  project: VideoProject
  /** paths that could not be imported, with the reason */
  skipped: Array<{ path: string; reason: string }>
}

// -------------------------------------------------------------------- captions

export interface SetVideoCaptionsInput {
  language?: string
  templateId?: string
  templateProps?: JsonObject
  words: CaptionWord[]
}

export interface SetVideoCaptionsFromSrtInput {
  srt: string
  language?: string
  templateId?: string
  templateProps?: JsonObject
}

export interface CaptionImportSummary {
  project: VideoProject
  wordCount: number
  /** words dropped because they fell outside the canvas duration */
  droppedCount: number
}

export interface ImportantWordsPromptInput {
  purpose?: string
  maximumSelectionRatio?: number
}

export interface CaptionCueList {
  cues: CaptionCue[]
  words: CaptionWord[]
  transcriptHash: string
}

// ----------------------------------------------------------------- hook plans

export interface HookPromptInput {
  templateId: string
  templateVersion?: string
  title: string
  durationSeconds?: number
  transcript?: string
}

export interface ImportedHookPlan {
  project: VideoProject
  plan: HookPlan
  brollRequests: Array<{
    beatId: string
    query: string
    startFrame: number
    durationFrames: number
  }>
}

// ---------------------------------------------------------------- transitions

export interface ApplyVideoTransitionInput {
  templateId: string
  templateVersion?: string
  id?: string
  fromSceneId: string
  toSceneId: string
  /** Optional. For an animated transition the engine derives this from the overlap it
   *  creates between the two clips, so a caller does not have to do frame arithmetic —
   *  getting it wrong was what made every crossfade fail preflight. Only `cut` uses the
   *  supplied value. */
  startFrame?: number
  durationFrames?: number
  direction?: TransitionDirection
  easing?: TransitionEasing
}

// -------------------------------------------------------------------- grading

export interface VideoGradingPreset {
  id: string
  name: string
  description: string
  grading: Omit<VideoGrading, 'lutAssetId'>
}

// ---------------------------------------------------------------------- b-roll

export interface VideoBrollLicense {
  name: string
  url: string
  attributionRequired: boolean
  commercialUseAllowed: boolean
  attribution?: string
  restrictions?: string[]
}

export interface VideoBrollCandidate {
  id: string
  provider: string
  title: string
  description?: string
  sourceUrl: string
  downloadUrl: string
  previewUrl?: string
  thumbnailUrl?: string
  width: number
  height: number
  durationMs?: number
  author?: string
  license: VideoBrollLicense
  tags: string[]
}

export interface VideoCachedBroll {
  id: string
  provider: string
  absolutePath: string
  sha256: string
  bytes: number
  sourceUrl: string
  cachedAt: string
  license: VideoBrollLicense
}

export interface VideoBrollSearchInput {
  query: string
  providers?: string[]
  page?: number
  perPage?: number
  orientation?: 'landscape' | 'portrait' | 'square' | 'any'
  minWidth?: number
  minHeight?: number
  minDurationMs?: number
  maxDurationMs?: number
  safeSearch?: boolean
}

export interface PlaceVideoBrollInput {
  candidate: VideoBrollCandidate
  /** Populated by the main process — the renderer never downloads footage itself. */
  cached?: VideoCachedBroll
  trackId?: string
  startFrame: number
  durationFrames: number
  zIndex?: number
}

// --------------------------------------------------------------------- render

export type VideoRenderJobStage =
  | 'queued'
  | 'preflighting'
  | 'preparing'
  | 'rendering'
  | 'grading'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface VideoRenderProblem {
  severity: 'error' | 'warning'
  code: string
  message: string
  path?: string
}

export interface VideoRenderArtifact {
  rendererId: RendererId
  path: string
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime'
  durationFrames: number
  width: number
  height: number
}

/** `RenderJobRecord` minus the full project snapshot, which is far too heavy to
 *  push over IPC on every progress tick. */
export interface VideoRenderJob {
  id: string
  projectId: string
  projectName: string
  projectRevision: number
  rendererId: RendererId
  outputPath: string
  stage: VideoRenderJobStage
  progress: number
  attempt: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  errorCode?: string
  errorMessage?: string
  artifact?: VideoRenderArtifact
  canvas: {
    width: number
    height: number
    fps: number
    durationFrames: number
  }
}

// -------------------------------------------------------------------- preview

/** A Remotion preview runs the real composition inside `@remotion/player`, so the
 *  renderer only needs the project with its asset URIs rewritten to the app's
 *  `mestudio://` protocol (`file:` is not reachable under the renderer CSP). */
export interface RemotionPreviewPayload {
  kind: 'remotion'
  /** Project revision this payload was compiled from. The studio compares it against the
   *  live project to know whether what is on screen is still current, and keys the player
   *  on it so a rebuild genuinely remounts. */
  revision: number
  project: VideoProject
  durationInFrames: number
}

/** A HyperFrames preview is the real compiled composition, staged on disk with its
 *  vendored GSAP/fonts and served through `mestudio://` for `<hyperframes-player>`. */
export interface HyperframesPreviewPayload {
  kind: 'hyperframes'
  /** See RemotionPreviewPayload.revision. */
  revision: number
  /** Stamped per stage, so a rebuild yields a URL the iframe actually navigates to. */
  url: string
  width: number
  height: number
  fps: number
  durationFrames: number
  warnings: string[]
}

export type VideoPreviewPayload = RemotionPreviewPayload | HyperframesPreviewPayload

// ------------------------------------------------------------- studio bring-up

/** Everything the studio needs for one engine + one clip in a single round trip. */
export interface VideoStudioSnapshot {
  status: VideoEngineStatus
  binding: VideoStudioBinding
  project: VideoProject | null
  templates: VideoTemplate[]
  jobs: VideoRenderJob[]
  gradingPresets: VideoGradingPreset[]
}
