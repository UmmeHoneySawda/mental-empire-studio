import { useEffect, useMemo, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, StatusPill, EmptyState, Banner } from '../components/ui/kit'
import { useData } from '../store/useData'
import type { PublishItem } from '@shared/types'
import { mediaSrc } from '../lib/media'

// Hand-off hub (P2 H): the "did I already upload this" view. Removes the manual
// folder-hunting — lists every finished render with the upload status persisted by
// runUploadDetection, a Reveal-in-folder button, and native drag-out (drag the video/thumbnail
// straight into a browser upload tab) instead of digging through D:\ytAutomateOutputs by hand.
// The nav key stays `publish` (settings.defaultScreen persists it) but nothing here uploads:
// the app has no uploader, no OAuth and no network call on this path, so the labels say so.

type Filter = 'all' | PublishItem['uploadStatus']

const STATUS_LABEL: Record<PublishItem['uploadStatus'], string> = {
  uploaded: 'Uploaded',
  'maybe-uploaded': 'Probably uploaded',
  'not-uploaded': 'Not uploaded',
  unchecked: 'Not checked'
}
const STATUS_TONE: Record<PublishItem['uploadStatus'], 'ok' | 'warn' | 'neutral' | 'accent'> = {
  uploaded: 'ok',
  'maybe-uploaded': 'accent',
  'not-uploaded': 'warn',
  unchecked: 'neutral'
}

/** Tab order; labels come from STATUS_LABEL so a pill and its filter can never drift apart. */
const FILTER_ORDER: Filter[] = ['all', 'not-uploaded', 'maybe-uploaded', 'uploaded', 'unchecked']

function statusHint(item: PublishItem): string {
  const pct = item.uploadMatchScore === undefined ? null : `${Math.round(item.uploadMatchScore * 100)}%`
  switch (item.uploadStatus) {
    case 'uploaded':
      return pct ? `Title matched an upload on your channel at ${pct}` : 'You marked this uploaded'
    case 'maybe-uploaded':
      return `Best title match ${pct ?? '—'} — under the confirm threshold, so check before re-uploading`
    case 'not-uploaded':
      return 'No upload on your channels matched this title'
    case 'unchecked':
      return 'Upload detection has not looked at this video yet'
  }
}

function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function IconGrip(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="9" cy="7" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="9" cy="17" r="1.4" /><circle cx="15" cy="7" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="15" cy="17" r="1.4" /></svg>
  )
}

function DragHandle({ path, label, startDrag }: { path: string; label: string; startDrag: (path: string) => void }): JSX.Element {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        // The actual OS-level drag is started natively via IPC (main process owns
        // startDrag); prevent the browser's own HTML5 drag image so it doesn't fight it.
        e.preventDefault()
        startDrag(path)
      }}
      title={`Drag "${fileName(path)}" into a browser tab to upload`}
      aria-label={`Drag ${label}`}
      className="me-btn ed-focus"
      style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 'var(--fs-caption)', color: 'var(--text-bright)', cursor: 'grab', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <IconGrip />
      {label}
    </button>
  )
}

function PublishCard({ item }: { item: PublishItem }): JSX.Element {
  const revealPublishFile = useData((s) => s.revealPublishFile)
  const startPublishDrag = useData((s) => s.startPublishDrag)
  const setItemUploaded = useData((s) => s.setItemUploaded)
  const loadPublishItems = useData((s) => s.loadPublishItems)
  const thumbSrc = mediaSrc(item.thumbPath ?? undefined)
  const isUploaded = item.uploadStatus === 'uploaded'
  // Dragging a file out writes nothing, and the only automatic path to "Uploaded" is a
  // re-scrape plus a fuzzy title match. Without this the screen can never converge: the card
  // looks identical before and after the hand-off, so the user has no way to say "yes, I did".
  const mark = async (uploaded: boolean): Promise<void> => {
    if (!item.videoId) return
    await setItemUploaded(item.videoId, uploaded)
    await loadPublishItems()
  }

  return (
    <Card pad={0} style={{ overflow: 'hidden', display: 'flex' }}>
      <div
        draggable={!!item.thumbPath}
        onDragStart={(e) => {
          if (!item.thumbPath) return
          e.preventDefault()
          startPublishDrag(item.thumbPath)
        }}
        title={item.thumbPath ? `Drag thumbnail "${fileName(item.thumbPath)}" into a browser tab` : 'No thumbnail'}
        style={{ width: 120, flex: 'none', background: 'var(--bg-inset)', cursor: item.thumbPath ? 'grab' : 'default', position: 'relative' }}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontSize: 10 }}>No thumb</div>
        )}
        <span style={{ position: 'absolute', right: 6, bottom: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fff', background: 'rgba(0,0,0,.6)', borderRadius: 5, padding: '1px 5px' }}>{fmtDuration(item.durationSec)}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div title={item.title} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-bright)' }}>{item.title}</div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{item.channel} · rendered {fmtDate(item.renderedAt)}</div>
          </div>
          <StatusPill tone={STATUS_TONE[item.uploadStatus]} title={statusHint(item)}>{STATUS_LABEL[item.uploadStatus]}</StatusPill>
        </div>
        {item.matchedChannels && (
          <div className="me-ellipsis" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>found on {item.matchedChannels.join(', ')}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
          <DragHandle path={item.videoPath} label="Drag video" startDrag={startPublishDrag} />
          {item.thumbPath && <DragHandle path={item.thumbPath} label="Drag thumb" startDrag={startPublishDrag} />}
          <button type="button" onClick={() => void revealPublishFile(item.videoPath)} title="Reveal the rendered file in your file manager" aria-label="Reveal video in folder" className="me-btn ed-focus" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 'var(--fs-caption)', color: 'var(--text-bright)', cursor: 'pointer' }}>Reveal video</button>
          {item.videoId && (
            <button
              type="button"
              onClick={() => void mark(!isUploaded)}
              title={isUploaded ? 'Mark this as not uploaded (overrides detection either way)' : 'Record that you uploaded this, so it stops showing as pending'}
              className="me-btn ed-focus"
              style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 'var(--fs-caption)', color: 'var(--text-bright)', cursor: 'pointer' }}
            >{isUploaded ? 'Unmark uploaded' : 'Mark uploaded'}</button>
          )}
        </div>
      </div>
    </Card>
  )
}

function SkeletonCard(): JSX.Element {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', overflow: 'hidden', display: 'flex', height: 96 }}>
      <div className="me-shimmer" style={{ width: 120, flex: 'none', background: 'var(--bg-inset)' }} />
      <div style={{ flex: 1, padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="me-shimmer" style={{ height: 14, width: '55%', borderRadius: 5, background: 'var(--bg-inset)' }} />
        <div className="me-shimmer" style={{ height: 10, width: '35%', borderRadius: 5, background: 'var(--bg-inset)' }} />
      </div>
    </div>
  )
}

export function Publish(): JSX.Element {
  const items = useData((s) => s.publishItems)
  const loading = useData((s) => s.publishLoading)
  const loadPublishItems = useData((s) => s.loadPublishItems)
  const detectUploads = useData((s) => s.detectUploads)
  const [filter, setFilter] = useState<Filter>('all')
  const [checking, setChecking] = useState(false)

  useEffect(() => { void loadPublishItems() }, [loadPublishItems])

  const filtered = useMemo(() => filter === 'all' ? items : items.filter((i) => i.uploadStatus === filter), [items, filter])
  const counts = useMemo(() => {
    const by: Record<Filter, number> = { all: items.length, uploaded: 0, 'maybe-uploaded': 0, 'not-uploaded': 0, unchecked: 0 }
    for (const i of items) by[i.uploadStatus]++
    return by
  }, [items])

  // Only offer a filter that can return something. Four tabs with live counts, three of them
  // permanently 0, leading to "Nothing matches this filter", was the old screen's worst lie.
  const tabs = FILTER_ORDER.filter((k) => k === 'all' || counts[k] > 0 || filter === k)

  const runDetection = async (): Promise<void> => {
    setChecking(true)
    try {
      await detectUploads()
      await loadPublishItems()
    } finally {
      setChecking(false)
    }
  }

  return (
    <ScreenPad>
      <PageHeader
        eyebrow="Output"
        title="Ready to upload"
        subtitle="Every finished render, with whether it already appears on one of your channels. Drag the video and its thumbnail straight into your YouTube upload tab — no folder-hunting. The app hands the files off; it does not upload for you."
        actions={(
          <>
            <Btn variant="ghost" onClick={() => void runDetection()} disabled={checking} title="Re-match every video against the uploads scraped from your own channels">{checking ? 'Checking…' : 'Check uploads'}</Btn>
            <Btn variant="ghost" onClick={() => void loadPublishItems()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>
          </>
        )}
      />

      {items.length > 0 && counts.unchecked === items.length && (
        <Banner kind="info" style={{ marginBottom: 12 }}>
          None of these have been checked against your own channels' uploads yet, so no card can tell you whether you already uploaded it. Hit “Check uploads” — if they stay unchecked, refresh a channel on My Channels so there are uploads to match against.
        </Banner>
      )}

      <div role="tablist" aria-label="Filter by upload status" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((key) => {
          const on = filter === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(key)}
              className="me-btn ed-focus"
              style={{ border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)', color: on ? 'var(--accent)' : 'var(--text-muted)', background: on ? 'var(--accent-soft)' : 'transparent', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}
            >
              {key === 'all' ? 'All' : STATUS_LABEL[key]} <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{counts[key]}</span>
            </button>
          )
        })}
      </div>

      {loading && items.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={items.length === 0 ? 'No finished renders yet' : 'Nothing matches this filter'}
          body={items.length === 0 ? 'Render a video and it will show up here with its upload status.' : 'Try a different filter above.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((item) => <PublishCard key={item.jobId} item={item} />)}
        </div>
      )}
    </ScreenPad>
  )
}
