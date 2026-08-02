import { z } from 'zod'

export const RendererIdSchema = z.enum(['remotion', 'hyperframes'])
export type RendererId = z.infer<typeof RendererIdSchema>

export const StableIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Expected a stable identifier')

export const FrameSchema = z.number().int().nonnegative()
export const PositiveFrameSchema = z.number().int().positive()
export const UnitIntervalSchema = z.number().finite().min(0).max(1)
export const HexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/, 'Expected #RRGGBB or #RRGGBBAA')
export const IsoDateTimeSchema = z.iso.datetime({ offset: true })
export const UriSchema = z.string().trim().min(1).max(4096)

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

interface RgbaChannels {
  readonly red: number
  readonly green: number
  readonly blue: number
  readonly alpha: number
}

function hexChannels(color: string): RgbaChannels {
  const value = HexColorSchema.parse(color).slice(1)
  return {
    red: Number.parseInt(value.slice(0, 2), 16),
    green: Number.parseInt(value.slice(2, 4), 16),
    blue: Number.parseInt(value.slice(4, 6), 16),
    alpha: value.length === 8 ? Number.parseInt(value.slice(6, 8), 16) / 255 : 1,
  }
}

/** Apply an opacity to either accepted hex form. Existing #RRGGBBAA alpha is replaced,
 * never appended into the invalid ten-digit color that CSS rejects. */
export function hexColorWithAlpha(color: string, opacity: number): string {
  if (!Number.isFinite(opacity)) throw new Error('Hex color opacity must be finite')
  const rgb = HexColorSchema.parse(color).slice(0, 7).toUpperCase()
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase()
  return `${rgb}${alpha}`
}

function relativeLuminance(channels: Pick<RgbaChannels, 'red' | 'green' | 'blue'>): number {
  const linear = ([channels.red, channels.green, channels.blue] as const).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrastRatio(left: number, right: number): number {
  const lighter = Math.max(left, right)
  const darker = Math.min(left, right)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Pick the more legible caption foreground. Transparent fills are composited over the
 * renderer's dark caption backdrop before contrast is compared. */
export function readableTextColor(backgroundColor: string): '#07090D' | '#FFFFFF' {
  const background = hexChannels(backgroundColor)
  const backdrop = hexChannels('#07090D')
  const composited = {
    red: background.red * background.alpha + backdrop.red * (1 - background.alpha),
    green: background.green * background.alpha + backdrop.green * (1 - background.alpha),
    blue: background.blue * background.alpha + backdrop.blue * (1 - background.alpha),
  }
  const backgroundLuminance = relativeLuminance(composited)
  const darkContrast = contrastRatio(backgroundLuminance, relativeLuminance(hexChannels('#07090D')))
  const lightContrast = contrastRatio(backgroundLuminance, relativeLuminance(hexChannels('#FFFFFF')))
  return darkContrast >= lightContrast ? '#07090D' : '#FFFFFF'
}

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

export const JsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), JsonValueSchema)

const FORBIDDEN_AI_FIELD_NAMES = new Set([
  'code',
  'command',
  'component',
  'css',
  'dangerouslysetinnerhtml',
  'entrypoint',
  'eval',
  'executable',
  'function',
  'html',
  'import',
  'imports',
  'javascript',
  'js',
  'jsx',
  'shell',
  'sourcecode',
  'script',
  'tsx',
  'typescript',
])

function normalizedFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * AI responses are data-only. This rejects fields commonly used to smuggle executable
 * implementations even when they are nested below an otherwise allowed property.
 */
export function findForbiddenAiPayloadField(
  value: unknown,
  path: readonly (string | number)[] = [],
): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenAiPayloadField(value[index], [...path, index])
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key]
    if (FORBIDDEN_AI_FIELD_NAMES.has(normalizedFieldName(key))) {
      return childPath.map(String).join('.')
    }
    const found = findForbiddenAiPayloadField(child, childPath)
    if (found) return found
  }
  return null
}

export function assertDataOnlyAiPayload(value: unknown): void {
  const field = findForbiddenAiPayloadField(value)
  if (field) throw new Error(`AI payload contains forbidden code-like field: ${field}`)
}

export function parseJsonInput(input: string | unknown, maxCharacters = 1_000_000): unknown {
  if (typeof input !== 'string') return input
  if (input.length > maxCharacters) throw new Error('JSON payload is too large')
  let text = input.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  if (fenced) text = fenced[1]!.trim()
  if (!text) throw new Error('JSON payload is empty')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean {
  const seen = new Set<string>()
  for (const value of values) {
    const candidate = key(value)
    if (seen.has(candidate)) return false
    seen.add(candidate)
  }
  return true
}
