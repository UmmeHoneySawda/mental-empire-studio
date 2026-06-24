import { ScreenPad } from '../components/primitives'
import { queue } from '../data/mock'

export function RenderQueue(): JSX.Element {
  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 22 }}>
        <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>STEP 05 — RENDER</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Render queue</div></div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8a909c' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'mePulse 1.6s infinite' }} />2 of 4 processing · 2 parallel</div>
      </div>

      <div style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b', marginBottom: 20 }}>
        <div style={{ display: 'flex', padding: '12px 18px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
          <div style={{ flex: 2.2 }}>VIDEO</div><div style={{ width: 70, textAlign: 'center' }}>MP3</div><div style={{ width: 74, textAlign: 'center' }}>IMAGES</div><div style={{ width: 70, textAlign: 'center' }}>THUMB</div><div style={{ width: 80, textAlign: 'center' }}>CAPTIONS</div><div style={{ width: 170 }}>STATUS</div>
        </div>
        {queue.map((q) => (
          <div key={q.title} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #14171d' }}>
            <div style={{ flex: 2.2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 50, height: 28, borderRadius: 6, background: q.thumb, flex: 'none' }} />
              <div style={{ minWidth: 0 }}><div style={{ fontSize: 13, color: '#dde0e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title}</div><div style={{ fontSize: 10.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>{q.channel}</div></div>
            </div>
            <div style={{ width: 70, textAlign: 'center', color: q.mp3c }}>{q.mp3}</div>
            <div style={{ width: 74, textAlign: 'center', fontSize: 12, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{q.images}</div>
            <div style={{ width: 70, textAlign: 'center', color: q.thumbc }}>{q.thumbi}</div>
            <div style={{ width: 80, textAlign: 'center', color: q.capc }}>{q.cap}</div>
            <div style={{ width: 170 }}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><div style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}><div style={{ width: q.pct, height: '100%', background: q.barColor }} /></div><span style={{ fontSize: 10.5, color: q.statusColor, fontFamily: 'var(--font-mono)', width: 54 }}>{q.statusText}</span></div></div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, borderTop: '1px solid #1d2129', paddingTop: 20 }}>
        <div style={{ flex: 1, maxWidth: 430 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 7 }}>OUTPUT FOLDER</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, border: '1px solid #23272f', borderRadius: 9, padding: '10px 13px', fontSize: 12, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0e1116', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>/Desktop/MentalEmpire_out</div>
            <div className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Browse</div>
          </div>
        </div>
        <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 7 }}>FORMAT</div><div style={{ border: '1px solid #23272f', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#dde0e5', background: '#0e1116' }}>mp4 · 1080p ▾</div></div>
        <div style={{ flex: 1 }} />
        <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13.5, padding: '13px 26px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 6px 20px -5px var(--accent-glow)' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z" /></svg>Render all (4)</div>
      </div>
    </ScreenPad>
  )
}
