import type { MotionPreset, Project, ProjectImage, TranscriptWord } from '@shared/types'
import { LOOKS } from '@shared/looks'
import type { MouseEvent, ReactNode } from 'react'
import { useData } from '../../store/useData'
import { QUICK_CAPTION_PRESETS, captionPresetPatch } from './captionPresets'
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

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
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

function MiniButton({
  children,
  active,
  title,
  onClick
}: {
  children: ReactNode
  active?: boolean
  title?: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        border: active ? '1px solid var(--accent)' : '1px solid #23272f',
        color: active ? 'var(--accent)' : '#aab0bb',
        background: active ? 'var(--accent-soft)' : '#0b0d12',
        borderRadius: 7,
        padding: '6px 8px',
        fontSize: 10.5,
        fontWeight: 700,
        cursor: 'pointer',
        minHeight: 28
      }}
    >
      {children}
    </button>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '54px minmax(0,1fr)', alignItems: 'center', gap: 8, fontSize: 10.5, color: '#6a7180' }}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #23272f', borderRadius: 7, background: '#0b0d12', color: '#dde0e5', padding: '5px 7px', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}
      />
    </label>
  )
}

function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 10.5, color: '#6a7180' }}>
      {label}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', height: 30, border: '1px solid #23272f', borderRadius: 7, background: '#0b0d12', cursor: 'pointer' }}
      />
    </label>
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
  const setImageRanges = useData((s) => s.setImageRanges)
  const setCaptions = useData((s) => s.setCaptions)
  const setLook = useData((s) => s.setLook)
  const setMotion = useData((s) => s.setMotion)
  const setWordsEmphasis = useData((s) => s.setWordsEmphasis)
  const image = selection.kind === 'image' ? images.find((im) => im.id === selection.id) : undefined
  const word = selection.kind === 'caption' ? words.find((w) => w.id === selection.id) : undefined
  const durationSec = Math.max(0.05, project.durationSec || 0.05)
  const minSpan = Math.min(0.05, durationSec)
  const motionPreset: MotionPreset = project.motionPreset ?? (project.kenBurns ? 'subtle' : 'off')
  const selectedLook = LOOKS.find((look) => look.id === (project.lookLut ?? 'off')) ?? LOOKS[0]
  const lookStrength = selectedLook.id === 'off' ? 0 : clampValue(project.lookStrength ?? selectedLook.defaultStrength, 0, 1)
  const captionHighlightColor = /^#[0-9a-f]{6}$/i.test(project.captionHighlightColor ?? '') ? project.captionHighlightColor! : project.captionPreset === 'Submagic' ? '#111111' : '#ffd93d'
  const captionBoxColor = /^#[0-9a-f]{6}$/i.test(project.captionBoxColor ?? '') ? project.captionBoxColor! : '#ffd93d'
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
        ? `${selectedLook.name} · ${Math.round(lookStrength * 100)}%`
        : selection.kind === 'audio'
          ? `${fmt(project.durationSec)} narration`
          : `${project.captionAspect} · ${project.captionPreset} captions`
  const setImageRange = (rangeStart: number, rangeEnd: number): void => {
    if (!image) return
    const start = clampValue(rangeStart, 0, Math.max(0, durationSec - minSpan))
    const end = clampValue(rangeEnd, start + minSpan, durationSec)
    void setImageRanges([{ id: image.id, rangeStart: start, rangeEnd: end }])
  }
  const setImageDuration = (seconds: number): void => {
    if (!image) return
    const span = clampValue(seconds, minSpan, durationSec)
    const start = clampValue(image.rangeStart, 0, Math.max(0, durationSec - minSpan))
    setImageRange(start, start + span)
  }
  const selectCaptionPreset = (captionPreset: string): void => {
    void setCaptions(captionPresetPatch(project, captionPreset))
  }

  return (
    <div style={{ border: '1px solid #1d2129', borderRadius: 12, background: '#0e1116', padding: 12, minHeight: 112 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--accent)', marginBottom: 7 }}>SELECTION</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: '#eef0f3' }}>{title}</div>
      <div title={detail} className="me-ellipsis" style={{ marginTop: 5, fontSize: 11, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{detail}</div>
      {image && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <NumberField label="Start" value={image.rangeStart} min={0} max={Math.max(0, image.rangeEnd - minSpan)} step={0.05} onChange={(v) => setImageRange(v, image.rangeEnd)} />
          <NumberField label="End" value={image.rangeEnd} min={image.rangeStart + minSpan} max={durationSec} step={0.05} onChange={(v) => setImageRange(image.rangeStart, v)} />
          <NumberField label="Secs" value={Math.max(minSpan, image.rangeEnd - image.rangeStart)} min={minSpan} max={durationSec} step={0.05} onChange={setImageDuration} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
            {([
              { id: 'off', label: 'Static' },
              { id: 'subtle', label: 'Subtle' },
              { id: 'cinematic', label: 'Cinema' }
            ] as Array<{ id: MotionPreset; label: string }>).map((preset) => (
              <MiniButton key={preset.id} active={motionPreset === preset.id} onClick={() => void setMotion(preset.id)}>
                {preset.label}
              </MiniButton>
            ))}
          </div>
        </div>
      )}
      {word && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <MiniButton active={!!word.emphasis} onClick={() => void setWordsEmphasis([word.id], !word.emphasis)}>
            {word.emphasis ? 'Emphasis on' : 'Emphasis off'}
          </MiniButton>
          <ColorField label={project.captionPreset === 'Submagic' ? 'Text colour' : 'Highlight'} value={captionHighlightColor} onChange={(captionHighlightColor) => void setCaptions({ captionHighlightColor })} />
          {project.captionPreset === 'Submagic' && (
            <div style={{ border: '1px solid var(--accent)', borderRadius: 9, padding: 9, background: 'var(--accent-soft)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ColorField label="Box colour" value={captionBoxColor} onChange={(captionBoxColor) => void setCaptions({ captionBoxColor })} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
                {[1, 2, 3].map((n) => (
                  <MiniButton key={n} active={(project.captionWordsPerPage ?? 1) === n} onClick={() => void setCaptions({ captionWordsPerPage: n as 1 | 2 | 3 })}>
                    {n}
                  </MiniButton>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {selection.kind === 'look' && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <label style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 34px', alignItems: 'center', gap: 8, fontSize: 10.5, color: '#6a7180' }}>
            <span>Power</span>
            <input type="range" min={0} max={100} value={Math.round(lookStrength * 100)} onChange={(e) => void setLook({ lut: selectedLook.id === 'off' ? 'clean' : selectedLook.id, strength: clampValue(Number(e.target.value), 0, 100) / 100 })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--font-mono)', color: '#cdd2da', textAlign: 'right' }}>{Math.round(lookStrength * 100)}%</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 }}>
            {LOOKS.slice(0, 5).map((look) => (
              <MiniButton key={look.id} active={selectedLook.id === look.id} title={look.description} onClick={() => void setLook({ lut: look.id, strength: look.id === 'off' ? 0 : look.defaultStrength })}>
                {look.name}
              </MiniButton>
            ))}
          </div>
        </div>
      )}
      {selection.kind === 'audio' && (
        <div style={{ marginTop: 9, fontSize: 10.5, color: '#6a7180', lineHeight: 1.45 }}>
          The narration length anchors this project. Trim image segments or caption timing around it from the visual and captions tracks.
        </div>
      )}
      {selection.kind === 'project' && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
            {(['16:9', '1:1', '9:16'] as Project['captionAspect'][]).map((aspect) => (
              <MiniButton key={aspect} active={project.captionAspect === aspect} onClick={() => void setCaptions({ captionAspect: aspect })}>
                {aspect}
              </MiniButton>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 6 }}>
            {QUICK_CAPTION_PRESETS.map((preset) => (
              <MiniButton key={preset} active={project.captionPreset === preset} onClick={() => selectCaptionPreset(preset)}>
                {preset}
              </MiniButton>
            ))}
          </div>
        </div>
      )}
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
