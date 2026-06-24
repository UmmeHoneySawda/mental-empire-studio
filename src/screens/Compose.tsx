import { useStore } from '../store/useStore'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import { imageList, capPresets, activeCapPreset } from '../data/mock'

function Tab({ id, label, icon }: { id: 'media' | 'captions'; label: string; icon: JSX.Element }): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  const setComposeTab = useStore((s) => s.setComposeTab)
  const on = composeTab === id
  return (
    <div onClick={() => setComposeTab(id)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: on ? '1px solid var(--accent)' : '1px solid #1d2129', background: on ? 'var(--accent-soft)' : 'transparent', color: on ? '#f2f4f7' : '#8a909c', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
      {icon}{label}
    </div>
  )
}

function MediaTab(): JSX.Element {
  const mediaMode = useStore((s) => s.mediaMode)
  const setMediaMode = useStore((s) => s.setMediaMode)
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 10, overflow: 'hidden', fontSize: 12.5 }}>
          <div onClick={() => setMediaMode('sequence')} style={{ padding: '9px 16px', cursor: 'pointer', background: mediaMode === 'sequence' ? 'var(--accent)' : 'transparent', color: mediaMode === 'sequence' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>Sequence</div>
          <div onClick={() => setMediaMode('pool')} style={{ padding: '9px 16px', cursor: 'pointer', background: mediaMode === 'pool' ? 'var(--accent)' : 'transparent', color: mediaMode === 'pool' ? 'var(--accent-ink)' : '#8a909c', fontWeight: 600 }}>Random pool</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
        <div style={{ flex: 'none', width: 520 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, aspectRatio: '16/9', background: 'linear-gradient(135deg,#23262e,#15171d)', position: 'relative', overflow: 'hidden', display: 'grid', placeItems: 'center' }}>
            <div style={{ position: 'absolute', left: '9%', bottom: 0, width: '36%', height: '88%', background: 'linear-gradient(180deg,#3a4150,#23262e)', borderRadius: '80px 80px 0 0' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.45))' }} />
            <div style={{ position: 'absolute', top: 14, left: 14, border: '1px dashed rgba(255,255,255,.3)', borderRadius: 7, padding: '5px 9px', fontSize: 10, color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>⤢ Ken Burns</div>
            <div style={{ position: 'absolute', bottom: 12, left: 14, right: 14, height: 6, borderRadius: 4, background: 'rgba(255,255,255,.18)', overflow: 'hidden' }}><div style={{ width: '35%', height: '100%', background: 'var(--accent)' }} /></div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#c4cad3', cursor: 'pointer' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>Re-roll</div>
            <div style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c' }}>Crossfade ▾</div>
            <div style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '8px 13px', fontSize: 11.5, color: '#8a909c', fontFamily: 'var(--font-mono)' }}>seed 4821</div>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.6px', color: '#6a7180', marginBottom: 10 }}>IMAGES · EVEN AUTO-SPLIT</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {imageList.map((im) => (
              <div key={im.name} className="me-row" style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #1d2129', borderRadius: 11, padding: 10, background: '#12151b' }}>
                <span style={{ color: '#444b57', cursor: 'grab' }}>⠿</span>
                <div style={{ width: 58, height: 33, borderRadius: 6, background: im.thumb, flex: 'none' }} />
                <div style={{ flex: 1, fontSize: 12.5, color: '#dde0e5', fontFamily: 'var(--font-mono)' }}>{im.name}</div>
                <div style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{im.range}</div>
                <span style={{ color: '#5b616f', cursor: 'pointer' }}>✕</span>
              </div>
            ))}
            <div style={{ border: '1.5px dashed #262b34', borderRadius: 11, padding: 16, textAlign: 'center', fontSize: 12, color: '#6a7180', background: '#0e1116' }}>＋ Drop images here</div>
          </div>
        </div>
      </div>

      <div style={{ border: '1px solid #1d2129', borderRadius: 13, padding: '15px 17px', background: '#12151b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180', width: 48 }}>AUDIO</span>
          <div style={{ flex: 1, height: 30, borderRadius: 7, background: 'repeating-linear-gradient(90deg,#2b303b,#2b303b 2px,#1a1e26 2px,#1a1e26 5px)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>20:05</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180', width: 48 }}>IMAGE</span>
          <div style={{ flex: 1, display: 'flex', gap: 4, height: 24 }}>
            <div style={{ flex: 1, borderRadius: 6, background: 'var(--accent)', opacity: 0.85, display: 'grid', placeItems: 'center', fontSize: 10, color: 'var(--accent-ink)', fontWeight: 600 }}>img 1</div>
            <div style={{ flex: 1, borderRadius: 6, background: '#2b303b', display: 'grid', placeItems: 'center', fontSize: 10, color: '#aab0bb' }}>img 2</div>
            <div style={{ flex: 1, borderRadius: 6, background: '#2b303b', display: 'grid', placeItems: 'center', fontSize: 10, color: '#aab0bb' }}>img 3</div>
          </div>
        </div>
      </div>
    </>
  )
}

function chip(text: string, on = false) {
  return <span style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', borderRadius: 7, padding: '5px 9px', background: on ? 'var(--accent-soft)' : 'transparent' }}>{text}</span>
}

function CaptionsTab(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 18 }}>
      <div style={{ flex: 'none', width: 284, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 11 }}>PRESET</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {capPresets.map((name) => {
              const on = name === activeCapPreset
              return <div key={name} className="me-card" style={{ border: on ? '1px solid var(--accent)' : '1px solid #1d2129', background: on ? 'var(--accent-soft)' : '#0e1116', borderRadius: 9, padding: '11px 5px', textAlign: 'center', cursor: 'pointer' }}><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: on ? '#f2f4f7' : '#8a909c' }}>{name}</div></div>
            })}
          </div>
        </div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 6 }}>Font</div><div style={{ border: '1px solid #23272f', borderRadius: 8, padding: 9, fontSize: 13, color: '#dde0e5', background: '#0e1116', textAlign: 'center', fontWeight: 600 }}>Montserrat ▾</div></div>
          <div><div style={{ fontSize: 10.5, color: '#6a7180', marginBottom: 7 }}>Animation</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 10.5 }}>{chip('Pop-in', true)}{chip('Bounce')}{chip('Slide')}{chip('Type')}</div></div>
          <div style={{ display: 'flex', gap: 9 }}>
            <div style={{ flex: 1, border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 600, color: '#dde0e5' }}>Keywords</span><span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: '#1f9c6b', color: '#fff', borderRadius: 9, padding: '1px 6px' }}>ON</span></div><div style={{ fontSize: 9, color: '#6a7180', marginTop: 4 }}>Auto-highlight</div></div>
            <div style={{ flex: 1, border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ fontSize: 11, fontWeight: 600, color: '#dde0e5' }}>Punch</span><span style={{ marginLeft: 'auto', fontSize: 8.5, fontWeight: 700, background: '#1f9c6b', color: '#fff', borderRadius: 9, padding: '1px 6px' }}>ON</span></div><div style={{ fontSize: 9, color: '#6a7180', marginTop: 4 }}>Zoom on hit</div></div>
          </div>
        </div>
      </div>

      <div style={{ flex: 'none', width: 210 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>PREVIEW</span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 10, padding: '2px 8px' }}>16:9</span></div>
        <div style={{ width: 210, border: '1px solid #1d2129', borderRadius: 12, aspectRatio: '16/9', background: 'linear-gradient(135deg,#23262e,#15171d)', position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 18, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: '14%', bottom: 0, width: '34%', height: '80%', background: 'linear-gradient(180deg,#3a4150,#23262e)', borderRadius: '50px 50px 0 0' }} />
          <div style={{ position: 'relative', textAlign: 'center', fontFamily: 'var(--font-poster)', fontSize: 19, lineHeight: 1.05, color: '#fff', textShadow: '2px 2px 0 #000' }}>YOU ARE <span style={{ color: '#1f9c6b' }}>NOT</span> CRAZY</div>
        </div>
        <div style={{ fontSize: 10, color: '#6a7180', textAlign: 'center', marginTop: 9, lineHeight: 1.4 }}>Keyword pops green + scale (Hormozi)</div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#6a7180' }}>TRANSCRIPT · WORD-LEVEL</span><div style={{ flex: 1 }} /><div className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 8, padding: '6px 11px', fontSize: 11, color: '#c4cad3', cursor: 'pointer' }}>Re-transcribe ↻</div></div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 16, background: '#12151b', fontSize: 14, lineHeight: 2.1, color: '#cdd2da', height: 178, overflow: 'hidden' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662' }}>0:02</span> You are <span style={{ background: '#1f9c6b', color: '#fff', borderRadius: 4, padding: '0 5px', fontWeight: 600 }}>not</span> crazy.<br />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662' }}>0:04</span> What you're <span style={{ borderBottom: '2px solid var(--accent)' }}>feeling</span> is real.<br />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662' }}>0:07</span> Gaslighting makes you doubt…<br />
          <span style={{ color: '#4f5662', fontSize: 12 }}>— click to fix · drag to retime · ★ to emphasize —</span>
        </div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 14, background: '#12151b', marginTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', marginBottom: 10 }}>WORD TIMELINE</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {wordChip('You')}{wordChip('are')}{wordChip('not ★', 'accent')}{wordChip('crazy')}
            <span style={{ width: 1, height: 18, background: '#23272f', margin: '0 3px' }} />
            {wordChip('what')}{wordChip("you're")}{wordChip('feeling ★', 'green')}{wordChip('is')}{wordChip('real')}
          </div>
        </div>
      </div>
    </div>
  )
}

function wordChip(text: string, variant?: 'accent' | 'green'): JSX.Element {
  if (variant === 'accent') return <span style={{ border: '1px solid var(--accent)', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, color: 'var(--accent-ink)', background: 'var(--accent)', fontWeight: 600 }}>{text}</span>
  if (variant === 'green') return <span style={{ border: '1px solid #1f9c6b', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, color: '#fff', background: '#1f9c6b', fontWeight: 600 }}>{text}</span>
  return <span style={{ border: '1px solid #2c303b', borderRadius: 6, padding: '5px 9px', fontSize: 11.5, color: '#aab0bb', background: '#0e1116' }}>{text}</span>
}

export function Compose(): JSX.Element {
  const composeTab = useStore((s) => s.composeTab)
  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 18 }}>
        <div><Eyebrow>STEP 02 — COMPOSE</Eyebrow><Title>Build the video</Title></div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: '#6a7180' }}>Gaslighting Explained · 20:05</div>
      </div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 22 }}>
        <Tab id="media" label="Audio + Image" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.7" /><path d="M4 17l5-4 4 3 2-2 5 4" /></svg>} />
        <Tab id="captions" label="Captions" icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 14h4" /><path d="M14 14h3" /></svg>} />
        <div style={{ flex: 1 }} />
        <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '9px 16px', fontSize: 12.5, color: '#c4cad3', cursor: 'pointer' }}>Save &amp; send to render<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
      </div>
      {composeTab === 'media' ? <MediaTab /> : <CaptionsTab />}
    </ScreenPad>
  )
}
