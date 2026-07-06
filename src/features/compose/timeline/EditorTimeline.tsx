import type { Project, ProjectImage, TranscriptWord } from '@shared/types'
import type { GpuBrollSegment } from '@shared/renderSpec'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
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

function Track({
  label,
  children,
  playheadPct,
  onSeek
}: {
  label: string
  children: ReactNode
  playheadPct: number
  onSeek: (e: MouseEvent<HTMLDivElement>) => void
}): JSX.Element {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '62px minmax(0,1fr)', alignItems: 'center', gap: 10 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: '#5b616f', textTransform: 'uppercase' }}>{label}</div>
      <div onClick={onSeek} style={{ position: 'relative', height: 28, border: '1px solid #1d2129', borderRadius: 8, background: '#0b0d12', overflow: 'hidden', cursor: 'crosshair' }}>
        {children}
        <span style={{ position: 'absolute', left: `${playheadPct}%`, top: 0, bottom: 0, width: 1, background: 'var(--accent)', boxShadow: '0 0 0 1px rgba(245,179,35,.25)', pointerEvents: 'none', zIndex: 5 }} />
      </div>
    </div>
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

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', marginBottom: 20, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: 'var(--accent)' }}>CUSTOMIZE</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: '#eef0f3' }}>Timeline</div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8a909c' }}>{fmt(playheadSec)} / {fmt(durationSec)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 14, alignItems: 'start' }}>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Track label="Visual" playheadPct={playhead} onSeek={seekFromClick}>
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
          </Track>
          <Track label="Captions" playheadPct={playhead} onSeek={seekFromClick}>
            {captionBlocks.map((block) => (
              <Block key={block.id} block={block} tone="caption" active={activeKey === `caption:${block.id}`} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'caption', id: block.id }); onSeek(block.startSec) }} />
            ))}
            {captionBlocks.length === 0 && <span style={{ position: 'absolute', left: 10, top: 7, fontSize: 10.5, color: '#5b616f' }}>No transcript yet</span>}
          </Track>
          <Track label="Look" playheadPct={playhead} onSeek={seekFromClick}>
            <Block block={{ id: 'look', label: project.lookLut && project.lookLut !== 'off' ? `${project.lookLut} ${Math.round((project.lookStrength ?? 0) * 100)}%` : 'Look off', startSec: 0, endSec: durationSec, ...rangeToPct(0, durationSec, durationSec) }} tone="look" active={selection.kind === 'look'} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'look' }); onSeek(0) }} />
          </Track>
          <Track label="Audio" playheadPct={playhead} onSeek={(e) => { seekFromClick(e); onSelect({ kind: 'audio' }) }}>
            <Waveform />
          </Track>
        </div>
        <TimelineInspector project={project} images={images} broll={broll} words={words} selection={selection} />
      </div>
    </div>
  )
}

export type { EditorSelection }
