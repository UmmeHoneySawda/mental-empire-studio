import { useStore } from '../store/useStore'
import { ScreenPad } from '../components/primitives'
import { profiles } from '../data/mock'

export function Profiles(): JSX.Element {
  const activeProfile = useStore((s) => s.profile)
  const setProfile = useStore((s) => s.setProfile)

  const rows: { k: string; label: string }[] = [
    { k: 'rule', label: 'SOURCE' },
    { k: 'images', label: 'IMAGES' },
    { k: 'thumb', label: 'THUMB' },
    { k: 'cap', label: 'CAPTIONS' },
    { k: 'out', label: 'OUTPUT' }
  ]

  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>AUTOMATION</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Channel profiles</div>
        <div style={{ fontSize: 13, color: '#8a909c', marginTop: 8 }}>One profile bundles the whole pipeline. <b style={{ color: '#cdd2da' }}>Run → quick-edit 1–2 videos &amp; thumbnails → push to render queue</b>, then do the next profile. Auto-watch runs it hands-free when a source posts.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 15 }}>
        {profiles.map((p) => {
          const on = p.name === activeProfile
          return (
            <div key={p.id} onClick={() => setProfile(p.name)} className="me-card" style={{ border: on ? '1.5px solid var(--accent)' : '1px solid #1d2129', borderRadius: 15, padding: 18, background: on ? 'linear-gradient(165deg,var(--accent-soft),#0f1217)' : '#12151b', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 15 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: p.avatar, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#0c0d11' }}>{p.mono}</div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#eef0f3' }}>{p.name}</div>
                <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#4fd6a0', background: 'rgba(54,201,142,.14)', borderRadius: 8, padding: '2px 8px' }}>WATCHING</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 11.5, marginBottom: 16 }}>
                {rows.map((r) => (
                  <div key={r.k} style={{ display: 'flex', gap: 9 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', width: 62, flex: 'none', paddingTop: 1 }}>{r.label}</span>
                    <span style={{ color: r.k === 'out' ? '#8a909c' : '#cdd2da', fontFamily: r.k === 'out' ? 'var(--font-mono)' : undefined, fontSize: r.k === 'out' ? 10.5 : undefined }}>{(p as unknown as Record<string, string>)[r.k]}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 9 }}>
                <div className="me-btn" style={{ flex: 1, textAlign: 'center', background: on ? 'linear-gradient(180deg,var(--accent),var(--accent-deep))' : '#15181f', color: on ? 'var(--accent-ink)' : '#c4cad3', border: on ? 'none' : '1px solid #262b34', borderRadius: 9, padding: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>▶ Run</div>
                <div className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '9px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Edit</div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="me-btn" style={{ marginTop: 15, border: '1.5px dashed #262b34', borderRadius: 13, padding: 14, textAlign: 'center', fontSize: 12.5, color: '#6a7180', background: '#0e1116', cursor: 'pointer' }}>＋ New profile</div>
    </ScreenPad>
  )
}
