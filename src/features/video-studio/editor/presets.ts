import type { JsonObject } from '@shared/video-engine'
import type { TextMotionId } from '../../../../video-engine/remotion/textMotion'

/* Preset tables for the editor's panels.
 *
 * Provenance: the transition timings, colour palettes, gradient ramps, easing curves and
 * text scales are ported from Hainrixz/editor-pro-max (`src/presets/*`,
 * `src/components/transitions/TransitionPresets.ts`, `src/components/text/TextStyles.ts`).
 * The colour grades are the engine's own `VIDEO_GRADING_PRESETS` shape, so they apply
 * through the existing deterministic FFmpeg pass rather than a second code path.
 *
 * These are DATA, not components — a panel reads a table and produces a scene patch or a
 * grading object. That keeps every preset one row of a list instead of a bespoke React
 * tree, which is what lets the panels stay small. */

// --------------------------------------------------------------------- transitions

/* The transition table now lives in `shared/video-engine/transition-presets.ts`: the
 * automation batch pipeline (main process) offers the same list, so it cannot import it
 * from here. Re-exported so the panels keep their existing import. */

export type { TransitionPreset } from '@shared/video-engine/transition-presets'
export type { TransitionDirection } from '@shared/video-engine/transitions'
export { TRANSITION_PRESETS } from '@shared/video-engine/transition-presets'

// -------------------------------------------------------------------- colour grades

export interface GradePreset {
  id: string
  label: string
  hint: string
  /** Patch applied over the project's current grading. */
  grading: {
    exposure?: number
    contrast?: number
    saturation?: number
    temperature?: number
    tint?: number
    vignette?: number
    grain?: number
  }
}

export const GRADE_PRESETS: readonly GradePreset[] = [
  { id: 'neutral', label: 'Neutral', hint: 'Everything at zero — the footage as shot.', grading: { exposure: 0, contrast: 0, saturation: 1, temperature: 0, tint: 0, vignette: 0, grain: 0 } },
  { id: 'punch', label: 'Punch', hint: 'More contrast and colour. Reads well small.', grading: { contrast: 0.18, saturation: 1.2, vignette: 0.12 } },
  { id: 'teal-orange', label: 'Teal & orange', hint: 'The blockbuster look: cool shadows, warm skin.', grading: { contrast: 0.14, saturation: 1.15, temperature: 0.12, tint: -0.06, vignette: 0.15 } },
  { id: 'warm-film', label: 'Warm film', hint: 'Golden and soft, with grain.', grading: { exposure: 0.05, contrast: 0.08, saturation: 1.08, temperature: 0.2, grain: 0.12, vignette: 0.18 } },
  { id: 'cold-doc', label: 'Cold doc', hint: 'Desaturated and cool. Serious.', grading: { contrast: 0.1, saturation: 0.85, temperature: -0.18, vignette: 0.1 } },
  { id: 'noir', label: 'Noir', hint: 'Near-monochrome with a heavy vignette.', grading: { contrast: 0.3, saturation: 0.12, vignette: 0.35, grain: 0.18 } },
  { id: 'vhs', label: 'VHS', hint: 'Lifted blacks, blown colour, lots of grain.', grading: { exposure: 0.1, contrast: -0.08, saturation: 1.35, temperature: 0.08, grain: 0.32, vignette: 0.22 } },
  { id: 'clean-bright', label: 'Clean & bright', hint: 'Lifted and airy — good for talking heads.', grading: { exposure: 0.12, contrast: 0.06, saturation: 1.05, temperature: 0.04 } }
] as const

// ------------------------------------------------------------------------ palettes

/** From editor-pro-max `src/presets/colors.ts`. Used to colour text and solid clips. */
export const PALETTES = {
  dark: { bg: '#0a0a0a', surface: '#1a1a1a', text: '#ffffff', textMuted: '#a0a0a0', accent: '#6366f1', accentAlt: '#8b5cf6' },
  light: { bg: '#ffffff', surface: '#f5f5f5', text: '#0a0a0a', textMuted: '#6b7280', accent: '#3b82f6', accentAlt: '#2563eb' },
  vibrant: { bg: '#0f0f23', surface: '#1a1a3e', text: '#ffffff', textMuted: '#c4b5fd', accent: '#f43f5e', accentAlt: '#ec4899' },
  warm: { bg: '#1c1917', surface: '#292524', text: '#fef3c7', textMuted: '#d6d3d1', accent: '#f59e0b', accentAlt: '#ef4444' },
  cool: { bg: '#0c1222', surface: '#162032', text: '#e0f2fe', textMuted: '#94a3b8', accent: '#06b6d4', accentAlt: '#3b82f6' },
  neon: { bg: '#000000', surface: '#111111', text: '#ffffff', textMuted: '#888888', accent: '#00ff88', accentAlt: '#ff0080' },
  brand: { bg: '#0a0a0a', surface: '#141414', text: '#ffffff', textMuted: '#a0a0a0', accent: '#8b5cf6', accentAlt: '#6366f1' }
} as const
export type PaletteKey = keyof typeof PALETTES

/** Gradient ramps, also from editor-pro-max. */
export const GRADIENTS = {
  sunset: ['#f43f5e', '#f59e0b'],
  ocean: ['#06b6d4', '#3b82f6'],
  forest: ['#10b981', '#059669'],
  purple: ['#8b5cf6', '#6366f1'],
  fire: ['#ef4444', '#f59e0b'],
  midnight: ['#1e1b4b', '#312e81'],
  aurora: ['#06b6d4', '#8b5cf6', '#f43f5e'],
  rainbow: ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6']
} as const
export type GradientKey = keyof typeof GRADIENTS

// -------------------------------------------------------------------- text presets

/** Type scale from editor-pro-max `TextStyles.ts`, mapped onto the fonts this app
 *  self-hosts through `@fontsource` (CSP forbids a CDN, so only these are available). */
export interface TextPreset {
  id: string
  label: string
  hint: string
  props: JsonObject
}

export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: 'display', label: 'Display', hint: '120px, heaviest weight. Full-frame statements.', props: { fontSize: 120, fontFamily: 'Anton', fontWeight: 900, lineHeight: 1, letterSpacing: -2, color: '#ffffff' } },
  { id: 'heading', label: 'Heading', hint: '72px. The default title.', props: { fontSize: 72, fontFamily: 'Space Grotesk', fontWeight: 800, lineHeight: 1.1, letterSpacing: -1, color: '#ffffff' } },
  { id: 'subheading', label: 'Subheading', hint: '36px. Sits under a heading.', props: { fontSize: 36, fontFamily: 'Space Grotesk', fontWeight: 600, lineHeight: 1.3, letterSpacing: 0, color: '#ffffff' } },
  { id: 'body', label: 'Body', hint: '24px. For anything you expect read.', props: { fontSize: 24, fontFamily: 'Hanken Grotesk', fontWeight: 400, lineHeight: 1.6, color: '#ffffff' } },
  { id: 'caption', label: 'Caption', hint: '48px heavy — matches the caption burn-in.', props: { fontSize: 48, fontFamily: 'Space Grotesk', fontWeight: 800, lineHeight: 1.2, color: '#ffffff' } },
  { id: 'quote', label: 'Quote', hint: '42px italic, generous leading.', props: { fontSize: 42, fontFamily: 'Hanken Grotesk', fontWeight: 400, lineHeight: 1.5, letterSpacing: 0.5, fontStyle: 'italic', color: '#ffffff' } },
  { id: 'code', label: 'Mono', hint: '28px JetBrains Mono.', props: { fontSize: 28, fontFamily: 'JetBrains Mono', fontWeight: 400, lineHeight: 1.6, color: '#ffffff' } }
] as const

/** Named entrance motions. The composition reads `animation` off a text scene's template
 *  props and `textMotion.ts` resolves it to a curve.
 *
 *  The ids are typed as `TextMotionId`, so this table cannot offer a motion the renderer
 *  does not implement — which is exactly how `typewriter`, `word-by-word` and `stagger`
 *  came to be dead: they were listed here, saved onto the scene and accepted by preflight,
 *  while the composition had no case for them and drew `rise` instead. A regression test
 *  asserts this table and `TEXT_MOTION_IDS` still describe the same set. */
export const TEXT_ANIMATIONS: ReadonlyArray<{
  id: TextMotionId
  label: string
  hint: string
}> = [
  { id: 'none', label: 'None', hint: 'Appears on its first frame.' },
  { id: 'fade', label: 'Fade', hint: 'Opacity 0 → 1.' },
  { id: 'rise', label: 'Rise', hint: 'Fades while sliding up. The safe default.' },
  { id: 'drop', label: 'Drop', hint: 'Falls in from above.' },
  { id: 'scale', label: 'Scale', hint: 'Springs up from 90%.' },
  { id: 'typewriter', label: 'Typewriter', hint: 'One character at a time.' },
  { id: 'word-by-word', label: 'Word by word', hint: 'Each word pops in turn.' },
  { id: 'blur-in', label: 'Blur in', hint: 'Resolves out of a blur.' },
  { id: 'slide-left', label: 'Slide left', hint: 'Enters from the right edge.' },
  { id: 'stagger', label: 'Stagger', hint: 'Words cascade in, each rising.' }
] as const

// ------------------------------------------------------------------ canvas presets

export interface CanvasPreset {
  id: string
  label: string
  hint: string
  width: number
  height: number
}

export const CANVAS_PRESETS: readonly CanvasPreset[] = [
  { id: '16-9', label: '16:9', hint: '1920×1080 — standard YouTube.', width: 1920, height: 1080 },
  { id: '9-16', label: '9:16', hint: '1080×1920 — Shorts, Reels, TikTok.', width: 1080, height: 1920 },
  { id: '1-1', label: '1:1', hint: '1080×1080 — square feed posts.', width: 1080, height: 1080 },
  { id: '4-5', label: '4:5', hint: '1080×1350 — the tallest Instagram allows in-feed.', width: 1080, height: 1350 },
  { id: '4-3', label: '4:3', hint: '1440×1080 — retro / archival.', width: 1440, height: 1080 },
  { id: '21-9', label: '21:9', hint: '2560×1080 — cinematic letterbox.', width: 2560, height: 1080 }
] as const

export const FPS_PRESETS = [24, 25, 30, 50, 60] as const

// --------------------------------------------------------------------- easing keys

/** From editor-pro-max `src/presets/easings.ts`. Exposed so the inspector can name a
 *  curve; the Remotion side resolves the name to a real `Easing`. */
export const EASINGS = [
  'linear', 'easeIn', 'easeInOut', 'easeOut',
  'bounceIn', 'bounceOut', 'elastic',
  'backIn', 'backOut', 'sharp', 'smooth', 'snappy'
] as const
export type EasingKey = (typeof EASINGS)[number]
