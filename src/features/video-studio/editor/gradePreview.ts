import type { CSSProperties } from 'react'
import type { VideoGrading } from '@shared/video-engine'

/* An on-screen APPROXIMATION of the colour grade.
 *
 * The grade itself is a deterministic FFmpeg pass over the finished file
 * (`render/postprocess/ffmpeg-grade.ts`), and for a long time the editor showed nothing at
 * all on the grounds that anything else would be "a lie about what renders". The cost of
 * that honesty was that every grade was picked blind: eight presets, no way to compare
 * them, and the first sight of the look was the finished MP4.
 *
 * So this exists, and it is labelled as an approximation everywhere it is used. The numbers
 * below are deliberately the same ones the FFmpeg chain uses, so the preview is wrong only
 * in the ways CSS is unavoidably wrong:
 *
 *   exposure   → `brightness(2^EV)`         (ffmpeg `lutyuv=`, a 2^EV gain on Y and chroma)
 *   contrast   → `contrast(1 + c)`          (ffmpeg `eq=contrast=`, fed `1 + c` by queue.ts)
 *   saturation → `saturate(s)`              (ffmpeg `eq=saturation=`)
 *   temp/tint  → a soft-light wash over the whole frame, from the same rm/gm/bm channel mix
 *                the render now applies as a `lutyuv` offset on Y/U/V
 *   vignette   → a radial gradient standing in for `vignette=angle=`
 *   grain      → NOT approximated. `noise=alls=` is per-pixel and per-frame; the CSS
 *                equivalents are either a `data:` URI (blocked by `img-src 'self'`) or an
 *                SVG turbulence filter that costs more per frame than the Player can spend.
 *
 * A LUT is likewise not approximated — it is a 3D table, and there is no honest CSS for it.
 */

/** How far from the real thing this preview is, in words the panel can show. */
export function gradePreviewCaveat(grading: VideoGrading | undefined): string | null {
  if (!grading?.enabled) return null
  const missing: string[] = []
  if (grading.grain > 0) missing.push('grain')
  if (grading.lutAssetId) missing.push('the LUT')
  if (missing.length === 0) return null
  return `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} applied at render time only`
}

/** The `filter` chain for the player frame. Empty string when the grade is off or neutral. */
export function gradeFilter(grading: VideoGrading | undefined): string {
  if (!grading?.enabled) return ''
  const parts: string[] = []
  const exposure = clamp(grading.exposure, -3, 3)
  const contrast = clamp(1 + grading.contrast, 0.25, 2.5)
  const saturation = clamp(grading.saturation, 0, 3)
  if (exposure !== 0) parts.push(`brightness(${round(Math.pow(2, exposure))})`)
  if (contrast !== 1) parts.push(`contrast(${round(contrast)})`)
  if (saturation !== 1) parts.push(`saturate(${round(saturation)})`)
  return parts.join(' ')
}

/** The warm/cool wash, or null when temperature and tint are both neutral. */
export function gradeTintLayer(grading: VideoGrading | undefined): CSSProperties | null {
  if (!grading?.enabled) return null
  const temperature = clamp(grading.temperature, -1, 1)
  const tint = clamp(grading.tint, -1, 1)
  if (temperature === 0 && tint === 0) return null

  // The same channel mix `buildGradeFilter` turns into its Y/U/V offset, re-centred on mid grey
  // so a zero mix is a no-op wash rather than a grey veil.
  const red = temperature * 0.16 + tint * 0.04
  const green = -tint * 0.12
  const blue = -temperature * 0.16 + tint * 0.04
  const strength = Math.min(1, Math.max(Math.abs(temperature), Math.abs(tint)))
  const channel = (mix: number): number => Math.round(clamp(0.5 + mix * 2, 0, 1) * 255)

  return {
    background: `rgb(${channel(red)}, ${channel(green)}, ${channel(blue)})`,
    mixBlendMode: 'soft-light',
    opacity: round(Math.min(0.85, strength * 0.9))
  }
}

/** The vignette, or null when there is none. */
export function gradeVignetteLayer(grading: VideoGrading | undefined): CSSProperties | null {
  if (!grading?.enabled) return null
  const vignette = clamp(grading.vignette, 0, 1)
  if (vignette <= 0) return null
  // ffmpeg's `angle` runs to PI/3 at full strength; the visual result is a soft corner
  // falloff that starts around 55% of the radius, which is what these stops trace.
  return {
    background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,${round(vignette * 0.35)}) 72%, rgba(0,0,0,${round(vignette * 0.85)}) 100%)`
  }
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : low > 0 ? low : 0
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
