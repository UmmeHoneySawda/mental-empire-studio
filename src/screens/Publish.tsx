import { useEffect, useMemo, useState } from 'react'
import { ScreenPad, Eyebrow, Title } from '../components/primitives'
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
const STATUS_COLOR: Record<PublishItem['uploadStatus'], string> = {
  uploaded: '#4fd6a0',
  'not-uploaded': '#f5b323',
  unlinked: '#6a7180'
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

function DragHandle({ path, label, startDrag }: { path: string; label: string; startDrag: (path: string) => void }): JSX.Element {
  return (
    <span
      draggable
      onDragStart={(e) => {
        // The actual OS-level drag is started natively via IPC (main process owns
        // startDrag); prevent the browser's own HTML5 drag image so it doesn't fight it.
        e.preventDefault()
        startDrag(path)
      }}
      title={`Drag "${fileName(path)}" into a browser tab to upload`}
      className="me-btn"
      style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: 'grab', display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="9" cy="17" r="1.4" /><circle cx="15" cy="7" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="15" cy="17" r="1.4" /></svg>
      {label}
    </span>
  )
}

function PublishCard({ item }: { item: PublishItem }): JSX.Element {
  const revealPublishFile = useData((s) => s.revealPublishFile)
  const startPublishDrag = useData((s) => s.startPublishDrag)
  const thumbSrc = mediaSrc(item.thumbPath ?? undefined)

  return (
    <div className="me-card" style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', overflow: 'hidden', display: 'flex' }}>
      <div
        draggable={!!item.thumbPath}
        onDragStart={(e) => {
          if (!item.thumbPath) return
          e.preventDefault()
          startPublishDrag(item.thumbPath)
        }}
        title={item.thumbPath ? `Drag thumbnail "${fileName(item.thumbPath)}" into a browser tab` : 'No thumbnail'}
        style={{ width: 120, flex: 'none', background: 'linear-gradient(135deg,#2a2540,#46243a)', cursor: item.thumbPath ? 'grab' : 'default', position: 'relative' }}
      >
        {thumbSrc ? (
          <img src={thumbSrc} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} draggable={false} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#5b616f', fontSize: 10 }}>No thumb</div>
        )}
        <span style={{ position: 'absolute', right: 6, bottom: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#fff', background: 'rgba(0,0,0,.55)', borderRadius: 5, padding: '1px 5px' }}>{fmtDuration(item.durationSec)}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div title={item.title} className="me-ellipsis" style={{ fontWeight: 600, fontSize: 13.5, color: '#eef0f3' }}>{item.title}</div>
            <div style={{ fontSize: 10.5, color: '#6a7180', fontFamily: 'var(--font-mono)' }}>{item.channel} · rendered {fmtDate(item.renderedAt)}</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLOR[item.uploadStatus], border: `1px solid ${STATUS_COLOR[item.uploadStatus]}33`, background: `${STATUS_COLOR[item.uploadStatus]}14`, borderRadius: 6, padding: '3px 8px', whiteSpace: 'nowrap' }}>{STATUS_LABEL[item.uploadStatus]}</span>
        </div>
        {item.matchedTitle && (
          <div title={item.matchedTitle} className="me-ellipsis" style={{ fontSize: 10.5, color: '#5b616f' }}>matched: {item.matchedTitle}</div>
        )}
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', flexWrap: 'wrap' }}>
          <DragHandle path={item.videoPath} label="Drag video" startDrag={startPublishDrag} />
          {item.thumbPath && <DragHandle path={item.thumbPath} label="Drag thumb" startDrag={startPublishDrag} />}
          <span onClick={() => void revealPublishFile(item.videoPath)} title="Reveal the rendered file in your file manager" className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '5px 10px', fontSize: 10.5, color: '#c4cad3', cursor: 'pointer' }}>Reveal video</span>
        </div>
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
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 18 }}>
        <div><Eyebrow>OUTPUT</Eyebrow><Title>Publish</Title></div>
        <div style={{ flex: 1 }} />
        <span onClick={() => void loadPublishItems()} className="me-btn" style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 9, padding: '7px 12px', fontSize: 11.5, color: loading ? '#6a7180' : '#c4cad3', cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Refreshing…' : 'Refresh ↻'}</span>
      </div>
      <div style={{ fontSize: 12.5, color: '#8a909c', marginBottom: 16, maxWidth: 660 }}>
        Every rendered video, matched against your channels' uploaded titles (allowing for a word or two of drift).
        Drag the video or thumbnail straight into a browser upload tab instead of hunting through folders.
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {tabs.map((t) => (
          <span key={t.key} onClick={() => setFilter(t.key)} className="me-btn" style={{ border: filter === t.key ? '1px solid var(--accent)' : '1px solid #23272f', color: filter === t.key ? 'var(--accent)' : '#8a909c', background: filter === t.key ? 'var(--accent-soft)' : 'transparent', borderRadius: 8, padding: '6px 12px', fontSize: 11.5, cursor: 'pointer' }}>{t.label} <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>{counts[t.key]}</span></span>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 12.5, color: '#5b616f' }}>
          {items.length === 0 ? 'No finished renders yet.' : 'Nothing matches this filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((item) => <PublishCard key={item.jobId} item={item} />)}
        </div>
      )}
    </ScreenPad>
  )
}
