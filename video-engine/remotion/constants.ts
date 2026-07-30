export const REMOTION_COMPOSITION_ID = 'MentalEmpireVideo'
export const REMOTION_RENDERER_ID = 'remotion' as const

export const HOOK_TEMPLATE_IDS = new Set([
  'hook-intro',
  'hook-intro-cinematic',
  'hook-intro-kinetic',
  'remotion-hook-kinetic-30',
  'remotion-hook-cinematic-30',
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

export const REMOTION_CAPTION_TEMPLATE_IDS = [
  'remotion-caption-emoji-pop',
  'remotion-caption-clip-wipe',
  'remotion-caption-highlight',
  'remotion-caption-neon-accent',
  'remotion-caption-particle-burst',
  'remotion-caption-weight-shift',
] as const
