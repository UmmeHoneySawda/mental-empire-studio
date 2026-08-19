// The IPC surface for TalkingPhotos. Channels are `talkingphotos:<verb>`; every id crossing this
// boundary is validated, and every failure is converted to a typed code plus a sentence a person can
// act on, rather than a stack trace or a bare HTTP status.

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { getRepos } from '../db'
import { getSettings } from '../store/settings'
import { sentryLog } from '../services/sentry'
import { probeDuration } from '../services/audio'
import {
  credentialSource,
  describeTpError,
  forgetSession,
  hasSession,
  login,
  logout,
  resolveCredentials,
  TpError
} from '../services/talkingphotos/client'
import { fetchAccountShell, fetchConcurrency, fetchMotions, fetchQuota } from '../services/talkingphotos/api'
import {
  deleteCharacter,
  generateCharacter,
  listCharacters,
  uploadCharacter,
  type GenerateCharacterInput,
  type UploadCharacterInput
} from '../services/talkingphotos/characters'
import { createTpJob, previewPlan, type CreateTpJobInput, type TpPlanPreviewInput } from '../services/talkingphotos/jobs'
import {
  cancelTpJob,
  pauseTpJob,
  retryTpFailed,
  retryTpPart,
  startTpJob
} from '../services/talkingphotos/pipeline'
import {
  maskEmail,
  planSplit,
  tpFeature,
  TP_BLOCKED_FEATURES,
  TP_FEATURES,
  TP_MERGE_CAP_SECONDS,
  type TpAspectRatio,
  type TpCharacter,
  type TpCharacterGender,
  type TpConnection,
  type TpJob,
  type TpJobDetail,
  type TpMotion,
  type TpPlan
} from '../../shared/talkingphotos'

function reqId(v: unknown, name = 'id'): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`Invalid ${name}`)
  return v.trim()
}

function reqNum(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Invalid ${name}`)
  return n
}

function blockedForRunning(ids: string[]): string[] {
  const jobs = getRepos().tpJobs()
  return ids.filter(id => jobs.some(j => j.characterId === id && j.status === 'running'))
}
function pausedJobsFor(ids: string[]): TpJob[] {
  const jobs = getRepos().tpJobs()
  return jobs.filter(j => ids.includes(j.characterId) && j.status === 'paused')
}

function disconnected(errorCode: TpConnection['errorCode'], error: string): TpConnection {
  return {
    connected: false,
    role: '',
    credentialSource: credentialSource(),
    emailMasked: '',
    quota: null,
    concurrentCount: 0,
    concurrentLimit: 0,
    error,
    errorCode,
    checkedAt: new Date().toISOString()
  }
}

/**
 * Sign in and read back the facts that matter: which account, what role, how much of today's
 * allowance is left, and how many render slots are busy. Reporting all four is the point — the
 * failure mode this replaces is discovering a limit by hitting it mid-job.
 */
async function testConnection(): Promise<TpConnection> {
  let creds
  try {
    creds = resolveCredentials()
  } catch (e) {
    const { code, message } = describeTpError(e)
    return disconnected(code, message)
  }

  try {
    if (!hasSession()) await login()
    const [quota, shell, slots] = await Promise.all([
      fetchQuota(),
      fetchAccountShell().catch(() => ({ role: '', mergeCapSec: 0, filesStoreDays: 0 })),
      fetchConcurrency('human').catch(() => ({ count: 0, limit: 0, message: '' }))
    ])
    sentryLog.info('TalkingPhotos connection verified', {
      operation: 'tp_connection_test',
      credential_source: creds.source,
      videos_used: quota.videosUsed,
      videos_limit: quota.videosLimit
    })
    return {
      connected: true,
      role: shell.role,
      credentialSource: creds.source,
      emailMasked: maskEmail(creds.email),
      quota,
      concurrentCount: slots.count,
      concurrentLimit: slots.limit,
      error: '',
      errorCode: null,
      checkedAt: new Date().toISOString()
    }
  } catch (e) {
    const { code, message } = describeTpError(e)
    return disconnected(code, message)
  }
}

export function registerTalkingPhotosIpc(): void {
  // ---- connection ----
  ipcMain.handle('talkingphotos:connectionTest', (): Promise<TpConnection> => testConnection())

  ipcMain.handle('talkingphotos:connectionStatus', (): TpConnection => {
    const source = credentialSource()
    if (source === 'none') return disconnected('NO_CREDENTIALS', 'No sign-in details yet.')
    if (!hasSession()) return disconnected(null, '')
    let emailMasked = ''
    try {
      emailMasked = maskEmail(resolveCredentials().email)
    } catch {
      emailMasked = ''
    }
    return {
      connected: true, role: '', credentialSource: source, emailMasked,
      quota: null, concurrentCount: 0, concurrentLimit: 0,
      error: '', errorCode: null, checkedAt: new Date().toISOString()
    }
  })

  ipcMain.handle('talkingphotos:signOut', async (): Promise<TpConnection> => {
    await logout()
    return disconnected(null, '')
  })

  /** Which source the credentials come from, so Settings can label its fields honestly. */
  ipcMain.handle('talkingphotos:credentialSource', () => ({
    source: credentialSource(),
    envEmail: (process.env.TALKINGPHOTOS_EMAIL ?? '').trim(),
    settingsEmail: getSettings().talkingphotos?.email ?? ''
  }))

  // ---- catalog and limits ----
  ipcMain.handle('talkingphotos:catalog', () => ({
    features: TP_FEATURES,
    blocked: TP_BLOCKED_FEATURES,
    mergeCapSec: TP_MERGE_CAP_SECONDS
  }))

  ipcMain.handle('talkingphotos:quota', (): Promise<unknown> => fetchQuota())

  /** Measure a local audio file. Only the main process can read the disk, so the plan's headline
   *  number — how long the source is — has to come from here. */
  ipcMain.handle('talkingphotos:probeAudio', async (_e, filePath: unknown): Promise<number> => {
    const path = reqId(filePath, 'filePath')
    if (!existsSync(path)) throw new Error('That audio file no longer exists.')
    const seconds = await probeDuration(path)
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  })

  ipcMain.handle('talkingphotos:planPreview', (_e, input: TpPlanPreviewInput) => {
    reqId(input?.featureId, 'featureId')
    reqNum(input?.partSeconds, 'partSeconds', 1, TP_MERGE_CAP_SECONDS)
    reqNum(input?.sourceDurationSec, 'sourceDurationSec', 0, 24 * 3600)
    return previewPlan(input)
  })

  /** Offline-safe plan maths, for a live control that must not wait on the network. */
  ipcMain.handle('talkingphotos:planLocal', (_e, sourceDurationSec: unknown, partSeconds: unknown): TpPlan =>
    planSplit({
      sourceDurationSec: reqNum(sourceDurationSec, 'sourceDurationSec', 0, 24 * 3600),
      partSeconds: reqNum(partSeconds, 'partSeconds', 1, TP_MERGE_CAP_SECONDS)
    })
  )

  ipcMain.handle('talkingphotos:motions', (_e, featureId: unknown, gender: unknown, aspectRatio: unknown): Promise<TpMotion[]> => {
    const feature = tpFeature(reqId(featureId, 'featureId'))
    if (!feature) throw new Error('Invalid featureId')
    const g = gender === 'male' ? 'male' : 'female'
    const a = aspectRatio === '16:9' ? '16:9' : '9:16'
    return fetchMotions(feature, g as TpCharacterGender, a as TpAspectRatio)
  })

  // ---- characters ----
  ipcMain.handle('talkingphotos:characters', (): TpCharacter[] => listCharacters())

function validateCharacterFields(input: Record<string, unknown>): void {
    const gender = input['gender']
    if (gender !== undefined && gender !== 'male' && gender !== 'female') throw new Error('Invalid gender')
    const age = input['age']
    if (age !== undefined && age !== 'adult' && age !== 'child') throw new Error('Invalid age')
    const ethnicity = input['ethnicity']
    if (ethnicity !== undefined && ethnicity !== '' && ethnicity !== 'white' && ethnicity !== 'black' && ethnicity !== 'asian') throw new Error('Invalid ethnicity')
    const beard = input['beard']
    if (beard !== undefined && beard !== 'shaven' && beard !== 'beard') throw new Error('Invalid beard')
    const characterStyle = input['characterStyle']
    if (characterStyle !== undefined && !['realistic', '3d', '2d', 'animal', 'fantasy'].includes(characterStyle as string)) throw new Error('Invalid characterStyle')
    const aspectRatio = input['aspectRatio']
    if (aspectRatio !== undefined && aspectRatio !== '9:16' && aspectRatio !== '16:9') throw new Error('Invalid aspectRatio')
  }

  ipcMain.handle('talkingphotos:characterGenerate', (_e, input: GenerateCharacterInput): Promise<TpCharacter> => {
    reqId(input?.featureId, 'featureId')
    reqId(input?.prompt, 'prompt')
    validateCharacterFields(input as unknown as Record<string, unknown>)
    return generateCharacter(input)
  })

  /** Opens the OS picker in the main process so the renderer never needs a raw filesystem path. */
  ipcMain.handle('talkingphotos:characterUpload', async (_e, input: Omit<UploadCharacterInput, 'filePath'>): Promise<TpCharacter | null> => {
    reqId(input?.featureId, 'featureId')
    validateCharacterFields(input as unknown as Record<string, unknown>)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const picked = await dialog.showOpenDialog(win, {
      title: 'Choose a character photo',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return uploadCharacter({ ...input, filePath: picked.filePaths[0] })
  })

  ipcMain.handle('talkingphotos:characterDelete', (_e, id: unknown): TpCharacter[] => {
    const one = reqId(id, 'characterId')
    const blocked = blockedForRunning([one])
    if (blocked.length) throw new TpError('VENDOR_REJECTED', `“${one}” is in a running job — finish or pause that job first.`)
    const paused = pausedJobsFor([one])
    getRepos().deleteTpCharacter(one)
    paused.forEach(j => getRepos().deleteTpJob(j.id))
    sentryLog.info('TalkingPhotos character deleted', { operation: 'tp_character_delete', count: 1, id: one, cascaded: paused.map(j => j.id).join(',') } as unknown as Record<string, string | number | boolean>)
    return listCharacters()
  })

  ipcMain.handle('talkingphotos:characterDeleteBulk', (_e, ids: unknown): TpCharacter[] => {
    const list = (ids as string[]).map(v => reqId(v, 'characterId'))
    if (list.length === 0) return listCharacters()
    const blocked = blockedForRunning(list)
    if (blocked.length) throw new TpError('VENDOR_REJECTED', `Blocked: ${blocked.length} presenter${blocked.length > 1 ? 's' : ''} still in running jobs — they stay until those jobs finish.`)
    const paused = pausedJobsFor(list)
    for (const id of list) getRepos().deleteTpCharacter(id)
    paused.forEach(j => getRepos().deleteTpJob(j.id))
    sentryLog.info('TalkingPhotos characters deleted bulk', { operation: 'tp_character_delete', count: list.length, cascaded: paused.map(j => j.id).join(',') } as unknown as Record<string, string | number | boolean>)
    return listCharacters()
  })

  // ---- jobs ----
  ipcMain.handle('talkingphotos:jobs', (): TpJob[] => getRepos().tpJobs())

  ipcMain.handle('talkingphotos:job', (_e, id: unknown): TpJobDetail | null =>
    getRepos().tpJobDetail(reqId(id, 'jobId')) ?? null
  )

  ipcMain.handle('talkingphotos:jobCreate', (_e, input: CreateTpJobInput): Promise<TpJobDetail> => {
    reqId(input?.featureId, 'featureId')
    reqId(input?.characterId, 'characterId')
    reqId(input?.audioPath, 'audioPath')
    reqNum(input?.partSeconds, 'partSeconds', 1, TP_MERGE_CAP_SECONDS)
    return createTpJob(input)
  })

  ipcMain.handle('talkingphotos:jobStart', (_e, id: unknown): TpJobDetail | null => {
    const jobId = reqId(id, 'jobId')
    startTpJob(jobId)
    return getRepos().tpJobDetail(jobId) ?? null
  })

  ipcMain.handle('talkingphotos:jobPause', (_e, id: unknown): TpJobDetail | null => {
    const jobId = reqId(id, 'jobId')
    pauseTpJob(jobId)
    return getRepos().tpJobDetail(jobId) ?? null
  })

  ipcMain.handle('talkingphotos:jobCancel', (_e, id: unknown): TpJobDetail | null => {
    const jobId = reqId(id, 'jobId')
    cancelTpJob(jobId)
    return getRepos().tpJobDetail(jobId) ?? null
  })

  ipcMain.handle('talkingphotos:jobDelete', (_e, id: unknown): TpJob[] => {
    getRepos().deleteTpJob(reqId(id, 'jobId'))
    return getRepos().tpJobs()
  })

  ipcMain.handle('talkingphotos:partRetry', (_e, jobId: unknown, partId: unknown): TpJobDetail | null => {
    const j = reqId(jobId, 'jobId')
    retryTpPart(j, reqId(partId, 'partId'))
    return getRepos().tpJobDetail(j) ?? null
  })

  ipcMain.handle('talkingphotos:retryFailed', (_e, jobId: unknown): TpJobDetail | null => {
    const j = reqId(jobId, 'jobId')
    retryTpFailed(j)
    return getRepos().tpJobDetail(j) ?? null
  })

  /** Discard the local session without a vendor round trip; used when a session is provably dead. */
  ipcMain.handle('talkingphotos:forgetSession', (): void => {
    forgetSession()
  })
}

// test seams — not part of the IPC contract, only for unit guard verification
export const __testDeleteBulk = async (ids: string[]) => {
  const b = blockedForRunning(ids)
  if (b.length) throw new Error('running ' + b.join(','))
  return listCharacters()
}
export const __testDeleteBulkDryRun = (ids: string[]) => ({ pausedJobIds: pausedJobsFor(ids).map(j => j.id) })

export { TpError }
