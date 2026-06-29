import type { VideoStyle } from '../../../shared/types'
import type { GradeParams, GrainParams } from '../../../shared/renderSpec'

export function gradeChain(style: VideoStyle | undefined): string {
  switch (style) {
    case 'Cinematic':
      return [
        'curves=preset=medium_contrast',
        'colorbalance=rs=0.08:gs=-0.02:bs=-0.08:rm=0.03:gm=0.00:bm=-0.04:rh=0.02:gh=0.00:bh=-0.03',
        'eq=saturation=1.12:contrast=1.06:brightness=-0.015',
        'noise=alls=8:allf=t',
        'vignette=PI/5'
      ].join(',') + ','
    case 'Intense':
      return [
        'curves=preset=strong_contrast',
        'eq=saturation=1.18:contrast=1.13',
        'unsharp=5:5:0.45:3:3:0.2',
        'vignette=PI/7'
      ].join(',') + ','
    case 'Heartfelt':
      return [
        'colorbalance=rs=0.06:gs=0.02:bs=-0.05:rm=0.04:gm=0.01:bm=-0.03',
        'eq=saturation=1.06:contrast=1.02:brightness=0.01',
        'vignette=PI/8'
      ].join(',') + ','
    case 'Clean':
    case 'None':
    default:
      return ''
  }
}

/**
 * Numeric sibling of gradeChain() for the GPU compositor. Returns the SAME look as a
 * shader-friendly parameter set (saturation/contrast/brightness multipliers, a per-channel
 * colour-balance bias, vignette + sharpen strengths) plus the matching film-grain spec.
 * The values mirror the ffmpeg filter constants used in gradeChain() so the GPU and
 * ffmpeg outputs stay visually comparable. Pure + unit-tested.
 */
export function gradeParams(style: VideoStyle | undefined): { grade: GradeParams; grain: GrainParams } {
  const base = (s: VideoStyle): GradeParams => ({
    style: s,
    saturation: 1,
    contrast: 1,
    brightness: 0,
    colorBalance: { r: 0, g: 0, b: 0 },
    vignette: 0,
    sharpen: 0
  })
  switch (style) {
    case 'Cinematic':
      return {
        // eq=saturation=1.12:contrast=1.06:brightness=-0.015 + colorbalance (warm shadows,
        // cool highlights) + vignette=PI/5 (~0.63 rad → strong) + temporal noise=alls=8.
        grade: {
          ...base('Cinematic'),
          saturation: 1.12,
          contrast: 1.06,
          brightness: -0.015,
          colorBalance: { r: 0.05, g: -0.01, b: -0.05 },
          vignette: 0.55
        },
        grain: { strength: 0.03, temporal: true }
      }
    case 'Intense':
      return {
        // curves=strong_contrast + eq=saturation=1.18:contrast=1.13 + unsharp + vignette=PI/7.
        grade: {
          ...base('Intense'),
          saturation: 1.18,
          contrast: 1.13,
          brightness: 0,
          vignette: 0.42,
          sharpen: 0.45
        },
        grain: { strength: 0, temporal: false }
      }
    case 'Heartfelt':
      return {
        // colorbalance (warm) + eq=saturation=1.06:contrast=1.02:brightness=0.01 + vignette=PI/8.
        grade: {
          ...base('Heartfelt'),
          saturation: 1.06,
          contrast: 1.02,
          brightness: 0.01,
          colorBalance: { r: 0.05, g: 0.015, b: -0.04 },
          vignette: 0.35
        },
        grain: { strength: 0, temporal: false }
      }
    case 'Clean':
    case 'None':
    default:
      return { grade: base(style ?? 'None'), grain: { strength: 0, temporal: false } }
  }
}

