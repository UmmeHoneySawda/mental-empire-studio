import type {
  VideoProject,
  VideoScene,
  VideoTransition,
} from '../../shared/video-engine'
import { SUPPORTED_REMOTION_TRANSITIONS } from './constants'

export interface RemotionTransitionChain {
  readonly startFrame: number
  readonly scenes: readonly VideoScene[]
  readonly transitions: readonly VideoTransition[]
  readonly durationFrames: number
}

/* Every animated type `remotionTransition` can build a presentation for.
 *
 * This used to be a hand-written `fade | slide | wipe` list, and that is how `zoom`, `blur`
 * and `dip-to-black` came to be dead: transition.tsx implements all three, preflight
 * accepts all three, the inspector offers all three — but they were filtered out here, so
 * they never entered a `TransitionSeries` chain. Their scenes fell through to the
 * standalone branch and rendered as a plain overlap: no animation, no warning, in the
 * player and in a headless render alike.
 *
 * Deriving the set from `SUPPORTED_REMOTION_TRANSITIONS` (minus `cut`, which is the one
 * type with no presentation) means the gate cannot drift from the renderer again. */
const ANIMATED_REMOTION_TRANSITIONS: ReadonlySet<string> = new Set(
  SUPPORTED_REMOTION_TRANSITIONS.filter((type) => type !== 'cut'),
)

function isRenderableTransition(transition: VideoTransition): boolean {
  return (
    transition.durationFrames > 0 && ANIMATED_REMOTION_TRANSITIONS.has(transition.type)
  )
}

/**
 * TransitionSeries lays the destination scene over the tail of the source
 * scene. Only opt into it when the renderer-neutral timeline describes that
 * exact overlap; otherwise rendering the scenes at their absolute positions is
 * safer than silently moving media.
 */
export function isTransitionTimelineAligned(
  from: VideoScene,
  to: VideoScene,
  transition: VideoTransition,
): boolean {
  const overlapStart =
    from.startFrame + from.durationFrames - transition.durationFrames
  return (
    from.trackId === to.trackId &&
    to.startFrame === overlapStart &&
    transition.startFrame === overlapStart
  )
}

export function calculateTransitionChainDurationInFrames(
  scenes: readonly VideoScene[],
  transitions: readonly VideoTransition[],
): number {
  const sceneFrames = scenes.reduce((total, scene) => total + scene.durationFrames, 0)
  const overlapFrames = transitions.reduce(
    (total, transition) => total + transition.durationFrames,
    0,
  )
  return Math.max(1, sceneFrames - overlapFrames)
}

/**
 * Finds unambiguous, same-track scene chains that Remotion can safely express as
 * TransitionSeries. Invalid or branching links remain ordinary absolute scenes and
 * are reported by the adapter's validation pass.
 */
export function buildRemotionTransitionChains(
  project: VideoProject,
): readonly RemotionTransitionChain[] {
  const sceneById = new Map(project.scenes.map((scene) => [scene.id, scene]))
  const candidates = project.transitions.filter((transition) => {
    if (!isRenderableTransition(transition)) return false
    const from = sceneById.get(transition.fromSceneId)
    const to = sceneById.get(transition.toSceneId)
    return Boolean(
      from &&
        to &&
        from.kind !== 'audio' &&
        from.kind !== 'caption' &&
        to.kind !== 'audio' &&
        to.kind !== 'caption' &&
        isTransitionTimelineAligned(from, to, transition),
    )
  })

  const outgoing = new Map<string, VideoTransition>()
  const incoming = new Map<string, VideoTransition>()
  const ambiguous = new Set<string>()

  for (const transition of candidates) {
    if (outgoing.has(transition.fromSceneId)) ambiguous.add(transition.fromSceneId)
    if (incoming.has(transition.toSceneId)) ambiguous.add(transition.toSceneId)
    outgoing.set(transition.fromSceneId, transition)
    incoming.set(transition.toSceneId, transition)
  }

  const roots = candidates
    .map((transition) => transition.fromSceneId)
    .filter((id, index, all) => all.indexOf(id) === index)
    .filter((id) => !incoming.has(id) && !ambiguous.has(id))
    .sort((left, right) => {
      const leftScene = sceneById.get(left)
      const rightScene = sceneById.get(right)
      return (leftScene?.startFrame ?? 0) - (rightScene?.startFrame ?? 0)
    })

  const consumed = new Set<string>()
  const chains: RemotionTransitionChain[] = []

  for (const rootId of roots) {
    if (consumed.has(rootId)) continue
    const scenes: VideoScene[] = []
    const transitions: VideoTransition[] = []
    const visiting = new Set<string>()
    let currentId: string | undefined = rootId

    while (currentId && !visiting.has(currentId) && !ambiguous.has(currentId)) {
      const scene = sceneById.get(currentId)
      if (!scene) break
      visiting.add(currentId)
      scenes.push(scene)

      const transition = outgoing.get(currentId)
      if (!transition || ambiguous.has(transition.toSceneId)) break
      const nextScene = sceneById.get(transition.toSceneId)
      if (!nextScene || nextScene.trackId !== scene.trackId) break
      transitions.push(transition)
      currentId = transition.toSceneId
    }

    if (scenes.length < 2 || transitions.length !== scenes.length - 1) continue
    for (const scene of scenes) consumed.add(scene.id)
    chains.push({
      startFrame: scenes[0]!.startFrame,
      scenes,
      transitions,
      durationFrames: calculateTransitionChainDurationInFrames(scenes, transitions),
    })
  }

  return chains
}

export function transitionedSceneIds(
  chains: readonly RemotionTransitionChain[],
): ReadonlySet<string> {
  return new Set(chains.flatMap((chain) => chain.scenes.map((scene) => scene.id)))
}

export function calculateProjectContentDurationInFrames(project: VideoProject): number {
  const chains = buildRemotionTransitionChains(project)
  const chainedIds = transitionedSceneIds(chains)
  const chainEnd = chains.reduce(
    (latest, chain) => Math.max(latest, chain.startFrame + chain.durationFrames),
    0,
  )
  const sceneEnd = project.scenes.reduce(
    (latest, scene) =>
      chainedIds.has(scene.id)
        ? latest
        : Math.max(latest, scene.startFrame + scene.durationFrames),
    0,
  )
  const captionEnd =
    project.captions?.words.reduce(
      (latest, word) => Math.max(latest, word.endFrame),
      0,
    ) ?? 0

  return Math.max(1, chainEnd, sceneEnd, captionEnd)
}

export function calculateCompositionDurationInFrames(project: VideoProject): number {
  return Math.max(
    1,
    project.canvas.durationFrames,
    calculateProjectContentDurationInFrames(project),
  )
}
