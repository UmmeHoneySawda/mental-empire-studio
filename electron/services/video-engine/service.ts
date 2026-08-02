import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildHookPlanPrompt,
  buildImportantWordsPrompt,
  captionGroupingOptionsForStyle,
  createCaptionDocument,
  groupCaptionCues,
  importImportantWords,
  parseHookPlan,
  applyHookBeatPatch,
  HookBeatPatchSchema,
  HookPlanSchema,
  type HookBeatPatch,
  resolveTemplateProps,
  resolveCaptionStyle,
  safeParseVideoProject,
  VideoGradingSchema,
  VideoProjectSchema,
  VideoSceneSchema,
  VideoTransitionSchema,
  type CaptionGroupingOptions,
  type CaptionWord,
  type HookPlanPromptOptions,
  type ImportantWordPromptOptions,
  type InstantiateTemplateInput,
  type JsonObject,
  type RendererId,
  type TemplateManifest,
  type TemplateFilter,
  type VideoAsset,
  type VideoGrading,
  type VideoProject
} from '../../../shared/video-engine'
import { sentryLog } from '../sentry'
import type { BrollCandidate, BrollSearchQuery, CachedBrollAsset } from './broll/types'
import { BrollService } from './broll/service'
import { captionWordsFromSrt } from './captions/import'
import { VideoEngineError } from './errors'
import { ProjectEditSession } from './edit-session'
import { compileHookPlan, type CompiledHook, type HookBrollRequest } from './hook-compiler'
import { assertSafeId, ensureDirectory, resolveInside } from './paths'
import { preflightProject } from './render/preflight'
import { RenderQueue } from './render/queue'
import type { RendererAdapter, RenderJobListener, RenderJobRecord, RenderProblem } from './render/types'
import { RenderJobStore } from './storage/job-store'
import {
  type CreateProjectInput,
  type SaveProjectOptions,
  VideoProjectStore
} from './storage/project-store'
import { VideoTemplateRegistry } from './templates/registry'

export interface VideoEnginePaths {
  projects: string
  jobs: string
  brollCache: string
}

export interface PlaceBrollInput {
  candidate: BrollCandidate
  cached: CachedBrollAsset
  trackId?: string
  startFrame: number
  durationFrames: number
  zIndex?: number
}

export interface ApplyTransitionTemplateInput {
  templateId: string
  templateVersion?: string
  id?: string
  fromSceneId: string
  toSceneId: string
  startFrame: number
  durationFrames?: number
  direction?: 'left' | 'right' | 'up' | 'down'
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

const CAPTION_TRACK_ID = 'video-engine-captions'
const CAPTION_SCENE_ID = 'video-engine-captions'

function applyCaptionTemplateToProject(
  project: VideoProject,
  template: TemplateManifest,
  props: JsonObject
): VideoProject {
  const resolvedProps = resolveTemplateProps(template, props)
  const tracks = project.tracks.some((track) => track.id === CAPTION_TRACK_ID)
    ? project.tracks
    : [
        ...project.tracks,
        {
          id: CAPTION_TRACK_ID,
          name: 'Captions',
          kind: 'caption' as const,
          order: 10_000,
          muted: false,
          locked: false
        }
      ]
  const scene = VideoSceneSchema.parse({
    id: CAPTION_SCENE_ID,
    trackId: CAPTION_TRACK_ID,
    kind: 'caption',
    startFrame: 0,
    durationFrames: project.canvas.durationFrames,
    zIndex: 10_000,
    template: {
      id: template.id,
      version: template.version,
      rendererId: template.rendererId,
      props: resolvedProps
    }
  })
  return VideoProjectSchema.parse({
    ...project,
    tracks,
    scenes: [
      ...project.scenes.filter((candidate) => candidate.id !== CAPTION_SCENE_ID),
      scene
    ]
  })
}

/** Exported for Auto B-roll, which builds assets outside `placeBroll` (it returns
 *  placements for the renderer to splice in rather than saving the project itself).
 *  Duplicating the licence mapping is how the two paths would drift apart. */
export function brollAssetForProject(
  project: VideoProject,
  candidate: BrollCandidate,
  cached: CachedBrollAsset
): VideoAsset {
  const assetId = `broll:${cached.sha256.slice(0, 24)}`
  const candidateTitle = candidate.title.trim()
  // Provider descriptions are untrusted input. Coverr in particular can return a full
  // paragraph here, while the strict project schema caps every asset name at 512 chars.
  // Bound it at the bridge into the project so a successful download can always be saved.
  const assetName = (candidateTitle || `B-roll ${candidate.id}`).slice(0, 512)
  // Cached stock footage downloads locally but keeps its provider source and licence.
  const isLocal = candidate.sourceUrl.startsWith('file:')
  const provider = isLocal
    ? 'local'
    : ['pexels', 'pixabay', 'coverr'].includes(candidate.provider)
      ? candidate.provider
      : 'custom'
  const mimeType = {
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm'
  }[extname(cached.absolutePath).toLowerCase()] ?? 'video/mp4'
  return {
    id: assetId,
    name: assetName,
    kind: 'video',
    uri: pathToFileURL(cached.absolutePath).toString(),
    mimeType,
    checksum: cached.sha256,
    width: candidate.width || undefined,
    height: candidate.height || undefined,
    durationFrames: candidate.durationMs
      ? Math.max(1, Math.round(candidate.durationMs / 1000 * project.canvas.fps))
      : undefined,
    source: isLocal
      ? { kind: 'local' }
      : {
          kind: 'stock',
          provider,
          providerAssetId: candidate.id,
          sourceUrl: candidate.sourceUrl,
          licenseName: candidate.license.name,
          licenseUrl: candidate.license.url,
          attribution: candidate.license.attribution,
          author: candidate.author
        }
  }
}

export class VideoEngineService {
  readonly projects: VideoProjectStore
  readonly templates: VideoTemplateRegistry
  readonly broll: BrollService
  readonly queue: RenderQueue
  private readonly adapters = new Map<RendererId, RendererAdapter>()

  constructor(
    readonly paths: VideoEnginePaths,
    adapters: Iterable<RendererAdapter>,
    options: {
      templates?: VideoTemplateRegistry
      broll?: BrollService
      renderConcurrency?: number
    } = {}
  ) {
    this.projects = new VideoProjectStore(paths.projects)
    this.templates = options.templates ?? new VideoTemplateRegistry()
    this.broll = options.broll ?? BrollService.withRemoteProviders(paths.brollCache, {})
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate renderer adapter: ${adapter.id}`)
      this.adapters.set(adapter.id, adapter)
    }
    this.queue = new RenderQueue(
      new RenderJobStore(paths.jobs),
      this.adapters.values(),
      options.renderConcurrency ?? 1,
      this.templates
    )
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.projects.initialize(),
      ensureDirectory(this.paths.jobs),
      ensureDirectory(this.paths.brollCache)
    ])
    await this.queue.initialize()
  }

  createProject(input: CreateProjectInput): Promise<VideoProject> {
    return this.projects.create(input)
  }

  openProject(id: string): Promise<VideoProject> {
    return this.projects.open(id)
  }

  saveProject(project: VideoProject, options?: SaveProjectOptions): Promise<VideoProject> {
    return this.projects.save(project, options)
  }

  listProjects(): Promise<VideoProject[]> {
    return this.projects.list()
  }

  deleteProject(id: string): Promise<void> {
    return this.projects.delete(id)
  }

  async openEditSession(
    id: string,
    options?: { maxHistory?: number; autosaveMs?: number }
  ): Promise<ProjectEditSession> {
    return new ProjectEditSession(await this.projects.open(id), this.projects, options)
  }

  validateProject(input: unknown): ReturnType<typeof safeParseVideoProject> {
    return safeParseVideoProject(input)
  }

  listTemplates(filter: TemplateFilter = {}) {
    return this.templates.list(filter)
  }

  /** The registered renderer adapters, exposed so the UI layer can read renderer
   *  capabilities and stage a real preview through the same code the queue uses. */
  listRendererIds(): RendererId[] {
    return [...this.adapters.keys()]
  }

  rendererAdapter(id: RendererId): RendererAdapter | undefined {
    return this.adapters.get(id)
  }

  async instantiateTemplate(
    projectId: string,
    input: InstantiateTemplateInput
  ): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    const { manifest, scene } = this.templates.instantiate(input)
    if (manifest.kind === 'caption' || manifest.kind === 'transition') {
      throw new VideoEngineError(
        'INVALID_TEMPLATE',
        `${manifest.kind} templates must be applied through their dedicated service method`
      )
    }
    if (manifest.rendererId !== project.rendererId) {
      throw new VideoEngineError('INVALID_TEMPLATE', 'Template renderer does not match the project')
    }
    if (!project.tracks.some((track) => track.id === scene.trackId)) {
      throw new VideoEngineError('INVALID_TEMPLATE', `Template track does not exist: ${scene.trackId}`)
    }
    return this.projects.save(VideoProjectSchema.parse({
      ...project,
      scenes: [...project.scenes, scene]
    }), { expectedRevision: project.revision })
  }

  buildHookPlanPrompt(options: HookPlanPromptOptions): string {
    const template = this.templates.require(options.templateId, options.templateVersion)
    if (template.kind !== 'hook' || template.rendererId !== options.rendererId) {
      throw new VideoEngineError('INVALID_TEMPLATE', 'Selected template is not a compatible hook template')
    }
    const propertyContract = template.parameters.map((parameter) => ({
      key: parameter.key,
      type: parameter.type,
      required: parameter.required,
      default: parameter.default,
      values: parameter.type === 'enum' ? parameter.values : undefined,
      minimum: parameter.type === 'number' ? parameter.minimum : undefined,
      maximum: parameter.type === 'number' ? parameter.maximum : undefined
    }))
    return [
      buildHookPlanPrompt({
        ...options,
        templateVersion: template.version
      }),
      `Template props contract: ${JSON.stringify(propertyContract)}`,
      'Only use keys from the template props contract inside props.'
    ].join('\n')
  }

  async importHookPlan(projectId: string, json: string | unknown): Promise<CompiledHook> {
    const project = await this.projects.open(projectId)
    const compiled = compileHookPlan(project, parseHookPlan(json), this.templates)
    const saved = await this.projects.save(compiled.project, { expectedRevision: project.revision })
    return { ...compiled, project: saved }
  }

  buildImportantWordsPrompt(
    project: VideoProject,
    options: ImportantWordPromptOptions = {}
  ): string {
    if (!project.captions) throw new VideoEngineError('INVALID_PROJECT', 'Project has no captions')
    return buildImportantWordsPrompt(project.captions, options)
  }

  async applyImportantWordsResponse(
    projectId: string,
    json: string | unknown,
    options: Parameters<typeof importImportantWords>[2] = {}
  ): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    if (!project.captions) throw new VideoEngineError('INVALID_PROJECT', 'Project has no captions')
    const captions = importImportantWords(json, project.captions, options)
    return this.projects.save(VideoProjectSchema.parse({ ...project, captions }), {
      expectedRevision: project.revision
    })
  }

  async setCaptions(input: {
    projectId: string
    id?: string
    language?: string
    templateId?: string
    templateProps?: JsonObject
    words: readonly CaptionWord[]
  }): Promise<VideoProject> {
    const project = await this.projects.open(input.projectId)
    let template: TemplateManifest | undefined
    if (input.templateId) {
      template = this.templates.require(input.templateId)
      if (template.kind !== 'caption' || template.rendererId !== project.rendererId) {
        throw new VideoEngineError('INVALID_TEMPLATE', 'Caption template is not compatible with this project')
      }
    }
    const captions = createCaptionDocument({
      id: input.id ?? `captions:${randomUUID()}`,
      language: input.language,
      templateId: input.templateId,
      words: input.words
    })
    const withCaptions = VideoProjectSchema.parse({ ...project, captions })
    const next = template
      ? applyCaptionTemplateToProject(withCaptions, template, input.templateProps ?? {})
      : withCaptions
    return this.projects.save(next, {
      expectedRevision: project.revision
    })
  }

  async setCaptionsFromSrt(input: {
    projectId: string
    srt: string
    id?: string
    idPrefix?: string
    language?: string
    templateId?: string
    templateProps?: JsonObject
  }): Promise<VideoProject> {
    const project = await this.projects.open(input.projectId)
    return this.setCaptions({
      projectId: input.projectId,
      id: input.id,
      language: input.language,
      templateId: input.templateId,
      templateProps: input.templateProps,
      words: captionWordsFromSrt(input.srt, project.canvas.fps, input.idPrefix)
    })
  }

  async setCaptionTemplate(
    projectId: string,
    templateId: string,
    props: JsonObject = {}
  ): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    if (!project.captions) throw new VideoEngineError('INVALID_PROJECT', 'Project has no captions')
    const template = this.templates.require(templateId)
    if (template.kind !== 'caption' || template.rendererId !== project.rendererId) {
      throw new VideoEngineError('INVALID_TEMPLATE', 'Caption template is not compatible with this project')
    }
    const withTemplate = VideoProjectSchema.parse({
      ...project,
      captions: {
        ...project.captions,
        templateId: template.id
      }
    })
    return this.projects.save(
      applyCaptionTemplateToProject(withTemplate, template, props),
      { expectedRevision: project.revision }
    )
  }

  async applyTransitionTemplate(
    projectId: string,
    input: ApplyTransitionTemplateInput
  ): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    const template = this.templates.require(input.templateId, input.templateVersion)
    if (template.kind !== 'transition' || template.rendererId !== project.rendererId) {
      throw new VideoEngineError('INVALID_TEMPLATE', 'Transition template is not compatible with this project')
    }
    const type = template.implementationId.replace(/^transition-/u, '')
    const durationFrames = input.durationFrames ?? template.duration.defaultFrames

    // An animated transition is an OVERLAP: the renderers require the destination scene
    // to start exactly `durationFrames` before the source ends
    // (isTransitionTimelineAligned in video-engine/remotion/timeline.ts). Scenes laid out
    // end-to-end do not satisfy that, so every crossfade added from the UI used to fail
    // preflight with `transition.timeline-mismatch` and take the HyperFrames preview
    // build down with it. Create the overlap here instead of asking the user to do frame
    // arithmetic: pull the destination — and everything after it on the same track —
    // back by the transition length.
    let scenes = project.scenes
    let startFrame = input.startFrame
    if (type !== 'cut') {
      const from = project.scenes.find((scene) => scene.id === input.fromSceneId)
      const to = project.scenes.find((scene) => scene.id === input.toSceneId)
      if (!from || !to) {
        throw new VideoEngineError('INVALID_PROJECT', 'Transition references a scene that is not on the timeline')
      }
      if (from.trackId !== to.trackId) {
        throw new VideoEngineError('INVALID_PROJECT', 'A transition can only join two clips on the same track')
      }
      if (durationFrames >= from.durationFrames || durationFrames >= to.durationFrames) {
        throw new VideoEngineError(
          'INVALID_PROJECT',
          `A ${durationFrames}-frame transition does not fit: both clips must be longer than the transition.`
        )
      }
      const overlapStart = from.startFrame + from.durationFrames - durationFrames
      const shift = overlapStart - to.startFrame
      if (shift !== 0) {
        // Everything at or after the destination moves together, so the rest of the
        // track keeps its spacing instead of leaving a hole where the overlap was taken.
        scenes = project.scenes.map((scene) =>
          scene.trackId === to.trackId && scene.startFrame >= to.startFrame
            ? { ...scene, startFrame: Math.max(0, scene.startFrame + shift) }
            : scene
        )
      }
      startFrame = overlapStart
    }

    const transition = VideoTransitionSchema.parse({
      id: input.id ?? `transition:${randomUUID()}`,
      fromSceneId: input.fromSceneId,
      toSceneId: input.toSceneId,
      startFrame,
      durationFrames,
      type,
      direction: input.direction,
      easing: input.easing
    })
    return this.projects.save(VideoProjectSchema.parse({
      ...project,
      scenes,
      transitions: [
        ...project.transitions.filter((item) => item.id !== transition.id),
        transition
      ]
    }), { expectedRevision: project.revision })
  }

  async removeTransition(projectId: string, transitionId: string): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    const transitions = project.transitions.filter((transition) => transition.id !== transitionId)
    if (transitions.length === project.transitions.length) {
      throw new VideoEngineError('INVALID_PROJECT', `Unknown transition: ${transitionId}`)
    }
    return this.projects.save(VideoProjectSchema.parse({
      ...project,
      transitions
    }), { expectedRevision: project.revision })
  }

  async setGrading(projectId: string, grading: VideoGrading): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    return this.projects.save(VideoProjectSchema.parse({
      ...project,
      grading: VideoGradingSchema.parse(grading)
    }), { expectedRevision: project.revision })
  }

  compileCaptionCues(project: VideoProject, options: Partial<CaptionGroupingOptions> = {}) {
    if (!project.captions) return []
    const scene = project.scenes.find(
      (candidate) =>
        candidate.kind === 'caption' &&
        candidate.template?.id === project.captions?.templateId,
    )
    const style = resolveCaptionStyle(
      scene?.template?.id ?? project.captions.templateId,
      scene?.template?.props,
    )
    return groupCaptionCues(project.captions, {
      ...captionGroupingOptionsForStyle(style, project.canvas.fps),
      ...options,
    })
  }

  searchBroll(
    query: BrollSearchQuery,
    options?: { providers?: string[]; signal?: AbortSignal; localFirst?: boolean }
  ): Promise<BrollCandidate[]> {
    return this.broll.search(query, options)
  }

  cacheBroll(candidate: BrollCandidate, signal?: AbortSignal): Promise<CachedBrollAsset> {
    return this.broll.cacheCandidate(candidate, signal)
  }

  async placeBroll(projectId: string, input: PlaceBrollInput): Promise<VideoProject> {
    const project = await this.projects.open(projectId)
    if (!Number.isInteger(input.startFrame) || !Number.isInteger(input.durationFrames) || input.durationFrames < 1) {
      throw new VideoEngineError('INVALID_PROJECT', 'B-roll placement must use positive integer frame timing')
    }
    const trackId = input.trackId ?? 'video-engine-broll'
    const asset = brollAssetForProject(project, input.candidate, input.cached)
    const assetId = asset.id
    const sceneId = `broll-scene:${randomUUID()}`
    const track = project.tracks.find((item) => item.id === trackId) ?? {
      id: trackId,
      name: 'B-roll',
      kind: 'video' as const,
      order: 0,
      muted: false,
      locked: false
    }
    const scene = VideoSceneSchema.parse({
      id: sceneId,
      trackId,
      kind: 'media',
      startFrame: input.startFrame,
      durationFrames: input.durationFrames,
      zIndex: input.zIndex ?? 1,
      assetId,
      fit: 'cover',
      opacity: 1
    })
    const next = VideoProjectSchema.parse({
      ...project,
      assets: [...project.assets.filter((item) => item.id !== assetId), asset],
      tracks: project.tracks.some((item) => item.id === trackId) ? project.tracks : [...project.tracks, track],
      scenes: [...project.scenes, scene]
    })
    return this.projects.save(next, { expectedRevision: project.revision })
  }

  async resolveHookBroll(input: {
    projectId: string
    beatId: string
    candidate: BrollCandidate
    cached: CachedBrollAsset
  }): Promise<VideoProject> {
    const project = await this.projects.open(input.projectId)
    const hookScene = project.scenes.find((scene) => scene.id === 'video-engine-hook-plan')
    const planResult = HookPlanSchema.safeParse(hookScene?.template?.props['hookPlan'])
    if (!hookScene?.template || !planResult.success) {
      throw new VideoEngineError('INVALID_HOOK_PLAN', 'Project does not contain a compiled hook plan')
    }
    const beatIndex = planResult.data.beats.findIndex((beat) => beat.id === input.beatId)
    if (beatIndex < 0) throw new VideoEngineError('INVALID_HOOK_PLAN', `Unknown hook beat: ${input.beatId}`)
    const asset = brollAssetForProject(project, input.candidate, input.cached)
    const beats = planResult.data.beats.map((beat, index) => index === beatIndex
      ? {
          ...beat,
          visual: {
            kind: 'asset' as const,
            assetId: asset.id
          }
        }
      : beat)
    const hookPlan = HookPlanSchema.parse({ ...planResult.data, beats })
    const scenes = project.scenes.map((scene) => scene.id === hookScene.id
      ? VideoSceneSchema.parse({
          ...scene,
          template: {
            ...scene.template!,
            props: {
              ...scene.template!.props,
              hookPlan
            }
          }
        })
      : scene)
    return this.projects.save(VideoProjectSchema.parse({
      ...project,
      assets: [...project.assets.filter((item) => item.id !== asset.id), asset],
      scenes
    }), { expectedRevision: project.revision })
  }

  /**
   * Edits one beat of the compiled hook plan.
   *
   * Deliberately not routed through `updateScene`'s templateProps merge: that validates
   * only against VideoSceneSchema, whose `props` is an untyped JsonObject, so a plan with
   * overlapping beats or a beat past the end would save happily and only surface later as
   * a preflight failure. `applyHookBeatPatch` enforces the plan's own invariants and the
   * result is parsed before it is written.
   */
  async updateHookBeat(input: {
    projectId: string
    beatId: string
    patch: HookBeatPatch
  }): Promise<VideoProject> {
    const project = await this.projects.open(input.projectId)
    const hookScene = project.scenes.find((scene) => scene.id === 'video-engine-hook-plan')
    const planResult = HookPlanSchema.safeParse(hookScene?.template?.props['hookPlan'])
    if (!hookScene?.template || !planResult.success) {
      throw new VideoEngineError('INVALID_HOOK_PLAN', 'Project does not contain a compiled hook plan')
    }
    let hookPlan
    try {
      hookPlan = applyHookBeatPatch(planResult.data, input.beatId, HookBeatPatchSchema.parse(input.patch))
    } catch (error) {
      throw new VideoEngineError('INVALID_HOOK_PLAN', error instanceof Error ? error.message : String(error))
    }
    // The hook scene has to stay at least as long as the plan it carries, or preflight
    // rejects it with hook-plan.too-long.
    const durationFrames = Math.max(hookScene.durationFrames, hookPlan.durationFrames)
    const scenes = project.scenes.map((scene) => scene.id === hookScene.id
      ? VideoSceneSchema.parse({
          ...scene,
          durationFrames,
          template: { ...scene.template!, props: { ...scene.template!.props, hookPlan } }
        })
      : scene)
    return this.projects.save(VideoProjectSchema.parse({ ...project, scenes }), {
      expectedRevision: project.revision
    })
  }

  unresolvedHookBroll(compiled: CompiledHook): readonly HookBrollRequest[] {
    return compiled.brollRequests
  }

  async preflightRender(projectId: string): Promise<RenderProblem[]> {
    const project = await this.projects.open(projectId)
    const adapter = this.adapters.get(project.rendererId)
    if (!adapter) {
      return [{
        severity: 'error',
        code: 'renderer-unavailable',
        message: `Renderer is not installed: ${project.rendererId}`
      }]
    }
    return preflightProject(project, adapter, this.templates)
  }

  async enqueueRender(projectId: string, outputFileName?: string): Promise<RenderJobRecord> {
    const project = await this.projects.open(projectId)
    const fileName = outputFileName ?? `${project.id}-r${project.revision}.mp4`
    assertSafeId(fileName, 'output file name')
    if (!/\.(mp4|mov|webm)$/i.test(fileName)) {
      throw new VideoEngineError('INVALID_PROJECT', 'Render output must end in .mp4, .mov, or .webm')
    }
    const outputPath = resolveInside(this.projects.rendersDirectory(project.id), fileName)
    sentryLog.info('Video engine enqueue requested', {
      project_id: project.id,
      renderer: project.rendererId,
      project_revision: project.revision,
      operation: 'video_render'
    })
    return this.queue.enqueue({
      project,
      outputPath,
      workDirectory: this.projects.workDirectory(project.id)
    })
  }

  listRenderJobs(): Promise<RenderJobRecord[]> {
    return this.queue.list()
  }

  getRenderJob(id: string): Promise<RenderJobRecord> {
    return this.queue.get(id)
  }

  cancelRender(id: string): Promise<RenderJobRecord> {
    return this.queue.cancel(id)
  }

  retryRender(id: string): Promise<RenderJobRecord> {
    return this.queue.retry(id)
  }

  onJobChanged(listener: RenderJobListener): () => void {
    return this.queue.onJobChanged(listener)
  }

  shutdown(): Promise<void> {
    return this.queue.shutdown()
  }
}
