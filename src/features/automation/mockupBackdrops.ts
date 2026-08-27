import type { VisualTemplate } from '@shared/types'
import { previewUrlForPath } from '../video-studio/editor/assetUrl'

/**
 * Curated SVG photographic scene with rich color depth:
 * Highlights in the sky, subject contours with warm skin tones, and deep shadows
 * to expose color grading effects (LUTs, saturation, temperature, contrast) clearly.
 */
export const CINEMATIC_PORTRAIT_MOCKUP = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2a3342"/>
      <stop offset="40%" stop-color="#4a5568"/>
      <stop offset="70%" stop-color="#718096"/>
      <stop offset="100%" stop-color="#cbd5e0"/>
    </linearGradient>
    <radialGradient id="sun" cx="75%" cy="25%" r="40%">
      <stop offset="0%" stop-color="#fff5eb" stop-opacity="1"/>
      <stop offset="30%" stop-color="#fbd38d" stop-opacity="0.8"/>
      <stop offset="70%" stop-color="#ed8936" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#ed8936" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="subjectSkin" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f6ad55"/>
      <stop offset="50%" stop-color="#dd6b20"/>
      <stop offset="100%" stop-color="#7b341e"/>
    </linearGradient>
    <linearGradient id="shadowFloor" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1a202c" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0d1117" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#sky)"/>
  <rect width="1080" height="1920" fill="url(#sun)"/>
  <!-- Mountain / Architectural silhouettes for midtone & contrast reference -->
  <path d="M0,1350 L280,1050 L520,1220 L840,940 L1080,1180 L1080,1920 L0,1920 Z" fill="#1f2937" opacity="0.85"/>
  <path d="M0,1480 L350,1280 L700,1450 L1080,1260 L1080,1920 L0,1920 Z" fill="#111827"/>
  <!-- Subject silhouette with skin tone highlights for grade evaluation -->
  <g transform="translate(340, 680)">
    <circle cx="200" cy="180" r="140" fill="url(#subjectSkin)"/>
    <path d="M60,340 C60,260 140,240 200,240 C260,240 340,260 340,340 L380,720 L20,720 Z" fill="#1a202c"/>
  </g>
  <rect width="1080" height="1920" fill="url(#shadowFloor)"/>
</svg>
`)}`

export interface MockupBackdropResult {
  uri: string
  label: string
  isMockup: boolean
}

export function getMockupBackdrop(
  mode: VisualTemplate['mode'],
  imagePaths?: string[]
): MockupBackdropResult {
  if (mode !== 'Auto B-roll' && imagePaths && imagePaths.length > 0 && imagePaths[0]) {
    return {
      uri: previewUrlForPath(imagePaths[0]),
      label: 'Pool image',
      isMockup: false,
    }
  }

  return {
    uri: CINEMATIC_PORTRAIT_MOCKUP,
    label: mode === 'Auto B-roll' ? 'Auto B-roll sample' : 'Sample preview',
    isMockup: true,
  }
}
