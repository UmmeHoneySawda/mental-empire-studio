import { z } from 'zod'
import { HexColorSchema, hexColorWithAlpha, type JsonObject } from './common'

export const REMOTION_CUSTOM_HOOK_TEMPLATE_ID = 'remotion-hook-custom' as const

export const REMOTION_HOOK_TEMPLATE_IDS = [
  'remotion-hook-kinetic-30',
  'remotion-hook-cinematic-30',
  'remotion-hook-motivational',
  'remotion-hook-psychological-tip',
  'remotion-hook-self-improvement',
  'remotion-hook-educational',
  REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
] as const

export const HookAnimationPresetSchema = z.enum([
  'kinetic',
  'cinematic',
  'punch',
  'focus',
  'rise',
  'slide',
])
export type HookAnimationPreset = z.infer<typeof HookAnimationPresetSchema>

export const HookBackgroundPresetSchema = z.enum([
  'solid',
  'gradient',
  'grid',
  'spotlight',
  'split',
])
export type HookBackgroundPreset = z.infer<typeof HookBackgroundPresetSchema>

export const HookAlignmentSchema = z.enum(['left', 'center', 'right'])
export type HookAlignment = z.infer<typeof HookAlignmentSchema>

export const HookPositionSchema = z.enum(['top', 'center', 'bottom'])
export type HookPosition = z.infer<typeof HookPositionSchema>

export const HookFontFamilySchema = z.enum([
  'Space Grotesk',
  'Hanken Grotesk',
  'Anton',
  'JetBrains Mono',
])
export type HookFontFamily = z.infer<typeof HookFontFamilySchema>

/** The complete visual vocabulary the trusted Remotion hook renderer understands.
 *  It is intentionally finite: custom hooks select data from this vocabulary and never
 *  supply markup, CSS, modules, components, or executable source. */
export const HookStylePropsSchema = z.strictObject({
  animationPreset: HookAnimationPresetSchema,
  backgroundPreset: HookBackgroundPresetSchema,
  alignment: HookAlignmentSchema,
  position: HookPositionSchema,
  fontFamily: HookFontFamilySchema,
  fontSize: z.number().int().min(32).max(180),
  fontWeight: z.number().int().min(400).max(700),
  lineHeight: z.number().min(0.8).max(1.6),
  letterSpacing: z.number().min(-10).max(16),
  textColor: HexColorSchema,
  accentColor: HexColorSchema,
  backgroundColor: HexColorSchema,
  energy: z.enum(['restrained', 'balanced', 'intense']),
})
export type HookStyleProps = z.infer<typeof HookStylePropsSchema>

export interface HookPalette {
  readonly accent: string
  readonly accentSoft: string
  readonly background: string
  readonly text: string
}

/** Beat variants remain semantic inputs while the default path keeps each template's
 * distinct declarative palette. */
export function hookPaletteFor(style: HookStyleProps, variant?: string): HookPalette {
  switch (variant) {
    case 'warning':
    case 'urgent':
      return {
        accent: '#FF4D35',
        accentSoft: '#FFB21A',
        background: '#190504',
        text: style.textColor,
      }
    case 'luxury':
    case 'cinematic':
      return {
        accent: '#EBCB83',
        accentSoft: '#FFF2C9',
        background: '#090A0D',
        text: style.textColor,
      }
    case 'clean':
    case 'minimal':
      return {
        accent: '#1CE1C5',
        accentSoft: '#B9FFF5',
        background: '#071210',
        text: style.textColor,
      }
    default:
      return {
        accent: style.accentColor,
        accentSoft: hexColorWithAlpha(style.accentColor, 0.8),
        background: style.backgroundColor,
        text: style.textColor,
      }
  }
}

const CUSTOM_DEFAULTS: HookStyleProps = {
  animationPreset: 'rise',
  backgroundPreset: 'gradient',
  alignment: 'left',
  position: 'center',
  fontFamily: 'Space Grotesk',
  fontSize: 112,
  fontWeight: 700,
  lineHeight: 0.94,
  letterSpacing: -4,
  textColor: '#FFFFFF',
  accentColor: '#48E5C2',
  backgroundColor: '#07111D',
  energy: 'balanced',
}

/** Presets are deliberately different in layout, typography, palette, background, and
 *  motion — the selected template now changes the actual render instead of only its ID. */
export const REMOTION_HOOK_STYLE_PRESETS: Readonly<Record<string, HookStyleProps>> = Object.freeze({
  'remotion-hook-kinetic-30': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'kinetic',
    backgroundPreset: 'grid',
    accentColor: '#B8FF35',
    backgroundColor: '#07090D',
    fontSize: 126,
    letterSpacing: -6,
    energy: 'intense',
  },
  'remotion-hook-cinematic-30': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'cinematic',
    backgroundPreset: 'spotlight',
    position: 'bottom',
    fontFamily: 'Hanken Grotesk',
    fontSize: 108,
    lineHeight: 1.02,
    letterSpacing: -2,
    accentColor: '#EBCB83',
    backgroundColor: '#090A0D',
    energy: 'restrained',
  },
  'remotion-hook-motivational': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'punch',
    backgroundPreset: 'gradient',
    alignment: 'center',
    fontFamily: 'Anton',
    fontSize: 138,
    fontWeight: 400,
    lineHeight: 0.9,
    letterSpacing: 1,
    accentColor: '#FFD43B',
    backgroundColor: '#250A07',
    energy: 'intense',
  },
  'remotion-hook-psychological-tip': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'focus',
    backgroundPreset: 'spotlight',
    fontFamily: 'Hanken Grotesk',
    fontSize: 102,
    lineHeight: 1.05,
    letterSpacing: -2,
    accentColor: '#BFA7FF',
    backgroundColor: '#100B22',
    energy: 'restrained',
  },
  'remotion-hook-self-improvement': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'rise',
    backgroundPreset: 'grid',
    position: 'bottom',
    fontSize: 116,
    accentColor: '#48E5C2',
    backgroundColor: '#061713',
  },
  'remotion-hook-educational': {
    ...CUSTOM_DEFAULTS,
    animationPreset: 'slide',
    backgroundPreset: 'split',
    position: 'top',
    fontFamily: 'Hanken Grotesk',
    fontSize: 94,
    lineHeight: 1.08,
    letterSpacing: -1,
    accentColor: '#61A5FF',
    backgroundColor: '#071426',
    energy: 'restrained',
  },
  [REMOTION_CUSTOM_HOOK_TEMPLATE_ID]: CUSTOM_DEFAULTS,
})

export function hookStylePresetFor(templateId: string): HookStyleProps {
  return REMOTION_HOOK_STYLE_PRESETS[templateId]
    ?? (templateId.includes('cinematic')
      ? REMOTION_HOOK_STYLE_PRESETS['remotion-hook-cinematic-30']!
      : REMOTION_HOOK_STYLE_PRESETS['remotion-hook-kinetic-30']!)
}

/** Resolve only known style fields. `scene.template.props` also carries `hookPlan`, which
 *  is not style input and must never be interpreted as one. */
export function resolveHookStyle(templateId: string, props: JsonObject = {}): HookStyleProps {
  const defaults = hookStylePresetFor(templateId)
  const supplied: Record<string, unknown> = {}
  for (const key of Object.keys(defaults)) {
    if (props[key] !== undefined) supplied[key] = props[key]
  }
  const parsed = HookStylePropsSchema.safeParse({ ...defaults, ...supplied })
  return parsed.success ? parsed.data : defaults
}
