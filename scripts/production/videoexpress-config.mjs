import { createHash } from 'node:crypto'
import { basename, extname, isAbsolute, relative, resolve } from 'node:path'

export const videoExpressLibraryId = 4
export const videoExpressMaxConcurrency = 5
export const videoExpressDefaultPollIntervalMs = 15_000

const allowedAspects = new Set(['16:9', '9:16', '1:1'])
const allowedWorkflows = new Set(['direct-upload', 'generated-still'])

function resolveInside(root, value, label) {
  const rootPath = resolve(root)
  const candidate = resolve(rootPath, String(value || ''))
  const rel = relative(rootPath, candidate)
  if (!value || rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the Video Express job root`)
  }
  return candidate
}

function manifestFingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function normalizeVideoExpressManifest(input, jobRoot) {
  if (!input || input.version !== 1) throw new Error('Video Express manifest version must be 1')

  const workflow = String(input.workflow || 'direct-upload')
  if (!allowedWorkflows.has(workflow)) throw new Error(`Unsupported Video Express workflow: ${workflow}`)

  const folderName = String(input.folderName || '').trim()
  if (folderName.length < 2 || folderName.length > 80 || /[<>:"/\\|?*\x00-\x1f]/.test(folderName)) {
    throw new Error('Video Express folderName must be 2-80 safe characters')
  }

  const aspect = String(input.aspect || '16:9')
  if (!allowedAspects.has(aspect)) throw new Error(`Unsupported Video Express aspect: ${aspect}`)

  const videoLength = Number(input.videoLength ?? 10)
  if (!Number.isInteger(videoLength) || videoLength < 1 || videoLength > 60) {
    throw new Error('Video Express videoLength must be an integer from 1 to 60 seconds')
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Video Express manifest requires at least one item')
  }

  const keys = new Set()
  const imageTitles = new Set()
  const outputPaths = new Set()
  const generatedImagePaths = new Set()
  const logicalItems = input.items.map((item, index) => {
    const key = String(item?.key || '').trim()
    if (!key) throw new Error(`Video Express item ${index + 1} requires a key`)
    if (keys.has(key)) throw new Error(`Duplicate item key in Video Express manifest: ${key}`)
    keys.add(key)

    const prompt = String(item.prompt || '').trim()
    if (!prompt) throw new Error(`Video Express item ${key} requires a prompt`)

    const image = String(item.image || '').trim()
    const output = String(item.output || `clips/${key}.mp4`).trim()
    const imageTitle = basename(image, extname(image)).trim().toLowerCase()
    if (!imageTitle) throw new Error(`Video Express item ${key} requires a named image file`)
    if (imageTitles.has(imageTitle)) throw new Error(`Duplicate image title in Video Express manifest: ${imageTitle}`)
    imageTitles.add(imageTitle)

    const imagePath = resolveInside(jobRoot, image, `Video Express item ${key} image`)
    const outputPath = resolveInside(jobRoot, output, `Video Express item ${key} output`)
    const outputIdentity = outputPath.toLowerCase()
    if (outputPaths.has(outputIdentity)) throw new Error(`Duplicate output path in Video Express manifest: ${output}`)
    outputPaths.add(outputIdentity)

    let stillPrompt = null
    let generatedImage = null
    let generatedImagePath = null
    if (workflow === 'generated-still') {
      stillPrompt = String(item.stillPrompt || '').trim()
      if (!stillPrompt) throw new Error(`Video Express item ${key} requires a stillPrompt for generated-still workflow`)
      generatedImage = String(item.generatedImage || '').trim()
      generatedImagePath = resolveInside(jobRoot, generatedImage, `Video Express item ${key} generatedImage`)
      const generatedIdentity = generatedImagePath.toLowerCase()
      if (generatedImagePaths.has(generatedIdentity)) {
        throw new Error(`Duplicate generatedImage path in Video Express manifest: ${generatedImage}`)
      }
      generatedImagePaths.add(generatedIdentity)
    }
    return {
      key,
      image,
      output,
      prompt,
      stillPrompt,
      generatedImage,
      imagePath,
      generatedImagePath,
      outputPath
    }
  })

  const directFingerprintInput = {
    version: 1,
    folderName,
    aspect,
    videoLength,
    items: logicalItems.map(({ key, image, output, prompt }) => ({ key, image, output, prompt }))
  }
  const fingerprintInput = workflow === 'generated-still'
    ? {
        version: 1,
        workflow,
        folderName,
        aspect,
        videoLength,
        items: logicalItems.map(({ key, image, output, prompt, stillPrompt, generatedImage }) => ({
          key,
          image,
          stillPrompt,
          generatedImage,
          prompt,
          output
        }))
      }
    : directFingerprintInput

  return {
    ...fingerprintInput,
    workflow,
    fingerprint: manifestFingerprint(fingerprintInput),
    items: logicalItems
  }
}

export function buildVideoExpressConsistentCharacterPayload({ mediaId, prompt, aspect = '16:9' }) {
  return {
    prompt: String(prompt || '').trim(),
    type: 'human',
    mediaId: String(mediaId ?? ''),
    aspect: String(aspect),
    generatorName: 'create_from_prompt'
  }
}

export function buildVideoExpressGeneratedStillVideoPayload({ uuid, imagePrompt, prompt, aspect = '16:9', videoLength = 10 }) {
  return {
    type: 'human',
    imagePrompt: String(imagePrompt || '').trim(),
    prompt: String(prompt || '').trim(),
    uuid: String(uuid || ''),
    mediaId: '0',
    audioMediaId: '0',
    isShared: '0',
    aspect: String(aspect),
    videoLength: String(videoLength),
    enhanceHumanFace: '0',
    isTalkingVideoFromText: '0',
    isNarrationVideo: '0',
    enhanceVideoPrompt: '0',
    videoOnly: '0',
    speed: '',
    generatorName: 'create_from_prompt',
    faceImageMediaId: '0',
    faceSwap: '0',
    mode: ''
  }
}

export function buildVideoExpressGenerationPayload({ media, prompt, aspect = '16:9', videoLength = 10 }) {
  const finalPrompt = String(prompt || '').trim() || String(media?.name || '').replace(/\.[a-z0-9]+$/i, '').trim()
  return {
    type: media?.type || (media?.isHumanTalkingVideo ? 'human' : 'image'),
    imagePrompt: '',
    prompt: finalPrompt,
    uuid: media?.uuid || '',
    mediaId: String(media?.id ?? ''),
    audioMediaId: '0',
    isShared: media?.isShared === true || media?.isShared === '1' ? '1' : '0',
    aspect: String(aspect),
    videoLength: String(videoLength),
    enhanceHumanFace: '0',
    isTalkingVideoFromText: '0',
    isNarrationVideo: '0',
    enhanceVideoPrompt: '1',
    videoOnly: '0',
    speed: '',
    generatorName: 'create_from_prompt',
    faceImageMediaId: '0',
    faceSwap: '0',
    mode: ''
  }
}

export function availableVideoExpressCapacity({ remoteActive, localActive, limit = videoExpressMaxConcurrency }) {
  const safeLimit = Math.min(videoExpressMaxConcurrency, Math.max(1, Number(limit) || videoExpressMaxConcurrency))
  const active = Math.max(0, Number(remoteActive) || 0, Number(localActive) || 0)
  return Math.max(0, safeLimit - active)
}

export function mapVideoExpressStatus(value) {
  const status = String(value || '').toLowerCase()
  if (['succeeded', 'success', 'completed', 'complete', 'finished', 'done'].includes(status)) return 'completed'
  if (['failed', 'error'].includes(status)) return 'failed'
  return 'running'
}

export function extractVideoExpressVideoId(payload) {
  if (!payload || typeof payload !== 'object') return null
  const containers = [payload, payload.data, payload.result, payload.video, payload.media].filter(Boolean)
  const keys = ['videoId', 'mediaId', 'video_id', 'media_id', 'libraryVideoId', 'library_video_id', 'id']
  for (const container of containers) {
    for (const key of keys) {
      if (container[key] !== undefined && container[key] !== null && container[key] !== '') {
        return String(container[key])
      }
    }
  }
  return null
}

export function extractVideoExpressDownloadRecord(media) {
  if (!media?.id) return null
  const mediaPath = media.mediaPath || media.videoUrl || media.path || media.url || media.downloadUrl || media.file
  if (!mediaPath) return null
  return {
    videoId: String(media.id),
    mediaPath: String(mediaPath)
  }
}

export function parseVideoExpressLoginCsrf(html) {
  const value = String(html || '')
  const match = value.match(/name=["']_csrf_token["'][^>]*value=["']([^"']+)["']/i)
    || value.match(/value=["']([^"']+)["'][^>]*name=["']_csrf_token["']/i)
  return match?.[1] || null
}

export function isParallelVideoExpressLimit(value) {
  return /multiple videos in progress|up to 5 ai videos|parallel/i.test(String(value || ''))
}

export function countActiveVideoExpressQueue(payload) {
  const terminal = new Set(['succeeded', 'success', 'completed', 'complete', 'finished', 'done', 'failed', 'error', 'cancelled', 'canceled'])
  const results = Array.isArray(payload?.results) ? payload.results : []
  return results.filter((item) => !terminal.has(String(item?.status || '').toLowerCase())).length
}

export function isValidVideoExpressMp4Header(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || [])
  return bytes.length >= 8 && bytes.subarray(4, 8).toString('ascii') === 'ftyp'
}

export function isValidVideoExpressImageHeader(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || [])
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  return isJpeg || isPng
}

export function buildVideoExpressGeneratedStillPreviewUrl(uuid) {
  return `https://s3.renderplatform.com/user-assets/preview/${encodeURIComponent(String(uuid || ''))}.jpg`
}

export function isUncertainVideoExpressStateStatus(status) {
  return new Set([
    'submitting',
    'submission_uncertain',
    'upload_uncertain',
    'generating_still',
    'still_submission_uncertain'
  ]).has(String(status || ''))
}

export function resolveGeneratedStillCheckpointStatus(status) {
  const current = String(status || '')
  const videoProgressStatuses = new Set([
    'submitting',
    'submission_uncertain',
    'submitted',
    'running',
    'completed',
    'failed',
    'downloaded'
  ])
  return videoProgressStatuses.has(current) ? current : 'still_ready'
}

export function buildWindowsUserEnvReadScript(name) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(String(name || ''))) throw new Error('Invalid environment variable name')
  return `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Environment]::GetEnvironmentVariable('${name}', 'User')`
}

export function shouldRetryVideoExpressFailure(attempts, limit = 3) {
  return Number(attempts) < Number(limit)
}
