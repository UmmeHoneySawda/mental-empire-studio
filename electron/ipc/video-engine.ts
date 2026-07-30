import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import {
  createCaptionDocument,
  groupCaptionCues,
  safeParseHookPlan,
  VideoGradingSchema,
  VideoProjectSchema,
  VideoSceneSchema,
  type AddVideoScenePatch,
  type ApplyVideoTransitionInput,
  type CaptionCueList,
  type CaptionImportSummary,
  type CreateVideoProjectInput,
  type ImportantWordsPromptInput,
  type ImportedHookPlan,
  type ImportedVideoAssets,
  type HookPromptInput,
  type InstantiateVideoTemplateInput,
  type JsonObject,
  type PlaceVideoBrollInput,
  type RendererId,
  type SetVideoCaptionsFromSrtInput,
  type SetVideoCaptionsInput,
  type VideoBrollCandidate,
  type VideoBrollSearchInput,
  type VideoCanvasPatch,
  type VideoEngineStatus,
  type VideoGrading,
  type VideoPreviewPayload,
  type VideoProject,
  type VideoRenderJob,
  type VideoRenderProblem,
  type VideoScenePatch,
  type VideoStudioBinding,
  type VideoTemplate,
  type VideoTemplateFilter
} from '../../shared/video-engine'
import { getRepos } from '../db'
import { errorMessage, VideoEngineError } from '../services/video-engine/errors'
import {
  bindDownload,
  captionWordsFromTranscript,
  engineBinaryPaths,
  getVideoEngine,
  hyperframesPreviewUrl,
  importProjectAssets,
  lastVideoEngineFailure,
  missingBrollCredentials,
  patchCanvas,
  projectForPreview,
  previewUrlForPath,
  readBinding,
  renderFileName,
  stageHyperframesPreview,
  toRenderJobDto,
  unbindDownload,
  videoEngineCapabilities,
  videoEngineDataRoot,
  VIDEO_GRADING_PRESETS
} from '../services/video-engine/studio'
import { emit } from './events'

/* Bridges the template video engine (Remotion + HyperFrames) to the Compose
 * studio. Everything here is thin: validate the renderer-supplied shape, call the
 * engine, and return the saved project so the UI never has to guess state. */

function reqString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${name}`)
  return value
}

function reqRenderer(value: unknown): RendererId {
  if (value !== 'remotion' && value !== 'hyperframes') throw new Error('Invalid rendererId')
  return value
}

function reqInt(value: unknown, name: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name}`)
  return Math.round(parsed)
}

/** VideoEngineError carries a machine code the studio surfaces verbatim; wrap
 *  everything else so a renderer-side catch always sees a readable message. */
async function guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const code = error instanceof VideoEngineError ? error.code : 'VIDEO_ENGINE_ERROR'
    throw new Error(`${code}: ${errorMessage(error)} (${operation})`)
  }
}

let jobBridgeAttached = false

async function attachJobBridge(): Promise<void> {
  if (jobBridgeAttached) return
  const engine = await getVideoEngine()
  jobBridgeAttached = true
  engine.onJobChanged((job) => emit('videoEngine:job', toRenderJobDto(job)))
}

async function status(): Promise<VideoEngineStatus> {
  const binaries = engineBinaryPaths()
  const base: VideoEngineStatus = {
    ready: false,
    dataRoot: videoEngineDataRoot(),
    nodeVersion: process.versions.node,
    renderers: [],
    brollProviders: [],
    brollMissingCredentials: missingBrollCredentials(),
    ffmpegPath: binaries.ffmpegPath,
    ffprobePath: binaries.ffprobePath
  }
  try {
    const engine = await getVideoEngine()
    await attachJobBridge()
    const capabilities = await videoEngineCapabilities()
    return {
      ...base,
      ready: true,
      renderers: engine.listRendererIds().map((rendererId) => {
        const found = capabilities.find((candidate) => candidate.rendererId === rendererId)
        return {
          rendererId,
          available: !!found,
          capabilities: found,
          detail: found ? undefined : 'Renderer runtime is not available'
        }
      }),
      brollProviders: engine.broll.listProviders()
    }
  } catch (error) {
    return { ...base, error: errorMessage(error) || lastVideoEngineFailure() }
  }
}

async function templates(filter: VideoTemplateFilter = {}): Promise<VideoTemplate[]> {
  const engine = await getVideoEngine()
  return engine.listTemplates({
    rendererId: filter.rendererId,
    kind: filter.kind,
    aspectRatio: filter.aspectRatio,
    capabilities: filter.capabilities
  })
}

async function openProject(projectId: string): Promise<VideoProject> {
  const engine = await getVideoEngine()
  return engine.openProject(projectId)
}

async function instantiateTemplate(
  projectId: string,
  input: InstantiateVideoTemplateInput
): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const template = engine.templates.require(input.templateId, input.templateVersion)
  const trackId = input.trackId ?? (template.kind === 'overlay' ? 'video-engine-overlay' : 'video-engine-graphics')
  // The service refuses to invent tracks, so make sure the target exists first.
  if (!project.tracks.some((track) => track.id === trackId)) {
    await engine.saveProject(
      VideoProjectSchema.parse({
        ...project,
        tracks: [
          ...project.tracks,
          {
            id: trackId,
            name: template.kind === 'overlay' ? 'Overlays' : 'Graphics',
            kind: template.kind === 'overlay' ? 'overlay' : 'video',
            order: template.kind === 'overlay' ? 50 : 5,
            muted: false,
            locked: false
          }
        ]
      }),
      { expectedRevision: project.revision }
    )
  }
  return engine.instantiateTemplate(projectId, {
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    instanceId: input.instanceId ?? `scene-${randomUUID()}`,
    trackId,
    startFrame: Math.max(0, Math.round(input.startFrame)),
    durationFrames: input.durationFrames === undefined ? undefined : Math.max(1, Math.round(input.durationFrames)),
    zIndex: input.zIndex,
    props: input.props
  })
}

async function addScene(projectId: string, patch: AddVideoScenePatch): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const trackId = patch.trackId ?? (patch.kind === 'audio' ? 'main-audio' : 'main-video')
  const tracks = project.tracks.some((track) => track.id === trackId)
    ? project.tracks
    : [
        ...project.tracks,
        {
          id: trackId,
          name: patch.kind === 'audio' ? 'Audio' : 'Visuals',
          kind: patch.kind === 'audio' ? ('audio' as const) : ('video' as const),
          order: patch.kind === 'audio' ? -10 : 0,
          muted: false,
          locked: false
        }
      ]
  const startFrame = Math.max(0, Math.min(project.canvas.durationFrames - 1, Math.round(patch.startFrame)))
  const durationFrames = Math.max(
    1,
    Math.min(project.canvas.durationFrames - startFrame, Math.round(patch.durationFrames))
  )
  const scene = VideoSceneSchema.parse({
    id: `scene-${randomUUID()}`,
    trackId,
    kind: patch.kind,
    startFrame,
    durationFrames,
    zIndex: patch.zIndex ?? 0,
    assetId: patch.assetId,
    text: patch.text,
    color: patch.color,
    fit: patch.fit,
    opacity: patch.opacity,
    volume: patch.volume
  })
  return engine.saveProject(
    VideoProjectSchema.parse({ ...project, tracks, scenes: [...project.scenes, scene] }),
    { expectedRevision: project.revision }
  )
}

async function updateScene(
  projectId: string,
  sceneId: string,
  patch: VideoScenePatch
): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const current = project.scenes.find((scene) => scene.id === sceneId)
  if (!current) throw new VideoEngineError('INVALID_PROJECT', `Unknown scene: ${sceneId}`)
  const startFrame = patch.startFrame === undefined
    ? current.startFrame
    : Math.max(0, Math.min(project.canvas.durationFrames - 1, Math.round(patch.startFrame)))
  const durationFrames = Math.max(
    1,
    Math.min(
      project.canvas.durationFrames - startFrame,
      Math.round(patch.durationFrames ?? current.durationFrames)
    )
  )
  const next = VideoSceneSchema.parse({
    ...current,
    startFrame,
    durationFrames,
    trackId: patch.trackId ?? current.trackId,
    zIndex: patch.zIndex ?? current.zIndex,
    text: patch.text ?? current.text,
    color: patch.color ?? current.color,
    fit: patch.fit ?? current.fit,
    opacity: patch.opacity ?? current.opacity,
    volume: patch.volume ?? current.volume,
    template: current.template && patch.templateProps
      ? { ...current.template, props: { ...current.template.props, ...patch.templateProps } }
      : current.template
  })
  return engine.saveProject(
    VideoProjectSchema.parse({
      ...project,
      scenes: project.scenes.map((scene) => (scene.id === sceneId ? next : scene))
    }),
    { expectedRevision: project.revision }
  )
}

async function removeScene(projectId: string, sceneId: string): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  return engine.saveProject(
    VideoProjectSchema.parse({
      ...project,
      scenes: project.scenes.filter((scene) => scene.id !== sceneId),
      // Transitions reference scenes by id, so orphans have to go with them.
      transitions: project.transitions.filter(
        (transition) => transition.fromSceneId !== sceneId && transition.toSceneId !== sceneId
      )
    }),
    { expectedRevision: project.revision }
  )
}

async function removeAsset(projectId: string, assetId: string): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const sceneIds = new Set(
    project.scenes.filter((scene) => scene.assetId === assetId).map((scene) => scene.id)
  )
  return engine.saveProject(
    VideoProjectSchema.parse({
      ...project,
      assets: project.assets.filter((asset) => asset.id !== assetId),
      scenes: project.scenes.filter((scene) => !sceneIds.has(scene.id)),
      transitions: project.transitions.filter(
        (transition) => !sceneIds.has(transition.fromSceneId) && !sceneIds.has(transition.toSceneId)
      ),
      grading: project.grading.lutAssetId === assetId
        ? { ...project.grading, lutAssetId: undefined }
        : project.grading
    }),
    { expectedRevision: project.revision }
  )
}

async function setMuted(projectId: string, trackId: string, muted: boolean): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  return engine.saveProject(
    VideoProjectSchema.parse({
      ...project,
      tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, muted } : track))
    }),
    { expectedRevision: project.revision }
  )
}

async function captionsFromTranscript(
  projectId: string,
  downloadId: string,
  templateId?: string,
  templateProps?: JsonObject
): Promise<CaptionImportSummary> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const transcript = getRepos().getTranscript(`proj-${downloadId}`)
  if (transcript.length === 0) {
    throw new VideoEngineError(
      'INVALID_IMPORT',
      'This clip has no transcript yet. Run Transcribe on the Compose tab first.'
    )
  }
  const converted = captionWordsFromTranscript(transcript, project.canvas.fps, project.canvas.durationFrames)
  if (converted.words.length === 0) {
    throw new VideoEngineError('INVALID_IMPORT', 'The transcript produced no usable word timings.')
  }
  const saved = await engine.setCaptions({
    projectId,
    language: 'en',
    templateId: templateId ?? project.captions?.templateId ?? `${project.rendererId}-caption-highlight`,
    templateProps,
    words: converted.words
  })
  return { project: saved, wordCount: converted.words.length, droppedCount: converted.dropped }
}

async function captionCues(projectId: string, maxWordsPerCue?: number): Promise<CaptionCueList> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  if (!project.captions) return { cues: [], words: [], transcriptHash: '' }
  return {
    cues: groupCaptionCues(project.captions, maxWordsPerCue ? { maxWordsPerCue } : {}),
    words: project.captions.words,
    transcriptHash: project.captions.transcriptHash
  }
}

/** Manual override for a single word's emphasis — the same field the AI import
 *  writes, so the two paths stay interchangeable. */
async function setWordImportance(
  projectId: string,
  wordIds: readonly string[],
  importance: 0 | 1 | 2 | 3
): Promise<VideoProject> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  if (!project.captions) throw new VideoEngineError('INVALID_PROJECT', 'Project has no captions')
  const targets = new Set(wordIds)
  const captions = createCaptionDocument({
    id: project.captions.id,
    language: project.captions.language,
    templateId: project.captions.templateId,
    words: project.captions.words.map((word) =>
      targets.has(word.id) ? { ...word, importance } : word
    )
  })
  return engine.saveProject(
    VideoProjectSchema.parse({ ...project, captions }),
    { expectedRevision: project.revision }
  )
}

async function hookPrompt(projectId: string, input: HookPromptInput): Promise<string> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  return engine.buildHookPlanPrompt({
    rendererId: project.rendererId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    fps: project.canvas.fps,
    title: input.title,
    durationSeconds: Math.min(30, Math.max(1, input.durationSeconds ?? 30)),
    transcript: input.transcript,
    availableAssetIds: project.assets.map((asset) => asset.id)
  })
}

async function importHookPlan(projectId: string, json: string): Promise<ImportedHookPlan> {
  const engine = await getVideoEngine()
  // Parse first so a malformed paste reports the schema problem instead of a save error.
  const parsed = safeParseHookPlan(json)
  if (!parsed.success) {
    throw new VideoEngineError(
      'INVALID_HOOK_PLAN',
      parsed.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ')
    )
  }
  const compiled = await engine.importHookPlan(projectId, parsed.data)
  return { project: compiled.project, plan: parsed.data, brollRequests: compiled.brollRequests }
}

async function preflight(projectId: string): Promise<VideoRenderProblem[]> {
  const engine = await getVideoEngine()
  return engine.preflightRender(projectId)
}

async function enqueueRender(projectId: string, container: string): Promise<VideoRenderJob> {
  const engine = await getVideoEngine()
  await attachJobBridge()
  const project = await engine.openProject(projectId)
  const extension = container === '.mov' || container === '.webm' ? container : '.mp4'
  const job = await engine.enqueueRender(projectId, renderFileName(project, extension))
  return toRenderJobDto(job)
}

async function preview(projectId: string): Promise<VideoPreviewPayload> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  if (project.rendererId === 'remotion') {
    return {
      kind: 'remotion',
      project: projectForPreview(project),
      durationInFrames: project.canvas.durationFrames
    }
  }
  const staged = await stageHyperframesPreview(projectId)
  return {
    kind: 'hyperframes',
    url: hyperframesPreviewUrl(projectId),
    width: project.canvas.width,
    height: project.canvas.height,
    fps: project.canvas.fps,
    durationFrames: project.canvas.durationFrames,
    warnings: staged.warnings
  }
}

function candidateToService(candidate: VideoBrollCandidate): VideoBrollCandidate {
  // Structurally identical to the service's BrollCandidate; re-validate the fields
  // the cache actually dereferences so a malformed payload cannot reach the network.
  reqString(candidate.id, 'candidate.id')
  reqString(candidate.provider, 'candidate.provider')
  reqString(candidate.downloadUrl, 'candidate.downloadUrl')
  reqString(candidate.sourceUrl, 'candidate.sourceUrl')
  reqString(candidate.license?.name, 'candidate.license.name')
  return candidate
}

export function registerVideoEngineIpc(): void {
  ipcMain.handle('videoEngine:status', () => status())
  ipcMain.handle('videoEngine:templates', (_e, filter?: VideoTemplateFilter) =>
    guard('templates', () => templates(filter ?? {})))
  ipcMain.handle('videoEngine:capabilities', () => guard('capabilities', () => videoEngineCapabilities()))
  ipcMain.handle('videoEngine:gradingPresets', () => [...VIDEO_GRADING_PRESETS])

  // ---- projects ----
  ipcMain.handle('videoEngine:projects', () => guard('projects', async () => {
    const engine = await getVideoEngine()
    return engine.listProjects()
  }))
  ipcMain.handle('videoEngine:project', (_e, projectId: string) =>
    guard('project', () => openProject(reqString(projectId, 'projectId'))))
  ipcMain.handle('videoEngine:createProject', (_e, input: CreateVideoProjectInput) =>
    guard('createProject', async () => {
      const engine = await getVideoEngine()
      return engine.createProject({
        name: reqString(input.name, 'name'),
        rendererId: reqRenderer(input.rendererId),
        width: reqInt(input.width, 'width'),
        height: reqInt(input.height, 'height'),
        fps: reqInt(input.fps, 'fps'),
        durationFrames: reqInt(input.durationFrames, 'durationFrames')
      })
    }))
  ipcMain.handle('videoEngine:deleteProject', (_e, projectId: string) =>
    guard('deleteProject', async () => {
      const engine = await getVideoEngine()
      await engine.deleteProject(reqString(projectId, 'projectId'))
    }))
  ipcMain.handle('videoEngine:renameProject', (_e, projectId: string, name: string) =>
    guard('renameProject', async () => {
      const engine = await getVideoEngine()
      const project = await engine.openProject(reqString(projectId, 'projectId'))
      return engine.saveProject(
        VideoProjectSchema.parse({ ...project, name: reqString(name, 'name').slice(0, 200) }),
        { expectedRevision: project.revision }
      )
    }))
  ipcMain.handle('videoEngine:setCanvas', (_e, projectId: string, patch: VideoCanvasPatch) =>
    guard('setCanvas', () => patchCanvas(reqString(projectId, 'projectId'), patch ?? {})))

  // ---- binding a downloaded clip to a per-renderer engine project ----
  ipcMain.handle('videoEngine:binding', (_e, downloadId: string): VideoStudioBinding =>
    readBinding(reqString(downloadId, 'downloadId')))
  ipcMain.handle('videoEngine:bindDownload', (_e, downloadId: string, rendererId: RendererId, reseed?: boolean) =>
    guard('bindDownload', () =>
      bindDownload(reqString(downloadId, 'downloadId'), reqRenderer(rendererId), { reseed: !!reseed })))
  ipcMain.handle('videoEngine:unbindDownload', (_e, downloadId: string, rendererId: RendererId) =>
    guard('unbindDownload', () =>
      unbindDownload(reqString(downloadId, 'downloadId'), reqRenderer(rendererId))))

  // ---- assets ----
  ipcMain.handle('videoEngine:importAssets', (_e, projectId: string, paths: string[]): Promise<ImportedVideoAssets> =>
    guard('importAssets', () =>
      importProjectAssets(reqString(projectId, 'projectId'), Array.isArray(paths) ? paths : [])))
  ipcMain.handle('videoEngine:removeAsset', (_e, projectId: string, assetId: string) =>
    guard('removeAsset', () => removeAsset(reqString(projectId, 'projectId'), reqString(assetId, 'assetId'))))

  // ---- scenes + tracks ----
  ipcMain.handle('videoEngine:addScene', (_e, projectId: string, patch: AddVideoScenePatch) =>
    guard('addScene', () => addScene(reqString(projectId, 'projectId'), patch)))
  ipcMain.handle('videoEngine:updateScene', (_e, projectId: string, sceneId: string, patch: VideoScenePatch) =>
    guard('updateScene', () =>
      updateScene(reqString(projectId, 'projectId'), reqString(sceneId, 'sceneId'), patch ?? {})))
  ipcMain.handle('videoEngine:removeScene', (_e, projectId: string, sceneId: string) =>
    guard('removeScene', () => removeScene(reqString(projectId, 'projectId'), reqString(sceneId, 'sceneId'))))
  ipcMain.handle('videoEngine:setTrackMuted', (_e, projectId: string, trackId: string, muted: boolean) =>
    guard('setTrackMuted', () =>
      setMuted(reqString(projectId, 'projectId'), reqString(trackId, 'trackId'), !!muted)))

  // ---- templates ----
  ipcMain.handle('videoEngine:instantiateTemplate', (_e, projectId: string, input: InstantiateVideoTemplateInput) =>
    guard('instantiateTemplate', () => instantiateTemplate(reqString(projectId, 'projectId'), input)))

  // ---- hook plans (external-AI, data-only) ----
  ipcMain.handle('videoEngine:hookPrompt', (_e, projectId: string, input: HookPromptInput) =>
    guard('hookPrompt', () => hookPrompt(reqString(projectId, 'projectId'), input)))
  ipcMain.handle('videoEngine:importHookPlan', (_e, projectId: string, json: string) =>
    guard('importHookPlan', () => importHookPlan(reqString(projectId, 'projectId'), reqString(json, 'json'))))
  ipcMain.handle('videoEngine:resolveHookBroll', (
    _e,
    projectId: string,
    beatId: string,
    candidate: VideoBrollCandidate
  ) => guard('resolveHookBroll', async () => {
    const engine = await getVideoEngine()
    const cached = await engine.cacheBroll(candidateToService(candidate))
    return engine.resolveHookBroll({
      projectId: reqString(projectId, 'projectId'),
      beatId: reqString(beatId, 'beatId'),
      candidate,
      cached
    })
  }))

  // ---- captions ----
  ipcMain.handle('videoEngine:setCaptions', (_e, projectId: string, input: SetVideoCaptionsInput) =>
    guard('setCaptions', async () => {
      const engine = await getVideoEngine()
      return engine.setCaptions({
        projectId: reqString(projectId, 'projectId'),
        language: input.language,
        templateId: input.templateId,
        templateProps: input.templateProps,
        words: input.words
      })
    }))
  ipcMain.handle('videoEngine:setCaptionsFromSrt', (_e, projectId: string, input: SetVideoCaptionsFromSrtInput) =>
    guard('setCaptionsFromSrt', async () => {
      const engine = await getVideoEngine()
      return engine.setCaptionsFromSrt({
        projectId: reqString(projectId, 'projectId'),
        srt: reqString(input.srt, 'srt'),
        language: input.language,
        templateId: input.templateId,
        templateProps: input.templateProps
      })
    }))
  ipcMain.handle('videoEngine:setCaptionsFromTranscript', (
    _e,
    projectId: string,
    downloadId: string,
    templateId?: string,
    templateProps?: JsonObject
  ) => guard('setCaptionsFromTranscript', () =>
    captionsFromTranscript(
      reqString(projectId, 'projectId'),
      reqString(downloadId, 'downloadId'),
      templateId,
      templateProps
    )))
  ipcMain.handle('videoEngine:setCaptionTemplate', (
    _e,
    projectId: string,
    templateId: string,
    props?: JsonObject
  ) => guard('setCaptionTemplate', async () => {
    const engine = await getVideoEngine()
    return engine.setCaptionTemplate(
      reqString(projectId, 'projectId'),
      reqString(templateId, 'templateId'),
      props ?? {}
    )
  }))
  ipcMain.handle('videoEngine:captionCues', (_e, projectId: string, maxWordsPerCue?: number) =>
    guard('captionCues', () => captionCues(reqString(projectId, 'projectId'), maxWordsPerCue)))
  ipcMain.handle('videoEngine:importantWordsPrompt', (_e, projectId: string, input?: ImportantWordsPromptInput) =>
    guard('importantWordsPrompt', async () => {
      const engine = await getVideoEngine()
      const project = await engine.openProject(reqString(projectId, 'projectId'))
      return engine.buildImportantWordsPrompt(project, input ?? {})
    }))
  ipcMain.handle('videoEngine:applyImportantWords', (_e, projectId: string, json: string, ratio?: number) =>
    guard('applyImportantWords', async () => {
      const engine = await getVideoEngine()
      return engine.applyImportantWordsResponse(reqString(projectId, 'projectId'), reqString(json, 'json'), {
        clearExisting: true,
        maximumSelectionRatio: ratio
      })
    }))
  ipcMain.handle('videoEngine:setWordImportance', (
    _e,
    projectId: string,
    wordIds: string[],
    importance: 0 | 1 | 2 | 3
  ) => guard('setWordImportance', () =>
    setWordImportance(
      reqString(projectId, 'projectId'),
      Array.isArray(wordIds) ? wordIds : [],
      importance === 1 || importance === 2 || importance === 3 ? importance : 0
    )))

  // ---- transitions ----
  ipcMain.handle('videoEngine:applyTransition', (_e, projectId: string, input: ApplyVideoTransitionInput) =>
    guard('applyTransition', async () => {
      const engine = await getVideoEngine()
      return engine.applyTransitionTemplate(reqString(projectId, 'projectId'), {
        templateId: reqString(input.templateId, 'templateId'),
        templateVersion: input.templateVersion,
        id: input.id,
        fromSceneId: reqString(input.fromSceneId, 'fromSceneId'),
        toSceneId: reqString(input.toSceneId, 'toSceneId'),
        startFrame: Math.max(0, reqInt(input.startFrame, 'startFrame')),
        durationFrames: input.durationFrames === undefined ? undefined : Math.max(0, reqInt(input.durationFrames, 'durationFrames')),
        direction: input.direction,
        easing: input.easing
      })
    }))
  ipcMain.handle('videoEngine:removeTransition', (_e, projectId: string, transitionId: string) =>
    guard('removeTransition', async () => {
      const engine = await getVideoEngine()
      return engine.removeTransition(reqString(projectId, 'projectId'), reqString(transitionId, 'transitionId'))
    }))

  // ---- cinematic grading ----
  ipcMain.handle('videoEngine:setGrading', (_e, projectId: string, grading: VideoGrading) =>
    guard('setGrading', async () => {
      const engine = await getVideoEngine()
      return engine.setGrading(reqString(projectId, 'projectId'), VideoGradingSchema.parse(grading))
    }))

  // ---- b-roll ----
  ipcMain.handle('videoEngine:brollProviders', () => guard('brollProviders', async () => {
    const engine = await getVideoEngine()
    return engine.broll.listProviders()
  }))
  ipcMain.handle('videoEngine:searchBroll', (_e, projectId: string, input: VideoBrollSearchInput) =>
    guard('searchBroll', async () => {
      const engine = await getVideoEngine()
      const project = await engine.openProject(reqString(projectId, 'projectId'))
      const landscape = project.canvas.width >= project.canvas.height
      return engine.searchBroll(
        {
          query: reqString(input.query, 'query'),
          page: input.page,
          perPage: Math.min(60, Math.max(1, input.perPage ?? 24)),
          orientation: input.orientation ?? (landscape ? 'landscape' : 'portrait'),
          minWidth: input.minWidth,
          minHeight: input.minHeight,
          minDurationMs: input.minDurationMs,
          maxDurationMs: input.maxDurationMs,
          safeSearch: input.safeSearch ?? true
        },
        { providers: input.providers && input.providers.length > 0 ? input.providers : undefined }
      )
    }))
  ipcMain.handle('videoEngine:placeBroll', (_e, projectId: string, input: PlaceVideoBrollInput) =>
    guard('placeBroll', async () => {
      const engine = await getVideoEngine()
      const candidate = candidateToService(input.candidate)
      const cached = await engine.cacheBroll(candidate)
      return engine.placeBroll(reqString(projectId, 'projectId'), {
        candidate,
        cached,
        trackId: input.trackId ?? 'video-engine-broll',
        startFrame: Math.max(0, reqInt(input.startFrame, 'startFrame')),
        durationFrames: Math.max(1, reqInt(input.durationFrames, 'durationFrames')),
        zIndex: input.zIndex
      })
    }))

  // ---- render ----
  ipcMain.handle('videoEngine:preflight', (_e, projectId: string) =>
    guard('preflight', () => preflight(reqString(projectId, 'projectId'))))
  ipcMain.handle('videoEngine:enqueueRender', (_e, projectId: string, container?: string) =>
    guard('enqueueRender', () => enqueueRender(reqString(projectId, 'projectId'), container ?? '.mp4')))
  ipcMain.handle('videoEngine:jobs', () => guard('jobs', async () => {
    const engine = await getVideoEngine()
    await attachJobBridge()
    return (await engine.listRenderJobs()).map(toRenderJobDto)
  }))
  ipcMain.handle('videoEngine:cancelRender', (_e, jobId: string) => guard('cancelRender', async () => {
    const engine = await getVideoEngine()
    return toRenderJobDto(await engine.cancelRender(reqString(jobId, 'jobId')))
  }))
  ipcMain.handle('videoEngine:retryRender', (_e, jobId: string) => guard('retryRender', async () => {
    const engine = await getVideoEngine()
    return toRenderJobDto(await engine.retryRender(reqString(jobId, 'jobId')))
  }))
  ipcMain.handle('videoEngine:revealRender', (_e, jobId: string) => guard('revealRender', async () => {
    const engine = await getVideoEngine()
    const job = await engine.getRenderJob(reqString(jobId, 'jobId'))
    const target = job.artifact?.path ?? job.outputPath
    if (existsSync(target)) shell.showItemInFolder(target)
    else await shell.openPath(dirname(target))
  }))
  ipcMain.handle('videoEngine:openRender', (_e, jobId: string) => guard('openRender', async () => {
    const engine = await getVideoEngine()
    const job = await engine.getRenderJob(reqString(jobId, 'jobId'))
    const target = job.artifact?.path ?? job.outputPath
    if (!existsSync(target)) throw new VideoEngineError('JOB_NOT_FOUND', 'The rendered file is not on disk yet')
    const failure = await shell.openPath(target)
    if (failure) throw new Error(failure)
  }))

  // ---- preview ----
  ipcMain.handle('videoEngine:preview', (_e, projectId: string) =>
    guard('preview', () => preview(reqString(projectId, 'projectId'))))
  ipcMain.handle('videoEngine:assetUrl', (_e, absolutePath: string) =>
    previewUrlForPath(reqString(absolutePath, 'absolutePath')))
}
