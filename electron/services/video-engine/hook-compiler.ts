import {
  HookPlanSchema,
  resolveTemplateProps,
  VideoProjectSchema,
  VideoSceneSchema,
  type HookPlan,
  type VideoProject,
  type VideoTrack
} from '../../../shared/video-engine'
import { VideoEngineError } from './errors'
import { VideoTemplateRegistry } from './templates/registry'

export interface HookBrollRequest {
  beatId: string
  query: string
  startFrame: number
  durationFrames: number
}

export interface CompiledHook {
  project: VideoProject
  brollRequests: HookBrollRequest[]
}

export function compileHookPlan(
  projectInput: VideoProject,
  planInput: HookPlan,
  registry: VideoTemplateRegistry
): CompiledHook {
  const project = VideoProjectSchema.parse(projectInput)
  const plan = HookPlanSchema.parse(planInput)
  if (project.rendererId !== plan.rendererId) {
    throw new VideoEngineError('INVALID_HOOK_PLAN', 'Hook plan renderer does not match the project renderer')
  }
  if (project.canvas.fps !== plan.fps) {
    throw new VideoEngineError('INVALID_HOOK_PLAN', 'Hook plan FPS does not match the project FPS')
  }
  const template = registry.require(plan.templateId, plan.templateVersion)
  if (template.kind !== 'hook' || template.rendererId !== project.rendererId) {
    throw new VideoEngineError('INVALID_TEMPLATE', 'Hook plan references an incompatible template')
  }
  if (
    plan.durationFrames < template.duration.minimumFrames
    || plan.durationFrames > template.duration.maximumFrames
  ) {
    throw new VideoEngineError('INVALID_HOOK_PLAN', 'Hook duration is outside the template limits')
  }
  const resolvedProps = resolveTemplateProps(template, plan.props ?? {})
  const knownAssets = new Set(project.assets.map((asset) => asset.id))
  const hookTrackId = 'video-engine-hook'
  const tracks: VideoTrack[] = project.tracks.filter((track) => track.id !== hookTrackId)
  tracks.push({ id: hookTrackId, name: 'Hook graphics', kind: 'overlay', order: 1, muted: false, locked: false })

  const scenes = project.scenes.filter((scene) => scene.trackId !== hookTrackId)
  const brollRequests: HookBrollRequest[] = []
  for (const beat of plan.beats) {
    if (beat.visual.kind === 'asset') {
      if (!beat.visual.assetId || !knownAssets.has(beat.visual.assetId)) {
        throw new VideoEngineError(
          'INVALID_HOOK_PLAN',
          `Hook beat ${beat.id} references an unknown asset`
        )
      }
    } else if (beat.visual.kind === 'broll' && beat.visual.searchQuery) {
      brollRequests.push({
        beatId: beat.id,
        query: beat.visual.searchQuery,
        startFrame: beat.startFrame,
        durationFrames: beat.durationFrames
      })
    }
  }
  scenes.push(VideoSceneSchema.parse({
    id: 'video-engine-hook-plan',
    trackId: hookTrackId,
    kind: 'template',
    startFrame: 0,
    durationFrames: plan.durationFrames,
    zIndex: 10,
    template: {
      id: template.id,
      version: template.version,
      rendererId: template.rendererId,
      props: {
        ...resolvedProps,
        hookPlan: plan
      }
    }
  }))

  return {
    project: VideoProjectSchema.parse({
      ...project,
      canvas: {
        ...project.canvas,
        durationFrames: Math.max(project.canvas.durationFrames, plan.durationFrames)
      },
      tracks,
      scenes,
      transitions: project.transitions.filter(
        (transition) =>
          transition.fromSceneId !== 'video-engine-hook-plan'
          && transition.toSceneId !== 'video-engine-hook-plan'
      ),
      metadata: {
        ...(project.metadata ?? {}),
        templateId: template.id,
        templateVersion: template.version
      }
    }),
    brollRequests
  }
}
