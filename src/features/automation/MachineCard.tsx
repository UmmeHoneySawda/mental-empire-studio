import type { VisualTemplate } from '@shared/types'
import { resolveTransitionPreset } from '@shared/video-engine/transition-presets'
import { GRADE_PRESETS } from '../video-studio/editor/presets'
import { NEW_HOOK_DEFINITIONS } from '@shared/video-engine/new-templates'
import { TemplatePreviewFrame } from './TemplatePreviewFrame'

function humanHookLabel(id?: string): string | null {
  if (!id) return null
  const cine = (NEW_HOOK_DEFINITIONS as Record<string, { name: string }>)[id]
  if (cine) return cine.name
  // Classic hook: remotion-hook-kinetic-30 etc — humanise
  const cleaned = id.replace('remotion-hook-', '').replace(/-/g, ' ')
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function humanFilterLabel(id?: string): string | null {
  if (!id) return null
  const found = GRADE_PRESETS.find((p) => p.id === id)
  return found ? found.label : id
}

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
    <div className={`automation-machine-card ${selected ? 'selected' : ''}`} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <TemplatePreviewFrame template={template} hideCaveat />

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
            fontSize: 11,
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
              fontSize: 11,
              color: 'var(--accent)',
              background: 'var(--accent-soft)',
              border: '1px solid var(--accent)',
              borderRadius: 999,
              padding: '3px 7px'
            }}
          >
            {template.captionStyle}
          </span>
          {template.hookTemplateId && humanHookLabel(template.hookTemplateId) && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-2)',
                borderRadius: 999,
                padding: '3px 7px'
              }}
            >
              {humanHookLabel(template.hookTemplateId)}
            </span>
          )}
          {template.filterPresetId && humanFilterLabel(template.filterPresetId) && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-dim)',
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-2)',
                borderRadius: 999,
                padding: '3px 7px'
              }}
            >
              {humanFilterLabel(template.filterPresetId)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button type="button" className="at-card-btn ed-focus" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="at-card-btn ed-focus" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="at-card-btn danger ed-focus" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
