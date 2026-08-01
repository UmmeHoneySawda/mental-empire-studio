import { create } from 'zustand'
import { HookPlanSchema } from '@shared/video-engine'
import type {
  AutoBrollOptions,
  AutoBrollResult,
  CaptionCueList,
  HookBeatPatch,
  HookPlan,
  HookPromptInput,
  JsonObject,
  RendererId,
  VideoBrollCandidate,
  VideoGrading,
  VideoGradingPreset,
  VideoProject,
  VideoRenderJob,
  VideoRenderProblem,
  VideoScene,
  VideoTemplate,
  VideoTrack
} from '@shared/video-engine'
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, SAVE_DEBOUNCE_MS } from './constants'
import * as ops from './operations'

/* The editor store.
 *
 * The rule that makes this different from the studio it replaces: **the renderer owns the
 * project**. An edit is a local, synchronous transformation of `project`; the Player reads
 * that same object, so the picture changes on the same tick. Persistence is a debounced
 * whole-document save that happens afterwards and is allowed to be slow.
 *
 * The old store did the opposite — every edit was an `await ipcRenderer.invoke(...)` whose
 * response replaced the project and invalidated a separately-staged preview. That is why
 * one dragged clip cost a dozen writes and why nothing appeared until a rebuild finished.
 *
 * Anything the engine must compute (transcription, b-roll download, template
 * instantiation, render) still goes through IPC and still returns an authoritative
 * project — those are `runEngine` calls, and their result replaces local state wholesale. */

export type Selection =
  | { kind: 'none' }
  | { kind: 'clip'; id: string }
  | { kind: 'track'; id: string }
  | { kind: 'captions' }

export type PanelTab =
  | 'media'
  | 'templates'
  | 'hook'
  | 'text'
  | 'captions'
  | 'transitions'
  | 'grade'
  | 'effects'
  | 'broll'
  | 'export'

const api = (): typeof window.api | undefined => (typeof window !== 'undefined' ? window.api : undefined)

/** Electron wraps every handler rejection in plumbing; strip it so the copy the engine
 *  wrote is what the user reads. */
function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*':\s*/u, '')
    .replace(/^Error:\s*/u, '')
    .replace(/\s*\([a-zA-Z]+\)$/u, '')
}

interface EditorState {
  downloadId: string
  projectId: string
  project: VideoProject | null

  templates: VideoTemplate[]
  gradingPresets: VideoGradingPreset[]
  jobs: VideoRenderJob[]
  problems: VideoRenderProblem[]
  cues: CaptionCueList | null
  brollProviders: string[]
  brollResults: VideoBrollCandidate[]
  brollSearching: boolean
  /** The last Auto B-roll run, kept so the panel can report what was skipped and why.
   *  Silence has to be distinguishable from "your API key is wrong". */
  autoBrollResult: AutoBrollResult | null

  loading: boolean
  busy: string
  error: string
  notice: string
  /** Live phase text from a Groq transcription — a long clip is chunked, so a static
   *  label read as a hang. */
  progressNote: string

  /** true while a local edit has not reached disk yet */
  dirty: boolean
  saving: boolean

  playheadFrame: number
  playing: boolean
  zoom: number
  selection: Selection
  tab: PanelTab
  /** Loops playback over one stretch, so a hook or a caption can be checked without
   *  scrubbing a 15-minute timeline. Purely a viewing state. */
  loopRange: { startFrame: number; endFrame: number } | null
  snapEnabled: boolean

  /** Undo/redo of whole project documents. Bounded, because a project is large. */
  past: VideoProject[]
  future: VideoProject[]
}

interface EditorActions {
  open: (downloadId: string) => Promise<void>
  reseed: () => Promise<void>
  reload: () => Promise<void>
  flush: () => Promise<void>

  setTab: (tab: PanelTab) => void
  select: (selection: Selection) => void
  setPlayhead: (frame: number) => void
  setPlaying: (playing: boolean) => void
  setZoom: (zoom: number) => void
  setLoopRange: (range: { startFrame: number; endFrame: number } | null) => void
  soloSelection: () => void
  toggleSnap: () => void
  clearMessages: () => void
  setError: (error: string) => void
  setNotice: (notice: string) => void
  applyJob: (job: VideoRenderJob) => void
  setProgressNote: (note: string) => void

  /** The one local-edit funnel. `label` groups a gesture into a single undo entry. */
  edit: (fn: (project: VideoProject) => VideoProject, options?: { history?: boolean }) => void
  undo: () => void
  redo: () => void

  moveClip: (sceneId: string, startFrame: number, trackId?: string) => void
  trimClip: (sceneId: string, edge: 'start' | 'end', frameDelta: number) => void
  splitAtPlayhead: () => void
  removeClip: (sceneId: string) => void
  duplicateClip: (sceneId: string) => void
  patchClip: (sceneId: string, patch: Partial<VideoScene>) => void
  addTrack: (kind: VideoTrack['kind']) => void
  removeTrack: (trackId: string) => void
  patchTrack: (trackId: string, patch: Partial<VideoTrack>) => void
  rippleTrack: (trackId: string) => void

  /** Engine-computed operations. Each replaces the project with what the engine saved. */
  importAssets: (paths: string[]) => Promise<void>
  removeAsset: (assetId: string) => Promise<void>
  setCanvas: (patch: { width?: number; height?: number; fps?: number; durationFrames?: number }) => Promise<void>
  rename: (name: string) => Promise<void>
  instantiateTemplate: (input: { templateId: string; startFrame: number; durationFrames?: number; props?: JsonObject }) => Promise<void>

  /** Hook: all four go through the engine, which validates and compiles the plan. */
  hookPrompt: (input: HookPromptInput) => Promise<string>
  generateHookPlan: (input: HookPromptInput) => Promise<void>
  importHookPlan: (json: string) => Promise<void>
  updateHookBeat: (beatId: string, patch: HookBeatPatch) => Promise<void>

  captionsFromTranscript: (templateId?: string) => Promise<void>
  captionsFromSrt: (srt: string) => Promise<void>
  setCaptionTemplate: (templateId: string, props?: JsonObject) => Promise<void>
  refreshCues: (maxWordsPerCue?: number) => Promise<void>
  setWordImportance: (wordIds: string[], importance: 0 | 1 | 2 | 3) => Promise<void>
  /** Copy-prompt round trip: ask an outside model which words to emphasise, paste back. */
  importantWordsPrompt: (input?: { purpose?: string; maximumSelectionRatio?: number }) => Promise<string>
  applyImportantWords: (json: string, maximumSelectionRatio?: number) => Promise<void>
  setGrading: (grading: VideoGrading) => Promise<void>
  searchBroll: (query: string) => Promise<void>
  placeBroll: (candidate: VideoBrollCandidate, startFrame: number, durationFrames: number) => Promise<void>
  /** Reads the whole transcript, plans and downloads footage engine-side, then splices the
   *  entire run in with ONE local edit — so it repaints instantly and one undo reverses it. */
  autoBroll: (options?: Partial<AutoBrollOptions>) => Promise<void>
  clearBroll: () => void
  preflight: () => Promise<VideoRenderProblem[]>
  enqueueRender: () => Promise<void>
  cancelRender: (jobId: string) => Promise<void>
  retryRender: (jobId: string) => Promise<void>
  revealRender: (jobId: string) => Promise<void>
}

export type EditorStore = EditorState & EditorActions

const HISTORY_LIMIT = 60

const EMPTY: Pick<
  EditorState,
  'project' | 'projectId' | 'problems' | 'cues' | 'brollResults' | 'autoBrollResult' | 'past' | 'future'
> = {
  project: null,
  projectId: '',
  problems: [],
  cues: null,
  brollResults: [],
  autoBrollResult: null,
  past: [],
  future: []
}

/** One line the user can act on: how many clips landed, and why the rest did not. */
function summariseAutoBroll(result: AutoBrollResult): string {
  const placed = result.placements.length
  const counts = new Map<string, number>()
  for (const skip of result.skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  const label: Record<string, string> = {
    'no-results': 'no footage found',
    'download-failed': 'download failed',
    duplicate: 'already used',
    'model-invalid': 'unusable query',
    'rate-limited': 'hit the Groq rate limit',
    'too-short': 'no room',
    occupied: 'too close to another clip'
  }
  const detail = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([reason, count]) => `${count} ${label[reason] ?? reason}`)
    .join(', ')
  if (placed === 0) {
    return detail
      ? `No footage placed — ${detail}.`
      : 'No footage placed. Check the stock-footage API keys in Settings.'
  }
  return `Placed ${placed} clip${placed === 1 ? '' : 's'} across the timeline${detail ? ` · skipped: ${detail}` : ''}.`
}

export const useEditor = create<EditorStore>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  /** Serialises saves. Two overlapping whole-document writes would trip the engine's
   *  expectedRevision guard against each other. */
  let saveChain: Promise<unknown> = Promise.resolve()

  async function runEngine<T>(
    label: string,
    task: (native: NonNullable<ReturnType<typeof api>>) => Promise<T>
  ): Promise<T | undefined> {
    const native = api()
    if (!native) {
      set({ error: 'The desktop bridge is not available in this window.' })
      return undefined
    }
    // A labelled call is user-initiated and may clear the last error; a background
    // refresh must not wipe a banner that has not been read.
    set(label ? { busy: label, error: '' } : {})
    try {
      return await task(native)
    } catch (error) {
      set({ error: message(error) })
      return undefined
    } finally {
      if (label) set({ busy: '' })
    }
  }

  /** Pushes the current project to disk. Local state is NOT replaced by the response —
   *  doing that would clobber edits the user made while the write was in flight. Only the
   *  revision is adopted, so the next save's conflict check lines up. */
  function persist(): void {
    const { projectId, project } = get()
    if (!projectId || !project) return
    const native = api()
    if (!native) return
    set({ saving: true })
    saveChain = saveChain
      .then(() => native.videoEngine.saveProject(projectId, get().project ?? project))
      .then((saved) => {
        set((state) =>
          state.project && saved
            ? { project: { ...state.project, revision: saved.revision, updatedAt: saved.updatedAt }, dirty: false, saving: false }
            : { dirty: false, saving: false }
        )
      })
      .catch((error) => {
        set({ saving: false, error: message(error) })
      })
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, SAVE_DEBOUNCE_MS)
  }

  /** Replaces local state with an engine-authoritative project. */
  function adopt(project: VideoProject, notice = ''): void {
    set((state) => ({
      project,
      projectId: project.id,
      dirty: false,
      past: state.project ? [...state.past, state.project].slice(-HISTORY_LIMIT) : state.past,
      future: [],
      ...(notice ? { notice } : {})
    }))
  }

  return {
    downloadId: '',
    ...EMPTY,
    templates: [],
    gradingPresets: [],
    jobs: [],
    brollProviders: [],
    brollSearching: false,
    loading: false,
    busy: '',
    error: '',
    notice: '',
    progressNote: '',
    dirty: false,
    saving: false,
    playheadFrame: 0,
    playing: false,
    zoom: DEFAULT_ZOOM,
    selection: { kind: 'none' },
    tab: 'media',
    loopRange: null,
    snapEnabled: true,

    setTab: (tab) => set({ tab }),
    select: (selection) => set({ selection }),
    setPlayhead: (playheadFrame) => set({ playheadFrame: Math.max(0, Math.round(playheadFrame)) }),
    setPlaying: (playing) => set({ playing }),
    setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
    toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
    clearMessages: () => set({ error: '', notice: '' }),
    setError: (error) => set({ error }),
    setNotice: (notice) => set({ notice }),
    setProgressNote: (progressNote) => set({ progressNote }),

    setLoopRange: (loopRange) => {
      set({ loopRange })
      if (!loopRange) return
      const { playheadFrame } = get()
      // Drop the playhead inside the new range, or the Player sits on a frame the range
      // no longer covers and looks frozen.
      if (playheadFrame < loopRange.startFrame || playheadFrame >= loopRange.endFrame) {
        set({ playheadFrame: loopRange.startFrame })
      }
    },

    soloSelection: () => {
      const { project, selection } = get()
      if (!project || selection.kind !== 'clip') {
        get().setLoopRange(null)
        return
      }
      const scene = project.scenes.find((candidate) => candidate.id === selection.id)
      if (!scene) {
        get().setLoopRange(null)
        return
      }
      get().setLoopRange({
        startFrame: scene.startFrame,
        endFrame: Math.min(project.canvas.durationFrames, scene.startFrame + scene.durationFrames)
      })
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

    // ------------------------------------------------------------- local editing

    edit: (fn, options) => {
      const { project } = get()
      if (!project) return
      // The canvas grows to cover whatever the operation produced. `canvas.durationFrames`
      // is the composition's `durationInFrames`, so a clip ending past it would be on the
      // timeline, in the inspector and in the saved file, yet missing from the render.
      // Growing here means no single operation has to remember to do it.
      const next = ops.withCanvasCoveringContent(fn(project))
      // Reference equality means the operation declined the edit (clamped to a no-op).
      // Skipping the write keeps a rejected drag out of the undo stack.
      if (next === project) return
      set((state) => ({
        project: next,
        dirty: true,
        past: options?.history === false ? state.past : [...state.past, project].slice(-HISTORY_LIMIT),
        future: options?.history === false ? state.future : []
      }))
      scheduleSave()
    },

    undo: () => {
      const { past, project } = get()
      const previous = past[past.length - 1]
      if (!previous || !project) return
      set({ past: past.slice(0, -1), project: previous, future: [project, ...get().future].slice(0, HISTORY_LIMIT), dirty: true })
      scheduleSave()
    },

    redo: () => {
      const { future, project } = get()
      const next = future[0]
      if (!next || !project) return
      set({ future: future.slice(1), project: next, past: [...get().past, project].slice(-HISTORY_LIMIT), dirty: true })
      scheduleSave()
    },

    moveClip: (sceneId, startFrame, trackId) =>
      get().edit((project) => ops.moveClip(project, sceneId, startFrame, trackId)),
    trimClip: (sceneId, edge, frameDelta) =>
      get().edit((project) => ops.trimClip(project, sceneId, edge, frameDelta)),
    removeClip: (sceneId) => {
      get().edit((project) => ops.removeClip(project, sceneId))
      if (get().selection.kind === 'clip' && (get().selection as { id: string }).id === sceneId) {
        set({ selection: { kind: 'none' } })
      }
    },
    duplicateClip: (sceneId) => get().edit((project) => ops.duplicateClip(project, sceneId)),
    patchClip: (sceneId, patch) => get().edit((project) => ops.patchClip(project, sceneId, patch)),
    addTrack: (kind) => get().edit((project) => ops.addTrack(project, kind)),
    removeTrack: (trackId) => get().edit((project) => ops.removeTrack(project, trackId)),
    patchTrack: (trackId, patch) => get().edit((project) => ops.patchTrack(project, trackId, patch)),
    rippleTrack: (trackId) => get().edit((project) => ops.rippleTrack(project, trackId)),

    splitAtPlayhead: () => {
      const { selection, playheadFrame } = get()
      if (selection.kind !== 'clip') {
        set({ notice: 'Select a clip on the timeline to split it.' })
        return
      }
      get().edit((project) => ops.splitClip(project, selection.id, playheadFrame))
    },

    // ------------------------------------------------------------------ lifecycle

    open: async (downloadId) => {
      const native = api()
      if (!native) {
        set({ downloadId, error: 'The desktop bridge is not available in this window.' })
        return
      }
      set({ downloadId, loading: true, error: '', notice: '', ...EMPTY, selection: { kind: 'none' }, playheadFrame: 0, playing: false })
      try {
        const status = await native.videoEngine.status()
        if (!status.ready) {
          set({ error: status.error || 'The video engine could not start.', loading: false })
          return
        }
        const [bound, templates, gradingPresets, jobs, brollProviders] = await Promise.all([
          native.videoEngine.bindDownload(downloadId, 'remotion' as RendererId),
          native.videoEngine.templates({ rendererId: 'remotion' as RendererId }),
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
        // Captions should just be there. A failure (no API key, no network) is a banner,
        // never a reason to leave the editor unusable.
        if ((bound.project.captions?.words.length ?? 0) === 0) await get().captionsFromTranscript()
        await get().refreshCues()
      } catch (error) {
        set({ error: message(error), loading: false })
      }
    },

    reseed: async () => {
      const { downloadId } = get()
      if (!downloadId) return
      const bound = await runEngine('Rebuilding from the clip', (native) =>
        native.videoEngine.bindDownload(downloadId, 'remotion' as RendererId, true))
      if (!bound) return
      adopt(bound.project, 'Rebuilt this project from the downloaded clip.')
      await get().refreshCues()
    },

    reload: async () => {
      const { projectId } = get()
      if (!projectId) return
      const project = await runEngine('Reloading', (native) => native.videoEngine.project(projectId))
      if (project) adopt(project)
    },

    /** Forces any pending debounced save to land now — used before a render is queued,
     *  since the queue snapshots what is on disk. */
    flush: async () => {
      clearTimeout(saveTimer)
      if (get().dirty) persist()
      await saveChain.catch(() => undefined)
    },

    // ------------------------------------------------------- engine-computed edits

    importAssets: async (paths) => {
      const { projectId } = get()
      if (!projectId || paths.length === 0) return
      await get().flush()
      const result = await runEngine('Importing media', (native) => native.videoEngine.importAssets(projectId, paths))
      if (!result) return
      adopt(
        result.project,
        result.skipped.length > 0
          ? `Imported ${paths.length - result.skipped.length} of ${paths.length}. Skipped: ${result.skipped
              .map((entry) => `${entry.path.split(/[\\/]/u).pop()} (${entry.reason})`)
              .join(', ')}`
          : `Imported ${paths.length} file${paths.length === 1 ? '' : 's'}.`
      )
    },

    removeAsset: async (assetId) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Removing media', (native) => native.videoEngine.removeAsset(projectId, assetId))
      if (project) adopt(project)
    },

    setCanvas: async (patch) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Updating the canvas', (native) => native.videoEngine.setCanvas(projectId, patch))
      if (project) {
        adopt(project)
        await get().refreshCues()
      }
    },

    rename: async (name) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Renaming', (native) => native.videoEngine.renameProject(projectId, name))
      if (project) adopt(project)
    },

    instantiateTemplate: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Adding the template', (native) =>
        native.videoEngine.instantiateTemplate(projectId, input))
      if (project) adopt(project, 'Template added to the timeline.')
    },

    // ------------------------------------------------------------------------ hook
    //
    // Every one of these already existed on the bridge and was correct; nothing in the
    // Remotion editor called any of them, so the only hook a user could reach here was the
    // templates panel's plan-less one. `brollRequests` is deliberately dropped: the beats
    // that asked for footage are readable off the compiled plan in the project itself, and
    // holding a second copy in the store is how the old studio's beat list went stale.

    hookPrompt: async (input) => {
      const { projectId } = get()
      if (!projectId) return ''
      const prompt = await runEngine('Building the prompt', (native) =>
        native.videoEngine.hookPrompt(projectId, input))
      return prompt ?? ''
    },

    generateHookPlan: async (input) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const result = await runEngine('Writing the hook', (native) =>
        native.videoEngine.generateHookPlan(projectId, input))
      if (!result) return
      adopt(result.project, `Hook written — ${result.plan.beats.length} beats over ${result.plan.durationFrames} frames.`)
    },

    importHookPlan: async (json) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const result = await runEngine('Importing the hook', (native) =>
        native.videoEngine.importHookPlan(projectId, json))
      if (!result) return
      adopt(result.project, `Hook added — ${result.plan.beats.length} beats over ${result.plan.durationFrames} frames.`)
    },

    updateHookBeat: async (beatId, patch) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const result = await runEngine('Updating the beat', (native) =>
        native.videoEngine.updateHookBeat(projectId, beatId, patch))
      if (result) adopt(result.project)
    },

    captionsFromTranscript: async (templateId) => {
      const { projectId, downloadId } = get()
      if (!projectId || !downloadId) return
      await get().flush()
      const result = await runEngine('Importing captions', (native) =>
        native.videoEngine.setCaptionsFromTranscript(projectId, downloadId, templateId))
      if (!result) return
      adopt(
        result.project,
        result.droppedCount > 0
          ? `${result.wordCount} words imported, ${result.droppedCount} dropped past the end of the video.`
          : `${result.wordCount} words imported.`
      )
      await get().refreshCues()
    },

    captionsFromSrt: async (srt) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Importing captions', (native) =>
        native.videoEngine.setCaptionsFromSrt(projectId, { srt }))
      if (!project) return
      adopt(project, `${project.captions?.words.length ?? 0} words imported from the SRT.`)
      await get().refreshCues()
    },

    setCaptionTemplate: async (templateId, props) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Applying the caption style', (native) =>
        native.videoEngine.setCaptionTemplate(projectId, templateId, props))
      if (project) adopt(project)
    },

    refreshCues: async (maxWordsPerCue) => {
      const { projectId } = get()
      if (!projectId) return
      const cues = await runEngine('', (native) => native.videoEngine.captionCues(projectId, maxWordsPerCue))
      if (cues) set({ cues })
    },

    setWordImportance: async (wordIds, importance) => {
      const { projectId } = get()
      if (!projectId || wordIds.length === 0) return
      await get().flush()
      const project = await runEngine('Updating emphasis', (native) =>
        native.videoEngine.setWordImportance(projectId, wordIds, importance))
      if (!project) return
      adopt(project)
      await get().refreshCues()
    },

    importantWordsPrompt: async (input) => {
      const { projectId } = get()
      if (!projectId) return ''
      const prompt = await runEngine('Building the prompt', (native) =>
        native.videoEngine.importantWordsPrompt(projectId, input))
      return prompt ?? ''
    },

    applyImportantWords: async (json, maximumSelectionRatio) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Applying emphasis', (native) =>
        native.videoEngine.applyImportantWords(projectId, json, maximumSelectionRatio))
      if (!project) return
      const emphasised = (project.captions?.words ?? []).filter((word) => (word.importance ?? 0) > 0).length
      adopt(project, `${emphasised} word${emphasised === 1 ? '' : 's'} emphasised.`)
      await get().refreshCues()
    },

    setGrading: async (grading) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Updating the grade', (native) => native.videoEngine.setGrading(projectId, grading))
      if (project) adopt(project)
    },

    searchBroll: async (query) => {
      const { projectId } = get()
      if (!projectId || !query.trim()) return
      set({ brollSearching: true })
      const results = await runEngine('Searching footage', (native) =>
        native.videoEngine.searchBroll(projectId, { query: query.trim() }))
      set({ brollSearching: false, brollResults: results ?? [] })
      if (results && results.length === 0) set({ notice: 'No footage matched that search.' })
    },

    placeBroll: async (candidate, startFrame, durationFrames) => {
      const { projectId } = get()
      if (!projectId) return
      await get().flush()
      const project = await runEngine('Downloading and placing footage', (native) =>
        native.videoEngine.placeBroll(projectId, { candidate, startFrame, durationFrames }))
      if (project) adopt(project, `Placed “${candidate.title}”.`)
    },

    /* The whole run is planned and downloaded engine-side and comes back as DATA, then
     * lands in one `edit()`. That is what makes it a single undo entry and what lets the
     * Player repaint on the same tick — an engine-saved project would have replaced local
     * state instead, discarding whatever the user did while it ran. */
    autoBroll: async (options) => {
      const { projectId, downloadId } = get()
      if (!projectId || !downloadId) return
      await get().flush()
      const result = await runEngine('Finding B-roll', (native) =>
        native.videoEngine.autoBroll(projectId, downloadId, options))
      set({ progressNote: '' })
      if (!result) return
      set({ autoBrollResult: result })
      if (result.placements.length > 0) {
        get().edit((project) => ops.applyAutoBroll(project, result.placements))
      }
      set({ notice: summariseAutoBroll(result) })
    },

    clearBroll: () => set({ brollResults: [] }),

    preflight: async () => {
      const { projectId } = get()
      if (!projectId) return []
      await get().flush()
      const problems = await runEngine('Checking the project', (native) => native.videoEngine.preflight(projectId))
      if (!problems) {
        // `runEngine` answers undefined when the call itself failed. Collapsing that to an
        // empty list would read as "nothing wrong" and let the render queue anyway.
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

    enqueueRender: async () => {
      const { projectId } = get()
      if (!projectId) return
      const problems = await get().preflight()
      if (problems.some((problem) => problem.severity === 'error')) {
        set({ error: 'Fix the errors below before rendering.', tab: 'export' })
        return
      }
      const job = await runEngine('Queueing the render', (native) => native.videoEngine.enqueueRender(projectId, '.mp4'))
      if (!job) return
      get().applyJob(job)
      set({ notice: 'Render queued.', tab: 'export' })
    },

    cancelRender: async (jobId) => {
      const job = await runEngine('Cancelling', (native) => native.videoEngine.cancelRender(jobId))
      if (job) get().applyJob(job)
    },

    retryRender: async (jobId) => {
      const job = await runEngine('Retrying', (native) => native.videoEngine.retryRender(jobId))
      if (job) get().applyJob(job)
    },

    revealRender: async (jobId) => {
      await runEngine('', (native) => native.videoEngine.revealRender(jobId))
    }
  }
})

// -------------------------------------------------------------------- selectors

/** The lane order the timeline draws top-to-bottom: audio last, so voice-over sits
 *  under the visual lanes the way every NLE does it. */
export function orderedTracks(project: VideoProject | null): VideoTrack[] {
  if (!project) return []
  return [...project.tracks].sort((left, right) => {
    const audio = Number(left.kind === 'audio') - Number(right.kind === 'audio')
    return audio || left.order - right.order || left.name.localeCompare(right.name)
  })
}

export function clipById(project: VideoProject | null, sceneId: string | null): VideoScene | null {
  if (!project || !sceneId) return null
  return project.scenes.find((scene) => scene.id === sceneId) ?? null
}

export function selectedClip(state: EditorStore): VideoScene | null {
  return state.selection.kind === 'clip' ? clipById(state.project, state.selection.id) : null
}

/** The compiled hook plan, read back off the project.
 *
 *  Read, not remembered. The plan lives in the saved document (`props.hookPlan` on the hook
 *  scene), so deriving it here means the beats list survives a reload and can never
 *  disagree with what is actually on the timeline. */
export function hookPlanFromProject(project: VideoProject | null): HookPlan | null {
  if (!project) return null
  for (const scene of project.scenes) {
    const candidate = scene.template?.props?.['hookPlan']
    if (!candidate) continue
    const parsed = HookPlanSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

/** The scene carrying the hook, so the panel can select it or remove it. */
export function hookSceneId(project: VideoProject | null): string | null {
  if (!project) return null
  return (
    project.scenes.find((scene) => scene.template?.props?.['hookPlan'])?.id ??
    project.scenes.find(
      (scene) => scene.kind === 'template' && /-hook-/u.test(scene.template?.id ?? '')
    )?.id ??
    null
  )
}
