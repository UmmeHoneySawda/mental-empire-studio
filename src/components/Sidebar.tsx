import type { ReactNode } from 'react'
import { useStore } from '../store/useStore'
import type { ScreenKey } from '@shared/types'

interface NavDef {
  key: ScreenKey
  label: string
  icon: ReactNode
  badge?: string
}

const icon = (children: ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{children}</svg>
)

const PRODUCE: NavDef[] = [
  { key: 'library', label: 'Library', icon: icon(<><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>) },
  { key: 'channels', label: 'My Channels', icon: icon(<><path d="M4 11a9 9 0 019-9" /><path d="M4 4a16 16 0 0116 16" /><circle cx="5" cy="19" r="1.6" /></>) },
  { key: 'download', label: 'Download', icon: icon(<><path d="M12 3v13" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" /></>) },
  { key: 'compose', label: 'Compose', icon: icon(<><path d="M12 3l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></>) },
  { key: 'thumb', label: 'Thumbnails', icon: icon(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M8 11h8" /><path d="M8 15h5" /></>) }
]

const AUTOMATE: NavDef[] = [
  { key: 'render', label: 'Render Queue', icon: icon(<path d="M5 5l13 7-13 7z" />), badge: '4' },
  { key: 'profiles', label: 'Profiles', icon: icon(<path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" />) },
  { key: 'settings', label: 'Settings', icon: icon(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.8 7.8 0 000-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 00-2.6-1.5l-.3-2.1H8l-.3 2.1a7.6 7.6 0 00-2.6 1.5l-2-.8L1.3 9.2 3 10.5a7.8 7.8 0 000 3l-1.7 1.3 1.8 3.1 2-.8a7.6 7.6 0 002.6 1.5l.3 2.1h4l.3-2.1a7.6 7.6 0 002.6-1.5l2 .8 1.8-3.1z" /></>) }
]

function NavItem({ def }: { def: NavDef }): JSX.Element {
  const active = useStore((s) => s.active)
  const setActive = useStore((s) => s.setActive)
  const on = active === def.key
  return (
    <div
      onClick={() => setActive(def.key)}
      className="me-nav"
      style={{
        display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px', borderRadius: 10,
        cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500,
        background: on ? 'var(--accent-soft)' : 'transparent',
        color: on ? '#f2f4f7' : '#8a909c', position: 'relative', marginBottom: 2
      }}
    >
      <span style={{ position: 'absolute', left: -12, top: 8, bottom: 8, width: 3, borderRadius: '0 4px 4px 0', background: on ? 'var(--accent)' : 'transparent', boxShadow: on ? '0 0 10px var(--accent-glow)' : 'none' }} />
      {def.icon}
      {def.label}
      {def.badge && (
        <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '1px 7px', borderRadius: 8 }}>{def.badge}</span>
      )}
    </div>
  )
}

function Heading({ children }: { children: ReactNode }): JSX.Element {
  return <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '1.4px', color: '#454b57', padding: '8px 10px' }}>{children}</div>
}

export function Sidebar(): JSX.Element {
  return (
    <div style={{ width: 236, flex: 'none', background: '#0a0c10', borderRight: '1px solid #1a1e26', display: 'flex', flexDirection: 'column', padding: '16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--accent-ink)', fontSize: 14, boxShadow: '0 4px 14px -4px var(--accent-glow)' }}>ME</div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: '#f2f4f7' }}>Mental Empire</div>
          <div style={{ fontSize: 10.5, color: '#5b616f', fontFamily: 'var(--font-mono)', letterSpacing: '.3px' }}>studio v{window.api?.appVersion || '0.1.0'}</div>
        </div>
      </div>

      <Heading>PRODUCE</Heading>
      {PRODUCE.map((d) => <NavItem key={d.key} def={d} />)}

      <div style={{ paddingTop: 8 }}><Heading>AUTOMATE</Heading></div>
      {AUTOMATE.map((d) => <NavItem key={d.key} def={d} />)}

      <div style={{ flex: 1 }} />

      <div style={{ border: '1px solid #1d2129', borderRadius: 12, padding: 12, background: 'linear-gradient(180deg,#10141a,#0c0f13)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e', animation: 'mePulse 2s infinite' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#cdd2da' }}>Auto-watch active</span>
        </div>
        <div style={{ fontSize: 10.5, color: '#6a7180', lineHeight: 1.5 }}>3 channels · checks every 6h · last run 09:30</div>
        <div style={{ marginTop: 10, height: 5, borderRadius: 3, background: '#1a1e26', overflow: 'hidden' }}>
          <div style={{ width: '62%', height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f' }}>
          <span>14.2 GB used</span><span>23 GB</span>
        </div>
      </div>
    </div>
  )
}
