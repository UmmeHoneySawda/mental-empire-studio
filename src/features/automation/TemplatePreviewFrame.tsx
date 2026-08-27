import { useState, useEffect, useMemo } from 'react'
import type { VisualTemplate } from '@shared/types'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer, gradePreviewCaveat } from '../video-studio/editor/gradePreview'
import { resolveTemplatePreview } from './templatePreviewModel'
import { getMockupBackdrop, CINEMATIC_PORTRAIT_MOCKUP } from './mockupBackdrops'

export function TemplatePreviewFrame({
  template,
  hideCaveat,
}: {
  template: VisualTemplate
  hideCaveat?: boolean
}): JSX.Element {
  const { grading, caveat, aspect } = useMemo(() => resolveTemplatePreview(template), [template])
  const backdrop = useMemo(
    () => getMockupBackdrop(template.mode, template.imagePaths),
    [template.mode, template.imagePaths]
  )
  const [activeImageUri, setActiveImageUri] = useState(backdrop.uri)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setActiveImageUri(backdrop.uri)
    setHasError(false)
  }, [backdrop.uri])

  const filter = useMemo(() => gradeFilter(grading), [grading])
  const tint = useMemo(() => gradeTintLayer(grading), [grading])
  const vignette = useMemo(() => gradeVignetteLayer(grading), [grading])
  const activeCaveat = useMemo(() => caveat || gradePreviewCaveat(grading), [caveat, grading])

  const trueAspect = aspect.replace(':', ' / ')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, width: '100%' }}>
      <div
        role="img"
        aria-label={`Preview ${template.name}`}
        style={{
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border)',
          position: 'relative',
          display: 'grid',
          placeItems: 'center',
          minWidth: 0,
        }}
      >
        {/* Letterboxed true-aspect frame — graded */}
        <div
          style={{
            aspectRatio: trueAspect,
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            maxHeight: '100%',
            position: 'relative',
            overflow: 'hidden',
            background: '#0d0f14',
            // Filter wraps backdrop + tint/vignette, so caption/hypothetical text would also be graded
            ...(filter ? { filter } : {}),
            // Centering within the 16:9 letterbox: the outer grid already centers, but ensure inner doesn't stretch
            justifySelf: 'center',
            alignSelf: 'center',
          }}
        >
          <img
            src={hasError ? CINEMATIC_PORTRAIT_MOCKUP : activeImageUri}
            alt=""
            loading="lazy"
            onError={() => setHasError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
          {tint && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...tint }} />}
          {vignette && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...vignette }} />}
        </div>
      </div>
      {!hideCaveat && activeCaveat && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-faint)', lineHeight: 1.3 }}>
          {activeCaveat}
        </span>
      )}
    </div>
  )
}
