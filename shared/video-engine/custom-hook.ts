import { z } from 'zod'
import {
  assertDataOnlyAiPayload,
  HexColorSchema,
  parseJsonInput,
} from './common'
import { HookPlanSchema, type HookPlan } from './hook-plan'
import {
  HookAlignmentSchema,
  HookAnimationPresetSchema,
  HookBackgroundPresetSchema,
  HookFontFamilySchema,
  HookPositionSchema,
  REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
} from './hook-style'

export const CUSTOM_HOOK_SCHEMA_VERSION = 1 as const

export const CustomHookConfigSchema = z.strictObject({
  schemaVersion: z.literal(CUSTOM_HOOK_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(128),
  text: z.strictObject({
    headline: z.string().trim().min(1).max(180),
    body: z.string().trim().min(1).max(280).optional(),
  }),
  durationSeconds: z.number().finite().min(1).max(30),
  animationPreset: HookAnimationPresetSchema,
  typography: z.strictObject({
    fontFamily: HookFontFamilySchema,
    fontSize: z.number().int().min(32).max(180),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    lineHeight: z.number().finite().min(0.8).max(1.6),
    letterSpacing: z.number().finite().min(-10).max(16),
  }),
  colors: z.strictObject({
    text: HexColorSchema,
    accent: HexColorSchema,
    background: HexColorSchema,
  }),
  alignment: HookAlignmentSchema,
  position: HookPositionSchema,
  backgroundPreset: HookBackgroundPresetSchema,
  energy: z.enum(['restrained', 'balanced', 'intense']),
})
export type CustomHookConfig = z.infer<typeof CustomHookConfigSchema>

export function parseCustomHookConfig(input: string | unknown): CustomHookConfig {
  const payload = parseJsonInput(input, 20_000)
  assertDataOnlyAiPayload(payload)
  return CustomHookConfigSchema.parse(payload)
}

export function safeParseCustomHookConfig(
  input: string | unknown,
): z.ZodSafeParseResult<CustomHookConfig> {
  try {
    const payload = parseJsonInput(input, 20_000)
    assertDataOnlyAiPayload(payload)
    return CustomHookConfigSchema.safeParse(payload)
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([{
        code: 'custom',
        path: [],
        message: error instanceof Error ? error.message : String(error),
      }]) as z.ZodError<CustomHookConfig>,
    }
  }
}

export function customHookPlan(
  configInput: CustomHookConfig,
  options: { fps: number; templateVersion?: string },
): HookPlan {
  const config = CustomHookConfigSchema.parse(configInput)
  const fps = Math.max(1, Math.min(240, Math.round(options.fps)))
  const durationFrames = Math.max(1, Math.min(fps * 30, Math.round(config.durationSeconds * fps)))
  return HookPlanSchema.parse({
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
    templateVersion: options.templateVersion ?? '1.0.0',
    fps,
    title: config.name,
    durationFrames,
    props: {
      headline: config.text.headline,
      ...(config.text.body ? { subheadline: config.text.body } : {}),
      animationPreset: config.animationPreset,
      backgroundPreset: config.backgroundPreset,
      alignment: config.alignment,
      position: config.position,
      fontFamily: config.typography.fontFamily,
      fontSize: config.typography.fontSize,
      fontWeight: config.typography.fontWeight,
      lineHeight: config.typography.lineHeight,
      letterSpacing: config.typography.letterSpacing,
      textColor: config.colors.text,
      accentColor: config.colors.accent,
      backgroundColor: config.colors.background,
      energy: config.energy,
    },
    beats: [{
      id: 'custom-hook-beat',
      startFrame: 0,
      durationFrames,
      headline: config.text.headline,
      ...(config.text.body ? { body: config.text.body } : {}),
      variant: 'custom',
      visual: { kind: 'none' },
    }],
  })
}
