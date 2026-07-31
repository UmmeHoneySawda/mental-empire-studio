/* Timeline geometry. Ported from trykimu/videoeditor's `types.ts` constants, with one
 * deliberate departure: kimu stores clip `left`/`width` in ZOOMED PIXELS, so every zoom
 * change has to rewrite every clip and repeated zoom in/out drifts on float error. Here
 * frames stay the only stored unit and pixels are derived per render — `framesToPx` below
 * is the single conversion. */

/** Pixels one second of timeline occupies at zoom 1. kimu's value. */
export const PIXELS_PER_SECOND = 100

/** Height of one track lane, excluding its keyframe lanes. */
export const TRACK_HEIGHT = 52

/** The sticky ruler strip above the lanes. */
export const RULER_HEIGHT = 40

/** The fixed left column holding track names, mute and lock. */
export const TRACK_LABEL_WIDTH = 200

/** Gap between lanes, so adjacent clips on different tracks stay legible. */
export const TRACK_GAP = 4

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4
export const DEFAULT_ZOOM = 1

/** Zoom steps the +/- buttons walk through, so clicking zoom is predictable rather
 *  than multiplying by 1.5 forever. */
export const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const

/** A clip narrower than this is unclickable, so trimming clamps here rather than
 *  letting a drag produce a zero-width clip. */
export const MIN_CLIP_FRAMES = 2

/** Distance in SCREEN pixels within which a dragged edge snaps. Screen-space, not
 *  frames, so it feels the same at every zoom level. */
export const SNAP_PX = 8

/** Width of a clip's grab handle. Big enough to hit, small enough not to eat the body
 *  of a short clip. */
export const CLIP_HANDLE_PX = 8

/** Trailing debounce before an edit is persisted through the engine's IPC. A drag
 *  commits once on release; this only covers rapid typed edits (a headline, a slider). */
export const SAVE_DEBOUNCE_MS = 450

/** How often playback writes the playhead into the store. The Player reports every
 *  frame; at 60fps that re-rendered the whole editor sixty times a second just to move
 *  a marker. Ten a second still reads as smooth. */
export const PLAYHEAD_THROTTLE_MS = 100

/** Converts frames to timeline pixels at a zoom level. */
export function framesToPx(frames: number, fps: number, zoom: number): number {
  return (frames / Math.max(1, fps)) * PIXELS_PER_SECOND * zoom
}

/** Converts timeline pixels back to whole frames. */
export function pxToFrames(px: number, fps: number, zoom: number): number {
  return Math.round((px / (PIXELS_PER_SECOND * zoom)) * Math.max(1, fps))
}

/** Ruler tick spacing in seconds, chosen so labels never collide at any zoom. */
export function tickSeconds(zoom: number): { major: number; minor: number } {
  const pxPerSecond = PIXELS_PER_SECOND * zoom
  if (pxPerSecond >= 200) return { major: 1, minor: 0.25 }
  if (pxPerSecond >= 100) return { major: 1, minor: 0.5 }
  if (pxPerSecond >= 50) return { major: 5, minor: 1 }
  if (pxPerSecond >= 25) return { major: 10, minor: 2 }
  return { major: 30, minor: 5 }
}

/** `m:ss` plus frames, matching the readout the old studio used. */
export function timecode(frame: number, fps: number): string {
  const safeFps = Math.max(1, fps)
  const total = Math.max(0, frame) / safeFps
  const minutes = Math.floor(total / 60)
  const seconds = Math.floor(total % 60)
  const frames = Math.round(Math.max(0, frame) % safeFps)
  return `${minutes}:${String(seconds).padStart(2, '0')}·${String(frames).padStart(2, '0')}`
}
