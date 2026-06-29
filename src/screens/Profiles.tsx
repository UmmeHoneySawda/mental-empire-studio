import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { asBetaOpts, DEFAULT_BETA_OPTS } from '@shared/types'
import type { BetaVideoOpts, BrollDensity, Profile, ScrapeOrder, VideoStyle } from '@shared/types'

const CAPTION_LINES: Array<NonNullable<Profile['captionLines']>> = [1, 2, 3]
const CAPTION_POSITIONS: Array<NonNullable<Profile['captionPosition']>> = ['bottom', 'middle', 'top']
const CAPTION_PACES: Array<{ value: NonNullable<Profile['captionPace']>; label: string }> = [
  { value: 'auto', label: 'Auto' }, { value: 'word', label: 'Word' }, { value: 'phrase', label: 'Steady' }
]
const VIDEO_STYLES: VideoStyle[] = ['None', 'Cinematic', 'Intense', 'Heartfelt', 'Clean']
const BROLL_DENSITIES: BrollDensity[] = ['sparse', 'keywords', 'full']

const PROFILE_STEPS: Array<{ phase: string; label: string }> = [
  { phase: 'scraping', label: 'Scrape' }, { phase: 'downloading', label: 'Download' },
  { phase: 'composing', label: 'Project' }, { phase: 'transcribing', label: 'Captions' }, { phase: 'done', label: 'Edit' }
]

function ProfileStepper({ phase }: { phase?: string }): JSX.Element {
  const active = phase === 'queued' ? 'done' : phase
  const activeIdx = PROFILE_STEPS.findIndex((s) => s.phase === active)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PROFILE_STEPS.length},1fr)`, gap: 4, marginBottom: 10 }}>
      {PROFILE_STEPS.map((s, i) => {
        const on = activeIdx >= 0 && i <= activeIdx
        return <span key={s.phase} title={s.label} style={{ height: 5, borderRadius: 5, background: on ? (s.phase === active ? 'var(--accent)' : '#36c98e') : '#252a34' }} />
      })}
    </div>
  )
}

function pipelineChips(p: Profile, groqReady: boolean): Array<{ text: string; accent?: boolean }> {
  const beta = asBetaOpts(p.betaOpts)
  return [
    { text: `${p.sourceOrder} ${p.sourceCount}` },
    { text: 'MP3' },
    { text: groqReady ? 'auto captions' : 'captions manual', accent: groqReady },
    { text: p.thumbnailTemplateId ? 'template ✓' : 'no thumb' },
    ...(beta.broll.enabled ? [{ text: `B-roll ${beta.broll.density}`, accent: true }] : []),
    { text: p.autoQueueRender ? 'auto-render' : 'manual render', accent: p.autoQueueRender }
  ]
}

function ProfileEditor({ profile, onClose }: { profile: Profile; onClose: () => void }): JSX.Element {
  const saveProfile = useData((s) => s.saveProfile)
  const deleteProfile = useData((s) => s.deleteProfile)
  const templates = useStore((s) => s.templates)
  const betaOn = useStore((s) => s.settings.beta.enabled)
  const [p, setP] = useState<Profile>(profile)
  const set = (patch: Partial<Profile>): void => setP((cur) => ({ ...cur, ...patch }))
  const beta = asBetaOpts(p.betaOpts)
  const setBeta = (patch: Partial<BetaVideoOpts>): void => set({ betaOpts: { ...beta, ...patch } })
  const field = { width: '100%', border: '1px solid #23272f', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#dde0e5', background: '#0e1116', boxSizing: 'border-box' as const }
  const label = { fontSize: 10, color: '#6a7180', marginBottom: 5, fontFamily: 'var(--font-mono)', letterSpacing: '.4px' }
  const smallSelect = { ...field, padding: '7px 8px' }

  const save = async (): Promise<void> => {
    const pace = p.captionPace ?? 'auto'
    const lines = p.captionLines ?? 1
    const styleLabel = beta.style !== 'None' ? ` · ${beta.style}` : ''
    await saveProfile({
      ...p,
      rule: `${p.sourceOrder} · ${p.sourceCount} videos`,
      cap: `${p.captionPreset} · ${p.captionAspect} · ${lines}L · ${pace === 'phrase' ? 'steady' : pace}${styleLabel}`,
      images: p.imageMode === 'pool' ? `Pool of ${p.poolSize} · shuffle` : 'Single image'
    })
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {p.id.startsWith('prof-') && p.name === 'New profile' ? 'New profile' : `Editing: ${p.name}`}
        </span>
        <div onClick={onClose} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, width: 26, height: 26, display: 'grid', placeItems: 'center', fontSize: 14, color: '#8a909c', cursor: 'pointer' }}>×</div>
      </div>
      <input value={p.name} onChange={(e) => set({ name: e.target.value })} style={{ ...field, fontWeight: 600, fontSize: 14 }} placeholder="Profile name" />
      <div><div style={label}>SOURCE CHANNEL URL</div><input value={p.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} style={field} placeholder="youtube.com/@source" /></div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>ORDER</div>
          <select value={p.sourceOrder} onChange={(e) => set({ sourceOrder: e.target.value as ScrapeOrder })} style={field}><option>Latest</option><option>Popular</option><option>Oldest</option></select>
        </div>
        <div style={{ width: 80 }}><div style={label}>COUNT</div><input type="number" value={p.sourceCount} onChange={(e) => set({ sourceCount: Number(e.target.value) })} style={field} /></div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>IMAGES</div>
          <select value={p.imageMode} onChange={(e) => set({ imageMode: e.target.value as Profile['imageMode'] })} style={field}><option value="sequence">Sequence</option><option value="pool">Random pool</option></select>
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
          <select value={p.captionAspect} onChange={(e) => set({ captionAspect: e.target.value as Profile['captionAspect'] })} style={field}><option>16:9</option><option>1:1</option><option>9:16</option></select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 9 }}>
        <div style={{ flex: 1 }}><div style={label}>LINES</div>
          <select value={p.captionLines ?? 1} onChange={(e) => set({ captionLines: Number(e.target.value) as NonNullable<Profile['captionLines']> })} style={smallSelect}>{CAPTION_LINES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </div>
        <div style={{ flex: 1 }}><div style={label}>POSITION</div>
          <select value={p.captionPosition ?? 'bottom'} onChange={(e) => set({ captionPosition: e.target.value as NonNullable<Profile['captionPosition']> })} style={smallSelect}>{CAPTION_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}</select>
        </div>
        <div style={{ flex: 1 }}><div style={label}>PACE</div>
          <select value={p.captionPace ?? 'auto'} onChange={(e) => set({ captionPace: e.target.value as NonNullable<Profile['captionPace']> })} style={smallSelect}>{CAPTION_PACES.map((pace) => <option key={pace.value} value={pace.value}>{pace.label}</option>)}</select>
        </div>
      </div>
      <div style={{ border: '1px solid #1d2129', borderRadius: 10, padding: 11, background: '#0e1116', opacity: betaOn ? 1 : 0.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
          <span style={{ ...label, marginBottom: 0 }}>EFFECTS / B-ROLL</span>
          {!betaOn && <span style={{ marginLeft: 'auto', fontSize: 9.5, color: '#6a7180' }}>Enable Beta in Settings</span>}
        </div>
        <div style={{ display: 'flex', gap: 9, marginBottom: 9, pointerEvents: betaOn ? 'auto' : 'none' }}>
          <div style={{ flex: 1 }}><div style={label}>STYLE</div>
            <select value={beta.style} onChange={(e) => setBeta({ style: e.target.value as VideoStyle })} style={smallSelect}>{VIDEO_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </div>
          <div style={{ width: 88 }}><div style={label}>B-ROLL</div>
            <select value={beta.broll.enabled ? 'on' : 'off'} onChange={(e) => setBeta({ broll: { ...beta.broll, enabled: e.target.value === 'on' } })} style={smallSelect}><option value="on">On</option><option value="off">Off</option></select>
          </div>
        </div>
      </div>
      <div><div style={label}>THUMBNAIL TEMPLATE</div>
        <select value={p.thumbnailTemplateId ?? ''} onChange={(e) => set({ thumbnailTemplateId: e.target.value || undefined })} style={field}>
          <option value="">None</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: 12, color: '#cdd2da', flex: 1 }}>Auto-watch</span>
        <div onClick={() => set({ autoWatch: !p.autoWatch })} style={{ width: 34, height: 19, borderRadius: 11, background: p.autoWatch ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: p.autoWatch ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 12, color: '#cdd2da' }}>Auto-queue render</span>
          <div style={{ fontSize: 10, color: '#6a7180', marginTop: 2 }}>Goes straight to render queue after processing.</div>
        </div>
        <div onClick={() => set({ autoQueueRender: !p.autoQueueRender })} style={{ width: 34, height: 19, borderRadius: 11, background: p.autoQueueRender ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer' }}><span style={{ position: 'absolute', top: 2, right: p.autoQueueRender ? 2 : 17, width: 15, height: 15, borderRadius: '50%', background: '#fff' }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 9, marginTop: 4, paddingTop: 12, borderTop: '1px solid #1d2129' }}>
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
    captionAspect: '16:9', captionLines: 2, captionPosition: 'bottom', captionPace: 'auto',
    betaOpts: { ...DEFAULT_BETA_OPTS }
  }
}

export function Profiles(): JSX.Element {
  const profiles = useData((s) => s.profiles)
  const loadProfiles = useData((s) => s.loadProfiles)
  const runProfile = useData((s) => s.runProfile)
  const runningProfileId = useData((s) => s.runningProfileId)
  const automationEvents = useData((s) => s.automationEvents)
  const automationErrors = useData((s) => s.automationErrors)
  const groqReady = useStore((s) => !!s.settings.transcription.apiKey.trim())
  const setProfile = useStore((s) => s.setProfile)
  const setActive = useStore((s) => s.setActive)
  const loadTemplates = useStore((s) => s.loadTemplates)
  const [drawerProfile, setDrawerProfile] = useState<Profile | null>(null)

  useEffect(() => { void loadProfiles(); void loadTemplates() }, [loadProfiles, loadTemplates])

  const run = async (p: Profile): Promise<void> => {
    setProfile(p.name)
    const ids = await runProfile(p.id)
    if (ids.length > 0) setActive('compose')
  }

  const openEditor = (p: Profile): void => setDrawerProfile(p)
  const closeEditor = (): void => setDrawerProfile(null)

  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>AUTOMATION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Channel profiles</div>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => openEditor(newProfile())} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg>
            New profile
          </button>
        </div>
        <div style={{ fontSize: 13, color: '#8a909c', marginTop: 8 }}>One profile = the full pipeline. Run → quick-edit → render queue. Auto-watch runs hands-free.</div>
      </div>

      {/* Two-panel layout: card grid + slide-out editor */}
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        {/* Profile cards grid */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 15 }}>
            {profiles.map((p) => {
              const running = runningProfileId === p.id
              const event = automationEvents[p.id]
              const error = automationErrors[p.id]
              const isEditing = drawerProfile?.id === p.id
              const chips = pipelineChips(p, groqReady)

              return (
                <div key={p.id} className="me-card" style={{ border: isEditing ? '1.5px solid var(--accent)' : '1px solid #1d2129', borderRadius: 15, padding: 16, background: isEditing ? 'linear-gradient(165deg,var(--accent-soft),#0f1217)' : '#12151b', cursor: 'pointer' }} onClick={() => setProfile(p.name)}>
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: p.avatar, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#0c0d11', flex: 'none' }}>{p.mono}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div title={p.name} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 13.5, color: '#eef0f3' }}>{p.name}</div>
                      <div className="me-ellipsis" style={{ fontSize: 10, color: '#6a7180', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{p.sourceUrl || 'no source'}</div>
                    </div>
                    {p.autoWatch && <span style={{ flex: 'none', fontSize: 8.5, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#4fd6a0', background: 'rgba(54,201,142,.14)', borderRadius: 8, padding: '2px 7px' }}>WATCHING</span>}
                  </div>

                  {/* Pipeline chips — replaces the old ROWS table */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
                    {chips.map((c, i) => (
                      <span key={i} style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', border: `1px solid ${c.accent ? 'rgba(var(--accent-rgb),.4)' : '#23272f'}`, color: c.accent ? 'var(--accent)' : '#8a909c', background: c.accent ? 'var(--accent-soft)' : 'transparent', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>{c.text}</span>
                    ))}
                  </div>

                  {/* Run progress if active */}
                  {(running || event || error) && (
                    <>
                      <ProfileStepper phase={error ? 'error' : event?.phase} />
                      <div title={error ?? event?.message} className="me-clamp-2" style={{ border: `1px solid ${error ? '#4a2530' : '#262b34'}`, background: error ? 'rgba(255,90,110,.08)' : '#0e1116', borderRadius: 9, padding: '7px 10px', marginBottom: 10, fontSize: 10.5, color: error ? '#ff8a96' : '#aab0bb', lineHeight: 1.35 }}>
                        {error ?? event?.message ?? 'Starting...'}
                      </div>
                    </>
                  )}

                  {/* Card actions */}
                  <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    <div onClick={() => { if (!running) void run(p) }} className="me-btn" style={{ flex: 1, textAlign: 'center', background: '#15181f', color: '#c4cad3', border: '1px solid #262b34', borderRadius: 9, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1 }}>
                      {running ? '…Running' : '▶ Run'}
                    </div>
                    <div onClick={() => openEditor(p)} className="me-btn" style={{ border: `1px solid ${isEditing ? 'var(--accent)' : '#262b34'}`, background: isEditing ? 'var(--accent-soft)' : '#15181f', borderRadius: 9, padding: '8px 12px', fontSize: 12, color: isEditing ? 'var(--accent)' : '#c4cad3', cursor: 'pointer' }}>⚙ Edit</div>
                  </div>
                </div>
              )
            })}

            {/* New profile card */}
            <div onClick={() => openEditor(newProfile())} className="me-btn" style={{ border: '1.5px dashed #262b34', borderRadius: 15, padding: 16, textAlign: 'center', fontSize: 13, color: '#6a7180', background: '#0e1116', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 140, gap: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, border: '1.5px dashed #2c303b', display: 'grid', placeItems: 'center', fontSize: 20, color: '#5b616f' }}>+</div>
              <div>New profile</div>
            </div>
          </div>
        </div>

        {/* Slide-out editor panel — appears alongside the grid */}
        {drawerProfile && (
          <div style={{ width: 320, flex: 'none', border: '1px solid #1d2129', borderRadius: 15, padding: 18, background: '#12151b', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', position: 'sticky', top: 16 }}>
            <ProfileEditor profile={drawerProfile} onClose={closeEditor} />
          </div>
        )}
      </div>
    </ScreenPad>
  )
}
