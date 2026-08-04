import type { TransitionDirection, TransitionType } from './transitions'

/* The transition presets offered by the UI — one table, read by both the Remotion editor's
 * Transitions panel and the automation batch pipeline, so a Visual System offers exactly
 * the transitions the editor does.
 *
 * The engine applies a transition by TEMPLATE, not by type: `applyTransition` takes a
 * `templateId` and derives the overlap between the two clips itself, which is what stops a
 * hand-computed `startFrame` from failing preflight. The six animated templates registered
 * for Remotion are `remotion-transition-{fade,slide,wipe,zoom,blur,dip-to-black}`; `cut`
 * is the one type with no template, applied with a zero duration.
 *
 * Durations and the fast/slow split are the timings from editor-pro-max's
 * `TRANSITION_PRESETS`; direction values are the engine's own `left|right|up|down`. */

export interface TransitionPreset {
  id: string
  label: string
  hint: string
  /** Registered template id, or null for a hard cut. */
  templateId: string | null
  /** Frames the transition borrows from each side. A cut is always 0. */
  durationFrames: number
  direction?: TransitionDirection
}

export const TRANSITION_PRESETS: readonly TransitionPreset[] = [
  { id: 'cut', label: 'Cut', hint: 'A hard cut. No frames borrowed.', templateId: null, durationFrames: 0 },
  { id: 'crossfade', label: 'Crossfade', hint: 'The classic dissolve. One second.', templateId: 'remotion-transition-fade', durationFrames: 30 },
  { id: 'fade-quick', label: 'Quick fade', hint: 'Half a second — keeps the pace up.', templateId: 'remotion-transition-fade', durationFrames: 15 },
  { id: 'fade-slow', label: 'Slow fade', hint: 'A second and a half. Reads as a scene change.', templateId: 'remotion-transition-fade', durationFrames: 45 },
  { id: 'slide-left', label: 'Slide left', hint: 'The new clip pushes in leftward.', templateId: 'remotion-transition-slide', durationFrames: 30, direction: 'left' },
  { id: 'slide-right', label: 'Slide right', hint: 'The new clip pushes in rightward.', templateId: 'remotion-transition-slide', durationFrames: 30, direction: 'right' },
  { id: 'slide-up', label: 'Slide up', hint: 'Pushes upward. Good for lists.', templateId: 'remotion-transition-slide', durationFrames: 30, direction: 'up' },
  { id: 'slide-down', label: 'Slide down', hint: 'Pushes downward.', templateId: 'remotion-transition-slide', durationFrames: 30, direction: 'down' },
  { id: 'wipe-left', label: 'Wipe left', hint: 'A hard edge travels across the frame.', templateId: 'remotion-transition-wipe', durationFrames: 30, direction: 'left' },
  { id: 'wipe-right', label: 'Wipe right', hint: 'Same, the other way.', templateId: 'remotion-transition-wipe', durationFrames: 30, direction: 'right' },
  { id: 'zoom', label: 'Zoom', hint: 'Punches through the cut. Energetic.', templateId: 'remotion-transition-zoom', durationFrames: 24 },
  { id: 'blur', label: 'Blur', hint: 'Defocus and resolve. Dreamlike.', templateId: 'remotion-transition-blur', durationFrames: 30 },
  { id: 'dip-to-black', label: 'Dip to black', hint: 'Through black. The strongest break you can make.', templateId: 'remotion-transition-dip-to-black', durationFrames: 36 }
] as const

/* Visual System rows written before the automation UI offered the full table stored one of
 * four labels. They are still in the user's database, so they resolve rather than fall back
 * to a cut. */
const LEGACY_TRANSITION_IDS: Readonly<Record<string, string>> = {
  Cut: 'cut',
  Crossfade: 'crossfade',
  Wipe: 'wipe-left',
  Dip: 'dip-to-black'
}

/** A stored transition value — preset id or legacy label — as a preset. Defaults to a cut. */
export function resolveTransitionPreset(value: string | null | undefined): TransitionPreset {
  if (!value) return TRANSITION_PRESETS[0]
  const id = LEGACY_TRANSITION_IDS[value] ?? value
  return TRANSITION_PRESETS.find((preset) => preset.id === id) ?? TRANSITION_PRESETS[0]
}

/** The engine's transition `type` for a preset, or null for a hard cut (which has none). */
export function transitionTypeOf(preset: TransitionPreset): TransitionType | null {
  if (!preset.templateId) return null
  return preset.templateId.replace(/^(?:remotion|hyperframes)-transition-/, '') as TransitionType
}
