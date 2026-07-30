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
