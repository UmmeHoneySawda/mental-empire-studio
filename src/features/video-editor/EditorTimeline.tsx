import type { Project, ProjectImage, TranscriptWord } from '@shared/types'
import type { MouseEvent, ReactNode } from 'react'
import {
  buildCaptionTimeline,
  buildVisualTimeline,
  clampTimelineSec,
  rangeToPct,
  type EditorSelection,
  type TimelineBlock
} from './timelineModel'

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function selectionKey(selection: EditorSelection): string {
  return selection.kind === 'image' || selection.kind === 'caption' ? `${selection.kind}:${selection.id}` : selection.kind
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
  onClick
}: {
  block: TimelineBlock
  active: boolean
  tone: 'visual' | 'caption' | 'look'
  onClick: (e: MouseEvent) => void
}): JSX.Element {
  const colors = tone === 'caption'
    ? { bg: 'rgba(54,201,142,.13)', border: active ? '#36c98e' : 'rgba(54,201,142,.3)', text: active ? '#eafff5' : '#72d8aa' }
    : tone === 'look'
      ? { bg: 'rgba(139,124,255,.14)', border: active ? '#8b7cff' : 'rgba(139,124,255,.32)', text: active ? '#f1eeff' : '#b8afff' }
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
      {block.label}
    </button>
  )
}

function Inspector({
  project,
  images,
  words,
  selection
}: {
  project: Project
  images: ProjectImage[]
  words: TranscriptWord[]
  selection: EditorSelection
}): JSX.Element {
  const image = selection.kind === 'image' ? images.find((im) => im.id === selection.id) : undefined
  const word = selection.kind === 'caption' ? words.find((w) => w.id === selection.id) : undefined
  const title = image
    ? 'Image segment'
    : word
      ? 'Caption word'
      : selection.kind === 'look'
        ? 'Look span'
        : selection.kind === 'audio'
          ? 'Audio'
          : 'Project'
  const detail = image
    ? `${fmt(image.rangeStart)}-${fmt(image.rangeEnd)} · ${image.path.split(/[\\/]/).pop() || 'image'}`
    : word
      ? `${fmt(word.start)}-${fmt(word.end)} · ${word.emphasis ? 'emphasized' : 'normal'}`
      : selection.kind === 'look'
        ? `${project.lookLut ?? 'off'} · ${Math.round((project.lookStrength ?? 0) * 100)}%`
        : selection.kind === 'audio'
          ? `${fmt(project.durationSec)} narration`
          : `${project.captionAspect} · ${project.captionPreset} captions`
  const hint = image
    ? 'Open Audio + Image to reorder or change motion for this segment.'
    : word
      ? 'Open Captions to toggle emphasis, style, and Submagic box settings.'
      : selection.kind === 'look'
        ? 'Open Style to adjust look intensity, grade, overlay, motion, and B-roll.'
        : selection.kind === 'audio'
          ? 'Audio length drives the full timeline and render duration.'
          : 'Click a timeline block to edit that part of the video.'

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 12, background: '#0e1116', padding: 12, minHeight: 112 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--accent)', marginBottom: 7 }}>SELECTION</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: '#eef0f3' }}>{title}</div>
      <div title={detail} className="me-ellipsis" style={{ marginTop: 5, fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{detail}</div>
      <div style={{ marginTop: 9, fontSize: 10.5, color: '#6a7180', lineHeight: 1.4 }}>{hint}</div>
    </div>
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
  words,
  playheadSec,
  selection,
  onSeek,
  onSelect
}: {
  project: Project
  images: ProjectImage[]
  words: TranscriptWord[]
  playheadSec: number
  selection: EditorSelection
  onSeek: (sec: number) => void
  onSelect: (selection: EditorSelection) => void
}): JSX.Element {
  const durationSec = Math.max(0.05, project.durationSec || 0.05)
  const visualBlocks = buildVisualTimeline(images, durationSec)
  const captionBlocks = buildCaptionTimeline(words, durationSec)
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
            {visualBlocks.map((block) => (
              <Block key={block.id} block={block} tone="visual" active={activeKey === `image:${block.id}`} onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'image', id: block.id }); onSeek(block.startSec) }} />
            ))}
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
        <Inspector project={project} images={images} words={words} selection={selection} />
      </div>
    </div>
  )
}

export type { EditorSelection }
