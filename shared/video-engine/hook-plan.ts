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
    // The example interpolates this project's real fps and frame budget. It used to be a
    // literal 30 / 900, and models copy an example verbatim — on a 24 or 60 fps project
    // that produced a plan the compiler rejects outright for fps mismatch, which reads to
    // the user as "the AI hook never works".
    `{"schemaVersion":1,"rendererId":"remotion|hyperframes","templateId":"ID","templateVersion":"1.0.0","fps":${fps},"title":"TITLE","durationFrames":${durationFrames},"props":{},"beats":[{"id":"beat-1","startFrame":0,"durationFrames":${Math.max(1, Math.round(fps * 1.5))},"headline":"TEXT","body":"TEXT","variant":"VARIANT","importantWordIds":[],"visual":{"kind":"none|asset|broll","assetId":"ASSET_ID","searchQuery":"QUERY"},"transitionOut":{"type":"cut|fade|slide|wipe|zoom|dip-to-black","durationFrames":0,"direction":"left|right|up|down","easing":"linear|ease-in|ease-out|ease-in-out"}}]}`,
    `fps MUST be exactly ${fps} and durationFrames MUST NOT exceed ${durationFrames}.`,
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

// ---------------------------------------------------------------- beat editing

/** What the UI is allowed to change on one beat. Everything else about a plan — beat
 *  order, ids, the overall duration — is derived, not edited. */
export const HookBeatPatchSchema = z.strictObject({
  headline: z.string().max(500).optional(),
  body: z.string().max(2000).optional(),
  variant: StableIdSchema.optional(),
  durationFrames: z.number().int().positive().optional(),
})
export type HookBeatPatch = z.infer<typeof HookBeatPatchSchema>

/** Emphasis ids are positional — `<beatId>:<field>:<tokenIndex>` against the text split
 *  on whitespace. Rewriting the text moves or removes those tokens, so ids that no longer
 *  point at a word are dropped rather than left to highlight something unrelated. */
export function remapImportantWordIds(
  ids: readonly string[] | undefined,
  beatId: string,
  field: 'headline' | 'body',
  nextText: string | undefined,
): string[] | undefined {
  if (!ids || ids.length === 0) return ids ? [...ids] : undefined
  const tokenCount = nextText ? nextText.trim().split(/\s+/u).filter(Boolean).length : 0
  const prefix = `${beatId}:${field}:`
  const kept = ids.filter((id) => {
    if (!id.startsWith(prefix)) return true // belongs to the other field
    const index = Number(id.slice(prefix.length))
    return Number.isInteger(index) && index >= 0 && index < tokenCount
  })
  return kept.length > 0 ? kept : undefined
}

/**
 * Applies an edit to one beat and repairs the plan around it.
 *
 * Changing a beat's length has to move every later beat, or the schema's
 * ordered-and-non-overlapping rule rejects the save. The plan's own duration grows or
 * shrinks with it, capped at the 30-second ceiling the schema enforces. An emptied
 * headline or body deletes the key — the schema requires a non-empty string when the
 * field is present, so writing '' would fail validation.
 *
 * Returns a parsed plan, so an edit that cannot produce a valid plan throws here rather
 * than being written to disk and surfacing later as a preflight error.
 */
export function applyHookBeatPatch(plan: HookPlan, beatId: string, patch: HookBeatPatch): HookPlan {
  const index = plan.beats.findIndex((beat) => beat.id === beatId)
  if (index < 0) throw new Error(`Unknown hook beat: ${beatId}`)
  const current = plan.beats[index]!

  const nextHeadline = patch.headline === undefined ? current.headline : patch.headline.trim() || undefined
  const nextBody = patch.body === undefined ? current.body : patch.body.trim() || undefined
  const nextDuration = patch.durationFrames ?? current.durationFrames
  const delta = nextDuration - current.durationFrames

  let importantWordIds = current.importantWordIds
  if (patch.headline !== undefined) {
    importantWordIds = remapImportantWordIds(importantWordIds, beatId, 'headline', nextHeadline)
  }
  if (patch.body !== undefined) {
    importantWordIds = remapImportantWordIds(importantWordIds, beatId, 'body', nextBody)
  }

  const edited: HookBeat = {
    ...current,
    ...(nextHeadline === undefined ? {} : { headline: nextHeadline }),
    ...(nextBody === undefined ? {} : { body: nextBody }),
    ...(patch.variant === undefined ? {} : { variant: patch.variant }),
    durationFrames: nextDuration,
    ...(importantWordIds === undefined ? {} : { importantWordIds }),
  }
  if (nextHeadline === undefined) delete (edited as { headline?: string }).headline
  if (nextBody === undefined) delete (edited as { body?: string }).body
  if (importantWordIds === undefined) delete (edited as { importantWordIds?: string[] }).importantWordIds
  // A transition can never outlast the beat it ends.
  if (edited.transitionOut && edited.transitionOut.durationFrames > nextDuration) {
    edited.transitionOut = { ...edited.transitionOut, durationFrames: nextDuration }
  }

  const beats = plan.beats.map((beat, position) =>
    position < index ? beat
      : position === index ? edited
        : { ...beat, startFrame: Math.max(0, beat.startFrame + delta) })

  const lastEnd = beats.reduce((end, beat) => Math.max(end, beat.startFrame + beat.durationFrames), 0)
  const ceiling = plan.fps * 30
  if (lastEnd > ceiling) {
    throw new Error(`That length would push the hook past the ${ceiling}-frame (30s) limit.`)
  }
  return HookPlanSchema.parse({ ...plan, beats, durationFrames: Math.max(lastEnd, 1) })
}

/**
 * Retimes an embedded plan when the project's frame rate changes. `patchCanvas` already
 * rescales scenes, captions and transitions; without this the plan kept its old fps and
 * every render failed preflight with `hook-plan.fps-mismatch`.
 */
export function rescaleHookPlan(plan: HookPlan, fps: number, scale: number): HookPlan {
  const frames = (value: number): number => Math.max(0, Math.round(value * scale))
  const beats = plan.beats.map((beat) => ({
    ...beat,
    startFrame: frames(beat.startFrame),
    durationFrames: Math.max(1, frames(beat.durationFrames)),
    ...(beat.transitionOut
      ? { transitionOut: { ...beat.transitionOut, durationFrames: frames(beat.transitionOut.durationFrames) } }
      : {}),
  }))
  const lastEnd = beats.reduce((end, beat) => Math.max(end, beat.startFrame + beat.durationFrames), 0)
  return HookPlanSchema.parse({
    ...plan,
    fps,
    beats,
    durationFrames: Math.max(1, Math.min(lastEnd || frames(plan.durationFrames), fps * 30)),
  })
}
