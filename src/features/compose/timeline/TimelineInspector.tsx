import type { MotionDirection, MotionPreset, Project, ProjectImage, TranscriptWord } from '@shared/types'
import type { GpuBrollSegment } from '@shared/renderSpec'
import { LOOKS } from '@shared/looks'
import type { ReactNode } from 'react'
import { useData } from '../../../store/useData'
import { QUICK_CAPTION_PRESETS, captionPresetPatch } from '../gallery/captionPresets'
import type { EditorSelection } from './timelineModel'

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

const MOTION_DIRECTIONS: Array<{ id: MotionDirection | null; label: string; title: string }> = [
  { id: null, label: 'Auto', title: 'Seeded direction for this image' },
  { id: 'push', label: 'In', title: 'Zoom in' },
  { id: 'pull', label: 'Out', title: 'Zoom out' },
  { id: 'left', label: 'Left', title: 'Pan left' },
  { id: 'right', label: 'Right', title: 'Pan right' },
  { id: 'up', label: 'Up', title: 'Pan up' },
  { id: 'down', label: 'Down', title: 'Pan down' }
]

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

export function TimelineInspector({
  project,
  images,
  broll,
  words,
  selection
}: {
  project: Project
  images: ProjectImage[]
  broll: GpuBrollSegment[]
  words: TranscriptWord[]
  selection: EditorSelection
}): JSX.Element {
  const setImageRanges = useData((s) => s.setImageRanges)
  const setCaptions = useData((s) => s.setCaptions)
  const setLook = useData((s) => s.setLook)
  const setImageMotion = useData((s) => s.setImageMotion)
  const setWordsEmphasis = useData((s) => s.setWordsEmphasis)
  const image = selection.kind === 'image' ? images.find((im) => im.id === selection.id) : undefined
  const brollIndex = selection.kind === 'broll' ? Number(selection.id.replace(/^broll-/, '')) : -1
  const brollSegment = brollIndex >= 0 ? broll[brollIndex] : undefined
  const word = selection.kind === 'caption' ? words.find((w) => w.id === selection.id) : undefined
  const durationSec = Math.max(0.05, project.durationSec || 0.05)
  const minSpan = Math.min(0.05, durationSec)
  const projectMotionPreset: MotionPreset = project.motionPreset ?? (project.kenBurns ? 'subtle' : 'off')
  const imageMotionPreset: MotionPreset = image?.motionPreset ?? projectMotionPreset
  const imageMotionDirection = image?.motionDirection ?? null
  const imageMotionAmount = clampValue(image?.motionAmount ?? 50, 0, 100)
  const selectedLook = LOOKS.find((look) => look.id === (project.lookLut ?? 'off')) ?? LOOKS[0]
  const lookStrength = selectedLook.id === 'off' ? 0 : clampValue(project.lookStrength ?? selectedLook.defaultStrength, 0, 1)
  const captionHighlightColor = /^#[0-9a-f]{6}$/i.test(project.captionHighlightColor ?? '') ? project.captionHighlightColor! : project.captionPreset === 'Submagic' ? '#111111' : '#ffd93d'
  const captionBoxColor = /^#[0-9a-f]{6}$/i.test(project.captionBoxColor ?? '') ? project.captionBoxColor! : '#ffd93d'
  const title = image
    ? 'Image segment'
    : brollSegment
      ? 'B-roll segment'
    : word
      ? 'Caption word'
      : selection.kind === 'look'
        ? 'Look span'
        : selection.kind === 'audio'
          ? 'Audio'
          : 'Project'
  const detail = image
    ? `${fmt(image.rangeStart)}-${fmt(image.rangeEnd)} · ${image.path.split(/[\\/]/).pop() || 'image'}`
    : brollSegment
      ? `${fmt(brollSegment.startSec)}-${fmt(brollSegment.endSec)} · ${brollSegment.path.split(/[\\/]/).pop() || 'video'}`
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
            <MiniButton active={image.motionPreset == null} title={`Inherit project motion: ${projectMotionPreset}`} onClick={() => void setImageMotion([{ id: image.id, motionPreset: null, motionDirection: null, motionAmount: null }])}>
              Auto
            </MiniButton>
            {([
              { id: 'off', label: 'Static' },
              { id: 'subtle', label: 'Subtle' },
              { id: 'cinematic', label: 'Cinema' }
            ] as Array<{ id: MotionPreset; label: string }>).map((preset) => (
              <MiniButton key={preset.id} active={image.motionPreset != null && imageMotionPreset === preset.id} onClick={() => void setImageMotion([{ id: image.id, motionPreset: preset.id }])}>
                {preset.label}
              </MiniButton>
            ))}
          </div>
          {imageMotionPreset !== 'off' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }}>
                {MOTION_DIRECTIONS.map((direction) => (
                  <MiniButton
                    key={direction.id ?? 'auto'}
                    active={direction.id === imageMotionDirection}
                    title={direction.title}
                    onClick={() => void setImageMotion([{ id: image.id, motionDirection: direction.id }])}
                  >
                    {direction.label}
                  </MiniButton>
                ))}
              </div>
              <label style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 34px', alignItems: 'center', gap: 8, fontSize: 10.5, color: '#6a7180' }}>
                <span>Amount</span>
                <input type="range" min={0} max={100} value={Math.round(imageMotionAmount)} onChange={(e) => void setImageMotion([{ id: image.id, motionAmount: Number(e.target.value) }])} style={{ width: '100%', accentColor: 'var(--accent)' }} />
                <span style={{ fontFamily: 'var(--font-mono)', color: '#cdd2da', textAlign: 'right' }}>{Math.round(imageMotionAmount)}</span>
              </label>
            </>
          )}
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
      {brollSegment && (
        <div style={{ marginTop: 11, border: '1px solid #20334a', borderRadius: 9, padding: 9, background: 'rgba(64,169,255,.08)', fontSize: 10.5, color: '#8fcaff', lineHeight: 1.45 }}>
          The live preview uses a cached poster frame for this video segment. B-roll pool, density, and on/off controls stay in the project video effects panel.
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
