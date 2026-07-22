/**
 * Pure view-logic for the Talking Video screen.
 * Vitest target (node, no DOM). Keep free of React/Electron imports.
 * Shared dual-scale voice helpers live in `@shared/talkingphotos`.
 */

import {
  clampProjectSpeedPitch,
  ttsApiSpeedPitchFromProjectScale
} from '@shared/talkingphotos'

// ---- Create draft ----------------------------------------------------------

export type SourceMode = 'script' | 'audio'
export type CreateAspect = '16:9' | '9:16' | '1:1'
export type CreateStyle = 'close_up' | 'normal' | 'high_quality'

export type CreateDraft = {
  sourceMode: SourceMode
  title: string
  scriptText: string
  audioPath?: string | null
  libraryAudioId?: string | null
  characterPrompt: string
  characterImagePath?: string | null
  aspectRatio: CreateAspect
  style: CreateStyle
  motionId?: string | number | null
  captionsOn: boolean
  ttsLanguage?: string
  ttsVoice?: string
  voiceStyle?: string
  ttsSpeed?: number
  ttsPitch?: number
  characterGender?: string
  characterAge?: string
  characterStyle?: string
  characterBeard?: string
  characterNegativePrompt?: string
}

export type FieldErrors = {
  title?: string
  characterImagePath?: string
  characterPrompt?: string
  audio?: string
  script?: string
  motion?: string
  form?: string
}

export type ValidateCreateCaps = {
  maxScriptChars?: number
  maxDurationSec?: number
  characterImageRequired?: boolean
  /** When false, script/TTS mode is blocked with this account-level reason. */
  ttsAvailable?: boolean
  ttsUnavailableReason?: string
}

/**
 * Behavior-locked validation for shared create fields.
 * Pre-redesign rules from TalkingVideo.tsx errors memo are preserved for:
 * title, characterImagePath (when required), characterPrompt, audio, script, motion.
 * New optional fields never introduce hard errors here.
 */
export function validateCreate(draft: CreateDraft, caps: ValidateCreateCaps = {}): FieldErrors {
  const e: FieldErrors = {}
  const imageRequired = caps.characterImageRequired !== false

  if (!draft.title.trim()) e.title = 'Add a title to continue.'
  if (imageRequired && !draft.characterImagePath) {
    e.characterImagePath = 'Add a character image to continue.'
  }
  if (!draft.characterPrompt.trim()) e.characterPrompt = 'Describe the character to continue.'

  if (draft.sourceMode === 'audio') {
    const hasAudio = !!(draft.audioPath || draft.libraryAudioId)
    if (!hasAudio) e.audio = 'Choose an audio file to continue.'
  } else if (caps.ttsAvailable === false) {
    e.script = caps.ttsUnavailableReason || 'Text-to-speech is not available for this account.'
  } else {
    if (!draft.scriptText.trim()) e.script = 'Write a script to continue.'
    else if (caps.maxScriptChars && caps.maxScriptChars > 0 && draft.scriptText.length > caps.maxScriptChars) {
      const over = draft.scriptText.length - caps.maxScriptChars
      e.script = `Script is ${over} characters over the ${caps.maxScriptChars}-character limit.`
    }
  }

  if (draft.style === 'normal') {
    const mid = draft.motionId
    const missing = mid === undefined || mid === null || mid === '' || mid === 0 || mid === '0'
    if (missing) e.motion = 'Choose a motion to continue.'
  }

  return e
}

export const FIELD_ORDER: Array<keyof FieldErrors> = [
  'title',
  'characterImagePath',
  'characterPrompt',
  'audio',
  'script',
  'motion'
]

// ---- Script length / quota -------------------------------------------------

/** Rough mapping: ~12.5 chars/sec for spoken narration estimates. */
export function scriptLengthHint(chars: number, maxChars: number): {
  approxSec: number
  label: string
  tone: 'ok' | 'warn' | 'err'
} {
  const safeMax = Math.max(0, maxChars || 0)
  const approxSec = Math.max(0, Math.round(chars / 12.5))
  const maxLabel = safeMax > 0 ? safeMax.toLocaleString() : '—'
  const label = `~${approxSec} sec · ${chars.toLocaleString()} / ${maxLabel} characters`
  if (safeMax > 0 && chars > safeMax) return { approxSec, label, tone: 'err' }
  if (safeMax > 0 && chars / safeMax > 0.85) return { approxSec, label, tone: 'warn' }
  return { approxSec, label, tone: 'ok' }
}

export function humanizeQuota(usage: {
  videosToday: number
  videosTodayLimit: number
  concurrent: number
  concurrentLimit: number
}): string {
  const limit = usage.videosTodayLimit
  if (!Number.isFinite(limit) || limit <= 0) {
    if (usage.concurrentLimit > 0) {
      const free = Math.max(0, usage.concurrentLimit - usage.concurrent)
      return free === 0
        ? 'You are at the concurrent job limit right now.'
        : `You can run ${free} more video${free === 1 ? '' : 's'} at once.`
    }
    return 'Ready when you are.'
  }
  const remaining = Math.max(0, limit - usage.videosToday)
  if (remaining === 0) return "You've reached today's video limit."
  return `You can make ${remaining} more video${remaining === 1 ? '' : 's'} today.`
}

// ---- Library items ---------------------------------------------------------

export type LibraryStatus = 'queued' | 'running' | 'completed' | 'failed'
export type LibraryKind = 'ai_video' | 'merged' | 'captioned' | 'resized'

export type LibraryItem = {
  id: string
  title: string
  status: LibraryStatus
  kind: LibraryKind
  createdAt: number
  thumbnailUrl?: string | null
  localOutputPath?: string | null
  remoteMediaUrl?: string | null
  remoteProjectId?: string | null
  progress?: number | null
  remoteStep?: number | null
  remoteStepsTotal?: number | null
  etaSeconds?: number | null
  hostName?: string | null
  segmentOrdinal?: number | null
  segmentTotal?: number | null
  parentId?: string | null
  internalSegment?: boolean
  errorMessage?: string | null
  operation?: string | null
}

export function mapJobStatusToLibrary(status: string): LibraryStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'attention' || status === 'cancelled') return 'failed'
  if (status === 'queued') return 'queued'
  return 'running' // running | downloading
}

export function kindFromOperation(operation?: string | null): LibraryKind {
  if (operation === 'merge') return 'merged'
  if (operation === 'subtitles') return 'captioned'
  return 'ai_video'
}

/** True when the title is a fabricated fallback, not a real project/script name. */
export function isSyntheticLibraryTitle(title: string, remoteProjectId?: string | null, id?: string): boolean {
  const t = (title || '').trim()
  if (!t) return true
  if (remoteProjectId && t === `Project ${remoteProjectId}`) return true
  if (id && (t === `Video ${id.slice(0, 8)}` || t === `Video ${id}`)) return true
  return false
}

/**
 * Prefer the user-facing title stored on the creation checkpoint (`requestJson.input.title`),
 * then fall back to synthetic ids only when nothing better exists.
 */
export function titleFromProviderJob(job: {
  id: string
  remoteProjectId?: string | null
  requestJson?: string | null
}): string {
  try {
    const parsed = JSON.parse(job.requestJson || '') as { input?: { title?: unknown }; title?: unknown }
    const fromInput = parsed?.input?.title
    if (typeof fromInput === 'string' && fromInput.trim()) return fromInput.trim()
    // Some checkpoints may stash a display title at the root.
    if (typeof parsed?.title === 'string' && parsed.title.trim()) return parsed.title.trim()
  } catch {
    /* ignore malformed checkpoints */
  }
  if (job.remoteProjectId) return `Project ${job.remoteProjectId}`
  return `Video ${job.id.slice(0, 8)}`
}

export function unifyJobsAndProjects(jobs: LibraryItem[], projects: LibraryItem[]): LibraryItem[] {
  const byRemote = new Map<string, number>() // remoteProjectId → index in result
  const result: LibraryItem[] = []

  for (const job of jobs) {
    if (job.remoteProjectId) byRemote.set(String(job.remoteProjectId), result.length)
    result.push(job)
  }

  for (const project of projects) {
    const key = project.remoteProjectId ? String(project.remoteProjectId) : project.id
    const existingIdx = byRemote.has(key)
      ? byRemote.get(key)!
      : result.findIndex((j) => j.id === project.id || (j.remoteProjectId && String(j.remoteProjectId) === key))

    if (existingIdx >= 0) {
      // Jobs win for in-flight state, but keep real remote titles/thumbs when the job title is synthetic.
      const existing = result[existingIdx]
      result[existingIdx] = {
        ...existing,
        title:
          isSyntheticLibraryTitle(existing.title, existing.remoteProjectId, existing.id) && project.title
            ? project.title
            : existing.title,
        thumbnailUrl: existing.thumbnailUrl || project.thumbnailUrl,
        remoteMediaUrl: existing.remoteMediaUrl || project.remoteMediaUrl
      }
      continue
    }
    result.push(project)
  }

  return result.sort((a, b) => b.createdAt - a.createdAt)
}

export function rollupSegments(items: LibraryItem[]): LibraryItem[] {
  const childrenByParent = new Map<string, LibraryItem[]>()
  const tops: LibraryItem[] = []

  for (const item of items) {
    if (item.internalSegment && item.parentId) {
      const list = childrenByParent.get(item.parentId) ?? []
      list.push(item)
      childrenByParent.set(item.parentId, list)
      continue
    }
    tops.push(item)
  }

  return tops.map((parent) => {
    const kids = childrenByParent.get(parent.id)
    if (!kids || kids.length === 0) {
      // Title may already encode part X/Y from segment metadata on parent itself
      if (parent.segmentOrdinal != null && parent.segmentTotal != null && parent.segmentTotal > 1) {
        const base = parent.title.replace(/\s*·\s*part\s+\d+\s*\/\s*\d+\s*$/i, '').trim()
        return {
          ...parent,
          title: `${base} · part ${parent.segmentOrdinal}/${parent.segmentTotal}`
        }
      }
      return parent
    }
    const ordinals = kids
      .map((k) => k.segmentOrdinal)
      .filter((n): n is number => typeof n === 'number')
    const total = parent.segmentTotal ?? kids[0]?.segmentTotal ?? (ordinals.length ? Math.max(...ordinals) : kids.length)
    const ordinal = parent.segmentOrdinal ?? (ordinals.length ? Math.min(...ordinals) : 1)
    const base = parent.title.replace(/\s*·\s*part\s+\d+\s*\/\s*\d+\s*$/i, '').trim()
    return {
      ...parent,
      title: `${base} · part ${ordinal}/${total}`,
      segmentOrdinal: ordinal,
      segmentTotal: total
    }
  })
}

export function filterLibrary(
  items: LibraryItem[],
  opts: { query?: string; filter?: 'all' | 'ready' | 'making' | 'failed' } = {}
): LibraryItem[] {
  const q = (opts.query ?? '').trim().toLowerCase()
  const filter = opts.filter ?? 'all'
  return items.filter((item) => {
    if (filter === 'ready' && item.status !== 'completed') return false
    if (filter === 'failed' && item.status !== 'failed') return false
    if (filter === 'making' && item.status !== 'queued' && item.status !== 'running') return false
    if (q) {
      const hay = `${item.title} ${item.remoteProjectId ?? ''} ${item.id}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): { page: number; pageSize: number; total: number; totalPages: number; items: T[] } {
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / size))
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (p - 1) * size
  return { page: p, pageSize: size, total, totalPages, items: items.slice(start, start + size) }
}

// ---- Progress / time -------------------------------------------------------

export function describeProgress(
  item: Pick<LibraryItem, 'status' | 'progress' | 'remoteStep' | 'remoteStepsTotal' | 'etaSeconds' | 'errorMessage'>
): {
  barPct: number
  label: string
  tone: 'idle' | 'active' | 'ok' | 'err'
  etaLabel?: string
} {
  if (item.status === 'completed') {
    return { barPct: 100, label: 'Ready', tone: 'ok' }
  }
  if (item.status === 'failed') {
    return {
      barPct: 0,
      label: item.errorMessage?.trim() || 'Something went wrong',
      tone: 'err'
    }
  }
  if (item.status === 'queued') {
    return { barPct: 0, label: 'Queued…', tone: 'idle' }
  }

  let barPct = 0
  if (typeof item.progress === 'number' && Number.isFinite(item.progress) && item.progress > 0) {
    barPct = Math.max(0, Math.min(100, item.progress <= 1 ? Math.round(item.progress * 100) : Math.round(item.progress)))
  } else if (
    typeof item.remoteStep === 'number' &&
    typeof item.remoteStepsTotal === 'number' &&
    item.remoteStepsTotal > 0
  ) {
    barPct = Math.max(0, Math.min(100, Math.round((item.remoteStep / item.remoteStepsTotal) * 100)))
  } else {
    barPct = 15 // indeterminate-ish floor while running
  }

  let label = 'Almost done…'
  if (barPct < 40) label = 'Generating presenter…'
  else if (barPct < 85) label = 'Rendering video…'

  let etaLabel: string | undefined
  if (typeof item.etaSeconds === 'number' && item.etaSeconds > 0) {
    const s = Math.round(item.etaSeconds)
    if (s < 60) etaLabel = `about ${s} second${s === 1 ? '' : 's'} left`
    else {
      const m = Math.round(s / 60)
      etaLabel = `about ${m} minute${m === 1 ? '' : 's'} left`
    }
  }

  return { barPct, label, tone: 'active', etaLabel }
}

export function formatRelativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function formatExactTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function retentionRemaining(
  createdAt: number,
  now: number,
  days = 60
): { daysLeft: number; label: string } {
  const ms = days * 24 * 60 * 60 * 1000
  const expires = createdAt + ms
  const daysLeft = Math.max(0, Math.ceil((expires - now) / (24 * 60 * 60 * 1000)))
  return {
    daysLeft,
    label: 'We keep your videos for 60 days — download the ones you want to keep.'
  }
}

// ---- Duplicate prefill -----------------------------------------------------

export function buildDuplicatePrefill(
  item: LibraryItem,
  sourceDraft?: Partial<CreateDraft>
): Partial<CreateDraft> {
  const baseTitle = item.title.replace(/\s*·\s*part\s+\d+\s*\/\s*\d+\s*$/i, '').trim()
  return {
    ...sourceDraft,
    title: baseTitle ? `${baseTitle} (copy)` : 'Untitled copy',
    // Never carry creation intent — store assigns a fresh one on submit
  }
}

// ---- Helpers for UI mapping ------------------------------------------------

export function firstBlockingError(errors: FieldErrors): string | undefined {
  for (const key of FIELD_ORDER) {
    if (errors[key]) return errors[key]
  }
  return errors.form
}

export function defaultCreateDraft(overrides?: Partial<CreateDraft>): CreateDraft {
  return {
    sourceMode: 'script',
    title: '',
    scriptText: '',
    audioPath: '',
    characterPrompt: '',
    characterImagePath: '',
    aspectRatio: '9:16',
    style: 'high_quality',
    motionId: 0,
    captionsOn: true,
    ttsLanguage: 'en-US',
    ttsVoice: 'en-US-AndrewMultilingualNeural',
    voiceStyle: 'general',
    ttsSpeed: 50,
    ttsPitch: 50,
    characterGender: 'female',
    characterAge: 'adult',
    characterStyle: 'realistic',
    characterBeard: 'shaven',
    characterNegativePrompt: '',
    ...overrides
  }
}

/**
 * Map UI/project 0–100 (50 = normal) → create_audio_vc scale (speed≈1, pitch≈0).
 * Re-exports the shared pure converter so view-logic tests lock the dual-scale contract.
 */
export function mapSpeedPitchToProvider(speed100: number, pitch100: number): { speed: number; pitch: number } {
  return ttsApiSpeedPitchFromProjectScale(speed100, pitch100)
}

/** Map UI 0–100 → POST /project ttsSpeed/ttsPitch (same scale, clamped). */
export function mapSpeedPitchToProject(speed100: number, pitch100: number): { ttsSpeed: number; ttsPitch: number } {
  const c = clampProjectSpeedPitch(speed100, pitch100)
  return { ttsSpeed: c.speed, ttsPitch: c.pitch }
}

export function moodToVoiceStyle(mood: string): string {
  const m = mood.toLowerCase()
  if (m === 'neutral') return 'general'
  if (m === 'excited') return 'excited'
  if (m === 'serious') return 'serious'
  if (m === 'friendly') return 'friendly'
  if (m === 'unfriendly') return 'unfriendly'
  return mood || 'general'
}

export function styleToApi(style: CreateStyle): 'normal' | 'high_quality' | 'close_up' {
  return style
}
