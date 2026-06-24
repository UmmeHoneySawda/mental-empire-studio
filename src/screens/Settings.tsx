import { ScreenPad } from '../components/primitives'
import { Toggle } from '../components/primitives'
import { activity } from '../data/mock'
import { useStore } from '../store/useStore'
import type { AccentName } from '@shared/types'

const ACCENTS: AccentName[] = ['Amber', 'Violet', 'Emerald', 'Crimson']
const ACCENT_SWATCH: Record<AccentName, string> = {
  Amber: '#f5b323',
  Violet: '#8b7cff',
  Emerald: '#36c98e',
  Crimson: '#ff5a6e'
}

function Appearance(): JSX.Element {
  const { accent, setAccent, ambientGlow, toggleAmbientGlow, showActivityRail, toggleActivityRail } = useStore()
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 13 }}>APPEARANCE</div>
      <div style={{ fontSize: 12, color: '#8a909c', marginBottom: 8 }}>Accent</div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 15 }}>
        {ACCENTS.map((a) => (
          <div key={a} onClick={() => setAccent(a)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 7, border: a === accent ? '1px solid var(--accent)' : '1px solid #23272f', background: a === accent ? 'var(--accent-soft)' : '#0e1116', borderRadius: 9, padding: '7px 12px', cursor: 'pointer' }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: ACCENT_SWATCH[a] }} />
            <span style={{ fontSize: 11.5, color: a === accent ? '#f2f4f7' : '#8a909c', fontWeight: a === accent ? 600 : 400 }}>{a}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
        <div onClick={toggleAmbientGlow} style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116', cursor: 'pointer' }}><span style={{ flex: 1, color: '#cdd2da' }}>Ambient accent glow</span><Toggle on={ambientGlow} /></div>
        <div onClick={toggleActivityRail} style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116', cursor: 'pointer' }}><span style={{ flex: 1, color: '#cdd2da' }}>Show activity rail (Library)</span><Toggle on={showActivityRail} /></div>
      </div>
    </div>
  )
}

function Card({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 13 }}>{label}</div>
      {children}
    </div>
  )
}

function field(label: string, value: string, mono = false) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#8a909c', marginBottom: 6 }}>{label}</div>
      <div style={{ border: '1px solid #23272f', borderRadius: 8, padding: '8px 13px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</div>
    </div>
  )
}

function rowToggle(label: string, on: boolean, right?: React.ReactNode) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116' }}>
      <span style={{ flex: 1, color: on ? '#cdd2da' : '#6a7180' }}>{label}</span>
      {right ?? <Toggle on={on} />}
    </div>
  )
}

export function Settings(): JSX.Element {
  return (
    <ScreenPad>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>CONFIGURE</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Settings</div>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Appearance />
          <Card label="OUTPUT">
            <div style={{ fontSize: 12, color: '#8a909c', marginBottom: 8 }}>File naming template</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
              <span style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{'{channel} - {title}'}</span>
              <span style={{ border: '1px solid #23272f', color: '#8a909c', borderRadius: 8, padding: '7px 12px', fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>{'{date}_{title}'}</span>
            </div>
            <div style={{ fontSize: 11, color: '#6a7180' }}>e.g. <span style={{ fontFamily: 'var(--font-mono)', color: '#aab0bb' }}>Mental Empire - Gaslighting Explained.mp4</span></div>
          </Card>

          <Card label="RENDER">
            <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Parallel renders</div><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ border: '1px solid #23272f', borderRadius: 8, padding: '8px 17px', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3', background: '#0e1116' }}>2</div><span style={{ fontSize: 11, color: '#6a7180' }}>at a time</span></div></div>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Quality</div><div style={{ display: 'flex', border: '1px solid #23272f', borderRadius: 8, overflow: 'hidden', fontSize: 11.5 }}><div style={{ padding: '8px 12px', color: '#8a909c' }}>720p</div><div style={{ padding: '8px 12px', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 600 }}>1080p</div><div style={{ padding: '8px 12px', color: '#8a909c' }}>1440p</div></div></div>
              <div><div style={{ fontSize: 12, color: '#8a909c', marginBottom: 7 }}>Encoder</div><div style={{ border: '1px solid #23272f', borderRadius: 8, padding: '8px 13px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116' }}>H.264 · GPU ▾</div></div>
            </div>
          </Card>

          <Card label="AUTO-SCRAPE · NO API">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 1 }}><Toggle on /><span style={{ fontSize: 12.5, color: '#cdd2da' }}>Auto-scrape enabled</span></div>
              <span style={{ fontSize: 11, color: '#6a7180' }}>last run 09:30</span>
            </div>
            <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap', marginBottom: 11 }}>
              {field('Frequency', 'Every 6 hours ▾')}
              {field('Request delay', '1.5s', true)}
              {field('Retries on fail', '3×', true)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #1d2129', borderRadius: 9, padding: '11px 13px', background: '#0e1116' }}><span style={{ flex: 1, color: '#cdd2da' }}>Sign-in cookies (age-gated)</span><span style={{ fontSize: 11, color: '#36c98e', fontWeight: 600 }}>✓ imported</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #1d2129', borderRadius: 9, padding: '9px 13px', background: '#0e1116' }}><span style={{ color: '#cdd2da', flex: 'none' }}>Proxy (optional)</span><div style={{ flex: 1, border: '1px solid #23272f', borderRadius: 7, padding: '6px 10px', fontSize: 11, color: '#5b616f', fontFamily: 'var(--font-mono)', background: '#0c0d11' }}>http://user:pass@host:port</div></div>
            </div>
          </Card>

          <Card label="BACKGROUND">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12.5 }}>
              {rowToggle('Run in background (system tray)', true)}
              {rowToggle('Start on Windows sign-in', true)}
              {rowToggle('Desktop notifications (goals & reminders)', true)}
              {rowToggle('Webhook (Pushover / calendar)', false, <span style={{ fontSize: 11, color: '#6a7180' }}>not set</span>)}
            </div>
          </Card>
        </div>

        <div style={{ width: 300, flex: 'none', border: '1px solid #1d2129', borderRadius: 14, padding: 18, background: '#12151b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e' }} /><span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#e9ebef' }}>Activity log</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {activity.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 10 }}><span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span><span style={{ color: a.color, flex: 'none' }}>{a.icon}</span><span style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.4 }}>{a.text}</span></div>
            ))}
          </div>
          <div style={{ marginTop: 16, borderTop: '1px solid #1d2129', paddingTop: 14, fontSize: 11, color: '#6a7180', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Storage used</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>14.2 GB</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Jobs this week</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>23</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Version</span><span style={{ color: '#cdd2da', fontFamily: 'var(--font-mono)' }}>2.4.1</span></div>
          </div>
        </div>
      </div>
    </ScreenPad>
  )
}
