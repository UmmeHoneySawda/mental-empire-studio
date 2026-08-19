// Renderer state for the TalkingPhotos screen.
//
// SQLite in the main process is the source of truth for jobs; this store holds a mirror plus the
// transient UI concerns (which job is open, what is in flight, the last error). The live subscription
// replaces the open job wholesale rather than patching it, so the two ledger columns can never show
// state from two different reads.

import { create } from 'zustand'
import type {
  TpCharacter,
  TpCharacterProgress,
  TpConnection,
  TpCreateJobInput,
  TpGenerateCharacterInput,
  TpJob,
  TpJobDetail,
  TpMotion,
  TpPlanPreview,
  TpUploadCharacterInput,
  TpAspectRatio,
  TpBlockedFeature,
  TpCharacterGender,
  TpFeature
} from '@shared/talkingphotos'
import { errorMessage } from '../lib/errors'

type Busy = 'connection' | 'character' | 'create' | 'job' | null

interface Catalog {
  features: TpFeature[]
  blocked: TpBlockedFeature[]
  mergeCapSec: number
}

export interface TalkingPhotosState {
  connection: TpConnection | null
  catalog: Catalog | null
  characters: TpCharacter[]
  jobs: TpJob[]
  activeDetail: TpJobDetail | null
  motions: TpMotion[]
  characterProgress: TpCharacterProgress | null
  /** Live-priced plan from the vendor. Null until the first quote lands. */
  preview: TpPlanPreview | null
  previewing: boolean
  busy: Busy
  error: string

  init: () => Promise<void>
  testConnection: () => Promise<void>
  signOut: () => Promise<void>
  loadCharacters: () => Promise<void>
  loadJobs: () => Promise<void>
  loadMotions: (featureId: string, gender: TpCharacterGender, aspectRatio: TpAspectRatio) => Promise<void>
  probe: (filePath: string) => Promise<number>
  /** Price a plan against the live chunk ceiling, daily allowance, and concurrency. */
  quote: (featureId: string, partSeconds: number, sourceDurationSec: number) => Promise<void>
  clearQuote: () => void
  generateCharacter: (input: TpGenerateCharacterInput) => Promise<void>
  uploadCharacter: (input: TpUploadCharacterInput) => Promise<void>
  createJob: (input: TpCreateJobInput) => Promise<TpJobDetail | null>
  openJob: (id: string) => Promise<void>
  closeJob: () => void
  startJob: (id: string) => Promise<void>
  pauseJob: (id: string) => Promise<void>
  cancelJob: (id: string) => Promise<void>
  deleteJob: (id: string) => Promise<void>
  deleteCharacter: (id: string) => Promise<void>
  deleteCharacters: (ids: string[]) => Promise<void>
  retryPart: (jobId: string, partId: string) => Promise<void>
  retryFailed: (jobId: string) => Promise<void>
  clearError: () => void
}

const api = (): NonNullable<Window['api']>['talkingphotos'] | null =>
  typeof window === 'undefined' ? null : (window.api?.talkingphotos ?? null)

/** App-lifetime subscriptions are registered once; their unsubscribe is intentionally discarded. */
let subscribed = false
/** Monotonic quote id, so an out-of-order reply cannot clobber the current price. */
let quoteTicket = 0

export const useTalkingPhotos = create<TalkingPhotosState>((set, get) => ({
  connection: null,
  catalog: null,
  characters: [],
  jobs: [],
  activeDetail: null,
  motions: [],
  characterProgress: null,
  preview: null,
  previewing: false,
  busy: null,
  error: '',

  init: async () => {
    const a = api()
    if (!a) return
    if (!subscribed && typeof window !== 'undefined') {
      subscribed = true
      window.api?.onTalkingPhotosJob?.((detail) => {
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === detail.job.id ? detail.job : j)),
          activeDetail: s.activeDetail?.job.id === detail.job.id ? detail : s.activeDetail
        }))
      })
      window.api?.onTalkingPhotosCharacter?.((p) => {
        set({ characterProgress: p })
        if (p.phase === 'done') void get().loadCharacters()
      })
    }
    try {
      const [catalog, characters, jobs, connection] = await Promise.all([
        a.catalog(),
        a.characters(),
        a.jobs(),
        a.connectionStatus()
      ])
      set({ catalog, characters, jobs, connection })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  testConnection: async () => {
    const a = api()
    if (!a) return
    set({ busy: 'connection', error: '' })
    try {
      set({ connection: await a.connectionTest() })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  signOut: async () => {
    const a = api()
    if (!a) return
    try {
      set({ connection: await a.signOut() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  loadCharacters: async () => {
    const a = api()
    if (!a) return
    try {
      set({ characters: await a.characters() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  loadJobs: async () => {
    const a = api()
    if (!a) return
    try {
      set({ jobs: await a.jobs() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  loadMotions: async (featureId, gender, aspectRatio) => {
    const a = api()
    if (!a) return
    try {
      set({ motions: await a.motions(featureId, gender, aspectRatio) })
    } catch (e) {
      // A missing motion catalog blocks the step but is not a job-level failure, so it reports
      // inline rather than as a page banner.
      set({ motions: [], error: errorMessage(e) })
    }
  },

  /**
   * Ask the vendor what this plan actually costs. The catalog's chunk ceiling is only an offline
   * fallback — the vendor can change a limit without telling us, and spending 30 renders against a
   * stale number is the exact failure this screen exists to prevent. Quotes are sequenced so a fast
   * reply to an old drag cannot overwrite a slow reply to the current one.
   */
  quote: async (featureId, partSeconds, sourceDurationSec) => {
    const a = api()
    if (!a || !featureId || sourceDurationSec <= 0) {
      set({ preview: null })
      return
    }
    const ticket = ++quoteTicket
    set({ previewing: true })
    try {
      const preview = await a.planPreview({ featureId, partSeconds, sourceDurationSec })
      if (ticket === quoteTicket) set({ preview, error: '' })
    } catch (e) {
      if (ticket === quoteTicket) set({ preview: null, error: errorMessage(e) })
    } finally {
      if (ticket === quoteTicket) set({ previewing: false })
    }
  },

  clearQuote: () => set({ preview: null, previewing: false }),

  probe: async (filePath) => {
    const a = api()
    if (!a) return 0
    try {
      return await a.probeAudio(filePath)
    } catch (e) {
      set({ error: errorMessage(e) })
      return 0
    }
  },


  generateCharacter: async (input) => {
    const a = api()
    if (!a) return
    set({ busy: 'character', error: '', characterProgress: null })
    try {
      await a.characterGenerate(input)
      await get().loadCharacters()
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  uploadCharacter: async (input) => {
    const a = api()
    if (!a) return
    set({ busy: 'character', error: '' })
    try {
      const created = await a.characterUpload(input)
      if (created) await get().loadCharacters()
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  createJob: async (input) => {
    const a = api()
    if (!a) return null
    set({ busy: 'create', error: '' })
    try {
      const detail = await a.jobCreate(input)
      set({ activeDetail: detail, jobs: await a.jobs() })
      return detail
    } catch (e) {
      set({ error: errorMessage(e) })
      return null
    } finally {
      set({ busy: null })
    }
  },

  openJob: async (id) => {
    const a = api()
    if (!a) return
    try {
      set({ activeDetail: await a.job(id) })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  closeJob: () => set({ activeDetail: null }),

  startJob: async (id) => {
    const a = api()
    if (!a) return
    set({ busy: 'job', error: '' })
    try {
      const detail = await a.jobStart(id)
      set({ activeDetail: detail, jobs: await a.jobs() })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ busy: null })
    }
  },

  pauseJob: async (id) => {
    const a = api()
    if (!a) return
    try {
      set({ activeDetail: await a.jobPause(id) })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  cancelJob: async (id) => {
    const a = api()
    if (!a) return
    try {
      const detail = await a.jobCancel(id)
      set({ activeDetail: detail, jobs: await a.jobs() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  deleteJob: async (id) => {
    const a = api()
    if (!a) return
    try {
      const jobs = await a.jobDelete(id)
      set((s) => ({ jobs, activeDetail: s.activeDetail?.job.id === id ? null : s.activeDetail }))
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  deleteCharacter: async (id) => {
    const a = api()
    if (!a) return
    try {
      set({ characters: await a.characterDeleteBulk([id]) })
      set({ jobs: await a.jobs() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  deleteCharacters: async (ids) => {
    const a = api()
    if (!a) return
    try {
      set({ characters: await a.characterDeleteBulk(ids) })
      set({ jobs: await a.jobs() })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  retryPart: async (jobId, partId) => {
    const a = api()
    if (!a) return
    try {
      set({ activeDetail: await a.partRetry(jobId, partId) })
      await a.jobStart(jobId)
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  retryFailed: async (jobId) => {
    const a = api()
    if (!a) return
    try {
      set({ activeDetail: await a.retryFailed(jobId) })
      await a.jobStart(jobId)
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  clearError: () => set({ error: '' })
}))
