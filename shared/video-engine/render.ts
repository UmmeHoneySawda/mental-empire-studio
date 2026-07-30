import { z } from 'zod'
import {
  IsoDateTimeSchema,
  RendererId,
  RendererIdSchema,
  StableIdSchema,
  UnitIntervalSchema,
  UriSchema,
} from './common'
import { VideoProject, VideoProjectSchema } from './model'
import { TemplateKindSchema } from './templates'
import { TransitionTypeSchema } from './transitions'

export const RenderContainerSchema = z.enum(['mp4', 'mov', 'webm'])
export type RenderContainer = z.infer<typeof RenderContainerSchema>

export const VideoCodecSchema = z.enum(['h264', 'h265', 'vp9', 'prores'])
export type VideoCodec = z.infer<typeof VideoCodecSchema>

export const AudioCodecSchema = z.enum(['aac', 'opus', 'pcm'])
export type AudioCodec = z.infer<typeof AudioCodecSchema>

export const RenderOutputSchema = z.strictObject({
  uri: UriSchema,
  container: RenderContainerSchema,
  videoCodec: VideoCodecSchema,
  audioCodec: AudioCodecSchema,
  quality: z.number().int().min(0).max(100).optional(),
  overwrite: z.boolean().optional(),
})
export type RenderOutput = z.infer<typeof RenderOutputSchema>

export const RenderRequestSchema = z.strictObject({
  id: StableIdSchema,
  project: VideoProjectSchema,
  output: RenderOutputSchema,
})
export type RenderRequest = z.infer<typeof RenderRequestSchema>

export const RenderStageSchema = z.enum([
  'queued',
  'validating',
  'preparing',
  'rendering',
  'grading',
  'muxing',
  'completed',
  'failed',
  'canceled',
])
export type RenderStage = z.infer<typeof RenderStageSchema>

export const RenderProgressSchema = z
  .strictObject({
    requestId: StableIdSchema,
    rendererId: RendererIdSchema,
    stage: RenderStageSchema,
    progress: UnitIntervalSchema,
    frame: z.number().int().nonnegative().optional(),
    totalFrames: z.number().int().positive().optional(),
    message: z.string().trim().min(1).max(1000).optional(),
  })
  .refine(
    (progress) =>
      progress.frame === undefined ||
      progress.totalFrames === undefined ||
      progress.frame <= progress.totalFrames,
    { path: ['frame'], message: 'frame cannot exceed totalFrames' },
  )
export type RenderProgress = z.infer<typeof RenderProgressSchema>

export const RenderResultSchema = z.strictObject({
  requestId: StableIdSchema,
  rendererId: RendererIdSchema,
  outputUri: UriSchema,
  durationFrames: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().positive(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  checksum: z.string().trim().min(8).max(256).optional(),
  warnings: z.array(z.string().trim().min(1).max(1000)).max(1000),
})
export type RenderResult = z.infer<typeof RenderResultSchema>

export const RenderValidationIssueSchema = z.strictObject({
  code: StableIdSchema,
  path: z.string().max(2000),
  message: z.string().trim().min(1).max(5000),
  severity: z.enum(['error', 'warning']),
})
export type RenderValidationIssue = z.infer<typeof RenderValidationIssueSchema>

export const RendererCapabilitiesSchema = z.strictObject({
  rendererId: RendererIdSchema,
  supportedTemplateKinds: z.array(TemplateKindSchema),
  supportedTransitions: z.array(TransitionTypeSchema),
  supportsWordHighlighting: z.boolean(),
  supportsLutGrading: z.boolean(),
  supportsAlpha: z.boolean(),
  maxWidth: z.number().int().positive(),
  maxHeight: z.number().int().positive(),
  maxFps: z.number().int().positive(),
})
export type RendererCapabilities = z.infer<typeof RendererCapabilitiesSchema>

export interface RenderOptions {
  signal: AbortSignal
  onProgress?: (progress: RenderProgress) => void
}

export interface RendererAdapter {
  readonly id: RendererId
  capabilities(): RendererCapabilities | Promise<RendererCapabilities>
  validate(project: VideoProject): RenderValidationIssue[] | Promise<RenderValidationIssue[]>
  render(request: RenderRequest, options: RenderOptions): Promise<RenderResult>
}
