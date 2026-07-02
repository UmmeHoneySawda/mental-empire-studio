import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import type { GpuRenderSpec } from '@shared/renderSpec'
import { useData } from '../../store/useData'
import { usePreviewCompositor } from './usePreviewCompositor'
import { CAPTION_PRESETS, captionPresetPatch, type CaptionPresetName } from './captionPresets'

function sampleStyle(preset: string): { bg: string; text: string; boxed: boolean } {
  if (preset === 'Submagic') return { bg: 'linear-gradient(135deg,#332817,#101216)', text: 'WORD', boxed: true }
  if (preset === 'Neon') return { bg: 'linear-gradient(135deg,#112b31,#15171d)', text: 'GLOW', boxed: false }
  if (preset === 'Minimal') return { bg: 'linear-gradient(135deg,#252b34,#111318)', text: 'clean', boxed: false }
  if (preset === 'Word') return { bg: 'linear-gradient(135deg,#1e2c38,#101216)', text: 'ONE', boxed: false }
  if (preset === 'Bold') return { bg: 'linear-gradient(135deg,#321d22,#12151b)', text: 'BOLD', boxed: false }
  if (preset === 'Pop') return { bg: 'linear-gradient(135deg,#222545,#12151b)', text: 'POP', boxed: false }
  return { bg: 'linear-gradient(135deg,#2d2818,#12151b)', text: 'NOT', boxed: false }
}

function CaptionSwatch({ preset, project, active, compact, refreshKey }: { preset: string; project: Project | null; active: boolean; compact: boolean; refreshKey: string }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [spec, setSpec] = useState<GpuRenderSpec | null>(null)
  usePreviewCompositor(canvasRef, spec, 0.8)

  useEffect(() => {
    let cancelled = false
    if (!project || !window.api?.compose?.previewSpec) {
      setSpec(null)
      return () => { cancelled = true }
    }
    void window.api.compose.previewSpec(project.id, captionPresetPatch(project, preset)).then((next) => {
      if (!cancelled) setSpec(next)
    }).catch(() => {
      if (!cancelled) setSpec(null)
    })
    return () => { cancelled = true }
  }, [
    preset,
    refreshKey,
    project?.id,
    project?.captionFont,
    project?.captionAnim,
    project?.captionAspect,
    project?.captionPosition,
    project?.captionHighlightColor,
    project?.captionBoxColor,
    project?.captionWordsPerPage
  ])

  const fallback = sampleStyle(preset)
  return (
    <div style={{ position: 'relative', height: compact ? 42 : 54, borderRadius: 7, overflow: 'hidden', background: fallback.bg, border: active ? '1px solid rgba(245,179,35,.65)' : '1px solid #252a34' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: spec ? 'block' : 'none' }} />
      {!spec && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: fallback.bg }}>
          <span style={{ borderRadius: fallback.boxed ? 6 : 0, padding: fallback.boxed ? '2px 7px' : 0, background: fallback.boxed ? '#ffd93d' : 'transparent', color: fallback.boxed ? '#111111' : '#ffffff', fontFamily: 'var(--font-display)', fontSize: compact ? 13 : 15, fontWeight: 900, textTransform: 'uppercase', textShadow: fallback.boxed ? 'none' : '0 2px 0 #000' }}>{fallback.text}</span>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.38))', pointerEvents: 'none' }} />
    </div>
  )
}

export function CaptionGallery({
  presets = CAPTION_PRESETS,
  compact = false
}: {
  presets?: readonly CaptionPresetName[]
  compact?: boolean
}): JSX.Element {
  const project = useData((s) => s.activeProject)
  const images = useData((s) => s.projectImages)
  const words = useData((s) => s.transcript)
  const setCaptions = useData((s) => s.setCaptions)
  const selected = project?.captionPreset ?? 'Hormozi'
  const cols = compact ? presets.length : Math.min(3, presets.length)
  const refreshKey = `${images.map((im) => `${im.id}:${im.path}:${im.thumb}`).join('|')}|${words.length}:${words[0]?.id ?? ''}:${words[0]?.word ?? ''}:${words[words.length - 1]?.id ?? ''}`

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols},minmax(0,1fr))`, gap: compact ? 6 : 8 }}>
      {presets.map((preset) => {
        const active = selected === preset
        return (
          <button
            key={preset}
            type="button"
            disabled={!project}
            onClick={() => void setCaptions(captionPresetPatch(project, preset))}
            style={{
              textAlign: 'left',
              border: active ? '1px solid var(--accent)' : '1px solid #23272f',
              color: active ? '#f2f4f7' : '#8a909c',
              background: active ? 'rgba(245,179,35,.08)' : '#0e1116',
              borderRadius: 8,
              padding: compact ? 6 : 7,
              cursor: project ? 'pointer' : 'not-allowed',
              opacity: project ? 1 : 0.55
            }}
          >
            <CaptionSwatch preset={preset} project={project} active={active} compact={compact} refreshKey={refreshKey} />
            <div style={{ marginTop: compact ? 5 : 6, fontSize: compact ? 10.5 : 11.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{preset}</div>
          </button>
        )
      })}
    </div>
  )
}
