import type { VideoStyle } from '../../../shared/types'

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

