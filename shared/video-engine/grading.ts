import { z } from 'zod'
import { StableIdSchema, UnitIntervalSchema } from './common'
import type { VideoGradingPreset } from './ipc'

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

export const VIDEO_GRADING_PRESETS: readonly VideoGradingPreset[] = Object.freeze([
  {
    id: 'off',
    name: 'None',
    description: 'Pass the renderer output through untouched.',
    grading: { ...DEFAULT_VIDEO_GRADING },
  },
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    description: 'The blockbuster split-tone: cool shadows, warm skin, firm contrast.',
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: 0.03,
      contrast: 0.16,
      saturation: 1.12,
      temperature: 0.12,
      tint: -0.05,
      vignette: 0.2,
      grain: 0.03,
    },
  },
  {
    id: 'bleach-noir',
    name: 'Bleach Noir',
    description: 'Desaturated, high-contrast monochrome lean for tension segments.',
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: -0.04,
      contrast: 0.3,
      saturation: 0.42,
      temperature: -0.06,
      tint: 0.02,
      vignette: 0.34,
      grain: 0.08,
    },
  },
  {
    id: 'warm-doc',
    name: 'Warm Documentary',
    description: 'Gentle warmth and lifted mids — reads honest, not stylized.',
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: 0.07,
      contrast: 0.06,
      saturation: 1.04,
      temperature: 0.16,
      tint: 0.03,
      vignette: 0.12,
      grain: 0.02,
    },
  },
  {
    id: 'cold-clinical',
    name: 'Cold Clinical',
    description: 'Blue-shifted and clean, for data and explainer segments.',
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: 0.02,
      contrast: 0.12,
      saturation: 0.94,
      temperature: -0.18,
      tint: -0.04,
      vignette: 0.08,
      grain: 0,
    },
  },
  {
    id: 'retro-film',
    name: 'Retro Film',
    description: 'Faded blacks, heavier grain, and a warm cast for archival texture.',
    grading: {
      enabled: true,
      lutIntensity: 1,
      exposure: 0.05,
      contrast: -0.08,
      saturation: 0.88,
      temperature: 0.22,
      tint: 0.06,
      vignette: 0.28,
      grain: 0.14,
    },
  },
])
