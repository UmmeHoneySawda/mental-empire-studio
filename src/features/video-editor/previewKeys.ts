import type { ProjectImage } from '@shared/types'

export function previewImagesKey(images: ProjectImage[]): string {
  return images.map((im) => [
    im.id,
    im.path,
    im.thumb,
    im.rangeStart,
    im.rangeEnd,
    im.motionPreset ?? 'auto'
  ].join(':')).join('|')
}
