// One typed wrapper per TalkingPhotos endpoint this pipeline uses. Nothing here decides policy —
// the pipeline does that. Contracts were captured live; see the design spec's evidence table and
// docs/trace-mining/api-bodies-live/ for real request/response bodies.

import { tpRequest, tpRequestText, tpUploadFile, assertSuccess, TpError } from './client'
import {
  TP_LIBRARY_CATEGORY,
  type TpAspectRatio,
  type TpCharacterAge,
  type TpCharacterBeard,
  type TpCharacterEthnicity,
  type TpCharacterGender,
  type TpCharacterStyle,
  type TpDurationLimit,
  type TpFeature,
  type TpMotion,
  type TpQuota
} from '../../../shared/talkingphotos'

// ---- Account, limits, quota -----------------------------------------------------------------

interface RestrictionsBody {
  images_per_day?: [number, number]
  videos_per_day?: [number, number]
}

export async function fetchQuota(): Promise<TpQuota> {
  const body = await tpRequest<RestrictionsBody>('/ai_api/user_daily_restrictions')
  const images = body?.images_per_day ?? [0, 0]
  const videos = body?.videos_per_day ?? [0, 0]
  return { imagesUsed: images[0] ?? 0, imagesLimit: images[1] ?? 0, videosUsed: videos[0] ?? 0, videosLimit: videos[1] ?? 0 }
}

export async function fetchConcurrency(type: string): Promise<{ count: number; limit: number; message: string }> {
  const body = await tpRequest<{ concurrentCount?: number; concurrentLimit?: number; message?: string }>(`/project/concurrent_limit/${type}`)
  return { count: body?.concurrentCount ?? 0, limit: body?.concurrentLimit ?? 0, message: body?.message ?? '' }
}

/**
 * The authoritative chunk ceiling. The static catalog value is only an offline fallback: the vendor
 * can change a limit without notice, and spending 30 renders against a stale number is expensive.
 */
export async function fetchDurationLimit(type: string, style: string): Promise<TpDurationLimit> {
  const body = await tpRequest<{ maxDuration?: number; maxCharactersTTS?: number }>('/project/video_duration_limit', {
    method: 'POST',
    json: { projectType: type, projectStyle: style }
  })
  return { maxDuration: body?.maxDuration ?? 0, maxCharactersTTS: body?.maxCharactersTTS ?? 0 }
}

/**
 * The app shell injects `window.appSettings` inline. It is the only place the account's role and the
 * merge cap are published, so this reads the HTML rather than guessing. Both values are advisory:
 * the role is confirmation for the user that we are on the right account, and the merge cap has a
 * verified constant to fall back on, so a parse miss must not block work.
 */
export async function fetchAccountShell(): Promise<{ role: string; mergeCapSec: number; filesStoreDays: number }> {
  let html = ''
  try {
    html = await tpRequestText('/')
  } catch {
    return { role: '', mergeCapSec: 0, filesStoreDays: 0 }
  }
  const str = (key: string): string => {
    const m = new RegExp(`${key}\\s*:\\s*'([^']*)'`).exec(html) ?? new RegExp(`${key}\\s*:\\s*"([^"]*)"`).exec(html)
    return m ? m[1] : ''
  }
  const num = (key: string): number => {
    const m = new RegExp(`${key}\\s*:\\s*(\\d+)`).exec(html)
    return m ? Number(m[1]) : 0
  }
  return {
    role: str('userRoleFullName'),
    mergeCapSec: num('maxMergeVideoDuration'),
    filesStoreDays: num('filesStoreDays')
  }
}

// ---- Media library -------------------------------------------------------------------------

export interface TpMedia {
  id: number
  title: string
  type: string
  extension: string
  mediaPath: string
  data?: { duration?: number; duration_ms?: number; fileSize?: number }
}

interface CategoriesBody {
  items?: Array<{ id: number; title: string }>
}

/** Find or create this app's own library folder, so uploads never mix with the user's own files. */
export async function ensureLibraryCategory(): Promise<number> {
  const list = await tpRequest<CategoriesBody>(`/library/categories?query=`)
  const existing = list?.items?.find((c) => c.title === TP_LIBRARY_CATEGORY)
  if (existing) return existing.id

  const created = await tpRequest<{ id?: number }>('/library/categories', { method: 'POST', json: { title: TP_LIBRARY_CATEGORY } })
  if (created?.id) return created.id

  // Creation answered without an id; re-read rather than assume.
  const again = await tpRequest<CategoriesBody>(`/library/categories?query=`)
  const found = again?.items?.find((c) => c.title === TP_LIBRARY_CATEGORY)
  if (!found) throw new TpError('VENDOR_REJECTED', `Could not create the "${TP_LIBRARY_CATEGORY}" folder in the TalkingPhotos media library.`)
  return found.id
}

/**
 * Upload one audio chunk. The response carries the vendor's own measurement of the file's duration,
 * which is what the chunk-ceiling check must use — our ffmpeg cut and their probe can disagree.
 */
export async function uploadAudio(categoryId: number, filePath: string): Promise<TpMedia> {
  const media = await tpUploadFile<TpMedia>(`/library/categories/upload/${categoryId}`, filePath, 'file')
  if (!media?.id) throw new TpError('VENDOR_REJECTED', 'TalkingPhotos accepted the audio upload but returned no media id.')
  if (media.type && media.type !== 'audio') {
    throw new TpError('VENDOR_REJECTED', `TalkingPhotos classified the upload as "${media.type}" rather than audio.`)
  }
  return media
}

export async function uploadImage(categoryId: number, filePath: string): Promise<TpMedia> {
  const media = await tpUploadFile<TpMedia>(`/library/categories/upload/${categoryId}`, filePath, 'file')
  if (!media?.id) throw new TpError('VENDOR_REJECTED', 'TalkingPhotos accepted the image upload but returned no media id.')
  return media
}

export async function deleteMedia(mediaId: number): Promise<void> {
  await tpRequest(`/library/media/${mediaId}`, { method: 'DELETE' }).catch(() => undefined)
}

// ---- Characters ----------------------------------------------------------------------------

export interface TpCharacterRequest {
  type: string
  prompt: string
  negativePrompt: string
  aspectRatio: TpAspectRatio
  gender: TpCharacterGender
  ethnicity: TpCharacterEthnicity
  characterStyle: TpCharacterStyle
  characterBeard: TpCharacterBeard
  characterAge: TpCharacterAge
  projectStyle: string
}

/** Kicks off an async character render. Returns the uuid to poll. */
export async function createCharacter(req: TpCharacterRequest): Promise<string> {
  const raw = await tpRequest<{ success?: boolean; uuid?: string; message?: string }>('/ai_api/create_image_from_prompt', {
    method: 'POST',
    json: { ...req, imageDrivingMediaId: 0 }
  })
  // Session-3 §5: vendor returns HTTP 200 with {success:false,uuid:""} for dancing 16:9 — assertSuccess alone uses a generic message,
  // so intercept here for an actionable hint.
  if (raw?.success === false) {
    if (req.type === 'dancing' && req.aspectRatio === '16:9') {
      throw new TpError('VENDOR_REJECTED', 'Dancing characters can only be generated at 9:16 at the vendor. For a 16:9 dancing job, generate the character as Human instead (vendor limitation, session-3 §5).')
    }
    throw new TpError('VENDOR_REJECTED', raw.message?.trim() || 'TalkingPhotos could not generate that character, and gave no reason.')
  }
  const body = assertSuccess(raw, 'generate that character')
  if (!body?.uuid) throw new TpError('VENDOR_REJECTED', 'TalkingPhotos started no character job.')
  return body.uuid
}

export interface TpJobResult {
  code: number
  status: string
  outPath: string
  done: boolean
  failed: boolean
}

/** Pull-based equivalent of the vendor's WebSocket progress feed. */
export async function fetchJobResult(uuid: string): Promise<TpJobResult> {
  const body = await tpRequest<{ code?: number; status?: string; out_path?: string }>('/ai_api/get_result_data?getImage=0', {
    method: 'POST',
    json: { uuid }
  })
  const code = body?.code ?? 0
  return {
    code,
    status: body?.status ?? '',
    outPath: body?.out_path ?? '',
    done: code === 200,
    failed: code >= 500
  }
}

export function characterPreviewUrl(uuid: string): string {
  return `https://s3.renderplatform.com/user-assets/preview/${uuid}.jpg`
}

/** Validates an uploaded portrait before it is spent on a render. */
export async function analyseFace(mediaId: number, type: string, style: string): Promise<{ ok: boolean; message: string }> {
  const body = await tpRequest<{ status?: boolean; message?: string }>('/ai_api/face_analyser', {
    method: 'POST',
    json: { mediaId, projectType: type, projectStyle: style }
  })
  return { ok: Boolean(body?.status), message: body?.message ?? '' }
}

// ---- Motions -------------------------------------------------------------------------------

interface MotionItem {
  id?: number
  parentId?: number
  title?: string
  thumbUrl?: string
  durationSeconds?: number
  isPremium?: boolean
  isBonus?: boolean
}

/**
 * Motion catalog for the features that require one. `motion_type` is derived the way the vendor's
 * own wizard derives it, and `style` genuinely filters the list — counts quoted without it are not
 * what the UI sees.
 */
export async function fetchMotions(feature: TpFeature, gender: TpCharacterGender, aspectRatio: TpAspectRatio): Promise<TpMotion[]> {
  const params = new URLSearchParams({
    motion_type: 'animate-v3',
    gender,
    aspect_ratio: aspectRatio,
    style: feature.style
  })
  const body = await tpRequest<MotionItem[] | { items?: MotionItem[] }>(`/motions/list/${feature.type}?${params.toString()}`)
  const items = Array.isArray(body) ? body : (body?.items ?? [])
  // Vendor thumbnails come back as app-relative asset paths (`/assets/motions/...`). The renderer
  // cannot resolve those, and the CSP allowlist is host-based, so absolutise here.
  const absolute = (url: string): string => {
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    return `https://app.talkingphotos.ai${url.startsWith('/') ? '' : '/'}${url}`
  }
  return items
    .filter((m): m is MotionItem & { id: number } => typeof m.id === 'number' && m.id > 0)
    .map((m) => ({
      id: m.id,
      parentId: m.parentId ?? 0,
      title: m.title ?? `Motion ${m.id}`,
      thumbUrl: absolute(m.thumbUrl ?? ''),
      durationSeconds: m.durationSeconds ?? 0,
      isPremium: Boolean(m.isPremium),
      isBonus: Boolean(m.isBonus)
    }))
}

// ---- Projects ------------------------------------------------------------------------------

export interface TpProjectRow {
  id: number
  title: string
  type: string
  style: string | null
  status: string
  message?: string
  media?: TpMedia | null
  previewMedia?: TpMedia | null
  createdDate?: string
}

/**
 * Submit one render. Marked non-idempotent: a timeout here must never be retried, because the
 * vendor may already have queued the job and a replay produces a duplicate render.
 */
export async function createProject(createPath: string, payload: Record<string, unknown>): Promise<TpProjectRow> {
  const body = await tpRequest<TpProjectRow & { success?: boolean; message?: string }>(`/${createPath}`, {
    method: 'POST',
    json: payload,
    nonIdempotent: true
  })
  assertSuccess(body, 'start that render')
  if (!body?.id) throw new TpError('VENDOR_REJECTED', 'TalkingPhotos accepted the render but returned no project id.')
  return body
}

/**
 * List projects. This is the ONLY way to track a render: `GET /project/{id}` returns 422 for
 * anything not yet `completed`, so it cannot be used to poll.
 */
export async function listProjects(limit = 45, page = 1): Promise<TpProjectRow[]> {
  const body = await tpRequest<{ items?: TpProjectRow[] }>(`/project?page=${page}&limit=${limit}`)
  return body?.items ?? []
}

/** Find this job's rows by the deterministic title prefix, since the list endpoint has no id filter. */
export async function listProjectsByPrefix(prefix: string, limit = 45): Promise<TpProjectRow[]> {
  const rows = await listProjects(limit)
  return rows.filter((r) => typeof r.title === 'string' && r.title.startsWith(prefix))
}

/** Stitch completed renders into one video, in the order given. Non-idempotent, same as create. */
export async function mergeProjects(itemsIds: number[], title: string, audioMediaId = 0): Promise<TpProjectRow> {
  const body = await tpRequest<TpProjectRow & { success?: boolean; message?: string }>('/project/merge_videos', {
    method: 'POST',
    json: { itemsIds, title, audioMediaId },
    nonIdempotent: true
  })
  assertSuccess(body, 'stitch those videos')
  return body
}

export function projectDownloadUrl(projectId: number): string {
  return `https://app.talkingphotos.ai/project/download/${projectId}`
}

/** Terminal vendor statuses. `error` and `canceled` are failures; `completed` is success. */
export function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'error' || status === 'canceled'
}

export function isFailedStatus(status: string): boolean {
  return status === 'error' || status === 'canceled'
}
