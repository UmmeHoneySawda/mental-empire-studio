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

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Clamp rather than reject. The editor writes the grade into the project locally on every
 *  slider event and only re-validates at the debounced save, so an out-of-range value would
 *  surface as a save failure seconds after the drag that caused it. Bounds must match the
 *  schema above — that is why this lives beside it. */
export function clampVideoGrading(grading: VideoGrading): VideoGrading {
  return {
    ...grading,
    lutIntensity: clamp(grading.lutIntensity, 0, 1),
    exposure: clamp(grading.exposure, -5, 5),
    contrast: clamp(grading.contrast, -1, 1),
    saturation: clamp(grading.saturation, 0, 2),
    temperature: clamp(grading.temperature, -1, 1),
    tint: clamp(grading.tint, -1, 1),
    vignette: clamp(grading.vignette, 0, 1),
    grain: clamp(grading.grain, 0, 1),
  }
}

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
