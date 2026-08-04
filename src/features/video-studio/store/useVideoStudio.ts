import { create } from 'zustand'
import { safeParseHookPlan } from '@shared/video-engine'
import type {
  AddVideoScenePatch,
  ApplyVideoTransitionInput,
  CaptionCueList,
  BrollBatch,
  ComposeEngine,
  FillWithMediaInput,
  HookBeatPatch,
  HookPlan,
  ImportantWordsPromptInput,
  ImportedHookPlan,
  InstantiateVideoTemplateInput,
  JsonObject,
  RendererId,
  VideoBrollCandidate,
  VideoBrollSearchInput,
  VideoCanvasPatch,
  VideoEngineStatus,
  VideoGrading,
  VideoGradingPreset,
  VideoPreviewPayload,
  VideoProject,
  VideoRenderJob,
  VideoRenderProblem,
  VideoScenePatch,
  VideoTemplate
} from '@shared/video-engine'

/* Single source of truth for the template-engine studio.
 *
 * Every backend mutation returns the saved project, so actions here never patch a
 * local copy — they replace `project` with what the engine persisted and mark the
 * preview stale. That keeps the UI honest about revision conflicts and validation
 * failures instead of drifting from disk. */

export type StudioSelection =
  | { kind: 'project' }
  | { kind: 'scene'; id: string }
  | { kind: 'scenes'; ids: string[] }
  | { kind: 'transition'; id: string }
  | { kind: 'asset'; id: string }
  | { kind: 'captions' }

export type StudioTab =
  | 'templates'
  | 'hook'
  | 'captions'
  | 'transitions'
  | 'grade'
  | 'broll'
  | 'media'
  | 'render'

const api = (): typeof window.api | undefined => (typeof window !== 'undefined' ? window.api : undefined)

function message(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    // Electron wraps every ipcMain.handle rejection as
    // `Error invoking remote method 'channel': Error: <message>`. Without stripping it,
    // carefully worded copy arrives behind ~60 characters of plumbing.
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    // Handlers prefix errors with the engine's machine code; keep the code visible but
    // drop the trailing "(operation)" breadcrumb that only helps in logs.
    .replace(/\s*\([a-zA-Z]+\)$/, '')
}

interface VideoStudioState {
  /** which editor the Compose screen is showing */
  engine: ComposeEngine
  /** the downloaded clip the studio is bound to */
  downloadId: string
  projectId: string
  project: VideoProject | null

  status: VideoEngineStatus | null
  templates: VideoTemplate[]
  gradingPresets: VideoGradingPreset[]
  jobs: VideoRenderJob[]
  problems: VideoRenderProblem[]
  cues: CaptionCueList | null

  preview: VideoPreviewPayload | null
  /** true once an edit lands; the preview reloads on demand rather than per keystroke */
  previewStale: boolean
  /** Tracked separately from `busy` so an unrelated background call cannot disable — or
   *  mislabel — the preview controls while a build is genuinely in flight. */
  previewBusy: boolean
  /** Set when a preview build fails, and kept until the next build starts. `error` is a
   *  shared channel that the next call clears, which made a failed refresh look like a
   *  no-op: the banner vanished before it could be read. */
  previewError: string
  /** Rebuild the preview automatically after an edit. On by default — that is what makes
   *  an added hook or caption simply appear. Turn it off for a long composition where
   *  each compile is slow and you would rather batch a run of edits. */
  previewAuto: boolean
  setPreviewAuto: (previewAuto: boolean) => void
  /** Limits playback and the scrubber to one stretch of the timeline, so a hook or a
   *  single caption can be checked without scrubbing through a 15-minute composition.
   *  null plays the whole thing. Purely a viewing state — it never touches the project
   *  or the render. */
  previewRange: { startFrame: number; endFrame: number } | null
  setPreviewRange: (range: { startFrame: number; endFrame: number } | null) => void
  /** Solo whatever is selected: a scene becomes its own range, a transition the frames
   *  around it. Falls back to clearing the range when nothing rangeable is selected. */
  soloSelection: () => void

  brollProviders: string[]
  brollResults: VideoBrollCandidate[]
  brollSearching: boolean

  hookPlan: HookPlan | null
  hookBrollRequests: ImportedHookPlan['brollRequests']

  /** label of the in-flight operation; '' when idle */
  busy: string
  /** Live phase text from a Groq transcription. A long clip is chunked and uploaded, so
   *  a static "Importing captions" label looked like a hang. */
  transcribeMessage: string
  setTranscribeMessage: (message: string) => void
  error: string
  notice: string
  loading: boolean
  playheadFrame: number
  playing: boolean
  selection: StudioSelection
  tab: StudioTab

  setTab: (tab: StudioTab) => void
  setSelection: (selection: StudioSelection) => void
  setPlayhead: (frame: number) => void
  setPlaying: (playing: boolean) => void
  clearMessages: () => void
  setError: (error: string) => void
  setNotice: (notice: string) => void

  /** switch engines; `classic` tears the studio down without touching the engine */
  openEngine: (downloadId: string, engine: ComposeEngine) => Promise<void>
  reseed: () => Promise<void>
  reload: () => Promise<void>
  refreshStatus: () => Promise<void>
  refreshJobs: () => Promise<void>
  applyJob: (job: VideoRenderJob) => void
  loadPreview: () => Promise<void>

  setCanvas: (patch: VideoCanvasPatch) => Promise<void>
  rename: (name: string) => Promise<void>

  importAssets: (paths: string[]) => Promise<void>
  removeAsset: (assetId: string) => Promise<void>

  addScene: (patch: AddVideoScenePatch) => Promise<void>
  updateScene: (sceneId: string, patch: VideoScenePatch) => Promise<void>
  removeScene: (sceneId: string) => Promise<void>
  setTrackMuted: (trackId: string, muted: boolean) => Promise<void>
  fillWithMedia: (input: FillWithMediaInput) => Promise<void>

  instantiateTemplate: (input: InstantiateVideoTemplateInput) => Promise<void>

  hookPrompt: (templateId: string, title: string, durationSeconds: number, transcript?: string) => Promise<string>
  generateHookPlan: (templateId: string, title: string, durationSeconds: number, transcript?: string) => Promise<void>
  updateHookBeat: (beatId: string, patch: HookBeatPatch) => Promise<void>
  importHookPlan: (json: string) => Promise<void>
  resolveHookBroll: (beatId: string, candidate: VideoBrollCandidate) => Promise<void>

  captionsFromTranscript: (templateId?: string, templateProps?: JsonObject) => Promise<void>
  captionsFromSrt: (srt: string, templateId?: string, templateProps?: JsonObject) => Promise<void>
  setCaptionTemplate: (templateId: string, props?: JsonObject) => Promise<void>
  refreshCues: (maxWordsPerCue?: number) => Promise<void>
  importantWordsPrompt: (input?: ImportantWordsPromptInput) => Promise<string>
  applyImportantWords: (json: string, ratio?: number) => Promise<void>
  setWordImportance: (wordIds: string[], importance: 0 | 1 | 2 | 3) => Promise<void>

  applyTransition: (input: ApplyVideoTransitionInput) => Promise<void>
  removeTransition: (transitionId: string) => Promise<void>

  setGrading: (grading: VideoGrading) => Promise<void>

  brollBatches: BrollBatch[]
  refreshBrollBatches: () => Promise<void>
  brollKeywordsPrompt: (keywordCount?: number) => Promise<string>
  fetchBrollBatch: (response: string, perKeyword?: number) => Promise<void>
  deleteBrollBatch: (batchId: string) => Promise<void>

  refreshBrollProviders: () => Promise<void>
  searchBroll: (input: VideoBrollSearchInput) => Promise<void>
  clearBroll: () => void
  placeBroll: (candidate: VideoBrollCandidate, startFrame: number, durationFrames: number) => Promise<void>

  preflight: () => Promise<VideoRenderProblem[]>
  fixProject: () => Promise<void>
  enqueueRender: (container?: '.mp4' | '.mov' | '.webm') => Promise<void>
  cancelRender: (jobId: string) => Promise<void>
  retryRender: (jobId: string) => Promise<void>
  revealRender: (jobId: string) => Promise<void>
  openRender: (jobId: string) => Promise<void>
}

const EMPTY: Pick<
  VideoStudioState,
  'project' | 'projectId' | 'problems' | 'cues' | 'preview' | 'hookPlan' | 'hookBrollRequests' | 'brollResults'
> = {
  project: null,
  projectId: '',
  problems: [],
  cues: null,
  preview: null,
  hookPlan: null,
  hookBrollRequests: [],
  brollResults: []
}

/** Monotonic id for preview builds. A build that is no longer the newest discards its
 *  result instead of overwriting a fresher one — the same guard the classic compose tab
 *  uses for its preview spec (`src/store/useData.ts`, previewSpecRequestSeq). */
let previewSeq = 0

/** Reads the compiled hook plan back out of the project it is stored in. The plan lives
 *  in the `video-engine-hook-plan` scene's template props, so it survives a reload —
 *  the studio just never looked. */
function hookStateFromProject(project: VideoProject | null): {
  hookPlan: HookPlan | null
  hookBrollRequests: ImportedHookPlan['brollRequests']
} {
  const scene = project?.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
  const parsed = safeParseHookPlan(scene?.template?.props?.['hookPlan'])
  if (!parsed.success) return { hookPlan: null, hookBrollRequests: [] }
  return {
    hookPlan: parsed.data,
    hookBrollRequests: parsed.data.beats
      .filter((beat) => beat.visual.kind === 'broll' && beat.visual.searchQuery)
      .map((beat) => ({
        beatId: beat.id,
        query: beat.visual.searchQuery!,
        startFrame: beat.startFrame,
        durationFrames: beat.durationFrames
      }))
  }
}

export const useVideoStudio = create<VideoStudioState>((set, get) => {
  /** Runs one backend call with shared busy/error handling. Returns undefined when
   *  the call failed, so callers can early-out without try/catch noise. */
  // Reference-counted, because several actions are label-less background refreshes
  // (status, jobs, cues, b-roll providers). Writing `busy` unconditionally meant those
  // blanked the label of a long operation that was still running, which in turn
  // re-enabled buttons that should have stayed disabled.
  let busyDepth = 0
  const labels: string[] = []

  async function run<T>(label: string, task: (native: NonNullable<ReturnType<typeof api>>) => Promise<T>): Promise<T | undefined> {
    const native = api()
    if (!native) {
      set({ error: 'The desktop bridge is not available in this window.' })
      return undefined
    }
    busyDepth += 1
    if (label) labels.push(label)
    // Only a labelled (user-initiated) call clears the previous error; a background
    // refresh must not wipe a banner the user has not read yet.
    set({ busy: labels[labels.length - 1] ?? '', ...(label ? { error: '' } : {}) })
    try {
      return await task(native)
    } catch (error) {
      set({ error: message(error) })
      return undefined
    } finally {
      busyDepth -= 1
      if (label) {
        const at = labels.lastIndexOf(label)
        if (at >= 0) labels.splice(at, 1)
      }
      set({ busy: busyDepth > 0 ? labels[labels.length - 1] ?? '' : '' })
    }
  }

  /** Every mutation funnels through here: replace the project with what the engine
   *  saved, invalidate the preview, and keep the cue list in sync.
   *
   *  The hook plan is re-read from the project on every commit. It used to live only in
   *  renderer memory, written once by importHookPlan — so the Beats list vanished on any
   *  reload or engine switch even though the plan was safely persisted in the scene's
   *  template props, and attaching b-roll left the beat still reading "Stock footage". */
  function commit(project: VideoProject, notice = ''): void {
    set({
      project,
      projectId: project.id,
      previewStale: true,
      ...hookStateFromProject(project),
      ...(notice ? { notice } : {})
    })
  }

  return {
    engine: 'classic',
    downloadId: '',
    ...EMPTY,
    status: null,
    templates: [],
    gradingPresets: [],
    jobs: [],
    previewStale: true,
    previewBusy: false,
    previewError: '',
    previewAuto: true,
    previewRange: null,
    brollProviders: [],
    brollBatches: [],
    brollSearching: false,
    busy: '',
    transcribeMessage: '',
    error: '',
    notice: '',
    loading: false,
    playheadFrame: 0,
    playing: false,
    selection: { kind: 'project' },
    tab: 'templates',

    setTab: (tab) => set({ tab }),
    setTranscribeMessage: (transcribeMessage) => set({ transcribeMessage }),
    setPreviewAuto: (previewAuto) => set({ previewAuto }),

    setPreviewRange: (previewRange) => {
      set({ previewRange })
      // Drop the playhead inside the new range, or the player sits on a frame the range
      // no longer covers and looks frozen.
      if (previewRange) {
        const { playheadFrame } = get()
        if (playheadFrame < previewRange.startFrame || playheadFrame >= previewRange.endFrame) {
          set({ playheadFrame: previewRange.startFrame })
        }
      }
    },

    soloSelection: () => {
      const { project, selection } = get()
      if (!project) return
      if (selection.kind === 'scene') {
        const scene = project.scenes.find((candidate) => candidate.id === selection.id)
        if (scene) {
          get().setPreviewRange({
            startFrame: scene.startFrame,
            endFrame: Math.min(project.canvas.durationFrames, scene.startFrame + scene.durationFrames)
          })
          return
        }
      }
      if (selection.kind === 'transition') {
        const transition = project.transitions.find((candidate) => candidate.id === selection.id)
        if (transition) {
          // A little air on each side, so the cut is visible rather than starting mid-way.
          const pad = Math.round(project.canvas.fps * 0.5)
          get().setPreviewRange({
            startFrame: Math.max(0, transition.startFrame - pad),
            endFrame: Math.min(
              project.canvas.durationFrames,
              transition.startFrame + transition.durationFrames + pad
            )
          })
          return
        }
      }
      get().setPreviewRange(null)
    },
    setSelection: (selection) => set({ selection }),
    setPlayhead: (playheadFrame) => set({ playheadFrame: Math.max(0, Math.round(playheadFrame)) }),
    setPlaying: (playing) => set({ playing }),
    clearMessages: () => set({ error: '', notice: '' }),
    setError: (error) => set({ error }),
    setNotice: (notice) => set({ notice }),

    openEngine: async (downloadId, engine) => {
      if (engine === 'classic') {
        set({ engine, downloadId, ...EMPTY, previewStale: true, selection: { kind: 'project' }, playheadFrame: 0, playing: false })
        return
      }
      const native = api()
      if (!native) {
        set({ engine, error: 'The desktop bridge is not available in this window.' })
        return
      }
      set({
        engine,
        downloadId,
        loading: true,
        error: '',
        notice: '',
        ...EMPTY,
        selection: { kind: 'project' },
        playheadFrame: 0,
        playing: false,
        previewStale: true
      })
      try {
        const status = await native.videoEngine.status()
        set({ status })
        if (!status.ready) {
          set({ error: status.error || 'The video engine could not start.', loading: false })
          return
        }
        const [bound, templates, gradingPresets, jobs, brollProviders] = await Promise.all([
          native.videoEngine.bindDownload(downloadId, engine as RendererId),
          native.videoEngine.templates({ rendererId: engine as RendererId }),
          native.videoEngine.gradingPresets(),
          native.videoEngine.jobs(),
          native.videoEngine.brollProviders()
        ])
        set({
          project: bound.project,
          projectId: bound.project.id,
          templates,
          gradingPresets,
          jobs,
          brollProviders,
          ...hookStateFromProject(bound.project),
          loading: false
        })
        // Captions should just be there. If this clip has never been transcribed the
        // backend runs Groq now; a failure (no API key, network) only surfaces a banner
        // and must not stop the studio from opening.
        if ((bound.project.captions?.words.length ?? 0) === 0) {
          await get().captionsFromTranscript()
        }
        await get().refreshCues()
        await get().loadPreview()
      } catch (error) {
        set({ error: message(error), loading: false })
      }
    },

    reseed: async () => {
      const { downloadId, engine } = get()
      if (engine === 'classic' || !downloadId) return
      const bound = await run('Rebuilding from the clip', (native) =>
        native.videoEngine.bindDownload(downloadId, engine as RendererId, true))
      if (!bound) return
      commit(bound.project, 'Rebuilt this project from the downloaded clip.')
      await get().refreshCues()
      await get().loadPreview()
    },

    reload: async () => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Reloading', (native) => native.videoEngine.project(projectId))
      if (project) commit(project)
    },

    refreshStatus: async () => {
      const status = await run('', (native) => native.videoEngine.status())
      if (status) set({ status })
    },

    refreshJobs: async () => {
      const jobs = await run('', (native) => native.videoEngine.jobs())
      if (jobs) set({ jobs })
    },

    applyJob: (job) => {
      set((state) => {
        const index = state.jobs.findIndex((candidate) => candidate.id === job.id)
        if (index < 0) return { jobs: [job, ...state.jobs] }
        const jobs = [...state.jobs]
        jobs[index] = job
        return { jobs }
      })
    },

    loadPreview: async () => {
      const { projectId, engine } = get()
      if (!projectId || engine === 'classic') return
      const seq = (previewSeq += 1)
      // The revision the build starts from. If an edit lands while the engine is
      // compiling, the finished preview is already out of date and must stay flagged
      // stale — otherwise the studio claims to be current while showing the old frame.
      const startedRevision = get().project?.revision
      set({ previewBusy: true, previewError: '' })
      const preview = await run('Building the preview', (native) => native.videoEngine.preview(projectId))
      // A newer build superseded this one; its result is stale by definition.
      if (seq !== previewSeq) return
      set({ previewBusy: false })
      if (!preview) {
        set({ previewError: get().error || 'The preview could not be built.' })
        return
      }
      set({ preview, previewStale: get().project?.revision !== startedRevision })
    },

    setCanvas: async (patch) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Updating the canvas', (native) => native.videoEngine.setCanvas(projectId, patch))
      if (project) {
        commit(project)
        await get().refreshCues()
      }
    },

    rename: async (name) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Renaming', (native) => native.videoEngine.renameProject(projectId, name))
      if (project) commit(project)
    },

    importAssets: async (paths) => {
      const { projectId } = get()
      if (!projectId || paths.length === 0) return
      const result = await run('Importing media', (native) => native.videoEngine.importAssets(projectId, paths))
      if (!result) return
      commit(
        result.project,
        result.skipped.length > 0
          ? `Imported ${paths.length - result.skipped.length} of ${paths.length}. Skipped: ${result.skipped
              .map((entry) => `${entry.path.split(/[\\/]/).pop()} (${entry.reason})`)
              .join(', ')}`
          : `Imported ${paths.length} file${paths.length === 1 ? '' : 's'}.`
      )
    },

    removeAsset: async (assetId) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Removing media', (native) => native.videoEngine.removeAsset(projectId, assetId))
      if (project) {
        commit(project)
        set({ selection: { kind: 'project' } })
      }
    },

    addScene: async (patch) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Adding a clip', (native) => native.videoEngine.addScene(projectId, patch))
      if (project) commit(project)
    },

    updateScene: async (sceneId, patch) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Updating the clip', (native) => native.videoEngine.updateScene(projectId, sceneId, patch))
      if (project) commit(project)
    },

    removeScene: async (sceneId) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Removing the clip', (native) => native.videoEngine.removeScene(projectId, sceneId))
      if (project) {
        commit(project)
        set({ selection: { kind: 'project' } })
      }
    },

    setTrackMuted: async (trackId, muted) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Updating the track', (native) => native.videoEngine.setTrackMuted(projectId, trackId, muted))
      if (project) commit(project)
    },

    fillWithMedia: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      const result = await run('Filling the timeline', (native) => native.videoEngine.fillWithMedia(projectId, input))
      if (!result) return
      const seconds = (result.coveredFrames / Math.max(1, result.project.canvas.fps)).toFixed(1)
      commit(result.project, `Placed ${result.placed} clip${result.placed === 1 ? '' : 's'} over ${seconds}s of empty timeline.`)
    },

    instantiateTemplate: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Adding the template', (native) => native.videoEngine.instantiateTemplate(projectId, input))
      if (project) commit(project, 'Template added to the timeline.')
    },

    hookPrompt: async (templateId, title, durationSeconds, transcript) => {
      const { projectId } = get()
      if (!projectId) return ''
      const prompt = await run('Building the prompt', (native) =>
        native.videoEngine.hookPrompt(projectId, { templateId, title, durationSeconds, transcript }))
      return prompt ?? ''
    },

    generateHookPlan: async (templateId, title, durationSeconds, transcript) => {
      const { projectId } = get()
      if (!projectId) return
      const result = await run('Writing the hook', (native) =>
        native.videoEngine.generateHookPlan(projectId, { templateId, title, durationSeconds, transcript }))
      if (!result) return
      set({ hookPlan: result.plan, hookBrollRequests: result.brollRequests })
      commit(
        result.project,
        result.brollRequests.length > 0
          ? `Hook written. ${result.brollRequests.length} beat${result.brollRequests.length === 1 ? '' : 's'} still need footage.`
          : 'Hook written.'
      )
    },

    updateHookBeat: async (beatId, patch) => {
      const { projectId } = get()
      if (!projectId) return
      const result = await run('Updating the beat', (native) =>
        native.videoEngine.updateHookBeat(projectId, beatId, patch))
      if (!result) return
      set({ hookPlan: result.plan, hookBrollRequests: result.brollRequests })
      commit(result.project)
    },

    importHookPlan: async (json) => {
      const { projectId } = get()
      if (!projectId) return
      const result = await run('Importing the hook plan', (native) => native.videoEngine.importHookPlan(projectId, json))
      if (!result) return
      set({ hookPlan: result.plan, hookBrollRequests: result.brollRequests })
      commit(
        result.project,
        result.brollRequests.length > 0
          ? `Hook imported. ${result.brollRequests.length} beat${result.brollRequests.length === 1 ? '' : 's'} still need footage.`
          : 'Hook imported.'
      )
    },

    resolveHookBroll: async (beatId, candidate) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Attaching footage', (native) =>
        native.videoEngine.resolveHookBroll(projectId, beatId, candidate))
      if (!project) return
      set((state) => ({ hookBrollRequests: state.hookBrollRequests.filter((request) => request.beatId !== beatId) }))
      commit(project, 'Footage attached to the beat.')
    },

    captionsFromTranscript: async (templateId, templateProps) => {
      const { projectId, downloadId } = get()
      if (!projectId || !downloadId) return
      const result = await run('Importing captions', (native) =>
        native.videoEngine.setCaptionsFromTranscript(projectId, downloadId, templateId, templateProps))
      if (!result) return
      commit(
        result.project,
        result.droppedCount > 0
          ? `${result.wordCount} words imported, ${result.droppedCount} dropped past the end of the video.`
          : `${result.wordCount} words imported.`
      )
      await get().refreshCues()
    },

    captionsFromSrt: async (srt, templateId, templateProps) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Importing captions', (native) =>
        native.videoEngine.setCaptionsFromSrt(projectId, { srt, templateId, templateProps }))
      if (!project) return
      commit(project, `${project.captions?.words.length ?? 0} words imported from the SRT.`)
      await get().refreshCues()
    },

    setCaptionTemplate: async (templateId, props) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Applying the caption style', (native) =>
        native.videoEngine.setCaptionTemplate(projectId, templateId, props))
      if (project) commit(project)
    },

    refreshCues: async (maxWordsPerCue) => {
      const { projectId } = get()
      if (!projectId) return
      const cues = await run('', (native) => native.videoEngine.captionCues(projectId, maxWordsPerCue))
      if (cues) set({ cues })
    },

    importantWordsPrompt: async (input) => {
      const { projectId } = get()
      if (!projectId) return ''
      const prompt = await run('Building the prompt', (native) =>
        native.videoEngine.importantWordsPrompt(projectId, input))
      return prompt ?? ''
    },

    applyImportantWords: async (json, ratio) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Applying emphasis', (native) =>
        native.videoEngine.applyImportantWords(projectId, json, ratio))
      if (!project) return
      const emphasised = project.captions?.words.filter((word) => (word.importance ?? 0) > 0).length ?? 0
      commit(project, `${emphasised} word${emphasised === 1 ? '' : 's'} marked for emphasis.`)
      await get().refreshCues()
    },

    setWordImportance: async (wordIds, importance) => {
      const { projectId } = get()
      if (!projectId || wordIds.length === 0) return
      const project = await run('Updating emphasis', (native) =>
        native.videoEngine.setWordImportance(projectId, wordIds, importance))
      if (!project) return
      commit(project)
      await get().refreshCues()
    },

    applyTransition: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Adding the transition', (native) => native.videoEngine.applyTransition(projectId, input))
      if (project) commit(project, 'Transition added.')
    },

    removeTransition: async (transitionId) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Removing the transition', (native) =>
        native.videoEngine.removeTransition(projectId, transitionId))
      if (project) {
        commit(project)
        set({ selection: { kind: 'project' } })
      }
    },

    setGrading: async (grading) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Updating the grade', (native) => native.videoEngine.setGrading(projectId, grading))
      if (project) commit(project)
    },

    refreshBrollBatches: async () => {
      const { projectId } = get()
      if (!projectId) return
      const batches = await run('', (native) => native.videoEngine.brollBatches(projectId))
      if (batches) set({ brollBatches: batches })
    },

    brollKeywordsPrompt: async (keywordCount) => {
      const { projectId, downloadId } = get()
      if (!projectId || !downloadId) return ''
      const prompt = await run('Building the prompt', (native) =>
        native.videoEngine.brollKeywordsPrompt(projectId, downloadId, keywordCount))
      return prompt ?? ''
    },

    fetchBrollBatch: async (response, perKeyword) => {
      const { projectId, downloadId } = get()
      if (!projectId || !downloadId) return
      const result = await run('Downloading footage', (native) =>
        native.videoEngine.fetchBrollBatch(projectId, downloadId, { response, perKeyword }))
      if (!result) return
      const { batch } = result
      const missed = batch.emptyKeywords.length > 0
        ? ` ${batch.emptyKeywords.length} keyword${batch.emptyKeywords.length === 1 ? '' : 's'} found nothing.`
        : ''
      commit(result.project, `“${batch.name}” — ${batch.clips.length} clip${batch.clips.length === 1 ? '' : 's'} downloaded.${missed}`)
      await get().refreshBrollBatches()
    },

    deleteBrollBatch: async (batchId) => {
      const { projectId } = get()
      if (!projectId) return
      const batches = await run('Removing the batch', (native) =>
        native.videoEngine.deleteBrollBatch(projectId, batchId))
      if (batches) set({ brollBatches: batches })
    },

    refreshBrollProviders: async () => {
      const brollProviders = await run('', (native) => native.videoEngine.brollProviders())
      if (brollProviders) set({ brollProviders })
    },

    searchBroll: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      set({ brollSearching: true })
      const results = await run('Searching footage', (native) => native.videoEngine.searchBroll(projectId, input))
      set({ brollSearching: false, brollResults: results ?? [] })
      if (results && results.length === 0) set({ notice: 'No footage matched that search.' })
    },

    clearBroll: () => set({ brollResults: [] }),

    placeBroll: async (candidate, startFrame, durationFrames) => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Downloading and placing footage', (native) =>
        native.videoEngine.placeBroll(projectId, { candidate, startFrame, durationFrames }))
      if (project) commit(project, `Placed “${candidate.title}”.`)
    },

    preflight: async () => {
      const { projectId } = get()
      if (!projectId) return []
      const problems = await run('Checking the project', (native) => native.videoEngine.preflight(projectId))
      if (!problems) {
        // `run` answers undefined when the call itself failed. Collapsing that to an
        // empty list read as "nothing wrong" and let the render queue anyway — report the
        // failure as the blocking problem it is.
        const failure: VideoRenderProblem = {
          severity: 'error',
          code: 'preflight.unavailable',
          message: get().error || 'The project could not be checked.'
        }
        set({ problems: [failure] })
        return [failure]
      }
      set({ problems })
      return problems
    },

    fixProject: async () => {
      const { projectId } = get()
      if (!projectId) return
      const project = await run('Auto-fixing project', (native) => native.videoEngine.fixProject(projectId))
      if (project) {
        commit(project, 'Auto-fixed transitions and alignment.')
        await get().preflight()
      }
    },

    enqueueRender: async (container) => {
      const { projectId } = get()
      if (!projectId) return
      const problems = await get().preflight()
      if (problems.some((problem) => problem.severity === 'error')) {
        // Set after preflight, not before: a labelled `run` clears `error` on entry, so
        // writing this first would have it wiped by the very next call.
        set({ error: 'Fix the errors below before rendering.', tab: 'render' })
        return
      }
      const job = await run('Queueing the render', (native) => native.videoEngine.enqueueRender(projectId, container))
      if (!job) return
      get().applyJob(job)
      set({ notice: 'Render queued.', tab: 'render' })
    },

    cancelRender: async (jobId) => {
      const job = await run('Cancelling', (native) => native.videoEngine.cancelRender(jobId))
      if (job) get().applyJob(job)
    },

    retryRender: async (jobId) => {
      const job = await run('Retrying', (native) => native.videoEngine.retryRender(jobId))
      if (job) get().applyJob(job)
    },

    revealRender: async (jobId) => {
      await run('', (native) => native.videoEngine.revealRender(jobId))
    },

    openRender: async (jobId) => {
      await run('', (native) => native.videoEngine.openRender(jobId))
    }
  }
})

// ------------------------------------------------------------------- selectors

export function framesToTimecode(frame: number, fps: number): string {
  const totalSeconds = Math.max(0, frame) / Math.max(1, fps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const frames = Math.round(Math.max(0, frame) % Math.max(1, fps))
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(frames).padStart(2, '0')}`
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

/** Templates of one kind for the currently open renderer. */
export function templatesOfKind(templates: VideoTemplate[], kind: VideoTemplate['kind']): VideoTemplate[] {
  return templates.filter((template) => template.kind === kind)
}
