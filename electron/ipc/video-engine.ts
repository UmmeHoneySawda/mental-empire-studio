import { ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  createCaptionDocument,
  emptySpans,
  planMediaFill,
  groupCaptionCues,
  safeParseHookPlan,
  VideoGradingSchema,
  VideoProjectSchema,
  VideoSceneSchema,
  type AddVideoScenePatch,
  type ApplyVideoTransitionInput,
  type CaptionCueList,
  type CaptionImportSummary,
  type BrollBatch,
  type CreateVideoProjectInput,
  type FetchBrollBatchInput,
  type FetchBrollBatchResult,
  type FillWithMediaInput,
  type FillWithMediaResult,
  type HookBeatPatch,
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
import { getSettings } from '../store/settings'
import { sentryLog } from '../services/sentry'
import { errorMessage, VideoEngineError } from '../services/video-engine/errors'
import {
  appendBrollBatch,
  buildBrollKeywordsPrompt,
  deleteBrollBatch,
  newBatchId,
  parseBrollRequest,
  readBrollBatches
} from '../services/video-engine/broll/batches'
import { generateHookPlan } from '../services/video-engine/hook-generator'
import { ensureTranscript } from './compose'
import {
  bindDownload,
  captionWordsFromTranscript,
  engineBinaryPaths,
  getVideoEngine,
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

/* Which engine instance the job bridge is attached to.
 *
 * This used to be a plain `attached` boolean. Saving anything under Settings > beta
 * rebuilds the engine (resetVideoEngine), and the new RenderQueue owns a brand-new
 * EventEmitter — but the boolean was still true, so the bridge was never re-subscribed
 * and `videoEngine:job` stopped being emitted until the app restarted. Render progress
 * simply froze. Tracking the instance makes re-attaching automatic.
 *
 * Holding the promise (not the resolved service) also closes a double-subscribe race:
 * two concurrent first calls — which React StrictMode's double-invoked mount effect
 * reliably produces — used to both pass the check while the first was still awaiting. */
let bridgedEngine: Promise<unknown> | null = null

async function attachJobBridge(): Promise<void> {
  const pending = getVideoEngine()
  if (bridgedEngine === pending) return
  bridgedEngine = pending
  try {
    const engine = await pending
    engine.onJobChanged((job) => emit('videoEngine:job', toRenderJobDto(job)))
  } catch (error) {
    // Leave it unattached so the next call retries rather than latching onto a failure.
    if (bridgedEngine === pending) bridgedEngine = null
    throw error
  }
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

/**
 * Covers the empty stretches of a visual track with the chosen media.
 *
 * This is the "unlike a real editor I can't make an image cover the video" gap: importing
 * a still used to drop a fixed four-second clip at the playhead and nothing else. The
 * planning is a pure function (shared/video-engine/fill.ts) so the arithmetic is unit
 * tested; this handler only resolves the track, works out the gaps, and saves.
 */
async function fillWithMedia(projectId: string, input: FillWithMediaInput): Promise<FillWithMediaResult> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)

  const assetIds = input.assetIds.filter((id) => project.assets.some((asset) => asset.id === id))
  if (assetIds.length === 0) {
    throw new VideoEngineError('INVALID_PROJECT', 'Pick at least one imported image or video to fill with.')
  }
  const trackId = input.trackId ?? 'main-video'
  const tracks = project.tracks.some((track) => track.id === trackId)
    ? project.tracks
    : [...project.tracks, { id: trackId, name: 'Visuals', kind: 'video' as const, order: 0, muted: false, locked: false }]

  // Captions and audio live on their own tracks and must not be treated as occupying
  // visual space, or a captioned project would report no room at all.
  const kept = input.replaceExisting
    ? project.scenes.filter((scene) => scene.trackId !== trackId)
    : project.scenes
  const occupied = kept.filter((scene) => scene.trackId === trackId)
  const spans = emptySpans(occupied, project.canvas.durationFrames)

  const planned = planMediaFill({
    assetIds,
    spans,
    fps: project.canvas.fps,
    segmentSeconds: input.mode === 'cycle' ? input.segmentSeconds ?? 8 : 0,
    shuffle: input.shuffle ?? false,
    // Derived from the project so a re-run reproduces the same arrangement.
    seed: project.revision * 2654435761 % 2147483647
  })
  if (planned.length === 0) {
    throw new VideoEngineError('INVALID_PROJECT', 'There is no empty space on this track to fill.')
  }

  const scenes = planned.map((slot) => VideoSceneSchema.parse({
    id: `scene-${randomUUID()}`,
    trackId,
    kind: 'media',
    startFrame: slot.startFrame,
    durationFrames: slot.durationFrames,
    zIndex: 0,
    assetId: slot.assetId,
    fit: input.fit ?? 'cover'
  }))

  const saved = await engine.saveProject(
    VideoProjectSchema.parse({ ...project, tracks, scenes: [...kept, ...scenes] }),
    { expectedRevision: project.revision }
  )
  const coveredFrames = planned.reduce((sum, slot) => sum + slot.durationFrames, 0)
  sentryLog.info('Studio media fill', {
    project_id: projectId,
    renderer: project.rendererId,
    mode: input.mode,
    asset_count: assetIds.length,
    placed: scenes.length,
    covered_frames: coveredFrames,
    segment_seconds: input.mode === 'cycle' ? input.segmentSeconds ?? 8 : 0,
    shuffled: input.shuffle ?? false,
    operation: 'video_media_fill'
  })
  return { project: saved, placed: scenes.length, coveredFrames }
}

function brollBatchRoot(): string {
  return join(videoEngineDataRoot(), 'broll-batches')
}

/** Prompt for the copy → paste-back keyword flow, mirroring the hook-plan and
 *  important-words exchanges the studio already uses. */
async function brollKeywordsPrompt(projectId: string, downloadId: string, keywordCount?: number): Promise<string> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  // Prefer the caption words already on the project; fall back to the classic transcript
  // rows so this works before captions have been applied.
  const fromCaptions = (project.captions?.words ?? []).map((word) => word.text).join(' ')
  const transcript = fromCaptions
    || getRepos().getTranscript(`proj-${downloadId}`).map((word) => word.word).join(' ')
  return buildBrollKeywordsPrompt({
    title: project.name,
    transcript,
    keywordCount: Math.min(40, Math.max(3, Math.round(keywordCount ?? 12)))
  })
}

/**
 * Takes the model's keyword list, downloads footage for each keyword, imports the clips
 * as project assets, and records the whole thing as a named batch.
 *
 * A keyword that finds nothing is reported rather than dropped — with several providers
 * behind one search, silence is the difference between "no match" and "your API key is
 * wrong", and the user needs to be able to tell those apart.
 */
async function fetchBrollBatch(
  projectId: string,
  downloadId: string,
  input: FetchBrollBatchInput
): Promise<FetchBrollBatchResult> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const request = parseBrollRequest(input.response)
  const perKeyword = Math.min(5, Math.max(1, Math.round(input.perKeyword ?? 1)))

  const clips: BrollBatch['clips'] = []
  const emptyKeywords: string[] = []
  const paths: string[] = []

  for (const keyword of request.keywords) {
    const candidates = await engine.searchBroll({ query: keyword, perPage: perKeyword })
      .catch(() => [])
    if (candidates.length === 0) {
      emptyKeywords.push(keyword)
      continue
    }
    for (const candidate of candidates.slice(0, perKeyword)) {
      try {
        const cached = await engine.cacheBroll(candidate)
        paths.push(cached.absolutePath)
        clips.push({
          keyword,
          provider: candidate.provider,
          title: candidate.title,
          path: cached.absolutePath
        })
      } catch {
        // One bad download should not abandon the rest of the batch.
        emptyKeywords.push(keyword)
      }
    }
  }

  if (paths.length === 0) {
    throw new VideoEngineError(
      'BROLL_PROVIDER_ERROR',
      `Nothing downloaded for ${request.keywords.length} keyword${request.keywords.length === 1 ? '' : 's'}. `
        + 'Check the stock-footage API keys in Settings, or try broader keywords.'
    )
  }

  const imported = await importProjectAssets(projectId, paths)
  // Match each clip to the asset it became so a batch can be selected later.
  for (const clip of clips) {
    const asset = imported.project.assets.find((candidate) => candidate.name === basename(clip.path))
    if (asset) clip.assetId = asset.id
  }

  const batch: BrollBatch = {
    id: newBatchId(),
    name: request.name,
    createdAt: new Date().toISOString(),
    keywords: request.keywords,
    clips,
    emptyKeywords: [...new Set(emptyKeywords)]
  }
  await appendBrollBatch(brollBatchRoot(), projectId, batch)
  sentryLog.info('Studio b-roll batch fetched', {
    project_id: projectId,
    download_id: downloadId,
    renderer: project.rendererId,
    keyword_count: request.keywords.length,
    clip_count: clips.length,
    empty_keyword_count: batch.emptyKeywords.length,
    operation: 'broll_batch'
  })
  return { project: imported.project, batch }
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
  const hadTranscript = getRepos().getTranscript(`proj-${downloadId}`).length > 0
  // The studio used to be a pure reader of the classic tab's transcript rows and threw
  // "Run Transcribe on the Compose tab first" when they were absent. It now transcribes
  // on demand through the same Groq path the classic tab uses, so captions arrive
  // without the user having to visit another screen.
  if (!hadTranscript) {
    const apiKey = getSettings().transcription.apiKey.trim() || process.env['GROQ_API_KEY'] || ''
    if (!apiKey) {
      throw new VideoEngineError(
        'INVALID_IMPORT',
        'No Groq API key set. Add one in Settings > Integrations > Transcription, then try again.'
      )
    }
  }
  const transcript = await ensureTranscript(downloadId)
  if (transcript.length === 0) {
    throw new VideoEngineError('INVALID_IMPORT', 'Transcription returned no words for this clip.')
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
  // Careful with the wording: electron-vite's CJS-shim plugin scans the built bundle with
  // a regex for `import <…> '<specifier>'`, and a literal ending in the word "import"
  // right before its closing quote matches it — the shim then gets spliced into the
  // middle of this call and the bundle fails to parse. Keep "import" away from a quote.
  sentryLog.info('Studio captions applied', {
    download_id: downloadId,
    project_id: projectId,
    renderer: project.rendererId,
    word_count: converted.words.length,
    dropped_count: converted.dropped,
    transcribed_now: !hadTranscript,
    operation: 'video_caption_import'
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

/** Writes the hook with Groq instead of making the user round-trip through a chat model,
 *  then imports it through exactly the same path a pasted plan takes. */
async function generateHookPlanFor(projectId: string, input: HookPromptInput): Promise<ImportedHookPlan> {
  const engine = await getVideoEngine()
  const project = await engine.openProject(projectId)
  const durationSeconds = Math.min(30, Math.max(1, input.durationSeconds ?? 30))
  const plan = await generateHookPlan({
    apiKey: getSettings().transcription.apiKey.trim() || process.env['GROQ_API_KEY'] || '',
    prompt: await hookPrompt(projectId, input),
    fps: project.canvas.fps,
    durationFrames: Math.max(1, Math.round(durationSeconds * project.canvas.fps))
  })
  sentryLog.info('Studio hook plan generated', {
    project_id: projectId,
    renderer: project.rendererId,
    template_id: input.templateId,
    beat_count: plan.beats.length,
    duration_frames: plan.durationFrames,
    operation: 'video_hook_generate'
  })
  // JSON round trip so generated and pasted plans go through one code path.
  return importHookPlan(projectId, JSON.stringify(plan))
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

/** Reads the compiled plan back off a project, so the studio can rehydrate the beats list
 *  instead of holding it only in renderer memory (where a reload lost it). */
export function hookPlanFromProject(project: VideoProject): ImportedHookPlan | null {
  const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
  const parsed = safeParseHookPlan(scene?.template?.props?.['hookPlan'])
  if (!parsed.success) return null
  const brollRequests = parsed.data.beats
    .filter((beat) => beat.visual.kind === 'broll' && beat.visual.searchQuery)
    .map((beat) => ({
      beatId: beat.id,
      query: beat.visual.searchQuery!,
      startFrame: beat.startFrame,
      durationFrames: beat.durationFrames
    }))
  return { project, plan: parsed.data, brollRequests }
}

async function updateHookBeat(
  projectId: string,
  beatId: string,
  patch: HookBeatPatch
): Promise<ImportedHookPlan> {
  const engine = await getVideoEngine()
  const project = await engine.updateHookBeat({ projectId, beatId, patch })
  const hydrated = hookPlanFromProject(project)
  if (!hydrated) throw new VideoEngineError('INVALID_HOOK_PLAN', 'The edited hook plan could not be read back')
  return hydrated
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
      revision: project.revision,
      project: projectForPreview(project),
      durationInFrames: project.canvas.durationFrames
    }
  }
  const staged = await stageHyperframesPreview(projectId)
  return {
    kind: 'hyperframes',
    revision: project.revision,
    // Taken off the stage that was just published rather than looked up again — a second
    // lookup would race a concurrent restage and could hand back the other stage's URL.
    url: staged.url,
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
  // The timeline editor owns its project in the renderer and commits whole documents:
  // a drag that moves a clip across four lanes is one save, not four round trips each
  // bumping the revision. `revision`/`createdAt` are taken from disk rather than the
  // payload so a renderer that has been sitting on a stale copy cannot roll the file
  // backwards, and the schema still validates every field before anything is written.
  ipcMain.handle('videoEngine:saveProject', (_e, projectId: string, next: unknown) =>
    guard('saveProject', async () => {
      const engine = await getVideoEngine()
      const id = reqString(projectId, 'projectId')
      const current = await engine.openProject(id)
      const incoming = VideoProjectSchema.parse(next)
      if (incoming.id !== id) throw new Error('Project id mismatch')
      return engine.saveProject(
        VideoProjectSchema.parse({
          ...incoming,
          id: current.id,
          rendererId: current.rendererId,
          revision: current.revision,
          createdAt: current.createdAt
        }),
        { expectedRevision: current.revision }
      )
    }))

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
  ipcMain.handle('videoEngine:fillWithMedia', (_e, projectId: string, input: FillWithMediaInput) =>
    guard('fillWithMedia', () => fillWithMedia(reqString(projectId, 'projectId'), input)))

  // ---- b-roll batches ----
  ipcMain.handle('videoEngine:brollKeywordsPrompt', (_e, projectId: string, downloadId: string, count?: number) =>
    guard('brollKeywordsPrompt', () =>
      brollKeywordsPrompt(reqString(projectId, 'projectId'), reqString(downloadId, 'downloadId'), count)))
  ipcMain.handle('videoEngine:fetchBrollBatch', (_e, projectId: string, downloadId: string, input: FetchBrollBatchInput) =>
    guard('fetchBrollBatch', () =>
      fetchBrollBatch(reqString(projectId, 'projectId'), reqString(downloadId, 'downloadId'), input)))
  ipcMain.handle('videoEngine:brollBatches', (_e, projectId: string) =>
    guard('brollBatches', () => readBrollBatches(brollBatchRoot(), reqString(projectId, 'projectId'))))
  ipcMain.handle('videoEngine:deleteBrollBatch', (_e, projectId: string, batchId: string) =>
    guard('deleteBrollBatch', () =>
      deleteBrollBatch(brollBatchRoot(), reqString(projectId, 'projectId'), reqString(batchId, 'batchId'))))

  // ---- templates ----
  ipcMain.handle('videoEngine:instantiateTemplate', (_e, projectId: string, input: InstantiateVideoTemplateInput) =>
    guard('instantiateTemplate', () => instantiateTemplate(reqString(projectId, 'projectId'), input)))

  // ---- hook plans (external-AI, data-only) ----
  ipcMain.handle('videoEngine:hookPrompt', (_e, projectId: string, input: HookPromptInput) =>
    guard('hookPrompt', () => hookPrompt(reqString(projectId, 'projectId'), input)))
  ipcMain.handle('videoEngine:importHookPlan', (_e, projectId: string, json: string) =>
    guard('importHookPlan', () => importHookPlan(reqString(projectId, 'projectId'), reqString(json, 'json'))))
  ipcMain.handle('videoEngine:generateHookPlan', (_e, projectId: string, input: HookPromptInput) =>
    guard('generateHookPlan', () => generateHookPlanFor(reqString(projectId, 'projectId'), input)))
  ipcMain.handle('videoEngine:updateHookBeat', (_e, projectId: string, beatId: string, patch: HookBeatPatch) =>
    guard('updateHookBeat', () =>
      updateHookBeat(reqString(projectId, 'projectId'), reqString(beatId, 'beatId'), patch ?? {})))
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
        // Only meaningful for a cut; applyTransitionTemplate overwrites it with the
        // overlap start for anything animated.
        startFrame: input.startFrame === undefined ? 0 : Math.max(0, reqInt(input.startFrame, 'startFrame')),
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
