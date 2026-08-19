// Characters: generate one from a prompt, upload your own photo, or reuse a saved one.
//
// One character is resolved per job and reused for every chunk, because the face has to be identical
// across 6-30 separately rendered pieces that get stitched into one video. A per-chunk character
// would produce a video whose presenter changes every five minutes.

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { getRepos } from '../../db'
import { emit } from '../../ipc/events'
import { sentryLog } from '../sentry'
import { cacheDir } from '../storage'
import { TpError, tpDownload } from './client'
import {
  analyseFace,
  characterPreviewUrl,
  createCharacter,
  ensureLibraryCategory,
  fetchJobResult,
  uploadImage
} from './api'
import {
  tpFeature,
  type TpCharacter,
  type TpCharacterProgress,
  type TpGenerateCharacterInput,
  type TpUploadCharacterInput
} from '../../../shared/talkingphotos'

const POLL_MS = 4_000
const MAX_WAIT_MS = 6 * 60_000
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp'])

export type { TpCharacterProgress }

function report(p: TpCharacterProgress): void {
  emit('talkingphotos:characterProgress', p)
}

function charactersCacheDir(): string {
  const dir = cacheDir('talkingphotos-characters')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Cache the preview locally so the library still renders after the vendor's 60-day retention. */
async function cachePreview(url: string, id: string): Promise<string> {
  try {
    const bytes = await tpDownload(url, 60_000)
    const path = join(charactersCacheDir(), `${id}.jpg`)
    writeFileSync(path, bytes)
    sentryLog.info('TalkingPhotos character preview cached', {
      operation: 'tp_character_preview_cache',
      character_id: id,
      bytes: bytes.length,
      cached: true
    })
    return path
  } catch {
    return ''
  }
}

export interface GenerateCharacterInput extends TpGenerateCharacterInput {}

/**
 * Generate a character and wait for it. Polls `get_result_data` rather than opening the vendor's
 * WebSocket: the pull path is equivalent and keeps the whole pipeline scriptable.
 */
export async function generateCharacter(input: GenerateCharacterInput): Promise<TpCharacter> {
  const requestId = randomUUID()
  const feature = tpFeature(input.featureId)
  if (!feature) throw new TpError('VENDOR_REJECTED', 'Choose a feature before generating a character.')
  if (!input.prompt.trim()) throw new TpError('VENDOR_REJECTED', 'Describe the character you want.')
  if (!feature.aspectRatios.includes(input.aspectRatio)) {
    throw new TpError('VENDOR_REJECTED', `${feature.label} does not offer ${input.aspectRatio}.`)
  }

  report({ requestId, phase: 'submitting', message: 'Asking TalkingPhotos for the character…' })
  const uuid = await createCharacter({
    type: feature.type,
    prompt: input.prompt.trim(),
    negativePrompt: input.negativePrompt.trim(),
    aspectRatio: input.aspectRatio,
    gender: input.gender,
    ethnicity: input.ethnicity,
    characterStyle: input.characterStyle,
    characterBeard: input.beard,
    characterAge: input.age,
    projectStyle: feature.style
  })

  report({ requestId, phase: 'rendering', message: 'Drawing the character. This usually takes under a minute.' })
  const deadline = Date.now() + MAX_WAIT_MS
  for (;;) {
    if (Date.now() > deadline) {
      report({ requestId, phase: 'error', message: 'The character render is taking unusually long. Try again.' })
      throw new TpError('VENDOR_REJECTED', 'The character render did not finish in time.')
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
    const result = await fetchJobResult(uuid)
    if (result.failed) {
      report({ requestId, phase: 'error', message: 'TalkingPhotos could not draw that character.' })
      throw new TpError('VENDOR_REJECTED', 'TalkingPhotos could not draw that character. Try a different description.')
    }
    if (result.done) break
  }

  report({ requestId, phase: 'saving', message: 'Saving the character to your library…' })
  const id = randomUUID()
  const previewUrl = characterPreviewUrl(uuid)
  const character: TpCharacter = {
    id,
    label: input.label.trim() || 'Untitled character',
    kind: 'generated',
    resultUuid: uuid,
    mediaId: 0,
    previewUrl,
    previewPath: await cachePreview(previewUrl, id),
    gender: input.gender,
    ethnicity: input.ethnicity,
    age: input.age,
    beard: input.beard,
    characterStyle: input.characterStyle,
    aspectRatio: input.aspectRatio,
    createdAt: new Date().toISOString()
  }
  getRepos().upsertTpCharacter(character)
  sentryLog.info('TalkingPhotos character generated', {
    operation: 'tp_character_generate',
    character_style: input.characterStyle,
    aspect_ratio: input.aspectRatio,
    gender: input.gender
  })
  report({ requestId, phase: 'done', message: 'Character ready.', character })
  return character
}

export interface UploadCharacterInput extends TpUploadCharacterInput {
  filePath: string
}

/** Upload the user's own portrait. Validated with the vendor's face check before it costs a render. */
export async function uploadCharacter(input: UploadCharacterInput): Promise<TpCharacter> {
  const feature = tpFeature(input.featureId)
  if (!feature) throw new TpError('VENDOR_REJECTED', 'Choose a feature before uploading a character.')
  if (!existsSync(input.filePath)) throw new TpError('VENDOR_REJECTED', 'That image file no longer exists.')

  const ext = extname(input.filePath).toLowerCase()
  if (!ALLOWED_IMAGE_EXT.has(ext)) {
    throw new TpError('VENDOR_REJECTED', 'TalkingPhotos accepts PNG, JPG, and BMP images.')
  }
  const bytes = statSync(input.filePath).size
  if (bytes > MAX_UPLOAD_BYTES) {
    throw new TpError('VENDOR_REJECTED', `That image is ${(bytes / 1024 / 1024).toFixed(1)} MB; TalkingPhotos accepts up to 5 MB.`)
  }

  const categoryId = await ensureLibraryCategory()
  const media = await uploadImage(categoryId, input.filePath)

  const check = await analyseFace(media.id, feature.type, feature.style).catch(() => ({ ok: true, message: '' }))
  if (!check.ok) {
    throw new TpError('VENDOR_REJECTED', check.message?.trim() || 'TalkingPhotos could not find a usable face in that image.')
  }

  const id = randomUUID()
  const character: TpCharacter = {
    id,
    label: input.label.trim() || 'Uploaded character',
    kind: 'uploaded',
    resultUuid: '',
    mediaId: media.id,
    previewUrl: media.mediaPath ?? '',
    previewPath: input.filePath,
    gender: input.gender,
    ethnicity: input.ethnicity,
    age: input.age,
    beard: input.beard,
    characterStyle: input.characterStyle,
    aspectRatio: input.aspectRatio,
    createdAt: new Date().toISOString()
  }
  getRepos().upsertTpCharacter(character)
  sentryLog.info('TalkingPhotos character uploaded', {
    operation: 'tp_character_upload',
    aspect_ratio: input.aspectRatio,
    bytes
  })
  return character
}

export function listCharacters(): TpCharacter[] {
  return getRepos().tpCharacters()
}

export function deleteCharacter(id: string): void {
  getRepos().deleteTpCharacter(id)
}
