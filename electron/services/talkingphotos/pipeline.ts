// The long-form pipeline: one resumable phase machine per job.
//
// audio -> probe -> plan -> split -> category -> upload -> submit -> await -> merge -> awaitMerge -> download -> done
//
// Every phase is idempotent and writes its result to SQLite before advancing, because a job is
// 6-30 vendor renders spanning up to an hour and a crash must not re-spend what already succeeded.
// The DB row, never memory, is the source of truth for what has happened.
//
// Guardrails exist because each mistake here is expensive in a specific way:
//   - Over-quota:      wasted renders out of 100/day.
//   - Over-concurrency: a 422 that looks like a failure but is back-pressure.
//   - Merging early:   a silently WRONG video, the worst outcome, because it looks fine.
//   - Blind retry:     duplicate renders (this actually happened in a previous session).

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { getRepos } from '../../db'
import { emit } from '../../ipc/events'
import { sentryLog, captureException } from '../sentry'
import { probeDuration } from '../audio'
import {
  TP_MERGE_CAP_SECONDS,
  mergeFits,
  tpFeature,
  tpMergeTitle,
  tpRemoteTitle,
  buildRenderPayload,
  validateRenderInput,
  type TpJob,
  type TpJobDetail,
  type TpJobPhase,
  type TpOutput,
  type TpPart
} from '../../../shared/talkingphotos'
import { TpError, describeTpError } from './client'
import {
  createProject,
  ensureLibraryCategory,
  fetchConcurrency,
  fetchDurationLimit,
  fetchQuota,
  isFailedStatus,
  listProjectsByPrefix,
  mergeProjects,
  projectDownloadUrl,
  uploadAudio,
  type TpProjectRow
} from './api'
import { tpDownload } from './client'
import { extractChunk, tpPartPath, tpPartsDir, tpOutputsDir, verifyExistingChunk } from './audio'

const POLL_INTERVAL_MS = 20_000
const MAX_PART_ATTEMPTS = 3
const PHASE_ORDER: TpJobPhase[] = [
  'audio', 'probe', 'plan', 'split', 'category', 'upload', 'submit', 'await', 'merge', 'awaitMerge', 'download', 'done'
]

/** Cooperative control state, keyed by job id. Absent means "not running". */
type Control = 'run' | 'pause' | 'cancel'
const control = new Map<string, Control>()
const running = new Set<string>()

function now(): string {
  return new Date().toISOString()
}

function detail(jobId: string): TpJobDetail {
  const d = getRepos().tpJobDetail(jobId)
  if (!d) throw new TpError('VENDOR_REJECTED', 'That job no longer exists.')
  return d
}

function broadcast(jobId: string): void {
  const d = getRepos().tpJobDetail(jobId)
  if (d) emit('talkingphotos:job', d)
}

function setPhase(jobId: string, phase: TpJobPhase): void {
  getRepos().updateTpJob(jobId, { phase })
  broadcast(jobId)
  sentryLog.info('TalkingPhotos phase', { operation: `tp_${phase}`, job_id: jobId })
}

function fail(jobId: string, message: string): never {
  getRepos().updateTpJob(jobId, { status: 'error', error: message })
  broadcast(jobId)
  throw new TpError('VENDOR_REJECTED', message)
}

/** Pausing is cooperative, not a failure: the job keeps every result it already has. */
class Paused extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'Paused'
  }
}

function checkControl(jobId: string): void {
  const c = control.get(jobId)
  if (c === 'pause') throw new Paused('Paused.')
  if (c === 'cancel') throw new Paused('Cancelled.')
}

async function sleep(ms: number, jobId: string): Promise<void> {
  const step = 1_000
  for (let waited = 0; waited < ms; waited += step) {
    checkControl(jobId)
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)))
  }
  checkControl(jobId)
}

function pauseJobWith(jobId: string, message: string): never {
  getRepos().updateTpJob(jobId, { status: 'paused', error: message })
  broadcast(jobId)
  throw new Paused(message)
}

/**
 * A vendor condition that time or user action fixes, rather than a defect. These pause the job with
 * a plain sentence instead of hammering the site or burning session slots.
 */
function isRecoverable(e: unknown): e is TpError {
  return e instanceof TpError && ['SESSION_LIMIT', 'THROTTLED', 'AUTH_LOST', 'QUOTA_EXHAUSTED', 'NETWORK'].includes(e.code)
}

// ---- Phases ---------------------------------------------------------------------------------

async function phaseProbe(job: TpJob): Promise<void> {
  if (job.sourceDurationSec > 0) return
  if (!job.audioPath || !existsSync(job.audioPath)) fail(job.id, 'The source audio file is missing. Download it again and start a new job.')
  const sourceDurationSec = await probeDuration(job.audioPath)
  if (!(sourceDurationSec > 0)) fail(job.id, 'That audio file has no measurable duration.')
  getRepos().updateTpJob(job.id, { sourceDurationSec })
}

async function phaseSplit(jobId: string): Promise<void> {
  const { job, parts, outputs } = detail(jobId)
  if (!job.audioPath || !existsSync(job.audioPath)) fail(jobId, 'The source audio file is missing.')

  const partsDir = tpPartsDir(dirname(dirname(job.audioPath)))
  const outputOrdById = new Map(outputs.map((o) => [o.id, o.ord]))
  const pending = parts.filter((p) => p.status === 'planned' || !p.audioDurationSec)

  let done = parts.length - pending.length
  for (const part of pending) {
    checkControl(jobId)
    const outputOrd = outputOrdById.get(part.outputId) ?? 1
    const outPath = tpPartPath(partsDir, outputOrd, part.ord)

    // Resume: trust an existing cut only if it measures close to plan.
    const expected = part.endSec - part.startSec
    const existing = await verifyExistingChunk(outPath, expected)
    if (existing !== null) {
      getRepos().updateTpPart(part.id, { audioPath: outPath, audioDurationSec: existing, status: 'split' })
    } else {
      const cut = await extractChunk(job.audioPath, { ord: part.ord, startSec: part.startSec, endSec: part.endSec, outPath })
      getRepos().updateTpPart(part.id, { audioPath: cut.outPath, audioDurationSec: cut.durationSec, status: 'split' })
    }
    done += 1
    if (done % 3 === 0 || done === parts.length) broadcast(jobId)
  }
  broadcast(jobId)
}

async function phaseCategory(job: TpJob): Promise<void> {
  if (job.libraryCategoryId > 0) return
  const libraryCategoryId = await ensureLibraryCategory()
  getRepos().updateTpJob(job.id, { libraryCategoryId })
}

async function phaseUpload(jobId: string): Promise<void> {
  const { job, parts } = detail(jobId)
  const feature = tpFeature(job.featureId)
  if (!feature) fail(jobId, `The feature "${job.featureId}" is no longer available in this version.`)

  // Authoritative ceiling, live. The catalog value is only an offline fallback.
  const limit = await fetchDurationLimit(feature.type, feature.style).catch(() => ({ maxDuration: feature.maxPartSeconds, maxCharactersTTS: 0 }))
  const maxPartSeconds = limit.maxDuration > 0 ? limit.maxDuration : feature.maxPartSeconds

  const pending = parts.filter((p) => !p.mediaId)
  for (const part of pending) {
    checkControl(jobId)
    if (!part.audioPath || !existsSync(part.audioPath)) fail(jobId, `Chunk ${part.ord}'s audio file is missing.`)

    const media = await uploadAudio(job.libraryCategoryId, part.audioPath)
    // The vendor's own measurement is what its render limit is enforced against.
    const vendorSec = media.data?.duration ?? part.audioDurationSec
    if (vendorSec > maxPartSeconds + 1) {
      fail(jobId, `Chunk ${part.ord} is ${Math.round(vendorSec)}s but ${feature.label} allows ${maxPartSeconds}s per render. Lower the chunk length and start a new job.`)
    }
    getRepos().updateTpPart(part.id, { mediaId: media.id, audioDurationSec: vendorSec, status: 'uploaded' })
    broadcast(jobId)
  }
}

/** Submits renders while slots are free, oldest chunk first. Back-pressure waits; it never fails. */
async function phaseSubmit(jobId: string): Promise<void> {
  const { job } = detail(jobId)
  const feature = tpFeature(job.featureId)
  if (!feature) fail(jobId, `The feature "${job.featureId}" is no longer available in this version.`)

  const outputOrd = new Map(detail(jobId).outputs.map((o) => [o.id, o.ord]))

  for (;;) {
    checkControl(jobId)
    const { parts } = detail(jobId)
    const queue = parts.filter((p) => p.status === 'uploaded' || (p.status === 'error' && p.attempts < MAX_PART_ATTEMPTS))
    if (queue.length === 0) return

    const quota = await fetchQuota().catch(() => null)
    if (quota && quota.videosLimit > 0 && quota.videosUsed >= quota.videosLimit) {
      pauseJobWith(jobId, `Today's TalkingPhotos render allowance is used up (${quota.videosUsed}/${quota.videosLimit}). The count resets overnight — resume then.`)
    }

    const slots = await fetchConcurrency(feature.type)
    const free = Math.max(0, slots.limit - slots.count)
    if (free === 0) {
      await sleep(POLL_INTERVAL_MS, jobId)
      continue
    }

    for (const part of queue.slice(0, free)) {
      checkControl(jobId)
      const remoteTitle = tpRemoteTitle(jobId, outputOrd.get(part.outputId) ?? 1, part.ord)
      const input = {
        title: remoteTitle,
        feature,
        aspectRatio: job.aspectRatio,
        audioMediaId: part.mediaId,
        characterResultUuid: job.characterResultUuid || undefined,
        characterImageMediaId: job.characterMediaId || undefined,
        characterStyle: job.characterStyle,
        characterGender: job.characterGender,
        characterAge: job.characterAge,
        characterEthnicity: job.characterEthnicity,
        characterBeard: job.characterBeard,
        motionId: job.motionId || undefined,
        parentMotionId: job.parentMotionId || undefined
      }
      const problems = validateRenderInput(input)
      if (problems.length) fail(jobId, problems[0])

      try {
        const row = await createProject(feature.createPath, buildRenderPayload(input))
        getRepos().updateTpPart(part.id, {
          projectId: row.id,
          remoteTitle,
          status: 'submitted',
          attempts: part.attempts + 1,
          error: ''
        })
      } catch (e) {
        if (e instanceof TpError && e.code === 'CONCURRENCY_FULL') {
          // Back-pressure, not failure. Do not count an attempt.
          break
        }
        if (e instanceof TpError && e.code === 'AUTH_LOST') {
          // The submit may already have taken effect. Reconcile by title instead of resubmitting.
          const rows = await listProjectsByPrefix(remoteTitle).catch(() => [] as TpProjectRow[])
          const found = rows.find((r) => r.title === remoteTitle)
          if (found) {
            getRepos().updateTpPart(part.id, { projectId: found.id, remoteTitle, status: 'submitted', attempts: part.attempts + 1, error: '' })
            continue
          }
          throw e
        }
        if (isRecoverable(e)) throw e
        getRepos().updateTpPart(part.id, {
          status: 'error',
          attempts: part.attempts + 1,
          error: describeTpError(e).message
        })
      }
    }
    broadcast(jobId)
    await sleep(2_000, jobId)
  }
}

/**
 * Poll the project list until every chunk reaches a terminal state. `GET /project/{id}` cannot be
 * used: it returns 422 for anything not yet completed.
 */
async function phaseAwait(jobId: string): Promise<void> {
  for (;;) {
    checkControl(jobId)
    const { parts } = detail(jobId)
    const watching = parts.filter((p) => p.status === 'submitted' || p.status === 'processing')
    const retryable = parts.filter((p) => p.status === 'error' && p.attempts < MAX_PART_ATTEMPTS)

    if (watching.length === 0) {
      if (retryable.length > 0) {
        // Resubmit failed chunks; the uploaded audio is reused so a retry costs a render, not an upload.
        await phaseSubmit(jobId)
        continue
      }
      return
    }

    const rows = await listProjectsByPrefix(`ME-${jobId}-`, 45)
    const byId = new Map(rows.map((r) => [r.id, r]))

    for (const part of watching) {
      const row = part.projectId ? byId.get(part.projectId) : rows.find((r) => r.title === part.remoteTitle)
      if (!row) continue
      if (row.status === 'completed') {
        getRepos().updateTpPart(part.id, { status: 'completed', error: '' })
      } else if (isFailedStatus(row.status)) {
        getRepos().updateTpPart(part.id, {
          status: 'error',
          error: row.message?.trim() || `TalkingPhotos reported this chunk as ${row.status}.`
        })
      } else if (part.status !== 'processing') {
        getRepos().updateTpPart(part.id, { status: 'processing' })
      }
    }
    broadcast(jobId)
    await sleep(POLL_INTERVAL_MS, jobId)
  }
}

/**
 * Stitch each output whose chunks are ALL completed. Two refusals here, both deliberate: a merge
 * missing a chunk yields a silently wrong video, and a merge over the cap is rejected by the vendor
 * after the renders are already paid for.
 */
async function phaseMerge(jobId: string): Promise<void> {
  const { outputs, parts } = detail(jobId)

  for (const output of outputs) {
    checkControl(jobId)
    if (output.mergeProjectId > 0 || output.status === 'completed') continue

    const own = parts.filter((p) => p.outputId === output.id).sort((a, b) => a.ord - b.ord)
    if (own.length === 0) continue

    const failed = own.filter((p) => p.status === 'error')
    if (failed.length > 0) {
      getRepos().updateTpOutput(output.id, {
        status: 'error',
        error: `${failed.length} of ${own.length} chunks failed. Retry them, then stitch — a video missing a chunk would be wrong, not short.`
      })
      continue
    }
    if (own.some((p) => p.status !== 'completed')) continue

    const fit = mergeFits(own.map((p) => p.audioDurationSec), detail(jobId).job.mergeCapSec || TP_MERGE_CAP_SECONDS)
    if (!fit.ok) {
      getRepos().updateTpOutput(output.id, {
        status: 'error',
        error: `These chunks measure ${Math.round(fit.totalSec)}s, which is ${Math.round(fit.overBySec)}s over the ${TP_MERGE_CAP_SECONDS}s stitch limit.`
      })
      continue
    }

    const title = tpMergeTitle(jobId, output.ord)
    try {
      const row = await mergeProjects(own.map((p) => p.projectId), title)
      getRepos().updateTpOutput(output.id, { mergeProjectId: row.id, status: 'merging', error: '' })
    } catch (e) {
      if (e instanceof TpError && e.code === 'AUTH_LOST') {
        const rows = await listProjectsByPrefix(title).catch(() => [] as TpProjectRow[])
        const found = rows.find((r) => r.title === title)
        if (found) {
          getRepos().updateTpOutput(output.id, { mergeProjectId: found.id, status: 'merging', error: '' })
          continue
        }
      }
      if (isRecoverable(e)) throw e
      getRepos().updateTpOutput(output.id, { status: 'error', error: describeTpError(e).message })
    }
    broadcast(jobId)
  }
}

async function phaseAwaitMerge(jobId: string): Promise<void> {
  for (;;) {
    checkControl(jobId)
    const { outputs } = detail(jobId)
    const watching = outputs.filter((o) => o.status === 'merging' && o.mergeProjectId > 0)
    if (watching.length === 0) return

    const rows = await listProjectsByPrefix(`ME-${jobId}-o`, 45)
    const byId = new Map(rows.map((r) => [r.id, r]))

    for (const output of watching) {
      const row = byId.get(output.mergeProjectId)
      if (!row) continue
      if (row.status === 'completed') {
        getRepos().updateTpOutput(output.id, { status: 'downloading', error: '' })
      } else if (isFailedStatus(row.status)) {
        getRepos().updateTpOutput(output.id, {
          status: 'error',
          error: row.message?.trim() || `TalkingPhotos reported the stitch as ${row.status}.`
        })
      }
    }
    broadcast(jobId)
    await sleep(POLL_INTERVAL_MS, jobId)
  }
}

async function phaseDownload(jobId: string): Promise<void> {
  const { job, outputs } = detail(jobId)
  const dir = tpOutputsDir(dirname(dirname(job.audioPath)))

  for (const output of outputs) {
    checkControl(jobId)
    if (output.status !== 'downloading') continue
    if (output.localPath && existsSync(output.localPath)) {
      getRepos().updateTpOutput(output.id, { status: 'completed' })
      continue
    }

    const target = join(dir, `output-${output.ord}.mp4`)
    mkdirSync(dirname(target), { recursive: true })
    const partial = `${target}.part`
    try {
      const bytes = await tpDownload(projectDownloadUrl(output.mergeProjectId))
      writeFileSync(partial, bytes)
      // Only now does the file become the real artefact, so an interrupted write is never trusted.
      if (existsSync(target)) rmSync(target, { force: true })
      writeFileSync(target, bytes)
      rmSync(partial, { force: true })
      getRepos().updateTpOutput(output.id, { localPath: target, status: 'completed', error: '' })
      sentryLog.info('TalkingPhotos output downloaded', {
        operation: 'tp_download',
        job_id: jobId,
        output: output.ord,
        file: basename(target),
        bytes: bytes.byteLength
      })
    } catch (e) {
      rmSync(partial, { force: true })
      if (isRecoverable(e)) throw e
      getRepos().updateTpOutput(output.id, { status: 'error', error: describeTpError(e).message })
    }
    broadcast(jobId)
  }
}

// ---- Driver ---------------------------------------------------------------------------------

function phaseIndex(phase: TpJobPhase): number {
  const i = PHASE_ORDER.indexOf(phase)
  return i < 0 ? 0 : i
}

async function runJob(jobId: string): Promise<void> {
  const repos = getRepos()
  repos.updateTpJob(jobId, { status: 'running', error: '' })
  broadcast(jobId)

  try {
    // Re-enter at the first incomplete phase rather than replaying from the top.
    let phase = detail(jobId).job.phase
    for (;;) {
      checkControl(jobId)
      const job = detail(jobId).job
      switch (phase) {
        case 'audio':
        case 'probe':
          setPhase(jobId, 'probe')
          await phaseProbe(job)
          phase = 'split'
          break
        case 'plan':
          // The plan is materialised at creation time, so there is nothing to do here.
          phase = 'split'
          break
        case 'split':
          setPhase(jobId, 'split')
          await phaseSplit(jobId)
          phase = 'category'
          break
        case 'category':
          setPhase(jobId, 'category')
          await phaseCategory(detail(jobId).job)
          phase = 'upload'
          break
        case 'upload':
          setPhase(jobId, 'upload')
          await phaseUpload(jobId)
          phase = 'submit'
          break
        case 'submit':
          setPhase(jobId, 'submit')
          await phaseSubmit(jobId)
          phase = 'await'
          break
        case 'await':
          setPhase(jobId, 'await')
          await phaseAwait(jobId)
          phase = 'merge'
          break
        case 'merge':
          setPhase(jobId, 'merge')
          await phaseMerge(jobId)
          phase = 'awaitMerge'
          break
        case 'awaitMerge':
          setPhase(jobId, 'awaitMerge')
          await phaseAwaitMerge(jobId)
          phase = 'download'
          break
        case 'download':
          setPhase(jobId, 'download')
          await phaseDownload(jobId)
          phase = 'done'
          break
        case 'done':
        default: {
          const d = detail(jobId)
          const badOutputs = d.outputs.filter((o) => o.status === 'error')
          const badParts = d.parts.filter((p) => p.status === 'error')
          if (badOutputs.length || badParts.length) {
            repos.updateTpJob(jobId, {
              phase: 'done',
              status: 'error',
              error: badParts.length
                ? `${badParts.length} chunk${badParts.length === 1 ? '' : 's'} failed. Retry them to finish the video.`
                : badOutputs[0].error || 'One of the videos could not be finished.'
            })
          } else {
            repos.updateTpJob(jobId, { phase: 'done', status: 'done', error: '' })
            sentryLog.info('TalkingPhotos job finished', {
              operation: 'tp_done',
              job_id: jobId,
              outputs: d.outputs.length,
              parts: d.parts.length
            })
          }
          broadcast(jobId)
          return
        }
      }
    }
  } catch (e) {
    if (e instanceof Paused) {
      const cancelled = control.get(jobId) === 'cancel'
      const current = detail(jobId).job
      if (cancelled) repos.updateTpJob(jobId, { status: 'canceled', error: '' })
      else if (current.status !== 'paused') repos.updateTpJob(jobId, { status: 'paused', error: current.error })
      broadcast(jobId)
      return
    }
    if (isRecoverable(e)) {
      const { message } = describeTpError(e)
      repos.updateTpJob(jobId, { status: 'paused', error: message })
      broadcast(jobId)
      sentryLog.warn('TalkingPhotos job paused', { operation: 'tp_pause', job_id: jobId, error_code: (e as TpError).code })
      return
    }
    const { message } = describeTpError(e)
    captureException(e)
    repos.updateTpJob(jobId, { status: 'error', error: message })
    broadcast(jobId)
  } finally {
    running.delete(jobId)
    control.delete(jobId)
  }
}

/** Start or resume a job. Idempotent: a second call while it runs is a no-op. */
export function startTpJob(jobId: string): void {
  if (running.has(jobId)) return
  running.add(jobId)
  control.set(jobId, 'run')
  void runJob(jobId)
}

export function pauseTpJob(jobId: string): void {
  if (running.has(jobId)) control.set(jobId, 'pause')
  else {
    getRepos().updateTpJob(jobId, { status: 'paused' })
    broadcast(jobId)
  }
}

export function cancelTpJob(jobId: string): void {
  if (running.has(jobId)) control.set(jobId, 'cancel')
  else {
    getRepos().updateTpJob(jobId, { status: 'canceled' })
    broadcast(jobId)
  }
}

/** Clear a failed chunk's error so the next run resubmits it. Attempts reset to give it a fresh budget. */
export function retryTpPart(jobId: string, partId: string): void {
  const d = detail(jobId)
  const part = d.parts.find((p) => p.id === partId)
  if (!part) return
  // A chunk with no uploaded audio must go back to the upload phase, not straight to submit.
  const status: TpPart['status'] = part.mediaId ? 'uploaded' : (part.audioDurationSec ? 'split' : 'planned')
  getRepos().updateTpPart(partId, { status, attempts: 0, error: '', projectId: 0 })

  const output = d.outputs.find((o) => o.id === part.outputId)
  if (output && output.status === 'error') getRepos().updateTpOutput(output.id, { status: 'planned', error: '' })

  const rewind: TpJobPhase = part.mediaId ? 'submit' : 'split'
  if (phaseIndex(d.job.phase) > phaseIndex(rewind)) getRepos().updateTpJob(jobId, { phase: rewind })
  getRepos().updateTpJob(jobId, { status: 'paused', error: '' })
  broadcast(jobId)
}

/** Retry every failed chunk of a job at once. */
export function retryTpFailed(jobId: string): void {
  for (const part of detail(jobId).parts) {
    if (part.status === 'error') retryTpPart(jobId, part.id)
  }
}

/**
 * On app start, mark anything that was mid-flight as paused rather than silently resuming: an
 * unattended resume could start spending renders before the user has even seen the window.
 */
export function reconcileTpJobsOnStartup(): void {
  try {
    const stuck = getRepos().tpResumableJobs().filter((j) => j.status === 'running')
    for (const job of stuck) {
      getRepos().updateTpJob(job.id, { status: 'paused', error: 'Studio closed while this job was running. Resume to carry on where it stopped.' })
    }
    if (stuck.length) sentryLog.info('TalkingPhotos jobs parked on startup', { operation: 'tp_startup', jobs: stuck.length })
  } catch (e) {
    captureException(e)
  }
}

export function isTpJobRunning(jobId: string): boolean {
  return running.has(jobId)
}

/** Stop every in-flight job cooperatively; used on quit. */
export function stopAllTpJobs(): void {
  for (const id of running) control.set(id, 'pause')
}

export type { TpJob, TpOutput, TpPart }
