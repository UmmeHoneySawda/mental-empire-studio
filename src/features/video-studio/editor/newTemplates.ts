import {
  NEW_CAPTION_DEFINITIONS,
  NEW_TEMPLATE_ACCENT,
  type HookPlan,
  type JsonObject,
  type NewCaptionTemplateId,
  type NewHookDefinition,
  type VideoTemplate
} from '@shared/video-engine'

/* Drafts and builders for the Cinematic set's accordion.
 *
 * The hook path deliberately produces a SINGLE-beat plan and sends it out through the existing
 * `importHookPlan`, which is the same validated, zod-checked entry point the premade and AI hooks
 * use. No new IPC and no second compiler. The primary line is written to both the beat headline and
 * the matching prop, so the existing Beats list edits the same line this accordion does. */

const HEX = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u

function normalizedHex(value: string, fallback: string): string {
  return HEX.test(value) ? value.toUpperCase() : fallback.toUpperCase()
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export interface NewHookDraft {
  text: Record<string, string>
  numbers: Record<string, number>
  accentColor: string
  grain: number
  seconds: number
}

export function newHookDraft(definition: NewHookDefinition): NewHookDraft {
  return {
    text: Object.fromEntries(definition.textFields.map((field) => [field.key, field.default])),
    numbers: Object.fromEntries(definition.numberFields.map((field) => [field.key, field.default])),
    accentColor: NEW_TEMPLATE_ACCENT.toUpperCase(),
    grain: definition.grain,
    seconds: definition.defaultSeconds
  }
}

/** The hook draft a project has actually SAVED, falling back field by field to the table.
 *
 *  The caption side reads its saved props; without the same read-back here, selecting the card for a
 *  hook already in the project showed the delivered defaults, and "Add this hook" then overwrote the
 *  user's lines with them. `beats[0]` wins over the prop because that is the precedence the
 *  components render with, so a line edited through the Beats list shows up here too. */
export function newHookDraftFromProps(options: {
  definition: NewHookDefinition
  props?: JsonObject | undefined
  headline?: string | undefined
  body?: string | undefined
  seconds?: number | undefined
}): NewHookDraft {
  const { definition, props, headline, body, seconds } = options
  const base = newHookDraft(definition)
  const draft: NewHookDraft = {
    ...base,
    text: { ...base.text },
    numbers: { ...base.numbers },
    seconds:
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : base.seconds
  }
  if (!props && headline === undefined && body === undefined) return draft

  for (const field of definition.textFields) {
    const saved = props?.[field.key]
    if (typeof saved === 'string' && saved.trim()) {
      draft.text[field.key] = saved.trim().slice(0, field.maxLength)
    }
  }
  for (const field of definition.numberFields) {
    const saved = props?.[field.key]
    if (typeof saved === 'number' && Number.isFinite(saved)) {
      const bounded = Math.max(field.minimum, Math.min(field.maximum, saved))
      draft.numbers[field.key] = field.integer ? Math.round(bounded) : bounded
    }
  }

  const accent = props?.['accentColor']
  if (typeof accent === 'string') draft.accentColor = normalizedHex(accent, base.accentColor)
  const grain = props?.['grain']
  if (typeof grain === 'number' && Number.isFinite(grain)) draft.grain = clampUnit(grain)

  const headlineField = definition.textFields.find((field) => field.role === 'headline')
  if (headlineField && typeof headline === 'string' && headline.trim()) {
    draft.text[headlineField.key] = headline.trim().slice(0, headlineField.maxLength)
  }
  const bodyField = definition.textFields.find((field) => field.role === 'body')
  if (bodyField && typeof body === 'string' && body.trim()) {
    draft.text[bodyField.key] = body.trim().slice(0, bodyField.maxLength)
  }

  return draft
}

export function newHookPlan(options: {
  template: VideoTemplate
  definition: NewHookDefinition
  draft: NewHookDraft
  fps: number
}): HookPlan {
  const { template, definition, draft, fps } = options
  // The compiler checks the plan against the manifest range, and the schema refuses anything past
  // 30 seconds. Clamp here so a slider at either end produces a plan rather than an error.
  const durationFrames = Math.max(
    template.duration.minimumFrames,
    Math.min(
      template.duration.maximumFrames,
      Math.min(fps * 30, Math.max(1, Math.round(draft.seconds * fps)))
    )
  )

  const props: JsonObject = { grain: clampUnit(draft.grain) }
  for (const field of definition.textFields) {
    // An emptied field falls back to the delivered default: the schema requires a non-empty
    // headline, so writing '' would fail validation with a message about nothing the user did.
    const typed = (draft.text[field.key] ?? '').trim()
    props[field.key] = (typed || field.default).slice(0, field.maxLength)
  }
  for (const field of definition.numberFields) {
    const raw = draft.numbers[field.key]
    const value = Number.isFinite(raw) ? (raw as number) : field.default
    const bounded = Math.max(field.minimum, Math.min(field.maximum, value))
    props[field.key] = field.integer ? Math.round(bounded) : bounded
  }
  if (definition.usesAccent) {
    props['accentColor'] = normalizedHex(draft.accentColor, NEW_TEMPLATE_ACCENT)
  }

  const headlineField = definition.textFields.find((field) => field.role === 'headline')
  const bodyField = definition.textFields.find((field) => field.role === 'body')
  const headline = String(props[headlineField?.key ?? ''] ?? definition.name).slice(0, 500)
  const body = bodyField ? String(props[bodyField.key] ?? '').slice(0, 2000) : ''

  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: template.id,
    templateVersion: template.version,
    fps,
    title: headline,
    durationFrames,
    props,
    beats: [
      {
        id: 'beat-1',
        startFrame: 0,
        durationFrames,
        headline,
        ...(body ? { body } : {}),
        visual: { kind: 'none' as const }
      }
    ]
  }
}

export interface NewCaptionDraft {
  accentColor: string
  textColor: string
  grain: number
  maxWordsPerCue: number
  maxCharactersPerLine: number
}

export function newCaptionDraft(id: NewCaptionTemplateId): NewCaptionDraft {
  const definition = NEW_CAPTION_DEFINITIONS[id]
  return {
    accentColor: definition.accentColor.toUpperCase(),
    textColor: definition.textColor.toUpperCase(),
    grain: definition.grain,
    maxWordsPerCue: definition.maxWordsPerCue,
    maxCharactersPerLine: definition.maxCharactersPerLine
  }
}

/** The draft a project has actually SAVED, falling back field by field to the table.
 *
 *  Seeding the panel from the table alone meant reopening a project showed default swatches over a
 *  customised project, and the first touch of any control wrote those defaults back — a silent
 *  discard of the user's settings. */
export function newCaptionDraftFromProps(
  id: NewCaptionTemplateId,
  props: JsonObject | undefined
): NewCaptionDraft {
  const base = newCaptionDraft(id)
  if (!props) return base
  const text = props['textColor']
  const accent = props['accentColor']
  const grain = props['grain']
  const words = props['maxWordsPerCue']
  const characters = props['maxCharactersPerLine']
  return {
    accentColor: typeof accent === 'string' ? normalizedHex(accent, base.accentColor) : base.accentColor,
    textColor: typeof text === 'string' ? normalizedHex(text, base.textColor) : base.textColor,
    grain: typeof grain === 'number' && Number.isFinite(grain) ? clampUnit(grain) : base.grain,
    maxWordsPerCue:
      typeof words === 'number' && Number.isFinite(words)
        ? Math.max(1, Math.min(12, Math.round(words)))
        : base.maxWordsPerCue,
    maxCharactersPerLine:
      typeof characters === 'number' && Number.isFinite(characters)
        ? Math.max(10, Math.min(42, Math.round(characters)))
        : base.maxCharactersPerLine
  }
}

export function newCaptionProps(id: NewCaptionTemplateId, draft: NewCaptionDraft): JsonObject {
  const definition = NEW_CAPTION_DEFINITIONS[id]
  const bounded = (value: number, fallback: number, minimum: number, maximum: number): number =>
    Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.round(value))) : fallback
  return {
    accentColor: normalizedHex(draft.accentColor, definition.accentColor),
    textColor: normalizedHex(draft.textColor, definition.textColor),
    grain: clampUnit(draft.grain),
    maxWordsPerCue: bounded(draft.maxWordsPerCue, definition.maxWordsPerCue, 1, 12),
    maxCharactersPerLine: bounded(
      draft.maxCharactersPerLine,
      definition.maxCharactersPerLine,
      10,
      42
    )
  }
}
