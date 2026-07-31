import { TransitionSeries } from '@remotion/transitions'
import { AbsoluteFill, Sequence } from 'remotion'
import type { VideoProject } from '../../shared/video-engine'
import { CaptionLayer } from './captions'
import { SceneContent, sceneLayerStyle } from './scene'
import {
  buildRemotionTransitionChains,
  transitionedSceneIds,
} from './timeline'
import { remotionTransition } from './transition'

export interface RemotionCompositionProps extends Record<string, unknown> {
  readonly project: VideoProject
}

export function RemotionVideo({ project }: RemotionCompositionProps) {
  const trackById = new Map(project.tracks.map((track) => [track.id, track]))
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

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        backgroundColor: project.canvas.backgroundColor,
      }}
    >
      {chains.map((chain) => (
        <Sequence
          key={`transition-chain:${chain.scenes[0]!.id}`}
          from={chain.startFrame}
          durationInFrames={chain.durationFrames}
          style={sceneLayerStyle(project, chain.scenes[0]!)}
        >
          {/* Flat, and every child a literal `TransitionSeries.*`. The series validates
              children by type identity, so neither a `<Fragment>` wrapper nor a custom
              component that merely renders a `TransitionSeries.Transition` is accepted —
              both made it throw and blanked the composition for ANY project with a
              transition, in the player and in a headless render alike. Hence
              `remotionTransition(...)` is called, not used as JSX. */}
          <TransitionSeries>
            {chain.scenes.flatMap((scene, index) => {
              const nodes: Array<JSX.Element | null> = [
                <TransitionSeries.Sequence
                  key={scene.id}
                  durationInFrames={scene.durationFrames}
                  style={sceneLayerStyle(project, scene)}
                >
                  <SceneContent project={project} scene={scene} />
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

      {standaloneScenes.map((scene) => (
        <Sequence
          key={scene.id}
          from={scene.startFrame}
          durationInFrames={scene.durationFrames}
          style={sceneLayerStyle(project, scene)}
        >
          <SceneContent project={project} scene={scene} />
        </Sequence>
      ))}

      <CaptionLayer project={project} />
    </AbsoluteFill>
  )
}
