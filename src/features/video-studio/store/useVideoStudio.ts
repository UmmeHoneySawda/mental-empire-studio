import { create } from 'zustand'
import type {
  AddVideoScenePatch,
  ApplyVideoTransitionInput,
  CaptionCueList,
  ComposeEngine,
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
  // Handlers prefix errors with the engine's machine code; keep the code visible but
  // drop the trailing "(operation)" breadcrumb that only helps in logs.
  return raw.replace(/\s*\([a-zA-Z]+\)$/, '')
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

  brollProviders: string[]
  brollResults: VideoBrollCandidate[]
  brollSearching: boolean

  hookPlan: HookPlan | null
  hookBrollRequests: ImportedHookPlan['brollRequests']

  /** label of the in-flight operation; '' when idle */
  busy: string
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

  instantiateTemplate: (input: InstantiateVideoTemplateInput) => Promise<void>

  hookPrompt: (templateId: string, title: string, durationSeconds: number, transcript?: string) => Promise<string>
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

  refreshBrollProviders: () => Promise<void>
  searchBroll: (input: VideoBrollSearchInput) => Promise<void>
  clearBroll: () => void
  placeBroll: (candidate: VideoBrollCandidate, startFrame: number, durationFrames: number) => Promise<void>

  preflight: () => Promise<VideoRenderProblem[]>
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

export const useVideoStudio = create<VideoStudioState>((set, get) => {
  /** Runs one backend call with shared busy/error handling. Returns undefined when
   *  the call failed, so callers can early-out without try/catch noise. */
  async function run<T>(label: string, task: (native: NonNullable<ReturnType<typeof api>>) => Promise<T>): Promise<T | undefined> {
    const native = api()
    if (!native) {
      set({ error: 'The desktop bridge is not available in this window.' })
      return undefined
    }
    set({ busy: label, error: '' })
    try {
      return await task(native)
    } catch (error) {
      set({ error: message(error) })
      return undefined
    } finally {
      set({ busy: '' })
    }
  }

  /** Every mutation funnels through here: replace the project with what the engine
   *  saved, invalidate the preview, and keep the cue list in sync. */
  function commit(project: VideoProject, notice = ''): void {
    set({ project, projectId: project.id, previewStale: true, ...(notice ? { notice } : {}) })
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
    brollProviders: [],
    brollSearching: false,
    busy: '',
    error: '',
    notice: '',
    loading: false,
    playheadFrame: 0,
    playing: false,
    selection: { kind: 'project' },
    tab: 'templates',

    setTab: (tab) => set({ tab }),
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
          loading: false
        })
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
      const preview = await run('Building the preview', (native) => native.videoEngine.preview(projectId))
      if (preview) set({ preview, previewStale: false })
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
      set({ problems: problems ?? [] })
      return problems ?? []
    },

    enqueueRender: async (container) => {
      const { projectId } = get()
      if (!projectId) return
      const problems = await get().preflight()
      if (problems.some((problem) => problem.severity === 'error')) {
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
