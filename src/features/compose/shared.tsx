import type { BetaVideoOpts, Project, ProjectImage, TranscriptWord } from '@shared/types'
import type { GpuBrollSegment } from '@shared/renderSpec'
import type { EditorSelection } from './timeline/timelineModel'

export const IMG_GRADS = ['linear-gradient(135deg,#2a2540,#46243a)', 'linear-gradient(135deg,#1a2e3a,#0f3a32)', 'linear-gradient(135deg,#23304a,#1a2438)', 'linear-gradient(135deg,#2e2440,#3a1f2e)']
export const CAPTION_ASPECTS: Project['captionAspect'][] = ['16:9', '1:1', '9:16']
export const CAPTION_LINES: Array<NonNullable<Project['captionLines']>> = [1, 2, 3]
export const CAPTION_POSITIONS: Array<NonNullable<Project['captionPosition']>> = ['bottom', 'middle', 'top']
export const CAPTION_PACES: Array<{ value: NonNullable<Project['captionPace']>; label: string; help: string }> = [
  { value: 'auto', label: 'Auto', help: 'Studio picks the best timing for this video length.' },
  { value: 'word', label: 'Word by word', help: 'Each spoken word highlights as it is said.' },
  { value: 'phrase', label: 'Steady pages', help: 'Captions change in calmer chunks for long videos.' }
]

export function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDuration(sec?: number): string {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function overlayBackground(o?: BetaVideoOpts['overlay']): string {
  if (!o) return 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.42))'
  const intensity = Math.max(0, Math.min(100, o.intensity ?? 50))
  if (intensity === 0 || (!o.bottom && !o.top && !o.left && !o.right)) return 'transparent'
  const alpha = (0.08 + (intensity / 100) * 0.42).toFixed(3)
  const stop = `${Math.round(36 + (intensity / 100) * 28)}%`
  const edges: string[] = []
  if (o.bottom) edges.push(`linear-gradient(180deg,rgba(0,0,0,0) ${100 - parseInt(stop, 10)}%,rgba(0,0,0,${alpha}) 100%)`)
  if (o.top) edges.push(`linear-gradient(0deg,rgba(0,0,0,0) ${100 - parseInt(stop, 10)}%,rgba(0,0,0,${alpha}) 100%)`)
  if (o.left) edges.push(`linear-gradient(90deg,rgba(0,0,0,${alpha}) 0%,rgba(0,0,0,0) ${stop})`)
  if (o.right) edges.push(`linear-gradient(270deg,rgba(0,0,0,${alpha}) 0%,rgba(0,0,0,0) ${stop})`)
  return edges.join(',')
}

export function editorSelectionLabel(selection: EditorSelection, images: ProjectImage[], words: TranscriptWord[], broll: GpuBrollSegment[], project?: Project | null): string {
  if (selection.kind === 'image') {
    const image = images.find((im) => im.id === selection.id)
    return image ? `Image · ${fmt(image.rangeStart)}-${fmt(image.rangeEnd)}` : 'Image segment'
  }
  if (selection.kind === 'broll') {
    const index = Number(selection.id.replace(/^broll-/, ''))
    const segment = Number.isFinite(index) ? broll[index] : undefined
    return segment ? `B-roll · ${fmt(segment.startSec)}-${fmt(segment.endSec)}` : 'B-roll segment'
  }
  if (selection.kind === 'caption') {
    const word = words.find((w) => w.id === selection.id)
    return word ? `Caption · ${word.word}` : 'Caption word'
  }
  if (selection.kind === 'look') return `Look · ${project?.lookLut ?? 'off'}`
  if (selection.kind === 'audio') return 'Audio track'
  return 'Project defaults'
}

export function chip(text: string, on: boolean, onClick?: () => void, key?: string) {
  return <span key={key} onClick={onClick} style={{ border: on ? '1px solid var(--accent)' : '1px solid #23272f', color: on ? 'var(--accent)' : '#8a909c', borderRadius: 7, padding: '5px 9px', background: on ? 'var(--accent-soft)' : 'transparent', cursor: onClick ? 'pointer' : undefined }}>{text}</span>
}

export function MiniToggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return <div onClick={onClick} style={{ width: 32, height: 18, borderRadius: 11, background: on ? 'var(--accent)' : '#2b303b', position: 'relative', cursor: 'pointer', flex: 'none' }}><span style={{ position: 'absolute', top: 2, right: on ? 2 : 16, width: 14, height: 14, borderRadius: '50%', background: '#fff' }} /></div>
}

/** Shared beta toggle row (used by StyleTab + AdvancedTab). */
export function BetaRow({ label, on, set, hint }: { label: string; on: boolean; set: () => void; hint?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1 }}><div style={{ fontSize: 11.5, color: '#cdd2da' }}>{label}</div>{hint && <div style={{ fontSize: 9.5, color: '#6a7180' }}>{hint}</div>}</div>
      <MiniToggle on={on} onClick={set} />
    </div>
  )
}

export function BetaHeader(): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: '#5b616f' }}>CUSTOMIZE</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 9, padding: '1px 6px' }}>VIDEO FX</span>
    </div>
  )
}
