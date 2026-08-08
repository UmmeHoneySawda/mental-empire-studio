import { useEffect, useState } from 'react'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, Chip, EmptyState, Banner, StatusPill } from '../components/ui/kit'
import type { Niche } from '@shared/types'

// Niches / B-roll Pools manager (P3): create global, reusable b-roll pools keyed by
// theme, assign source channels to them, and warm/refresh each pool. Renders pull from
// the assigned channel's pool first, keeping niches (e.g. Motivational vs Tech) separate.

const ORIENTATIONS: Array<Niche['orientation']> = ['landscape', 'portrait', 'any']

export function Niches(): JSX.Element {
  const niches = useData((s) => s.niches)
  const nichePools = useData((s) => s.nichePools)
  const nichePoolProgress = useData((s) => s.nichePoolProgress)
  const sourceChannels = useData((s) => s.sourceChannels)
  const loadNiches = useData((s) => s.loadNiches)
  const saveNiche = useData((s) => s.saveNiche)
  const deleteNiche = useData((s) => s.deleteNiche)
  const assignChannelNiche = useData((s) => s.assignChannelNiche)
  const warmNiche = useData((s) => s.warmNiche)
  const refreshAllPools = useData((s) => s.refreshAllPools)
  const [warming, setWarming] = useState<string | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [editing, setEditing] = useState<Partial<Niche> | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [warmError, setWarmError] = useState('')

  useEffect(() => { void loadNiches() }, [loadNiches])

  const poolFor = (id: string): { clips: number; updatedAt?: string } => {
    const h = nichePools.find((p) => p.nicheId === id)
    return { clips: h?.clips ?? 0, updatedAt: h?.updatedAt }
  }

  // `warming` is the only feedback between the click and the first progress frame — and on the
  // no-provider bail there is never a frame at all. The store map is what survives the
  // <Screen key={active}> remount, so a warm still reports itself after navigating away and back.
  const warm = async (id: string): Promise<void> => {
    setWarming(id)
    setWarmError('')
    try { await warmNiche(id) } catch (e) { setWarmError(`Clips could not be downloaded for this collection. ${(e as Error).message}`) } finally { setWarming(null) }
  }

  const blank = (): Partial<Niche> => ({ name: '', keywords: [], orientation: 'landscape', targetClips: 60 })

  return (
    <ScreenPad>
      <PageHeader
        title="B-roll library"
        subtitle="Create topic-specific B-roll collections and assign source channels to them. Studio downloads each collection once, then reuses its local clips in future renders."
        actions={
          <>
            <Btn variant="ghost" size="md" disabled={refreshingAll || niches.length === 0} onClick={async () => { setRefreshingAll(true); try { await refreshAllPools() } finally { setRefreshingAll(false) } }} title="Top up every pool to its target and prune clips unused for 30 days">{refreshingAll ? 'Refreshing…' : 'Refresh all'}</Btn>
            <Btn variant="primary" size="md" onClick={() => setEditing(blank())}>New collection</Btn>
          </>
        }
      />

      {warmError && <div style={{ marginBottom: 14 }}><Banner kind="error">{warmError}</Banner></div>}

      {editing && (
        <NicheEditor
          niche={editing}
          onCancel={() => setEditing(null)}
          onSave={async (n) => { await saveNiche(n); setEditing(null) }}
        />
      )}

      {niches.length === 0 && !editing ? (
        <EmptyState
          title="No B-roll collections yet"
          body={'Create a topic such as “Motivation” or “Technology,” add search phrases, then assign source channels to it.'}
          action={<Btn variant="primary" onClick={() => setEditing(blank())}>Create collection</Btn>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {niches.map((n) => {
            const pool = poolFor(n.id)
            const prog = nichePoolProgress[n.id]
            const progPct = prog ? Math.min(100, Math.round((prog.done / Math.max(1, prog.total)) * 100)) : 0
            const isWarming = warming === n.id || !!prog
            const assigned = sourceChannels.filter((c) => c.nicheId === n.id)
            const isConfirming = confirmDelete === n.id
            return (
              <Card key={n.id} pad={16}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{n.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '2px 7px' }}>{n.orientation}</span>
                  {prog ? (
                    <StatusPill tone="accent" title="Downloading clips into this collection now">
                      {prog.done}/{prog.total} clips · {progPct}%
                    </StatusPill>
                  ) : (
                    <StatusPill tone={pool.clips > 0 ? 'ok' : 'neutral'} title="Clips cached in this collection">{pool.clips}/{n.targetClips} clips</StatusPill>
                  )}
                  {!prog && pool.updatedAt && <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>· refreshed {new Date(pool.updatedAt).toLocaleDateString()}</span>}
                  <div style={{ flex: 1 }} />
                  {isConfirming ? (
                    <>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Delete collection “{n.name}”?</span>
                      <Btn variant="danger" onClick={() => { void deleteNiche(n.id); setConfirmDelete(null) }}>Delete collection</Btn>
                      <Btn variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Btn>
                    </>
                  ) : (
                    <>
                      <Btn variant="ghost" disabled={isWarming} onClick={() => void warm(n.id)}>{isWarming ? 'Downloading…' : 'Download clips'}</Btn>
                      <Btn variant="ghost" onClick={() => setEditing(n)}>Edit</Btn>
                      <Btn variant="danger" onClick={() => setConfirmDelete(n.id)}>Delete</Btn>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                  {n.keywords.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No keywords yet — edit to add search phrases.</span>}
                  {n.keywords.map((k) => (
                    <span key={k} style={{ fontSize: 'var(--fs-caption)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '2px 8px' }}>{k}</span>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-dim)', marginBottom: 7 }}>Source channels using this collection ({assigned.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {sourceChannels.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>No source channels yet.</span>}
                    {sourceChannels.map((c) => {
                      const on = c.nicheId === n.id
                      return (
                        <Chip key={c.id} on={on} onClick={() => void assignChannelNiche(c.id, on ? null : n.id)} title={on ? 'Remove from this collection' : 'Use this collection'}>{c.name || c.handle}</Chip>
                      )
                    })}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </ScreenPad>
  )
}

function NicheEditor({ niche, onSave, onCancel }: { niche: Partial<Niche>; onSave: (n: Partial<Niche>) => void; onCancel: () => void }): JSX.Element {
  const [name, setName] = useState(niche.name ?? '')
  const [keywords, setKeywords] = useState((niche.keywords ?? []).join('\n'))
  const [orientation, setOrientation] = useState<Niche['orientation']>(niche.orientation ?? 'landscape')
  const [targetClips, setTargetClips] = useState(niche.targetClips ?? 60)
  const lbl = { fontSize: 'var(--fs-caption)', color: 'var(--text-dim)', display: 'block', marginBottom: 5 } as const
  const normalizedName = name.trim()
  const searchPhrases = keywords.split('\n').map((keyword) => keyword.trim()).filter(Boolean)
  const targetIsValid = Number.isFinite(targetClips) && targetClips >= 1 && targetClips <= 200
  const canSave = normalizedName.length > 0 && searchPhrases.length > 0 && targetIsValid

  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', boxShadow: 'var(--shadow-card)', padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>{niche.id ? 'Edit B-roll collection' : 'New B-roll collection'}</div>
      <div className="me-broll-editor-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px', gap: 12, marginBottom: 12 }}>
        <div>
          <label htmlFor="broll-name" style={lbl}>Name</label>
          <input id="broll-name" className="ed-input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Motivational" />
        </div>
        <div>
          <label htmlFor="broll-orientation" style={lbl}>Orientation</label>
          <select id="broll-orientation" className="ed-input" value={orientation} onChange={(e) => setOrientation(e.target.value as Niche['orientation'])}>
            {ORIENTATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="broll-target" style={lbl}>Target clips</label>
          <input id="broll-target" className="ed-input" type="number" min={1} max={200} required aria-invalid={!targetIsValid} value={targetClips} onChange={(e) => setTargetClips(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label htmlFor="broll-keywords" style={lbl}>Search phrases (one per line)</label>
        <textarea id="broll-keywords" className="ed-input" required maxLength={1000} aria-describedby="broll-validation" style={{ minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-mono)' }} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={'focused work\nsuccess mindset\ncity at night'} />
      </div>
      <div id="broll-validation" style={{ minHeight: 18, marginBottom: 8, color: canSave ? 'var(--text-dim)' : 'var(--warning)', fontSize: 'var(--fs-caption)' }}>
        {canSave ? `${searchPhrases.length} search ${searchPhrases.length === 1 ? 'phrase' : 'phrases'} ready.` : 'Add a name, at least one search phrase, and a target from 1 to 200.'}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" size="md" onClick={onCancel}>Cancel</Btn>
        <Btn variant="primary" size="md" disabled={!canSave} onClick={() => onSave({ id: niche.id, name: normalizedName, keywords: searchPhrases, orientation, targetClips, createdAt: niche.createdAt })}>Save collection</Btn>
      </div>
    </div>
  )
}
