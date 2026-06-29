import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import type { Profile, ScrapeOrder } from '@shared/types'

const ROWS: { k: keyof Profile; label: string }[] = [
  { k: 'rule', label: 'SOURCE' },
  { k: 'images', label: 'IMAGES' },
  { k: 'thumb', label: 'THUMB' },
  { k: 'cap', label: 'CAPTIONS' },
  { k: 'out', label: 'OUTPUT' }
]
const CAPTION_LINES: Array<NonNullable<Profile['captionLines']>> = [1, 2, 3]
const CAPTION_POSITIONS: Array<NonNullable<Profile['captionPosition']>> = ['bottom', 'middle', 'top']
const CAPTION_PACES: Array<{ value: NonNullable<Profile['captionPace']>; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'word', label: 'Word' },
  { value: 'phrase', label: 'Steady' }
]

function ProfileEditor({ profile, onClose }: { profile: Profile; onClose: () => void }): JSX.Element {
  const saveProfile = useData((s) => s.saveProfile)
  const deleteProfile = useData((s) => s.deleteProfile)
  const templates = useStore((s) => s.templates)
  const [p, setP] = useState<Profile>(profile)
  const set = (patch: Partial<Profile>): void => setP((cur) => ({ ...cur, ...patch }))
  const field = { width: '100%', border: '1px solid #23272f', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#dde0e5', background: '#0e1116', boxSizing: 'border-box' as const }
  const label = { fontSize: 10, color: '#6a7180', marginBottom: 5, fontFamily: 'var(--font-mono)', letterSpacing: '.4px' }
  const smallSelect = { ...field, padding: '7px 8px' }

  const save = async (): Promise<void> => {
    const pace = p.captionPace ?? 'auto'
    const lines = p.captionLines ?? 1
    await saveProfile({
      ...p,
      rule: `${p.sourceOrder} · ${p.sourceCount} videos`,
      cap: `${p.captionPreset} · ${p.captionAspect} · ${lines}L · ${pace === 'phrase' ? 'steady' : pace}`,
      images: p.imageMode === 'pool' ? `Pool of ${p.poolSize} · shuffle` : 'Single image'
    })
    onClose()
  }

  return (
    <div className="me-card" style={{ border: '1.5px solid var(--accent)', borderRadius: 15, padding: 18, background: 'linear-gradient(165deg,var(--accent-soft),#0f1217)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input value={p.name} onChange={(e) => set({ name: e.target.value })} style={{ ...field, fontWeight: 600, fontSize: 14 }} placeholder="Profile name" />
      <div><div style={label}>SOURCE CHANNEL URL</div><input value={p.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} style={field} placeholder="youtube.com/@source" /></div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>ORDER</div>
          <select value={p.sourceOrder} onChange={(e) => set({ sourceOrder: e.target.value as ScrapeOrder })} style={field}>
            <option>Latest</option><option>Popular</option><option>Oldest</option>
          </select>
        </div>
        <div style={{ width: 80 }}><div style={label}>COUNT</div><input type="number" value={p.sourceCount} onChange={(e) => set({ sourceCount: Number(e.target.value) })} style={field} /></div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>IMAGES</div>
          <select value={p.imageMode} onChange={(e) => set({ imageMode: e.target.value as Profile['imageMode'] })} style={field}>
            <option value="sequence">Sequence</option><option value="pool">Random pool</option>
          </select>
        </div>
        <div style={{ width: 80 }}><div style={label}>POOL</div><input type="number" value={p.poolSize} onChange={(e) => set({ poolSize: Number(e.target.value) })} style={field} /></div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>CAPTION</div>
          <select value={p.captionPreset} onChange={(e) => set({ captionPreset: e.target.value })} style={field}>
            {['Pop', 'Bold', 'Hormozi', 'Word', 'Neon', 'Minimal'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ width: 92 }}><div style={label}>ASPECT</div>
          <select value={p.captionAspect} onChange={(e) => set({ captionAspect: e.target.value as Profile['captionAspect'] })} style={field}>
            <option>16:9</option><option>1:1</option><option>9:16</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>FONT</div>
          <select value={p.captionFont ?? 'Montserrat'} onChange={(e) => set({ captionFont: e.target.value })} style={smallSelect}>
            {['Montserrat', 'Anton', 'Space Grotesk', 'Hanken Grotesk', 'JetBrains Mono', 'Arial', 'Impact', 'Oswald', 'Bebas Neue', 'Roboto'].map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><div style={label}>ANIMATION</div>
          <select value={p.captionAnim ?? 'Pop-in'} onChange={(e) => set({ captionAnim: e.target.value })} style={smallSelect}>
            {['Pop-in', 'Bounce', 'Slide', 'Type'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>LINES</div>
          <select value={p.captionLines ?? 1} onChange={(e) => set({ captionLines: Number(e.target.value) as NonNullable<Profile['captionLines']> })} style={smallSelect}>
            {CAPTION_LINES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><div style={label}>POSITION</div>
          <select value={p.captionPosition ?? 'bottom'} onChange={(e) => set({ captionPosition: e.target.value as NonNullable<Profile['captionPosition']> })} style={smallSelect}>
            {CAPTION_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}><div style={label}>PACE</div>
          <select value={p.captionPace ?? 'auto'} onChange={(e) => set({ captionPace: e.target.value as NonNullable<Profile['captionPace']> })} style={smallSelect}>
            {CAPTION_PACES.map((pace) => <option key={pace.value} value={pace.value}>{pace.label}</option>)}
          </select>
        </div>
      </div>
      <div><div style={label}>THUMBNAIL TEMPLATE</div>
        <select value={p.thumbnailTemplateId ?? ''} onChange={(e) => set({ thumbnailTemplateId: e.target.value || undefined })} style={field}>
          <option value="">None</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 12, color: '#cdd2da', flex: 1 }}>Auto-watch (run when source posts)</span>
        <div onClick={() => set({ autoWatch: !p.autoWatch })} style={{ width: 34, height: 19, borderRadius: 11, background: p.autoWatch ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: p.autoWatch ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 2 }}>
        <div onClick={save} className="me-btn" style={{ flex: 1, textAlign: 'center', background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', borderRadius: 9, padding: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Save</div>
        <div onClick={onClose} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '9px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Cancel</div>
        <div onClick={() => { void deleteProfile(p.id); onClose() }} className="me-btn" style={{ border: '1px solid #3a2630', background: '#1a1216', borderRadius: 9, padding: '9px 14px', fontSize: 12, color: '#ff8a96', cursor: 'pointer' }}>Delete</div>
      </div>
    </div>
  )
}

function newProfile(): Profile {
  const id = `prof-${Date.now()}`
  return {
    id, name: 'New profile', mono: 'NP', avatar: 'linear-gradient(135deg,#8b7cff,#5b4fd6)',
    rule: 'Latest · 5 videos', images: 'Pool of 10 · shuffle', thumb: 'None', cap: 'Hormozi · 16:9 · 2L · auto', out: '',
    autoWatch: false, sourceUrl: '', sourceOrder: 'Latest', sourceCount: 5, imageMode: 'pool', poolSize: 10,
    kenBurns: true, captionPreset: 'Hormozi', captionFont: 'Montserrat', captionAnim: 'Pop-in',
    captionAspect: '16:9', captionLines: 2, captionPosition: 'bottom', captionPace: 'auto'
  }
}

export function Profiles(): JSX.Element {
  const profiles = useData((s) => s.profiles)
  const loadProfiles = useData((s) => s.loadProfiles)
  const runProfile = useData((s) => s.runProfile)
  const runningProfileId = useData((s) => s.runningProfileId)
  const automationEvents = useData((s) => s.automationEvents)
  const automationErrors = useData((s) => s.automationErrors)
  const activeProfile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)
  const setActive = useStore((s) => s.setActive)
  const [editing, setEditing] = useState<Profile | null>(null)

  useEffect(() => { void loadProfiles() }, [loadProfiles])

  const run = async (p: Profile): Promise<void> => {
    setProfile(p.name)
    const ids = await runProfile(p.id)
    if (ids.length > 0) setActive('compose') // drop into quick-edit
  }

  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>AUTOMATION</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Channel profiles</div>
        <div style={{ fontSize: 13, color: '#8a909c', marginTop: 8 }}>One profile bundles the whole pipeline. <b style={{ color: '#cdd2da' }}>Run → quick-edit 1–2 videos &amp; thumbnails → push to render queue</b>, then do the next profile. Auto-watch runs it hands-free when a source posts.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 15 }}>
        {editing && !profiles.some((p) => p.id === editing.id) && (
          <ProfileEditor key="new" profile={editing} onClose={() => setEditing(null)} />
        )}
        {profiles.map((p) => {
          if (editing?.id === p.id) return <ProfileEditor key={p.id} profile={editing} onClose={() => setEditing(null)} />
          const on = p.name === activeProfile
          const running = runningProfileId === p.id
          const event = automationEvents[p.id]
          const error = automationErrors[p.id]
          return (
            <div key={p.id} onClick={() => setProfile(p.name)} className="me-card" style={{ border: on ? '1.5px solid var(--accent)' : '1px solid #1d2129', borderRadius: 15, padding: 18, background: on ? 'linear-gradient(165deg,var(--accent-soft),#0f1217)' : '#12151b', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 15 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: p.avatar, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#0c0d11' }}>{p.mono}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#eef0f3' }}>{p.name}</div>
                {p.autoWatch && <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#4fd6a0', background: 'rgba(54,201,142,.14)', borderRadius: 8, padding: '2px 8px' }}>WATCHING</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11.5, marginBottom: 16 }}>
                {ROWS.map((r) => (
                  <div key={r.k} style={{ display: 'flex', gap: 9 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', width: 62, flex: 'none', paddingTop: 1 }}>{r.label}</span>
                    <span style={{ color: r.k === 'out' ? '#8a909c' : '#cdd2da', fontFamily: r.k === 'out' ? 'var(--font-mono)' : undefined, fontSize: r.k === 'out' ? 10.5 : undefined, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(p[r.k] ?? '—') || '—'}</span>
                  </div>
                ))}
              </div>
              {(running || event || error) && (
                <div style={{ border: `1px solid ${error ? '#4a2530' : '#262b34'}`, background: error ? 'rgba(255,90,110,.08)' : '#0e1116', borderRadius: 9, padding: '8px 10px', marginBottom: 12, fontSize: 11, color: error ? '#ff8a96' : '#aab0bb', lineHeight: 1.35 }}>
                  {error ?? event?.message ?? 'Starting...'}
                </div>
              )}
              <div style={{ display: 'flex', gap: 9 }}>
                <div onClick={(e) => { e.stopPropagation(); if (!running) void run(p) }} className="me-btn" style={{ flex: 1, textAlign: 'center', background: on ? 'linear-gradient(180deg,var(--accent),var(--accent-deep))' : '#15181f', color: on ? 'var(--accent-ink)' : '#c4cad3', border: on ? 'none' : '1px solid #262b34', borderRadius: 9, padding: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: running ? 0.6 : 1 }}>{running ? 'Running…' : '▶ Run'}</div>
                <div onClick={(e) => { e.stopPropagation(); setEditing(p) }} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '9px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Edit</div>
              </div>
            </div>
          )
        })}
      </div>
      <div onClick={() => setEditing(newProfile())} className="me-btn" style={{ marginTop: 15, border: '1.5px dashed #262b34', borderRadius: 13, padding: 14, textAlign: 'center', fontSize: 12.5, color: '#6a7180', background: '#0e1116', cursor: 'pointer' }}>＋ New profile</div>
    </ScreenPad>
  )
}
