import { useEffect } from 'react'
import { ScreenPad } from '../components/primitives'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import type { RenderProgress, RenderQueueRow, RenderStage, RenderStatus } from '@shared/types'

const THUMB_BG = 'linear-gradient(135deg,#2a2540,#46243a)'
const STAGES: RenderStage[] = ['preparing', 'captioning', 'fetching-broll', 'assembling', 'encoding', 'finalizing']
const STAGE_LABEL: Partial<Record<RenderStage, string>> = {
  preparing: 'Preparing', captioning: 'Captions', 'fetching-broll': 'B-roll',
  assembling: 'Assembling', encoding: 'Encoding', finalizing: 'Finalizing',
  done: 'Done', error: 'Error', cancelled: 'Cancelled'
}

function mediaSrc(path: string | undefined): string {
  if (!path) return ''
  if (/^(https?:|data:|file:)/.test(path)) return path
  return `file:///${path.replace(/\\/g, '/')}`
}

function fmtEta(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  if (sec <= 0) return 'done'
  const h = Math.floor(sec / 3600)
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  if (h > 0) return `~${h}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`
  return m > 0 ? `~${m}m ${String(s).padStart(2, '0')}s` : `~${s}s`
}

function StageStepper({ p }: { p?: RenderProgress }): JSX.Element {
  const active = p?.stage
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
      {STAGES.map((stage) => {
        const activeIdx = active ? STAGES.indexOf(active) : -1
        const idx = STAGES.indexOf(stage)
        const on = idx <= activeIdx
        const isActive = stage === active
        return <span key={stage} title={STAGE_LABEL[stage]} style={{ height: 4, flex: 1, minWidth: 11, borderRadius: 4, background: on ? (isActive ? 'var(--accent)' : '#4fd6a0') : '#252a34', opacity: isActive ? 1 : 0.75 }} />
      })}
    </div>
  )
}

function AssetChips({ r }: { r: RenderQueueRow }): JSX.Element {
  const chips = [
    { label: 'MP3', ok: r.hasMp3 },
    { label: `${r.images} img`, ok: r.images > 0 },
    { label: 'Thumb', ok: r.hasThumb },
    { label: 'Captions', ok: r.hasCaptions }
  ]
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
      {chips.map((c) => (
        <span key={c.label} style={{ fontSize: 10, fontFamily: 'var(--font-mono)', border: `1px solid ${c.ok ? '#1e2f28' : '#3a2025'}`, color: c.ok ? '#4fd6a0' : '#ff8a96', background: c.ok ? 'rgba(54,201,142,.08)' : 'rgba(255,90,110,.08)', borderRadius: 5, padding: '2px 7px' }}>
          {c.ok ? '✓' : '✗'} {c.label}
        </span>
      ))}
    </div>
  )
}

export function RenderQueue(): JSX.Element {
  const rows = useData((s) => s.renderJobs)
  const progress = useData((s) => s.renderProgress)
  const rendering = useData((s) => s.rendering)
  const loadRenderJobs = useData((s) => s.loadRenderJobs)
  const renderAll = useData((s) => s.renderAll)
  const cancelJob = useData((s) => s.cancelJob)
  const deleteJob = useData((s) => s.deleteJob)
  const requeueJob = useData((s) => s.requeueJob)
  const openRenderFile = useData((s) => s.openRenderFile)
  const openRenderFolder = useData((s) => s.openRenderFolder)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const setActive = useStore((s) => s.setActive)

  useEffect(() => { void loadRenderJobs() }, [loadRenderJobs])

  const live = (r: RenderQueueRow): { pct: number; status: RenderStatus } => {
    const p = progress[r.job.id]
    const pct = p ? p.pct : r.job.pct
    const status: RenderStatus = p ? (p.done ? (p.error ? 'error' : 'done') : 'rendering') : r.job.status
    return { pct, status }
  }
  const processing = rows.filter((r) => live(r).status === 'rendering').length
  const readyCount = rows.filter((r) => r.isReady).length
  const canRenderAll = rows.length > 0 && rows.every((r) => r.isReady) && !rendering
  const canRenderSome = readyCount > 0 && !rows.every((r) => r.isReady) && !rendering
  const outputFolder = settings.outputFolder || '<Downloads>/MentalEmpire_out'

  const browse = async (): Promise<void> => {
    const dir = await window.api?.chooseFolder?.()
    if (dir) updateSettings({ outputFolder: dir })
  }

  return (
    <ScreenPad style={{ paddingTop: 0 }}>
      {/* Sticky header: title + output settings + render CTAs */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#0d0f14', borderBottom: '1px solid #1d2129', padding: '14px 0 12px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, letterSpacing: '-.5px', color: '#f4f6f9', lineHeight: 1 }}>Render queue</div>
            <div style={{ fontSize: 11, color: '#6a7180', marginTop: 4 }}>
              {processing > 0 && <span style={{ color: 'var(--accent)', marginRight: 10 }}>● {processing} rendering</span>}
              {rows.length} jobs · {settings.concurrency} parallel
            </div>
          </div>

          {/* Output folder */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #23272f', borderRadius: 9, padding: '7px 12px', background: '#0e1116', flex: 1, minWidth: 200, maxWidth: 360 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', flex: 'none' }}>OUT</span>
            <span title={outputFolder} style={{ flex: 1, fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{outputFolder}</span>
            <button type="button" onClick={browse} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '3px 8px', fontSize: 10, color: '#c4cad3', cursor: 'pointer', flex: 'none' }}>Browse</button>
          </div>

          {/* Format chip */}
          <div style={{ border: '1px solid #23272f', borderRadius: 9, padding: '7px 13px', fontSize: 11.5, color: '#dde0e5', background: '#0e1116', flex: 'none' }}>mp4 · {settings.quality}</div>

          <div style={{ flex: 1 }} />

          {/* Render CTAs */}
          {canRenderSome && (
            <button type="button" onClick={() => void renderAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, padding: '10px 20px', borderRadius: 10, cursor: 'pointer' }}>
              Render ready ({readyCount})
            </button>
          )}
          <button type="button" disabled={!canRenderAll} onClick={() => void renderAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '10px 22px', borderRadius: 10, cursor: canRenderAll ? 'pointer' : 'not-allowed', boxShadow: '0 5px 18px -5px var(--accent-glow)', opacity: canRenderAll ? 1 : 0.5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z" /></svg>
            {rendering ? 'Rendering…' : `Render all (${rows.length})`}
          </button>
        </div>
      </div>

      {/* Job cards */}
      {rows.length === 0 && (
        <div style={{ border: '1.5px dashed #23272f', borderRadius: 14, padding: '38px 18px', textAlign: 'center', fontSize: 12.5, color: '#6a7180' }}>
          Nothing queued yet — compose a video and hit "Save &amp; send to render".
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => {
          const p = progress[r.job.id]
          const { pct, status } = live(r)
          const isBlocked = !r.isReady && status !== 'rendering' && status !== 'done'
          const barColor = status === 'done' ? '#36c98e' : status === 'error' ? '#ff5a6e' : 'var(--accent)'
          const encoderChip = p?.encoder ? (p.device === 'gpu' ? `${p.encoder} · GPU` : p.encoder) : ''
          const eta = p?.etaState === 'estimating' ? 'estimating...' : fmtEta(p?.etaSec)

          return (
            <div key={r.job.id} className="me-card" style={{ border: `1px solid ${isBlocked ? '#3a2025' : status === 'done' ? '#1e2f28' : '#1d2129'}`, borderRadius: 14, background: isBlocked ? 'rgba(255,90,110,.04)' : '#12151b', overflow: 'hidden' }}>
              {/* Missing-asset banner */}
              {isBlocked && r.missing.length > 0 && (
                <div style={{ padding: '8px 16px', background: 'rgba(255,90,110,.1)', borderBottom: '1px solid #3a2025', display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ff8a96" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  <span style={{ color: '#ff8a96', flex: 1 }}>
                    Missing: {r.missing.map((m, i) => (
                      <span key={m}>{i > 0 && ', '}
                        {m === 'thumbnail' ? (
                          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setActive('thumb')}>{m}</span>
                        ) : (m === 'captions' || m === 'images') ? (
                          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setActive('compose')}>{m}</span>
                        ) : m}
                      </span>
                    ))}
                    {' '}— click the link to fix, then ↻ to retry
                  </span>
                  <button type="button" onClick={() => void requeueJob(r.job.id)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '4px 8px', fontSize: 10, color: '#c4cad3', cursor: 'pointer' }}>↻ Retry</button>
                </div>
              )}

              {/* Card body */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '14px 16px' }}>
                {/* Thumbnail */}
                <div style={{ width: 64, height: 36, borderRadius: 7, background: THUMB_BG, flex: 'none', overflow: 'hidden' }}>
                  {r.firstImagePath && <img src={mediaSrc(r.firstImagePath)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </div>

                {/* Main content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: '#dde0e5', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.job.title}</div>
                  <div style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{r.job.channel}</div>
                  <AssetChips r={r} />

                  {/* Progress bar + stage info */}
                  {(status === 'rendering' || status === 'done' || status === 'error') && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: barColor, transition: 'width .4s ease' }} />
                        </div>
                        <span style={{ fontSize: 10.5, color: status === 'done' ? '#4fd6a0' : status === 'error' ? '#ff8a96' : 'var(--accent)', fontFamily: 'var(--font-mono)', width: 40, textAlign: 'right', flex: 'none' }}>
                          {status === 'done' ? 'done' : status === 'error' ? 'error' : `${pct}%`}
                        </span>
                      </div>
                      {status === 'rendering' && (
                        <>
                          <StageStepper p={p} />
                          <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            {p?.stageDetail && <span style={{ fontSize: 10, color: '#8a909c' }}>{p.stageDetail}</span>}
                            {encoderChip && <span style={{ border: '1px solid #262b34', borderRadius: 999, padding: '1px 6px', fontSize: 9.5, color: p?.device === 'gpu' ? '#4fd6a0' : '#aab0bb', fontFamily: 'var(--font-mono)' }}>{encoderChip}</span>}
                            {eta && <span style={{ fontSize: 9.5, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{eta}</span>}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none', alignItems: 'flex-end' }}>
                  {status === 'rendering' && (
                    <button type="button" onClick={() => void cancelJob(r.job.id)} className="me-btn" style={{ border: '1px solid #4a3540', background: '#1b1217', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#ff8a96', cursor: 'pointer' }}>Stop</button>
                  )}
                  {status === 'done' && (
                    <>
                      <button type="button" onClick={() => void openRenderFile(r.job.id)} className="me-btn" style={{ border: '1px solid #26352f', background: '#101b16', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#4fd6a0', cursor: 'pointer' }}>Open</button>
                      <button type="button" onClick={() => void openRenderFolder(r.job.id)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', cursor: 'pointer' }}>Folder</button>
                    </>
                  )}
                  {(status === 'error') && (
                    <button type="button" onClick={() => void requeueJob(r.job.id)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', cursor: 'pointer' }}>↻ Retry</button>
                  )}
                  {(status === 'queued' || isBlocked) && (
                    <button type="button" onClick={() => void requeueJob(r.job.id)} title="Reset to queued" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#c4cad3', cursor: 'pointer' }}>↻</button>
                  )}
                  <button type="button" onClick={() => void deleteJob(r.job.id)} title="Remove" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#6a7180', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ScreenPad>
  )
}
