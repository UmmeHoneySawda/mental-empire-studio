import type { VisualTemplate } from '@shared/types'
import { Btn, EmptyState } from '../../components/ui/kit'
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
      <EmptyState
        title="No production templates yet"
        body="Production templates define format, captions, motion, hook and visual treatment for every batch."
        action={
          <button type="button" className="at-create-card" onClick={onCreate} style={{ width: '100%', maxWidth: 320, margin: '0 auto' }}>
            <div className="at-create-icon">＋</div>
            <b>Create a production template</b>
            <p>Reuse one format, caption style, motion treatment, and hook setup.</p>
          </button>
        }
      />
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 12,
        minWidth: 0,
        alignItems: 'start'
      }}
    >
      {templates.map((t) => (
        <div
          key={t.id}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-pressed={onSelect ? selectedId === t.id : undefined}
          aria-label={`Select template ${t.name}`}
          onClick={() => onSelect?.(t.id)}
          onKeyDown={(e) => {
            if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              onSelect(t.id)
            }
          }}
          className="ed-focus"
          style={{ cursor: onSelect ? 'pointer' : 'default', minWidth: 0, borderRadius: 14 }}
        >
          <MachineCard template={t} selected={selectedId === t.id} onEdit={() => onEdit(t)} onDuplicate={() => onDuplicate(t)} onDelete={() => onDelete(t)} />
        </div>
      ))}
      <button type="button" className="at-create-card ed-focus" onClick={onCreate} style={{ minHeight: 220, minWidth: 0 }}>
        <div className="at-create-icon">＋</div>
        <b>Create a production template</b>
        <p>Reuse one format, caption style, motion treatment, and hook setup.</p>
      </button>
    </div>
  )
}
