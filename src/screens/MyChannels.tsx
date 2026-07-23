import { useEffect, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, EmptyState } from '../components/ui/kit'
import { useData } from '../store/useData'

export function MyChannels(): JSX.Element {
  const channels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const loadSources = useData((s) => s.loadSources)
  const linkChannelSource = useData((s) => s.linkChannelSource)
  const addChannel = useData((s) => s.addChannel)
  const deleteChannel = useData((s) => s.deleteChannel)
  const updateGoals = useData((s) => s.updateGoals)

  useEffect(() => { void loadSources() }, [loadSources])
  const [url, setUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [draft, setDraft] = useState({ weekGoal: 5, monthGoal: 20, reminder: 'On track', reminderNote: '' })

  const connect = async (): Promise<void> => {
    const trimmed = url.trim()
    if (!trimmed || connecting) return
    setConnecting(true)
    setConnectError('')
    try {
      await addChannel(trimmed)
      setUrl('')
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : 'Failed to connect channel')
    } finally {
      setConnecting(false)
    }
  }

  const beginEdit = (c: (typeof channels)[number]): void => {
    if (editingId === c.id) { setEditingId(null); return }
    setEditingId(c.id)
    setDraft({ weekGoal: c.weekGoal, monthGoal: c.monthGoal, reminder: c.reminder, reminderNote: c.reminderNote })
  }

  const saveEdit = async (): Promise<void> => {
    if (!editingId) return
    await updateGoals(editingId, {
      weekGoal: Math.max(1, draft.weekGoal),
      monthGoal: Math.max(1, draft.monthGoal),
      reminder: draft.reminder.trim() || 'On track',
      reminderNote: draft.reminderNote.trim()
    })
    setEditingId(null)
  }

  const labelStyle = { fontSize: 11, color: 'var(--text-muted)' } as const

  return (
    <ScreenPad>
      <PageHeader
        eyebrow="Your channels"
        title="Channels you publish to"
        subtitle="Paste a channel URL — Studio scrapes stats (views, subs, uploads) with no API key. Link a source channel to track which downloaded videos you've already uploaded."
      />

      {/* Add channel form — the single entry point */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 11 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: `1px dashed ${connectError ? 'var(--err)' : 'var(--border-3)'}`, borderRadius: 'var(--radius-md)', padding: '12px 15px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" aria-hidden="true"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
            <input value={url} onChange={(e) => { setUrl(e.target.value); setConnectError('') }} onKeyDown={(e) => e.key === 'Enter' && void connect()} placeholder="youtube.com/@your-channel" aria-label="Channel URL" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }} />
          </div>
          <Btn variant="soft" size="md" onClick={() => void connect()} disabled={connecting || !url.trim()} style={{ minWidth: 150, justifyContent: 'center' }}>
            {connecting ? 'Connecting…' : 'Connect & scrape'}
          </Btn>
        </div>
        {connectError && <div title={connectError} className="me-clamp-2" role="alert" style={{ marginTop: 7, fontSize: 11.5, color: 'var(--err-2)', paddingLeft: 4 }}>{connectError}</div>}
      </div>

      {channels.length === 0 ? (
        <EmptyState
          title="No channels connected yet"
          body="Paste a YouTube channel URL above and connect it to track upload goals and match your downloads to what's already live."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {channels.map((c) => {
            const mapColor = c.mapDone >= c.mapTotal ? 'var(--ok-2)' : 'var(--warn)'
            const weekMet = c.weekDone >= c.weekGoal
            const reminderColor = weekMet ? 'var(--ok-2)' : 'var(--warn)'
            const isEditing = editingId === c.id
            const isConfirming = confirmDelete === c.id

            return (
              <div key={c.id} className="me-card" style={{ border: `1px solid ${isEditing ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-lg)', background: isEditing ? 'linear-gradient(165deg,var(--accent-soft),var(--bg-card-3))' : 'var(--bg-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden' }}>
              {/* Card header */}
              <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                {c.avatar?.startsWith('http') ? (
                  <img src={c.avatar} alt="" style={{ width: 44, height: 44, borderRadius: 11, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 11, background: c.avatar || 'var(--bg-elevated)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--accent-ink)', flexShrink: 0 }}>{c.mono}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={c.name} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-bright)' }}>{c.name}</div>
                  <div title={c.handle} className="me-ellipsis" style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{c.handle}</div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>{c.views ? `${c.views} views · ` : ''}{c.subs} subs · {c.total} uploaded</div>
                </div>
                {isConfirming ? (
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <Btn variant="danger" onClick={() => { void deleteChannel(c.id); setConfirmDelete(null) }}>Remove</Btn>
                    <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(c.id)} title="Remove channel" aria-label={`Remove ${c.name}`} className="me-btn ed-focus" style={{ flex: 'none', width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', fontSize: 15, color: 'var(--text-faint)', cursor: 'pointer', background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>×</button>
                )}
              </div>

              {/* Stats row */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Weekly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: 'var(--text-dim)' }}>WEEK</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: 'var(--text-bright)' }}>{c.weekDone} / {c.weekGoal}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)' }}>{c.reminder}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round((c.weekDone / Math.max(1, c.weekGoal)) * 100))}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))' }} />
                  </div>
                </div>
                {/* Monthly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: 'var(--text-dim)' }}>MONTH</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: 'var(--text-bright)' }}>{c.monthDone} / {c.monthGoal}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round((c.monthDone / Math.max(1, c.monthGoal)) * 100))}%`, height: '100%', background: 'var(--border-3)' }} />
                  </div>
                </div>
                {/* Source link picker */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', padding: '3px 8px', background: 'var(--bg-inset)', maxWidth: '100%' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" style={{ flex: 'none' }} aria-hidden="true"><path d="M7 7h10l-3-3M17 17H7l3 3" /></svg>
                  <select
                    value={c.linkedSourceId ?? ''}
                    onChange={(e) => void linkChannelSource(c.id, e.target.value || null)}
                    title="Link a source channel to track which of its downloads you've uploaded here"
                    aria-label={`Linked source for ${c.name}`}
                    style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: c.linkedSourceId ? 'var(--text-bright)' : 'var(--text-dim)', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                  >
                    <option value="">no source linked</option>
                    {sourceChannels.map((s) => (
                      <option key={s.id} value={s.id}>{s.handle || s.name || s.url}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 10, color: mapColor, fontWeight: 600, flex: 'none' }}>{c.mapDone}/{c.mapTotal}</span>
                </div>
              </div>

              {/* Inline edit toggle */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={reminderColor} strokeWidth="2" style={{ flex: 'none' }} aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                  <span title={c.reminderNote} className="me-ellipsis" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.reminderNote || c.reminder}</span>
                </div>
                <div style={{ flex: 1 }} />
                <Btn variant={isEditing ? 'soft' : 'ghost'} onClick={() => beginEdit(c)}>{isEditing ? 'Close' : 'Edit goals'}</Btn>
              </div>

              {/* Inline edit expansion (no modal) */}
              {isEditing && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={labelStyle}>Weekly goal
                      <input type="number" min={1} value={draft.weekGoal} onChange={(e) => setDraft((d) => ({ ...d, weekGoal: parseInt(e.target.value, 10) || 1 }))} className="ed-input" style={{ marginTop: 5 }} />
                    </label>
                    <label style={labelStyle}>Monthly goal
                      <input type="number" min={1} value={draft.monthGoal} onChange={(e) => setDraft((d) => ({ ...d, monthGoal: parseInt(e.target.value, 10) || 1 }))} className="ed-input" style={{ marginTop: 5 }} />
                    </label>
                  </div>
                  <label style={labelStyle}>Reminder status
                    <input value={draft.reminder} onChange={(e) => setDraft((d) => ({ ...d, reminder: e.target.value }))} className="ed-input" style={{ marginTop: 5 }} />
                  </label>
                  <label style={labelStyle}>Reminder note
                    <textarea value={draft.reminderNote} onChange={(e) => setDraft((d) => ({ ...d, reminderNote: e.target.value }))} rows={2} className="ed-input" style={{ marginTop: 5, resize: 'vertical' }} />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
                    <Btn variant="ghost" size="md" onClick={() => setEditingId(null)}>Cancel</Btn>
                    <Btn variant="primary" size="md" onClick={() => void saveEdit()}>Save goals</Btn>
                  </div>
                </div>
              )}
              </div>
            )
          })}
        </div>
      )}
    </ScreenPad>
  )
}
