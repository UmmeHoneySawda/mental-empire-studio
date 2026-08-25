import type { VisualTemplate } from '@shared/types'
import { MachineCard } from './MachineCard'

export function MachineDeck({
  templates,
  selectedId,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onCreate
}: {
  templates: VisualTemplate[]
  selectedId?: string
  onSelect?: (id: string) => void
  onEdit: (t: VisualTemplate) => void
  onDuplicate: (t: VisualTemplate) => void
  onDelete: (t: VisualTemplate) => void
  onCreate: () => void
}): JSX.Element {
  if (templates.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          borderRadius: 14,
          border: '1px dashed var(--border-2)',
          background: 'var(--bg-inset)',
          textAlign: 'center'
        }}
      >
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text-bright)' }}>
          No production templates yet
        </div>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          Production templates define format, captions, motion, hook and visual treatment for every batch. Filter / Adjust / Effects included — Compose owns the rendering.
        </p>
        <button type="button" className="at-create-card" onClick={onCreate} style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}>
          <div className="at-create-icon">＋</div>
          <b>Create a production template</b>
          <p>Reuse one format, caption style, motion treatment, and hook setup.</p>
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12
      }}
    >
      {templates.map((t) => (
        <div key={t.id} onClick={() => onSelect?.(t.id)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
          <MachineCard
            template={t}
            selected={selectedId === t.id}
            onEdit={() => onEdit(t)}
            onDuplicate={() => onDuplicate(t)}
            onDelete={() => onDelete(t)}
          />
        </div>
      ))}
      <button type="button" className="at-create-card" onClick={onCreate} style={{ minHeight: 220 }}>
        <div className="at-create-icon">＋</div>
        <b>Create a production template</b>
        <p>Reuse one format, caption style, motion treatment, and hook setup.</p>
      </button>
    </div>
  )
}
