import { useMemo, useRef } from 'react'
import type { VideoProject, VideoScene, VideoTrack } from '@shared/video-engine'
import { IconBtn } from '../../../components/ui/kit'
import { useVideoStudio } from '../store/useVideoStudio'
import { useTimecode } from '../ui/kit'

/* The timeline is frame-addressed: every position is `frame / canvas.durationFrames`,
   never a second, because that is the unit the engine renders in. Clicking a lane
   moves the playhead; clicking a clip selects it. */

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

export function StudioTimeline(): JSX.Element | null {
  const project = useVideoStudio((state) => state.project)
  const selection = useVideoStudio((state) => state.selection)
  const playheadFrame = useVideoStudio((state) => state.playheadFrame)
  const setPlayhead = useVideoStudio((state) => state.setPlayhead)
  const setSelection = useVideoStudio((state) => state.setSelection)
  const setTrackMuted = useVideoStudio((state) => state.setTrackMuted)
  const busy = useVideoStudio((state) => state.busy)
  const ruler = useRef<HTMLDivElement>(null)

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

  if (!project) return null

  const percent = (frame: number): string => `${(Math.max(0, frame) / total) * 100}%`
  const laneWidth = ruler.current?.clientWidth ?? 640

  const seekFromEvent = (event: React.MouseEvent<HTMLElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    setPlayhead(Math.round(ratio * (total - 1)))
  }

  return (
    <div className="vs-timeline">
      <div className="vs-tl-head">
        <span>TIMELINE</span>
        <span style={{ color: 'var(--text-muted)' }}>{timecode(playheadFrame)}</span>
        <span>{playheadFrame} / {total}f · {fps}fps</span>
        <span style={{ flex: 1 }} />
        <span>{project.scenes.length} clip{project.scenes.length === 1 ? '' : 's'}</span>
        <span>{project.transitions.length} transition{project.transitions.length === 1 ? '' : 's'}</span>
      </div>

      <div className="vs-tl-body">
        <div className="vs-track-label" style={{ height: 18, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
          {project.canvas.width}×{project.canvas.height}
        </div>
        <div className="vs-ruler" ref={ruler} onClick={seekFromEvent} role="presentation">
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
              <div className="vs-track-lane" onClick={seekFromEvent} role="presentation">
                {scenes.map((scene) => {
                  const selected = selection.kind === 'scene' && selection.id === scene.id
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      className={`vs-clip vs-clip--${scene.kind} ed-focus`}
                      data-selected={selected ? '1' : '0'}
                      style={{ left: percent(scene.startFrame), width: `max(3px, ${(scene.durationFrames / total) * 100}%)` }}
                      title={`${sceneLabel(project, scene)} · ${scene.startFrame}–${scene.startFrame + scene.durationFrames}f`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelection({ kind: 'scene', id: scene.id })
                      }}
                    >
                      {sceneLabel(project, scene)}
                    </button>
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
          style={{ left: `calc(104px + (100% - 104px) * ${Math.min(1, playheadFrame / total)})` }}
        />
      </div>
    </div>
  )
}
