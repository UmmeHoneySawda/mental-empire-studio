import { useEffect, useMemo, useState } from 'react'
import { ScreenPad } from '../components/primitives'
import { PageHeader, Card, Btn, StatusPill, EmptyState } from '../components/ui/kit'
import { useData } from '../store/useData'
import type { PublishItem } from '@shared/types'
import { mediaSrc } from '../lib/media'

// Library/Publish hub (P2 H): the "did I already upload this" view. Removes the manual
// folder-hunting — lists every finished render with a fuzzy-matched upload status (via the
// Sources -> My Channel link, so it needs G's channel linking to resolve), a Reveal-in-
// folder button, and native drag-out (drag the video/thumbnail straight into a browser
// upload tab) instead of digging through D:\ytAutomateOutputs by hand.

type Filter = 'all' | 'not-uploaded' | 'uploaded' | 'unlinked'

const STATUS_LABEL: Record<PublishItem['uploadStatus'], string> = {
  uploaded: 'Uploaded',
  'not-uploaded': 'Not uploaded',
  unlinked: 'Link a source to check'
}
const STATUS_TONE: Record<PublishItem['uploadStatus'], 'ok' | 'warn' | 'neutral'> = {
  uploaded: 'ok',
  'not-uploaded': 'warn',
  unlinked: 'neutral'
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
  const thumbSrc = mediaSrc(item.thumbPath ?? undefined)

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
          <StatusPill tone={STATUS_TONE[item.uploadStatus]}>{STATUS_LABEL[item.uploadStatus]}</StatusPill>
        </div>
        {item.matchedTitle && (
          <div title={item.matchedTitle} className="me-ellipsis" style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-faint)' }}>matched: {item.matchedTitle}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
          <DragHandle path={item.videoPath} label="Drag video" startDrag={startPublishDrag} />
          {item.thumbPath && <DragHandle path={item.thumbPath} label="Drag thumb" startDrag={startPublishDrag} />}
          <button type="button" onClick={() => void revealPublishFile(item.videoPath)} title="Reveal the rendered file in your file manager" aria-label="Reveal video in folder" className="me-btn ed-focus" style={{ border: '1px solid var(--border-3)', background: 'var(--bg-control)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 'var(--fs-caption)', color: 'var(--text-bright)', cursor: 'pointer' }}>Reveal video</button>
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
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => { void loadPublishItems() }, [loadPublishItems])

  const filtered = useMemo(() => filter === 'all' ? items : items.filter((i) => i.uploadStatus === filter), [items, filter])
  const counts = useMemo(() => ({
    all: items.length,
    'not-uploaded': items.filter((i) => i.uploadStatus === 'not-uploaded').length,
    uploaded: items.filter((i) => i.uploadStatus === 'uploaded').length,
    unlinked: items.filter((i) => i.uploadStatus === 'unlinked').length
  }), [items])

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'not-uploaded', label: 'Not uploaded' },
    { key: 'uploaded', label: 'Uploaded' },
    { key: 'unlinked', label: 'No source link' }
  ]

  return (
    <ScreenPad>
      <PageHeader
        eyebrow="Output"
        title="Publish"
        subtitle="Every finished render, matched against your channels' uploaded titles. Drag a video or thumbnail straight into a browser upload tab — no folder-hunting."
        actions={<Btn variant="ghost" onClick={() => void loadPublishItems()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</Btn>}
      />

      <div role="tablist" aria-label="Filter by upload status" style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map((t) => {
          const on = filter === t.key
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(t.key)}
              className="me-btn ed-focus"
              style={{ border: on ? '1px solid var(--accent)' : '1px solid var(--border-2)', color: on ? 'var(--accent)' : 'var(--text-muted)', background: on ? 'var(--accent-soft)' : 'transparent', borderRadius: 'var(--radius-sm)', padding: '6px 12px', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}
            >
              {t.label} <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{counts[t.key]}</span>
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
