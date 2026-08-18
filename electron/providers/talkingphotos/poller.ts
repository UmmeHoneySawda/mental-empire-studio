import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getRepos } from '../../db'
import { getProject, getProjectRaw, listProjects, ProviderRequestError } from './client'
import { downloadProviderJobOutput, outputDir } from './downloader'
import { advanceProviderOrchestrations } from './creation'
import { markTalkingPhotosReauthRequired } from './session'
import { emit } from '../../ipc/events'
import {
  TALKINGPHOTOS_CONNECTION_ID,
  TALKINGPHOTOS_PROVIDER,
  TALKINGPHOTOS_DOWNLOAD_CONCURRENCY,
  TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS,
  TALKINGPHOTOS_POLL_CONCURRENCY,
  isTerminalProviderJobStatus,
  mapRemoteProjectStatus,
  nextPollDelayMs,
  parseTalkingPhotosItemsIds,
  type ProviderJob,
  type ProviderJobOperation,
  type ProviderProjectSummary
} from '../../../shared/talkingphotos'
import { L } from '../../services/logger'
import { sentryLog } from '../../services/sentry'

// Single main-process polling coordinator (plan §12). Polls known jobs by remote
// project id (never the paginated project list — the HAR's own capture showed that
// polling pattern taking 180 requests over 16 minutes). Backoff/jitter and terminal
// detection are the pure functions in shared/talkingphotos.ts; this module only
// orchestrates DB + the session-bound client around them.

const TICK_MS = 5_000
const ADVANCE_MS = 15_000

interface PollState {
  streak: number
  nextPollAt: number
}

const pollState = new Map<string, PollState>()
const downloadsInFlight = new Set<string>()
let timer: ReturnType<typeof setInterval> | null = null
let advanceTimer: ReturnType<typeof setInterval> | null = null
/** Set on an authentication failure so the tick stops hammering an expired session
 *  until reconnect explicitly clears it (reconcileNonTerminalProviderJobs). */
let pausedUntilReconnect = false

// Re-entrancy guards — separate per function (coalescing variant, queue.ts:531-560).
// Previously one lock was shared by tick and reconcile; that caused the rerun to
// execute the holder's fn, silently skipping classification when tick held and
// reconcile collided. Each path now coalesces only itself.
let tickGuardRunning = false
let tickGuardRerun = false
let reconcileGuardRunning = false
let reconcileGuardRerun = false

// Advance loop guard — SOCKET_TIMEOUT_MS = 4min, interval 15s would otherwise overlap.
let advanceGuardRunning = false
let advanceGuardRerun = false

// Classification memoization — merges are immutable, so once we have fetched
// itemsIds for a merge we never need to fetch it again. Also prevents the
// 10×50 pagination storm on every 5s reconcile when steady-state has no pending segments.
const classifiedMergeIds = new Set<string>()
const mergeItemsCache = new Map<string, { ids: string[]; createdDate: string }>()
// Per-job / per-segment memoization for residuals R1/R2.
const attemptedNonMappedJobIds = new Set<string>()
const attemptedMappingFailedJobIds = new Set<string>()
const segmentDetailCache = new Map<string, unknown>()
const segmentDetailAttempts = new Map<string, number>()
const SEGMENT_DETAIL_MAX_ATTEMPTS = 3

function hasVerifiedLocalFile(job: ProviderJob): boolean {
  return !!(job.downloadedAt && job.localOutputPath && existsSync(job.localOutputPath))
}

async function pollJobOnce(job: ProviderJob, state: PollState): Promise<void> {
  const repos = getRepos()
  if (!job.remoteProjectId) {
    pollState.set(job.id, { streak: state.streak, nextPollAt: Date.now() + nextPollDelayMs({ sameStateStreak: state.streak }) })
    return
  }
  try {
    const remote = await getProject(job.remoteProjectId)
    if (!remote) throw new Error('TalkingPhotos returned a malformed project response.')

    // Segment projects are provider-side merge inputs, not user-facing outputs.
    // Treat a completed remote segment as locally complete without downloading it.
    const hasLocalFile = !!job.internalSegment || hasVerifiedLocalFile(job)
    const remoteMappedStatus = mapRemoteProjectStatus(remote.status, hasLocalFile)
    const downloadRetryExhausted = remoteMappedStatus === 'downloading' && (job.downloadAttempts ?? 0) >= TALKINGPHOTOS_MAX_DOWNLOAD_ATTEMPTS
    const mappedStatus = downloadRetryExhausted ? 'attention' : remoteMappedStatus
    const progress = remote.taskStepsTotal ? Math.round(((remote.taskStepNumber ?? 0) / remote.taskStepsTotal) * 100) : job.progress
    repos.updateProviderJob(job.id, {
      status: mappedStatus,
      remoteStep: remote.taskStepNumber,
      remoteStepsTotal: remote.taskStepsTotal,
      progress,
      remoteMediaUrl: remote.mediaUrl ?? job.remoteMediaUrl,
      thumbnailUrl: remote.thumbnailUrl ?? job.thumbnailUrl,
      remoteTaskUuid: remote.taskUuid,
      remotePreviousTaskUuid: remote.taskPrevUuid,
      lastPolledAt: new Date().toISOString()
    })
    const updated = repos.providerJob(job.id)
    if (updated) emit('talkingphotos:job', updated)

    // Milestone logs only when status actually changes — not every poll tick.
    if (mappedStatus !== job.status) {
      if (isTerminalProviderJobStatus(mappedStatus) || mappedStatus === 'attention') {
        const level = mappedStatus === 'completed' ? 'info' : 'warn'
        sentryLog[level](sentryLog.fmt`TalkingPhotos job reached ${mappedStatus}`, {
          provider_job_id: job.id,
          operation: job.operation,
          remote_project_id: job.remoteProjectId ?? '',
          job_status: mappedStatus,
          previous_status: job.status,
          progress: progress ?? 0,
          internal_segment: !!job.internalSegment
        })
      } else if (mappedStatus === 'downloading' || mappedStatus === 'running' || mappedStatus === 'queued') {
        sentryLog.info(sentryLog.fmt`TalkingPhotos job status: ${mappedStatus}`, {
          provider_job_id: job.id,
          operation: job.operation,
          remote_project_id: job.remoteProjectId ?? '',
          job_status: mappedStatus,
          previous_status: job.status,
          progress: progress ?? 0
        })
      }
    }

    // Re-read after the status update for same-tick staleness (plan §5).
    const fresh = repos.providerJob(job.id) ?? updated
    const isSegment = !!(fresh?.internalSegment)
    if (!isSegment && !downloadRetryExhausted && mappedStatus === 'downloading') {
      // Cap concurrency: downloads are fire-and-forget, gated by set size.
      if (downloadsInFlight.size >= TALKINGPHOTOS_DOWNLOAD_CONCURRENCY) {
        L.info(`talkingphotos download deferred job=${job.id} (concurrency cap ${TALKINGPHOTOS_DOWNLOAD_CONCURRENCY})`)
        // Will be retried on next tick — keep status as downloading.
      } else if (!downloadsInFlight.has(job.id)) {
        downloadsInFlight.add(job.id)
        sentryLog.info('TalkingPhotos auto-download started', {
          provider_job_id: job.id,
          operation: job.operation,
          remote_project_id: job.remoteProjectId ?? ''
        })
        void downloadProviderJobOutput(job.id)
          .catch((e: Error) => {
            L.warn(`talkingphotos auto-download failed job=${job.id}: ${e.message}`)
            // downloadProviderJobOutput already emits a structured error log; keep this local-only.
          })
          .finally(() => {
            downloadsInFlight.delete(job.id)
            const after = repos.providerJob(job.id)
            if (after) emit('talkingphotos:job', after)
          })
      }
    }

    if (isTerminalProviderJobStatus(mappedStatus)) {
      pollState.delete(job.id)
      return
    }
    const streak = mappedStatus === job.status ? state.streak + 1 : 0
    pollState.set(job.id, { streak, nextPollAt: Date.now() + nextPollDelayMs({ sameStateStreak: streak }) })
  } catch (e) {
    if (e instanceof ProviderRequestError && e.normalized.kind === 'authentication') {
      const firstPause = !pausedUntilReconnect
      pausedUntilReconnect = true
      // Always surface reauth through session.setStatus so the renderer gets the
      // connectionStatus push (direct DB writes left the UI stuck on "connected").
      markTalkingPhotosReauthRequired(e.normalized.message)
      repos.updateProviderJob(job.id, { status: 'attention', errorMessage: e.normalized.message })
      // One structured error per pause wave — otherwise every non-terminal job
      // floods Sentry with identical "reauth required" rows in the same tick.
      if (firstPause) {
        sentryLog.error('TalkingPhotos poll paused — reauth required', {
          provider_job_id: job.id,
          operation: job.operation,
          remote_project_id: job.remoteProjectId ?? '',
          error_kind: 'authentication',
          error_message: e.normalized.message.slice(0, 200)
        })
      }
      const updated = repos.providerJob(job.id)
      if (updated) emit('talkingphotos:job', updated)
      return
    }
    L.warn(`talkingphotos poll failed job=${job.id}: ${(e as Error).message}`)
    // Transient poll noise is high-volume; only keep local log. Auth is the actionable case above.
    pollState.set(job.id, { streak: state.streak, nextPollAt: Date.now() + nextPollDelayMs({ sameStateStreak: state.streak + 1 }) })
  }
}

// Lightweight mapWithConcurrency promoted from video-engine/broll/auto-plan.ts:86
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const settled = await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const index = cursor
        cursor += 1
        if (index >= items.length) return
        results[index] = await task(items[index]!, index)
      }
    })
  )
  const failure = settled.find((o) => o.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
  return results
}

async function tickImpl(): Promise<void> {
  if (pausedUntilReconnect) return
  const jobs = getRepos().nonTerminalProviderJobs()
  // Use Date.now() per iteration and provisional claim before await (plan §4)
  await mapWithConcurrency(jobs, TALKINGPHOTOS_POLL_CONCURRENCY, async (job) => {
    if (pausedUntilReconnect) return
    const state = pollState.get(job.id) ?? { streak: 0, nextPollAt: 0 }
    if (Date.now() < state.nextPollAt) return
    // Provisional claim so concurrent ticks do not re-poll the same job
    pollState.set(job.id, { streak: state.streak, nextPollAt: Date.now() + nextPollDelayMs({ sameStateStreak: state.streak }) })
    await pollJobOnce(job, state)
  })
}

async function withTickGuard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (tickGuardRunning) {
    tickGuardRerun = true
    return undefined
  }
  tickGuardRunning = true
  try {
    let result: T | undefined
    do {
      tickGuardRerun = false
      result = await fn()
    } while (tickGuardRerun)
    return result
  } finally {
    tickGuardRunning = false
  }
}

async function withReconcileGuard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (reconcileGuardRunning) {
    reconcileGuardRerun = true
    return undefined
  }
  reconcileGuardRunning = true
  try {
    let result: T | undefined
    do {
      reconcileGuardRerun = false
      result = await fn()
    } while (reconcileGuardRerun)
    return result
  } finally {
    reconcileGuardRunning = false
  }
}

async function tick(): Promise<void> {
  await withTickGuard(() => tickImpl())
}

async function guardedAdvance(): Promise<void> {
  if (advanceGuardRunning) {
    advanceGuardRerun = true
    return
  }
  advanceGuardRunning = true
  try {
    do {
      advanceGuardRerun = false
      await advanceProviderOrchestrations()
    } while (advanceGuardRerun)
  } catch (e) {
    L.warn(`talkingphotos advance failed: ${(e as Error).message}`)
  } finally {
    advanceGuardRunning = false
  }
}

function startAdvanceLoop(): void {
  if (advanceTimer) return
  advanceTimer = setInterval(() => {
    void guardedAdvance()
  }, ADVANCE_MS)
}

function stopAdvanceLoop(): void {
  if (advanceTimer) clearInterval(advanceTimer)
  advanceTimer = null
}

function cleanupPartOrphans(): void {
  // Single in-flight-aware sweep (startup: downloadsInFlight is empty, so all .parts are orphans).
  try {
    const dir = outputDir()
    const files = readdirSync(dir)
    let removed = 0
    for (const f of files) {
      if (!f.endsWith('.part')) continue
      const base = f.replace(/\.part$/, '')
      const inFlight = Array.from(downloadsInFlight).some((id) => {
        const job = getRepos().providerJob(id)
        return job && `${job.remoteProjectId ?? job.id}.mp4` === base
      })
      if (!inFlight) {
        try { unlinkSync(join(dir, f)); removed++ } catch { /* ignore */ }
      }
    }
    if (removed > 0) L.info(`talkingphotos: cleaned ${removed} orphaned .part file(s)`)
  } catch { /* dir may not exist */ }
}

export function startTalkingPhotosPoller(): void {
  if (timer) return
  cleanupPartOrphans()
  timer = setInterval(() => { void tick() }, TICK_MS)
  startAdvanceLoop()
  // Kick advance once without blocking startup poll.
  void guardedAdvance()
  sentryLog.info('TalkingPhotos poller started', { operation: 'poller', tick_ms: TICK_MS })
}

export function stopTalkingPhotosPoller(): void {
  if (timer) clearInterval(timer)
  timer = null
  stopAdvanceLoop()
  pollState.clear()
  sentryLog.info('TalkingPhotos poller stopped', { operation: 'poller' })
}

// ---- Merge → segment classification (plan §5) ----

async function classifyInternalSegments(): Promise<void> {
  const repos = getRepos()
  const allLocal = repos.providerJobs()

  // R1/R2: per-job attempted marker so a job checked once stops driving
  // pagination. Without this, attention (non-terminal) jobs pin
  // oldestUnclassifiedAt at 2026-07-22 forever, and a segment that fails
  // type/date is refetched every 5s (nested merges).
  const uncheckedPotential = allLocal.filter(
    (j) =>
      !j.internalSegment &&
      !isTerminalProviderJobStatus(j.status) &&
      j.operation !== 'merge' &&
      !!j.remoteProjectId &&
      !attemptedNonMappedJobIds.has(j.id) &&
      !attemptedMappingFailedJobIds.has(j.id) &&
      !hasVerifiedLocalFile(j)
  )
  const hasUnchecked = uncheckedPotential.length > 0
  // When steady-state (no unchecked), only probe the most recent page for
  // new merges — not 10 pages back to 2026-07-22.
  const oldestUnclassifiedAt = hasUnchecked
    ? Math.min(...uncheckedPotential.map((j) => Date.parse(j.createdAt) || Date.now()))
    : Date.now()
  const pageCap = hasUnchecked ? 10 : 1

  // Gather local merge jobs for segment-source set.
  const localMerges = allLocal.filter((j) => j.operation === 'merge' && j.remoteProjectId)

  // Paginate remote listing to collect merge details.
  const remoteMerges = new Map<string, ProviderProjectSummary>() // remoteId -> summary
  let oldestSeen = Number.POSITIVE_INFINITY
  for (let page = 1; page <= pageCap; page++) {
    let pageItems: ProviderProjectSummary[] = []
    try {
      pageItems = await listProjects({ limit: 50, page })
    } catch (e) {
      if (e instanceof ProviderRequestError && e.normalized.kind === 'authentication') {
        const firstPause = !pausedUntilReconnect
        pausedUntilReconnect = true
        markTalkingPhotosReauthRequired(e.normalized.message)
        if (firstPause) {
          sentryLog.error('TalkingPhotos classify paused — reauth required', {
            operation: 'poller',
            error_kind: 'authentication',
            error_message: e.normalized.message.slice(0, 200)
          })
        }
        return
      }
      L.warn(`talkingphotos classify: listProjects page ${page} failed: ${(e as Error).message}`)
      break
    }
    if (!pageItems.length) break
    for (const s of pageItems) {
      if (s.type === 'video_merge') remoteMerges.set(s.id, s)
    }
    const pageOldest = Math.min(...pageItems.map((s) => Date.parse(s.createdDate) || Date.now()))
    oldestSeen = Math.min(oldestSeen, pageOldest)
    if (oldestSeen < oldestUnclassifiedAt) break
    if (pageItems.length < 50) break
  }

  // Also include local merge ids that may not be in current window (old merges, or created via automation).
  for (const lm of localMerges) {
    if (!remoteMerges.has(lm.remoteProjectId!)) {
      // We will fetch its detail directly below; no summary needed.
      remoteMerges.set(lm.remoteProjectId!, {
        id: lm.remoteProjectId!,
        title: '',
        type: 'video_merge',
        status: 'completed',
        createdDate: lm.createdAt,
        updatedDate: lm.updatedAt
      } as ProviderProjectSummary)
    }
  }

  if (!remoteMerges.size) {
    // No merges at all — mark all unchecked as attempted so they don't pin pagination.
    for (const j of uncheckedPotential) attemptedNonMappedJobIds.add(j.id)
    return
  }

  // Build segmentId -> { mergeRemoteId, ordinal } map, using cache for already-classified merges.
  const segmentToMerge = new Map<string, { mergeRemoteId: string; ordinal: number; mergeCreatedDate: string }>()

  // Pre-populate from cache
  for (const [mergeId, cached] of mergeItemsCache) {
    if (!remoteMerges.has(mergeId)) continue
    for (let i = 0; i < cached.ids.length; i++) {
      const segId = cached.ids[i]!
      if (!segmentToMerge.has(segId)) {
        segmentToMerge.set(segId, { mergeRemoteId: mergeId, ordinal: i, mergeCreatedDate: cached.createdDate })
      }
    }
  }

  for (const [mergeId, summary] of remoteMerges) {
    if (classifiedMergeIds.has(mergeId) && mergeItemsCache.has(mergeId)) continue
    let raw: unknown
    try {
      raw = await getProjectRaw(mergeId)
    } catch (e) {
      if (e instanceof ProviderRequestError && e.normalized.kind === 'authentication') {
        const firstPause = !pausedUntilReconnect
        pausedUntilReconnect = true
        markTalkingPhotosReauthRequired(e.normalized.message)
        if (firstPause) {
          sentryLog.error('TalkingPhotos classify paused — reauth required', {
            operation: 'poller',
            error_kind: 'authentication',
            error_message: e.normalized.message.slice(0, 200)
          })
        }
        return
      }
      L.warn(`talkingphotos classify: getProjectRaw ${mergeId} failed: ${(e as Error).message}`)
      continue
    }
    const r = raw as Record<string, unknown>
    const options = r.options as Record<string, unknown> | undefined
    const rawIds = options?.itemsIds
    const ids = parseTalkingPhotosItemsIds(rawIds)
    const mergeCreated = (r.createdDate as string) || summary.createdDate || ''
    // Cache even empty results so we don't refetch forever.
    classifiedMergeIds.add(mergeId)
    mergeItemsCache.set(mergeId, { ids, createdDate: mergeCreated })
    if (!ids.length) continue
    for (let i = 0; i < ids.length; i++) {
      const segId = ids[i]!
      // Do not overwrite an already-mapped segment (first merge wins — deterministic).
      if (!segmentToMerge.has(segId)) {
        segmentToMerge.set(segId, { mergeRemoteId: mergeId, ordinal: i, mergeCreatedDate: mergeCreated })
      }
    }
  }

  if (!segmentToMerge.size) {
    L.info('talkingphotos classify: no segment mappings found')
    // All unchecked are not segments — mark them so they don't pin pagination.
    for (const j of uncheckedPotential) attemptedNonMappedJobIds.add(j.id)
    return
  }

  // Candidates are all non-terminal, non-merge jobs with a remote id.
  // We intentionally re-evaluate jobs that have a mapping even if they were
  // previously marked non-mapped (now removed on successful classification)
  // or mapping-failed (segment detail may have been transient).
  // Mapping-failed jobs stay excluded via attemptedMappingFailedJobIds.
  const allCandidates = allLocal.filter(
    (j) => !j.internalSegment && !isTerminalProviderJobStatus(j.status) && j.operation !== 'merge' && !!j.remoteProjectId && !hasVerifiedLocalFile(j) && !attemptedMappingFailedJobIds.has(j.id)
  )

  let classified = 0
  for (const job of allCandidates) {
    const mapping = segmentToMerge.get(job.remoteProjectId!)
    if (!mapping) {
      // No mapping for this job — if it was in uncheckedPotential, mark it
      // as attempted so it stops driving pagination. Jobs already in
      // attemptedNonMapped stay there.
      if (uncheckedPotential.some((u) => u.id === job.id)) attemptedNonMappedJobIds.add(job.id)
      continue
    }
    // Has mapping — check segment details with memoization (R1) and bounded retries (fix #2, #3).
    let segRaw: unknown
    if (segmentDetailCache.has(job.remoteProjectId!)) {
      segRaw = segmentDetailCache.get(job.remoteProjectId!)
    } else {
      try {
        segRaw = await getProjectRaw(job.remoteProjectId!)
        segmentDetailCache.set(job.remoteProjectId!, segRaw)
        segmentDetailAttempts.delete(job.remoteProjectId!)
      } catch (e) {
        if (e instanceof ProviderRequestError && e.normalized.kind === 'authentication') {
          const firstPause = !pausedUntilReconnect
          pausedUntilReconnect = true
          markTalkingPhotosReauthRequired((e as Error).message)
          if (firstPause) {
            sentryLog.error('TalkingPhotos classify paused — reauth required', {
              operation: 'poller',
              error_kind: 'authentication',
              error_message: (e as Error).message.slice(0, 200)
            })
          }
          return
        }
        const attempts = (segmentDetailAttempts.get(job.remoteProjectId!) ?? 0) + 1
        segmentDetailAttempts.set(job.remoteProjectId!, attempts)
        if (attempts >= SEGMENT_DETAIL_MAX_ATTEMPTS) {
          attemptedMappingFailedJobIds.add(job.id)
          segmentDetailCache.set(job.remoteProjectId!, null)
          L.warn(`talkingphotos classify: segment ${job.remoteProjectId} detail failed ${attempts} times, parking as non-segment`)
        }
        continue
      }
    }
    if (segRaw === null || segRaw === undefined) {
      attemptedMappingFailedJobIds.add(job.id)
      continue
    }
    const segRec = segRaw as Record<string, unknown>
    const segType = typeof segRec.type === 'string' ? segRec.type : ''
    if (segType !== 'human') {
      attemptedMappingFailedJobIds.add(job.id)
      continue
    }
    const segCreated = typeof segRec.createdDate === 'string' ? segRec.createdDate : job.createdAt
    if (mapping.mergeCreatedDate && segCreated) {
      const segTime = Date.parse(segCreated)
      const mergeTime = Date.parse(mapping.mergeCreatedDate)
      if (Number.isFinite(segTime) && Number.isFinite(mergeTime) && segTime >= mergeTime) {
        attemptedMappingFailedJobIds.add(job.id)
        continue
      }
    }
    // If this job was previously marked non-mapped, clear it since it now has a valid mapping.
    attemptedNonMappedJobIds.delete(job.id)
    // Find local parent job id for this merge.
    const parentLocal = repos.providerJobByRemoteId(TALKINGPHOTOS_CONNECTION_ID, mapping.mergeRemoteId)
    const parentId = parentLocal?.id
    repos.updateProviderJob(job.id, {
      internalSegment: true,
      parentProviderJobId: parentId,
      segmentOrdinal: mapping.ordinal
    })
    classified++
    L.info(`talkingphotos classify: job ${job.id} remote ${job.remoteProjectId} -> internal segment of merge ${mapping.mergeRemoteId} ordinal ${mapping.ordinal}`)
  }
  // Any remaining unchecked jobs that still had no mapping are now marked.
  for (const j of uncheckedPotential) {
    if (!segmentToMerge.has(j.remoteProjectId!) && !j.internalSegment) attemptedNonMappedJobIds.add(j.id)
  }
  if (classified > 0) {
    sentryLog.info('TalkingPhotos classified internal segments', {
      operation: 'poller',
      classified_count: classified,
      merge_count: remoteMerges.size
    })
  }
}

/** Immediately poll every non-terminal job, in-process (no waiting for the next
 *  tick) — used at app startup and right after a successful reconnect. */
export async function reconcileNonTerminalProviderJobs(): Promise<void> {
  // Clear pause outside the guard (wedge hazard plan §3).
  pausedUntilReconnect = false
  await withReconcileGuard(async () => {
    // Classification runs first, before any poll (plan §5).
    try {
      await classifyInternalSegments()
    } catch (e) {
      L.warn(`talkingphotos classify failed: ${(e as Error).message}`)
    }
    if (pausedUntilReconnect) return
    const jobs = getRepos().nonTerminalProviderJobs()
    sentryLog.info('TalkingPhotos reconcile non-terminal jobs', {
      operation: 'poller',
      job_count: jobs.length
    })
    await mapWithConcurrency(jobs, TALKINGPHOTOS_POLL_CONCURRENCY, async (job) => {
      if (pausedUntilReconnect) return
      const state = pollState.get(job.id) ?? { streak: 0, nextPollAt: 0 }
      // Reconcile ignores nextPollAt deliberately but still claims to avoid duplicate within this wave.
      pollState.set(job.id, { streak: state.streak, nextPollAt: Date.now() + nextPollDelayMs({ sameStateStreak: state.streak }) })
      await pollJobOnce(job, state)
    })
  })
  // Advance is now decoupled — not inside guard, not awaited inside poll path.
}

function inferOperation(remoteType: string): ProviderJobOperation {
  if (remoteType === 'video_merge') return 'merge'
  if (remoteType === 'subtitles') return 'subtitles'
  return 'video'
}

/** Pull the remote project listing and create a local provider_jobs row for any
 *  project not yet tracked (e.g. one created directly on the TalkingPhotos website).
 *  provider_jobs remains authoritative for remote state — this only seeds it. */
export async function importRemoteProjects(skipClassify = false): Promise<number> {
  const repos = getRepos()
  const remoteList = await listProjects({ limit: 50 })
  let imported = 0
  for (const summary of remoteList) {
    if (repos.providerJobByRemoteId(TALKINGPHOTOS_CONNECTION_ID, summary.id)) continue
    const now = new Date().toISOString()
    const job: ProviderJob = {
      id: `tpj-${randomUUID()}`,
      provider: TALKINGPHOTOS_PROVIDER,
      connectionId: TALKINGPHOTOS_CONNECTION_ID,
      operation: inferOperation(summary.type),
      remoteProjectId: summary.id,
      remoteTaskUuid: summary.taskUuid,
      remotePreviousTaskUuid: summary.taskPrevUuid,
      status: mapRemoteProjectStatus(summary.status, false),
      remoteStep: summary.taskStepNumber,
      remoteStepsTotal: summary.taskStepsTotal,
      progress: summary.taskStepsTotal ? Math.round(((summary.taskStepNumber ?? 0) / summary.taskStepsTotal) * 100) : 0,
      remoteMediaUrl: summary.mediaUrl,
      internalSegment: false,
      createdAt: summary.createdDate || now,
      updatedAt: summary.updatedDate || now
    }
    repos.upsertProviderJob(job)
    imported++
  }
  if (imported > 0) {
    L.info(`talkingphotos: imported ${imported} remote project(s) not yet tracked locally`)
    sentryLog.info('TalkingPhotos imported remote projects', {
      operation: 'poller',
      imported_count: imported,
      remote_list_size: remoteList.length
    })
  }
  // Run classification after import so newly imported segments are also repaired without waiting for next reconcile.
  if (!skipClassify) {
    try {
      await classifyInternalSegments()
    } catch (e) {
      L.warn(`talkingphotos classify after import failed: ${(e as Error).message}`)
    }
  }
  return imported
}

/** Manual "Sync" action: import any untracked remote projects, reconcile every
 *  non-terminal job now, and return the full, fresh local job list. */
export async function syncAllProviderJobsNow(): Promise<ProviderJob[]> {
  const startedAt = Date.now()
  sentryLog.info('TalkingPhotos sync started', { operation: 'poller' })
  try {
    const imported = await importRemoteProjects(true)
    await reconcileNonTerminalProviderJobs()
    const jobs = getRepos().providerJobs()
    sentryLog.info('TalkingPhotos sync completed', {
      operation: 'poller',
      imported_count: imported,
      job_count: jobs.length,
      duration_ms: Date.now() - startedAt
    })
    return jobs
  } catch (e) {
    sentryLog.error('TalkingPhotos sync failed', {
      operation: 'poller',
      duration_ms: Date.now() - startedAt,
      error_message: (e as Error).message.slice(0, 200)
    })
    throw e
  }
}
