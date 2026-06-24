import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import { videos, dlHistory } from '../data/mock'

export function Download(): JSX.Element {
  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}><Eyebrow>STEP 01 — SOURCE</Eyebrow><Title>Download audio from a channel</Title></div>

      <div style={{ display: 'flex', gap: 11, marginBottom: 18 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: '#12151b', border: '1px solid #23272f', borderRadius: 11, padding: '12px 15px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b616f" strokeWidth="2"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
          <span style={{ fontSize: 13, color: '#dde0e5', fontFamily: 'var(--font-mono)' }}>youtube.com/@PowerWithinOfficial-q7d</span>
        </div>
        <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '0 20px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 4px 16px -4px var(--accent-glow)' }}>Fetch</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 13, border: '1px solid #1d2129', borderRadius: 13, padding: '13px 16px', marginBottom: 18, background: '#12151b' }}>
        <div style={{ width: 44, height: 44, borderRadius: 11, background: 'linear-gradient(135deg,#2d3340,#1a1e26)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: '#aab1bf' }}>ME</div>
        <div><div style={{ fontWeight: 600, fontSize: 14, color: '#eef0f3' }}>Mental Empire</div><div style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>455 subscribers · 25 videos</div></div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 9, overflow: 'hidden', fontSize: 12 }}>
            <div style={{ padding: '8px 14px', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}>Popular</div>
            <div style={{ padding: '8px 14px', color: '#8a909c' }}>Latest</div>
            <div style={{ padding: '8px 14px', color: '#8a909c' }}>Oldest</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #23272f', borderRadius: 9, padding: '7px 12px', background: '#0e1116' }}><span style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>QTY</span><span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: '#eef0f3' }}>10</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #23272f', borderRadius: 9, padding: '7px 12px', background: '#0e1116', fontSize: 11.5, color: '#8a909c' }}>mp3 · 192k ▾</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 13, marginBottom: 20 }}>
        {videos.map((v) => (
          <div key={v.title} className="me-vid me-card" style={{ border: `1px solid ${v.sel ? 'var(--accent)' : '#1d2129'}`, borderRadius: 12, overflow: 'hidden', background: '#12151b', cursor: 'pointer' }}>
            <div style={{ position: 'relative', height: 92, background: v.thumb }}>
              <div className="me-vidsel" style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${v.sel ? 'var(--accent)' : 'rgba(255,255,255,.5)'}`, background: v.sel ? 'var(--accent)' : 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', color: 'var(--accent-ink)' }}>{v.sel ? '✓' : ''}</div>
              <div style={{ position: 'absolute', bottom: 7, right: 7, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(0,0,0,.7)', color: '#dde0e5', padding: '2px 6px', borderRadius: 5 }}>{v.dur}</div>
            </div>
            <div style={{ padding: '11px 12px' }}>
              <div style={{ fontSize: 12, color: '#dde0e5', lineHeight: 1.35, height: 33, overflow: 'hidden' }}>{v.title}</div>
              <div style={{ fontSize: 10.5, color: '#5b616f', fontFamily: 'var(--font-mono)', marginTop: 6 }}>{v.views} views</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid #1d2129', paddingTop: 18 }}>
        <div style={{ fontSize: 13, color: '#8a909c' }}><b style={{ color: '#eef0f3', fontFamily: 'var(--font-display)' }}>2</b> videos selected · ~39 MB</div>
        <div style={{ flex: 1 }} />
        <div className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '11px 18px', fontSize: 12.5, color: '#c4cad3', cursor: 'pointer' }}>Download mp3 only</div>
        <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 12.5, padding: '11px 20px', borderRadius: 10, cursor: 'pointer', boxShadow: '0 4px 16px -4px var(--accent-glow)' }}>Add to queue<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg></div>
      </div>

      <div style={{ marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Already downloaded</span>
          <span style={{ fontSize: 11, color: '#6a7180' }}>— resume unfinished, don't re-fetch</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 8, overflow: 'hidden', fontSize: 11 }}>
            <span style={{ padding: '6px 11px', background: 'var(--accent-soft)', color: '#dde0e5', fontWeight: 600 }}>Unfinished</span>
            <span style={{ padding: '6px 11px', color: '#8a909c' }}>All</span>
          </div>
        </div>
        <div style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b' }}>
          <div style={{ display: 'flex', padding: '11px 16px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
            <div style={{ flex: 2.4 }}>CLIP</div><div style={{ width: 120 }}>SOURCE</div><div style={{ width: 130 }}>STAGE</div><div style={{ width: 140 }}>PROGRESS</div><div style={{ width: 80, textAlign: 'right' }}>ACTION</div>
          </div>
          {dlHistory.map((d) => {
            const barColor = d.pct === '100%' ? '#36c98e' : 'var(--accent)'
            const stageColor = d.pct === '100%' ? '#4fd6a0' : '#cdd2da'
            return (
              <div key={d.id} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #14171d' }}>
                <div style={{ flex: 2.4, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 48, height: 27, borderRadius: 6, background: d.thumb, flex: 'none' }} />
                  <div style={{ minWidth: 0 }}><div style={{ fontSize: 12.5, color: '#dde0e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.title}</div><div style={{ fontSize: 10, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>{d.size} · {d.when}</div></div>
                </div>
                <div style={{ width: 120, fontSize: 11, color: '#8a909c', fontFamily: 'var(--font-mono)' }}>{d.channel}</div>
                <div style={{ width: 130, fontSize: 11.5, color: stageColor }}>{d.stage}</div>
                <div style={{ width: 140 }}><div style={{ height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}><div style={{ width: d.pct, height: '100%', background: barColor }} /></div></div>
                <div style={{ width: 80, textAlign: 'right' }}><span className="me-btn" style={{ display: 'inline-block', border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '6px 12px', fontSize: 11, color: '#dde0e5', cursor: 'pointer' }}>{d.action}</span></div>
              </div>
            )
          })}
        </div>
      </div>
    </ScreenPad>
  )
}
