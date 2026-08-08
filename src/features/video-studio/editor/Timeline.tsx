import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { VideoAsset, VideoProject, VideoScene, VideoTrack } from '@shared/video-engine'
import {
  CLIP_HANDLE_PX,
  RULER_HEIGHT,
  SNAP_PX,
  TRACK_GAP,
  TRACK_HEIGHT,
  TRACK_LABEL_WIDTH,
  ZOOM_STEPS,
  clipWidthPx,
  fitTimelineZoom,
  framesToPx,
  pxToFrames,
  tickSeconds,
  timecode,
  zoomLabel
} from './constants'
import { overlappingSceneIds, snapCandidates, snapFrame, trackAcceptsScene } from './operations'
import { getSelectedClipIds, isClipSelected, orderedTracks, useEditor } from './useEditor'

/* The timeline surface: ruler, lanes, clips, playhead. */

type Gesture =
  | {
      kind: 'move'
      sceneId: string
      startFrame: number
      trackId: string
      pointerX: number
      pointerY: number
      elements: HTMLElement[]
      selectedIds: string[]
    }
  | {
      kind: 'trim'
      sceneId: string
      edge: 'start' | 'end'
      pointerX: number
      element: HTMLElement
    }
  | { kind: 'scrub' }
  | {
      kind: 'marquee'
      startX: number
      startY: number
      currentX: number
      currentY: number
    }

/** The colour a clip takes, by what it shows. Audio reads cool, visuals warm, text and
 *  templates accent — so a glance at the lanes tells you the shape of the video. */
function clipTone(scene: VideoScene, asset: VideoAsset | undefined): string {
  if (scene.kind === 'audio' || asset?.kind === 'audio') return 'audio'
  if (scene.kind === 'caption') return 'caption'
  if (scene.kind === 'template') return 'template'
  if (scene.kind === 'text') return 'text'
  if (scene.kind === 'solid') return 'solid'
  return asset?.kind === 'video' ? 'video' : 'image'
}

function clipLabel(scene: VideoScene, asset: VideoAsset | undefined): string {
  if (scene.kind === 'text') return scene.text?.slice(0, 60) || 'Text'
  if (scene.kind === 'template') return scene.template?.id.replace(/^remotion-/u, '') || 'Template'
  if (scene.kind === 'caption') return 'Captions'
  if (scene.kind === 'solid') return scene.color || 'Solid'
  return asset?.name ?? scene.kind
}

export function Timeline(): JSX.Element | null {
  const project = useEditor((state) => state.project)
  const zoom = useEditor((state) => state.zoom)
  const setZoom = useEditor((state) => state.setZoom)
  const playheadFrame = useEditor((state) => state.playheadFrame)
  const setPlayhead = useEditor((state) => state.setPlayhead)
  const selection = useEditor((state) => state.selection)
  const select = useEditor((state) => state.select)
  const snapEnabled = useEditor((state) => state.snapEnabled)
  const toggleSnap = useEditor((state) => state.toggleSnap)
  const moveClip = useEditor((state) => state.moveClip)
  const moveClips = useEditor((state) => state.moveClips)
  const trimClip = useEditor((state) => state.trimClip)
  const patchTrack = useEditor((state) => state.patchTrack)
  const reorderTrack = useEditor((state) => state.reorderTrack)
  const addTrack = useEditor((state) => state.addTrack)
  const rippleTrack = useEditor((state) => state.rippleTrack)
  const splitAtPlayhead = useEditor((state) => state.splitAtPlayhead)
  const removeClip = useEditor((state) => state.removeClip)
  const removeSelectedClips = useEditor((state) => state.removeSelectedClips)
  const duplicateClip = useEditor((state) => state.duplicateClip)
  const duplicateSelectedClips = useEditor((state) => state.duplicateSelectedClips)

  const laneRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const live = useRef<{ frame: number; trackId: string; delta: number; rows: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragTrackId, setDragTrackId] = useState<string | null>(null)
  const [dropTrackId, setDropTrackId] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const [laneScrollTop, setLaneScrollTop] = useState(0)

  const fps = project?.canvas.fps ?? 30
  const total = project?.canvas.durationFrames ?? 1
  const tracks = useMemo(() => orderedTracks(project), [project])
  const assetsById = useMemo(
    () => new Map((project?.assets ?? []).map((asset) => [asset.id, asset])),
    [project?.assets]
  )
  const width = framesToPx(total, fps, zoom)
  const overlapping = useMemo(
    () => (project ? overlappingSceneIds(project) : new Set<string>()),
    [project]
  )

  /** Frame under a client X coordinate, in lane space. */
  const frameAtClientX = useCallback(
    (clientX: number): number => {
      const lane = laneRef.current
      if (!lane) return 0
      const rect = lane.getBoundingClientRect()
      const x = clientX - rect.left + lane.scrollLeft
      return Math.max(0, Math.min(total, pxToFrames(x, fps, zoom)))
    },
    [fps, zoom, total]
  )

  // One document-level listener pair for the whole surface. Registering per clip meant N
  // listeners and a leak whenever a clip unmounted mid-drag.
  useEffect(() => {
    if (!project) return

    /* Puts the DOM back exactly where React believes it is, and forgets the gesture.
     *
     * `width` must be RESTORED, not cleared. React owns it through the style prop, so it
     * only writes it when its own previous value differs from its next one. A gesture that
     * ends without changing the duration — every move, every trim that clamps to a no-op,
     * every accidental click on a handle — leaves those two values identical, so clearing
     * the inline width meant React never wrote it back and the clip stayed collapsed at its
     * label's width. It looked like the clip had been shortened to a third of its length;
     * `durationFrames` was untouched the whole time, so the inspector, the tooltip and the
     * render all disagreed with the picture. */
    const release = (): { active: Gesture; result: typeof live.current } | null => {
      const active = gesture.current
      const result = live.current
      gesture.current = null
      live.current = null
      setDragging(null)
      setMarquee(null)
      if (!active || active.kind === 'scrub') return null
      if (active.kind === 'marquee') return { active, result: null }
      if (active.kind === 'move') {
        for (const element of active.elements) {
          element.style.transform = ''
          element.style.opacity = ''
          delete element.dataset['dropTrack']
        }
        return { active, result }
      }
      const scene = project.scenes.find((candidate) => candidate.id === active.sceneId)
      const { element } = active
      element.style.transform = ''
      element.style.opacity = ''
      element.style.width = scene ? `${clipWidthPx(scene.durationFrames, fps, zoom)}px` : ''
      delete element.dataset['dropTrack']
      return { active, result }
    }

    const onMove = (event: PointerEvent): void => {
      const active = gesture.current
      if (!active) return

      if (event.buttons === 0) {
        if (active.kind !== 'scrub') release()
        else {
          gesture.current = null
          live.current = null
        }
        return
      }

      if (active.kind === 'scrub') {
        setPlayhead(frameAtClientX(event.clientX))
        return
      }

      if (active.kind === 'marquee') {
        active.currentX = event.clientX
        active.currentY = event.clientY
        setMarquee({
          startX: active.startX,
          startY: active.startY,
          currentX: event.clientX,
          currentY: event.clientY
        })
        return
      }

      const toleranceFrames = pxToFrames(SNAP_PX, fps, zoom)

      if (active.kind === 'move') {
        const scene = project.scenes.find((candidate) => candidate.id === active.sceneId)
        const deltaFrames = pxToFrames(event.clientX - active.pointerX, fps, zoom)
        const duration = scene?.durationFrames ?? 1
        let nextDelta = deltaFrames

        if (snapEnabled && scene) {
          const next = Math.max(0, Math.min(total - duration, active.startFrame + deltaFrames))
          const dragged = { id: scene.id, trackId: active.trackId }
          const snappedStart = snapFrame(
            next,
            snapCandidates(project, dragged, playheadFrame, 'start'),
            toleranceFrames
          )
          const snappedEnd =
            snapFrame(
              next + duration,
              snapCandidates(project, dragged, playheadFrame, 'end'),
              toleranceFrames
            ) - duration
          const bestNext = Math.abs(snappedStart - next) <= Math.abs(snappedEnd - next) ? snappedStart : snappedEnd
          nextDelta = bestNext - active.startFrame
        }

        const rows = Math.round((event.clientY - active.pointerY) / (TRACK_HEIGHT + TRACK_GAP))
        const eligible = scene ? tracks.filter((track) => trackAcceptsScene(track, scene) && !track.locked) : []
        const fromEligible = eligible.findIndex((track) => track.id === active.trackId)
        const target = fromEligible < 0
          ? undefined
          : eligible[Math.max(0, Math.min(eligible.length - 1, fromEligible + rows))]
        const trackId = target?.id ?? active.trackId

        live.current = { frame: active.startFrame + nextDelta, trackId, delta: nextDelta, rows }
        const translateX = framesToPx(nextDelta, fps, zoom)
        for (const el of active.elements) {
          el.style.transform = `translateX(${translateX}px)`
          el.style.opacity = '0.85'
          el.dataset['dropTrack'] = trackId
        }
        return
      }

      const { element } = active
      const scene = project.scenes.find((candidate) => candidate.id === active.sceneId)
      const deltaFrames = pxToFrames(event.clientX - active.pointerX, fps, zoom)
      if (!scene) return
      let delta = deltaFrames
      if (snapEnabled) {
        const edgeFrame = active.edge === 'start' ? scene.startFrame : scene.startFrame + scene.durationFrames
        delta =
          snapFrame(
            edgeFrame + deltaFrames,
            snapCandidates(project, scene, playheadFrame, active.edge),
            toleranceFrames
          ) - edgeFrame
      }
      live.current = { frame: 0, trackId: scene.trackId, delta, rows: 0 }
      const px = framesToPx(Math.abs(delta), fps, zoom) * Math.sign(delta)
      const base = clipWidthPx(scene.durationFrames, fps, zoom)
      if (active.edge === 'start') {
        element.style.transform = `translateX(${px}px)`
        element.style.width = `${Math.max(2, base - px)}px`
      } else {
        element.style.width = `${Math.max(2, base + px)}px`
      }
    }

    const onUp = (): void => {
      const ended = release()
      if (!ended) return
      const { active, result } = ended
      if (active.kind === 'move' && result) {
        if (active.selectedIds.length > 1) {
          moveClips(active.selectedIds, result.delta, result.rows)
        } else {
          moveClip(active.sceneId, result.frame, result.trackId)
        }
      } else if (active.kind === 'trim' && result && result.delta !== 0) {
        trimClip(active.sceneId, active.edge, result.delta)
      } else if (active.kind === 'marquee') {
        const boxLeft = Math.min(active.startX, active.currentX)
        const boxRight = Math.max(active.startX, active.currentX)
        const boxTop = Math.min(active.startY, active.currentY)
        const boxBottom = Math.max(active.startY, active.currentY)

        if (laneRef.current && boxRight - boxLeft > 5 && boxBottom - boxTop > 5) {
          const clipEls = laneRef.current.querySelectorAll<HTMLElement>('[data-clip]')
          const selectedIds: string[] = []
          clipEls.forEach((el) => {
            const rect = el.getBoundingClientRect()
            if (
              rect.left < boxRight &&
              rect.right > boxLeft &&
              rect.top < boxBottom &&
              rect.bottom > boxTop
            ) {
              const id = el.dataset['clip']
              if (id) selectedIds.push(id)
            }
          })
          if (selectedIds.length > 1) {
            select({ kind: 'clips', ids: selectedIds })
          } else if (selectedIds.length === 1) {
            select({ kind: 'clip', id: selectedIds[0] })
          }
        }
      }
    }

    const onBlur = (): void => {
      if (gesture.current) {
        if (gesture.current.kind === 'scrub') gesture.current = null
        else release()
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [project, fps, zoom, total, tracks, snapEnabled, playheadFrame, frameAtClientX, setPlayhead, moveClip, moveClips, trimClip, select])

  if (!project) return null

  const ticks = tickSeconds(zoom)
  const majorCount = Math.floor(total / fps / ticks.major) + 1
  const selectedCount = getSelectedClipIds(selection).length

  const zoomBy = (direction: 1 | -1): void => {
    const ordered = direction === 1 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse()
    const next = ordered.find((step) => direction === 1 ? step > zoom : step < zoom)
    setZoom(next ?? zoom)
  }

  const fitTimeline = (): void => {
    const lane = laneRef.current
    if (!lane) return
    setZoom(fitTimelineZoom(total, fps, lane.clientWidth))
    lane.scrollLeft = 0
  }

  return (
    <section className="ve-timeline" aria-label="Timeline">
      <header className="ve-timeline-bar">
        <span className="ve-mono ve-timeline-clock">{timecode(playheadFrame, fps)}</span>
        <span className="ve-dim">/ {timecode(total, fps)}</span>
        <button type="button" className="ve-btn ve-btn--ghost" onClick={splitAtPlayhead} title="Split the selected clip at the playhead (S)">
          Split
        </button>
        <button
          type="button"
          className="ve-btn ve-btn--ghost"
          disabled={selectedCount === 0}
          onClick={() => duplicateSelectedClips()}
          title="Duplicate selected clips (D)"
        >
          Duplicate
        </button>
        <button
          type="button"
          className="ve-btn ve-btn--ghost"
          disabled={selectedCount === 0}
          onClick={() => removeSelectedClips()}
          title="Delete selected clips (Del)"
        >
          Delete {selectedCount > 1 ? `(${selectedCount})` : ''}
        </button>
        <span className="ve-spacer" />
        <button
          type="button"
          className={`ve-btn ${snapEnabled ? 've-btn--soft' : 've-btn--ghost'}`}
          onClick={toggleSnap}
          title="Snap edges to the playhead, other clips, and whole seconds"
        >
          Snap {snapEnabled ? 'on' : 'off'}
        </button>
        <div className="ve-zoom">
          <button type="button" className="ve-btn ve-btn--ghost" onClick={fitTimeline} title="Fit the full project in the timeline">Fit</button>
          <button type="button" className="ve-btn ve-btn--ghost" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
          <span className="ve-mono ve-zoom-value">{zoomLabel(zoom)}</span>
          <button type="button" className="ve-btn ve-btn--ghost" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
        </div>
        <button type="button" className="ve-btn ve-btn--ghost" onClick={() => addTrack('video')} title="Add a video lane">
          + Track
        </button>
      </header>

      <div className="ve-timeline-body">
        <div className="ve-labels" style={{ width: TRACK_LABEL_WIDTH }}>
          <div className="ve-labels-spacer" style={{ height: RULER_HEIGHT }} />
          <div className="ve-labels-inner" style={{ transform: `translateY(${-laneScrollTop}px)` }}>
            {tracks.map((track) => (
              <TrackLabel
                key={track.id}
                track={track}
                selected={selection.kind === 'track' && selection.id === track.id}
                dragging={dragTrackId === track.id}
                dropTarget={dropTrackId === track.id}
                onSelect={() => select({ kind: 'track', id: track.id })}
                onMute={() => patchTrack(track.id, { muted: !track.muted })}
                onLock={() => patchTrack(track.id, { locked: !track.locked })}
                onRipple={() => rippleTrack(track.id)}
                onDragStart={() => { setDragTrackId(track.id); setDropTrackId(null) }}
                onDragEnd={() => { setDragTrackId(null); setDropTrackId(null) }}
                onDragOver={() => {
                  if (dragTrackId && dragTrackId !== track.id) setDropTrackId(track.id)
                }}
                onDrop={(sourceTrackId) => {
                  if (sourceTrackId && sourceTrackId !== track.id) {
                    reorderTrack(sourceTrackId, track.id)
                  }
                  setDragTrackId(null)
                  setDropTrackId(null)
                }}
              />
            ))}
          </div>
        </div>

        <div
          className="ve-lanes ed-scroll"
          ref={laneRef}
          onScroll={(event) => setLaneScrollTop(event.currentTarget.scrollTop)}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement
            if (target.closest('.ve-clip') || target.closest('.ve-playhead') || target.closest('.ve-ruler') || target.closest('.ve-btn')) return
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
              select({ kind: 'none' })
            }
            gesture.current = {
              kind: 'marquee',
              startX: event.clientX,
              startY: event.clientY,
              currentX: event.clientX,
              currentY: event.clientY
            }
            setMarquee({
              startX: event.clientX,
              startY: event.clientY,
              currentX: event.clientX,
              currentY: event.clientY
            })
          }}
        >
          <div className="ve-lanes-inner" style={{ width: Math.max(width, 320), minWidth: '100%' }}>
            <div
              className="ve-ruler"
              style={{ height: RULER_HEIGHT }}
              onPointerDown={(event) => {
                gesture.current = { kind: 'scrub' }
                setPlayhead(frameAtClientX(event.clientX))
              }}
              role="presentation"
            >
              {Array.from({ length: majorCount }, (_, index) => {
                const seconds = index * ticks.major
                return (
                  <span
                    key={seconds}
                    className="ve-tick"
                    style={{ left: framesToPx(seconds * fps, fps, zoom) }}
                  >
                    {seconds < 60 ? `${seconds}s` : timecode(seconds * fps, fps)}
                  </span>
                )
              })}
            </div>

            {tracks.map((track) => (
              <div
                key={track.id}
                className={`ve-lane${track.muted ? ' ve-lane--muted' : ''}`}
                style={{ height: TRACK_HEIGHT, marginBottom: TRACK_GAP }}
                data-track={track.id}
              >
                {project.scenes
                  .filter((scene) => scene.trackId === track.id)
                  .map((scene) => {
                    const asset = scene.assetId ? assetsById.get(scene.assetId) : undefined
                    const isSelected = isClipSelected(selection, scene.id)
                    const tiny = clipWidthPx(scene.durationFrames, fps, zoom) < CLIP_HANDLE_PX * 3
                    return (
                      <div
                        key={scene.id}
                        data-clip={scene.id}
                        className={`ve-clip ve-clip--${clipTone(scene, asset)}${tiny ? ' ve-clip--tiny' : ''}${isSelected ? ' is-selected' : ''}${dragging === scene.id ? ' is-dragging' : ''}${overlapping.has(scene.id) ? ' is-overlapping' : ''}`}
                        style={{
                          left: framesToPx(scene.startFrame, fps, zoom),
                          width: clipWidthPx(scene.durationFrames, fps, zoom)
                        }}
                        title={`${clipLabel(scene, asset)} · ${timecode(scene.startFrame, fps)} → ${timecode(scene.startFrame + scene.durationFrames, fps)} · ${scene.durationFrames}f${overlapping.has(scene.id) ? '\nOverlaps another clip on this lane' : ''}`}
                        onPointerDown={(event) => {
                          if (track.locked) return
                          event.stopPropagation()

                          const currentSelected = getSelectedClipIds(selection)
                          let nextSelectedIds: string[] = []

                          if (event.shiftKey || event.ctrlKey || event.metaKey) {
                            if (currentSelected.includes(scene.id)) {
                              nextSelectedIds = currentSelected.filter((id) => id !== scene.id)
                            } else {
                              nextSelectedIds = [...currentSelected, scene.id]
                            }
                          } else if (currentSelected.includes(scene.id) && currentSelected.length > 1) {
                            nextSelectedIds = currentSelected
                          } else {
                            nextSelectedIds = [scene.id]
                          }

                          if (nextSelectedIds.length > 1) {
                            select({ kind: 'clips', ids: nextSelectedIds })
                          } else if (nextSelectedIds.length === 1) {
                            select({ kind: 'clip', id: nextSelectedIds[0] })
                          } else {
                            select({ kind: 'none' })
                          }

                          setDragging(scene.id)

                          const elements: HTMLElement[] = []
                          if (laneRef.current) {
                            for (const id of nextSelectedIds) {
                              const el = laneRef.current.querySelector<HTMLElement>(`[data-clip="${id}"]`)
                              if (el) elements.push(el)
                            }
                          }
                          if (elements.length === 0) elements.push(event.currentTarget)

                          gesture.current = {
                            kind: 'move',
                            sceneId: scene.id,
                            startFrame: scene.startFrame,
                            trackId: track.id,
                            pointerX: event.clientX,
                            pointerY: event.clientY,
                            elements,
                            selectedIds: nextSelectedIds
                          }
                        }}
                        onDoubleClick={() => useEditor.getState().soloSelection()}
                      >
                        <span
                          className="ve-clip-handle ve-clip-handle--start"
                          style={{ width: CLIP_HANDLE_PX }}
                          onPointerDown={(event) => {
                            if (track.locked) return
                            event.stopPropagation()
                            select({ kind: 'clip', id: scene.id })
                            gesture.current = {
                              kind: 'trim',
                              sceneId: scene.id,
                              edge: 'start',
                              pointerX: event.clientX,
                              element: event.currentTarget.parentElement as HTMLElement
                            }
                          }}
                          role="presentation"
                        />
                        <span className="ve-clip-label">{clipLabel(scene, asset)}</span>
                        <span
                          className="ve-clip-handle ve-clip-handle--end"
                          style={{ width: CLIP_HANDLE_PX }}
                          onPointerDown={(event) => {
                            if (track.locked) return
                            event.stopPropagation()
                            select({ kind: 'clip', id: scene.id })
                            gesture.current = {
                              kind: 'trim',
                              sceneId: scene.id,
                              edge: 'end',
                              pointerX: event.clientX,
                              element: event.currentTarget.parentElement as HTMLElement
                            }
                          }}
                          role="presentation"
                        />
                      </div>
                    )
                  })}
              </div>
            ))}

            <div className="ve-playhead" style={{ left: framesToPx(playheadFrame, fps, zoom) }}>
              <span className="ve-playhead-grip" />
            </div>
          </div>
        </div>
      </div>

      {marquee && (
        <div
          className="ve-marquee-box"
          style={{
            position: 'fixed',
            left: Math.min(marquee.startX, marquee.currentX),
            top: Math.min(marquee.startY, marquee.currentY),
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY),
            border: '1px dashed #eab308',
            background: 'rgba(234, 179, 8, 0.18)',
            pointerEvents: 'none',
            zIndex: 9999,
            borderRadius: 2
          }}
        />
      )}
    </section>
  )
}

function TrackLabel({
  track,
  selected,
  dragging,
  dropTarget,
  onSelect,
  onMute,
  onLock,
  onRipple,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: {
  track: VideoTrack
  selected: boolean
  dragging: boolean
  dropTarget: boolean
  onSelect: () => void
  onMute: () => void
  onLock: () => void
  onRipple: () => void
  onDragStart: () => void
  onDragEnd: () => void
  onDragOver: () => void
  onDrop: (sourceTrackId: string) => void
}): JSX.Element {
  const canReorder = track.kind !== 'audio'
  return (
    <div
      className={`ve-label${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop-target' : ''}`}
      style={{ height: TRACK_HEIGHT, marginBottom: TRACK_GAP }}
      onClick={onSelect}
      onDragOver={(event) => {
        if (!canReorder || dragging) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOver()
      }}
      onDrop={(event) => {
        if (!canReorder) return
        event.preventDefault()
        onDrop(event.dataTransfer.getData('text/plain'))
      }}
      role="presentation"
    >
      <button
        type="button"
        className="ve-label-grip"
        draggable={canReorder}
        disabled={!canReorder}
        onClick={(event) => event.stopPropagation()}
        onDragStart={(event) => {
          event.stopPropagation()
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', track.id)
          onDragStart()
        }}
        onDragEnd={onDragEnd}
        title={canReorder ? `Drag ${track.name} to change its layer order` : 'Audio lanes do not affect visual layering'}
        aria-label={`Reorder ${track.name}`}
      >
        ⠿
      </button>
      <span className="ve-label-name me-ellipsis" title={track.name}>{track.name}</span>
      {/* State is the chip's fill, not the letter's case. `m` vs `M` and `l` vs `L` at 10px
          asked the eye to read capitalisation to know whether a lane was muted — two
          variables encoding one fact, and the one that carried it was the illegible one. */}
      <span className="ve-label-actions">
        <button
          type="button"
          className={`ve-chip${track.muted ? ' is-on' : ''}`}
          onClick={(event) => { event.stopPropagation(); onMute() }}
          title={track.muted ? `${track.name} is muted. Click to unmute.` : `Mute ${track.name}`}
          aria-pressed={track.muted}
          aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
        >
          M
        </button>
        <button
          type="button"
          className={`ve-chip${track.locked ? ' is-on' : ''}`}
          onClick={(event) => { event.stopPropagation(); onLock() }}
          title={track.locked ? `${track.name} is locked against edits. Click to unlock.` : `Lock ${track.name} against edits`}
          aria-pressed={track.locked}
          aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
        >
          L
        </button>
        <button
          type="button"
          className="ve-chip"
          onClick={(event) => { event.stopPropagation(); onRipple() }}
          title="Close every gap on this lane"
          aria-label={`Close gaps on ${track.name}`}
        >
          ⇥
        </button>
      </span>
    </div>
  )
}
