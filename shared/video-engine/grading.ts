import { z } from 'zod'
import { StableIdSchema, UnitIntervalSchema } from './common'

export const VideoGradingSchema = z.strictObject({
  enabled: z.boolean(),
  lutAssetId: StableIdSchema.optional(),
  lutIntensity: UnitIntervalSchema,
  exposure: z.number().finite().min(-5).max(5),
  contrast: z.number().finite().min(-1).max(1),
  saturation: z.number().finite().min(0).max(2),
  temperature: z.number().finite().min(-1).max(1),
  tint: z.number().finite().min(-1).max(1),
  vignette: UnitIntervalSchema,
  grain: UnitIntervalSchema,
})
export type VideoGrading = z.infer<typeof VideoGradingSchema>

export const DEFAULT_VIDEO_GRADING: VideoGrading = Object.freeze({
  enabled: false,
  lutIntensity: 1,
  exposure: 0,
  contrast: 0,
  saturation: 1,
  temperature: 0,
  tint: 0,
  vignette: 0,
  grain: 0,
})
