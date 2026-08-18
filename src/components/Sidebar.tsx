import type { ReactNode } from 'react'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import type { ScreenKey } from '@shared/types'
import { renderLiveState } from '../lib/renderProgress'

interface NavDef {
  key: ScreenKey
  label: string
  icon: ReactNode
  step?: number
  badge?: string
}

const icon = (children: ReactNode) => (
  <svg aria-hidden="true" focusable="false" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{children}</svg>
)

const TODAY: NavDef[] = [
  { key: 'home', label: 'Today', icon: icon(<><rect x="3" y="4" width="8" height="7" rx="2" /><rect x="13" y="4" width="8" height="12" rx="2" /><rect x="3" y="13" width="8" height="7" rx="2" /><path d="M14 20h6" /></>) }
]

const PRODUCTION: NavDef[] = [
  { key: 'sources', label: 'Sources', step: 1, icon: icon(<><path d="M12 3v13" /><path d="M7 11l5 5 5-5" /><path d="M5 21h14" /></>) },
  { key: 'compose', label: 'Video Studio', step: 2, icon: icon(<><path d="M12 3l8 4-8 4-8-4z" /><path d="M4 12l8 4 8-4" /><path d="M4 17l8 4 8-4" /></>) },
  { key: 'thumb', label: 'Thumbnails', step: 3, icon: icon(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M8 11h8" /><path d="M8 15h5" /></>) },
  { key: 'render', label: 'Render Queue', step: 4, icon: icon(<path d="M5 5l13 7-13 7z" />) },
  { key: 'publish', label: 'Ready to Upload', step: 5, icon: icon(<><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>) },
  // Deliberately unnumbered: this is a parallel route from a source download straight to a
  // finished video, not a sixth stage of the five-stage path.
  { key: 'talkingphotos', label: 'TalkingPhotos', icon: icon(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" /><path d="M3 5h3M18 5h3" /></>) }
]

const LIBRARIES: NavDef[] = [
  { key: 'channels', label: 'Publishing Channels', icon: icon(<><path d="M4 11a9 9 0 019-9" /><path d="M4 4a16 16 0 0116 16" /><circle cx="5" cy="19" r="1.6" /></>) },
  { key: 'niches', label: 'B-roll Library', icon: icon(<><rect x="3" y="4" width="14" height="10" rx="2" /><path d="M17 8l4-2v8l-4-2" /></>) }
]

const SYSTEM: NavDef[] = [
  { key: 'profiles', label: 'Automations', icon: icon(<path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z" />) },
  { key: 'settings', label: 'Settings', icon: icon(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.8 7.8 0 000-3l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 00-2.6-1.5l-.3-2.1H8l-.3 2.1a7.6 7.6 0 00-2.6 1.5l-2-.8L1.3 9.2 3 10.5a7.8 7.8 0 000 3l-1.7 1.3 1.8 3.1 2-.8a7.6 7.6 0 002.6 1.5l.3 2.1h4l.3-2.1a7.6 7.6 0 002.6-1.5l2 .8 1.8-3.1z" /></>) }
]

function NavItem({ def, badge }: { def: NavDef; badge?: string }): JSX.Element {
  const active = useStore((s) => s.active)
  const setActive = useStore((s) => s.setActive)
  const on = active === def.key
  const shownBadge = badge ?? def.badge
  return (
    <button
      type="button"
      onClick={() => setActive(def.key)}
      title={def.label}
      aria-label={def.label}
      aria-current={on ? 'page' : undefined}
      className="me-nav"
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', borderRadius: 10,
        border: 0, textAlign: 'left', fontFamily: 'var(--font-body)',
        cursor: 'pointer', fontSize: 13, fontWeight: on ? 600 : 500,
        background: on ? 'var(--accent-soft)' : 'transparent',
        color: on ? 'var(--text-strong)' : 'var(--text-muted)', position: 'relative', marginBottom: 2,
        boxShadow: on ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 26%, transparent)' : 'none'
      }}
    >
      {def.step && <span className="me-nav-step" aria-hidden="true" style={{ width: 18, color: on ? 'var(--accent)' : 'var(--text-fainter)', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, flex: 'none' }}>{def.step}</span>}
      {def.icon}
      <span className="me-nav-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.label}</span>
      {shownBadge && (
        <span style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', padding: '1px 7px', borderRadius: 8 }}>{shownBadge}</span>
      )}
    </button>
  )
}

function Heading({ children }: { children: ReactNode }): JSX.Element {
  return <div className="me-sidebar-heading" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.7px', color: 'var(--text-label)', padding: '7px 10px' }}>{children}</div>
}

export function Sidebar(): JSX.Element {
  const renderJobs = useData((s) => s.renderJobs)
  const renderProgress = useData((s) => s.renderProgress)
  const channels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const setActive = useStore((s) => s.setActive)
  const queued = renderJobs.filter((j) => {
    const state = renderLiveState(j, renderProgress[j.job.id])
    return state.status === 'queued' || state.status === 'rendering'
  }).length
  const watching = sourceChannels.filter((s) => s.autoWatch).length

  // Find the most active rendering job for the mini status strip
  const activeJob = renderJobs.find((j) => {
    return renderLiveState(j, renderProgress[j.job.id]).status === 'rendering'
  })
  const activePct = activeJob ? Math.round(renderLiveState(activeJob, renderProgress[activeJob.job.id]).pct) : 0

  return (
    <nav aria-label="Primary" className="me-sidebar" style={{ width: 'clamp(196px, 15vw, 236px)', flex: 'none', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', padding: '14px 12px', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '6px 8px 16px' }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,var(--accent),var(--accent-deep))', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--accent-ink)', fontSize: 14, boxShadow: '0 4px 14px -4px var(--accent-glow)', flex: 'none' }}>ME</div>
        <div className="me-sidebar-brand-text" style={{ lineHeight: 1.2, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: '#f2f4f7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Mental Empire</div>
          <div style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '.3px' }}>studio v{window.api?.appVersion || '0.1.0'}</div>
        </div>
      </div>

      <Heading>TODAY</Heading>
      {TODAY.map((d) => <NavItem key={d.key} def={d} />)}

      <div style={{ paddingTop: 6 }}><Heading>PRODUCTION</Heading></div>
      {PRODUCTION.map((d) => (
        <NavItem key={d.key} def={d} badge={d.key === 'render' && queued > 0 ? String(queued) : undefined} />
      ))}

      <div style={{ paddingTop: 6 }}><Heading>LIBRARIES</Heading></div>
      {LIBRARIES.map((d) => <NavItem key={d.key} def={d} />)}

      <div style={{ paddingTop: 6 }}><Heading>SYSTEM</Heading></div>
      {SYSTEM.map((d) => <NavItem key={d.key} def={d} />)}

      <div style={{ flex: 1, minHeight: 12 }} />

      {/* Mini render-status strip — only visible when a job is actively rendering */}
      {activeJob && (
        <button
          type="button"
          onClick={() => setActive('render')}
          className="me-btn"
          style={{ width: '100%', border: '1px solid var(--border-3)', borderRadius: 10, padding: '9px 11px', background: 'var(--bg-inset)', color: 'inherit', cursor: 'pointer', marginBottom: 10, textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'mePulse 1.4s infinite', flex: 'none' }} />
            <span style={{ fontSize: 10.5, color: 'var(--text-soft)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeJob.job.title}</span>
            <span style={{ fontSize: 9.5, color: 'var(--accent)', fontFamily: 'var(--font-mono)', flex: 'none' }}>{activePct}%</span>
          </div>
          <div role="progressbar" aria-label={`Rendering ${activeJob.job.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={activePct} style={{ height: 4, borderRadius: 3, background: 'var(--border-soft)', overflow: 'hidden' }}>
            <div style={{ width: `${activePct}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))', transition: 'width .4s ease' }} />
          </div>
        </button>
      )}

      <div className="me-sidebar-status" style={{ padding: '10px 9px 2px', borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: watching > 0 ? 'var(--ok)' : 'var(--text-faint)', boxShadow: watching > 0 ? '0 0 8px var(--ok)' : 'none', animation: watching > 0 ? 'mePulse 2s infinite' : 'none' }} />
          <span style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.35 }}>
            {watching > 0
              ? `${watching} source${watching === 1 ? '' : 's'} watched · ${channels.length} channel${channels.length === 1 ? '' : 's'}`
              : 'Automation is off'}
          </span>
        </div>
      </div>
    </nav>
  )
}
