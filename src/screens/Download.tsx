import { useState } from 'react'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
import { useData } from '../store/useData'
import { useStore } from '../store/useStore'
import type { ScrapeOrder } from '@shared/types'
import { youtubeIdFromDownloadId, youtubeThumbUrl, type YoutubeThumbQuality } from '@shared/youtube'

const GRADS = [
  'linear-gradient(135deg,#2a2540,#46243a)', 'linear-gradient(135deg,#1a2e3a,#0f3a32)',
  'linear-gradient(135deg,#3a2440,#2a1530)', 'linear-gradient(135deg,#23304a,#1a2438)',
  'linear-gradient(135deg,#16323a,#0f2630)', 'linear-gradient(135deg,#2e2440,#3a1f2e)',
  'linear-gradient(135deg,#1f3340,#102a3a)', 'linear-gradient(135deg,#332a40,#241a30)'
]

function fmtDur(sec: number): string {
  if (!sec) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function YouTubeThumb({ videoId, alt, fallback, selected }: { videoId: string; alt: string; fallback: string; selected?: boolean }): JSX.Element {
  const [quality, setQuality] = useState<YoutubeThumbQuality>('max')
  const [failed, setFailed] = useState(false)
  const src = videoId && !failed ? youtubeThumbUrl(videoId, quality) : ''
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: fallback, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {src && (
        <img
          src={src} alt={alt}
          onError={() => { if (quality === 'max') setQuality('hq'); else if (quality === 'hq') setQuality('mq'); else setFailed(true) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {selected != null && (
        <div className="me-vidsel" style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${selected ? 'var(--accent)' : 'rgba(255,255,255,.5)'}`, background: selected ? 'var(--accent)' : 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', color: 'var(--accent-ink)' }}>{selected ? '✓' : ''}</div>
      )}
    </div>
  )
}

export function Download(): JSX.Element {
  const sourceVideos = useData((s) => s.sourceVideos)
  const downloads = useData((s) => s.downloads)
  const dlProgress = useData((s) => s.dlProgress)
  const fetching = useData((s) => s.fetching)
  const sourceError = useData((s) => s.sourceError)
  const fetchSource = useData((s) => s.fetchSource)
  const startDownload = useData((s) => s.startDownload)
  const resumeDownload = useData((s) => s.resumeDownload)
  const cancelDownload = useData((s) => s.cancelDownload)
  const deleteDownload = useData((s) => s.deleteDownload)
  const openProject = useData((s) => s.openProject)
  const setActive = useStore((s) => s.setActive)

  const [url, setUrl] = useState('')
  const [order, setOrder] = useState<ScrapeOrder>('Popular')
  const [qty, setQty] = useState(10)
  const [bitrate] = useState(192)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)

  const toggle = (id: string): void =>
    setSel((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  const canFetch = url.trim().length > 0 && !fetching
  const fetchVids = (): void => { if (!canFetch) return; setMessage(''); void fetchSource(url, order, qty) }
  const selected = sourceVideos.filter((v) => sel.has(v.id))
  const estMb = (selected.reduce((a, v) => a + v.durationSec, 0) * bitrate) / 8 / 1000

  const download = async (toCompose: boolean): Promise<void> => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setMessage(toCompose ? 'Downloading selected audio…' : 'Starting download…')
    try {
      const rows = await startDownload(selected, url, bitrate)
      const succeeded = rows.filter((d) => d.filePath && (d.durationSec ?? 0) > 0)
      const failed = rows.filter((d) => d.stage === 'Failed')
      if (toCompose) {
        if (succeeded.length === 0) { setMessage('No downloads completed. Check rows below and try resuming.'); return }
        if (failed.length > 0) { setMessage(`${succeeded.length} downloaded, ${failed.length} failed.`); return }
        await openProject(succeeded[0].id)
        setActive('compose')
      } else {
        setMessage(failed.length > 0 ? 'Some downloads failed. Check Activity for details.' : 'Download finished.')
      }
      setSel(new Set())
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const videosLoaded = sourceVideos.length > 0

  return (
    <ScreenPad style={{ position: 'relative' }}>
      <div style={{ marginBottom: 18 }}><Eyebrow>SOURCE</Eyebrow><Title>Download audio from a channel</Title></div>

      {/* Row 1: URL + Fetch */}
      <div style={{ display: 'flex', gap: 11, marginBottom: 10 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: '#12151b', border: '1px solid #23272f', borderRadius: 11, padding: '12px 15px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5b616f" strokeWidth="2"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fetchVids()} placeholder="youtube.com/@PowerWithinOfficial" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: '#dde0e5', fontFamily: 'var(--font-mono)' }} />
        </div>
        <button type="button" disabled={!canFetch} onClick={fetchVids} className="me-btn" style={{ border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '0 20px', borderRadius: 11, cursor: canFetch ? 'pointer' : 'not-allowed', boxShadow: '0 4px 16px -4px var(--accent-glow)', opacity: canFetch ? 1 : 0.5 }}>{fetching ? 'Fetching…' : 'Fetch ▶'}</button>
      </div>
      {sourceError && <div title={sourceError} className="me-clamp-2" style={{ marginBottom: 12, border: '1px solid #4a2530', background: 'rgba(255,90,110,.08)', color: '#ff8a96', borderRadius: 10, padding: '9px 12px', fontSize: 12, lineHeight: 1.4 }}>{sourceError}</div>}

      {/* Row 2: Filter bar — only after videos load */}
      {videosLoaded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, padding: '10px 14px', background: '#12151b', border: '1px solid #1d2129', borderRadius: 11 }}>
          <div style={{ fontSize: 11.5, color: '#8a909c' }}><b style={{ color: '#cdd2da' }}>{sourceVideos.length}</b> videos</div>
          <div style={{ display: 'flex', background: '#0e1116', border: '1px solid #23272f', borderRadius: 9, overflow: 'hidden', fontSize: 12 }}>
            {(['Popular', 'Latest', 'Oldest'] as ScrapeOrder[]).map((o) => (
              <button type="button" key={o} onClick={() => setOrder(o)} style={{ border: 0, padding: '7px 13px', cursor: 'pointer', background: order === o ? 'var(--accent)' : 'transparent', color: order === o ? 'var(--accent-ink)' : '#8a909c', fontWeight: order === o ? 600 : undefined }}>{o}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid #23272f', borderRadius: 9, padding: '6px 12px', background: '#0e1116' }}>
            <span style={{ fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>QTY</span>
            <input value={qty} onChange={(e) => setQty(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))} title="1–50 videos" style={{ width: 28, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-display)', fontWeight: 600, color: '#eef0f3', fontSize: 14 }} />
          </div>
          <div style={{ fontSize: 11.5, color: '#8a909c' }}>mp3 · {bitrate}k</div>
          {sel.size > 0 && <div style={{ marginLeft: 'auto', fontSize: 11.5, color: '#cdd2da' }}><b style={{ color: 'var(--accent)' }}>{sel.size}</b> selected · ~{estMb.toFixed(0)} MB</div>}
        </div>
      )}

      {/* 3-column video grid — larger thumbnails */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: sel.size > 0 ? 80 : 20 }}>
        {sourceVideos.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '34px 0', textAlign: 'center', fontSize: 12.5, color: '#5b616f', border: '1.5px dashed #23272f', borderRadius: 12 }}>Fetch a channel to list its videos.</div>
        )}
        {sourceVideos.map((v, i) => {
          const on = sel.has(v.id)
          return (
            <div key={v.id} onClick={() => toggle(v.id)} className="me-vid me-card" style={{ border: `1.5px solid ${on ? 'var(--accent)' : '#1d2129'}`, borderRadius: 12, overflow: 'hidden', background: on ? 'var(--accent-soft)' : '#12151b', cursor: 'pointer', position: 'relative' }}>
              <div style={{ position: 'relative', height: 130, overflow: 'hidden' }}>
                <YouTubeThumb videoId={v.id} alt={v.title} fallback={GRADS[i % GRADS.length]} selected={on} />
                <div style={{ position: 'absolute', bottom: 7, right: 7, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(0,0,0,.7)', color: '#dde0e5', padding: '2px 6px', borderRadius: 5 }}>{fmtDur(v.durationSec)}</div>
              </div>
              <div style={{ padding: '11px 12px' }}>
                <div title={v.title} style={{ fontSize: 12.5, color: on ? '#f2f4f7' : '#dde0e5', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</div>
                <div style={{ fontSize: 10.5, color: '#5b616f', fontFamily: 'var(--font-mono)', marginTop: 5 }}>{v.views > 0 ? `${v.views.toLocaleString()} views` : ''}</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sticky selection footer */}
      {sel.size > 0 && (
        <div style={{ position: 'sticky', bottom: 0, marginLeft: 'calc(var(--pad) * -1)', marginRight: 'calc(var(--pad) * -1)', background: '#0d0f14', borderTop: '1px solid #1d2129', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, zIndex: 10 }}>
          <div style={{ fontSize: 13, color: '#8a909c' }}><b style={{ color: '#eef0f3', fontFamily: 'var(--font-display)' }}>{sel.size}</b> selected · ~{estMb.toFixed(0)} MB</div>
          <div style={{ flex: 1 }} />
          {message && <div style={{ fontSize: 11.5, color: message.includes('failed') ? '#ff8a96' : '#8a909c', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message}</div>}
          <button type="button" disabled={!sel.size || busy} onClick={() => void download(false)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '10px 18px', fontSize: 12.5, color: '#c4cad3', cursor: sel.size && !busy ? 'pointer' : 'not-allowed', opacity: sel.size && !busy ? 1 : 0.45 }}>Download mp3</button>
          <button type="button" disabled={!sel.size || busy} onClick={() => void download(true)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 12.5, padding: '10px 20px', borderRadius: 10, cursor: sel.size && !busy ? 'pointer' : 'not-allowed', boxShadow: '0 4px 16px -4px var(--accent-glow)', opacity: sel.size && !busy ? 1 : 0.45 }}>
            {busy ? 'Working…' : '→ Compose'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      )}

      {/* Collapsible "Already downloaded" */}
      <div style={{ marginTop: sel.size > 0 ? 0 : 10 }}>
        <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid #1d2129', background: '#12151b', borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: '#e9ebef' }}>Already downloaded</span>
          <span style={{ fontSize: 11, color: '#6a7180' }}>— resume unfinished, don't re-fetch</span>
          {downloads.length > 0 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>{downloads.length}</span>}
          <span style={{ fontSize: 10, color: '#5b616f', transform: historyOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
        </button>

        {historyOpen && (
          <div style={{ border: '1px solid #1d2129', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden', background: '#12151b' }}>
            <div style={{ display: 'flex', padding: '11px 16px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
              <div style={{ flex: 2.4 }}>CLIP</div><div style={{ width: 120 }}>SOURCE</div><div style={{ width: 130 }}>STAGE</div><div style={{ width: 140 }}>PROGRESS</div><div style={{ width: 130, textAlign: 'right' }}>ACTION</div>
            </div>
            {downloads.length === 0 && (
              <div style={{ padding: '22px 16px', textAlign: 'center', fontSize: 12, color: '#5b616f' }}>Nothing downloaded yet.</div>
            )}
            {downloads.map((d) => {
              const live = dlProgress[d.id]
              const pct = live ? `${Math.round(live.pct)}%` : d.pct
              const currentStage = live?.stage ?? d.stage
              const done = currentStage === 'Downloaded only'
              const barColor = done ? '#36c98e' : currentStage === 'Failed' ? '#ff5a6e' : 'var(--accent)'
              const stageColor = done ? '#4fd6a0' : currentStage === 'Failed' ? '#ff8a96' : '#cdd2da'
              return (
                <div key={d.id} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #14171d' }}>
                  <div style={{ flex: 2.4, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 48, height: 27, borderRadius: 6, background: GRADS[0], flex: 'none', overflow: 'hidden' }}>
                      <YouTubeThumb videoId={youtubeIdFromDownloadId(d.id)} alt={d.title} fallback={GRADS[0]} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div title={d.title} className="me-ellipsis" style={{ fontSize: 12.5, color: '#dde0e5' }}>{d.title}</div>
                      <div style={{ fontSize: 10, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>{d.size} · {d.when}</div>
                    </div>
                  </div>
                  <div title={d.channel} style={{ width: 120, fontSize: 11, color: '#8a909c', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.channel}</div>
                  <div title={d.error || currentStage} style={{ width: 130, fontSize: 11.5, color: stageColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentStage === 'Failed' && d.error ? `Failed: ${d.error}` : currentStage}</div>
                  <div style={{ width: 140 }}><div style={{ height: 5, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}><div style={{ width: pct, height: '100%', background: barColor }} /></div></div>
                  <div style={{ width: 130, display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                    {done && (
                      <span onClick={() => { void openProject(d.id); setActive('compose') }} className="me-btn" style={{ display: 'inline-block', border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>→ Compose</span>
                    )}
                    {currentStage === 'Downloading' && <span onClick={() => void cancelDownload(d.id)} className="me-btn" style={{ display: 'inline-block', border: '1px solid #4a3540', background: '#1b1217', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#ff8a96', cursor: 'pointer' }}>Cancel</span>}
                    {currentStage !== 'Downloading' && currentStage !== 'Downloaded only' && <span onClick={() => void resumeDownload(d.id)} className="me-btn" style={{ display: 'inline-block', border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#dde0e5', cursor: 'pointer' }}>Resume</span>}
                    <span onClick={() => void deleteDownload(d.id)} title="Remove" className="me-btn" style={{ display: 'inline-block', border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 9px', fontSize: 10.5, color: '#6a7180', cursor: 'pointer' }}>×</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ScreenPad>
  )
}
