import { z } from 'zod'
import { BrollLicenseMetadataSchema } from './broll'
import { CaptionDocumentSchema } from './captions'
import {
  FrameSchema,
  HexColorSchema,
  IsoDateTimeSchema,
  JsonObjectSchema,
  RendererIdSchema,
  StableIdSchema,
  UnitIntervalSchema,
  UriSchema,
  uniqueBy,
} from './common'
import { DEFAULT_VIDEO_GRADING, VideoGradingSchema } from './grading'
import { VideoTransitionSchema } from './transitions'

export const VIDEO_PROJECT_SCHEMA_VERSION = 1 as const

export const VideoCanvasSchema = z.strictObject({
  width: z.number().int().min(16).max(16384),
  height: z.number().int().min(16).max(16384),
  fps: z.number().int().min(1).max(240),
  durationFrames: z.number().int().positive(),
  backgroundColor: HexColorSchema,
})
export type VideoCanvas = z.infer<typeof VideoCanvasSchema>

export const AssetKindSchema = z.enum(['video', 'audio', 'image', 'font', 'lut', 'other'])
export type AssetKind = z.infer<typeof AssetKindSchema>

export const AssetSourceSchema = z
  .strictObject({
    kind: z.enum(['local', 'generated', 'stock']),
    provider: z.string().trim().min(1).max(128).optional(),
    providerAssetId: z.string().trim().min(1).max(256).optional(),
    sourceUrl: UriSchema.optional(),
    licenseName: z.string().trim().min(1).max(256).optional(),
    licenseUrl: UriSchema.optional(),
    attribution: z.string().trim().min(1).max(1000).optional(),
    author: z.string().trim().min(1).max(256).optional(),
  })
  .superRefine((source, context) => {
    if (source.kind === 'stock') {
      for (const key of ['provider', 'providerAssetId', 'sourceUrl', 'licenseName'] as const) {
        if (!source[key]) {
          context.addIssue({
            code: 'custom',
            path: [key],
            message: `Stock assets require ${key}`,
          })
        }
      }
    }
  })
export type AssetSource = z.infer<typeof AssetSourceSchema>

export const VideoAssetSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().trim().min(1).max(512),
  kind: AssetKindSchema,
  uri: UriSchema,
  mimeType: z.string().trim().min(1).max(256).optional(),
  checksum: z.string().trim().min(8).max(256).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationFrames: z.number().int().positive().optional(),
  source: AssetSourceSchema.optional(),
})
export type VideoAsset = z.infer<typeof VideoAssetSchema>

export function assetSourceFromBrollLicense(
  input: z.input<typeof BrollLicenseMetadataSchema>,
): AssetSource {
  const license = BrollLicenseMetadataSchema.parse(input)
  return AssetSourceSchema.parse({
    kind: 'stock',
    provider: license.provider,
    providerAssetId: license.providerAssetId,
    sourceUrl: license.sourceUrl,
    licenseName: license.licenseName,
    licenseUrl: license.licenseUrl,
    attribution: license.attribution,
    author: license.author,
  })
}

export const TrackKindSchema = z.enum(['video', 'audio', 'overlay', 'caption'])
export type TrackKind = z.infer<typeof TrackKindSchema>

export const VideoTrackSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().trim().min(1).max(256),
  kind: TrackKindSchema,
  order: z.number().int(),
  muted: z.boolean(),
  locked: z.boolean(),
})
export type VideoTrack = z.infer<typeof VideoTrackSchema>

export const VideoTransformSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  scaleX: z.number().finite().positive(),
  scaleY: z.number().finite().positive(),
  rotationDeg: z.number().finite().min(-3600).max(3600),
  anchorX: z.number().finite(),
  anchorY: z.number().finite(),
})
export type VideoTransform = z.infer<typeof VideoTransformSchema>

export const DEFAULT_VIDEO_TRANSFORM: VideoTransform = Object.freeze({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
  anchorX: 0.5,
  anchorY: 0.5,
})

export const AssetSourceRangeSchema = z.strictObject({
  startFrame: FrameSchema,
  durationFrames: z.number().int().positive(),
})
export type AssetSourceRange = z.infer<typeof AssetSourceRangeSchema>

export const TemplateReferenceSchema = z.strictObject({
  id: StableIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected semantic version x.y.z'),
  rendererId: RendererIdSchema,
  props: JsonObjectSchema,
})
export type TemplateReference = z.infer<typeof TemplateReferenceSchema>

export const SceneKindSchema = z.enum(['media', 'audio', 'template', 'text', 'solid', 'caption'])
export type SceneKind = z.infer<typeof SceneKindSchema>

export const VideoSceneSchema = z
  .strictObject({
    id: StableIdSchema,
    trackId: StableIdSchema,
    kind: SceneKindSchema,
    startFrame: FrameSchema,
    durationFrames: z.number().int().positive(),
    zIndex: z.number().int(),
    assetId: StableIdSchema.optional(),
    template: TemplateReferenceSchema.optional(),
    text: z.string().max(20_000).optional(),
    color: HexColorSchema.optional(),
    transform: VideoTransformSchema.optional(),
    sourceRange: AssetSourceRangeSchema.optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    opacity: UnitIntervalSchema.optional(),
    volume: z.number().finite().min(0).max(2).optional(),
  })
  .superRefine((scene, context) => {
    if ((scene.kind === 'media' || scene.kind === 'audio') && !scene.assetId) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: `${scene.kind} scenes require assetId`,
      })
    }
    if (scene.kind === 'template' && !scene.template) {
      context.addIssue({
        code: 'custom',
        path: ['template'],
        message: 'Template scenes require a template reference',
      })
    }
    if (scene.kind === 'text' && scene.text === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'Text scenes require text',
      })
    }
    if (scene.kind === 'solid' && !scene.color) {
      context.addIssue({
        code: 'custom',
        path: ['color'],
        message: 'Solid scenes require color',
      })
    }
  })
export type VideoScene = z.infer<typeof VideoSceneSchema>

export const VideoProjectMetadataSchema = z.strictObject({
  description: z.string().trim().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  templateId: StableIdSchema.optional(),
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
})
export type VideoProjectMetadata = z.infer<typeof VideoProjectMetadataSchema>

export function sanitizeTransitions(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }
  const record = input as Record<string, any>
  if (!Array.isArray(record.transitions) || !Array.isArray(record.scenes)) {
    return input
  }
  const sceneMap = new Map(record.scenes.filter((s: any) => s && typeof s.id === 'string').map((s: any) => [s.id, s]))
  const sanitizedTransitions = record.transitions.map((trans: any) => {
    if (!trans || typeof trans !== 'object') return trans
    const from = sceneMap.get(trans.fromSceneId)
    const to = sceneMap.get(trans.toSceneId)
    if (!from || !to) return trans

    let durationFrames = typeof trans.durationFrames === 'number' ? trans.durationFrames : 0
    if (trans.type === 'cut') {
      durationFrames = 0
    } else if (durationFrames > 0) {
      const maxAllowed = Math.min(from.durationFrames, to.durationFrames)
      if (Number.isFinite(maxAllowed) && durationFrames > maxAllowed) {
        durationFrames = Math.max(0, maxAllowed)
      }
    }

    return {
      ...trans,
      durationFrames,
      startFrame: Math.max(0, from.startFrame + from.durationFrames - durationFrames)
    }
  })

  return { ...record, transitions: sanitizedTransitions }
}

const RawVideoProjectSchema = z
  .strictObject({
    schemaVersion: z.literal(VIDEO_PROJECT_SCHEMA_VERSION),
    id: StableIdSchema,
    name: z.string().trim().min(1).max(512),
    revision: z.number().int().nonnegative(),
    rendererId: RendererIdSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    canvas: VideoCanvasSchema,
    assets: z.array(VideoAssetSchema).max(100_000),
    tracks: z.array(VideoTrackSchema).max(10_000),
    scenes: z.array(VideoSceneSchema).max(500_000),
    captions: CaptionDocumentSchema.optional(),
    transitions: z.array(VideoTransitionSchema).max(100_000),
    grading: VideoGradingSchema,
    metadata: VideoProjectMetadataSchema.optional(),
  })
  .superRefine((project, context) => {
    if (!uniqueBy(project.assets, (asset) => asset.id)) {
      context.addIssue({ code: 'custom', path: ['assets'], message: 'Asset IDs must be unique' })
    }
    if (!uniqueBy(project.tracks, (track) => track.id)) {
      context.addIssue({ code: 'custom', path: ['tracks'], message: 'Track IDs must be unique' })
    }
    if (!uniqueBy(project.scenes, (scene) => scene.id)) {
      context.addIssue({ code: 'custom', path: ['scenes'], message: 'Scene IDs must be unique' })
    }
    if (!uniqueBy(project.transitions, (transition) => transition.id)) {
      context.addIssue({
        code: 'custom',
        path: ['transitions'],
        message: 'Transition IDs must be unique',
      })
    }
    if (project.metadata?.tags && !uniqueBy(project.metadata.tags, (tag) => tag.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'tags'],
        message: 'Project tags must be unique',
      })
    }

    const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
    const tracks = new Map(project.tracks.map((track) => [track.id, track]))
    const scenes = new Map(project.scenes.map((scene) => [scene.id, scene]))
    for (let index = 0; index < project.scenes.length; index += 1) {
      const scene = project.scenes[index]!
      if (!tracks.has(scene.trackId)) {
        context.addIssue({
          code: 'custom',
          path: ['scenes', index, 'trackId'],
          message: `Unknown track ID: ${scene.trackId}`,
        })
      }
      if (scene.assetId && !assets.has(scene.assetId)) {
        context.addIssue({
          code: 'custom',
          path: ['scenes', index, 'assetId'],
          message: `Unknown asset ID: ${scene.assetId}`,
        })
      }
      if (scene.startFrame + scene.durationFrames > project.canvas.durationFrames) {
        context.addIssue({
          code: 'custom',
          path: ['scenes', index, 'durationFrames'],
          message: 'Scene extends beyond the project duration',
        })
      }
      if (scene.template && scene.template.rendererId !== project.rendererId) {
        context.addIssue({
          code: 'custom',
          path: ['scenes', index, 'template', 'rendererId'],
          message: 'Scene template renderer must match the project renderer',
        })
      }
      if (scene.sourceRange && scene.assetId) {
        const asset = assets.get(scene.assetId)
        if (
          asset?.durationFrames !== undefined &&
          scene.sourceRange.startFrame + scene.sourceRange.durationFrames > asset.durationFrames
        ) {
          context.addIssue({
            code: 'custom',
            path: ['scenes', index, 'sourceRange'],
            message: 'Source range extends beyond the asset duration',
          })
        }
      }
    }

    for (let index = 0; index < project.transitions.length; index += 1) {
      const transition = project.transitions[index]!
      const from = scenes.get(transition.fromSceneId)
      const to = scenes.get(transition.toSceneId)
      if (!from) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'fromSceneId'],
          message: `Unknown scene ID: ${transition.fromSceneId}`,
        })
      }
      if (!to) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'toSceneId'],
          message: `Unknown scene ID: ${transition.toSceneId}`,
        })
      }
      if (
        transition.durationFrames > 0 &&
        ((from && transition.durationFrames > from.durationFrames) ||
          (to && transition.durationFrames > to.durationFrames))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'durationFrames'],
          message: 'Transition duration cannot exceed either connected scene',
        })
      }
    }

    if (project.captions) {
      for (let index = 0; index < project.captions.words.length; index += 1) {
        if (project.captions.words[index]!.endFrame > project.canvas.durationFrames) {
          context.addIssue({
            code: 'custom',
            path: ['captions', 'words', index, 'endFrame'],
            message: 'Caption word extends beyond the project duration',
          })
        }
      }
    }

    if (project.grading.lutAssetId) {
      const lut = assets.get(project.grading.lutAssetId)
      if (!lut) {
        context.addIssue({
          code: 'custom',
          path: ['grading', 'lutAssetId'],
          message: `Unknown LUT asset ID: ${project.grading.lutAssetId}`,
        })
      } else if (lut.kind !== 'lut') {
        context.addIssue({
          code: 'custom',
          path: ['grading', 'lutAssetId'],
          message: 'lutAssetId must reference a LUT asset',
        })
      }
    }
  })

export const VideoProjectSchema = z.preprocess(
  sanitizeTransitions,
  RawVideoProjectSchema
) as unknown as typeof RawVideoProjectSchema
export type VideoProject = z.infer<typeof VideoProjectSchema>
export type VideoProjectV1 = VideoProject

export function createEmptyVideoProject(input: {
  id: string
  name: string
  rendererId: z.input<typeof RendererIdSchema>
  width: number
  height: number
  fps: number
  durationFrames: number
  now?: string
}): VideoProject {
  const now = input.now ?? new Date().toISOString()
  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    revision: 0,
    rendererId: input.rendererId,
    createdAt: now,
    updatedAt: now,
    canvas: {
      width: input.width,
      height: input.height,
      fps: input.fps,
      durationFrames: input.durationFrames,
      backgroundColor: '#000000',
    },
    assets: [],
    tracks: [],
    scenes: [],
    transitions: [],
    grading: DEFAULT_VIDEO_GRADING,
  })
}
