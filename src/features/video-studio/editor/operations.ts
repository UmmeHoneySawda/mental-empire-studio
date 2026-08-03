import {
  AUTO_BROLL_TRACK_ID,
  AUTO_BROLL_TRACK_NAME,
  AUTO_BROLL_TRACK_ORDER,
  mediaFillSeed,
  planMediaFill,
  type AutoBrollPlacement,
  type VideoProject,
  type VideoScene,
  type VideoTrack
} from '@shared/video-engine'
import { MIN_CLIP_FRAMES } from './constants'

/* Pure timeline edits: project in, project out, no IPC and no React.
 *
 * These exist so a drag can update the on-screen timeline and the Player immediately and
 * commit to the engine once, on release. The old studio round-tripped every mutation
 * through `ipcMain` and replaced the whole project from the response, which is why one
 * dragged clip meant a dozen writes, a dozen revision bumps, and a dozen full re-renders.
 *
 * The engine's zod schema is still the authority — everything here respects the same
 * invariants (clips inside the canvas, positive durations, transitions no longer than
 * either neighbour) so a local edit never produces a project the engine will reject. */

const uid = (prefix: string): string =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`

export const IMAGE_CYCLE_TRACK_ID = 'image-cycle'
export const IMAGE_CYCLE_TRACK_NAME = 'Image cycle'
export const IMAGE_CYCLE_TRACK_ORDER = 0
export const IMAGE_CYCLE_SCENE_PREFIX = 'image-cycle-scene-'
export type ImageCycleInterval = 3 | 4

/** The frames a clip may occupy: inside the canvas, at least MIN_CLIP_FRAMES long. */
function clampSpan(
  project: VideoProject,
  startFrame: number,
  durationFrames: number
): { startFrame: number; durationFrames: number } {
  const total = project.canvas.durationFrames
  const start = Math.max(0, Math.min(Math.round(startFrame), total - MIN_CLIP_FRAMES))
  const room = total - start
  const duration = Math.max(MIN_CLIP_FRAMES, Math.min(Math.round(durationFrames), room))
  return { startFrame: start, durationFrames: duration }
}

function mapScene(
  project: VideoProject,
  sceneId: string,
  fn: (scene: VideoScene) => VideoScene
): VideoProject {
  let touched = false
  const scenes = project.scenes.map((scene) => {
    if (scene.id !== sceneId) return scene
    touched = true
    return fn(scene)
  })
  return touched ? { ...project, scenes } : project
}

/** Whether a lane can hold this clip. Audio belongs on audio lanes and everything visual
 *  on visual lanes — dragging a still onto the voice-over lane produced a clip that simply
 *  never rendered, with nothing on screen to say why. */
export function trackAcceptsScene(track: VideoTrack, scene: VideoScene): boolean {
  const wantsAudio = scene.kind === 'audio'
  if (wantsAudio) return track.kind === 'audio'
  if (scene.kind === 'caption') return track.kind === 'caption' || track.kind === 'overlay'
  return track.kind === 'video' || track.kind === 'overlay'
}

/** Moves a clip, optionally to another track. Position is clamped into the canvas and the
 *  target lane must be able to hold the clip, so a drag can never leave the timeline in a
 *  state the renderer will silently drop. */
export function moveClip(
  project: VideoProject,
  sceneId: string,
  startFrame: number,
  trackId?: string
): VideoProject {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) return project
  const span = clampSpan(project, startFrame, scene.durationFrames)
  const target = trackId ? project.tracks.find((track) => track.id === trackId) : undefined
  const nextTrack = target && !target.locked && trackAcceptsScene(target, scene) ? target.id : scene.trackId
  if (
    span.startFrame === scene.startFrame &&
    span.durationFrames === scene.durationFrames &&
    nextTrack === scene.trackId
  ) {
    return project
  }
  return mapScene(project, sceneId, (current) => ({
    ...current,
    startFrame: span.startFrame,
    durationFrames: span.durationFrames,
    trackId: nextTrack
  }))
}

/** Trims one edge. Dragging the left edge moves the start and shortens by the same
 *  amount, so the clip's right edge stays put — the behaviour every NLE has. When the clip
 *  is backed by media, `sourceRange` follows so trimming reveals different footage rather
 *  than restretching the same frames. */
export function trimClip(
  project: VideoProject,
  sceneId: string,
  edge: 'start' | 'end',
  frameDelta: number
): VideoProject {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene || frameDelta === 0) return project

  if (edge === 'end') {
    const duration = Math.max(MIN_CLIP_FRAMES, scene.durationFrames + Math.round(frameDelta))
    const span = clampSpan(project, scene.startFrame, duration)
    if (span.durationFrames === scene.durationFrames) return project
    return mapScene(project, sceneId, (current) => ({
      ...current,
      durationFrames: span.durationFrames,
      ...(current.sourceRange
        ? { sourceRange: { ...current.sourceRange, durationFrames: span.durationFrames } }
        : {})
    }))
  }

  // Leading edge: clamp so the clip cannot invert or slide out of the canvas.
  const right = scene.startFrame + scene.durationFrames
  const start = Math.max(0, Math.min(scene.startFrame + Math.round(frameDelta), right - MIN_CLIP_FRAMES))
  const consumed = start - scene.startFrame
  if (consumed === 0) return project
  return mapScene(project, sceneId, (current) => ({
    ...current,
    startFrame: start,
    durationFrames: right - start,
    ...(current.sourceRange
      ? {
          sourceRange: {
            startFrame: Math.max(0, current.sourceRange.startFrame + consumed),
            durationFrames: Math.max(MIN_CLIP_FRAMES, current.sourceRange.durationFrames - consumed)
          }
        }
      : {})
  }))
}

/** Splits a clip at an absolute frame, giving the right-hand half its own id and, for
 *  media, the source offset that keeps the footage continuous across the cut. */
export function splitClip(project: VideoProject, sceneId: string, atFrame: number): VideoProject {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) return project
  const offset = Math.round(atFrame) - scene.startFrame
  if (offset < MIN_CLIP_FRAMES || offset > scene.durationFrames - MIN_CLIP_FRAMES) return project

  const left: VideoScene = {
    ...scene,
    durationFrames: offset,
    ...(scene.sourceRange ? { sourceRange: { ...scene.sourceRange, durationFrames: offset } } : {})
  }
  const right: VideoScene = {
    ...scene,
    id: uid('scene'),
    startFrame: scene.startFrame + offset,
    durationFrames: scene.durationFrames - offset,
    ...(scene.sourceRange
      ? {
          sourceRange: {
            startFrame: scene.sourceRange.startFrame + offset,
            durationFrames: scene.sourceRange.durationFrames - offset
          }
        }
      : {})
  }
  const scenes = project.scenes.flatMap((candidate) =>
    candidate.id === sceneId ? [left, right] : [candidate]
  )
  return { ...project, scenes }
}

/** Removes a clip and any transition that referenced it — a dangling transition fails
 *  the engine's schema, so this can never be left to the caller. */
export function removeClip(project: VideoProject, sceneId: string): VideoProject {
  if (!project.scenes.some((scene) => scene.id === sceneId)) return project
  return fitCanvasDurationToContent({
    ...project,
    scenes: project.scenes.filter((scene) => scene.id !== sceneId),
    transitions: project.transitions.filter(
      (transition) => transition.fromSceneId !== sceneId && transition.toSceneId !== sceneId
    )
  })
}

/** Copies a clip immediately after itself.
 *
 *  The copy lands at full length even when the original ends at the canvas end: the canvas
 *  grows to fit it. Clamping into the existing canvas instead is what used to turn
 *  "duplicate the last clip" into a two-frame sliver stacked on the final frames — a clip
 *  too narrow to click, in the one place a user is most likely to duplicate. */
export function duplicateClip(project: VideoProject, sceneId: string): VideoProject {
  const scene = project.scenes.find((candidate) => candidate.id === sceneId)
  if (!scene) return project
  const startFrame = scene.startFrame + scene.durationFrames
  const grown = withCanvasCoveringFrame(project, startFrame + scene.durationFrames)
  const span = clampSpan(grown, startFrame, scene.durationFrames)
  const copy: VideoScene = { ...scene, id: uid('scene'), ...span }
  return { ...grown, scenes: [...grown.scenes, copy] }
}

/** Adds a clip. `kind` and its required companion field are the caller's business; this
 *  only owns placement and the id. */
export function addClip(
  project: VideoProject,
  scene: Omit<VideoScene, 'id' | 'startFrame' | 'durationFrames' | 'zIndex'> & {
    startFrame: number
    durationFrames: number
    zIndex?: number
  }
): VideoProject {
  const span = clampSpan(project, scene.startFrame, scene.durationFrames)
  const next: VideoScene = {
    ...(scene as VideoScene),
    id: uid('scene'),
    zIndex: scene.zIndex ?? 0,
    ...span
  }
  return { ...project, scenes: [...project.scenes, next] }
}

/** Splices a whole Auto B-roll run onto its own lane.
 *
 *  One call, one project, so the run is a single undo entry — that is the entire reason
 *  `videoEngine.autoBroll` returns placements instead of saving the project itself.
 *
 *  Three details are load-bearing:
 *  - The lane is its own (`auto-broll`, `order: 10`), never the manual `video-engine-broll`
 *    track. Generated clips are additive; nothing the user placed by hand is touched, moved
 *    or replaced. `order: 10` also puts them above `main-video` (order 0), whose layering
 *    the manual track cannot manage because it sits at order 0 too.
 *  - `volume: 0` on every clip. The Player shares eight audio tags
 *    (`numberOfSharedAudioTags`); twenty-five stock clips competing for them would fight
 *    the narration for the ones they cannot have.
 *  - `sourceRange` is clamped to the asset. The engine's schema rejects a range past
 *    `asset.durationFrames` outright, which would fail the save for the whole run.
 */
export function applyAutoBroll(
  project: VideoProject,
  placements: readonly AutoBrollPlacement[]
): VideoProject {
  if (placements.length === 0) return project

  const hasTrack = project.tracks.some((track) => track.id === AUTO_BROLL_TRACK_ID)
  const tracks: VideoTrack[] = hasTrack
    ? project.tracks
    : [
        ...project.tracks,
        {
          id: AUTO_BROLL_TRACK_ID,
          name: AUTO_BROLL_TRACK_NAME,
          kind: 'video',
          order: AUTO_BROLL_TRACK_ORDER,
          muted: false,
          locked: false
        }
      ]

  const assets = [...project.assets]
  const knownAssets = new Set(assets.map((asset) => asset.id))
  const existingPlacements = new Set(
    project.scenes
      .filter((scene) => scene.trackId === AUTO_BROLL_TRACK_ID && scene.kind === 'media')
      .map((scene) => `${scene.assetId}:${scene.startFrame}:${scene.durationFrames}`)
  )
  const added: VideoScene[] = []

  for (const placement of placements) {
    if (!knownAssets.has(placement.asset.id)) {
      knownAssets.add(placement.asset.id)
      assets.push(placement.asset)
    }
    const assetFrames = placement.asset.durationFrames
    const startFrame = Math.max(0, Math.round(placement.startFrame))
    let durationFrames = Math.max(MIN_CLIP_FRAMES, Math.round(placement.durationFrames))
    if (assetFrames !== undefined) durationFrames = Math.min(durationFrames, assetFrames)
    if (durationFrames < MIN_CLIP_FRAMES) continue
    const placementKey = `${placement.asset.id}:${startFrame}:${durationFrames}`
    if (existingPlacements.has(placementKey)) continue
    existingPlacements.add(placementKey)

    const sourceRange = placement.sourceRange ?? (assetFrames === undefined ? undefined : { startFrame: 0, durationFrames })
    added.push({
      id: uid('auto-broll-scene'),
      trackId: AUTO_BROLL_TRACK_ID,
      kind: 'media',
      startFrame,
      durationFrames,
      zIndex: 1,
      assetId: placement.asset.id,
      fit: 'cover',
      opacity: 1,
      volume: 0,
      ...(sourceRange && assetFrames !== undefined
        ? {
            sourceRange: {
              startFrame: Math.max(0, Math.min(sourceRange.startFrame, assetFrames - durationFrames)),
              durationFrames
            }
          }
        : {})
    })
  }

  if (added.length === 0) return project
  return { ...project, tracks, assets, scenes: [...project.scenes, ...added] }
}

/** Covers the complete project with selected stills on one dedicated lane.
 *
 * One pure transform is one editor undo entry. Existing generated scenes are replaced,
 * while every unrelated track and scene is retained. Scene ids and shuffled order are
 * deterministic for the project + selection + interval, so a repeated click is a no-op
 * and the saved project is exactly what preview and export consume. */
export function applyImageCycle(
  project: VideoProject,
  assetIds: readonly string[],
  intervalSeconds: ImageCycleInterval,
  shuffle: boolean
): VideoProject {
  if (intervalSeconds !== 3 && intervalSeconds !== 4) return project
  const imageIds = [...new Set(assetIds)].filter((id) =>
    project.assets.some((asset) => asset.id === id && asset.kind === 'image')
  )
  if (imageIds.length < 2 || project.canvas.durationFrames < 1) return project

  const existingTrack = project.tracks.find((track) => track.id === IMAGE_CYCLE_TRACK_ID)
  if (existingTrack && existingTrack.kind !== 'video' && existingTrack.kind !== 'overlay') {
    return project
  }
  const seed = mediaFillSeed(project.id, imageIds, intervalSeconds)
  const plan = planMediaFill({
    assetIds: imageIds,
    spans: [{ startFrame: 0, endFrame: project.canvas.durationFrames }],
    fps: project.canvas.fps,
    segmentSeconds: intervalSeconds,
    shuffle,
    seed
  })
  if (plan.length === 0) return project

  const generated: VideoScene[] = plan.map((slot, index) => ({
    id: `${IMAGE_CYCLE_SCENE_PREFIX}${seed.toString(36)}-${index}`,
    trackId: IMAGE_CYCLE_TRACK_ID,
    kind: 'media',
    startFrame: slot.startFrame,
    durationFrames: slot.durationFrames,
    zIndex: 0,
    assetId: slot.assetId,
    fit: 'cover',
    opacity: 1,
    volume: 0
  }))

  const currentGenerated = project.scenes.filter((scene) =>
    scene.id.startsWith(IMAGE_CYCLE_SCENE_PREFIX)
  )
  const currentById = new Map(currentGenerated.map((scene) => [scene.id, scene]))
  const alreadyApplied = Boolean(existingTrack)
    && existingTrack?.order === IMAGE_CYCLE_TRACK_ORDER
    && currentGenerated.length === generated.length
    && generated.every((scene) => {
      const current = currentById.get(scene.id)
      return current?.trackId === scene.trackId
        && current.kind === scene.kind
        && current.startFrame === scene.startFrame
        && current.durationFrames === scene.durationFrames
        && current.assetId === scene.assetId
        && current.fit === scene.fit
        && current.opacity === scene.opacity
        && current.volume === scene.volume
    })
  if (alreadyApplied) return project

  const tracks: VideoTrack[] = existingTrack
    ? project.tracks.map((track) => track.id === IMAGE_CYCLE_TRACK_ID
        ? { ...track, order: IMAGE_CYCLE_TRACK_ORDER }
        : track)
    : [...project.tracks, {
        id: IMAGE_CYCLE_TRACK_ID,
        name: IMAGE_CYCLE_TRACK_NAME,
        kind: 'video',
        order: IMAGE_CYCLE_TRACK_ORDER,
        muted: false,
        locked: false
      }]
  const kept = project.scenes.filter((scene) =>
    !scene.id.startsWith(IMAGE_CYCLE_SCENE_PREFIX)
  )
  return { ...project, tracks, scenes: [...kept, ...generated] }
}

/** Sets a per-clip field the inspector owns (opacity, volume, fit, transform, text…). */
export function patchClip(
  project: VideoProject,
  sceneId: string,
  patch: Partial<VideoScene>
): VideoProject {
  return mapScene(project, sceneId, (current) => ({ ...current, ...patch, id: current.id }))
}

/** Appends a visual lane at the front of the compositor. Audio is always drawn last in the
 *  timeline, independently of its compositor order. */
export function addTrack(
  project: VideoProject,
  kind: VideoTrack['kind'],
  name?: string
): VideoProject {
  const sameKind = project.tracks.filter((track) => track.kind === kind).length
  const track: VideoTrack = {
    id: uid(`track-${kind}`),
    name: name ?? `${kind === 'audio' ? 'Audio' : kind === 'overlay' ? 'Overlay' : 'Video'} ${sameKind + 1}`,
    kind,
    order: Math.max(0, ...project.tracks.map((existing) => existing.order + 1)),
    muted: false,
    locked: false
  }
  return { ...project, tracks: [...project.tracks, track] }
}

/** Drops a lane and everything on it. */
export function removeTrack(project: VideoProject, trackId: string): VideoProject {
  const doomed = new Set(
    project.scenes.filter((scene) => scene.trackId === trackId).map((scene) => scene.id)
  )
  return {
    ...project,
    tracks: project.tracks.filter((track) => track.id !== trackId),
    scenes: project.scenes.filter((scene) => scene.trackId !== trackId),
    transitions: project.transitions.filter(
      (transition) => !doomed.has(transition.fromSceneId) && !doomed.has(transition.toSceneId)
    )
  }
}

export function patchTrack(
  project: VideoProject,
  trackId: string,
  patch: Partial<VideoTrack>
): VideoProject {
  let touched = false
  const tracks = project.tracks.map((track) => {
    if (track.id !== trackId) return track
    touched = true
    return { ...track, ...patch, id: track.id }
  })
  return touched ? { ...project, tracks } : project
}

/** Moves one visual lane to another lane's displayed position.
 *
 * Timeline rows run foreground-to-background, so the first row receives the greatest
 * compositor order. Audio is excluded because it has no visual stacking relationship. */
export function reorderTrack(
  project: VideoProject,
  trackId: string,
  targetTrackId: string
): VideoProject {
  if (trackId === targetTrackId) return project
  const ordered = project.tracks
    .filter((track) => track.kind !== 'audio')
    .sort((left, right) => right.order - left.order || left.name.localeCompare(right.name))
  const fromIndex = ordered.findIndex((track) => track.id === trackId)
  const targetIndex = ordered.findIndex((track) => track.id === targetTrackId)
  if (fromIndex < 0 || targetIndex < 0) return project

  const [moved] = ordered.splice(fromIndex, 1)
  if (!moved) return project
  const shiftedTargetIndex = ordered.findIndex((track) => track.id === targetTrackId)
  ordered.splice(fromIndex < targetIndex ? shiftedTargetIndex + 1 : shiftedTargetIndex, 0, moved)
  const orderById = new Map(
    ordered.map((track, index) => [track.id, ordered.length - index - 1])
  )
  return {
    ...project,
    tracks: project.tracks.map((track) => {
      const order = orderById.get(track.id)
      return order === undefined || order === track.order ? track : { ...track, order }
    })
  }
}

/** The last frame any clip occupies. */
export function contentEndFrame(project: VideoProject): number {
  const sceneEnd = project.scenes.reduce(
    (end, scene) => Math.max(end, scene.startFrame + scene.durationFrames),
    0
  )
  const captionEnd =
    project.captions?.words.reduce(
      (end, word) => Math.max(end, word.endFrame),
      0
    ) ?? 0
  return Math.max(sceneEnd, captionEnd)
}

/** Grows the canvas so it covers `frame`, never shrinking it. */
export function withCanvasCoveringFrame(project: VideoProject, frame: number): VideoProject {
  const wanted = Math.max(1, Math.ceil(frame))
  if (wanted <= project.canvas.durationFrames) return project
  return { ...project, canvas: { ...project.canvas, durationFrames: wanted } }
}

/** Grows the canvas to cover every clip. Applied after each local edit as a safety net. */
export function withCanvasCoveringContent(project: VideoProject): VideoProject {
  return withCanvasCoveringFrame(project, contentEndFrame(project))
}

/** Trims canvas duration to fit actual content (minimum 10s), called on clip removal. */
export function fitCanvasDurationToContent(project: VideoProject, minDurationSec = 10): VideoProject {
  const fps = project.canvas.fps ?? 30
  const minFrames = Math.max(1, Math.round(fps * minDurationSec))
  const end = contentEndFrame(project)
  const wanted = Math.max(minFrames, end)
  if (wanted === project.canvas.durationFrames) return project
  return { ...project, canvas: { ...project.canvas, durationFrames: wanted } }
}

/** Clips that share a lane with another clip and overlap it in time.
 *
 *  Overlap is legal and load-bearing — an animated transition IS an overlap between two
 *  neighbours — so this does not prevent it. It marks it. Two absolutely-positioned clips
 *  stacked on one lane are otherwise indistinguishable from one clip, which is how a drag
 *  that landed a clip on top of its neighbour read as "dragging created a duplicate". */
export function overlappingSceneIds(project: VideoProject): Set<string> {
  const overlapping = new Set<string>()
  const byTrack = new Map<string, VideoScene[]>()
  for (const scene of project.scenes) {
    const lane = byTrack.get(scene.trackId)
    if (lane) lane.push(scene)
    else byTrack.set(scene.trackId, [scene])
  }
  for (const lane of byTrack.values()) {
    const ordered = [...lane].sort((left, right) => left.startFrame - right.startFrame)
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!
      const current = ordered[index]!
      if (current.startFrame < previous.startFrame + previous.durationFrames) {
        overlapping.add(previous.id)
        overlapping.add(current.id)
      }
    }
  }
  return overlapping
}

/** Clips on one track, in play order — what the composition and the ripple both need. */
export function clipsOnTrack(project: VideoProject, trackId: string): VideoScene[] {
  return project.scenes
    .filter((scene) => scene.trackId === trackId)
    .sort((left, right) => left.startFrame - right.startFrame)
}

/** Where a new clip of `durationFrames` should land on a track: `preferredFrame` when
 *  that span is free, otherwise the first gap that fits, otherwise straight after the last
 *  clip.
 *
 *  This exists because dropping every added clip at the playhead stacked them into one
 *  spot — click three stills and you got three clips at frame 0, perfectly overlapping and
 *  individually unclickable. Appending is what someone adding three images means. */
export function placementFrame(
  project: VideoProject,
  trackId: string,
  durationFrames: number,
  preferredFrame: number
): number {
  const occupied = clipsOnTrack(project, trackId).map((scene) => ({
    start: scene.startFrame,
    end: scene.startFrame + scene.durationFrames
  }))
  const fits = (start: number): boolean =>
    start + durationFrames <= project.canvas.durationFrames &&
    occupied.every((span) => start + durationFrames <= span.start || start >= span.end)

  if (fits(preferredFrame)) return preferredFrame
  // Try each clip's end as a candidate start, in order — that is the first real gap.
  for (const span of occupied) {
    if (span.end >= preferredFrame && fits(span.end)) return span.end
  }
  for (const span of occupied) {
    if (fits(span.end)) return span.end
  }
  // Nothing fits cleanly; append at the end of the lane and let clampSpan trim it.
  return occupied.reduce((end, span) => Math.max(end, span.end), 0)
}

/** Closes every gap on a track, butting each clip against the previous one. */
export function rippleTrack(project: VideoProject, trackId: string): VideoProject {
  const ordered = clipsOnTrack(project, trackId)
  if (ordered.length === 0) return project
  const moved = new Map<string, number>()
  let cursor = 0
  for (const scene of ordered) {
    moved.set(scene.id, cursor)
    cursor += scene.durationFrames
  }
  return {
    ...project,
    scenes: project.scenes.map((scene) => {
      const start = moved.get(scene.id)
      return start === undefined || start === scene.startFrame ? scene : { ...scene, startFrame: start }
    })
  }
}

/** Candidate frames one dragged edge should snap to: the playhead, whole seconds, and the
 *  other clips' edges — but which of a neighbour's edges depends on whose lane it is on.
 *
 *  On the SAME lane only the opposite edge is offered: a dragged leading edge snaps to a
 *  neighbour's trailing edge and vice versa. That is the join a timeline drag is reaching
 *  for, and it is the only one that is safe to offer, because start-to-start on one lane
 *  lands the clip exactly on top of its neighbour. Two stacked clips look like one, so a
 *  drag that ended in a perfect overlap read as "dragging created a duplicate" — the second
 *  clip only reappeared when the first was dragged away again.
 *
 *  Across lanes both edges stay on offer: lining an overlay up with the clip beneath it is
 *  the whole point, and stacking across lanes is visible because the lanes are separate.
 *
 *  Screen-space thresholding happens at the call site, where zoom is known. */
export function snapCandidates(
  project: VideoProject,
  dragged: { id: string; trackId: string } | null,
  playheadFrame: number,
  edge: 'start' | 'end'
): number[] {
  const frames = new Set<number>([0, playheadFrame, project.canvas.durationFrames])
  for (const scene of project.scenes) {
    if (scene.id === dragged?.id) continue
    const end = scene.startFrame + scene.durationFrames
    if (dragged && scene.trackId === dragged.trackId) {
      frames.add(edge === 'start' ? end : scene.startFrame)
      continue
    }
    frames.add(scene.startFrame)
    frames.add(end)
  }
  const fps = Math.max(1, project.canvas.fps)
  for (let second = 0; second * fps <= project.canvas.durationFrames; second += 1) {
    frames.add(second * fps)
  }
  return [...frames].sort((left, right) => left - right)
}

/** Snaps `frame` to the nearest candidate within `toleranceFrames`, else returns it
 *  unchanged. */
export function snapFrame(frame: number, candidates: number[], toleranceFrames: number): number {
  let best = frame
  let bestDistance = toleranceFrames + 1
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - frame)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return bestDistance <= toleranceFrames ? best : frame
}

/** Moves multiple clips together in lockstep across time and tracks. */
export function moveClips(
  project: VideoProject,
  sceneIds: readonly string[],
  deltaFrames: number,
  trackOffset = 0
): VideoProject {
  if (sceneIds.length === 0 || (deltaFrames === 0 && trackOffset === 0)) return project
  const idSet = new Set(sceneIds)
  const scenesToMove = project.scenes.filter((scene) => idSet.has(scene.id))
  if (scenesToMove.length === 0) return project

  const maxLeftShift = Math.min(...scenesToMove.map((scene) => scene.startFrame))
  const actualDeltaFrames = Math.max(-maxLeftShift, Math.round(deltaFrames))

  const tracks = [...project.tracks].sort((left, right) => right.order - left.order || left.name.localeCompare(right.name))
  const trackIndexById = new Map(tracks.map((track, idx) => [track.id, idx]))

  const updatedScenes = project.scenes.map((scene) => {
    if (!idSet.has(scene.id)) return scene
    const currentIdx = trackIndexById.get(scene.trackId) ?? 0
    const targetIdx = Math.max(0, Math.min(tracks.length - 1, currentIdx + trackOffset))
    const targetTrack = tracks[targetIdx]
    const nextTrackId = targetTrack && !targetTrack.locked && trackAcceptsScene(targetTrack, scene)
      ? targetTrack.id
      : scene.trackId

    return {
      ...scene,
      startFrame: Math.max(0, scene.startFrame + actualDeltaFrames),
      trackId: nextTrackId
    }
  })

  return withCanvasCoveringContent({ ...project, scenes: updatedScenes })
}

/** Removes multiple clips and any orphaned transitions. */
export function removeClips(project: VideoProject, sceneIds: readonly string[]): VideoProject {
  const idSet = new Set(sceneIds)
  if (idSet.size === 0) return project
  return fitCanvasDurationToContent({
    ...project,
    scenes: project.scenes.filter((scene) => !idSet.has(scene.id)),
    transitions: project.transitions.filter(
      (transition) => !idSet.has(transition.fromSceneId) && !idSet.has(transition.toSceneId)
    )
  })
}

/** Duplicates multiple clips immediately following the latest clip end frame. */
export function duplicateClips(project: VideoProject, sceneIds: readonly string[]): VideoProject {
  const idSet = new Set(sceneIds)
  const scenesToDup = project.scenes.filter((scene) => idSet.has(scene.id))
  if (scenesToDup.length === 0) return project

  const maxEndFrame = Math.max(...scenesToDup.map((scene) => scene.startFrame + scene.durationFrames))
  const minStartFrame = Math.min(...scenesToDup.map((scene) => scene.startFrame))
  const shift = Math.max(1, maxEndFrame - minStartFrame)

  const newScenes: VideoScene[] = scenesToDup.map((scene) => ({
    ...scene,
    id: uid('scene'),
    startFrame: scene.startFrame + shift
  }))

  return withCanvasCoveringContent({
    ...project,
    scenes: [...project.scenes, ...newScenes]
  })
}
