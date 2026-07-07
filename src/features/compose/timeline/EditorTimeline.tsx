import type { Project, ProjectImage, TranscriptWord } from '@shared/types'
import type { GpuBrollSegment } from '@shared/renderSpec'
import { useMemo, useState, useRef, type MouseEvent, type WheelEvent, type ReactNode } from 'react'
import { TimelineInspector } from './TimelineInspector'
import {
  buildBrollTimeline,
  buildCaptionGroupTimeline,
  buildVisualTimeline,
  clampTimelineSec,
  rangeToPct,
  type EditorSelection,
  type TimelineBlock,
  type VisualTimelineBlock
} from './timelineModel'

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function selectionKey(selection: EditorSelection): string {
  return selection.kind === 'image' || selection.kind === 'broll' || selection.kind === 'caption' ? `${selection.kind}:${selection.id}` : selection.kind
}

const TRACK_H = 28
const TRACK_GAP = 8
const TRACK_LABELS = ['Visual', 'Captions', 'Look', 'Audio']

// Content-only track box. Sized to the (possibly zoomed) inner timeline width so blocks
// positioned by percentage spread out as the user zooms in. A shared playhead + label
// column live in the parent so all tracks scroll together.
function TrackBox({ children, onSeek }: { children: ReactNode; onSeek: (e: MouseEvent<HTMLDivElement>) => void }): JSX.Element {
  return (
    <div onClick={onSeek} style={{ position: 'relative', height: TRACK_H, border: '1px solid #1d2129', borderRadius: 8, background: '#0b0d12', overflow: 'hidden', cursor: 'crosshair' }}>
      {children}
    </div>
  )
}

function ZoomButton({ label, title, onClick, disabled }: { label: string; title: string; onClick: () => void; disabled?: boolean }): JSX.Element {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} style={{ border: '1px solid #262b34', background: '#15181f', borderRadius: 7, padding: '3px 9px', fontSize: 11, fontFamily: 'var(--font-mono)', color: disabled ? '#4a5060' : '#c4cad3', cursor: disabled ? 'not-allowed' : 'pointer', lineHeight: 1.2 }}>{label}</button>
  )
}

function Block({
  block,
  active,
  tone,
  badge,
  onClick
}: {
  block: TimelineBlock
  active: boolean
  tone: 'visual' | 'broll' | 'caption' | 'look'
  badge?: string
  onClick: (e: MouseEvent) => void
}): JSX.Element {
  const colors = tone === 'caption'
    ? { bg: 'rgba(54,201,142,.13)', border: active ? '#36c98e' : 'rgba(54,201,142,.3)', text: active ? '#eafff5' : '#72d8aa' }
    : tone === 'look'
      ? { bg: 'rgba(139,124,255,.14)', border: active ? '#8b7cff' : 'rgba(139,124,255,.32)', text: active ? '#f1eeff' : '#b8afff' }
      : tone === 'broll'
        ? { bg: 'rgba(64,169,255,.13)', border: active ? '#40a9ff' : 'rgba(64,169,255,.32)', text: active ? '#eaf6ff' : '#8fcaff' }
        : { bg: 'rgba(245,179,35,.14)', border: active ? 'var(--accent)' : 'rgba(245,179,35,.32)', text: active ? '#fff4cc' : '#f5c95f' }
  return (
    <button
      type="button"
      title={`${block.label} · ${fmt(block.startSec)}-${fmt(block.endSec)}`}
      onClick={onClick}
      style={{
        position: 'absolute',
        left: `${block.leftPct}%`,
        width: `${block.widthPct}%`,
        top: 4,
        bottom: 4,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        background: colors.bg,
        color: colors.text,
        padding: '0 7px',
        fontSize: 10.5,
        fontFamily: tone === 'caption' ? 'var(--font-display)' : 'var(--font-mono)',
        fontWeight: active ? 700 : 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        cursor: 'pointer',
        textAlign: 'left'
      }}
    >
      {badge && <span style={{ display: 'inline-block', marginRight: 5, border: '1px solid currentColor', borderRadius: 5, padding: '0 4px', fontSize: 8, lineHeight: '12px', verticalAlign: '1px', opacity: 0.9 }}>{badge === 'video' ? '▶' : badge}</span>}
      {block.label}
    </button>
  )
}

function Waveform(): JSX.Element {
  const bars = Array.from({ length: 54 }, (_, i) => {
    const h = 20 + Math.round(Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.17)) * 52)
    return <span key={i} style={{ width: 3, height: `${h}%`, borderRadius: 4, background: '#27303c', display: 'block' }} />
  })
  return <div style={{ position: 'absolute', inset: '5px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 3 }}>{bars}</div>
}

export function EditorTimeline({
  project,
  images,
  broll = [],
  words,
  playheadSec,
  selection,
  onSeek,
  onSelect
}: {
  project: Project
  images: ProjectImage[]
  broll?: GpuBrollSegment[]
  words: TranscriptWord[]
  playheadSec: number
  selection: EditorSelection
  onSeek: (sec: number) => void
  onSelect: (selection: EditorSelection) => void
}): JSX.Element {
  const durationSec = Math.max(0.05, project.durationSec || 0.05)
  const [zoom, setZoom] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const visualBlocks: VisualTimelineBlock[] = useMemo(() => [
    ...buildVisualTimeline(images, durationSec),
    ...buildBrollTimeline(broll, durationSec)
  ].sort((a, b) => a.startSec - b.startSec || (a.kind === 'broll' ? -1 : 1)), [images, broll, durationSec])
  const captionBlocks = useMemo(() => buildCaptionGroupTimeline(words, durationSec), [words, durationSec])
  const playhead = rangeToPct(clampTimelineSec(playheadSec, durationSec), clampTimelineSec(playheadSec, durationSec) + 0.05, durationSec).leftPct
  const activeKey = selectionKey(selection)
  const seekFromClick = (e: MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    onSeek((x / Math.max(1, rect.width)) * durationSec)
  }
  const ZOOM_MIN = 1
  const ZOOM_MAX = 16
  const setZoomClamped = (next: number): void => setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 100) / 100)))
  // Ctrl/⌘ + wheel zooms (CapCut-style); plain vertical wheel scrolls the timeline
  // horizontally when zoomed in so a dense caption track is navigable.
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    if (e.ctrlKey || e.metaKey) {
      setZoomClamped(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
    } else if (scrollRef.current && zoom > 1 && e.deltaY !== 0) {
      scrollRef.current.scrollLeft += e.deltaY
    }
  }

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', marginBottom: 20, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: 'var(--accent)' }}>CUSTOMIZE</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: '#eef0f3' }}>Timeline</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
          <ZoomButton label="−" title="Zoom out" onClick={() => setZoomClamped(zoom / 1.5)} disabled={zoom <= ZOOM_MIN} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#8a909c', minWidth: 34, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <ZoomButton label="+" title="Zoom in" onClick={() => setZoomClamped(zoom * 1.5)} disabled={zoom >= ZOOM_MAX} />
          <ZoomButton label="Fit" title="Fit whole project" onClick={() => setZoom(1)} disabled={zoom === 1} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8a909c' }}>{fmt(playheadSec)} / {fmt(durationSec)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '62px minmax(0,1fr)', gap: 10, alignItems: 'start' }}>
          {/* fixed label column, aligned to each track row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: TRACK_GAP }}>
            {TRACK_LABELS.map((l) => (
              <div key={l} style={{ height: TRACK_H, display: 'flex', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', textTransform: 'uppercase' }}>{l}</div>
            ))}
          </div>
          {/* shared horizontal-scroll viewport: all tracks + playhead share one width so they stay in sync */}
          <div ref={scrollRef} onWheel={onWheel} style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden' }}>
            <div style={{ position: 'relative', width: `${zoom * 100}%`, minWidth: '100%', display: 'flex', flexDirection: 'column', gap: TRACK_GAP }}>
              <TrackBox onSeek={seekFromClick}>
                {visualBlocks.map((block) => {
                  const key = `${block.kind}:${block.id}`
                  return (
                    <Block
                      key={key}
                      block={block}
                      tone={block.kind === 'broll' ? 'broll' : 'visual'}
                      badge={block.badge}
                      active={activeKey === key}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect({ kind: block.kind, id: block.id })
                        onSeek(block.startSec)
                      }}
                    />
                  )
                })}
                {visualBlocks.length === 0 && <span style={{ position: 'absolute', left: 10, top: 7, fontSize: 10.5, color: '#5b616f' }}>No images yet</span>}
              </TrackBox>
              <TrackBox onSeek={seekFromClick}>
                {captionBlocks.map((block) => (
                  <Block key={block.id} block={block} tone="caption" active={activeKey === `caption:${block.id}`} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'caption', id: block.id }); onSeek(block.startSec) }} />
                ))}
                {captionBlocks.length === 0 && <span style={{ position: 'absolute', left: 10, top: 7, fontSize: 10.5, color: '#5b616f' }}>No transcript yet</span>}
              </TrackBox>
              <TrackBox onSeek={seekFromClick}>
                <Block block={{ id: 'look', label: project.lookLut && project.lookLut !== 'off' ? `${project.lookLut} ${Math.round((project.lookStrength ?? 0) * 100)}%` : 'Look off', startSec: 0, endSec: durationSec, ...rangeToPct(0, durationSec, durationSec) }} tone="look" active={selection.kind === 'look'} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'look' }); onSeek(0) }} />
              </TrackBox>
              <TrackBox onSeek={(e) => { seekFromClick(e); onSelect({ kind: 'audio' }) }}>
                <Waveform />
              </TrackBox>
              <span style={{ position: 'absolute', left: `${playhead}%`, top: 0, bottom: 0, width: 1, background: 'var(--accent)', boxShadow: '0 0 0 1px rgba(245,179,35,.25)', pointerEvents: 'none', zIndex: 5 }} />
            </div>
          </div>
        </div>
        <TimelineInspector project={project} images={images} broll={broll} words={words} selection={selection} />
      </div>
    </div>
  )
}

export type { EditorSelection }
