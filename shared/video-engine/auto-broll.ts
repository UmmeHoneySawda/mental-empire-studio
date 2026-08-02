import { z } from 'zod'
import { assertDataOnlyAiPayload, parseJsonInput } from './common'
import type { VideoBrollCandidate } from './ipc'
import type { VideoAsset } from './model'

/* Auto B-roll — the shapes that cross the bridge.
 *
 * One button reads the whole timestamped transcript, asks Groq for timestamped visual
 * moments, searches every enabled provider through the existing `BrollService`, and hands
 * the renderer a list of ready-to-insert clips. The main process deliberately returns
 * DATA, not a saved project: the editor's one architectural rule is that an edit is a
 * local synchronous transform (see skills/video-studio-editor/SKILL.md), and that is also
 * what makes the whole run a single undo entry.
 *
 * The candidate shape is the one already crossing the bridge (`VideoBrollCandidate`).
 * Nothing here invents a parallel media shape. */

export const AUTO_BROLL_SCHEMA_VERSION = 1 as const

/** The lane generated footage lands on.
 *
 *  A distinct id from the manual `video-engine-broll` track so a run can never disturb
 *  clips the user placed by hand, and a distinctly higher `order` because the Remotion
 *  scene layer is `trackOrder × 100_000 + zIndex` — the manual track sits at `order: 0`,
 *  the same as `main-video`, which leaves its layering resting entirely on `zIndex`. */
export const AUTO_BROLL_TRACK_ID = 'auto-broll'
export const AUTO_BROLL_TRACK_NAME = 'Auto B-roll'
export const AUTO_BROLL_TRACK_ORDER = 10

export const AutoBrollCategorySchema = z.enum([
  'emotion',
  'activity',
  'location',
  'object',
  'event',
])
export type AutoBrollCategory = z.infer<typeof AutoBrollCategorySchema>

/**
 * Seconds, however the model chose to write them.
 *
 * The prompt asks for a plain number, but a model that has just been shown `[04:20]`
 * transcript stamps will sometimes answer in the same notation. Accepting `"4:20"` and
 * `"12.5s"` costs four lines here and saves a whole repair round trip — and a repair round
 * that fails takes two minutes of a 22-minute video down with it.
 */
const SecondsSchema = z.preprocess((value) => {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return value
  const text = value.trim().replace(/\s*(?:s|sec|secs|seconds)$/iu, '')
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text)
  const clock = /^(?:(\d+):)?(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/u.exec(text)
  if (!clock) return value
  return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
}, z.number().finite().nonnegative().max(86_400))

/**
 * One moment the model wants covered.
 *
 * Deliberately NOT a `strictObject`, unlike the hook plan. A hook plan is one call for one
 * video, so bouncing an answer that carries a stray field costs a retry. Auto B-roll is
 * one call per two minutes of narration and a rejected answer is a hole in the coverage,
 * so unknown keys are ignored and the soft fields fall back rather than fail. Every value
 * that matters is clamped again by `normalizeMoments` — the model is never trusted with
 * arithmetic.
 */
export const AutoBrollMomentSchema = z.object({
  startSec: SecondsSchema,
  endSec: SecondsSchema,
  /** The transcript excerpt the moment refers to. Shown in the panel, never searched. */
  text: z.string().trim().max(1000).default(''),
  /** The stock-footage search query — 3-8 concrete, filmable words. */
  query: z.string().trim().min(2).max(200),
  category: AutoBrollCategorySchema.catch('activity'),
  reason: z.string().trim().max(300).default(''),
})
export type AutoBrollMoment = z.infer<typeof AutoBrollMomentSchema>

export const AutoBrollAnswerSchema = z.object({
  moments: z.array(AutoBrollMomentSchema).max(64),
})
export type AutoBrollAnswer = z.infer<typeof AutoBrollAnswerSchema>

/** Accepts the answer under a differently-named array as well as `moments`, because
 *  `response_format: json_object` pins the container to an object but not its key. */
function withMomentsKey(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = payload as Record<string, unknown>
  if (Array.isArray(record['moments'])) return payload
  const arrays = Object.values(record).filter(Array.isArray)
  return arrays.length === 1 ? { ...record, moments: arrays[0] } : payload
}

export function safeParseAutoBrollAnswer(
  input: string | unknown,
): z.ZodSafeParseResult<AutoBrollAnswer> {
  try {
    const payload = parseJsonInput(input)
    assertDataOnlyAiPayload(payload)
    return AutoBrollAnswerSchema.safeParse(withMomentsKey(payload))
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : String(error),
        },
      ]) as z.ZodError<AutoBrollAnswer>,
    }
  }
}

// ------------------------------------------------------------------------ options

export type AutoBrollDensity = 'sparse' | 'balanced' | 'dense'

/** Moments per minute of narration. A 22-minute video is 11 / 22 / 33 clips. */
export const AUTO_BROLL_DENSITY_PER_MINUTE: Readonly<Record<AutoBrollDensity, number>> =
  Object.freeze({ sparse: 0.5, balanced: 1, dense: 1.5 })

export interface AutoBrollOptions {
  density: AutoBrollDensity
  /** Shortest generated clip, seconds. */
  minClipSeconds: number
  /** Longest generated clip, seconds. */
  maxClipSeconds: number
  orientation: 'landscape' | 'portrait' | 'any'
  /** Defaults to every registered provider — one query plan, all of them. */
  providers?: string[]
  /** Restrict the run to a stretch of the timeline. Defaults to the whole thing. */
  startSec?: number
  endSec?: number
}

export const AUTO_BROLL_DEFAULT_OPTIONS: Readonly<AutoBrollOptions> = Object.freeze({
  density: 'balanced',
  minClipSeconds: 3,
  maxClipSeconds: 6,
  orientation: 'landscape',
})

/** Seconds of narration per Groq call. Small enough that prompt and answer stay far
 *  inside the model's limits, large enough that a 22-minute video is 11 calls. */
export const AUTO_BROLL_WINDOW_SECONDS = 120

/** Minimum silence between two generated clips, so a dense stretch of narration cannot
 *  produce a strobe of two-second cutaways. */
export const AUTO_BROLL_MIN_GAP_SECONDS = 8

// ------------------------------------------------------------------------ results

export interface ScoredBrollCandidate {
  candidate: VideoBrollCandidate
  score: number
  /** 'duration-fit' | 'resolution' | 'tag-match' | … — shown in the panel and asserted
   *  in tests, so the ranking is explainable rather than a bare number. */
  reasons: string[]
}

/** One clip, downloaded and ready for the renderer to splice in. */
export interface AutoBrollPlacement {
  moment: AutoBrollMoment
  candidate: VideoBrollCandidate
  /** Built main-side by `brollAssetForProject`, so licence metadata is mapped once. */
  asset: VideoAsset
  startFrame: number
  durationFrames: number
  sourceRange?: { startFrame: number; durationFrames: number }
  score: number
}

export type AutoBrollSkipReason =
  | 'no-results'
  | 'download-failed'
  | 'duplicate'
  | 'model-invalid'
  /** The model's quota, not the model's answer. Worth its own reason: "unusable query"
   *  sends the user off rewriting a transcript when the fix is to wait and press again. */
  | 'rate-limited'
  | 'too-short'
  | 'occupied'

/** Why a moment produced nothing.
 *
 *  Not optional polish: with several providers behind one search, silence has to be
 *  distinguishable from "your API key is wrong" — the same reasoning that gave
 *  `fetchBrollBatch` its `emptyKeywords`. */
export interface AutoBrollSkip {
  startSec: number
  query: string
  reason: AutoBrollSkipReason
  detail?: string
}

export interface AutoBrollStats {
  chunks: number
  /** Windows whose model answer never validated. The rest of the video still ran. */
  chunksFailed: number
  moments: number
  searched: number
  providerFailures: number
  elapsedMs: number
}

export interface AutoBrollResult {
  /** Durable run identity. Absent only in pure planner results and legacy callers. */
  jobId?: string
  placements: AutoBrollPlacement[]
  skipped: AutoBrollSkip[]
  stats: AutoBrollStats
}

/** Streamed while a run is in flight. A 22-minute video is eleven model calls and up to
 *  twenty-five downloads; a static label on that reads as a hang. */
export interface AutoBrollProgress {
  projectId: string
  phase: 'reading' | 'searching' | 'downloading' | 'done' | 'error'
  message: string
}
