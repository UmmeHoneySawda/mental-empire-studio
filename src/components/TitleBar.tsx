import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import type { ScreenKey } from '@shared/types'

const LABELS: Record<ScreenKey, string> = {
  home: 'Today',
  library: 'Today',
  workspace: 'Today',
  channels: 'Publishing Channels',
  sources: 'Sources',
  download: 'Download',
  compose: 'Video Studio',
  talkingphotos: 'TalkingPhotos',
  thumb: 'Thumbnails',
  render: 'Render Queue',
  publish: 'Ready to Upload',
  niches: 'B-roll Library',
  profiles: 'Automations',
  settings: 'Settings'
}

function winCtl(action: 'minimize' | 'maximize' | 'close') {
  return () => window.api?.[action]?.()
}

export function TitleBar(): JSX.Element {
  const active = useStore((s) => s.active)
  const setActive = useStore((s) => s.setActive)
  const rows = useData((s) => s.renderJobs)
  const rendering = useData((s) => s.rendering)
  const renderAll = useData((s) => s.renderAll)
  const queuedRows = rows.filter((r) => r.job.status === 'queued')
  const canRender = queuedRows.length > 0 && queuedRows.every((r) => r.isReady) && !rendering
  const handleRenderAll = (): void => {
    setActive('render')
    if (canRender) void renderAll()
  }
  const queueLabel = rendering
    ? 'Rendering…'
    : canRender
      ? `Render ${queuedRows.length} ready`
      : queuedRows.length > 0
        ? `${queuedRows.length} need attention`
        : 'Open render queue'

  return (
    <header
      className="drag-region"
      style={{
        height: 48, flex: 'none', background: 'linear-gradient(180deg,#14161d,#101218)',
        display: 'flex', alignItems: 'center', padding: '0 18px', gap: 14,
        borderBottom: '1px solid var(--border)', position: 'relative', zIndex: 5
      }}
    >
      <div className="no-drag" style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={winCtl('close')} aria-label="Close window" title="Close window" style={{ width: 28, height: 28, border: 0, padding: 0, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} /></button>
        <button type="button" onClick={winCtl('minimize')} aria-label="Minimize window" title="Minimize window" style={{ width: 28, height: 28, border: 0, padding: 0, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} /></button>
        <button type="button" onClick={winCtl('maximize')} aria-label="Maximize window" title="Maximize window" style={{ width: 28, height: 28, border: 0, padding: 0, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} /></button>
      </div>
      <div style={{ width: 1, height: 20, background: 'var(--border-2)' }} />
      <div style={{ fontSize: 12, color: 'var(--text-dim)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Mental Empire <span aria-hidden="true" style={{ color: 'var(--text-label)', padding: '0 6px' }}>/</span> <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{LABELS[active]}</span>
      </div>
      <div style={{ flex: 1 }} />
      <button type="button" onClick={handleRenderAll} disabled={rendering} className="me-btn no-drag me-title-render" title={queueLabel} style={{ display: 'flex', alignItems: 'center', gap: 8, border: canRender ? 0 : '1px solid var(--border-3)', background: canRender ? 'var(--accent)' : 'var(--bg-control)', color: canRender ? 'var(--accent-ink)' : 'var(--text-muted)', fontWeight: 600, fontSize: 12, padding: '8px 13px', borderRadius: 9, cursor: rendering ? 'not-allowed' : 'pointer', boxShadow: canRender ? 'var(--shadow-glow)' : 'none', whiteSpace: 'nowrap', opacity: rendering ? 0.6 : 1 }}>
        {canRender ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4l14 8-14 8z" /></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9" /></svg>}
        <span aria-live="polite">{queueLabel}</span>
      </button>
    </header>
  )
}
