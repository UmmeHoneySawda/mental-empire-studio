import assert from 'node:assert/strict'
import test from 'node:test'

import * as videoExpressConfig from '../../../scripts/production/videoexpress-config.mjs'

import {
  availableVideoExpressCapacity,
  buildWindowsUserEnvReadScript,
  buildVideoExpressGenerationPayload,
  countActiveVideoExpressQueue,
  extractVideoExpressVideoId,
  isParallelVideoExpressLimit,
  isValidVideoExpressMp4Header,
  mapVideoExpressStatus,
  normalizeVideoExpressManifest,
  parseVideoExpressLoginCsrf,
  shouldRetryVideoExpressFailure
} from '../../../scripts/production/videoexpress-config.mjs'

test('builds the userscript-verified image-to-video payload', () => {
  assert.deepEqual(buildVideoExpressGenerationPayload({
    media: {
      id: 456,
      uuid: 'image-uuid',
      name: 'scene-001.png',
      type: 'image',
      isShared: false
    },
    prompt: 'A slow cinematic push toward the subject.',
    aspect: '16:9',
    videoLength: 10
  }), {
    type: 'image',
    imagePrompt: '',
    prompt: 'A slow cinematic push toward the subject.',
    uuid: 'image-uuid',
    mediaId: '456',
    audioMediaId: '0',
    isShared: '0',
    aspect: '16:9',
    videoLength: '10',
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
  })
})

test('builds the HAR-verified reference-image to generated-still payload chain', () => {
  assert.deepEqual(videoExpressConfig.buildVideoExpressConsistentCharacterPayload?.({
    mediaId: 39853579,
    prompt: 'Preserve the same young man and 1958 ballroom scene.',
    aspect: '9:16'
  }), {
    prompt: 'Preserve the same young man and 1958 ballroom scene.',
    type: 'human',
    mediaId: '39853579',
    aspect: '9:16',
    generatorName: 'create_from_prompt'
  })

  assert.deepEqual(videoExpressConfig.buildVideoExpressGeneratedStillVideoPayload?.({
    uuid: '53604217-e6d4-4e38-849d-911fcba178c5',
    imagePrompt: 'Preserve the same young man and 1958 ballroom scene.',
    prompt: 'The young man does light cha-cha footwork. Camera slowly pushes in.',
    aspect: '9:16',
    videoLength: 10
  }), {
    type: 'human',
    imagePrompt: 'Preserve the same young man and 1958 ballroom scene.',
    prompt: 'The young man does light cha-cha footwork. Camera slowly pushes in.',
    uuid: '53604217-e6d4-4e38-849d-911fcba178c5',
    mediaId: '0',
    audioMediaId: '0',
    isShared: '0',
    aspect: '9:16',
    videoLength: '10',
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
  })
})

test('normalizes generated-still manifests with immutable still prompts and outputs', () => {
  const manifest = normalizeVideoExpressManifest({
    version: 1,
    workflow: 'generated-still',
    folderName: 'ME-20260902-BruceLee-generated-stills',
    aspect: '9:16',
    videoLength: 10,
    items: [{
      key: 'scene-001',
      image: 'images/scene-001.png',
      stillPrompt: 'Preserve the same young man and historical room.',
      generatedImage: 'generated-images/scene-001.jpg',
      prompt: 'The young man shifts his weight lightly. Camera slowly pushes in.',
      output: 'clips/scene-001.mp4'
    }]
  }, 'D:\\jobs\\bruce-lee-generated')

  assert.equal(manifest.workflow, 'generated-still')
  assert.equal(manifest.items[0].stillPrompt, 'Preserve the same young man and historical room.')
  assert.equal(manifest.items[0].generatedImagePath, 'D:\\jobs\\bruce-lee-generated\\generated-images\\scene-001.jpg')
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/)
})

test('normalizes a resumable manifest and resolves paths below the job root', () => {
  const manifest = normalizeVideoExpressManifest({
    version: 1,
    folderName: 'ME-20260902-MindCipher-scenes',
    aspect: '16:9',
    videoLength: 10,
    items: [{
      key: 'scene-001',
      image: 'images/scene-001.png',
      prompt: 'Subtle camera motion.',
      output: 'clips/scene-001.mp4'
    }]
  }, 'D:\\jobs\\mindcipher')

  assert.equal(manifest.folderName, 'ME-20260902-MindCipher-scenes')
  assert.equal(manifest.items[0].imagePath, 'D:\\jobs\\mindcipher\\images\\scene-001.png')
  assert.equal(manifest.items[0].outputPath, 'D:\\jobs\\mindcipher\\clips\\scene-001.mp4')
  assert.match(manifest.fingerprint, /^[a-f0-9]{64}$/)
})

test('rejects unsafe paths and duplicate item keys', () => {
  const base = {
    version: 1,
    folderName: 'safe-folder',
    aspect: '16:9',
    videoLength: 10
  }

  assert.throws(() => normalizeVideoExpressManifest({
    ...base,
    items: [{ key: 'one', image: '..\\secret.png', prompt: 'x', output: 'one.mp4' }]
  }, 'D:\\jobs\\safe'), /must stay inside the Video Express job root/)

  assert.throws(() => normalizeVideoExpressManifest({
    ...base,
    items: [
      { key: 'one', image: 'one.png', prompt: 'x', output: 'one.mp4' },
      { key: 'one', image: 'two.png', prompt: 'y', output: 'two.mp4' }
    ]
  }, 'D:\\jobs\\safe'), /duplicate item key/i)
})

test('rejects remote upload-title and local output collisions', () => {
  const base = {
    version: 1,
    folderName: 'safe-folder',
    aspect: '16:9',
    videoLength: 10
  }

  assert.throws(() => normalizeVideoExpressManifest({
    ...base,
    items: [
      { key: 'one', image: 'one\\scene.png', prompt: 'x', output: 'one.mp4' },
      { key: 'two', image: 'two\\SCENE.jpg', prompt: 'y', output: 'two.mp4' }
    ]
  }, 'D:\\jobs\\safe'), /duplicate image title/i)

  assert.throws(() => normalizeVideoExpressManifest({
    ...base,
    items: [
      { key: 'one', image: 'one.png', prompt: 'x', output: 'clips\\result.mp4' },
      { key: 'two', image: 'two.png', prompt: 'y', output: 'clips\\result.mp4' }
    ]
  }, 'D:\\jobs\\safe'), /duplicate output path/i)
})

test('caps submissions using the stricter local or remote active count', () => {
  assert.equal(availableVideoExpressCapacity({ remoteActive: 2, localActive: 4, limit: 5 }), 1)
  assert.equal(availableVideoExpressCapacity({ remoteActive: 6, localActive: 2, limit: 5 }), 0)
})

test('maps terminal and active status values from the live service contract', () => {
  assert.equal(mapVideoExpressStatus('queued'), 'running')
  assert.equal(mapVideoExpressStatus('finished'), 'completed')
  assert.equal(mapVideoExpressStatus('error'), 'failed')
  assert.equal(mapVideoExpressStatus('unexpected'), 'running')
})

test('extracts a generated video id from known status response shapes', () => {
  assert.equal(extractVideoExpressVideoId({ data: { mediaId: 987 } }), '987')
  assert.equal(extractVideoExpressVideoId({ result: { videoId: '654' } }), '654')
  assert.equal(extractVideoExpressVideoId({ status: 'completed' }), null)
})

test('waits for a completed library record to expose a downloadable media path', () => {
  assert.equal(videoExpressConfig.extractVideoExpressDownloadRecord?.({
    id: 39860938,
    uuid: 'generation-uuid',
    type: 'video',
    mediaPath: null
  }), null)

  assert.deepEqual(videoExpressConfig.extractVideoExpressDownloadRecord?.({
    id: 39853585,
    uuid: 'generation-uuid',
    type: 'video',
    mediaPath: 'https://cdn-ny-b.videoexpress.ai/video/output.mp4'
  }), {
    videoId: '39853585',
    mediaPath: 'https://cdn-ny-b.videoexpress.ai/video/output.mp4'
  })
})

test('parses both observed login CSRF input attribute orders', () => {
  assert.equal(parseVideoExpressLoginCsrf('<input name="_csrf_token" value="abc123">'), 'abc123')
  assert.equal(parseVideoExpressLoginCsrf('<input value="xyz789" name="_csrf_token">'), 'xyz789')
  assert.equal(parseVideoExpressLoginCsrf('<form></form>'), null)
})

test('recognizes only explicit parallel-capacity failures as safe to retry', () => {
  assert.equal(isParallelVideoExpressLimit('You can generate up to 5 AI videos at once'), true)
  assert.equal(isParallelVideoExpressLimit('multiple videos in progress'), true)
  assert.equal(isParallelVideoExpressLimit('network connection reset'), false)
})

test('counts non-terminal remote queue entries', () => {
  assert.equal(countActiveVideoExpressQueue({ results: [
    { status: 'queued' },
    { status: 'processing' },
    { status: 'completed' },
    { status: 'failed' }
  ] }), 2)
})

test('accepts an MP4 ftyp header and rejects HTML or JSON downloads', () => {
  assert.equal(isValidVideoExpressMp4Header(Buffer.from('000000186674797069736f6d', 'hex')), true)
  assert.equal(isValidVideoExpressMp4Header(Buffer.from('<!doctype html>login')), false)
  assert.equal(isValidVideoExpressMp4Header(Buffer.from('{"error":"not ready"}')), false)
})

test('validates generated image checkpoints and builds the HAR preview URL', () => {
  assert.equal(videoExpressConfig.isValidVideoExpressImageHeader?.(Buffer.from('ffd8ffe000104a464946', 'hex')), true)
  assert.equal(videoExpressConfig.isValidVideoExpressImageHeader?.(Buffer.from('89504e470d0a1a0a', 'hex')), true)
  assert.equal(videoExpressConfig.isValidVideoExpressImageHeader?.(Buffer.from('<!doctype html>login')), false)
  assert.equal(
    videoExpressConfig.buildVideoExpressGeneratedStillPreviewUrl?.('53604217-e6d4-4e38-849d-911fcba178c5'),
    'https://s3.renderplatform.com/user-assets/preview/53604217-e6d4-4e38-849d-911fcba178c5.jpg'
  )
})

test('marks interrupted generated-still submissions as uncertain but permits saved UUID polling', () => {
  assert.equal(videoExpressConfig.isUncertainVideoExpressStateStatus?.('generating_still'), true)
  assert.equal(videoExpressConfig.isUncertainVideoExpressStateStatus?.('still_submission_uncertain'), true)
  assert.equal(videoExpressConfig.isUncertainVideoExpressStateStatus?.('still_submitted'), false)
  assert.equal(videoExpressConfig.isUncertainVideoExpressStateStatus?.('submitted'), false)
})

test('never downgrades submitted or completed video progress when a still checkpoint is present', () => {
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('still_submitted'), 'still_ready')
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('still_ready'), 'still_ready')
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('submitted'), 'submitted')
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('running'), 'running')
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('completed'), 'completed')
  assert.equal(videoExpressConfig.resolveGeneratedStillCheckpointStatus?.('downloaded'), 'downloaded')
})

test('builds a literal Windows user-environment lookup without accepting script input', () => {
  assert.match(buildWindowsUserEnvReadScript('VIDEOEXPRESS_EMAIL'), /GetEnvironmentVariable\('VIDEOEXPRESS_EMAIL', 'User'\)/)
  assert.throws(() => buildWindowsUserEnvReadScript("NAME'); Write-Output 'oops"), /invalid environment variable name/i)
})

test('retries only explicit failures below the three-attempt ceiling', () => {
  assert.equal(shouldRetryVideoExpressFailure(1), true)
  assert.equal(shouldRetryVideoExpressFailure(2), true)
  assert.equal(shouldRetryVideoExpressFailure(3), false)
})
