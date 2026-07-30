import { z } from 'zod'
import {
  HexColorSchema,
  JsonObject,
  JsonObjectSchema,
  JsonValue,
  RendererIdSchema,
  StableIdSchema,
  uniqueBy,
} from './common'
import { VideoScene, VideoSceneSchema } from './model'

export const TemplateKindSchema = z.enum(['hook', 'caption', 'transition', 'scene', 'overlay'])
export type TemplateKind = z.infer<typeof TemplateKindSchema>

export const TemplateCapabilitySchema = z.enum([
  'audio',
  'broll',
  'captions',
  'dynamic-duration',
  'lut-grading',
  'transparent-background',
  'transitions',
  'word-highlighting',
])
export type TemplateCapability = z.infer<typeof TemplateCapabilitySchema>

export const TemplateAspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '4:5', 'custom'])
export type TemplateAspectRatio = z.infer<typeof TemplateAspectRatioSchema>

const ParameterBase = {
  key: StableIdSchema,
  label: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1000).optional(),
  required: z.boolean().default(false),
} as const

export const TemplateStringParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('string'),
  default: z.string().max(20_000).optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
})
export const TemplateNumberParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('number'),
  default: z.number().finite().optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  integer: z.boolean().default(false),
})
export const TemplateBooleanParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('boolean'),
  default: z.boolean().optional(),
})
export const TemplateColorParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('color'),
  default: HexColorSchema.optional(),
})
export const TemplateEnumParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('enum'),
  values: z.array(z.string().min(1).max(256)).min(1).max(500),
  default: z.string().min(1).max(256).optional(),
})
export const TemplateAssetParameterSchema = z.strictObject({
  ...ParameterBase,
  type: z.literal('asset'),
  acceptedKinds: z
    .array(z.enum(['video', 'audio', 'image', 'font', 'lut', 'other']))
    .min(1)
    .max(6),
  default: StableIdSchema.optional(),
})

export const TemplateParameterSchema = z.discriminatedUnion('type', [
  TemplateStringParameterSchema,
  TemplateNumberParameterSchema,
  TemplateBooleanParameterSchema,
  TemplateColorParameterSchema,
  TemplateEnumParameterSchema,
  TemplateAssetParameterSchema,
])
export type TemplateParameter = z.infer<typeof TemplateParameterSchema>

export const TemplateDurationSchema = z
  .strictObject({
    minimumFrames: z.number().int().positive(),
    maximumFrames: z.number().int().positive(),
    defaultFrames: z.number().int().positive(),
  })
  .refine(
    (duration) =>
      duration.minimumFrames <= duration.defaultFrames &&
      duration.defaultFrames <= duration.maximumFrames,
    { message: 'defaultFrames must be inside the template duration range' },
  )
export type TemplateDuration = z.infer<typeof TemplateDurationSchema>

function parameterValueError(parameter: TemplateParameter, value: JsonValue): string | null {
  switch (parameter.type) {
    case 'string':
      if (typeof value !== 'string') return 'must be a string'
      if (parameter.minLength !== undefined && value.length < parameter.minLength) {
        return `must contain at least ${parameter.minLength} characters`
      }
      if (parameter.maxLength !== undefined && value.length > parameter.maxLength) {
        return `must contain no more than ${parameter.maxLength} characters`
      }
      return null
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number'
      if (parameter.integer && !Number.isInteger(value)) return 'must be an integer'
      if (parameter.minimum !== undefined && value < parameter.minimum) {
        return `must be at least ${parameter.minimum}`
      }
      if (parameter.maximum !== undefined && value > parameter.maximum) {
        return `must be at most ${parameter.maximum}`
      }
      return null
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean'
    case 'color':
      return HexColorSchema.safeParse(value).success ? null : 'must be a hex color'
    case 'enum':
      return typeof value === 'string' && parameter.values.includes(value)
        ? null
        : `must be one of: ${parameter.values.join(', ')}`
    case 'asset':
      return StableIdSchema.safeParse(value).success ? null : 'must be a stable asset ID'
  }
}

export const TemplateManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: StableIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version x.y.z'),
    rendererId: RendererIdSchema,
    kind: TemplateKindSchema,
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().max(5000).optional(),
    implementationId: StableIdSchema,
    aspectRatios: z.array(TemplateAspectRatioSchema).min(1).max(5),
    duration: TemplateDurationSchema,
    capabilities: z.array(TemplateCapabilitySchema).max(20).default([]),
    parameters: z.array(TemplateParameterSchema).max(500).default([]),
    previewAssetId: StableIdSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  })
  .superRefine((manifest, context) => {
    if (!uniqueBy(manifest.parameters, (parameter) => parameter.key)) {
      context.addIssue({
        code: 'custom',
        path: ['parameters'],
        message: 'Template parameter keys must be unique',
      })
    }
    if (!uniqueBy(manifest.capabilities, (capability) => capability)) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Template capabilities must be unique',
      })
    }
    if (!uniqueBy(manifest.aspectRatios, (ratio) => ratio)) {
      context.addIssue({
        code: 'custom',
        path: ['aspectRatios'],
        message: 'Template aspect ratios must be unique',
      })
    }
    for (let index = 0; index < manifest.parameters.length; index += 1) {
      const parameter = manifest.parameters[index]!
      if (
        parameter.type === 'string' &&
        parameter.minLength !== undefined &&
        parameter.maxLength !== undefined &&
        parameter.minLength > parameter.maxLength
      ) {
        context.addIssue({
          code: 'custom',
          path: ['parameters', index, 'maxLength'],
          message: 'maxLength must be at least minLength',
        })
      }
      if (
        parameter.type === 'number' &&
        parameter.minimum !== undefined &&
        parameter.maximum !== undefined &&
        parameter.minimum > parameter.maximum
      ) {
        context.addIssue({
          code: 'custom',
          path: ['parameters', index, 'maximum'],
          message: 'maximum must be at least minimum',
        })
      }
      if (parameter.type === 'enum' && !uniqueBy(parameter.values, (value) => value)) {
        context.addIssue({
          code: 'custom',
          path: ['parameters', index, 'values'],
          message: 'Enum values must be unique',
        })
      }
      if (parameter.default !== undefined) {
        const message = parameterValueError(parameter, parameter.default)
        if (message) {
          context.addIssue({
            code: 'custom',
            path: ['parameters', index, 'default'],
            message: `Default ${message}`,
          })
        }
      }
    }
  })
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>

export interface TemplateFilter {
  rendererId?: TemplateManifest['rendererId']
  kind?: TemplateKind
  aspectRatio?: TemplateAspectRatio
  capabilities?: readonly TemplateCapability[]
}

export interface InstantiateTemplateInput {
  templateId: string
  templateVersion?: string
  instanceId: string
  trackId: string
  startFrame: number
  durationFrames?: number
  zIndex?: number
  props?: JsonObject
}

export interface TemplateInstantiation {
  manifest: TemplateManifest
  scene: VideoScene
}

function manifestKey(id: string, version: string): string {
  return `${id}@${version}`
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = a[index]! - b[index]!
    if (difference !== 0) return difference
  }
  return 0
}

export function resolveTemplateProps(
  manifestInput: TemplateManifest,
  propsInput: JsonObject = {},
): JsonObject {
  const manifest = TemplateManifestSchema.parse(manifestInput)
  const props = JsonObjectSchema.parse(propsInput)
  const definitions = new Map(manifest.parameters.map((parameter) => [parameter.key, parameter]))
  for (const key of Object.keys(props)) {
    if (!definitions.has(key)) throw new Error(`Unknown template property: ${key}`)
  }
  const resolved: JsonObject = {}
  for (const parameter of manifest.parameters) {
    const supplied = props[parameter.key]
    const value = supplied === undefined ? parameter.default : supplied
    if (value === undefined) {
      if (parameter.required) throw new Error(`Missing required template property: ${parameter.key}`)
      continue
    }
    const message = parameterValueError(parameter, value)
    if (message) throw new Error(`Template property ${parameter.key} ${message}`)
    resolved[parameter.key] = value
  }
  return resolved
}

export class TemplateRegistry {
  private readonly manifests = new Map<string, TemplateManifest>()

  constructor(initial: readonly z.input<typeof TemplateManifestSchema>[] = []) {
    for (const manifest of initial) this.register(manifest)
  }

  register(input: z.input<typeof TemplateManifestSchema>): TemplateManifest {
    const manifest = TemplateManifestSchema.parse(input)
    const key = manifestKey(manifest.id, manifest.version)
    if (this.manifests.has(key)) throw new Error(`Template already registered: ${key}`)
    this.manifests.set(key, manifest)
    return manifest
  }

  get(idInput: string, versionInput?: string): TemplateManifest | undefined {
    const id = StableIdSchema.parse(idInput)
    if (versionInput) return this.manifests.get(manifestKey(id, versionInput))
    return [...this.manifests.values()]
      .filter((manifest) => manifest.id === id)
      .sort((left, right) => compareVersions(right.version, left.version))[0]
  }

  require(id: string, version?: string): TemplateManifest {
    const manifest = this.get(id, version)
    if (!manifest) throw new Error(`Unknown template: ${version ? manifestKey(id, version) : id}`)
    return manifest
  }

  list(filter: TemplateFilter = {}): TemplateManifest[] {
    const requiredCapabilities = filter.capabilities ?? []
    return [...this.manifests.values()]
      .filter((manifest) => !filter.rendererId || manifest.rendererId === filter.rendererId)
      .filter((manifest) => !filter.kind || manifest.kind === filter.kind)
      .filter(
        (manifest) =>
          !filter.aspectRatio || manifest.aspectRatios.includes(filter.aspectRatio),
      )
      .filter((manifest) =>
        requiredCapabilities.every((capability) => manifest.capabilities.includes(capability)),
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) || compareVersions(right.version, left.version),
      )
  }

  instantiate(input: InstantiateTemplateInput): TemplateInstantiation {
    const manifest = this.require(input.templateId, input.templateVersion)
    const durationFrames = input.durationFrames ?? manifest.duration.defaultFrames
    if (
      !Number.isInteger(durationFrames) ||
      durationFrames < manifest.duration.minimumFrames ||
      durationFrames > manifest.duration.maximumFrames
    ) {
      throw new Error(
        `Template duration must be between ${manifest.duration.minimumFrames} and ${manifest.duration.maximumFrames} frames`,
      )
    }
    const props = resolveTemplateProps(manifest, input.props)
    const scene = VideoSceneSchema.parse({
      id: input.instanceId,
      trackId: input.trackId,
      kind: 'template',
      startFrame: input.startFrame,
      durationFrames,
      zIndex: input.zIndex ?? 0,
      template: {
        id: manifest.id,
        version: manifest.version,
        rendererId: manifest.rendererId,
        props,
      },
    })
    return { manifest, scene }
  }
}
