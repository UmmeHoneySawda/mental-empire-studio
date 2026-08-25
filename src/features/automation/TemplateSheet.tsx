import type { VisualTemplate } from '@shared/types'
import { MediaBin } from '../video-studio/editor/MediaBin'
import {
  TransitionsToolPanelControlled,
  FiltersToolPanelControlled,
  AdjustToolPanelControlled,
  EffectsToolPanelControlled
} from '../video-studio/editor/EditorToolPanel'
import { CaptionThumb } from './AnimatedThumb/CaptionThumb'
import { HookThumb } from './AnimatedThumb/HookThumb'
import { GradeThumb } from './AnimatedThumb/GradeThumb'
import { TransitionThumb } from './AnimatedThumb/TransitionThumb'

export function mergeImagePaths(existing: string[], canonicals: string[]): string[] {
  return Array.from(new Set([...(existing || []), ...(canonicals || [])]))
}

export function TemplateSheet({
  open,
  template,
  onChange,
  onSave,
  onClose,
  saving,
  error
}: {
  open: boolean
  template: VisualTemplate | null
  onChange: (patch: Partial<VisualTemplate>) => void
  onSave: () => void
  onClose: () => void
  saving?: boolean
  error?: string
}): JSX.Element | null {
  if (!open || !template) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit production template"
      className="automation-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.55)',
        zIndex: 50,
        display: 'flex',
        justifyContent: 'flex-end'
      }}
    >
      <div
        className="automation-sheet-body ed-scroll"
        style={{
          width: 'min(48vw, 560px)',
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--bg-window)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-pop)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto'
        }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700 }}>Edit production template</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: 'transparent', cursor: 'pointer' }}>✕</button>
        </div>

        {error && <div style={{ margin: 12, padding: 10, borderRadius: 8, background: 'rgba(255,90,110,.1)', color: 'var(--err-2)', fontSize: 12 }}>{error}</div>}

        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6 }}>Template name</label>
            <input
              value={template.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="e.g. Dark Stoic Shorts"
              style={{ width: '100%', padding: '9px 10px', borderRadius: 9, border: '1px solid var(--border-3)', background: 'var(--bg-inset)', color: 'var(--text-bright)' }}
            />
          </div>

          {/* triptych preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <GradeThumb grade={template.grade} />
            <CaptionThumb templateId={template.captionTemplateId || `remotion-caption-${template.captionStyle}`} props={template.captionProps} />
            <TransitionThumb transitionId={template.transition} durationFrames={template.transitionDurationFrames} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
            <HookThumb hookTemplateId={template.hookTemplateId} hookProps={template.hookProps} headline={template.hookLine} />
          </div>

          {/* Delegated panels — controlled via props */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <TransitionsToolPanelControlled value={template.transition} durationFrames={template.transitionDurationFrames} onChange={(id, dur) => onChange({ transition: id, transitionDurationFrames: dur })} />
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <FiltersToolPanelControlled value={template.filterPresetId ?? template.grade} onChange={(id) => onChange({ filterPresetId: id })} />
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <AdjustToolPanelControlled value={template.adjust as any} onChange={(patch) => onChange({ adjust: { ...(template.adjust as any), ...patch } as any })} />
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <EffectsToolPanelControlled value={template.effectsPresetIds} onChange={(ids) => onChange({ effectsPresetIds: ids })} />
          </div>

          {/* Media pool — canonical MediaBin */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', borderBottom: '1px solid var(--border-2)' }}>Image pool — MediaBin</div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <MediaBin />
            </div>
          </div>
        </div>

        <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={!!saving} style={{ padding: '9px 14px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text)' }}>Cancel</button>
          <button type="button" onClick={onSave} disabled={!!saving || !template.name.trim()} style={{ padding: '9px 14px', borderRadius: 9, background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 700, border: 0 }}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}
