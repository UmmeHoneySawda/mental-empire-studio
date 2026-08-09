import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { timecode } from './constants'
import { gradeFilter, gradeTintLayer, gradeVignetteLayer } from './gradePreview'
import { useEditor } from './useEditor'
import { ChevronDown, Maximize2, Pause, Play, StepBack, StepForward } from 'lucide-react'
import { EditorIconButton } from './EditorChrome'
import { previewAspectLabel } from './editorUiModel'

const EditorPlayer = lazy(() =>
  import('./EditorPlayer').then((module) => ({ default: module.EditorPlayer })))

function useFittedSize(width: number, height: number): {
  ref: (node: HTMLDivElement | null) => void
  size: { width: number; height: number }
} {
  const [box, setBox] = useState({ width: 0, height: 0 })
  const observer = useRef<ResizeObserver>()

  const measure = useCallback((next: { width: number; height: number }) => {
    setBox((current) =>
      Math.abs(current.width - next.width) < 1 && Math.abs(current.height - next.height) < 1
        ? current
        : next
    )
  }, [])

  const ref = useCallback(
    (node: HTMLDivElement | null): void => {
      observer.current?.disconnect()
      if (!node) return
      observer.current = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect
        if (rect) measure({ width: rect.width, height: rect.height })
      })
      observer.current.observe(node)
      measure({ width: node.clientWidth, height: node.clientHeight })
    },
    [measure]
  )

  useEffect(() => () => observer.current?.disconnect(), [])

  const size = useMemo(() => {
    if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return { width: 0, height: 0 }
    const scale = Math.min(box.width / width, box.height / height)
    return { width: Math.floor(width * scale), height: Math.floor(height * scale) }
  }, [box.width, box.height, width, height])

  return { ref, size }
}

export function PreviewStage(): JSX.Element {
  const project = useEditor((state) => state.project)
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const playing = useEditor((state) => state.playing)
  const loopRange = useEditor((state) => state.loopRange)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const setPlaying = useEditor((state) => state.setPlaying)
  const setLoopRange = useEditor((state) => state.setLoopRange)
  const soloSelection = useEditor((state) => state.soloSelection)
  const canSolo = useEditor((state) => state.selection.kind === 'clip')
  const dirty = useEditor((state) => state.dirty)
  const saving = useEditor((state) => state.saving)

  const fps = project?.canvas.fps ?? 30
  const total = Math.max(1, project?.canvas.durationFrames ?? 1)
  const { ref, size } = useFittedSize(project?.canvas.width ?? 16, project?.canvas.height ?? 9)

  const grading = project?.grading
  const filter = useMemo(() => gradeFilter(grading), [grading])
  const tint = useMemo(() => gradeTintLayer(grading), [grading])
  const vignette = useMemo(() => gradeVignetteLayer(grading), [grading])

  const rangeStart = loopRange ? Math.max(0, Math.min(loopRange.startFrame, total - 1)) : 0
  const rangeEnd = loopRange ? Math.max(rangeStart + 1, Math.min(loopRange.endFrame, total)) : total
  const previewScale = project && project.canvas.width > 0 ? size.width / project.canvas.width : 1

  return (
    <section className="preview-region" aria-label="Video preview" data-testid="video-editor-preview">
      <div className="preview-stage" ref={ref}>
        {!project ? (
          <div className="ve-stage-empty">Open a clip to start editing.</div>
        ) : (
          <div
            className="ve-stage-frame"
            style={{
              width: size.width || undefined,
              height: size.height || undefined,
              ['--hf-preview-scale' as string]: previewScale,
              ...(filter ? { filter } : {})
            }}
          >
            <Suspense fallback={<div className="ve-stage-empty">Starting the player…</div>}>
              <EditorPlayer
                project={project}
                frame={playheadFrame}
                playing={playing}
                loopRange={loopRange}
                onFrame={setPlayhead}
                onPlayingChange={setPlaying}
              />
            </Suspense>
            {tint && <div className="ve-stage-grade" style={tint} aria-hidden />}
            {vignette && <div className="ve-stage-grade" style={vignette} aria-hidden />}
          </div>
        )}
      </div>

      <div className="transport-bar">
        <input
          className="ve-playhead-input"
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={playheadFrame}
          aria-label="Playhead"
          onChange={(event) => setPlayhead(Number(event.target.value))}
        />
        <time>{timecode(playheadFrame, fps)} / {timecode(total, fps)}</time>
        <div className="transport-controls">
          <EditorIconButton
            label="Previous frame"
            icon={StepBack}
            disabled={!project || playheadFrame <= rangeStart}
            onClick={() => setPlayhead(Math.max(rangeStart, playheadFrame - 1))}
          />
          <EditorIconButton
            label={playing ? 'Pause' : 'Play'}
            icon={playing ? Pause : Play}
            active={playing}
            disabled={!project}
            onClick={() => setPlaying(!playing)}
          />
          <EditorIconButton
            label="Next frame"
            icon={StepForward}
            disabled={!project || playheadFrame >= rangeEnd - 1}
            onClick={() => setPlayhead(Math.min(rangeEnd - 1, playheadFrame + 1))}
          />
        </div>
        <div className="preview-options">
          {loopRange ? (
            <button type="button" onClick={() => setLoopRange(null)} title="Return to the full project range">
              Loop {((rangeEnd - rangeStart) / fps).toFixed(1)}s ×
            </button>
          ) : (
            <button type="button" disabled={!canSolo} onClick={soloSelection} title="Loop the selected clip">
              Solo
            </button>
          )}
          <button type="button">Fit <ChevronDown size={13} aria-hidden="true" /></button>
          <span>{project ? previewAspectLabel(project.canvas) : '—'}</span>
          <span className={`ve-save${saving ? ' is-saving' : dirty ? ' is-dirty' : ''}`}>
            {saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}
          </span>
          <Maximize2 size={14} aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}
