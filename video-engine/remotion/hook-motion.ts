import { spring } from 'remotion'
import type {
  HookAlignment,
  HookAnimationPreset,
  HookStyleProps,
} from '../../shared/video-engine'

export interface HookMotionValues {
  opacity: number
  translateX: number
  translateY: number
  scale: number
  rotate: number
  blur: number
  reveal: number
}

/** Pure, seek-safe entrance progress: any requested frame derives the same value without
 *  timers, CSS transitions, or history from earlier frames. */
export function hookEntranceProgress(options: {
  frame: number
  fps: number
  durationFrames: number
  energy: HookStyleProps['energy']
}): number {
  const config = options.energy === 'intense'
    ? { damping: 14, stiffness: 210, mass: 0.62 }
    : options.energy === 'restrained'
      ? { damping: 24, stiffness: 115, mass: 0.9 }
      : { damping: 18, stiffness: 170, mass: 0.72 }
  const progress = spring({
    fps: options.fps,
    frame: options.frame,
    config,
    durationInFrames: Math.max(8, Math.min(30, options.durationFrames)),
  })
  return Math.max(0, Math.min(1, progress))
}

export function hookMotionValues(
  preset: HookAnimationPreset,
  progress: number,
  alignment: HookAlignment,
): HookMotionValues {
  const p = Math.max(0, Math.min(1, progress))
  const remaining = 1 - p
  const direction = alignment === 'right' ? 1 : -1
  switch (preset) {
    case 'kinetic':
      return { opacity: p, translateX: direction * 128 * remaining, translateY: 18 * remaining, scale: 0.9 + p * 0.1, rotate: direction * 4 * remaining, blur: 0, reveal: p }
    case 'cinematic':
      return { opacity: p, translateX: 0, translateY: 52 * remaining, scale: 1.035 - p * 0.035, rotate: 0, blur: 8 * remaining, reveal: p }
    case 'punch':
      return { opacity: p, translateX: 0, translateY: 12 * remaining, scale: 0.68 + p * 0.32, rotate: -2.5 * remaining, blur: 0, reveal: p }
    case 'focus':
      return { opacity: p, translateX: 0, translateY: 0, scale: 1.13 - p * 0.13, rotate: 0, blur: 14 * remaining, reveal: p }
    case 'slide':
      return { opacity: p, translateX: direction * 150 * remaining, translateY: 0, scale: 1, rotate: 0, blur: 0, reveal: p }
    case 'rise':
    default:
      return { opacity: p, translateX: 0, translateY: 86 * remaining, scale: 0.98 + p * 0.02, rotate: 0, blur: 0, reveal: p }
  }
}
