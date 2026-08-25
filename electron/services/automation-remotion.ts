import { existsSync } from 'node:fs'
import {
  VideoProjectSchema,
  VideoSceneSchema,
  mediaFillSeed,
  planMediaFill,
  type VideoProject
} from '../../shared/video-engine'
import { resolveTransitionPreset } from '../../shared/video-engine/transition-presets'
import type { AutomationJobConfig, AutomationJobItem } from '../../shared/types'
import {
  automationCaptionChoice,
  automationRemotionBrollDensity,
  automationRemotionGrade,
  automationRemotionHookPlan
} from '../../shared/automationRemotion'
import { autoBroll } from '../ipc/video-engine'
import { getRepos } from '../db'
import {
  VIDEO_GRADING_PRESETS,
  bindDownload,
  getVideoEngine,
  readBinding,
  renderFileName
} from './video-engine/studio'

function downloadIdFor(item: AutomationJobItem): string {
  if (!item.projectId) throw new Error('Project checkpoint is missing; resume from Build projects.')
  const project = getRepos().getProject(item.projectId)
  if (!project) throw new Error(`Classic project checkpoint is missing: ${item.projectId}`)
  return project.downloadId
}

function brollClipIds(project: VideoProject): string[] {
  return [...new Set(project.scenes
    .filter((scene) => scene.trackId === 'auto-broll' && !!scene.assetId)
    .map((scene) => scene.assetId!))]
}

async function applyImageTimeline(project: VideoProject, config: AutomationJobConfig): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const imageIds = project.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id)
  if (imageIds.length === 0) return project
  const style = config.styleConfig
  const planned = planMediaFill({
    assetIds: imageIds,
    spans: [{ startFrame: 0, endFrame: project.canvas.durationFrames }],
    fps: project.canvas.fps,
    segmentSeconds: style.imageDurationSec,
    shuffle: style.imageShuffle,
    seed: mediaFillSeed(project.id, imageIds, style.imageDurationSec)
  })
  const generated = planned.map((slot, index) => VideoSceneSchema.parse({
    id: `automation-image-${String(index + 1).padStart(6, '0')}`,
    trackId: 'main-video',
    kind: 'media',
    startFrame: slot.startFrame,
    durationFrames: slot.durationFrames,
    zIndex: 0,
    assetId: slot.assetId,
    fit: 'cover',
    opacity: 1
  }))
  return engine.saveProject(VideoProjectSchema.parse({
    ...project,
    transitions: [],
    scenes: [
      ...project.scenes.filter((scene) => !(scene.trackId === 'main-video' && scene.kind === 'media')),
      ...generated
    ]
  }), { expectedRevision: project.revision })
}

async function applyTransitions(project: VideoProject, value: string | undefined): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const preset = resolveTransitionPreset(value)
  if (!preset.templateId) {
    if (project.transitions.length === 0) return project
    return engine.saveProject(VideoProjectSchema.parse({ ...project, transitions: [] }), {
      expectedRevision: project.revision
    })
  }
  if (project.transitions.length > 0) {
    project = await engine.saveProject(VideoProjectSchema.parse({ ...project, transitions: [] }), {
      expectedRevision: project.revision
    })
  }
  const scenes = project.scenes
    .filter((scene) => scene.trackId === 'main-video' && scene.kind === 'media')
    .sort((left, right) => left.startFrame - right.startFrame)
  let current = project
  for (let index = 0; index < scenes.length - 1; index += 1) {
    current = await engine.applyTransitionTemplate(current.id, {
      templateId: preset.templateId,
      fromSceneId: scenes[index]!.id,
      toSceneId: scenes[index + 1]!.id,
      startFrame: scenes[index + 1]!.startFrame,
      durationFrames: preset.durationFrames,
      direction: preset.direction,
      easing: 'ease-out'
    })
  }
  return current
}

async function removeCaptions(project: VideoProject): Promise<VideoProject> {
  const engine = await getVideoEngine()
  return engine.saveProject(VideoProjectSchema.parse({
    ...project,
    captions: undefined,
    scenes: project.scenes.filter((scene) => scene.kind !== 'caption')
  }), { expectedRevision: project.revision })
}

export interface PreparedAutomationRemotionProject {
  projectId: string
  brollClipIds: string[]
}

export async function prepareAutomationRemotionProject(
  item: AutomationJobItem,
  config: AutomationJobConfig
): Promise<PreparedAutomationRemotionProject> {
  const downloadId = downloadIdFor(item)
  const engine = await getVideoEngine()
  let { project } = await bindDownload(downloadId, 'remotion', { reseed: true })

  if (!config.rules.captions && project.captions) project = await removeCaptions(project)

  /* The preset's caption template, applied over whatever `bindDownload` derived from the classic
   * project's `captionPreset`. Applied unconditionally when a choice resolves rather than diffed:
   * the id can already match while the stored colours, grain or paging differ, and one extra
   * project save per item is not worth the branch. Skipped entirely when captions are off, because
   * `setCaptionTemplate` requires a caption document to exist. */
  if (project.captions) {
    const caption = automationCaptionChoice(
      config.styleConfig,
      engine.templates.list({ rendererId: 'remotion', kind: 'caption' }).map((template) => template.id)
    )
    if (caption) project = await engine.setCaptionTemplate(project.id, caption.templateId, caption.props)
  }

  if (!config.rules.autoBroll) project = await applyImageTimeline(project, config)
  project = await applyTransitions(project, config.styleConfig.transition)
  project = await engine.setGrading(project.id, automationRemotionGrade(config.styleConfig, VIDEO_GRADING_PRESETS))

  /* `list().find()` rather than `require()`: a preset holding an id this build no longer ships must
   * fall back to the automatic grade-derived hook, not throw and fail the whole batch item. */
  const hookTemplate = config.styleConfig.hookTemplateId
    ? engine.templates.list({ rendererId: 'remotion', kind: 'hook' })
        .find((template) => template.id === config.styleConfig.hookTemplateId)
    : undefined
  const hookPlan = automationRemotionHookPlan(project, config.styleConfig, hookTemplate)
  if (hookPlan) project = (await engine.importHookPlan(project.id, hookPlan)).project

  if (config.rules.autoBroll) {
    const result = await autoBroll(project.id, downloadId, {
      density: automationRemotionBrollDensity(config.styleConfig)
    })
    project = await engine.openProject(project.id)
    if (result.placements.length === 0) {
      throw new Error('Remotion Auto B-roll completed without placing any visual clips.')
    }
  }

  const problems = await engine.preflightRender(project.id)
  const errors = problems.filter((problem) => problem.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`Remotion preflight failed: ${errors.map((problem) => `${problem.code}: ${problem.message}`).join('; ')}`)
  }
  return { projectId: project.id, brollClipIds: brollClipIds(project) }
}

export interface AutomationRemotionRenderResult {
  renderJobId: string
  outputPath: string
  brollClipIds: string[]
}

export async function runAutomationRemotionRender(options: {
  item: AutomationJobItem
  config: AutomationJobConfig
  onQueued: (renderJobId: string) => void
  onProgress: (progress: number, stage: string) => void
  shouldCancel: () => boolean
  shouldPause?: () => boolean
}): Promise<AutomationRemotionRenderResult> {
  const engine = await getVideoEngine()
  const downloadId = downloadIdFor(options.item)
  let projectId = readBinding(downloadId).remotionProjectId
  if (!projectId) projectId = (await prepareAutomationRemotionProject(options.item, options.config)).projectId
  const project = await engine.openProject(projectId)

  let render = options.item.renderJobId
    ? await engine.getRenderJob(options.item.renderJobId).catch(() => undefined)
    : undefined
  if (render?.stage === 'completed' && existsSync(render.artifact?.path ?? render.outputPath)) {
    return {
      renderJobId: render.id,
      outputPath: render.artifact?.path ?? render.outputPath,
      brollClipIds: brollClipIds(render.projectSnapshot)
    }
  }
  if (render?.stage === 'failed' || render?.stage === 'canceled') render = await engine.retryRender(render.id)
  if (!render) render = await engine.enqueueRender(project.id, renderFileName(project, '.mp4'))
  options.onQueued(render.id)

  for (;;) {
    if (options.shouldCancel()) {
      await engine.cancelRender(render.id).catch(() => undefined)
      throw new Error('Remotion render cancelled by automation control state.')
    }
    if (options.shouldPause?.()) {
      await engine.cancelRender(render.id).catch(() => undefined)
      throw new Error('automation paused')
    }
    render = await engine.getRenderJob(render.id)
    options.onProgress(Math.round(render.progress * 100), render.stage)
    if (render.stage === 'completed') {
      const outputPath = render.artifact?.path ?? render.outputPath
      if (!existsSync(outputPath)) throw new Error('Remotion completed but its output file is missing.')
      return { renderJobId: render.id, outputPath, brollClipIds: brollClipIds(render.projectSnapshot) }
    }
    if (render.stage === 'failed' || render.stage === 'canceled') {
      throw new Error(render.errorMessage || `Remotion render ${render.stage}.`)
    }
    await new Promise((resolve) => setTimeout(resolve, 800))
  }
}

export async function cancelAutomationRemotionRender(renderJobId: string): Promise<void> {
  const engine = await getVideoEngine()
  await engine.cancelRender(renderJobId)
}