import type { MyChannel, SourceChannel, VisualTemplate } from '@shared/types'

export function FeedBar({
  channels,
  selectedChannelId,
  onSelectChannel,
  sources,
  sourceIds,
  onToggleSource,
  batchCount,
  onBatchCount,
  drawCount,
  unpublishedAvailable,
  canLaunch,
  onLaunch,
  dryRunTitles,
  templates,
  selectedTemplateId,
  onSelectTemplate
}: {
  channels: MyChannel[]
  selectedChannelId: string
  onSelectChannel: (id: string) => void
  sources: SourceChannel[]
  sourceIds: string[]
  onToggleSource: (id: string) => void
  batchCount: number
  onBatchCount: (n: number) => void
  drawCount: number
  unpublishedAvailable: number
  canLaunch: boolean
  onLaunch: () => void
  dryRunTitles?: string[]
  templates?: VisualTemplate[]
  selectedTemplateId?: string
  onSelectTemplate?: (id: string) => void
}): JSX.Element {
  const clampedDraw = Math.min(drawCount, unpublishedAvailable)

  return (
    <div
      className="automation-feed-bar"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        background: 'var(--bg-window)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        boxShadow: 'var(--shadow-card)'
      }}
    >
      {/* Row 1: channel pills + source chips */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 8, letterSpacing: '.02em' }}>Publishing channel</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {channels.length === 0 ? (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No channels — add one in My Channels.</span>
            ) : (
              channels.map((ch) => {
                const selected = ch.id === selectedChannelId
                return (
                  <button
                    key={ch.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelectChannel(ch.id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 999,
                      border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
                      color: selected ? 'var(--text-bright)' : 'var(--text-muted)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <span style={{ width: 22, height: 22, borderRadius: 999, background: 'var(--bg-inset)', display: 'grid', placeItems: 'center', fontSize: 11, overflow: 'hidden', flex: 'none' }}>
                      {ch.avatar ? <img src={ch.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ch.name.slice(0, 1)}
                    </span>
                    {ch.name}
                    {selected && <span aria-hidden="true" style={{ color: 'var(--accent)' }}>✓</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)', marginBottom: 8, letterSpacing: '.02em' }}>Linked sources</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {sources.length === 0 ? (
              <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>No source linked to this channel yet.</span>
            ) : (
              sources.map((s) => {
                const active = sourceIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleSource(s.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                      background: active ? 'var(--accent-soft)' : 'var(--bg-inset)',
                      color: active ? 'var(--text-bright)' : 'var(--text-muted)',
                      fontSize: 11.5,
                      cursor: 'pointer'
                    }}
                  >
                    {s.name || s.handle} · {s.cachedVideoCount ?? 0} {active ? '✓' : ''}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Row 2: quantity + dry-run + CTA */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" aria-label="Decrease batch size" onClick={() => onBatchCount(Math.max(1, batchCount - 1))} disabled={batchCount <= 1} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}>
            −
          </button>
          <span style={{ minWidth: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>{batchCount}</span>
          <button
            type="button"
            aria-label="Increase batch size"
            onClick={() => onBatchCount(Math.min(50, unpublishedAvailable, batchCount + 1))}
            disabled={batchCount >= Math.min(50, unpublishedAvailable)}
            style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', cursor: 'pointer' }}
          >
            +
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>of {unpublishedAvailable} available · {clampedDraw} planned</span>
        </div>

        <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[1, 3, 5, 10]
            .filter((n) => n <= unpublishedAvailable)
            .map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onBatchCount(n)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: batchCount === n ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                  background: batchCount === n ? 'var(--accent-soft)' : 'var(--bg-inset)',
                  color: batchCount === n ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {n} video{n === 1 ? '' : 's'}
              </button>
            ))}
        </div>

        <button type="button" onClick={onLaunch} disabled={!canLaunch} className="at-launch-btn" style={{ padding: '10px 16px', borderRadius: 999, background: canLaunch ? 'var(--accent)' : 'var(--bg-inset)', color: canLaunch ? 'var(--accent-ink)' : 'var(--text-faint)', border: canLaunch ? '1px solid var(--accent)' : '1px solid var(--border-2)', fontWeight: 700, cursor: canLaunch ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap' }}>
          Start {clampedDraw}-video batch
        </button>
      </div>

      {dryRunTitles && dryRunTitles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>Videos in this run · {clampedDraw} planned</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {dryRunTitles.slice(0, 4).map((title, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, background: 'var(--bg-inset)', fontSize: 11 }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>{idx + 1 < 10 ? `0${idx + 1}` : idx + 1}</span>
                <span className="me-ellipsis" style={{ flex: 1, color: 'var(--text-muted)' }}>{title}</span>
                <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>Planned</span>
              </div>
            ))}
            {dryRunTitles.length > 4 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>+{dryRunTitles.length - 4} more</span>}
          </div>
        </div>
      )}

      {templates && templates.length > 0 && onSelectTemplate && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>Template:</span>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={selectedTemplateId === t.id}
              onClick={() => onSelectTemplate(t.id)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                border: selectedTemplateId === t.id ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                background: selectedTemplateId === t.id ? 'var(--accent-soft)' : 'var(--bg-inset)',
                color: selectedTemplateId === t.id ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: 11,
                cursor: 'pointer'
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
