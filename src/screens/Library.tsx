import { useStore } from '../store/useStore'
import { useData } from '../store/useData'
import { ScreenPad } from '../components/primitives'
import { statusStyle } from '../data/mock'
import type { WorkItem } from '@shared/types'
import { mediaSrc } from '../lib/media'

const GRADIENTS = [
  'linear-gradient(135deg,#2a2540,#46243a)', 'linear-gradient(135deg,#1a2e3a,#0f3a32)',
  'linear-gradient(135deg,#23304a,#1a2438)', 'linear-gradient(135deg,#16323a,#0f2630)',
  'linear-gradient(135deg,#3a2440,#2a1530)'
]

function parseHuman(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([KM])?$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = (m[2] || '').toUpperCase()
  return unit === 'M' ? n * 1e6 : unit === 'K' ? n * 1e3 : n
}
function human(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return Math.round(n).toLocaleString()
}

const PIPELINE_STAGES: Array<{ key: keyof WorkItem; label: string }> = [
  { key: 'downloaded', label: 'Audio' },
  { key: 'hasImages', label: 'Images' },
  { key: 'captioned', label: 'Captions' },
  { key: 'hasThumbnail', label: 'Thumb' },
  { key: 'rendered', label: 'Render' },
  { key: 'uploaded', label: 'Upload' }
]

/** Per-video pipeline board (P1): shows what's done + what's next for each downloaded
 *  video, grouped by source channel, with deep-links into the right step. */
function PipelineSection(): JSX.Element | null {
  const workItems = useData((s) => s.workItems)
  const channels = useData((s) => s.channels)
  const openProject = useData((s) => s.openProject)
  const setItemUploaded = useData((s) => s.setItemUploaded)
  const setItemArchived = useData((s) => s.setItemArchived)
  const detectUploads = useData((s) => s.detectUploads)
  const setActive = useStore((s) => s.setActive)
  const openWorkspace = useStore((s) => s.openWorkspace)

  const visible = workItems.filter((w) => !w.archived)
  if (workItems.length === 0) return null

  const channelName = (id: string): string => channels.find((c) => c.id === id)?.name ?? id
  const byChannel = new Map<string, WorkItem[]>()
  for (const w of visible) {
    const arr = byChannel.get(w.channel) ?? []
    arr.push(w)
    byChannel.set(w.channel, arr)
  }

  const openNext = async (w: WorkItem): Promise<void> => {
    if (w.rendered) { setActive('render'); return }
    if (w.downloaded && w.downloadId) { await openProject(w.downloadId); setActive('compose'); return }
    setActive('download')
  }

  const done = visible.filter((w) => w.uploaded).length
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Pipeline</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>{visible.length} active · {done} uploaded</span>
        <div style={{ flex: 1 }} />
        <span onClick={() => void detectUploads()} className="me-btn" style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }} title="Match processed videos against your channels' uploaded titles">Detect uploads</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[...byChannel.entries()].map(([chan, items]) => (
          <div key={chan} style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #1d2129' }}>
              <span title={chan} className="me-ellipsis" style={{ fontSize: 12.5, fontWeight: 600, color: '#dde0e5' }}>{chan}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f' }}>{items.length}</span>
              <div style={{ flex: 1 }} />
              <span onClick={() => openWorkspace(chan)} className="me-btn" style={{ fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer' }} title="Open this channel's workspace board">Open workspace →</span>
            </div>
            {items.map((w) => (
              <div key={w.videoId} className="me-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #14171d' }}>
                <span title={w.title} className="me-ellipsis" style={{ flex: 1.6, minWidth: 0, fontSize: 12.5, color: '#dde0e5' }}>{w.title}</span>
                <div style={{ display: 'flex', gap: 5, flex: 'none' }}>
                  {PIPELINE_STAGES.map((st) => {
                    const on = !!w[st.key]
                    return (
                      <span key={st.label} title={`${st.label}: ${on ? 'done' : 'pending'}`} style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', letterSpacing: '.3px', padding: '3px 7px', borderRadius: 6, border: `1px solid ${on ? 'rgba(54,201,142,.4)' : '#23272f'}`, color: on ? '#36c98e' : '#5b616f', background: on ? 'rgba(54,201,142,.08)' : 'transparent' }}>{st.label}</span>
                    )
                  })}
                </div>
                {w.uploaded && w.uploadedTo.length > 0 && (
                  <span title={`Detected on: ${w.uploadedTo.map(channelName).join(', ')}${w.uploadMatchScore ? ` (${Math.round(w.uploadMatchScore * 100)}%)` : ''}`} style={{ fontSize: 9.5, color: '#8b7cff', fontFamily: 'var(--font-mono)', flex: 'none' }}>↑{w.uploadedTo.length}</span>
                )}
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  <button type="button" onClick={() => void openNext(w)} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '4px 10px', fontSize: 10.5, color: '#c4cad3', cursor: 'pointer' }}>{w.rendered ? 'Queue' : w.downloaded ? 'Edit' : 'Download'}</button>
                  <button type="button" onClick={() => void setItemUploaded(w.videoId, !w.uploaded)} title="Toggle uploaded" className="me-btn" style={{ border: `1px solid ${w.uploaded ? 'rgba(139,124,255,.4)' : '#262b34'}`, background: w.uploaded ? 'rgba(139,124,255,.1)' : '#15181f', borderRadius: 7, padding: '4px 9px', fontSize: 10.5, color: w.uploaded ? '#b6acff' : '#8a909c', cursor: 'pointer' }}>✓ Up</button>
                  <button type="button" onClick={() => void setItemArchived(w.videoId, true)} title="Archive (hide from pipeline)" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '4px 8px', fontSize: 10.5, color: '#6a7180', cursor: 'pointer' }}>×</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Library(): JSX.Element {
  const channels = useData((s) => s.channels)
  const recentUploads = useData((s) => s.recentUploads)
  const activity = useData((s) => s.activity)
  const downloads = useData((s) => s.downloads)
  const renderJobs = useData((s) => s.renderJobs)
  const scraping = useData((s) => s.scraping)
  const rescrapeAll = useData((s) => s.rescrapeAll)
  const setActive = useStore((s) => s.setActive)
  const greet = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()
  const hr = new Date().getHours()
  const timeOfDay = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening'

  const totalViews = channels.reduce((a, c) => a + parseHuman(c.views), 0)
  const totalSubs = channels.reduce((a, c) => a + parseHuman(c.subs), 0)
  const inQueue = renderJobs.filter((r) => r.job.status === 'queued' || r.job.status === 'rendering').length
  const lastScraped = channels[0]?.lastScrapedAt
    ? new Date(channels[0].lastScrapedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <ScreenPad>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '1px', color: 'var(--accent)', marginBottom: 7 }}>{greet}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 27, letterSpacing: '-.5px', color: '#f4f6f9', lineHeight: 1 }}>
            Good {timeOfDay}
            {channels.length > 0 && <span style={{ fontWeight: 400, color: '#6a7180', fontSize: 18, marginLeft: 10 }}>— {channels.length} channel{channels.length === 1 ? '' : 's'}</span>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {lastScraped && <span style={{ fontSize: 11, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>scraped {lastScraped}</span>}
          <div onClick={() => void rescrapeAll()} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #262b34', background: '#15181f', borderRadius: 10, padding: '9px 14px', fontSize: 12.5, color: '#c4cad3', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-3-6.7M21 4v5h-5" /></svg>
            {scraping ? 'Scraping…' : 'Re-scrape'}
          </div>
        </div>
      </div>

      {/* Zero-state banner */}
      {channels.length === 0 && (
        <div style={{ border: '1px dashed #2c303b', borderRadius: 14, padding: '28px 32px', marginBottom: 24, background: 'linear-gradient(165deg,#14171e,#0f1217)', display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17, color: '#eef0f3', marginBottom: 6 }}>Add your first channel to get started</div>
            <div style={{ fontSize: 12.5, color: '#8a909c', lineHeight: 1.5 }}>Studio scrapes views, subs, and upload stats — no API key needed. Link a source channel to track which videos you've already uploaded.</div>
          </div>
          <button type="button" onClick={() => setActive('channels')} className="me-btn" style={{ border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '11px 22px', borderRadius: 10, cursor: 'pointer', flex: 'none' }}>+ Add channel</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start' }}>
        {/* Left: channels + recent uploads */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Your channels</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#5b616f', border: '1px solid #23272f', borderRadius: 5, padding: '2px 7px' }}>scraped · no API</span>
            {channels.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: 11.5, color: '#6a7180' }}>
                <span style={{ color: '#aab0bb' }}>{human(totalViews)}<span style={{ color: '#5b616f', marginLeft: 4 }}>views</span></span>
                <span style={{ color: '#aab0bb' }}>{human(totalSubs)}<span style={{ color: '#5b616f', marginLeft: 4 }}>subs</span></span>
                {inQueue > 0 && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{inQueue} rendering</span>}
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 13, marginBottom: 26 }}>
            {channels.map((ch) => (
              <div key={ch.id} className="me-card" style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 15, background: '#12151b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: ch.avatar, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#0c0d11' }}>{ch.mono}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div title={ch.name} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 13, color: '#eef0f3' }}>{ch.name}</div>
                    <div title={ch.handle} className="me-ellipsis" style={{ fontSize: 10.5, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{ch.handle}</div>
                  </div>
                </div>
                {/* No fake sparklines — real stats only */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1d2129', paddingTop: 11 }}>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3' }}>{ch.views}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>VIEWS</div></div>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#eef0f3' }}>{ch.subs}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>SUBS</div></div>
                  <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: 'var(--accent)' }}>{ch.mapTotal > 0 ? `${ch.mapDone}/${ch.mapTotal}` : ch.total}</div><div style={{ fontSize: 9.5, color: '#5b616f', fontFamily: 'var(--font-mono)' }}>DONE</div></div>
                </div>
              </div>
            ))}
          </div>

          <PipelineSection />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, color: '#e9ebef' }}>Recent uploads</span>
            <div style={{ flex: 1 }} />
            <span onClick={() => setActive('download')} style={{ fontSize: 11.5, color: 'var(--accent)', cursor: 'pointer' }}>View all →</span>
          </div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, overflow: 'hidden', background: '#12151b' }}>
            <div style={{ display: 'flex', padding: '11px 16px', borderBottom: '1px solid #1d2129', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>
              <div style={{ flex: 2.4 }}>VIDEO</div><div style={{ width: 120 }}>CHANNEL</div><div style={{ width: 108, textAlign: 'center' }}>STATUS</div><div style={{ width: 64, textAlign: 'right' }}>VIEWS</div><div style={{ width: 62, textAlign: 'right' }}>AGE</div>
            </div>
            {recentUploads.length === 0 && (
              <div style={{ padding: '22px 16px', textAlign: 'center', fontSize: 12, color: '#5b616f' }}>No uploads yet — scrape a channel to populate.</div>
            )}
            {recentUploads.map((u, i) => {
              const s = statusStyle.Uploaded
              return (
                <div key={`${u.title}-${i}`} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid #14171d' }}>
                  <div style={{ flex: 2.4, display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <div style={{ width: 46, height: 26, borderRadius: 5, background: GRADIENTS[i % GRADIENTS.length], flex: 'none', overflow: 'hidden' }}>{mediaSrc(u.thumb) && <img src={mediaSrc(u.thumb)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}</div>
                    <span title={u.title} className="me-ellipsis" style={{ fontSize: 12.5, color: '#dde0e5', flex: 1 }}>{u.title}</span>
                  </div>
                  <div title={u.channel} className="me-ellipsis" style={{ width: 120, fontSize: 11.5, color: '#8a909c' }}>{u.channel}</div>
                  <div style={{ width: 108, textAlign: 'center' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, borderRadius: 20, padding: '3px 10px', background: s.bg, color: s.color }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />Uploaded
                    </span>
                  </div>
                  <div style={{ width: 64, textAlign: 'right', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12.5, color: u.views ? '#dde0e5' : '#6a7180' }}>{u.views || ''}</div>
                  <div style={{ width: 62, textAlign: 'right', fontSize: 11, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{u.publishedAt || ''}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right: activity rail — always visible */}
        <div style={{ width: 268, flex: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: 16, background: '#12151b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#36c98e', boxShadow: '0 0 8px #36c98e' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#e9ebef' }}>Activity</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f' }}>live</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {activity.length === 0 && (
                <div style={{ fontSize: 11, color: '#5b616f', lineHeight: 1.5 }}>No activity yet. Scrape, download, or render to see events here.</div>
              )}
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#4f5662', flex: 'none', width: 32, paddingTop: 1 }}>{a.t}</span>
                  <span style={{ color: a.color, flex: 'none' }}>{a.icon}</span>
                  <span title={a.text} className="me-clamp-2" style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.4 }}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ border: '1px solid var(--accent)', borderRadius: 14, padding: 16, background: 'linear-gradient(165deg,var(--accent-soft),#0f1217)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, color: '#f2f4f7', marginBottom: 6 }}>Auto-scrape</div>
            <div style={{ fontSize: 11.5, color: '#aab0bb', lineHeight: 1.5, marginBottom: 13 }}>
              {channels.length ? <>Re-scrape {channels.length} channel{channels.length === 1 ? '' : 's'} for new uploads + stats.</> : <>Add a channel, then re-scrape to pull stats &amp; uploads.</>}
            </div>
            <div onClick={() => void rescrapeAll()} className="me-btn" style={{ textAlign: 'center', border: '1px solid #2a2f39', background: '#15181f', borderRadius: 9, padding: 8, fontSize: 12, fontWeight: 600, color: '#dde0e5', cursor: 'pointer' }}>{scraping ? 'Scraping…' : 'Run now'}</div>
          </div>
          {downloads.length > 0 && (
            <div style={{ border: '1px solid #1d2129', borderRadius: 14, padding: '12px 16px', background: '#12151b' }}>
              <div style={{ fontSize: 10.5, color: '#6a7180', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>QUICK STATS</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>Downloaded</span><span style={{ color: '#cdd2da', fontWeight: 600 }}>{downloads.length}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#8a909c' }}>In render queue</span><span style={{ color: inQueue > 0 ? 'var(--accent)' : '#cdd2da', fontWeight: 600 }}>{inQueue}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ScreenPad>
  )
}
