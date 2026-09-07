import assert from 'node:assert/strict'
import test from 'node:test'

import * as talkingPhotosConfig from '../../../scripts/production/talkingphotos-config.mjs'
import { resolveTalkingPhotosIdentity } from '../../../scripts/production/talkingphotos-config.mjs'

test('a Neural Vault run uses the approved character in an isolated remote namespace', () => {
  const identity = resolveTalkingPhotosIdentity('2026-09-01', {})

  assert.deepEqual(identity, {
    characterUuid: '010c1c4c-982c-4ba5-9f86-9d59c27c4a86',
    runPrefix: 'ME-20260901-NeuralVault-010c1c4c'
  })
})

test('an explicit character override creates a different remote namespace', () => {
  const identity = resolveTalkingPhotosIdentity('2026-09-01', {
    TALKINGPHOTOS_CHARACTER_UUID: '11111111-2222-4333-8444-555555555555'
  })

  assert.deepEqual(identity, {
    characterUuid: '11111111-2222-4333-8444-555555555555',
    runPrefix: 'ME-20260901-NeuralVault-11111111'
  })
})

test('builds the HAR-approved high-quality project without a motion preset', () => {
  const payload = talkingPhotosConfig.buildNeuralVaultProjectPayload?.({
    title: 'ME-20260901-NeuralVault-010c1c4c-preview-5s',
    audioMediaId: 123456
  })

  assert.deepEqual(payload, {
    title: 'ME-20260901-NeuralVault-010c1c4c-preview-5s',
    type: 'human',
    style: 'high_quality',
    options: {
      aspectRatio: '16:9',
      characterPrompt: 'A medium shot of a middle-aged Hispanic man with short, salt-and-pepper hair, a groomed beard, and glasses. He is smiling and sitting in a modern armchair, wearing a  crewneck sweater over a patterned button-up shirt. His hands are clasped in his lap, and a silver wedding band is visible on his left ring finger. The background features a warmly lit, modern office or living room with a large wooden bookshelf filled with books and medical diagrams of brains, research science books. A dark blue sofa sits to the left. The lighting is soft and professional, creating a welcoming and academic atmosphere.\nColors:#041b79, #6be3fe, #2b58a9',
      characterNegativePrompt: '',
      motionId: 0,
      parentMotionId: 0,
      motionPrompt: '',
      characterResultUuid: '010c1c4c-982c-4ba5-9f86-9d59c27c4a86',
      characterDrivingMediaId: 4550164,
      characterGender: 'male',
      characterEthnicity: '',
      characterAge: 'adult',
      characterStyle: 'realistic',
      characterBeard: 'shaven',
      backgroundResultUuid: '',
      backgroundPrompt: '',
      backgroundMediaId: 0,
      audioSource: 'library',
      audioMediaId: 123456,
      audioVocalUrl: '',
      characterImageMediaId: 0,
      ttsText: '',
      ttsLanguage: 'en-US',
      ttsVoice: 'en-US-AndrewMultilingualNeural',
      ttsVoiceGender: '',
      ttsEmotion: 'general',
      ttsSpeed: 50,
      ttsPitch: 50,
      voiceCloneCategory: 'cloned',
      voiceCloneLanguage: 1,
      voiceCloneVoice: null,
      songPrompt: '',
      songLyrics: '',
      songLength: 'short',
      songStylesSelectedList: [],
      songResultUuid: '',
      audioResultUuid: '',
      replicateMotionUseSource: true,
      replicateUseVoiceChanger: false,
      replicateMotionMode: 'animate',
      reverseVideoMode: true
    }
  })
})

test('caps high-quality Neural Vault parts at the verified 60-second limit', () => {
  assert.equal(talkingPhotosConfig.neuralVaultPartSeconds, 60)
})

test('rejects a saved state from the legacy normal-motion profile', () => {
  assert.throws(
    () => talkingPhotosConfig.assertNeuralVaultStateProfile?.({ profile: 'human-normal-motion-328' }),
    /does not match the HAR-approved high-quality profile/
  )
})

test('accepts a saved state created for the HAR-approved profile', () => {
  assert.doesNotThrow(() => talkingPhotosConfig.assertNeuralVaultStateProfile?.({
    profile: 'human-high-quality-010c1c4c-motion0-v1'
  }))
})
