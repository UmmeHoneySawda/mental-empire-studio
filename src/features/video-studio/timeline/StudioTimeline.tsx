import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { VideoProject, VideoScene, VideoTrack } from '@shared/video-engine'
import { Btn, IconBtn } from '../../../components/ui/kit'
import { useVideoStudio } from '../store/useVideoStudio'
import { useTimecode } from '../ui/kit'

/* The timeline is frame-addressed: every position is `frame / canvas.durationFrames`,
   never a second, because that is the unit the engine renders in.

   Clips can be dragged along their lane and trimmed from either edge. The drag runs
   entirely on local state and only commits to the engine on release — a project save
   bumps the revision and restages the preview, so committing per pointermove would
   recompile the composition dozens of times for one gesture. */

/** Grab zone at each end of a clip, in pixels. Below this the pointer moves the clip. */
const TRIM_HANDLE_PX = 7
/** A clip narrower than this has no room for two handles, so it only moves. */
const MIN_TRIMMABLE_PX = 22
const MIN_CLIP_FRAMES = 1
const TRACK_LABEL_PX = 104

type DragMode = 'move' | 'trim-start' | 'trim-end'

interface Drag {
  sceneId: string
  mode: DragMode
  /** Where the gesture started, in frames. */
  originFrame: number
  startFrame: number
  durationFrames: number
  /** Live values, updated on pointermove. */
  nextStart: number
  nextDuration: number
}

function sceneLabel(project: VideoProject, scene: VideoScene): string {
  if (scene.template) return scene.template.id.replace(/^(remotion|hyperframes)-/, '')
  if (scene.assetId) {
    const asset = project.assets.find((candidate) => candidate.id === scene.assetId)
    if (asset) return asset.name
  }
  if (scene.text) return scene.text.slice(0, 60)
  if (scene.kind === 'caption') return 'Captions'
  return scene.id
}

function orderedTracks(project: VideoProject): VideoTrack[] {
  return [...project.tracks].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
}

/** Ruler ticks land on whole seconds, thinned out so labels never collide. */
function tickSeconds(durationFrames: number, fps: number, laneWidth: number): number[] {
  const totalSeconds = Math.max(1, durationFrames / fps)
  const pxPerSecond = Math.max(1, laneWidth) / totalSeconds
  const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((candidate) => candidate * pxPerSecond >= 54) ?? 600
  const ticks: number[] = []
  for (let second = 0; second <= totalSeconds; second += step) ticks.push(second)
  return ticks
}

const ZOOMS = [1, 2, 4, 8, 16]

export function StudioTimeline(): JSX.Element | null {
  const project = useVideoStudio((state) => state.project)
  const selection = useVideoStudio((state) => state.selection)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const setPlayhead = useVideoStudio((state) => state.setPlayhead)
  const setSelection = useVideoStudio((state) => state.setSelection)
  const setTrackMuted = useVideoStudio((state) => state.setTrackMuted)
  const updateScene = useVideoStudio((state) => state.updateScene)
  const setPreviewRange = useVideoStudio((state) => state.setPreviewRange)
  const previewRange = useVideoStudio((state) => state.previewRange)
  const busy = useVideoStudio((state) => state.busy)

  const [zoom, setZoom] = useState(1)
  const [drag, setDrag] = useState<Drag | null>(null)
  // Read inside pointer handlers only, so a move does not re-subscribe anything.
  const dragRef = useRef<Drag | null>(null)

  const fps = project?.canvas.fps ?? 30
  const total = Math.max(1, project?.canvas.durationFrames ?? 1)
  const timecode = useTimecode(fps)

  const tracks = useMemo(() => (project ? orderedTracks(project) : []), [project])
  const scenesByTrack = useMemo(() => {
    const map = new Map<string, VideoScene[]>()
    for (const scene of project?.scenes ?? []) {
      const list = map.get(scene.trackId) ?? []
      list.push(scene)
      map.set(scene.trackId, list)
    }
    for (const list of map.values()) list.sort((left, right) => left.startFrame - right.startFrame)
    return map
  }, [project])

  /** Frames per pixel for the lane the pointer is over. Measured from the live element
   *  rather than cached, so it stays correct across zoom and window resizes. */
  const framesPerPixel = useCallback((lane: HTMLElement): number => {
    const width = lane.getBoundingClientRect().width
    return width > 0 ? total / width : 0
  }, [total])

  const onClipPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    scene: VideoScene
  ): void => {
    if (event.button !== 0 || busy) return
    const element = event.currentTarget
    const rect = element.getBoundingClientRect()
    const offset = event.clientX - rect.left
    const trimmable = rect.width >= MIN_TRIMMABLE_PX
    const mode: DragMode = !trimmable
      ? 'move'
      : offset <= TRIM_HANDLE_PX ? 'trim-start'
        : offset >= rect.width - TRIM_HANDLE_PX ? 'trim-end'
          : 'move'

    const lane = element.parentElement
    if (!lane) return
    const perPixel = framesPerPixel(lane)
    if (perPixel <= 0) return

    event.preventDefault()
    event.stopPropagation()
    const currentIds = selection.kind === 'scene' ? [selection.id] : selection.kind === 'scenes' ? selection.ids : []
    let nextIds: string[] = []
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (currentIds.includes(scene.id)) {
        nextIds = currentIds.filter((id) => id !== scene.id)
      } else {
        nextIds = [...currentIds, scene.id]
      }
    } else {
      nextIds = [scene.id]
    }

    if (nextIds.length > 1) {
      setSelection({ kind: 'scenes', ids: nextIds })
    } else if (nextIds.length === 1) {
      setSelection({ kind: 'scene', id: nextIds[0] })
    } else {
      setSelection({ kind: 'project' })
    }

    const originFrame = (event.clientX - lane.getBoundingClientRect().left) * perPixel
    const started: Drag = {
      sceneId: scene.id,
      mode,
      originFrame,
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      nextStart: scene.startFrame,
      nextDuration: scene.durationFrames
    }
    dragRef.current = started
    setDrag(started)
    element.setPointerCapture(event.pointerId)
  }, [busy, framesPerPixel, selection, setSelection])

  const onClipPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    if (!current) return
    const lane = event.currentTarget.parentElement
    if (!lane) return
    const perPixel = framesPerPixel(lane)
    if (perPixel <= 0) return

    const frameNow = (event.clientX - lane.getBoundingClientRect().left) * perPixel
    const delta = Math.round(frameNow - current.originFrame)

    let nextStart = current.startFrame
    let nextDuration = current.durationFrames
    if (current.mode === 'move') {
      // Clamped so a clip can never be dragged off either end of the canvas.
      nextStart = Math.max(0, Math.min(total - current.durationFrames, current.startFrame + delta))
    } else if (current.mode === 'trim-start') {
      const limit = current.startFrame + current.durationFrames - MIN_CLIP_FRAMES
      nextStart = Math.max(0, Math.min(limit, current.startFrame + delta))
      nextDuration = current.startFrame + current.durationFrames - nextStart
    } else {
      nextDuration = Math.max(
        MIN_CLIP_FRAMES,
        Math.min(total - current.startFrame, current.durationFrames + delta)
      )
    }
    if (nextStart === current.nextStart && nextDuration === current.nextDuration) return
    const updated = { ...current, nextStart, nextDuration }
    dragRef.current = updated
    setDrag(updated)
  }, [framesPerPixel, total])

  const onClipPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!current) return
    // Only save when the gesture actually changed something — a plain click on a clip
    // is a selection, and should not bump the project revision.
    if (current.nextStart === current.startFrame && current.nextDuration === current.durationFrames) return
    void updateScene(current.sceneId, {
      startFrame: current.nextStart,
      durationFrames: current.nextDuration
    })
  }, [updateScene])

  if (!project) return null

  const percent = (frame: number): string => `${(Math.max(0, frame) / total) * 100}%`

  const seekFromEvent = (event: ReactPointerEvent<HTMLElement>): void => {
    if (dragRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    setPlayhead(Math.round(ratio * (total - 1)))
  }

  /** The clip's live geometry — the dragged one follows the pointer, everything else
   *  reads straight from the project. */
  const geometryFor = (scene: VideoScene): { startFrame: number; durationFrames: number } =>
    drag && drag.sceneId === scene.id
      ? { startFrame: drag.nextStart, durationFrames: drag.nextDuration }
      : { startFrame: scene.startFrame, durationFrames: scene.durationFrames }

  const laneWidth = 640 * zoom

  return (
    <div className="vs-timeline">
      <div className="vs-tl-head">
        <span>TIMELINE</span>
        <span style={{ color: 'var(--text-muted)' }}>{timecode(playheadFrame)}</span>
        <span>{playheadFrame} / {total}f · {fps}fps</span>
        {drag && (
          <span style={{ color: 'var(--engine)' }}>
            {drag.mode === 'move' ? 'moving' : 'trimming'} · {drag.nextStart}–{drag.nextStart + drag.nextDuration}f
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span>{project.scenes.length} clip{project.scenes.length === 1 ? '' : 's'}</span>
        <span>{project.transitions.length} transition{project.transitions.length === 1 ? '' : 's'}</span>
        <Btn
          variant="ghost"
          size="sm"
          title="Zoom out"
          disabled={zoom === ZOOMS[0]}
          onClick={() => setZoom((current) => ZOOMS[Math.max(0, ZOOMS.indexOf(current) - 1)]!)}
        >
          −
        </Btn>
        <span className="vs-mono" style={{ minWidth: 28, textAlign: 'center' }}>{zoom}×</span>
        <Btn
          variant="ghost"
          size="sm"
          title="Zoom in — makes short clips wide enough to grab and trim"
          disabled={zoom === ZOOMS[ZOOMS.length - 1]}
          onClick={() => setZoom((current) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(current) + 1)]!)}
        >
          +
        </Btn>
      </div>

      {/* At >1× the lanes are wider than the panel, so the whole grid scrolls sideways
          as one unit and the label column scrolls with it. */}
      <div className="ed-scroll" style={{ overflowX: zoom > 1 ? 'auto' : 'hidden', overflowY: 'hidden' }}>
        <div className="vs-tl-body" style={{ minWidth: zoom > 1 ? `calc(${TRACK_LABEL_PX}px + ${zoom * 100}%)` : undefined }}>
          <div className="vs-track-label" style={{ height: 18, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {project.canvas.width}×{project.canvas.height}
          </div>
          <div className="vs-ruler" onPointerDown={seekFromEvent} role="presentation">
            {/* Shades everything outside a solo range, so it is obvious the preview is
                showing a slice rather than the whole video. */}
            {previewRange && (
              <>
                <span className="vs-solo-mask" style={{ left: 0, width: percent(previewRange.startFrame) }} />
                <span
                  className="vs-solo-mask"
                  style={{ left: percent(previewRange.endFrame), right: 0 }}
                />
              </>
            )}
            {tickSeconds(total, fps, laneWidth).map((second) => (
              <span key={second} className="vs-tick" style={{ left: percent(second * fps) }}>
                {second}s
              </span>
            ))}
          </div>

          {tracks.map((track) => {
            const scenes = scenesByTrack.get(track.id) ?? []
            return (
              <div key={track.id} style={{ display: 'contents' }}>
                <div className="vs-track-label" title={`${track.name} — ${track.kind}`}>
                  <IconBtn
                    title={track.muted ? `Include ${track.name} in the render` : `Leave ${track.name} out of the render`}
                    size={16}
                    active={!track.muted}
                    disabled={!!busy}
                    onClick={() => void setTrackMuted(track.id, !track.muted)}
                  >
                    {track.muted ? '○' : '●'}
                  </IconBtn>
                  <span className="me-ellipsis">{track.name}</span>
                </div>
                <div className="vs-track-lane" onPointerDown={seekFromEvent} role="presentation">
                  {scenes.map((scene) => {
                    const selected =
                      (selection.kind === 'scene' && selection.id === scene.id) ||
                      (selection.kind === 'scenes' && selection.ids.includes(scene.id))
                    const geometry = geometryFor(scene)
                    const dragging = drag?.sceneId === scene.id
                    return (
                      <div
                        key={scene.id}
                        role="button"
                        tabIndex={0}
                        className={`vs-clip vs-clip--${scene.kind} ed-focus`}
                        data-selected={selected ? '1' : '0'}
                        data-dragging={dragging ? '1' : '0'}
                        style={{
                          left: percent(geometry.startFrame),
                          width: `max(3px, ${(geometry.durationFrames / total) * 100}%)`,
                          cursor: dragging ? (drag.mode === 'move' ? 'grabbing' : 'ew-resize') : 'grab',
                          touchAction: 'none'
                        }}
                        title={`${sceneLabel(project, scene)} · ${geometry.startFrame}–${geometry.startFrame + geometry.durationFrames}f\nDrag to move, drag an edge to trim`}
                        onPointerDown={(event) => onClipPointerDown(event, scene)}
                        onPointerMove={onClipPointerMove}
                        onPointerUp={onClipPointerUp}
                        onPointerCancel={onClipPointerUp}
                        // Double-click plays just this clip, on a loop — the quickest way
                        // to check one hook or one caption in a long composition.
                        onDoubleClick={(event) => {
                          event.stopPropagation()
                          setSelection({ kind: 'scene', id: scene.id })
                          setPreviewRange({
                            startFrame: scene.startFrame,
                            endFrame: Math.min(total, scene.startFrame + scene.durationFrames)
                          })
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelection({ kind: 'scene', id: scene.id })
                          }
                        }}
                      >
                        {sceneLabel(project, scene)}
                      </div>
                    )
                  })}
                  {project.transitions
                    .filter((transition) => {
                      const to = project.scenes.find((scene) => scene.id === transition.toSceneId)
                      return to?.trackId === track.id
                    })
                    .map((transition) => (
                      <button
                        key={transition.id}
                        type="button"
                        className="vs-transition-mark ed-focus"
                        style={{
                          left: percent(transition.startFrame),
                          width: `max(2px, ${(Math.max(1, transition.durationFrames) / total) * 100}%)`
                        }}
                        title={`${transition.type} · ${transition.durationFrames}f`}
                        onClick={(event) => {
                          event.stopPropagation()
                          setSelection({ kind: 'transition', id: transition.id })
                        }}
                      />
                    ))}
                </div>
              </div>
            )
          })}

          {/* One playhead spanning every lane: the label column is a fixed 104px, so the
              offset is that gutter plus a fraction of the remaining width. */}
          <div
            className="vs-playhead"
            style={{ left: `calc(${TRACK_LABEL_PX}px + (100% - ${TRACK_LABEL_PX}px) * ${Math.min(1, playheadFrame / total)})` }}
          />
        </div>
      </div>
    </div>
  )
}
