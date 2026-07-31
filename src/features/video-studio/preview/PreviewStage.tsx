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

/** Trailing debounce for the auto-rebuild. Long enough that dragging a slider or typing a
 *  headline does not queue a compile per keystroke, short enough to feel immediate. */
const AUTO_REFRESH_DELAY_MS = 400

/** How often playback is allowed to write the playhead into the store. The players report
 *  every frame; at 60fps that re-rendered the whole studio — timeline, panels and all —
 *  sixty times a second just to move a marker. Ten updates a second still reads as smooth
 *  for a timecode and a playhead line. */
const PLAYHEAD_THROTTLE_MS = 100

/** Throttled setter for the players' per-frame callback. The trailing call matters: it is
 *  what leaves the playhead on the real final frame when playback stops. */
function useThrottledPlayhead(setPlayhead: (frame: number) => void): (frame: number) => void {
  const lastSent = useRef(0)
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => () => clearTimeout(timer.current), [])

  return useCallback((frame: number) => {
    const now = performance.now()
    const wait = PLAYHEAD_THROTTLE_MS - (now - lastSent.current)
    pending.current = frame
    if (wait <= 0) {
      lastSent.current = now
      pending.current = null
      setPlayhead(frame)
      return
    }
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = undefined
      lastSent.current = performance.now()
      if (pending.current !== null) {
        const next = pending.current
        pending.current = null
        setPlayhead(next)
      }
    }, wait)
  }, [setPlayhead])
}

export function PreviewStage(): JSX.Element {
  const project = useVideoStudio((state) => state.project)
  const preview = useVideoStudio((state) => state.preview)
  const previewStale = useVideoStudio((state) => state.previewStale)
  const previewBusy = useVideoStudio((state) => state.previewBusy)
  const previewError = useVideoStudio((state) => state.previewError)
  const previewAuto = useVideoStudio((state) => state.previewAuto)
  const setPreviewAuto = useVideoStudio((state) => state.setPreviewAuto)
  const previewRange = useVideoStudio((state) => state.previewRange)
  const setPreviewRange = useVideoStudio((state) => state.setPreviewRange)
  const soloSelection = useVideoStudio((state) => state.soloSelection)
  const canSolo = useVideoStudio((state) => state.selection.kind === 'scene' || state.selection.kind === 'transition')
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const playing = useVideoStudio((state) => state.playing)
  const loadPreview = useVideoStudio((state) => state.loadPreview)
  const setPlayhead = useVideoStudio((state) => state.setPlayhead)
  const setPlaying = useVideoStudio((state) => state.setPlaying)

  const fps = project?.canvas.fps ?? 30
  // The scrubber has to track the STAGED composition, not the live project: the player
  // only knows about frames the current preview was compiled with, so scrubbing past its
  // end moved the readout while the picture sat still.
  const stagedTotal = preview
    ? preview.kind === 'remotion' ? preview.durationInFrames : preview.durationFrames
    : project?.canvas.durationFrames ?? 1
  const total = Math.max(1, stagedTotal)
  const liveTotal = project?.canvas.durationFrames ?? total
  // A solo range narrows the scrubber and loops playback; without one the bounds are the
  // whole staged composition. Clamped to the staged length so a range set before a
  // shortening edit cannot point past the end of what the player knows about.
  const rangeStart = previewRange ? Math.max(0, Math.min(previewRange.startFrame, total - 1)) : 0
  const rangeEnd = previewRange ? Math.max(rangeStart + 1, Math.min(previewRange.endFrame, total)) : total
  const timecode = useTimecode(fps)
  const { ref, size } = useFittedSize(project?.canvas.width ?? 16, project?.canvas.height ?? 9)
  // Only playback goes through the throttle; scrubbing still sets the playhead directly
  // so dragging the bar stays exact.
  const throttledPlayhead = useThrottledPlayhead(setPlayhead)

  // Inside a solo range, playback loops back to the start instead of running on into the
  // rest of the video — that is what makes checking one hook or one caption quick.
  const onPlayerFrame = useCallback((frame: number) => {
    if (previewRange && frame >= rangeEnd - 1) {
      setPlayhead(rangeStart)
      return
    }
    throttledPlayhead(frame)
  }, [previewRange, rangeEnd, rangeStart, setPlayhead, throttledPlayhead])

  // An edit should show up on its own. Without this the user had to notice the preview
  // was stale and click a button — and when that button misbehaved there was no way back.
  const revision = project?.revision
  useEffect(() => {
    if (!previewAuto || !project || !previewStale || previewBusy) return
    const timer = setTimeout(() => { void loadPreview() }, AUTO_REFRESH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [previewAuto, project, revision, previewStale, previewBusy, loadPreview])

  return (
    <div className="vs-preview">
      <div className="vs-preview-frame" ref={ref}>
        {!project ? (
          <div className="vs-preview-empty">Open a clip to start editing.</div>
        ) : !preview ? (
          <div className="vs-preview-empty">
            <span>Nothing is staged yet. Building a preview runs the real composition, so it takes a moment on the first pass.</span>
            {previewError && <span style={{ color: 'var(--danger, #e5484d)' }}>{previewError}</span>}
            <Btn variant="soft" size="sm" disabled={previewBusy} onClick={() => void loadPreview()}>
              {previewBusy ? 'Building the preview…' : 'Build preview'}
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
                  onFrame={onPlayerFrame}
                  onPlayingChange={setPlaying}
                />
              ) : (
                // Keyed on the stamped URL so a rebuild remounts the iframe outright.
                // Relying on React to diff `src` did not work: the old URL carried no
                // revision, so the attribute never changed and the frame never navigated.
                <HyperframesPreview
                  key={preview.url}
                  payload={preview}
                  frame={playheadFrame}
                  playing={playing}
                  onFrame={onPlayerFrame}
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
          min={rangeStart}
          max={Math.max(rangeStart, rangeEnd - 1)}
          step={1}
          value={Math.min(Math.max(playheadFrame, rangeStart), Math.max(rangeStart, rangeEnd - 1))}
          disabled={!project}
          aria-label="Playhead"
          onChange={(event) => setPlayhead(Number(event.target.value))}
        />
        <span className="vs-mono" style={{ flex: 'none' }}>
          {timecode(playheadFrame)} · {playheadFrame}/{total}f
          {liveTotal !== total && <span title="The project is longer or shorter than the staged preview"> (project {liveTotal}f)</span>}
        </span>
        {/* Always rendered once there is a preview. Gating this on `previewStale` meant a
            race that cleared the flag left the user with no way to rebuild at all. */}
        {preview && (
          <Btn
            variant={previewStale ? 'soft' : 'ghost'}
            size="sm"
            disabled={previewBusy}
            title={previewStale ? 'This preview is behind your edits' : 'Rebuild the preview'}
            onClick={() => void loadPreview()}
          >
            {previewBusy ? 'Refreshing…' : previewStale ? '● Refresh preview' : 'Refresh preview'}
          </Btn>
        )}
        {previewRange && (
          <Btn
            variant="soft"
            size="sm"
            title={`Playing ${rangeStart}–${rangeEnd}f on a loop. Click to play the whole video again.`}
            onClick={() => setPreviewRange(null)}
          >
            ⟲ Solo {((rangeEnd - rangeStart) / fps).toFixed(1)}s ✕
          </Btn>
        )}
        <Btn
          variant="ghost"
          size="sm"
          disabled={!canSolo}
          title={
            canSolo
              ? 'Play only the selected clip, on a loop'
              : 'Select a clip or a transition on the timeline to preview it on its own'
          }
          onClick={soloSelection}
        >
          Solo selection
        </Btn>
        <Btn
          variant={previewAuto ? 'soft' : 'ghost'}
          size="sm"
          title={
            previewAuto
              ? 'Rebuilding the preview automatically after each edit. Turn off if compiles are slow on this project.'
              : 'Automatic rebuilds are off — use Refresh preview to see your edits.'
          }
          onClick={() => setPreviewAuto(!previewAuto)}
        >
          Auto {previewAuto ? 'on' : 'off'}
        </Btn>
        {previewError && (
          <span className="vs-pill vs-pill--warn" title={previewError}>preview failed</span>
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
