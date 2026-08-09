/* Timeline geometry. Ported from trykimu/videoeditor's `types.ts` constants, with one
 * deliberate departure: kimu stores clip `left`/`width` in ZOOMED PIXELS, so every zoom
 * change has to rewrite every clip and repeated zoom in/out drifts on float error. Here
 * frames stay the only stored unit and pixels are derived per render — `framesToPx` below
 * is the single conversion. */

/** Pixels one second of timeline occupies at zoom 1. kimu's value. */
export const PIXELS_PER_SECOND = 100

/** Height of one track lane, excluding its keyframe lanes. */
export const TRACK_HEIGHT = 43

/** The sticky ruler strip above the lanes. */
export const RULER_HEIGHT = 28

/** The fixed left column holding track names, mute and lock. */
export const TRACK_LABEL_WIDTH = 166

/** Gap between lanes, so adjacent clips on different tracks stay legible. */
export const TRACK_GAP = 0

export const MIN_ZOOM = 0.001
export const MAX_ZOOM = 4
export const DEFAULT_ZOOM = 1

/** Zoom steps the +/- buttons walk through, so clicking zoom is predictable rather
 *  than multiplying by 1.5 forever. */
export const ZOOM_STEPS = [
  0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.15,
  0.25, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4
] as const

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

/** Zoom that shows the complete project inside the available lane width. */
export function fitTimelineZoom(frames: number, fps: number, viewportWidth: number): number {
  const widthAtOne = framesToPx(Math.max(1, frames), fps, 1)
  const usableWidth = Math.max(1, viewportWidth - 24)
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, usableWidth / widthAtOne))
}

export function zoomLabel(zoom: number): string {
  const decimals = zoom < 0.01 ? 4 : zoom < 0.1 ? 3 : 2
  return `${Number(zoom.toFixed(decimals))}×`
}

/** Converts timeline pixels back to whole frames. */
export function pxToFrames(px: number, fps: number, zoom: number): number {
  return Math.round((px / (PIXELS_PER_SECOND * zoom)) * Math.max(1, fps))
}

/** The on-screen width of a clip of `durationFrames`.
 *
 * ONE definition, used both by the render and by the code that hands geometry back after a
 * gesture. It has to be one definition: a drag writes `style.width` straight to the DOM,
 * and React does not know that happened. If the gesture then cleared the width — or
 * restored a value computed slightly differently — React's style diff would compare its own
 * unchanged previous value against its own unchanged next value, skip the write, and leave
 * the DOM with whatever the gesture left behind. That is exactly how every dragged clip
 * ended up rendering at its label's width while its duration was untouched. */
export function clipWidthPx(durationFrames: number, fps: number, zoom: number): number {
  return Math.max(4, framesToPx(durationFrames, fps, zoom))
}

/** Ruler tick spacing in seconds, chosen so labels never collide at any zoom. */
export function tickSeconds(zoom: number): { major: number; minor: number } {
  const pxPerSecond = PIXELS_PER_SECOND * zoom
  const intervals = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200]
  const major = intervals.find((seconds) => seconds * pxPerSecond >= 80) ?? intervals[intervals.length - 1]!
  const subdivisions = major % 5 === 0 ? 5 : 4
  return { major, minor: major / subdivisions }
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
