import type { Project } from '@shared/types'

export const CAPTION_PRESETS = ['Hormozi', 'Submagic', 'Pop', 'Bold', 'Word', 'Neon', 'Minimal'] as const
export const QUICK_CAPTION_PRESETS = ['Hormozi', 'Submagic', 'Pop', 'Minimal'] as const

export type CaptionPresetName = typeof CAPTION_PRESETS[number]

type CaptionPresetProject = Pick<
  Project,
  'captionFont' | 'captionHighlightColor' | 'captionBoxColor' | 'captionWordsPerPage'
>

export function captionPresetPatch(
  project: Partial<CaptionPresetProject> | null | undefined,
  captionPreset: string
): Partial<Project> {
  const patch: Partial<Project> = { captionPreset }
  if (captionPreset === 'Submagic') {
    patch.captionPace = 'word'
    patch.captionLines = 1
    patch.captionFont = project?.captionFont || 'Anton'
    patch.captionHighlightColor = project?.captionHighlightColor ?? '#111111'
    patch.captionBoxColor = project?.captionBoxColor ?? '#ffd93d'
    patch.captionWordsPerPage = project?.captionWordsPerPage ?? 1
  }
  return patch
}
