import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Btn } from '../../../components/ui/kit'
import { useVideoStudio } from '../store/useVideoStudio'
import { useTimecode } from '../ui/kit'

/* Both players are loaded lazily. The Remotion bundle in particular is large, and a
   user who never opens a renderer engine should never pay for it. */
const RemotionPreview = lazy(() =>
  import('./RemotionPreview').then((module) => ({ default: module.RemotionPreview })))
const HyperframesPreview = lazy(() =>
  import('./HyperframesPreview').then((module) => ({ default: module.HyperframesPreview })))

/** Fits the canvas inside the available box without ever overflowing it, so a
 *  1080×1920 vertical project and a 1920×1080 landscape one both read correctly. */
function useFittedSize(width: number, height: number): { ref: (node: HTMLDivElement | null) => void; size: { width: number; height: number } } {
  const [box, setBox] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver>()

  // Both halves matter: the callback has to be stable or React re-attaches it every
  // render, and the update has to be value-compared or a new object re-renders on
  // every observation. Either alone still loops.
  const measure = useCallback((next: { width: number; height: number }) => {
    setBox((current) =>
      Math.abs(current.width - next.width) < 1 && Math.abs(current.height - next.height) < 1
        ? current
        : next
    )
  }, [])

  const ref = useCallback((node: HTMLDivElement | null): void => {
    observer.current?.disconnect()
    if (!node) return
    observer.current = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) measure({ width: rect.width, height: rect.height })
    })
    observer.current.observe(node)
    measure({ width: node.clientWidth, height: node.clientHeight })
  }, [measure])

  useEffect(() => () => observer.current?.disconnect(), [])

  const size = useMemo(() => {
    if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return { width: 0, height: 0 }
    const scale = Math.min(box.width / width, box.height / height)
    return { width: Math.floor(width * scale), height: Math.floor(height * scale) }
  }, [box.width, box.height, width, height])

  return { ref, size }
}

export function PreviewStage(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const preview = useVideoStudio((state) => state.preview)
  const previewStale = useVideoStudio((state) => state.previewStale)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const playing = useVideoStudio((state) => state.playing)
  const busy = useVideoStudio((state) => state.busy)
  const loadPreview = useVideoStudio((state) => state.loadPreview)
  const setPlayhead = useVideoStudio((state) => state.setPlayhead)
  const setPlaying = useVideoStudio((state) => state.setPlaying)

  const fps = project?.canvas.fps ?? 30
  const total = project?.canvas.durationFrames ?? 1
  const timecode = useTimecode(fps)
  const { ref, size } = useFittedSize(project?.canvas.width ?? 16, project?.canvas.height ?? 9)

  return (
    <div className="vs-preview">
      <div className="vs-preview-frame" ref={ref}>
        {!project ? (
          <div className="vs-preview-empty">Open a clip to start editing.</div>
        ) : !preview ? (
          <div className="vs-preview-empty">
            <span>Nothing is staged yet. Building a preview runs the real composition, so it takes a moment on the first pass.</span>
            <Btn variant="soft" size="sm" disabled={!!busy} onClick={() => void loadPreview()}>
              {busy === 'Building the preview' ? 'Building the preview…' : 'Build preview'}
            </Btn>
          </div>
        ) : (
          <div
            className="vs-preview-shell"
            style={{
              width: size.width || undefined,
              height: size.height || undefined,
              // The HyperFrames iframe renders at the composition's own pixel size and
              // scales down, so its type stays crisp instead of being laid out tiny.
              ['--hf-preview-scale' as string]: project.canvas.width > 0 ? size.width / project.canvas.width : 1
            }}
          >
            <Suspense fallback={<div className="vs-preview-empty" style={{ padding: 20 }}>Starting the player…</div>}>
              {preview.kind === 'remotion' ? (
                <RemotionPreview
                  project={preview.project}
                  durationInFrames={preview.durationInFrames}
                  frame={playheadFrame}
                  playing={playing}
                  onFrame={setPlayhead}
                  onPlayingChange={setPlaying}
                />
              ) : (
                <HyperframesPreview
                  payload={preview}
                  frame={playheadFrame}
                  playing={playing}
                  onFrame={setPlayhead}
                  onPlayingChange={setPlaying}
                />
              )}
            </Suspense>
          </div>
        )}
      </div>

      <div className="vs-preview-bar">
        <Btn
          variant={playing ? 'soft' : 'ghost'}
          size="sm"
          disabled={!preview}
          title={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? '❙❙ Pause' : '▶ Play'}
        </Btn>
        <input
          className="vs-scrub"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          step={1}
          value={Math.min(playheadFrame, Math.max(0, total - 1))}
          disabled={!project}
          aria-label="Playhead"
          onChange={(event) => setPlayhead(Number(event.target.value))}
        />
        <span className="vs-mono" style={{ flex: 'none' }}>
          {timecode(playheadFrame)} · {playheadFrame}/{total}f
        </span>
        {preview && previewStale && (
          <Btn variant="soft" size="sm" disabled={!!busy} onClick={() => void loadPreview()}>
            {busy === 'Building the preview' ? 'Refreshing…' : 'Refresh preview'}
          </Btn>
        )}
        {preview?.kind === 'hyperframes' && preview.warnings.length > 0 && (
          <span className="vs-pill vs-pill--warn" title={preview.warnings.join('\n')}>
            {preview.warnings.length} lint warning{preview.warnings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}
