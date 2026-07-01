import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import { useData } from '../../store/useData'
import { usePreviewCompositor } from './usePreviewCompositor'
import { videoSrc } from '../../lib/media'

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function TransportButton({ label, title, disabled, onClick }: { label: string; title: string; disabled?: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="me-btn"
      style={{ width: 32, height: 28, border: '1px solid #262b34', borderRadius: 7, background: '#15181f', color: disabled ? '#4f5662' : '#cdd2da', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {label}
    </button>
  )
}

export function PreviewCanvas(): JSX.Element | null {
  const videoEditorV2 = useStore((s) => s.settings.features.videoEditorV2)
  const project = useData((s) => s.activeProject)
  const images = useData((s) => s.projectImages)
  const transcript = useData((s) => s.transcript)
  const spec = useData((s) => s.previewSpec)
  const previewLoading = useData((s) => s.previewLoading)
  const previewError = useData((s) => s.previewError)
  const loadPreviewSpec = useData((s) => s.loadPreviewSpec)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playheadSec, setPlayheadSec] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fallbackPath, setFallbackPath] = useState('')
  const [fallbackState, setFallbackState] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle')
  const [fallbackError, setFallbackError] = useState('')
  const [fallbackForKey, setFallbackForKey] = useState('')
  const { status, error } = usePreviewCompositor(canvasRef, spec, playheadSec)

  const projectKey = useMemo(() => {
    if (!project) return ''
    return [
      project.id,
      project.durationSec,
      project.captionPreset,
      project.captionFont,
      project.captionAnim,
      project.captionAspect,
      project.captionLines,
      project.captionPosition,
      project.captionPace,
      project.kenBurns,
      project.punchZoom,
      project.keywords,
      JSON.stringify(project.betaOpts ?? {})
    ].join('|')
  }, [project])
  const imagesKey = useMemo(() => images.map((im) => `${im.id}:${im.path}:${im.thumb}:${im.rangeStart}:${im.rangeEnd}`).join('|'), [images])
  const transcriptKey = useMemo(() => transcript.map((w) => `${w.id}:${w.word}:${w.start}:${w.end}:${w.emphasis ? 1 : 0}`).join('|'), [transcript])
  const durationSec = Math.max(0.05, spec?.durationSec ?? project?.durationSec ?? 0.05)
  const canDraw = !!project && !!spec && status !== 'error'

  useEffect(() => {
    if (!videoEditorV2 || !project) return
    void loadPreviewSpec(project.id)
  }, [videoEditorV2, project?.id, projectKey, imagesKey, transcriptKey, loadPreviewSpec])

  const fallbackKey = `${project?.id ?? ''}|${projectKey}|${imagesKey}|${transcriptKey}`
  useEffect(() => {
    setFallbackPath('')
    setFallbackState('idle')
    setFallbackError('')
    setFallbackForKey('')
  }, [fallbackKey])

  useEffect(() => {
    if (!videoEditorV2 || !project || !/webgl2/i.test(error) || fallbackForKey === fallbackKey || fallbackState === 'rendering') return
    let cancelled = false
    setFallbackForKey(fallbackKey)
    setFallbackState('rendering')
    setFallbackError('')
    const preview = window.api?.compose.preview
    if (!preview) {
      setFallbackState('error')
      setFallbackError('Backend preview is unavailable.')
      return
    }
    void preview(project.id).then((path) => {
      if (cancelled) return
      setFallbackPath(path)
      setFallbackState('ready')
    }).catch((e) => {
      if (cancelled) return
      setFallbackPath('')
      setFallbackError((e as Error).message)
      setFallbackState('error')
    })
    return () => { cancelled = true }
  }, [videoEditorV2, project?.id, project, error, fallbackKey, fallbackForKey, fallbackState])

  useEffect(() => {
    setPlayheadSec((t) => Math.min(t, durationSec))
  }, [durationSec])

  useEffect(() => {
    if (!playing || !canDraw) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      setPlayheadSec((t) => {
        const next = t + dt
        if (next >= durationSec) {
          setPlaying(false)
          return durationSec
        }
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, canDraw, durationSec])

  if (!videoEditorV2) return null

  const statusText = previewLoading || status === 'loading'
    ? 'Building preview'
    : fallbackState === 'rendering'
      ? 'Backend preview'
      : fallbackState === 'ready'
        ? 'Backend preview ready'
        : (previewError || fallbackError || error)
          ? 'Preview unavailable'
          : spec?.broll?.length
            ? 'Live still preview · B-roll poster'
            : 'Live still preview'
  const fallbackMediaSrc = videoSrc(fallbackPath)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 680px) minmax(220px, 1fr)', gap: 16, alignItems: 'stretch', marginBottom: 20 }}>
      <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#0c0d11', overflow: 'hidden' }}>
        <div style={{ position: 'relative', aspectRatio: spec ? `${spec.width}/${spec.height}` : '16/9', background: '#080a0e', display: 'grid', placeItems: 'center' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: fallbackMediaSrc ? 'none' : 'block' }} />
          {fallbackMediaSrc && <video src={fallbackMediaSrc} muted loop playsInline controls style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#080a0e' }} />}
          {!project && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 12, color: '#5b616f' }}>Choose a downloaded clip to preview.</div>}
          {(previewLoading || status === 'loading' || fallbackState === 'rendering') && <div style={{ position: 'absolute', right: 12, top: 12, border: '1px solid rgba(245,179,35,.35)', borderRadius: 999, padding: '3px 8px', fontSize: 10, color: '#f5b323', background: 'rgba(8,10,14,.78)' }}>{fallbackState === 'rendering' ? 'Fallback' : 'Loading'}</div>}
          {(previewError || fallbackError || (error && fallbackState !== 'rendering' && !fallbackMediaSrc)) && <div title={previewError || fallbackError || error} style={{ position: 'absolute', left: 12, right: 12, bottom: 12, border: '1px solid #5a2530', borderRadius: 9, padding: '8px 10px', fontSize: 11, color: '#ff8a96', background: 'rgba(20,10,14,.86)' }}>{previewError || fallbackError || error}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid #1d2129' }}>
          <TransportButton label="|<" title="Start" disabled={!canDraw} onClick={() => setPlayheadSec(0)} />
          <TransportButton label="<" title="Back 1 second" disabled={!canDraw} onClick={() => setPlayheadSec((t) => Math.max(0, t - 1))} />
          <TransportButton label={playing ? 'II' : '>'} title={playing ? 'Pause' : 'Play timing preview'} disabled={!canDraw} onClick={() => setPlaying((p) => !p)} />
          <TransportButton label=">" title="Forward 1 second" disabled={!canDraw} onClick={() => setPlayheadSec((t) => Math.min(durationSec, t + 1))} />
          <TransportButton label=">|" title="End" disabled={!canDraw} onClick={() => setPlayheadSec(durationSec)} />
          <input
            type="range"
            min={0}
            max={Math.max(1, durationSec)}
            step={1 / Math.max(1, spec?.fps ?? 24)}
            value={Math.min(playheadSec, durationSec)}
            disabled={!canDraw}
            onChange={(e) => setPlayheadSec(Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--accent)', cursor: canDraw ? 'pointer' : 'not-allowed' }}
          />
          <span style={{ width: 86, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#8a909c' }}>{fmt(playheadSec)} / {fmt(durationSec)}</span>
        </div>
      </div>
      <div style={{ border: '1px solid #1d2129', borderRadius: 14, background: '#12151b', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '.6px', color: 'var(--accent)', marginBottom: 6 }}>LIVE PREVIEW</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: '#eef0f3', lineHeight: 1.15 }}>Frame preview</div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ border: '1px solid #262b34', borderRadius: 999, padding: '3px 8px', fontSize: 10, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{spec ? `${spec.width}x${spec.height}` : 'no spec'}</span>
          <span style={{ border: '1px solid #262b34', borderRadius: 999, padding: '3px 8px', fontSize: 10, color: status === 'ready' ? '#36c98e' : '#8a909c', fontFamily: 'var(--font-mono)' }}>{statusText}</span>
          {spec?.grade.style && <span style={{ border: '1px solid #262b34', borderRadius: 999, padding: '3px 8px', fontSize: 10, color: '#aab0bb', fontFamily: 'var(--font-mono)' }}>{spec.grade.style}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11.5, color: '#8a909c' }}>
          <div style={{ border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><b style={{ color: '#cdd2da' }}>{spec?.images.length ?? 0}</b><br />image windows</div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><b style={{ color: '#cdd2da' }}>{spec?.captions.groups.length ?? 0}</b><br />caption groups</div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><b style={{ color: '#cdd2da' }}>{spec?.motion.kenBurns ? 'On' : 'Off'}</b><br />motion</div>
          <div style={{ border: '1px solid #1d2129', borderRadius: 9, padding: 9, background: '#0e1116' }}><b style={{ color: '#cdd2da' }}>{spec?.overlayPath ? 'On' : 'Off'}</b><br />overlay</div>
        </div>
      </div>
    </div>
  )
}
