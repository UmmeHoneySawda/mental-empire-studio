import { useState } from 'react'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import { useData } from '../store/useData'

export function MyChannels(): JSX.Element {
  const channels = useData((s) => s.channels)
  const addChannel = useData((s) => s.addChannel)
  const deleteChannel = useData((s) => s.deleteChannel)
  const updateGoals = useData((s) => s.updateGoals)
  const [url, setUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
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

  const inp = { width: '100%', boxSizing: 'border-box' as const, border: '1px solid #23272f', borderRadius: 8, background: '#0e1116', color: '#dde0e5', padding: '8px 10px', fontSize: 12 }

  return (
    <ScreenPad>
      <div style={{ marginBottom: 8 }}>
        <Eyebrow>YOUR CHANNELS</Eyebrow>
        <Title>Channels you publish to</Title>
      </div>
      <div style={{ fontSize: 12.5, color: '#8a909c', marginBottom: 20, maxWidth: 660 }}>
        Paste a channel URL — Studio scrapes stats (views, subs, uploads) with no API key. <b style={{ color: '#cdd2da' }}>Link a source channel</b> to track which downloaded videos you've already uploaded.
      </div>

      {/* Add channel form — the single entry point */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', gap: 11 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: '#12151b', border: `1px dashed ${connectError ? '#ff5a6e' : '#2c303b'}`, borderRadius: 11, padding: '12px 15px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b616f" strokeWidth="2"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
            <input value={url} onChange={(e) => { setUrl(e.target.value); setConnectError('') }} onKeyDown={(e) => e.key === 'Enter' && void connect()} placeholder="youtube.com/@your-channel" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#dde0e5', fontFamily: 'var(--font-mono)' }} />
          </div>
          <div onClick={() => void connect()} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 11, padding: '0 20px', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: connecting ? '#6a7180' : '#c4cad3', cursor: connecting ? 'default' : 'pointer', minWidth: 140, justifyContent: 'center' }}>
            {connecting && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: 'meSpin 1s linear infinite' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>}
            {connecting ? 'Connecting…' : 'Connect & scrape'}
          </div>
        </div>
        {connectError && <div title={connectError} className="me-clamp-2" style={{ marginTop: 7, fontSize: 11.5, color: '#ff8a96', paddingLeft: 4 }}>{connectError}</div>}
      </div>

      {/* 2-column card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16 }}>
        {channels.map((c) => {
          const mapColor = c.mapDone >= c.mapTotal ? '#4fd6a0' : '#f5b323'
          const weekMet = c.weekDone >= c.weekGoal
          const reminderColor = weekMet ? '#4fd6a0' : '#f5b323'
          const isEditing = editingId === c.id

          return (
            <div key={c.id} className="me-card" style={{ border: `1px solid ${isEditing ? 'var(--accent)' : '#1d2129'}`, borderRadius: 15, background: isEditing ? 'linear-gradient(165deg,var(--accent-soft),#0f1217)' : '#12151b', overflow: 'hidden' }}>
              {/* Card header */}
              <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 13 }}>
                {c.avatar?.startsWith('http') ? (
                  <img src={c.avatar} alt={c.name} style={{ width: 44, height: 44, borderRadius: 11, objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: 11, background: c.avatar || '#2a2f3b', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: '#0c0d11', flexShrink: 0 }}>{c.mono}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={c.name} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 14, color: '#eef0f3' }}>{c.name}</div>
                  <div title={c.handle} className="me-ellipsis" style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{c.handle}</div>
                  <div style={{ fontSize: 10.5, color: '#5b616f' }}>{c.views ? `${c.views} views · ` : ''}{c.subs} subs · {c.total} uploaded</div>
                </div>
                <div
                  onClick={() => { if (window.confirm(`Remove ${c.name}?`)) void deleteChannel(c.id) }}
                  title="Remove channel"
                  style={{ flex: 'none', width: 24, height: 24, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 14, color: '#5b616f', cursor: 'pointer', background: '#0e1116', border: '1px solid #1d2129' }}
                >×</div>
              </div>

              {/* Stats row */}
              <div style={{ borderTop: '1px solid #1d2129', padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Weekly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: '#6a7180' }}>WEEK</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: '#eef0f3' }}>{c.weekDone} / {c.weekGoal}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#5b616f' }}>{c.reminder}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round((c.weekDone / Math.max(1, c.weekGoal)) * 100))}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))' }} />
                  </div>
                </div>
                {/* Monthly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: '#6a7180' }}>MONTH</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: '#eef0f3' }}>{c.monthDone} / {c.monthGoal}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, Math.round((c.monthDone / Math.max(1, c.monthGoal)) * 100))}%`, height: '100%', background: '#3a4150' }} />
                  </div>
                </div>
                {/* Source map */}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #23272f', borderRadius: 7, padding: '3px 8px', background: '#0e1116', maxWidth: '100%' }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6a7180" strokeWidth="2" style={{ flex: 'none' }}><path d="M7 7h10l-3-3M17 17H7l3 3" /></svg>
                  <span title={c.source} className="me-ellipsis" style={{ fontSize: 10, color: '#8a909c', fontFamily: 'var(--font-mono)', flex: 1 }}>{c.source || 'no source linked'}</span>
                  <span style={{ fontSize: 10, color: mapColor, fontWeight: 600, flex: 'none' }}>{c.mapDone}/{c.mapTotal}</span>
                </div>
              </div>

              {/* Inline edit toggle */}
              <div style={{ borderTop: '1px solid #1d2129', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={reminderColor} strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                  <span title={c.reminderNote} className="me-ellipsis" style={{ fontSize: 11, color: '#8a909c', maxWidth: 120 }}>{c.reminderNote || c.reminder}</span>
                </div>
                <div style={{ flex: 1 }} />
                <div onClick={() => beginEdit(c)} className="me-btn" style={{ border: '1px solid #262b34', background: isEditing ? 'var(--accent-soft)' : '#15181f', borderRadius: 8, padding: '5px 10px', fontSize: 10.5, color: isEditing ? 'var(--accent)' : '#c4cad3', cursor: 'pointer' }}>
                  {isEditing ? 'Close ✕' : 'Edit goal ✎'}
                </div>
              </div>

              {/* Inline edit expansion (no modal) */}
              {isEditing && (
                <div style={{ borderTop: '1px solid #1d2129', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ fontSize: 11, color: '#8a909c' }}>Weekly goal
                      <input type="number" min={1} value={draft.weekGoal} onChange={(e) => setDraft((d) => ({ ...d, weekGoal: parseInt(e.target.value, 10) || 1 }))} style={{ ...inp, marginTop: 5 }} />
                    </label>
                    <label style={{ fontSize: 11, color: '#8a909c' }}>Monthly goal
                      <input type="number" min={1} value={draft.monthGoal} onChange={(e) => setDraft((d) => ({ ...d, monthGoal: parseInt(e.target.value, 10) || 1 }))} style={{ ...inp, marginTop: 5 }} />
                    </label>
                  </div>
                  <label style={{ fontSize: 11, color: '#8a909c' }}>Reminder status
                    <input value={draft.reminder} onChange={(e) => setDraft((d) => ({ ...d, reminder: e.target.value }))} style={{ ...inp, marginTop: 5 }} />
                  </label>
                  <label style={{ fontSize: 11, color: '#8a909c' }}>Reminder note
                    <textarea value={draft.reminderNote} onChange={(e) => setDraft((d) => ({ ...d, reminderNote: e.target.value }))} rows={2} style={{ ...inp, marginTop: 5, resize: 'vertical' }} />
                  </label>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
                    <div onClick={() => setEditingId(null)} className="me-btn" style={{ border: '1px solid #262b34', borderRadius: 9, padding: '8px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Cancel</div>
                    <div onClick={() => void saveEdit()} className="me-btn" style={{ background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ScreenPad>
  )
}
