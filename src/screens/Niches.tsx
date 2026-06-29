import { useEffect, useState } from 'react'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import type { Niche } from '@shared/types'

// Niches / B-roll Pools manager (P3): create global, reusable b-roll pools keyed by
// theme, assign source channels to them, and warm/refresh each pool. Renders pull from
// the assigned channel's pool first, keeping niches (e.g. Motivational vs Tech) separate.

const ORIENTATIONS: Array<Niche['orientation']> = ['landscape', 'portrait', 'any']

export function Niches(): JSX.Element {
  const niches = useData((s) => s.niches)
  const nichePools = useData((s) => s.nichePools)
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

  useEffect(() => { void loadNiches() }, [loadNiches])

  const poolFor = (id: string): { clips: number; updatedAt?: string } => {
    const h = nichePools.find((p) => p.nicheId === id)
    return { clips: h?.clips ?? 0, updatedAt: h?.updatedAt }
  }

  const warm = async (id: string): Promise<void> => {
    setWarming(id)
    try { await warmNiche(id) } catch (e) { window.alert(`Pool warm failed: ${(e as Error).message}`) } finally { setWarming(null) }
  }

  const blank = (): Partial<Niche> => ({ name: '', keywords: [], orientation: 'landscape', targetClips: 60 })

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: '#f2f4f7', margin: 0 }}>B-roll Pools</h1>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#5b616f', border: '1px solid #23272f', borderRadius: 6, padding: '2px 8px' }}>{niches.length} niches</span>
        <div style={{ flex: 1 }} />
        <button type="button" disabled={refreshingAll || niches.length === 0} onClick={async () => { setRefreshingAll(true); try { await refreshAllPools() } finally { setRefreshingAll(false) } }} title="Top up every pool to its target and prune clips unused for 30 days" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', color: refreshingAll ? '#5b616f' : '#c4cad3', borderRadius: 9, padding: '8px 14px', fontSize: 12, cursor: refreshingAll ? 'default' : 'pointer' }}>{refreshingAll ? 'Refreshing…' : 'Refresh all'}</button>
        <button type="button" onClick={() => setEditing(blank())} className="me-btn" style={{ border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>+ New niche</button>
      </div>
      <p style={{ color: '#6a7180', fontSize: 12.5, margin: '0 0 18px', maxWidth: 680 }}>
        A niche is a reusable, themed pool of stock B-roll. Assign your source channels to a niche, warm its pool once, and every render from those channels pulls clips from it — no re-downloading, and niches stay separate.
      </p>

      {editing && (
        <NicheEditor
          niche={editing}
          onCancel={() => setEditing(null)}
          onSave={async (n) => { await saveNiche(n); setEditing(null) }}
        />
      )}

      {niches.length === 0 && !editing ? (
        <div style={{ border: '1px dashed #23272f', borderRadius: 14, padding: '48px 20px', textAlign: 'center', color: '#5b616f', fontSize: 13 }}>
          No niches yet. Create one (e.g. “Motivational”, “Tech”) and add a few search phrases.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {niches.map((n) => {
            const pool = poolFor(n.id)
            const assigned = sourceChannels.filter((c) => c.nicheId === n.id)
            return (
              <div key={n.id} style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#e9ebef' }}>{n.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>{n.orientation}</span>
                  <span title="Clips cached in this pool" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: pool.clips > 0 ? '#36c98e' : '#6a7180' }}>{pool.clips}/{n.targetClips} clips</span>
                  {pool.updatedAt && <span style={{ fontSize: 10, color: '#5b616f' }}>· refreshed {new Date(pool.updatedAt).toLocaleDateString()}</span>}
                  <div style={{ flex: 1 }} />
                  <button type="button" disabled={warming === n.id} onClick={() => void warm(n.id)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 12px', fontSize: 11, color: warming === n.id ? '#5b616f' : '#c4cad3', cursor: 'pointer' }}>{warming === n.id ? 'Warming…' : 'Warm pool'}</button>
                  <button type="button" onClick={() => setEditing(n)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 12px', fontSize: 11, color: '#c4cad3', cursor: 'pointer' }}>Edit</button>
                  <button type="button" onClick={() => { if (window.confirm(`Delete niche "${n.name}"? Channels will be unassigned.`)) void deleteNiche(n.id) }} className="me-btn" style={{ border: '1px solid #2a1d22', background: '#15181f', borderRadius: 7, padding: '5px 10px', fontSize: 11, color: '#ff8a96', cursor: 'pointer' }}>Delete</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                  {n.keywords.length === 0 && <span style={{ fontSize: 11, color: '#5b616f' }}>No keywords yet — edit to add search phrases.</span>}
                  {n.keywords.map((k) => (
                    <span key={k} style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: '#aab0bb', border: '1px solid #23272f', borderRadius: 6, padding: '2px 8px' }}>{k}</span>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid #1d2129', paddingTop: 10 }}>
                  <div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Assigned source channels ({assigned.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {sourceChannels.length === 0 && <span style={{ fontSize: 11, color: '#5b616f' }}>No source channels yet.</span>}
                    {sourceChannels.map((c) => {
                      const on = c.nicheId === n.id
                      return (
                        <button key={c.id} type="button" onClick={() => void assignChannelNiche(c.id, on ? null : n.id)} className="me-btn" title={on ? 'Click to unassign' : 'Assign to this niche'} style={{ border: `1px solid ${on ? 'var(--accent)' : '#23272f'}`, background: on ? 'var(--accent-soft)' : 'transparent', color: on ? '#f2f4f7' : '#8a909c', borderRadius: 7, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>{on ? '✓ ' : ''}{c.name || c.handle}</button>
                      )
                    })}
                  </div>
                </div>
              </div>
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
  const input: React.CSSProperties = { background: '#0e1116', border: '1px solid #23272f', borderRadius: 8, color: '#e9ebef', fontSize: 12.5, padding: '8px 10px', width: '100%' }

  return (
    <div style={{ border: '1px solid var(--accent)', borderRadius: 14, background: '#12151b', padding: 16, marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e9ebef', marginBottom: 12 }}>{niche.id ? 'Edit niche' : 'New niche'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 120px', gap: 12, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10.5, color: '#6a7180', display: 'block', marginBottom: 5 }}>Name</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Motivational" />
        </div>
        <div>
          <label style={{ fontSize: 10.5, color: '#6a7180', display: 'block', marginBottom: 5 }}>Orientation</label>
          <select style={input} value={orientation} onChange={(e) => setOrientation(e.target.value as Niche['orientation'])}>
            {ORIENTATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10.5, color: '#6a7180', display: 'block', marginBottom: 5 }}>Target clips</label>
          <input style={input} type="number" min={1} max={200} value={targetClips} onChange={(e) => setTargetClips(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 10.5, color: '#6a7180', display: 'block', marginBottom: 5 }}>Search phrases (one per line)</label>
        <textarea style={{ ...input, minHeight: 90, resize: 'vertical', fontFamily: 'var(--font-mono)' }} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder={'focused work\nsuccess mindset\ncity at night'} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '7px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={() => onSave({ id: niche.id, name, keywords: keywords.split('\n'), orientation, targetClips, createdAt: niche.createdAt })} className="me-btn" style={{ border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</button>
      </div>
    </div>
  )
}
