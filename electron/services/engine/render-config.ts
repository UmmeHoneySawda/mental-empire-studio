import type { AppSettings } from '../../../shared/types'

// Central render tunables. Previously these literals were scattered across render.ts
// and queue.ts (the CRF ladder alone was duplicated four times), making them easy to
// change inconsistently. Values are unchanged from the originals.

/** Output frame rate for all renders. */
export const FPS = 24

/** At/above this duration (seconds) the long-form fast path kicks in: concat instead
 *  of xfade, Ken Burns off, and steady phrase captions. */
export const LONG_FORM_FAST_SEC = 600

/** Auto caption mode switches from per-word to steady phrases past either threshold. */
export const CAPTION_PHRASE_WORD_COUNT = 1500

/** B-roll segment ceiling — fewer on long videos to keep the filtergraph manageable. */
export const BROLL_MAX_SEGMENTS_DEFAULT = 48
export const BROLL_MAX_SEGMENTS_LONG = 36

/** Constant-quality target (CRF for CPU / CQ for GPU) per output quality. */
export function crfFor(quality: AppSettings['quality']): string {
  return quality === '1440p' ? '20' : quality === '720p' ? '23' : '21'
}
