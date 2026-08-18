// Job creation: turn a confirmed plan into the persisted job -> outputs -> parts tree.
//
// The plan is materialised at creation, not derived at run time, so what the user approved is what
// runs. A chunk-length change after the fact would silently re-price a job the user already agreed
// to, so it takes a new job instead.

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { getRepos } from '../../db'
import { sentryLog } from '../sentry'
import { probeDuration } from '../audio'
import { TpError } from './client'
import { fetchConcurrency, fetchDurationLimit, fetchQuota } from './api'
import {
  TP_MERGE_CAP_SECONDS,
  planSplit,
  tpFeature,
  type TpCreateJobInput,
  type TpJob,
  type TpJobDetail,
  type TpOutput,
  type TpPart,
  type TpPlanPreview
} from '../../../shared/talkingphotos'

export interface TpPlanPreviewInput {
  featureId: string
  partSeconds: number
  sourceDurationSec: number
}

export type { TpPlanPreview, TpCreateJobInput }

/**
 * Price a plan before anything is spent. Deliberately hits the live limit, quota, and concurrency
 * endpoints: the whole point of this screen is that the cost is known before the commit, and a
 * stale catalog number would undermine that.
 */
export async function previewPlan(input: TpPlanPreviewInput): Promise<TpPlanPreview> {
  const feature = tpFeature(input.featureId)
  if (!feature) throw new TpError('VENDOR_REJECTED', 'That feature is not available in this version.')

  const [limit, quota, slots] = await Promise.all([
    fetchDurationLimit(feature.type, feature.style).catch(() => null),
    fetchQuota().catch(() => null),
    fetchConcurrency(feature.type).catch(() => null)
  ])

  const maxPartSeconds = limit?.maxDuration && limit.maxDuration > 0 ? limit.maxDuration : feature.maxPartSeconds
  const remainingDailyRenders = quota && quota.videosLimit > 0 ? Math.max(0, quota.videosLimit - quota.videosUsed) : null
  const concurrentLimit = slots && slots.limit > 0 ? slots.limit : null

  const partSeconds = Math.min(Math.max(1, Math.floor(input.partSeconds)), maxPartSeconds)
  const plan = planSplit({
    sourceDurationSec: input.sourceDurationSec,
    partSeconds,
    mergeCapSec: TP_MERGE_CAP_SECONDS,
    remainingDailyRenders: remainingDailyRenders ?? undefined,
    concurrentLimit: concurrentLimit ?? undefined
  })

  const blockers: string[] = []
  if (input.partSeconds > maxPartSeconds) {
    blockers.push(`${feature.label} renders at most ${maxPartSeconds}s per chunk.`)
  }
  if (plan.totalParts === 0) {
    blockers.push('That combination produces nothing to render.')
  }
  if (remainingDailyRenders !== null && plan.totalParts > remainingDailyRenders) {
    blockers.push(`This needs ${plan.totalParts} renders and only ${remainingDailyRenders} remain today.`)
  }

  return { plan, maxPartSeconds, remainingDailyRenders, concurrentLimit, blockers }
}

export interface CreateTpJobInput extends TpCreateJobInput {}

/** Create the job. Refuses rather than truncating when the plan cannot be afforded or executed. */
export async function createTpJob(input: CreateTpJobInput): Promise<TpJobDetail> {
  const repos = getRepos()
  const feature = tpFeature(input.featureId)
  if (!feature) throw new TpError('VENDOR_REJECTED', 'That feature is not available in this version.')
  if (!input.audioPath || !existsSync(input.audioPath)) {
    throw new TpError('VENDOR_REJECTED', 'That audio file no longer exists. Download it again first.')
  }

  const character = repos.tpCharacter(input.characterId)
  if (!character) throw new TpError('VENDOR_REJECTED', 'Choose a character first.')
  if (!feature.characterStyles.includes(character.characterStyle)) {
    throw new TpError('VENDOR_REJECTED', `"${character.label}" is a ${character.characterStyle} character, which ${feature.label} does not accept.`)
  }
  if (feature.requiresMotion && !(input.motionId > 0)) {
    throw new TpError('VENDOR_REJECTED', `${feature.label} needs a motion chosen.`)
  }
  if (!feature.aspectRatios.includes(input.aspectRatio)) {
    throw new TpError('VENDOR_REJECTED', `${feature.label} does not offer ${input.aspectRatio}.`)
  }

  const sourceDurationSec = await probeDuration(input.audioPath)
  if (!(sourceDurationSec > 0)) throw new TpError('VENDOR_REJECTED', 'That audio file has no measurable duration.')

  const preview = await previewPlan({ featureId: input.featureId, partSeconds: input.partSeconds, sourceDurationSec })
  if (preview.blockers.length) throw new TpError('QUOTA_EXHAUSTED', preview.blockers[0])
  if (preview.plan.totalParts === 0) throw new TpError('VENDOR_REJECTED', 'That plan has nothing to render.')

  const jobId = randomUUID().slice(0, 8)
  const createdAt = new Date().toISOString()
  const job: TpJob = {
    id: jobId,
    sourceId: input.sourceId,
    sourceVideoId: input.sourceVideoId,
    channel: input.channel,
    videoTitle: input.videoTitle,
    audioPath: input.audioPath,
    sourceDurationSec,
    featureId: input.featureId,
    aspectRatio: input.aspectRatio,
    partSeconds: Math.min(Math.floor(input.partSeconds), preview.maxPartSeconds),
    mergeCapSec: TP_MERGE_CAP_SECONDS,
    characterId: character.id,
    characterResultUuid: character.resultUuid,
    characterMediaId: character.mediaId,
    characterStyle: character.characterStyle,
    characterGender: character.gender,
    characterAge: character.age,
    characterEthnicity: character.ethnicity,
    characterBeard: character.beard,
    motionId: feature.autoMotionId ?? (feature.requiresMotion ? input.motionId : 0),
    parentMotionId: feature.autoMotionId ? 0 : input.parentMotionId,
    libraryCategoryId: 0,
    phase: 'probe',
    status: 'draft',
    error: '',
    createdAt,
    updatedAt: createdAt
  }

  const outputs: TpOutput[] = []
  const parts: TpPart[] = []
  for (const plannedOutput of preview.plan.outputs) {
    const outputId = `${jobId}-o${plannedOutput.ord}`
    outputs.push({
      id: outputId,
      jobId,
      ord: plannedOutput.ord,
      startSec: plannedOutput.startSec,
      endSec: plannedOutput.endSec,
      mergeProjectId: 0,
      status: 'planned',
      localPath: '',
      error: ''
    })
    for (const plannedPart of plannedOutput.parts) {
      parts.push({
        id: `${outputId}-p${plannedPart.ord}`,
        jobId,
        outputId,
        ord: plannedPart.ord,
        startSec: plannedPart.startSec,
        endSec: plannedPart.endSec,
        audioPath: '',
        audioDurationSec: 0,
        mediaId: 0,
        projectId: 0,
        remoteTitle: '',
        status: 'planned',
        attempts: 0,
        error: ''
      })
    }
  }

  repos.createTpJob(job, outputs, parts)
  sentryLog.info('TalkingPhotos job created', {
    operation: 'tp_create_job',
    job_id: jobId,
    feature: input.featureId,
    part_seconds: job.partSeconds,
    outputs: outputs.length,
    parts: parts.length,
    source_seconds: Math.round(sourceDurationSec)
  })

  const created = repos.tpJobDetail(jobId)
  if (!created) throw new TpError('VENDOR_REJECTED', 'The job could not be saved.')
  return created
}
