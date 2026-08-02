import {
  CAPTION_STYLE_IDS,
  REMOTION_HOOK_TEMPLATE_IDS,
} from '../../shared/video-engine'

export const REMOTION_COMPOSITION_ID = 'MentalEmpireVideo'
export const REMOTION_RENDERER_ID = 'remotion' as const

export const HOOK_TEMPLATE_IDS = new Set([
  'hook-intro',
  'hook-intro-cinematic',
  'hook-intro-kinetic',
  ...REMOTION_HOOK_TEMPLATE_IDS,
])

// Zoom, blur, and dip-to-black are hand-written CSS presentations in transition.tsx
// with the same numbers the HyperFrames compiler uses, so the two engines match.
export const SUPPORTED_REMOTION_TRANSITIONS = [
  'cut',
  'fade',
  'slide',
  'wipe',
  'zoom',
  'blur',
  'dip-to-black',
] as const

export const REMOTION_CAPTION_TEMPLATE_IDS = CAPTION_STYLE_IDS.map(
  (id) => `remotion-caption-${id}`,
)
