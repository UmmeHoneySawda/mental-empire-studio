import { useMemo, useState, type CSSProperties } from 'react'
import { ScreenPad } from '../components/primitives'
import { ConfirmDialog, EmptyState, PageHeader, Switch } from '../components/ui/kit'
import { useData, type PendingSource } from '../store/useData'
import { useStore } from '../store/useStore'
import { DEFAULT_BETA_OPTS } from '@shared/types'
import type { ScrapedVideo, ScrapeOrder, SourceAutomationPatch, SourceChannel } from '@shared/types'
import { youtubeIdFromDownloadId, youtubeThumbUrl, type YoutubeThumbQuality } from '@shared/youtube'
import { sourceVideoBadge, type SourceVideoBadge } from '../lib/workitems'
import { fmtAgo } from '../lib/time'
import { errorMessage } from '../lib/errors'

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

function fmtViews(views: number): string {
  return views > 0 ? `${views.toLocaleString()} views` : '— views'
}

function YouTubeThumb({ videoId, alt, fallback, selected }: { videoId: string; alt: string; fallback: string; selected?: boolean }): JSX.Element {
  // Start at `hq`: it exists for every video, whereas `maxresdefault` only exists for uploads
  // at >=1080p, so starting there cost a guaranteed 404 round-trip per card before any pixels.
  const [quality, setQuality] = useState<YoutubeThumbQuality>('hq')
  const [failed, setFailed] = useState(false)
  const src = videoId && !failed ? youtubeThumbUrl(videoId, quality) : ''
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: fallback, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      {src && (
        <img
          src={src} alt={alt} loading="lazy" decoding="async"
          onError={() => { if (quality === 'hq') setQuality('mq'); else setFailed(true) }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      )}
      {selected != null && (
        <div className="me-vidsel" style={{ position: 'absolute', top: 8, left: 8, width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${selected ? 'var(--accent)' : 'rgba(255,255,255,.5)'}`, background: selected ? 'var(--accent)' : 'rgba(0,0,0,.45)', display: 'grid', placeItems: 'center', color: 'var(--accent-ink)' }}>{selected ? '✓' : ''}</div>
      )}
    </div>
  )
}

function orderCachedVideos(videos: ScrapedVideo[], order: ScrapeOrder, count: number): ScrapedVideo[] {
  const ordered = [...videos]
  if (order === 'Popular') ordered.sort((a, b) => b.views - a.views)
  else if (order === 'Oldest') ordered.sort((a, b) => (a.uploadDate || '99999999').localeCompare(b.uploadDate || '99999999'))
  else ordered.sort((a, b) => (b.uploadDate || '').localeCompare(a.uploadDate || ''))
  return ordered.slice(0, Math.max(1, count))
}

function SourceAvatar({ source }: { source: SourceChannel }): JSX.Element {
  const [failed, setFailed] = useState(false)
  const fallback = 'linear-gradient(135deg,#23304a,#15171d)'
  return (
    <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', background: fallback, display: 'grid', placeItems: 'center', color: '#f2f4f7', fontFamily: 'var(--font-display)', fontWeight: 700, flex: 'none' }}>
      {source.avatar && !failed ? <img src={source.avatar} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (source.name || source.handle || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

function PendingSourceCard({ pending, onRetry, onDismiss }: { pending: PendingSource; onRetry: () => void; onDismiss: () => void }): JSX.Element {
  const failed = pending.status === 'error'
  const initials = (pending.handle.replace(/^@/, '') || '?').slice(0, 2).toUpperCase()
  return (
    <div className="me-card" style={{ border: `1px solid ${failed ? '#4a2530' : 'var(--border-2)'}`, borderRadius: 12, background: 'var(--bg-card)', padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#23304a,#15171d)', display: 'grid', placeItems: 'center', color: '#f2f4f7', fontFamily: 'var(--font-display)', fontWeight: 700, flex: 'none' }}>{initials}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div title={pending.handle} style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pending.handle}</div>
          <div title={pending.url} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pending.url}</div>
        </div>
      </div>
      <div style={{ border: `1px solid ${failed ? '#4a2530' : 'var(--border-2)'}`, borderRadius: 10, padding: '9px 10px', background: failed ? 'rgba(255,90,110,.08)' : 'var(--bg-inset)' }}>
        {failed ? (
          <div className="me-clamp-2" title={pending.error} style={{ color: '#ff8a96', fontSize: 11.5, lineHeight: 1.4 }}>Couldn’t add this source. {pending.error}</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-control)', fontSize: 11.5 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ animation: 'meSpin 1s linear infinite', flex: 'none' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
            Adding source — fetching from YouTube…
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
        {failed ? (
          <>
            <button type="button" onClick={onRetry} className="me-btn" style={{ flex: 1, border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
            <button type="button" onClick={onDismiss} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 9, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
          </>
        ) : (
          <button type="button" disabled title="Available once the source finishes adding" className="me-btn" style={{ flex: 1, border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-faint)', borderRadius: 9, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'not-allowed' }}>Open</button>
        )}
      </div>
    </div>
  )
}

function automationSummary(source: SourceChannel, groqReady: boolean): string {
  const caption = `${source.captionPreset || 'Hormozi'} captions at ${source.captionAspect || '16:9'}`
  const order = (source.sourceOrder || 'Latest').toLowerCase()
  const queue = source.autoQueueRender ? 'renders automatically' : 'stops in Video Studio for review'
  return `Checks ${source.sourceCount || 5} ${order} videos · ${caption} · ${groqReady ? 'automatic transcription' : 'manual transcription'} · ${queue}`
}

function sourceAutomationDefaults(source: SourceChannel, autoWatch: boolean): SourceAutomationPatch {
  if (!autoWatch) return { autoWatch: false }
  return {
    autoWatch,
    autoQueueRender: source.autoQueueRender ?? false,
    sourceOrder: source.sourceOrder ?? 'Latest',
    sourceCount: source.sourceCount ?? 5,
    imageMode: source.imageMode ?? 'pool',
    poolSize: source.poolSize ?? 10,
    kenBurns: source.kenBurns ?? true,
    captionPreset: source.captionPreset ?? 'Hormozi',
    captionFont: source.captionFont ?? 'Montserrat',
    captionAnim: source.captionAnim ?? 'Pop-in',
    captionAspect: source.captionAspect ?? '16:9',
    captionLines: source.captionLines ?? 1,
    captionPosition: source.captionPosition ?? 'bottom',
    captionPace: source.captionPace ?? 'auto',
    captionHighlightColor: source.captionHighlightColor ?? '#ffd93d',
    captionBoxColor: source.captionBoxColor ?? '#ffd93d',
    captionWordsPerPage: source.captionWordsPerPage ?? 1,
    outputFolder: source.outputFolder,
    thumbnailTemplateId: source.thumbnailTemplateId,
    betaOpts: source.betaOpts ?? { ...DEFAULT_BETA_OPTS }
  }
}

type SourceFilter = 'new' | 'not-downloaded' | 'not-uploaded' | 'all'

const FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'new', label: 'New' },
  { id: 'not-downloaded', label: 'Not downloaded' },
  { id: 'not-uploaded', label: 'Not uploaded' },
  { id: 'all', label: 'All' }
]

function badgeStyle(b: SourceVideoBadge): CSSProperties {
  const colors = {
    neutral: ['rgba(255,255,255,.72)', 'rgba(0,0,0,.58)', 'rgba(255,255,255,.18)'],
    blue: ['#a7c7ff', 'rgba(65,118,210,.16)', 'rgba(92,143,240,.35)'],
    amber: ['#f5b323', 'rgba(245,179,35,.14)', 'rgba(245,179,35,.38)'],
    green: ['#4fd6a0', 'rgba(54,201,142,.14)', 'rgba(54,201,142,.38)'],
    purple: ['#b9a7ff', 'rgba(139,124,255,.16)', 'rgba(139,124,255,.38)']
  }[b.tone]
  return {
    maxWidth: '72%',
    border: `1px solid ${colors[2]}`,
    color: colors[0],
    background: colors[1],
    borderRadius: 999,
    padding: '2px 7px',
    fontSize: 9.5,
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  }
}

export function Download(): JSX.Element {
  const sourceVideos = useData((s) => s.sourceVideos)
  const downloads = useData((s) => s.downloads)
  const workItems = useData((s) => s.workItems)
  const channels = useData((s) => s.channels)
  const sourceChannels = useData((s) => s.sourceChannels)
  const pendingSources = useData((s) => s.pendingSources)
  const retryPendingSource = useData((s) => s.retryPendingSource)
  const dismissPendingSource = useData((s) => s.dismissPendingSource)
  const dlProgress = useData((s) => s.dlProgress)
  const fetching = useData((s) => s.fetching)
  const scrapeStatus = useData((s) => s.scrapeStatus)
  const sourceError = useData((s) => s.sourceError)
  const addSource = useData((s) => s.addSource)
  const refreshSource = useData((s) => s.refreshSource)
  const removeSource = useData((s) => s.removeSource)
  const openSource = useData((s) => s.openSource)
  const startDownload = useData((s) => s.startDownload)
  const resumeDownload = useData((s) => s.resumeDownload)
  const cancelDownload = useData((s) => s.cancelDownload)
  const deleteDownload = useData((s) => s.deleteDownload)
  const setItemUploaded = useData((s) => s.setItemUploaded)
  const openProject = useData((s) => s.openProject)
  const setSourceAutomation = useData((s) => s.setSourceAutomation)
  const setActive = useStore((s) => s.setActive)
  const allowReupload = useStore((s) => s.settings.dedup.allowReupload)
  const workflowP1 = useStore((s) => s.settings.features.workflowP1)
  const groqReady = useStore((s) => !!s.settings.transcription.apiKey.trim())

  const [url, setUrl] = useState('')
  const [order, setOrder] = useState<ScrapeOrder>('Popular')
  const [qty, setQty] = useState(10)
  const [bitrate] = useState(192)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [filter, setFilter] = useState<SourceFilter>('new')
  const [overrideReupload, setOverrideReupload] = useState<Set<string>>(new Set())
  const [activeSourceId, setActiveSourceId] = useState('')
  const [videoToOverride, setVideoToOverride] = useState<ScrapedVideo | null>(null)
  const [sourceToRemove, setSourceToRemove] = useState<SourceChannel | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const activeSource = sourceChannels.find((s) => s.id === activeSourceId)
  const byVideo = new Map(workItems.map((w) => [w.videoId, w]))
  const badgeFor = (video: ScrapedVideo): SourceVideoBadge => workflowP1 ? sourceVideoBadge(byVideo.get(video.id), channels) : { kind: 'new', label: 'NEW', tone: 'neutral' }
  const isBlocked = (video: ScrapedVideo): boolean => {
    if (!workflowP1) return false
    const badge = badgeFor(video)
    return badge.kind === 'uploaded' && !allowReupload && !overrideReupload.has(video.id)
  }
  const toggle = (video: ScrapedVideo, altKey = false): void => {
    const badge = badgeFor(video)
    if (badge.kind === 'uploaded' && !allowReupload && !overrideReupload.has(video.id)) {
      if (altKey) setVideoToOverride(video)
      else setMessage(badge.title ?? 'Already uploaded. Hold Alt while selecting to review an override.')
      return
    }
    setSel((prev) => { const next = new Set(prev); next.has(video.id) ? next.delete(video.id) : next.add(video.id); return next })
  }

  const confirmReupload = (): void => {
    if (!videoToOverride) return
    const videoId = videoToOverride.id
    setOverrideReupload((prev) => new Set(prev).add(videoId))
    setSel((prev) => new Set(prev).add(videoId))
    setVideoToOverride(null)
    setMessage('Re-download override enabled for this video.')
  }

  const confirmRemoveSource = async (): Promise<void> => {
    if (!sourceToRemove) return
    setConfirmBusy(true)
    try {
      await removeSource(sourceToRemove.id)
      setSourceToRemove(null)
      setMessage('Source removed.')
    } catch (error) {
      setMessage(errorMessage(error, 'Could not remove this source.'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const canFetch = url.trim().length > 0 && !fetching
  const fetchVids = async (): Promise<void> => {
    if (!canFetch) return
    setMessage('')
    // Clear the input right away — the optimistic queued card now carries the
    // feedback. We intentionally do NOT auto-open the source here: opening is
    // disabled until the scrape completes, and it avoids a second redundant scrape.
    const pendingUrl = url
    setUrl('')
    const source = await addSource(pendingUrl)
    if (!source) setUrl(pendingUrl) // restore so the user can retry/fix on failure
  }
  const openSavedSource = async (source: SourceChannel): Promise<void> => {
    setActiveSourceId(source.id)
    setUrl(source.url)
    setSel(new Set())
    setMessage('')
    try {
      await openSource(source.id)
    } catch (error) {
      setActiveSourceId('')
      setMessage(errorMessage(error, 'Could not open this source. Try again.'))
    }
  }
  const toggleSourceAutomation = async (source: SourceChannel): Promise<void> => {
    setMessage('')
    try {
      await setSourceAutomation(source.id, sourceAutomationDefaults(source, !source.autoWatch))
    } catch (error) {
      setMessage(errorMessage(error, 'Could not update this source automation.'))
    }
  }
  const listedVideos = useMemo(() => orderCachedVideos(sourceVideos, order, qty), [sourceVideos, order, qty])
  const visibleVideos = listedVideos.filter((v) => {
    if (!workflowP1) return true
    const wi = byVideo.get(v.id)
    const badge = badgeFor(v)
    if (filter === 'new') return badge.kind === 'new'
    if (filter === 'not-downloaded') return !wi?.downloaded
    if (filter === 'not-uploaded') return !wi?.uploaded
    return true
  })
  const selected = sourceVideos.filter((v) => sel.has(v.id) && !isBlocked(v))
  const estMb = (selected.reduce((a, v) => a + v.durationSec, 0) * bitrate) / 8 / 1000

  const download = async (toCompose: boolean): Promise<void> => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setMessage(toCompose ? 'Downloading selected audio…' : 'Starting download…')
    try {
      const rows = await startDownload(selected, activeSource?.url || url, bitrate)
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
      setMessage(errorMessage(e, 'Could not download the selected audio. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  // Opening a download that's mid-download/mid-resume (its "Downloaded only" stage flag can
  // race the file actually finishing) rejects with a specific error (e.g. "has no MP3 path
  // yet"). This used to be unhandled — the button fired-and-forgot into `compose`, so the
  // rejection surfaced as an uncaught error with no feedback and the user landed on an empty
  // Compose screen. Now it's caught, shown via the existing `message` row, and navigation
  // only happens on success.
  const openForCompose = async (downloadId: string): Promise<void> => {
    setMessage('')
    try {
      await openProject(downloadId)
      setActive('compose')
    } catch (e) {
      setMessage(errorMessage(e, 'Could not open this download yet.'))
    }
  }

  const videosLoaded = sourceVideos.length > 0
  const SCRAPE_PHASE_LABEL: Record<string, string> = {
    start: 'Fetching channel from YouTube…',
    stats: 'Saving channel stats…',
    uploads: 'Saving uploads…',
    mapping: 'Matching your uploads…'
  }
  const scrapePhaseText = fetching
    ? (scrapeStatus ? (SCRAPE_PHASE_LABEL[scrapeStatus.phase] ?? scrapeStatus.message) : 'Fetching channel from YouTube…')
    : ''

  return (
    <ScreenPad style={{ position: 'relative' }}>
      <PageHeader title="Source channels" subtitle="Add channels whose videos you want to turn into new productions. Studio keeps their video lists available locally." />


      {/* Row 1: URL + Add source */}
      <label htmlFor="source-channel-url" style={{ display: 'block', marginBottom: 7, fontSize: 12, color: 'var(--text-muted)' }}>Source channel URL or @handle</label>
      <div style={{ display: 'flex', gap: 11, marginBottom: 10 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-card)', border: '1px solid var(--border-2)', borderRadius: 11, padding: '12px 15px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2"><path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1" /></svg>
          <input id="source-channel-url" aria-label="Source channel URL or handle" maxLength={2048} spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void fetchVids() }} placeholder="Source URL or @handle, for example youtube.com/@PowerWithinOfficial" style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--text)', fontFamily: 'var(--font-mono)' }} />
        </div>
        <button type="button" disabled={!canFetch} onClick={() => void fetchVids()} className="me-btn" style={{ border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 13, padding: '0 20px', borderRadius: 11, cursor: canFetch ? 'pointer' : 'not-allowed', boxShadow: '0 4px 16px -4px var(--accent-glow)', opacity: canFetch ? 1 : 0.5 }}>{fetching ? 'Adding source…' : 'Add source'}</button>
      </div>
      {/* Live scrape progress — replaces the old dead "Saving…" button state with a phase
          label + indeterminate bar so it's clear what's happening during the long fetch. */}
      {fetching && (
        <div style={{ marginBottom: 12, border: '1px solid var(--border-2)', background: 'var(--bg-card)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-control)', marginBottom: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ animation: 'meSpin 1s linear infinite', flex: 'none' }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
            <span className="me-ellipsis">{scrapeStatus?.channelName && scrapeStatus.channelName !== scrapeStatus.channelId ? `${scrapeStatus.channelName} · ` : ''}{scrapePhaseText}</span>
          </div>
          <div role="progressbar" aria-label={scrapePhaseText} style={{ height: 5, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}>
            <div style={{ width: '40%', height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,var(--accent),var(--accent-deep))', animation: 'meIndeterminate 1.2s ease-in-out infinite' }} />
          </div>
        </div>
      )}
      {sourceError && <div role="alert" title={sourceError} className="me-clamp-2" style={{ marginBottom: 12, border: '1px solid #4a2530', background: 'rgba(255,90,110,.08)', color: '#ff8a96', borderRadius: 10, padding: '9px 12px', fontSize: 12, lineHeight: 1.4 }}>{sourceError}</div>}
      {message && selected.length === 0 && <div role="status" aria-live="polite" title={message} className="me-clamp-2" style={{ marginBottom: 12, color: 'var(--text-muted)', fontSize: 12 }}>{message}</div>}

      {!activeSource && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14, marginTop: 18 }}>
          {sourceChannels.length === 0 && pendingSources.length === 0 && (
            <div style={{ gridColumn: '1 / -1' }}><EmptyState title="No source channels yet" body="Add a YouTube channel above. Its videos will appear here so you can choose what to produce." /></div>
          )}
          {pendingSources.map((p) => (
            <PendingSourceCard key={p.key} pending={p} onRetry={() => void retryPendingSource(p.key)} onDismiss={() => dismissPendingSource(p.key)} />
          ))}
          {sourceChannels.map((source) => {
            const linked = channels.find((c) => c.id === source.linkedMyChannelId)
            const watching = !!source.autoWatch
            return (
              <div key={source.id} className="me-card" style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: 14, display: 'flex', flexDirection: 'column', gap: 13 }}>
                <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                  <SourceAvatar source={source} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div title={source.name} style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.name || source.handle}</div>
                    <div title={source.handle} style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10.5, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{source.handle}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <span style={{ border: '1px solid var(--border-3)', borderRadius: 999, padding: '3px 8px', color: 'var(--text-muted)', fontSize: 10.5 }}>{source.cachedVideoCount ?? source.videoCount ?? 0} videos</span>
                  <span style={{ border: `1px solid ${(source.newVideoCount ?? 0) > 0 ? 'rgba(245,179,35,.45)' : 'var(--border-3)'}`, borderRadius: 999, padding: '3px 8px', color: (source.newVideoCount ?? 0) > 0 ? '#f5b323' : 'var(--text-muted)', fontSize: 10.5 }}>{source.newVideoCount ?? 0} new</span>
                  <span style={{ border: '1px solid var(--border-3)', borderRadius: 999, padding: '3px 8px', color: 'var(--text-muted)', fontSize: 10.5 }}>checked {fmtAgo(source.lastScrapedAt)}</span>
                  {linked && <span style={{ border: '1px solid rgba(54,201,142,.35)', borderRadius: 999, padding: '3px 8px', color: '#4fd6a0', fontSize: 10.5 }}>{linked.handle || linked.name}</span>}
                </div>
                <div style={{ border: `1px solid ${watching ? 'rgba(54,201,142,.38)' : 'var(--border-2)'}`, borderRadius: 10, padding: '9px 10px', background: watching ? 'rgba(54,201,142,.08)' : 'var(--bg-inset)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ color: watching ? '#dffbed' : 'var(--text-muted)', fontSize: 11.5, fontWeight: watching ? 700 : 500, flex: 1 }}>{watching ? 'Watching for new videos' : 'Automatic checks off'}</span>
                    <Switch on={watching} onToggle={() => void toggleSourceAutomation(source)} label={watching ? 'Pause automatic checks for this source' : 'Start automatic checks for this source'} />
                  </div>
                  <div className="me-clamp-2" style={{ color: watching ? '#8fcfb3' : 'var(--text-dim)', fontSize: 10.5, lineHeight: 1.35, marginTop: 6 }}>
                    {watching ? automationSummary(source, groqReady) : 'Turn on automatic checks to find new videos; configure the production rules in Automations.'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <button type="button" onClick={() => void openSavedSource(source)} className="me-btn" style={{ flex: 1, border: 0, background: 'var(--accent)', color: 'var(--accent-ink)', borderRadius: 9, padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Browse videos</button>
                  <button type="button" onClick={() => void refreshSource(source.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 9, padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>Check now</button>
                  <button type="button" onClick={() => setSourceToRemove(source)} className="me-btn" style={{ border: '1px solid #3a2025', background: '#1a1216', color: '#ff8a96', borderRadius: 9, padding: '8px 10px', fontSize: 12, cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {activeSource && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '14px 0 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: '12px 14px' }}>
          <button type="button" onClick={() => { setActiveSourceId(''); setSel(new Set()) }} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 9, padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}>← Sources</button>
          <SourceAvatar source={activeSource} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{activeSource.name || activeSource.handle}</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 10.5, fontFamily: 'var(--font-mono)' }}>{activeSource.handle} · {sourceVideos.length} available · checked {fmtAgo(activeSource.lastScrapedAt)}</div>
          </div>
          {fetching && <span style={{ border: '1px solid rgba(245,179,35,.35)', color: '#f5b323', borderRadius: 999, padding: '4px 9px', fontSize: 10.5 }}>checking for new…</span>}
          <button type="button" onClick={() => void refreshSource(activeSource.id)} className="me-btn" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', color: 'var(--text-control)', borderRadius: 9, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}>Check for new</button>
        </div>
      )}

      {/* Row 2: Filter bar — only after videos load */}
      {activeSource && videosLoaded && (
        <div className="me-source-toolbar" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 18, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 11 }}>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}><b style={{ color: 'var(--text-soft)' }}>{visibleVideos.length}</b> of {sourceVideos.length}</div>
          {workflowP1 && (
            <div className="me-source-filter-group" style={{ display: 'flex', flex: 'none', background: 'var(--bg-inset)', border: '1px solid var(--border-2)', borderRadius: 9, overflow: 'hidden', fontSize: 11.5 }}>
              {FILTERS.map((f) => (
                <button type="button" key={f.id} onClick={() => setFilter(f.id)} style={{ border: 0, padding: '7px 11px', cursor: 'pointer', background: filter === f.id ? 'var(--accent)' : 'transparent', color: filter === f.id ? 'var(--accent-ink)' : 'var(--text-muted)', fontWeight: filter === f.id ? 600 : undefined }}>{f.label}</button>
              ))}
            </div>
          )}
          <div className="me-source-filter-group" style={{ display: 'flex', flex: 'none', background: 'var(--bg-inset)', border: '1px solid var(--border-2)', borderRadius: 9, overflow: 'hidden', fontSize: 12 }}>
            {(['Popular', 'Latest', 'Oldest'] as ScrapeOrder[]).map((o) => (
              <button type="button" key={o} onClick={() => setOrder(o)} style={{ border: 0, padding: '7px 13px', cursor: 'pointer', background: order === o ? 'var(--accent)' : 'transparent', color: order === o ? 'var(--accent-ink)' : 'var(--text-muted)', fontWeight: order === o ? 600 : undefined }}>{o}</button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--border-2)', borderRadius: 9, padding: '6px 12px', background: 'var(--bg-inset)' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Videos</span>
            <input value={qty} onChange={(e) => setQty(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))} title="1–50 videos" style={{ width: 28, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--text-bright)', fontSize: 14 }} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Audio · {bitrate} kbps</div>
          {selected.length > 0 && <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-soft)' }}><b style={{ color: 'var(--accent)' }}>{selected.length}</b> selected · ~{estMb.toFixed(0)} MB</div>}
        </div>
      )}

      {/* 3-column video grid — larger thumbnails */}
      <div className="me-source-video-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 14, marginBottom: selected.length > 0 ? 80 : 20 }}>
        {activeSource && sourceVideos.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '34px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--text-faint)', border: '1.5px dashed var(--border-2)', borderRadius: 12 }}>No videos are available for this source. Check for new videos.</div>
        )}
        {activeSource && sourceVideos.length > 0 && visibleVideos.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: '34px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--text-faint)', border: '1.5px dashed var(--border-2)', borderRadius: 12 }}>No videos match this filter.</div>
        )}
        {activeSource && visibleVideos.map((v, i) => {
          const on = sel.has(v.id)
          const badge = badgeFor(v)
          const blocked = isBlocked(v)
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={`${on ? 'Deselect' : 'Select'} ${v.title}${blocked ? '. Already uploaded; hold Alt to review an override' : ''}`}
              onClick={(event) => toggle(v, event.altKey)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                toggle(v, event.altKey)
              }}
              className="me-vid me-card ed-focus"
              title={blocked ? (badge.title ?? 'Already uploaded') : undefined}
              style={{ border: `1.5px solid ${on ? 'var(--accent)' : blocked ? '#2f2a1d' : 'var(--border)'}`, borderRadius: 12, overflow: 'hidden', background: on ? 'var(--accent-soft)' : 'var(--bg-card)', cursor: blocked ? 'not-allowed' : 'pointer', position: 'relative', opacity: blocked ? 0.62 : 1 }}
            >
              <div style={{ position: 'relative', height: 130, overflow: 'hidden' }}>
                <YouTubeThumb videoId={v.id} alt={v.title} fallback={GRADS[i % GRADS.length]} selected={blocked ? false : on} />
                {workflowP1 && <div title={badge.title ?? badge.label} style={{ position: 'absolute', top: 8, right: 8, ...badgeStyle(badge) }}>{blocked ? `Locked · ${badge.label}` : badge.label}</div>}
                <div style={{ position: 'absolute', bottom: 7, right: 7, fontFamily: 'var(--font-mono)', fontSize: 10, background: 'rgba(0,0,0,.7)', color: 'var(--text)', padding: '2px 6px', borderRadius: 5 }}>{fmtDur(v.durationSec)}</div>
              </div>
              <div style={{ padding: '11px 12px' }}>
                <div title={v.title} style={{ fontSize: 12.5, color: on ? '#f2f4f7' : 'var(--text)', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', minWidth: 0, flex: 1 }}>{fmtViews(v.views)}</div>
                  {workflowP1 && badge.kind === 'pending' && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); void setItemUploaded(v.id, true) }} style={{ flex: 'none', border: '1px solid rgba(245,179,35,.45)', background: 'rgba(245,179,35,.12)', color: '#f5b323', borderRadius: 7, padding: '3px 7px', fontSize: 10, cursor: 'pointer' }}>Confirm</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sticky selection footer */}
      {selected.length > 0 && (
        <div className="me-source-selection-bar" style={{ position: 'sticky', bottom: 0, marginLeft: 'calc(var(--pad) * -1)', marginRight: 'calc(var(--pad) * -1)', background: 'var(--bg-window)', borderTop: '1px solid var(--border)', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16, zIndex: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}><b style={{ color: 'var(--text-bright)', fontFamily: 'var(--font-display)' }}>{selected.length}</b> selected · ~{estMb.toFixed(0)} MB</div>
          <div className="me-source-selection-spacer" style={{ flex: 1 }} />
          {message && <div role="status" aria-live="polite" style={{ fontSize: 11.5, color: message.includes('failed') ? '#ff8a96' : 'var(--text-muted)', flex: 1, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message}</div>}
          <button type="button" disabled={!selected.length || busy} onClick={() => void download(false)} className="me-btn me-source-selection-action" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 10, padding: '10px 18px', fontSize: 12.5, color: 'var(--text-control)', cursor: selected.length && !busy ? 'pointer' : 'not-allowed', opacity: selected.length && !busy ? 1 : 0.45 }}>Download audio</button>
          <button type="button" disabled={!selected.length || busy} onClick={() => void download(true)} className="me-btn me-source-selection-action" style={{ display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'linear-gradient(180deg,var(--accent),var(--accent-deep))', color: 'var(--accent-ink)', fontWeight: 600, fontSize: 12.5, padding: '10px 20px', borderRadius: 10, cursor: selected.length && !busy ? 'pointer' : 'not-allowed', boxShadow: '0 4px 16px -4px var(--accent-glow)', opacity: selected.length && !busy ? 1 : 0.45 }}>
            {busy ? 'Working…' : 'Download and edit'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      )}

      {/* Collapsible "Already downloaded" */}
      <div style={{ marginTop: selected.length > 0 ? 0 : 10 }}>
        <button type="button" onClick={() => setHistoryOpen((o) => !o)} className="me-btn" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 12, padding: '12px 16px', cursor: 'pointer' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Already downloaded</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— resume unfinished, don't re-fetch</span>
          {downloads.length > 0 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)', border: '1px solid var(--border-2)', borderRadius: 5, padding: '2px 7px' }}>{downloads.length}</span>}
          <span style={{ fontSize: 10, color: 'var(--text-faint)', transform: historyOpen ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .15s' }}>▶</span>
        </button>

        {historyOpen && (
          <div style={{ border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden', background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', padding: '11px 16px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: 'var(--text-faint)' }}>
              <div style={{ flex: 2.4 }}>CLIP</div><div style={{ width: 120 }}>SOURCE</div><div style={{ width: 130 }}>STAGE</div><div style={{ width: 140 }}>PROGRESS</div><div style={{ width: 130, textAlign: 'right' }}>ACTION</div>
            </div>
            {downloads.length === 0 && (
              <div style={{ padding: '22px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>Nothing downloaded yet.</div>
            )}
            {downloads.map((d) => {
              const live = dlProgress[d.id]
              const pct = live ? `${Math.round(live.pct)}%` : d.pct
              const pctValue = Math.max(0, Math.min(100, Number.parseFloat(pct) || 0))
              const currentStage = live?.stage ?? d.stage
              const done = currentStage === 'Downloaded only'
              const displayStage = done ? 'Audio ready' : currentStage
              const barColor = done ? '#36c98e' : currentStage === 'Failed' ? '#ff5a6e' : 'var(--accent)'
              const stageColor = done ? '#4fd6a0' : currentStage === 'Failed' ? '#ff8a96' : 'var(--text-soft)'
              return (
                <div key={d.id} className="me-row" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ flex: 2.4, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 48, height: 27, borderRadius: 6, background: GRADS[0], flex: 'none', overflow: 'hidden' }}>
                      <YouTubeThumb videoId={youtubeIdFromDownloadId(d.id)} alt={d.title} fallback={GRADS[0]} />
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div title={d.title} className="me-ellipsis" style={{ fontSize: 12.5, color: 'var(--text)' }}>{d.title}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{d.size} · {d.when}</div>
                    </div>
                  </div>
                  <div title={d.channel} style={{ width: 120, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.channel}</div>
                  <div title={d.error || displayStage} style={{ width: 130, fontSize: 11.5, color: stageColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentStage === 'Failed' && d.error ? `Failed: ${d.error}` : displayStage}</div>
                  <div style={{ width: 140 }}><div role="progressbar" aria-label={`Download progress for ${d.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pctValue} style={{ height: 5, borderRadius: 4, background: '#1a1e26', overflow: 'hidden' }}><div style={{ width: `${pctValue}%`, height: '100%', background: barColor }} /></div></div>
                  <div style={{ width: 130, display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                    {done && (
                      <button type="button" onClick={() => void openForCompose(d.id)} className="me-btn ed-focus" style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 10.5, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>Edit video</button>
                    )}
                    {currentStage === 'Downloading' && <button type="button" onClick={() => void cancelDownload(d.id)} className="me-btn ed-focus" style={{ border: '1px solid #4a3540', background: '#1b1217', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 10.5, color: 'var(--err-2)', cursor: 'pointer' }}>Cancel</button>}
                    {currentStage !== 'Downloading' && currentStage !== 'Downloaded only' && <button type="button" onClick={() => void resumeDownload(d.id)} className="me-btn ed-focus" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 10.5, color: 'var(--text-bright)', cursor: 'pointer' }}>Resume</button>}
                    <button type="button" onClick={() => void deleteDownload(d.id)} title="Remove" aria-label="Remove download" className="me-btn ed-focus" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 9px', fontSize: 10.5, color: 'var(--text-dim)', cursor: 'pointer' }}>×</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!videoToOverride}
        title="Re-download an uploaded video?"
        body={videoToOverride ? `“${videoToOverride.title}” already appears in your published work. Re-download it only if you intend to make a new version.` : ''}
        confirmLabel="Allow re-download"
        confirmVariant="primary"
        onCancel={() => setVideoToOverride(null)}
        onConfirm={confirmReupload}
      />
      <ConfirmDialog
        open={!!sourceToRemove}
        title="Remove source channel?"
        body={sourceToRemove ? `${sourceToRemove.handle || sourceToRemove.name} and its cached source-video list will be removed. Existing downloads and projects will stay available.` : ''}
        confirmLabel="Remove source"
        busy={confirmBusy}
        onCancel={() => setSourceToRemove(null)}
        onConfirm={() => void confirmRemoveSource()}
      />
    </ScreenPad>
  )
}
