import { useStore } from '../store/useStore'
import { ScreenPad } from '../components/primitives'
import { libraryChannels, uploads, statusStyle, activity } from '../data/mock'

function Kpi({ label, value, sub, accentCard }: { label: string; value: string; sub: JSX.Element; accentCard?: boolean }): JSX.Element {
  return (
    <div className="me-card" style={{ border: accentCard ? '1px solid var(--accent)' : '1px solid #1d2129', borderRadius: 15, padding: 18, background: accentCard ? 'linear-gradient(165deg,var(--accent-soft),#0f1217)' : 'linear-gradient(165deg,#14171e,#0f1217)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.8px', color: accentCard ? '#cdd2da' : '#6a7180' }}>{label}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" /></svg>
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30, color: '#f4f6f9', letterSpacing: '-1px' }}>{value}</div>
      <div style={{ marginTop: 6 }}>{sub}</div>
    </div>
  )
}

const up = (txt: string) => <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#36c98e' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 17l6-6 4 4 6-7" /></svg>{txt}</div>

export function Library(): JSX.Element {
  const showRail = useStore((s) => s.showActivityRail)
  const greet = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 26 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>{greet}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 27, letterSpacing: '-.5px', color: '#f4f6f9', lineHeight: 1 }}>Good evening — 3 channels running</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, color: '#c4cad3', cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>Re-scrape
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 24 }}>
        <Kpi label="TOTAL VIEWS" value="107K" sub={up('+18% this week')} />
        <Kpi label="SUBSCRIBERS" value="3,195" sub={up('+214 (7d)')} />
        <Kpi label="UPLOADED" value="67" sub={<div style={{ fontSize: 11.5, color: '#6a7180' }}>across 3 channels</div>} />
        <Kpi label="IN QUEUE" value="4" sub={<div style={{ fontSize: 11.5, color: '#cdd2da' }}>1 rendering · 60%</div>} accentCard />
      </div>

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Your channels</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>scraped · no API</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 13, marginBottom: 26 }}>
            {libraryChannels.map((ch) => (
              <div key={ch.handle} className="me-card" style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: ch.avatar, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#0c0d11' }}>{ch.mono}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#eef0f3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.name}</div>
                    <div style={{ fontSize: 10.5, color: '#6a7180', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch.handle}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40, marginBottom: 12 }}>
                  {ch.bars.map((h, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: '3px 3px 0 0', background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', opacity: 0.85, height: `${h}%` }} />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1d2129', paddingTop: 11 }}>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3' }}>{ch.views}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>VIEWS</div></div>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3' }}>{ch.subs}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>SUBS</div></div>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--accent)' }}>{ch.uploaded}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>DONE</div></div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Recent uploads</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11.5, color: 'var(--accent)', cursor: 'pointer' }}>View all →</span>
          </div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b' }}>
            <div style={{ display: 'flex', padding: '11px 16px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
              <div style={{ flex: 2.4 }}>VIDEO</div><div style={{ width: 120 }}>CHANNEL</div><div style={{ width: 108, textAlign: 'center' }}>STATUS</div><div style={{ width: 64, textAlign: 'right' }}>VIEWS</div><div style={{ width: 62, textAlign: 'right' }}>AGE</div>
            </div>
            {uploads.map((u) => {
              const s = statusStyle[u.status]
              return (
                <div key={u.title} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid #14171d' }}>
                  <div style={{ flex: 2.4, display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <div style={{ width: 46, height: 26, borderRadius: 5, background: u.thumb, flex: 'none' }} />
                    <span style={{ fontSize: 12.5, color: '#dde0e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.title}</span>
                  </div>
                  <div style={{ width: 120, fontSize: 11.5, color: '#8a909c' }}>{u.channel}</div>
                  <div style={{ width: 108, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: '3px 10px', background: s.bg, color: s.color }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />{u.status}
                    </span>
                  </div>
                  <div style={{ width: 64, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12.5, color: '#dde0e5' }}>{u.views}</div>
                  <div style={{ width: 62, textAlign: 'right', fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{u.when}</div>
                </div>
              )
            })}
          </div>
        </div>

        {showRail && (
          <div style={{ width: 268, flex: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 16, background: '#12151b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e' }} />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#e9ebef' }}>Activity</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f' }}>live</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
                {activity.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span>
                    <span style={{ color: a.color, flex: 'none' }}>{a.icon}</span>
                    <span style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.4 }}>{a.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ border: '1px solid var(--accent)', borderRadius: 14, padding: 16, background: 'linear-gradient(165deg,var(--accent-soft),#0f1217)' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#f2f4f7', marginBottom: 6 }}>Next auto-run</div>
              <div style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.5, marginBottom: 13 }}>Mental Empire · checks for new uploads in <b style={{ color: 'var(--accent)' }}>3h 42m</b></div>
              <div className="me-btn" style={{ textAlign: 'center', border: '1px solid #2a2f39', background: '#15181f', borderRadius: 9, padding: 8, fontSize: 12, fontWeight: 600, color: '#dde0e5', cursor: 'pointer' }}>Run now</div>
            </div>
          </div>
        )}
      </div>
    </ScreenPad>
  )
}
