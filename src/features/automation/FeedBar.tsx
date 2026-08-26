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
  templates?: VisualTemplate[]
  selectedTemplateId?: string
  onSelectTemplate?: (id: string) => void
}): JSX.Element {
  const clampedDraw = Math.min(drawCount, unpublishedAvailable)

  return (
    <div className="automation-feed-bar">
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
                    className="at-channel-pill ed-focus"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 999,
                      border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                      background: selected ? 'var(--accent-soft)' : 'var(--bg-card)',
                      color: selected ? 'var(--text-bright)' : 'var(--text-muted)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: 'var(--bg-inset)',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 11,
                        overflow: 'hidden',
                        flex: 'none'
                      }}
                    >
                      {ch.avatar ? <img src={ch.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : ch.name.slice(0, 1)}
                    </span>
                    {ch.name}
                    {selected && (
                      <span aria-hidden="true" style={{ color: 'var(--accent)' }}>
                        ✓
                      </span>
                    )}
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
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No source linked to this channel yet.</span>
            ) : (
              sources.map((s) => {
                const active = sourceIds.includes(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onToggleSource(s.id)}
                    className="at-source-chip ed-focus"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: active ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                      background: active ? 'var(--accent)' : 'var(--bg-inset)',
                      color: active ? 'var(--accent-ink)' : 'var(--text-muted)',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontWeight: active ? 700 : 500
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

      {/* Row 2: quantity + stepper + quick-picks + CTA */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            aria-label="Decrease batch size"
            onClick={() => onBatchCount(Math.max(1, batchCount - 1))}
            disabled={batchCount <= 1}
            className="at-stepper-btn ed-focus"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-bright)',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            −
          </button>
          <span style={{ minWidth: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700 }}>{batchCount}</span>
          <button
            type="button"
            aria-label="Increase batch size"
            onClick={() => onBatchCount(Math.min(50, unpublishedAvailable, batchCount + 1))}
            disabled={batchCount >= Math.min(50, unpublishedAvailable)}
            className="at-stepper-btn ed-focus"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-bright)',
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            +
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 4 }}>
            of {unpublishedAvailable} available · {clampedDraw} planned
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 200, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {[1, 3, 5, 10].map((n) => {
            const disabled = n > unpublishedAvailable
            return (
              <button
                key={n}
                type="button"
                disabled={disabled}
                onClick={() => onBatchCount(n)}
                className="at-quick-pick ed-focus"
                style={{
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: batchCount === n ? '1px solid var(--accent)' : '1px solid var(--border-2)',
                  background: batchCount === n ? 'var(--accent-soft)' : 'var(--bg-inset)',
                  color: batchCount === n ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer'
                }}
              >
                {n} video{n === 1 ? '' : 's'}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={onLaunch}
          disabled={!canLaunch}
          className="at-launch-btn"
          title={canLaunch ? `Start ${clampedDraw}-video batch` : unpublishedAvailable === 0 ? 'No unpublished videos available' : 'Select a channel and template'}
        >
          {canLaunch ? `Start ${clampedDraw}-video batch` : unpublishedAvailable === 0 ? 'No unpublished videos available' : `Start ${clampedDraw}-video batch`}
        </button>
      </div>

      {templates && templates.length > 0 && onSelectTemplate && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-2)' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-soft)' }}>Template:</span>
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={selectedTemplateId === t.id}
              onClick={() => onSelectTemplate(t.id)}
              className="at-quick-pick ed-focus"
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
