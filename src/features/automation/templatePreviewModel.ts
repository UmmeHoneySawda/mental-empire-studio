import { visualTemplateToStyleConfig } from '@shared/automationTemplate'
import { automationRemotionGrade } from '@shared/automationRemotion'
import { VIDEO_GRADING_PRESETS } from '@shared/video-engine/grading'
import { CAPTION_STYLE_DEFINITIONS } from '@shared/video-engine/caption-style'
import { NEW_CAPTION_DEFINITIONS } from '@shared/video-engine/new-templates'
import { gradePreviewCaveat } from '../video-studio/editor/gradePreview'
import type { VisualTemplate } from '@shared/types'
import type { VideoGrading } from '@shared/video-engine'

export type PreviewBackdrop =
  | { kind: 'image'; path: string }
  | { kind: 'broll' }
  | { kind: 'empty' }

export interface PreviewCaption {
  templateId: string
  isCinematic: boolean
  definition: unknown
}

export interface PreviewHook {
  templateId: string
  isCinematic: boolean
}

export interface PreviewModel {
  grading: VideoGrading
  caption: PreviewCaption
  hook: PreviewHook
  aspect: VisualTemplate['aspectRatio']
  backdrop: PreviewBackdrop
  caveat: string | null
}

export function resolveTemplatePreview(template: VisualTemplate): PreviewModel {
  const cfg = visualTemplateToStyleConfig(template)
  const grading = automationRemotionGrade(cfg, VIDEO_GRADING_PRESETS) as VideoGrading
  const captionTemplateId = template.captionTemplateId || `remotion-caption-${template.captionStyle}`
  const isCinematic = captionTemplateId.includes('cine')
  const captionDefinition = isCinematic
    ? (NEW_CAPTION_DEFINITIONS as Record<string, unknown>)[captionTemplateId]
    : (CAPTION_STYLE_DEFINITIONS as Record<string, unknown>)[template.captionStyle]

  const hookTemplateId = template.hookTemplateId ?? ''
  const backdrop: PreviewBackdrop =
    template.mode === 'Auto B-roll'
      ? { kind: 'broll' }
      : template.imagePaths?.[0]
        ? { kind: 'image', path: template.imagePaths[0] }
        : { kind: 'empty' }

  return {
    grading,
    caption: {
      templateId: captionTemplateId,
      isCinematic,
      definition: captionDefinition,
    },
    hook: {
      templateId: hookTemplateId,
      isCinematic: hookTemplateId.includes('cine'),
    },
    aspect: template.aspectRatio,
    backdrop,
    caveat: gradePreviewCaveat(grading),
  }
}

export function aspectToCanvas(aspect: VisualTemplate['aspectRatio']): { width: number; height: number } {
  if (aspect === '9:16') return { width: 1080, height: 1920 }
  if (aspect === '1:1') return { width: 1080, height: 1080 }
  return { width: 1920, height: 1080 }
}
