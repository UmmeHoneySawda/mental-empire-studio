import { z } from 'zod'
import {
  FrameSchema,
  JsonObjectSchema,
  RendererIdSchema,
  StableIdSchema,
  assertDataOnlyAiPayload,
  parseJsonInput,
  uniqueBy,
} from './common'
import { HookTransitionSchema } from './transitions'

export const HOOK_PLAN_SCHEMA_VERSION = 1 as const

export const HookVisualSchema = z
  .strictObject({
    kind: z.enum(['none', 'asset', 'broll']),
    assetId: StableIdSchema.optional(),
    searchQuery: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((visual, context) => {
    if (visual.kind === 'asset' && !visual.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'asset visuals require assetId',
      })
    }
    if (visual.kind === 'broll' && !visual.searchQuery) {
      context.addIssue({
        code: 'custom',
        path: ['searchQuery'],
        message: 'broll visuals require searchQuery',
      })
    }
    if (visual.kind !== 'asset' && visual.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'assetId is only valid for asset visuals',
      })
    }
    if (visual.kind !== 'broll' && visual.searchQuery) {
      context.addIssue({
        code: 'custom',
        path: ['searchQuery'],
        message: 'searchQuery is only valid for broll visuals',
      })
    }
  })
export type HookVisual = z.infer<typeof HookVisualSchema>

export const HookBeatSchema = z.strictObject({
  id: StableIdSchema,
  startFrame: FrameSchema,
  durationFrames: z.number().int().positive(),
  headline: z.string().trim().min(1).max(500).optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  variant: StableIdSchema.optional(),
  importantWordIds: z.array(StableIdSchema).max(100).optional(),
  visual: HookVisualSchema,
  transitionOut: HookTransitionSchema.optional(),
})
export type HookBeat = z.infer<typeof HookBeatSchema>

export const HookPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(HOOK_PLAN_SCHEMA_VERSION),
    rendererId: RendererIdSchema,
    templateId: StableIdSchema,
    templateVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version x.y.z')
      .optional(),
    fps: z.number().int().min(1).max(240),
    title: z.string().trim().min(1).max(500),
    durationFrames: z.number().int().positive(),
    props: JsonObjectSchema.optional(),
    beats: z.array(HookBeatSchema).min(1).max(100),
  })
  .superRefine((plan, context) => {
    if (plan.durationFrames > plan.fps * 30) {
      context.addIssue({
        code: 'custom',
        path: ['durationFrames'],
        message: 'Hook plans cannot exceed 30 seconds',
      })
    }
    if (!uniqueBy(plan.beats, (beat) => beat.id)) {
      context.addIssue({
        code: 'custom',
        path: ['beats'],
        message: 'Hook beat IDs must be unique',
      })
    }
    let previousEnd = 0
    for (let index = 0; index < plan.beats.length; index += 1) {
      const beat = plan.beats[index]!
      const end = beat.startFrame + beat.durationFrames
      if (beat.startFrame < previousEnd) {
        context.addIssue({
          code: 'custom',
          path: ['beats', index, 'startFrame'],
          message: 'Hook beats must be ordered and cannot overlap',
        })
      }
      if (end > plan.durationFrames) {
        context.addIssue({
          code: 'custom',
          path: ['beats', index, 'durationFrames'],
          message: 'Hook beat extends beyond the plan duration',
        })
      }
      if (beat.transitionOut && beat.transitionOut.durationFrames > beat.durationFrames) {
        context.addIssue({
          code: 'custom',
          path: ['beats', index, 'transitionOut', 'durationFrames'],
          message: 'Transition duration cannot exceed its beat duration',
        })
      }
      if (beat.importantWordIds && !uniqueBy(beat.importantWordIds, (id) => id)) {
        context.addIssue({
          code: 'custom',
          path: ['beats', index, 'importantWordIds'],
          message: 'importantWordIds must be unique',
        })
      }
      previousEnd = end
    }
  })
export type HookPlan = z.infer<typeof HookPlanSchema>

export function parseHookPlan(input: string | unknown): HookPlan {
  const payload = parseJsonInput(input)
  assertDataOnlyAiPayload(payload)
  return HookPlanSchema.parse(payload)
}

export function safeParseHookPlan(input: string | unknown): z.ZodSafeParseResult<HookPlan> {
  try {
    const payload = parseJsonInput(input)
    assertDataOnlyAiPayload(payload)
    return HookPlanSchema.safeParse(payload)
  } catch (error) {
    return {
      success: false,
      error: new z.ZodError([
        {
          code: 'custom',
          path: [],
          message: error instanceof Error ? error.message : String(error),
        },
      ]) as z.ZodError<HookPlan>,
    }
  }
}

export interface HookPlanPromptOptions {
  rendererId: HookPlan['rendererId']
  templateId: string
  fps: number
  title: string
  transcript?: string
  availableAssetIds?: readonly string[]
  templateVersion?: string
  durationSeconds?: number
}

export function buildHookPlanPrompt(options: HookPlanPromptOptions): string {
  const fps = z.number().int().min(1).max(240).parse(options.fps)
  const durationSeconds = z.number().positive().max(30).parse(options.durationSeconds ?? 30)
  const durationFrames = Math.max(1, Math.round(durationSeconds * fps))
  const assets = (options.availableAssetIds ?? []).map((id) => StableIdSchema.parse(id))
  return [
    'Create a data-only hook plan for a motion-graphics intro.',
    'Return JSON only. Do not return Markdown, code, HTML, CSS, JSX, functions, imports, commands, or executable fields.',
    'Use integer frame timing. Beats must be ordered, non-overlapping, and remain inside durationFrames.',
    'For asset visuals, use only an assetId from the supplied list. Otherwise use a short broll searchQuery or kind "none".',
    'For importantWordIds, split headline/body on whitespace and use IDs in the form "<beat-id>:headline:<zero-based-index>" or "<beat-id>:body:<zero-based-index>".',
    'Required JSON shape:',
    '{"schemaVersion":1,"rendererId":"remotion|hyperframes","templateId":"ID","templateVersion":"1.0.0","fps":30,"title":"TITLE","durationFrames":900,"props":{},"beats":[{"id":"beat-1","startFrame":0,"durationFrames":90,"headline":"TEXT","body":"TEXT","variant":"VARIANT","importantWordIds":[],"visual":{"kind":"none|asset|broll","assetId":"ASSET_ID","searchQuery":"QUERY"},"transitionOut":{"type":"cut|fade|slide|wipe|zoom|dip-to-black","durationFrames":0,"direction":"left|right|up|down","easing":"linear|ease-in|ease-out|ease-in-out"}}]}',
    `Renderer: ${RendererIdSchema.parse(options.rendererId)}`,
    `Template: ${StableIdSchema.parse(options.templateId)}`,
    options.templateVersion ? `Template version: ${options.templateVersion}` : '',
    `Title: ${options.title}`,
    `FPS: ${fps}`,
    `Maximum durationFrames: ${durationFrames}`,
    `Available asset IDs: ${JSON.stringify(assets)}`,
    options.transcript ? `Transcript/context: ${options.transcript}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
