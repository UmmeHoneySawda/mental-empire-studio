import { useCallback, useEffect, useRef, useState } from 'react'
import type { HyperframesPreviewPayload, VideoProject } from '@shared/video-engine'
import { HyperframesPreview } from '../preview/HyperframesPreview'
import { PLAYHEAD_THROTTLE_MS } from './constants'
import { useEditor } from './useEditor'

const REBUILD_DELAY_MS = 400

/**
 * Stages the real GPU-optimized HyperFrames composition behind the live editor.
 * Local timeline edits remain synchronous; compilation happens after the debounced save,
 * and the previous iframe remains visible until its replacement is ready.
 */
export function HyperframesEditorPlayer({
  project,
  frame,
  playing,
  loopRange,
  onFrame,
  onPlayingChange,
}: {
  project: VideoProject
  frame: number
  playing: boolean
  loopRange: { startFrame: number; endFrame: number } | null
  onFrame: (frame: number) => void
  onPlayingChange: (playing: boolean) => void
}): JSX.Element {
  const dirty = useEditor((state) => state.dirty)
  const saving = useEditor((state) => state.saving)
  const [payload, setPayload] = useState<HyperframesPreviewPayload | null>(null)
  const [building, setBuilding] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const lastBuiltRevision = useRef(-1)
  const lastSent = useRef(0)
  const pendingFrame = useRef<number | null>(null)
  const playheadTimer = useRef<ReturnType<typeof setTimeout>>()

  const reportFrame = useCallback((next: number): void => {
    const now = performance.now()
    const wait = PLAYHEAD_THROTTLE_MS - (now - lastSent.current)
    pendingFrame.current = next
    if (wait <= 0) {
      lastSent.current = now
      pendingFrame.current = null
      onFrame(next)
      return
    }
    if (playheadTimer.current) return
    playheadTimer.current = setTimeout(() => {
      playheadTimer.current = undefined
      lastSent.current = performance.now()
      if (pendingFrame.current !== null) {
        const value = pendingFrame.current
        pendingFrame.current = null
        onFrame(value)
      }
    }, wait)
  }, [onFrame])

  const rebuild = useCallback(async (): Promise<void> => {
    const native = typeof window !== 'undefined' ? window.api : undefined
    if (!native) {
      setError('The desktop bridge is not available in this window.')
      return
    }
    const seq = (sequence.current += 1)
    setBuilding(true)
    setError('')
    const saved = await useEditor.getState().flush()
    if (!saved || seq !== sequence.current) {
      if (seq === sequence.current) {
        setBuilding(false)
        setError(useEditor.getState().error || 'The latest project changes could not be saved.')
      }
      return
    }
    const current = useEditor.getState().project
    if (!current || current.id !== project.id) {
      if (seq === sequence.current) setBuilding(false)
      return
    }
    try {
      const preview = await native.videoEngine.preview(current.id)
      if (seq !== sequence.current) return
      if (preview.kind !== 'hyperframes') {
        throw new Error('The HyperFrames project returned the wrong preview type.')
      }
      lastBuiltRevision.current = current.revision
      setPayload(preview)
      setBuilding(false)
    } catch (cause) {
      if (seq !== sequence.current) return
      setBuilding(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [project.id])

  useEffect(() => {
    if (saving) return
    if (!dirty && payload && project.revision === lastBuiltRevision.current) return
    const timer = setTimeout(() => void rebuild(), REBUILD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [dirty, payload, project, project.revision, rebuild, saving])

  useEffect(() => () => {
    sequence.current += 1
    clearTimeout(playheadTimer.current)
  }, [])

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {payload ? (
        <HyperframesPreview
          key={payload.url}
          payload={payload}
          frame={frame}
          playing={playing}
          loopRange={loopRange}
          onFrame={reportFrame}
          onPlayingChange={onPlayingChange}
        />
      ) : (
        <div className="ve-stage-empty">Building the HyperFrames preview…</div>
      )}
      {(building || error || (payload?.warnings.length ?? 0) > 0) && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            bottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 9px',
            borderRadius: 8,
            background: 'rgba(5,7,10,.82)',
            color: error ? 'var(--err-2)' : 'var(--text-muted)',
            fontSize: 11,
            pointerEvents: 'auto',
          }}
        >
          <span style={{ flex: 1 }}>
            {error || (building
              ? 'Refreshing the GPU composition…'
              : `${payload?.warnings.length ?? 0} HyperFrames lint warning${payload?.warnings.length === 1 ? '' : 's'}`)}
          </span>
          {error && (
            <button type="button" className="ve-btn ve-btn--soft" onClick={() => void rebuild()}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
}
