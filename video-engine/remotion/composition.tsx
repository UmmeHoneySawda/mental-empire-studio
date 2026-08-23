import { useMemo } from 'react'
import { TransitionSeries } from '@remotion/transitions'
import { AbsoluteFill, Sequence } from 'remotion'
import type { VideoAsset, VideoProject, VideoScene } from '../../shared/video-engine'
import { CaptionLayer } from './captions'
import { NewCaptionLayer, usesNewCaptionTemplate } from './new-templates/captions'
import {
  SceneContent,
  sceneLayerStyle,
  type PreparedSceneRenderData,
} from './scene'
import {
  buildRemotionTransitionChains,
  transitionedSceneIds,
} from './timeline'
import { remotionTransition } from './transition'

export interface RemotionCompositionProps extends Record<string, unknown> {
  readonly project: VideoProject
}

export interface RemotionRenderPlan {
  readonly renderableProject: VideoProject
  readonly chains: ReturnType<typeof buildRemotionTransitionChains>
  readonly standaloneScenes: readonly VideoScene[]
  readonly sceneDataById: ReadonlyMap<string, PreparedSceneRenderData>
  readonly assetById: ReadonlyMap<string, VideoAsset>
}

export function createRemotionRenderPlan(project: VideoProject): RemotionRenderPlan {
  const trackById = new Map(project.tracks.map((track) => [track.id, track]))
  const assetById = new Map(project.assets.map((asset) => [asset.id, asset]))
  const renderableProject: VideoProject = {
    ...project,
    scenes: project.scenes.filter(
      (scene) =>
        scene.kind !== 'caption' && !trackById.get(scene.trackId)?.muted,
    ),
  }
  const chains = buildRemotionTransitionChains(renderableProject)
  const chainedIds = transitionedSceneIds(chains)
  const standaloneScenes = renderableProject.scenes
    .filter((scene) => !chainedIds.has(scene.id))
    .sort((left, right) => {
      const leftOrder = trackById.get(left.trackId)?.order ?? 0
      const rightOrder = trackById.get(right.trackId)?.order ?? 0
      return (
        leftOrder - rightOrder ||
        left.zIndex - right.zIndex ||
        left.startFrame - right.startFrame
      )
    })
  const sceneDataById = new Map(
    project.scenes.map((scene) => {
      const track = trackById.get(scene.trackId)
      return [
        scene.id,
        {
          asset: scene.assetId ? assetById.get(scene.assetId) : undefined,
          muted: track?.muted ?? false,
          trackOrder: track?.order ?? 0,
        } satisfies PreparedSceneRenderData,
      ] as const
    }),
  )

  return {
    renderableProject,
    chains,
    standaloneScenes,
    sceneDataById,
    assetById,
  }
}

export function RemotionVideo({ project }: RemotionCompositionProps) {
  const plan = useMemo(() => createRemotionRenderPlan(project), [project])
  // Walks project.scenes, so memoise it rather than re-deciding on every painted frame.
  const cinematicCaptions = useMemo(() => usesNewCaptionTemplate(project), [project])

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        backgroundColor: project.canvas.backgroundColor,
        isolation: 'isolate',
      }}
    >
      {plan.chains.map((chain) => (
        <Sequence
          key={`transition-chain:${chain.scenes[0]!.id}`}
          from={chain.startFrame}
          durationInFrames={chain.durationFrames}
          // One second of premount so a scene's media is decoded before its first painted
          // frame. Premounted subtrees render but are not painted, and the `<Player>` — unlike
          // the render — does not block on asset readiness, so without this every scene
          // boundary starts blank. Deliberately not on `TransitionSeries.Sequence`: that
          // component validates children by type identity and has its own prop surface.
          premountFor={project.canvas.fps}
          style={sceneLayerStyle(
            project,
            chain.scenes[0]!,
            plan.sceneDataById.get(chain.scenes[0]!.id),
          )}
        >
          {/* Flat, and every child a literal `TransitionSeries.*`. The series validates
              children by type identity, so neither a `<Fragment>` wrapper nor a custom
              component that merely renders a `TransitionSeries.Transition` is accepted. */}
          <TransitionSeries>
            {chain.scenes.flatMap((scene, index) => {
              const prepared = plan.sceneDataById.get(scene.id)
              const nodes: Array<JSX.Element | null> = [
                <TransitionSeries.Sequence
                  key={scene.id}
                  durationInFrames={scene.durationFrames}
                  style={sceneLayerStyle(project, scene, prepared)}
                >
                  <SceneContent
                    project={project}
                    scene={scene}
                    prepared={prepared}
                    assetById={plan.assetById}
                  />
                </TransitionSeries.Sequence>,
              ]
              const transition = chain.transitions[index]
              if (transition) {
                nodes.push(remotionTransition(transition, `${scene.id}:transition`))
              }
              return nodes.filter((node): node is JSX.Element => node !== null)
            })}
          </TransitionSeries>
        </Sequence>
      ))}

      {plan.standaloneScenes.map((scene) => {
        const prepared = plan.sceneDataById.get(scene.id)
        return (
          <Sequence
            key={scene.id}
            from={scene.startFrame}
            durationInFrames={scene.durationFrames}
            premountFor={project.canvas.fps}
            style={sceneLayerStyle(project, scene, prepared)}
          >
            <SceneContent
              project={project}
              scene={scene}
              prepared={prepared}
              assetById={plan.assetById}
            />
          </Sequence>
        )
      })}

      {/* Exactly one caption layer draws. The Cinematic set has its own typography, paging and film
          texture, and resolveCaptionStyle would otherwise fall back to `highlight` and silently
          render one of the existing styles instead. */}
      {cinematicCaptions
        ? <NewCaptionLayer project={project} />
        : <CaptionLayer project={project} />}
    </AbsoluteFill>
  )
}
