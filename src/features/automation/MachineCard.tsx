import type { VisualTemplate } from '@shared/types'
import { resolveTransitionPreset } from '@shared/video-engine/transition-presets'
import { GradeThumb } from './AnimatedThumb/GradeThumb'
import { CaptionThumb } from './AnimatedThumb/CaptionThumb'
import { TransitionThumb } from './AnimatedThumb/TransitionThumb'

export function MachineCard({
  template,
  selected,
  onEdit,
  onDuplicate,
  onDelete
}: {
  template: VisualTemplate
  selected?: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}): JSX.Element {
  const preset = resolveTransitionPreset(template.transition)
  const duration = template.transitionDurationFrames ?? preset.durationFrames

  return (
    <div
      className={`automation-machine-card ${selected ? 'selected' : ''}`}
      style={{
        background: 'var(--bg-card)',
        border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 14,
        padding: 12,
        boxShadow: selected ? 'var(--shadow-glow)' : 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, minWidth: 0 }}>
        <GradeThumb grade={template.grade} />
        <CaptionThumb
          templateId={template.captionTemplateId || `remotion-caption-${template.captionStyle}`}
          props={template.captionProps}
        />
        <TransitionThumb transitionId={preset.id} durationFrames={duration} />
      </div>

      <div style={{ minWidth: 0 }}>
        <h3
          className="me-ellipsis"
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-bright)',
            lineHeight: 1.2
          }}
        >
          {template.name}
        </h3>
        <div
          style={{
            marginTop: 4,
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            color: 'var(--text-muted)',
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {template.density} · {template.order} · {template.motion} · {preset.label} · {template.aspectRatio} · {template.grade}
        </div>
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 999,
              padding: '3px 7px'
            }}
          >
            {template.captionStyle}
          </span>
          {template.hookTemplateId && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-muted)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-2)',
                borderRadius: 999,
                padding: '3px 7px'
              }}
            >
              {template.hookTemplateId.replace('remotion-hook-', '').slice(0, 14)}
            </span>
          )}
          {template.filterPresetId && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: 'var(--text-dim)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-2)',
                borderRadius: 999,
                padding: '3px 7px'
              }}
            >
              {template.filterPresetId}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button type="button" className="at-card-btn" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="at-card-btn" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="at-card-btn" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
