import type { ProjectImage, TranscriptWord } from '@shared/types'
import type { GpuBrollSegment } from '@shared/renderSpec'

export type EditorSelection =
  | { kind: 'project' }
  | { kind: 'image'; id: string }
  | { kind: 'broll'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'look' }
  | { kind: 'audio' }

export interface TimelineBlock {
  id: string
  label: string
  startSec: number
  endSec: number
  leftPct: number
  widthPct: number
}

export interface VisualTimelineBlock extends TimelineBlock {
  kind: 'image' | 'broll'
  badge?: string
}

export function clampTimelineSec(value: number, durationSec: number): number {
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const n = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(duration, n))
}

export function rangeToPct(startSec: number, endSec: number, durationSec: number): { leftPct: number; widthPct: number } {
  const duration = Math.max(0.001, Number.isFinite(durationSec) ? durationSec : 0.001)
  const minSpan = Math.min(0.05, duration)
  const start = Math.min(clampTimelineSec(startSec, duration), Math.max(0, duration - minSpan))
  const end = Math.min(duration, Math.max(start + minSpan, clampTimelineSec(endSec, duration)))
  const leftPct = Math.max(0, Math.min(100, (start / duration) * 100))
  return {
    leftPct,
    widthPct: Math.max(0.35, Math.min(100 - leftPct, ((end - start) / duration) * 100))
  }
}

export function buildVisualTimeline(images: ProjectImage[], durationSec: number): VisualTimelineBlock[] {
  return images.map((image, index) => {
    const duration = Math.max(0.001, durationSec)
    const startSec = Math.min(clampTimelineSec(image.rangeStart, duration), Math.max(0, duration - 0.05))
    const endSec = Math.min(duration, Math.max(startSec + 0.05, clampTimelineSec(image.rangeEnd, duration)))
    const pct = rangeToPct(startSec, endSec, durationSec)
    const filename = image.path.split(/[\\/]/).pop() || `Image ${index + 1}`
    return {
      id: image.id,
      label: filename,
      kind: 'image',
      startSec,
      endSec,
      ...pct
    }
  })
}

export function buildBrollTimeline(segments: GpuBrollSegment[] | undefined, durationSec: number): VisualTimelineBlock[] {
  return (segments ?? []).map((segment, index) => {
    const duration = Math.max(0.001, durationSec)
    const startSec = Math.min(clampTimelineSec(segment.startSec, duration), Math.max(0, duration - 0.05))
    const endSec = Math.min(duration, Math.max(startSec + 0.05, clampTimelineSec(segment.endSec, duration)))
    const pct = rangeToPct(startSec, endSec, durationSec)
    const filename = segment.path.split(/[\\/]/).pop() || `B-roll ${index + 1}`
    return {
      id: `broll-${index}`,
      label: filename,
      kind: 'broll',
      badge: 'video',
      startSec,
      endSec,
      ...pct
    }
  })
}

export function buildCaptionTimeline(words: TranscriptWord[], durationSec: number): TimelineBlock[] {
  return words.map((word) => {
    const duration = Math.max(0.001, durationSec)
    const startSec = Math.min(clampTimelineSec(word.start, duration), Math.max(0, duration - 0.05))
    const endSec = Math.min(duration, Math.max(startSec + 0.05, clampTimelineSec(word.end || word.start + 0.25, duration)))
    return {
      id: word.id,
      label: word.word,
      startSec,
      endSec,
      ...rangeToPct(startSec, endSec, durationSec)
    }
  })
}
