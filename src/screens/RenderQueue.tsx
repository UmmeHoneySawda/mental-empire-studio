import { useEffect } from 'react'
import { ScreenPad } from '../components/primitives'
import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import type { RenderProgress, RenderQueueRow, RenderStage, RenderStatus } from '@shared/types'

const STATUS_TEXT: Record<RenderStatus, { text: string; color: string }> = {
  queued: { text: 'queued', color: '#8a909c' },
  rendering: { text: 'rendering', color: '#f5b323' },
  done: { text: 'done', color: '#4fd6a0' },
  error: { text: 'failed', color: '#ff8a96' }
}

const THUMB_BG = 'linear-gradient(135deg,#2a2540,#46243a)'
const STAGES: RenderStage[] = ['preparing', 'captioning', 'fetching-broll', 'assembling', 'encoding', 'finalizing']
const STAGE_LABEL: Partial<Record<RenderStage, string>> = {
  preparing: 'Preparing',
  captioning: 'Captions',
  'fetching-broll': 'B-roll',
  assembling: 'Assembling',
  encoding: 'Encoding',
  finalizing: 'Finalizing',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled'
}

function mediaSrc(path: string | undefined): string {
  if (!path) return ''
  if (/^(https?:|data:|file:)/.test(path)) return path
  return `file:///${path.replace(/\\/g, '/')}`
}

function check(on: boolean, count?: number): JSX.Element {
  if (count !== undefined) return <span style={{ fontSize: 12, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{count}</span>
  return <span style={{ color: on ? '#36c98e' : '#ff5a6e' }}>{on ? '✓' : '!'}</span>
}

function fmtEta(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  if (sec <= 0) return 'done'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `~${m}m ${String(s).padStart(2, '0')}s left` : `~${s}s left`
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

export function RenderQueue(): JSX.Element {
  const rows = useData((s) => s.renderJobs)
  const progress = useData((s) => s.renderProgress)
  const rendering = useData((s) => s.rendering)
  const loadRenderJobs = useData((s) => s.loadRenderJobs)
  const renderAll = useData((s) => s.renderAll)
  const deleteJob = useData((s) => s.deleteJob)
  const requeueJob = useData((s) => s.requeueJob)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const setActive = useStore((s) => s.setActive)

  useEffect(() => {
    void loadRenderJobs()
  }, [loadRenderJobs])

  const live = (r: RenderQueueRow): { pct: number; status: RenderStatus } => {
    const p = progress[r.job.id]
    const pct = p ? p.pct : r.job.pct
    const status: RenderStatus = p ? (p.done ? (p.error ? 'error' : 'done') : 'rendering') : r.job.status
    return { pct, status }
  }
  const processing = rows.filter((r) => live(r).status === 'rendering').length
  const outputFolder = settings.outputFolder || '<Downloads>/MentalEmpire_out'
  const readyCount = rows.filter((r) => r.isReady).length
  const canRenderAll = rows.length > 0 && rows.every((r) => r.isReady) && !rendering
  const canRenderSome = readyCount > 0 && !rows.every((r) => r.isReady) && !rendering

  const browse = async (): Promise<void> => {
    const dir = await window.api?.chooseFolder?.()
    if (dir) updateSettings({ outputFolder: dir })
  }

  return (
    <ScreenPad>
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 22 }}>
        <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>STEP 05 — RENDER</div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 25, letterSpacing: '-.5px', color: '#f4f6f9' }}>Render queue</div></div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#8a909c' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', animation: 'mePulse 1.6s infinite' }} />{processing} of {rows.length} processing · {settings.concurrency} parallel</div>
      </div>

      <div style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b', marginBottom: 20 }}>
        <div style={{ display: 'flex', padding: '12px 18px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
          <div style={{ flex: 2.2 }}>VIDEO</div><div style={{ width: 60, textAlign: 'center' }}>MP3</div><div style={{ width: 64, textAlign: 'center' }}>IMAGES</div><div style={{ width: 60, textAlign: 'center' }}>THUMB</div><div style={{ width: 72, textAlign: 'center' }}>CAPTIONS</div><div style={{ flex: 1 }}>STATUS</div><div style={{ width: 60, textAlign: 'right' }}>ACTIONS</div>
        </div>
        {rows.length === 0 && (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 12.5, color: '#6a7180' }}>Nothing queued yet — compose a video and hit "Save &amp; send to render".</div>
        )}
        {rows.map((r) => {
          const p = progress[r.job.id]
          const { pct, status } = live(r)
          const isBlocked = !r.isReady && status !== 'rendering' && status !== 'done'
          const st = STATUS_TEXT[status]
          const barColor = status === 'done' ? '#36c98e' : status === 'error' ? '#ff5a6e' : 'var(--accent)'
          const statusLabel = isBlocked ? 'blocked' : status === 'rendering' ? `${pct}%` : st.text
          const statusColor = isBlocked ? '#ff8a96' : st.color
          const detail = p?.stageDetail || (p?.stage ? STAGE_LABEL[p.stage] : '')
          const eta = fmtEta(p?.etaSec)
          const speed = p?.speed ? `${p.speed.toFixed(1)}x` : ''
          return (
            <div key={r.job.id} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid #14171d' }}>
              <div style={{ flex: 2.2, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <div style={{ width: 50, height: 28, borderRadius: 6, background: THUMB_BG, flex: 'none', overflow: 'hidden' }}>{r.firstImagePath && <img src={mediaSrc(r.firstImagePath)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#dde0e5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.job.title}</div>
                  {isBlocked && r.missing.length > 0 && (
                    <div style={{ fontSize: 10, color: '#ff8a96', marginTop: 2 }}>
                      Missing: {r.missing.map((m, i) => (
                        <span key={m}>
                          {i > 0 && ', '}
                          {(m === 'thumbnail') ? (
                            <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setActive('thumb')}>{m}</span>
                          ) : (m === 'captions' || m === 'images') ? (
                            <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setActive('compose')}>{m}</span>
                          ) : m}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isBlocked && <div style={{ fontSize: 10.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>{r.job.channel}</div>}
                </div>
              </div>
              <div style={{ width: 60, textAlign: 'center' }}>{check(r.hasMp3)}</div>
              <div style={{ width: 64, textAlign: 'center' }}>{check(true, r.images)}</div>
              <div style={{ width: 60, textAlign: 'center' }}>{check(r.hasThumb)}</div>
              <div style={{ width: 72, textAlign: 'center' }}>{check(r.hasCaptions)}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
                    <div style={{ width: `${isBlocked ? 0 : pct}%`, height: '100%', background: barColor }} />
                  </div>
                  <div style={{ fontSize: 10.5, color: statusColor, fontFamily: 'var(--font-mono)', width: 52, textAlign: 'right', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{statusLabel}</div>
                </div>
                {status === 'rendering' && (
                  <>
                    <StageStepper p={p} />
                    <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 10, color: '#8a909c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
                      {p?.encoder && <span style={{ flex: 'none', border: '1px solid #262b34', borderRadius: 999, padding: '1px 6px', fontSize: 9.5, color: p.device === 'gpu' ? '#4fd6a0' : '#aab0bb', fontFamily: 'var(--font-mono)' }}>{p.encoder}</span>}
                      {(eta || speed) && <span style={{ flex: 'none', fontSize: 9.5, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{[eta, speed].filter(Boolean).join(' · ')}</span>}
                    </div>
                  </>
                )}
              </div>
              <div style={{ width: 60, display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                {(status === 'error' || isBlocked) && (
                  <button type="button" onClick={() => void requeueJob(r.job.id)} title="Reset to queued and retry" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 6, padding: '4px 7px', fontSize: 10, color: '#c4cad3', cursor: 'pointer' }}>↻</button>
                )}
                <button type="button" onClick={() => void deleteJob(r.job.id)} title="Remove from queue" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 6, padding: '4px 7px', fontSize: 10, color: '#6a7180', cursor: 'pointer' }}>×</button>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, borderTop: '1px solid #1d2129', paddingTop: 20 }}>
        <div style={{ flex: 1, maxWidth: 430 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 7 }}>OUTPUT FOLDER</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, border: '1px solid #23272f', borderRadius: 9, padding: '10px 13px', fontSize: 12, color: '#aab0bb', fontFamily: 'var(--font-mono)', background: '#0e1116', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{outputFolder}</div>
            <button type="button" onClick={browse} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#c4cad3', cursor: 'pointer' }}>Browse</button>
          </div>
        </div>
        <div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f', marginBottom: 7 }}>FORMAT</div><div style={{ border: '1px solid #23272f', borderRadius: 9, padding: '10px 14px', fontSize: 12, color: '#dde0e5', background: '#0e1116' }}>mp4 · {settings.quality} ▾</div></div>
        <div style={{ flex: 1 }} />
        {canRenderSome && (
          <button type="button" onClick={() => void renderAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 9, border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600, fontSize: 13.5, padding: '13px 26px', borderRadius: 11, cursor: 'pointer' }}>
            Render ready ({readyCount})
          </button>
        )}
        <button type="button" disabled={!canRenderAll} onClick={() => void renderAll()} className="me-btn" title={!rows.length ? 'No render jobs queued' : !rows.every((r) => r.isReady) ? `${rows.length - readyCount} item${rows.length - readyCount !== 1 ? 's' : ''} still missing assets — click ↻ to retry after fixing` : undefined} style={{ display: 'flex', alignItems: 'center', gap: 9, border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13.5, padding: '13px 26px', borderRadius: 11, cursor: canRenderAll ? 'pointer' : 'not-allowed', boxShadow: '0 6px 20px -5px var(--accent-glow)', opacity: canRenderAll ? 1 : 0.5 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M5 4l14 8-14 8z" /></svg>{rendering ? 'Rendering…' : `Render all (${rows.length})`}</button>
      </div>
      {rows.some((r) => !r.isReady) && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: '#ff8a96', textAlign: 'right' }}>
          Blocked rows are missing assets — click the underlined items to fix them, then ↻ to retry.
        </div>
      )}
    </ScreenPad>
  )
}
