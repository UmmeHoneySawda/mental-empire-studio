import { create } from 'zustand'
import type {
  ActivityRow,
  AutomationEvent,
  DownloadProgress,
  DownloadedVideo,
  MyChannel,
  Project,
  ProjectImage,
  ScrapeOrder,
  ScrapedVideo,
  RecentUpload,
  TranscriptWord,
  RenderQueueRow,
  RenderProgress,
  Profile,
  WorkItem,
  Niche,
  NichePoolHealth,
  SourceChannel
} from '@shared/types'
import type { GpuRenderSpec } from '@shared/renderSpec'
import { dropIdleRenderProgress } from '../lib/renderProgress'

// Live data layer — everything sourced from the SQLite DB / scrape / download /
// transcription services over window.api. Separate from useStore (UI state) so the
// producer screens read real data while the appearance/editor state stays put.

const api = (): typeof window.api | undefined => (typeof window !== 'undefined' ? window.api : undefined)

function transcribeErrorMessage(message: string): string {
  const msg = message || 'Transcription failed.'
  if (/api key|groq/i.test(msg)) return `${msg} Add or check the Groq key in Settings > Integrations, then try Re-transcribe.`
  if (/not found|enoent|no such file|mp3|audio/i.test(msg)) return `${msg} Resume or re-download the audio, then try Re-transcribe.`
  if (/rate|429|quota|limit/i.test(msg)) return `${msg} Wait a minute or switch models/API key, then retry.`
  return msg
}

interface DataState {
  channels: MyChannel[]
  activity: ActivityRow[]
  recentUploads: RecentUpload[]
  downloads: DownloadedVideo[]
  sourceVideos: ScrapedVideo[]
  fetching: boolean
  sourceError: string
  scraping: boolean
  dlProgress: Record<string, DownloadProgress>
  activeProject: Project | null
  projectImages: ProjectImage[]
  transcript: TranscriptWord[]
  previewSpec: GpuRenderSpec | null
  previewLoading: boolean
  previewError: string
  transcribing: boolean
  transcribeMessage: string
  transcribeError: string
  renderJobs: RenderQueueRow[]
  renderProgress: Record<string, RenderProgress>
  rendering: boolean
  profiles: Profile[]
  runningProfileId: string | null
  automationEvents: Record<string, AutomationEvent>
  automationErrors: Record<string, string>
  workItems: WorkItem[]
  niches: Niche[]
  nichePools: NichePoolHealth[]
  sourceChannels: SourceChannel[]
  ready: boolean

  init: () => Promise<void>
  loadChannels: () => Promise<void>
  loadDownloads: () => Promise<void>
  loadActivity: () => Promise<void>
  addChannel: (url: string, linkedSourceId?: string) => Promise<void>
  deleteChannel: (id: string) => Promise<void>
  rescrapeAll: () => Promise<void>
  updateGoals: (id: string, patch: { weekGoal?: number; monthGoal?: number; reminder?: string; reminderNote?: string }) => Promise<void>
  fetchSource: (url: string, order: ScrapeOrder, count: number) => Promise<void>
  startDownload: (videos: ScrapedVideo[], sourceUrl: string, bitrate: number) => Promise<DownloadedVideo[]>
  resumeDownload: (id: string) => Promise<void>
  cancelDownload: (id: string) => Promise<void>
  openProject: (downloadId: string) => Promise<void>
  openProjectById: (projectId: string) => Promise<void>
  refreshActiveProjectSnapshot: (projectId?: string) => Promise<void>
  loadPreviewSpec: (projectId?: string) => Promise<void>
  setProjectImages: (paths: string[]) => Promise<void>
  reorderProjectImages: (imageIds: string[]) => Promise<void>
  setMedia: (patch: Partial<Project>) => Promise<void>
  setCaptions: (patch: Partial<Project>) => Promise<void>
  runTranscribe: () => Promise<void>
  toggleWordEmphasis: (wordId: string) => Promise<void>
  setWordsEmphasis: (wordIds: string[], emphasis: boolean) => Promise<void>
  sendActiveToRender: () => Promise<void>
  loadRenderJobs: () => Promise<void>
  renderAll: () => Promise<void>
  clearProgress: (id: string) => void
  cancelJob: (id: string) => Promise<void>
  deleteJob: (id: string) => Promise<void>
  requeueJob: (id: string) => Promise<void>
  openRenderFile: (id: string) => Promise<void>
  openRenderFolder: (id: string) => Promise<void>
  deleteDownload: (id: string) => Promise<void>
  loadProfiles: () => Promise<void>
  runProfile: (id: string) => Promise<string[]>
  saveProfile: (p: Profile) => Promise<void>
  deleteProfile: (id: string) => Promise<void>
  runNow: () => Promise<void>
  loadWorkItems: () => Promise<void>
  detectUploads: () => Promise<void>
  setItemUploaded: (videoId: string, uploaded: boolean) => Promise<void>
  setItemArchived: (videoId: string, archived: boolean) => Promise<void>
  loadNiches: () => Promise<void>
  saveNiche: (n: Partial<Niche>) => Promise<void>
  deleteNiche: (id: string) => Promise<void>
  assignChannelNiche: (channelId: string, nicheId: string | null) => Promise<void>
  warmNiche: (id: string) => Promise<void>
  refreshAllPools: () => Promise<void>
}

let subscribed = false

/** Throttle trailing-edge: coalesces bursty progress-event reloads to at most one call
 *  per `ms`, so an active download/encode streaming many events/sec doesn't hammer the DB. */
function throttle(fn: () => void, ms: number): () => void {
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    const now = Date.now()
    const remaining = ms - (now - last)
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null }
      last = now
      fn()
    } else if (!timer) {
      timer = setTimeout(() => { last = Date.now(); timer = null; fn() }, remaining)
    }
  }
}

export const useData = create<DataState>((set, get) => ({
  channels: [],
  activity: [],
  recentUploads: [],
  downloads: [],
  sourceVideos: [],
  fetching: false,
  sourceError: '',
  scraping: false,
  dlProgress: {},
  activeProject: null,
  projectImages: [],
  transcript: [],
  previewSpec: null,
  previewLoading: false,
  previewError: '',
  transcribing: false,
  transcribeMessage: '',
  transcribeError: '',
  renderJobs: [],
  renderProgress: {},
  rendering: false,
  profiles: [],
  runningProfileId: null,
  automationEvents: {},
  automationErrors: {},
  workItems: [],
  niches: [],
  nichePools: [],
  sourceChannels: [],
  ready: false,

  init: async () => {
    const a = api()
    if (!a) {
      set({ ready: true })
      return
    }
    await Promise.all([get().loadChannels(), get().loadDownloads(), get().loadActivity(), get().loadProfiles(), get().loadRenderJobs(), get().loadWorkItems(), get().loadNiches()])
    set({ ready: true })
    a.reminders.check().catch(() => {})

    if (subscribed) return
    subscribed = true
    const reloadDownloads = throttle(() => { void get().loadDownloads(); void get().loadWorkItems() }, 400)
    const reloadRenderJobs = throttle(() => { void get().loadRenderJobs(); void get().loadWorkItems() }, 400)
    a.onActivity((row) => set((s) => ({ activity: [row, ...s.activity].slice(0, 30) })))
    a.onDownloadProgress((p) => {
      set((s) => ({ dlProgress: { ...s.dlProgress, [p.downloadId]: p } }))
      if (p.done) void get().loadDownloads()
      else reloadDownloads()
    })
    a.onTranscribeProgress((p) => set({
      transcribing: p.phase !== 'done' && p.phase !== 'error',
      transcribeMessage: p.phase === 'done' ? 'Done' : p.phase === 'error' ? '' : p.message,
      transcribeError: p.phase === 'error' ? transcribeErrorMessage(p.error ?? p.message) : ''
    }))
    a.onRenderProgress((p) => {
      set((s) => ({ renderProgress: { ...s.renderProgress, [p.jobId]: p } }))
      if (p.done) void get().loadRenderJobs()
      else reloadRenderJobs()
    })
    a.onAutomation((e) => {
      set((s) => ({
        automationEvents: { ...s.automationEvents, [e.profileId]: e },
        automationErrors: e.phase === 'error'
          ? { ...s.automationErrors, [e.profileId]: e.message }
          : s.automationErrors
      }))
    })
  },

  loadChannels: async () => {
    const a = api()
    if (!a) return
    const [channels, recentUploads] = await Promise.all([a.db.myChannels(), a.db.recentUploads(8)])
    set({ channels, recentUploads })
  },
  loadDownloads: async () => {
    const a = api()
    if (a) set({ downloads: await a.db.downloads() })
  },
  loadActivity: async () => {
    const a = api()
    if (a) set({ activity: await a.db.activity() })
  },

  addChannel: async (url, linkedSourceId) => {
    const a = api()
    if (!a || !url.trim()) return
    set({ scraping: true })
    try {
      await a.scrape.addMyChannel(url.trim(), linkedSourceId)
      await get().loadChannels()
    } finally {
      set({ scraping: false })
    }
  },
  deleteChannel: async (id) => {
    const a = api()
    if (!a) return
    const channels = await a.db.deleteMyChannel(id)
    set({ channels })
    await get().loadChannels()
  },
  rescrapeAll: async () => {
    const a = api()
    if (!a) return
    set({ scraping: true })
    try {
      await a.scrape.all()
      await Promise.all([get().loadChannels(), get().loadActivity(), get().loadWorkItems()])
    } finally {
      set({ scraping: false })
    }
  },
  updateGoals: async (id, patch) => {
    const a = api()
    if (!a) return
    const channels = await a.db.updateChannelGoals(id, patch)
    set({ channels })
  },

  fetchSource: async (url, order, count) => {
    const a = api()
    if (!a || !url.trim()) return
    set({ fetching: true, sourceError: '' })
    try {
      const sourceVideos = await a.scrape.sourceVideos(url.trim(), order, count)
      set({ sourceVideos, sourceError: '' })
    } catch (e) {
      const msg = (e as Error).message || 'Could not fetch videos from this source.'
      set({ sourceVideos: [], sourceError: msg })
    } finally {
      set({ fetching: false })
    }
  },
  startDownload: async (videos, sourceUrl, bitrate) => {
    const a = api()
    if (!a || videos.length === 0) return []
    const rows = await a.download.start(videos, { bitrate, sourceUrl })
    await Promise.all([get().loadDownloads(), get().loadWorkItems()])
    return rows
  },
  resumeDownload: async (id) => {
    const a = api()
    if (!a) return
    await a.download.resume(id)
    await get().loadDownloads()
  },
  cancelDownload: async (id) => {
    const a = api()
    if (!a) return
    await a.download.cancel(id)
    await get().loadDownloads()
  },

  openProject: async (downloadId) => {
    const a = api()
    if (!a) return
    const project = await a.compose.createProject(downloadId)
    const [projectImages, transcript] = await Promise.all([a.compose.images(project.id), a.transcribe.get(project.id)])
    set({ activeProject: project, projectImages, transcript, previewSpec: null, previewError: '', transcribeError: '', transcribeMessage: '' })
  },
  openProjectById: async (projectId) => {
    const a = api()
    if (!a) return
    const project = await a.compose.get(projectId)
    if (!project) return
    const [projectImages, transcript] = await Promise.all([a.compose.images(projectId), a.transcribe.get(projectId)])
    set({ activeProject: project, projectImages, transcript, previewSpec: null, previewError: '', transcribeError: '', transcribeMessage: '' })
  },
  refreshActiveProjectSnapshot: async (projectId) => {
    const a = api()
    const current = get().activeProject
    const id = projectId ?? current?.id
    if (!a || !id) return
    const project = await a.compose.get(id)
    if (!project) return
    const [projectImages, transcript] = await Promise.all([a.compose.images(id), a.transcribe.get(id)])
    const latest = get()
    if (latest.activeProject?.id !== id) return

    set({
      activeProject: project,
      // Preview renders are read-only; if a delayed/empty IPC refresh arrives, keep
      // the editor state visible instead of making the user re-fetch images/captions.
      projectImages: projectImages.length > 0 || latest.projectImages.length === 0 ? projectImages : latest.projectImages,
      transcript: transcript.length > 0 || latest.transcript.length === 0 ? transcript : latest.transcript,
      transcribeError: '',
      transcribeMessage: ''
    })
  },
  loadPreviewSpec: async (projectId) => {
    const a = api()
    const current = get().activeProject
    const id = projectId ?? current?.id
    if (!a || !id) return
    set({ previewLoading: true, previewError: '' })
    try {
      const previewSpec = await a.compose.previewSpec(id)
      if (get().activeProject?.id === id) set({ previewSpec, previewError: '' })
    } catch (e) {
      if (get().activeProject?.id === id) set({ previewSpec: null, previewError: (e as Error).message })
    } finally {
      if (get().activeProject?.id === id) set({ previewLoading: false })
    }
  },
  setProjectImages: async (paths) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    const projectImages = await a.compose.setImages(p.id, paths)
    set({ projectImages })
  },
  reorderProjectImages: async (imageIds) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    const projectImages = await a.compose.reorderImages(p.id, imageIds)
    set({ projectImages })
  },
  setMedia: async (patch) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    const project = await a.compose.setMedia(p.id, patch)
    if (project) set({ activeProject: project })
  },
  setCaptions: async (patch) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    const project = await a.compose.setCaptions(p.id, patch)
    if (project) set({ activeProject: project })
  },
  runTranscribe: async () => {
    const a = api()
    const p = get().activeProject
    if (!a || !p || get().transcribing) return
    set({ transcribing: true, transcribeError: '', transcribeMessage: 'Starting' })
    try {
      const transcript = await a.transcribe.run(p.id)
      set({ transcript, transcribeError: '', transcribeMessage: 'Done' })
    } catch (e) {
      set({ transcribeError: transcribeErrorMessage((e as Error).message), transcribeMessage: '' })
    } finally {
      set({ transcribing: false })
    }
  },
  toggleWordEmphasis: async (wordId) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    await a.transcribe.toggleEmphasis(wordId)
    set({ transcript: await a.transcribe.get(p.id) })
  },
  setWordsEmphasis: async (wordIds, emphasis) => {
    const a = api()
    const p = get().activeProject
    if (!a || !p || wordIds.length === 0) return
    await a.transcribe.setEmphasis(wordIds, emphasis)
    set({ transcript: await a.transcribe.get(p.id) })
  },
  sendActiveToRender: async () => {
    const a = api()
    const p = get().activeProject
    if (!a || !p) return
    await a.compose.sendToRender(p.id)
    await Promise.all([get().loadActivity(), get().loadRenderJobs(), get().loadWorkItems()])
  },

  loadRenderJobs: async () => {
    const a = api()
    if (!a) return
    const renderJobs = await a.render.jobs()
    set((s) => ({ renderJobs, renderProgress: dropIdleRenderProgress(renderJobs, s.renderProgress) }))
  },
  renderAll: async () => {
    const a = api()
    if (!a) return
    set({ rendering: true })
    try {
      await a.render.all()
      await Promise.all([get().loadRenderJobs(), get().loadActivity()])
    } finally {
      set({ rendering: false })
    }
  },
  // Drop any stale live-progress for a job so the row doesn't keep showing a frozen
  // "rendering 50%" after it's been cancelled/removed.
  clearProgress: (id: string) => set((s) => {
    const next = { ...s.renderProgress }
    delete next[id]
    return { renderProgress: next }
  }),
  cancelJob: async (id) => {
    const a = api()
    if (!a) return
    await a.render.cancel(id)
    get().clearProgress(id)
    await get().loadRenderJobs()
  },
  deleteJob: async (id) => {
    const a = api()
    if (!a) return
    await a.render.delete(id)
    get().clearProgress(id)
    await get().loadRenderJobs()
  },
  requeueJob: async (id) => {
    const a = api()
    if (!a) return
    await a.render.requeue(id)
    get().clearProgress(id)
    await get().loadRenderJobs()
  },
  openRenderFile: async (id) => {
    const a = api()
    if (!a) return
    await a.render.openFile(id)
  },
  openRenderFolder: async (id) => {
    const a = api()
    if (!a) return
    await a.render.openFolder(id)
  },
  deleteDownload: async (id) => {
    const a = api()
    if (!a) return
    await a.download.delete(id)
    await get().loadDownloads()
  },

  loadProfiles: async () => {
    const a = api()
    if (a) set({ profiles: await a.db.profiles() })
  },
  runProfile: async (id) => {
    const a = api()
    if (!a) return []
    set((s) => {
      const errors = { ...s.automationErrors }
      delete errors[id]
      return { runningProfileId: id, automationErrors: errors }
    })
    try {
      const projectIds = await a.automation.runProfile(id, false)
      // open the first new project for quick-edit, then refresh
      if (projectIds[0]) await get().openProjectById(projectIds[0])
      await Promise.all([get().loadDownloads(), get().loadProfiles(), get().loadActivity()])
      return projectIds
    } catch (e) {
      const msg = (e as Error).message
      set((s) => ({ automationErrors: { ...s.automationErrors, [id]: msg } }))
      await get().loadActivity()
      return []
    } finally {
      set({ runningProfileId: null })
    }
  },
  saveProfile: async (p) => {
    const a = api()
    if (!a) return
    const profiles = await a.automation.upsertProfile(p)
    set({ profiles })
  },
  deleteProfile: async (id) => {
    const a = api()
    if (!a) return
    const profiles = await a.automation.deleteProfile(id)
    set({ profiles })
  },
  runNow: async () => {
    const a = api()
    if (!a) return
    await a.automation.tick()
    await Promise.all([get().loadActivity(), get().loadRenderJobs(), get().loadProfiles()])
  },

  loadWorkItems: async () => {
    const a = api()
    if (a) set({ workItems: await a.db.workItems() })
  },
  detectUploads: async () => {
    const a = api()
    if (!a) return
    await a.workItems.detect()
    await get().loadWorkItems()
  },
  setItemUploaded: async (videoId, uploaded) => {
    const a = api()
    if (!a) return
    await a.workItems.setUploaded(videoId, uploaded)
    await get().loadWorkItems()
  },
  setItemArchived: async (videoId, archived) => {
    const a = api()
    if (!a) return
    await a.workItems.setArchived(videoId, archived)
    await get().loadWorkItems()
  },
  loadNiches: async () => {
    const a = api()
    if (!a) return
    const [niches, nichePools, sourceChannels] = await Promise.all([a.niche.list(), a.niche.poolHealth(), a.db.sourceChannels()])
    set({ niches, nichePools, sourceChannels })
  },
  saveNiche: async (n) => {
    const a = api()
    if (!a) return
    await a.niche.save(n)
    await get().loadNiches()
  },
  deleteNiche: async (id) => {
    const a = api()
    if (!a) return
    await a.niche.remove(id)
    await get().loadNiches()
  },
  assignChannelNiche: async (channelId, nicheId) => {
    const a = api()
    if (!a) return
    const sourceChannels = await a.niche.assignChannel(channelId, nicheId)
    set({ sourceChannels })
  },
  warmNiche: async (id) => {
    const a = api()
    if (!a) return
    await a.niche.warm(id)
    await get().loadNiches()
  },
  refreshAllPools: async () => {
    const a = api()
    if (!a) return
    await a.niche.refreshAll()
    await get().loadNiches()
  }
}))
