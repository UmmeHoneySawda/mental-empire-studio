import { useEffect, useMemo, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, EmptyState } from '../components/ui/kit'
import { fmtAgo } from '../lib/time'
import { useData } from '../store/useData'
import { errorMessage } from '../lib/errors'

export function MyChannels(): JSX.Element {
  const channels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const loadChannels = useData((s) => s.loadChannels)
  const loadSources = useData((s) => s.loadSources)
  const setSourceOwner = useData((s) => s.setSourceOwner)
  const refreshChannel = useData((s) => s.refreshChannel)
  const scraping = useData((s) => s.scraping)
  const addChannel = useData((s) => s.addChannel)
  const deleteChannel = useData((s) => s.deleteChannel)
  const updateGoals = useData((s) => s.updateGoals)

  // Both loads: channel refreshes performed elsewhere (Home's "Run now") updated the store,
  // but landing here directly after a stale load showed frozen cards until something else
  // happened to repopulate it.
  useEffect(() => { void loadChannels(); void loadSources() }, [loadChannels, loadSources])
  const [url, setUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<{ id: string; message: string } | null>(null)
  const [draft, setDraft] = useState({ weekGoal: 5, monthGoal: 20, reminderNote: '' })

  /** Attach or detach one source. The `<select>` and the chip × both land here so a failed
   *  write is reported instead of silently leaving the control showing the old value. */
  const changeSourceOwner = async (channelId: string, sourceId: string, owned: boolean): Promise<void> => {
    setLinkError(null)
    try {
      await setSourceOwner(sourceId, owned ? channelId : null)
    } catch (e) {
      setLinkError({ id: channelId, message: errorMessage(e, 'The source link could not be changed. Try again.') })
    }
  }

  const connect = async (): Promise<void> => {
    const trimmed = url.trim()
    if (!trimmed || connecting) return
    setConnecting(true)
    setConnectError('')
    try {
      await addChannel(trimmed)
      setUrl('')
    } catch (e) {
      setConnectError(errorMessage(e, 'The publishing channel could not be added. Check the URL and try again.'))
    } finally {
      setConnecting(false)
    }
  }

  const beginEdit = (c: (typeof channels)[number]): void => {
    if (editingId === c.id) { setEditingId(null); return }
    setEditingId(c.id)
    setDraft({ weekGoal: c.weekGoal, monthGoal: c.monthGoal, reminderNote: c.reminderNote })
  }

  const saveEdit = async (): Promise<void> => {
    if (!editingId) return
    await updateGoals(editingId, {
      weekGoal: Math.max(1, draft.weekGoal),
      monthGoal: Math.max(1, draft.monthGoal),
      reminderNote: draft.reminderNote.trim()
    })
    setEditingId(null)
  }

  const labelStyle = { fontSize: 11, color: 'var(--text-muted)' } as const

  // One pass over the sources instead of three per card, and an id->name map so the
  // "owned elsewhere" options don't run a find() per option per card.
  const { sourcesByChannel, freeSources } = useMemo(() => {
    const byChannel = new Map<string, typeof sourceChannels>()
    const free: typeof sourceChannels = []
    for (const s of sourceChannels) {
      if (!s.linkedMyChannelId) free.push(s)
      else {
        const list = byChannel.get(s.linkedMyChannelId)
        if (list) list.push(s)
        else byChannel.set(s.linkedMyChannelId, [s])
      }
    }
    return { sourcesByChannel: byChannel, freeSources: free }
  }, [sourceChannels])
  const channelNameById = useMemo(() => new Map(channels.map((x) => [x.id, x.name])), [channels])

  return (
    <ScreenPad>
      <PageHeader
        title="Publishing channels"
        subtitle="Add channels you own to track upload goals and match finished videos with what is already live. No YouTube API key is required."
      />

      {/* Add channel form — the single entry point */}
      <div style={{ marginBottom: 28 }}>
        <label htmlFor="publishing-channel-url" style={{ display: 'block', marginBottom: 7, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Publishing channel URL or @handle</label>
        <div style={{ display: 'flex', gap: 11 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: `1px dashed ${connectError ? 'var(--err)' : 'var(--border-3)'}`, borderRadius: 'var(--radius-md)', padding: '12px 15px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" aria-hidden="true"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
            <input id="publishing-channel-url" value={url} onChange={(e) => { setUrl(e.target.value); setConnectError('') }} onKeyDown={(e) => e.key === 'Enter' && void connect()} placeholder="youtube.com/@your-channel" aria-label="Publishing channel URL or handle" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }} />
          </div>
          <Btn variant="soft" size="md" onClick={() => void connect()} disabled={connecting || !url.trim()} style={{ minWidth: 150, justifyContent: 'center' }}>
            {connecting ? 'Adding channel…' : 'Add channel'}
          </Btn>
        </div>
        {connectError && <div title={connectError} className="me-clamp-2" role="alert" style={{ marginTop: 7, fontSize: 11.5, color: 'var(--err-2)', paddingLeft: 4 }}>{connectError}</div>}
      </div>

      {channels.length === 0 ? (
        <EmptyState
          title="No publishing channels yet"
          body="Add a YouTube channel above to track upload goals and match finished videos with what is already live."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
          {channels.map((c) => {
            // `rowToMyChannel` in the repo coerces the nullable legacy columns, so these are
            // real numbers here. Derived, not `c.reminder` — that column is seeded to the
            // literal "On track" at creation and only ever changed by the user typing, so a
            // channel behind pace displayed "On track" beside a warning-coloured icon.
            const { weekGoal, monthGoal, weekDone, monthDone } = c
            const status =
              weekGoal === 0
                ? { label: 'no weekly goal', color: 'var(--text-faint)' }
                : weekDone >= weekGoal
                  ? { label: 'on track', color: 'var(--ok-2)' }
                  : { label: `${weekGoal - weekDone} to go`, color: 'var(--warn)' }
            // mapTotal===0 means "never mapped", not "everything mapped": 0>=0 was true, so
            // unmapped rendered identically to fully-mapped success-green.
            const mapKnown = c.mapTotal > 0
            const mapColor = !mapKnown ? 'var(--text-faint)' : c.mapDone >= c.mapTotal ? 'var(--ok-2)' : 'var(--warn)'
            const linkedSources = sourcesByChannel.get(c.id) ?? []
            const takenSources = sourceChannels.filter((s) => s.linkedMyChannelId && s.linkedMyChannelId !== c.id)
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
                  {/* Fixed slots with an explicit em-dash: `views` is dropped to '' on the fast
                      flat scrape, and the old conditional made whole segments vanish, so two
                      adjacent cards had different shapes for no visible reason. `total` is the
                      videos this scrape enumerated, not YouTube's upload count. */}
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>{c.views || '—'} views · {c.subs || '—'} subs · {c.total} videos</div>
                  <div title={c.lastScrapedAt ? `Last scraped ${c.lastScrapedAt}` : 'Never scraped'} style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)', marginTop: 2 }}>checked {fmtAgo(c.lastScrapedAt)}</div>
                </div>
                {isConfirming ? (
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    <Btn variant="danger" onClick={() => { void deleteChannel(c.id); setConfirmDelete(null) }}>Remove</Btn>
                    <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                    {/* The per-channel re-scrape IPC shipped in M3 and had no caller: the only
                        way to refresh one channel's stats was Home's every-channel "Run now". */}
                    <button type="button" onClick={() => void refreshChannel(c.id)} disabled={scraping} title={scraping ? 'Another channel refresh is already running' : 'Refresh uploads and channel statistics'} aria-label={`Refresh ${c.name}`} className="me-btn ed-focus" style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', cursor: scraping ? 'not-allowed' : 'pointer', opacity: scraping ? 0.45 : 1, background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(c.id)} title="Remove channel" aria-label={`Remove ${c.name}`} className="me-btn ed-focus" style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', fontSize: 15, color: 'var(--text-faint)', cursor: 'pointer', background: 'var(--bg-inset)', border: '1px solid var(--border)' }}>×</button>
                  </div>
                )}
              </div>

              {/* Stats row */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                {/* Weekly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: 'var(--text-dim)' }}>WEEK</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: 'var(--text-bright)' }}>{weekDone} / {weekGoal || '—'}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: status.color }}>{status.label}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
                    <div style={{ width: `${weekGoal === 0 ? 0 : Math.min(100, Math.round((weekDone / weekGoal) * 100))}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))' }} />
                  </div>
                </div>
                {/* Monthly goal */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.5px', color: 'var(--text-dim)' }}>MONTH</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: 'var(--text-bright)' }}>{monthDone} / {monthGoal || '—'}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
                    <div style={{ width: `${monthGoal === 0 ? 0 : Math.min(100, Math.round((monthDone / monthGoal) * 100))}%`, height: '100%', background: 'var(--border-3)' }} />
                  </div>
                </div>
                {/* Source links. Several sources may feed one owned channel, so this is a set
                    of chips plus an add-control rather than one <select>. Writes
                    source_channels.linkedMyChannelId — the direction Publish, Automation,
                    Download and SourcePicker read. The old <select> wrote only
                    my_channels.linkedSourceId, which nothing downstream consumes. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', background: 'var(--bg-inset)', maxWidth: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" style={{ flex: 'none' }} aria-hidden="true"><path d="M7 7h10l-3-3M17 17H7l3 3" /></svg>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-dim)' }}>linked sources</span>
                    <span
                      title={mapKnown ? `${c.mapDone} of ${c.mapTotal} finished videos from linked sources matched an upload here` : 'Upload status has not been checked. Refresh this channel first.'}
                      style={{ marginLeft: 'auto', fontSize: 10, color: mapColor, fontWeight: 600, flex: 'none' }}
                    >
                      {mapKnown ? `${c.mapDone}/${c.mapTotal} matched` : 'not checked'}
                    </span>
                  </div>
                  {linkedSources.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {linkedSources.map((s) => (
                        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', border: '1px solid var(--border-3)', borderRadius: 999, padding: '1px 3px 1px 7px', background: 'var(--bg-card)' }}>
                          <span title={s.handle || s.name || s.url} className="me-ellipsis" style={{ fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-mono)', color: 'var(--text-bright)', maxWidth: 150 }}>{s.handle || s.name || s.url}</span>
                          <button type="button" onClick={() => void changeSourceOwner(c.id, s.id, false)} title={`Unlink ${s.handle || s.name || s.url}`} aria-label={`Unlink ${s.handle || s.name || s.url} from ${c.name}`} className="me-btn ed-focus" style={{ flex: 'none', width: 15, height: 15, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11, lineHeight: 1, color: 'var(--text-faint)', cursor: 'pointer', background: 'transparent', border: 'none' }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <select
                    value=""
                    onChange={(e) => { const v = e.target.value; if (v) void changeSourceOwner(c.id, v, true) }}
                    title="Link another source channel to track which of its downloads you've uploaded here"
                    aria-label={`Link a source to ${c.name}`}
                    style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-dim)', fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-mono)', cursor: 'pointer' }}
                  >
                    <option value="">{linkedSources.length ? '+ link another source' : '+ link a source'}</option>
                    {freeSources.map((s) => (
                      <option key={s.id} value={s.id}>{s.handle || s.name || s.url}</option>
                    ))}
                    {/* Shown disabled rather than hidden: a source belongs to one channel, so
                        offering a claimed one would silently move it off the other channel. */}
                    {takenSources.map((s) => (
                      <option key={s.id} value={s.id} disabled>
                        {s.handle || s.name || s.url} — on {channelNameById.get(s.linkedMyChannelId ?? '') ?? 'another channel'}
                      </option>
                    ))}
                  </select>
                  {linkError?.id === c.id && (
                    <div role="alert" style={{ fontSize: 10.5, color: 'var(--err-2)' }}>{linkError.message}</div>
                  )}
                </div>
              </div>

              {/* Inline edit toggle */}
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={status.color} strokeWidth="2" style={{ flex: 'none' }} aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                  {/* The user's own note, nothing more. It used to fall back to `c.reminder`,
                      rendering the same seed string twice per card at two font sizes. */}
                  <span title={c.reminderNote} className="me-ellipsis" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.reminderNote || 'no note'}</span>
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
                  {/* No "Reminder status" field: pace is derived from weekDone/weekGoal, so a
                      hand-typed status could only ever contradict it. */}
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
