export const defaultNeuralVaultCharacterUuid = '010c1c4c-982c-4ba5-9f86-9d59c27c4a86'
export const defaultNeuralVaultCharacterDrivingMediaId = 4550164
export const neuralVaultPartSeconds = 60
export const neuralVaultStateProfile = 'human-high-quality-010c1c4c-motion0-v1'

const defaultNeuralVaultCharacterPrompt = 'A medium shot of a middle-aged Hispanic man with short, salt-and-pepper hair, a groomed beard, and glasses. He is smiling and sitting in a modern armchair, wearing a  crewneck sweater over a patterned button-up shirt. His hands are clasped in his lap, and a silver wedding band is visible on his left ring finger. The background features a warmly lit, modern office or living room with a large wooden bookshelf filled with books and medical diagrams of brains, research science books. A dark blue sofa sits to the left. The lighting is soft and professional, creating a welcoming and academic atmosphere.\nColors:#041b79, #6be3fe, #2b58a9'

export function resolveTalkingPhotosIdentity(runDate, env = process.env) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error(`Invalid TalkingPhotos run date: ${runDate}`)
  const characterUuid = String(env.TALKINGPHOTOS_CHARACTER_UUID || defaultNeuralVaultCharacterUuid).trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(characterUuid)) {
    throw new Error('TALKINGPHOTOS_CHARACTER_UUID must be a valid UUID')
  }
  return {
    characterUuid,
    runPrefix: `ME-${runDate.replaceAll('-', '')}-NeuralVault-${characterUuid.slice(0, 8)}`
  }
}

export function buildNeuralVaultProjectPayload({
  title,
  audioMediaId,
  characterUuid = defaultNeuralVaultCharacterUuid,
  characterDrivingMediaId = characterUuid === defaultNeuralVaultCharacterUuid
    ? defaultNeuralVaultCharacterDrivingMediaId
    : 0
}) {
  if (!String(title || '').trim()) throw new Error('TalkingPhotos project title is required')
  if (!Number.isInteger(Number(audioMediaId)) || Number(audioMediaId) <= 0) {
    throw new Error('TalkingPhotos audio media id must be a positive integer')
  }
  return {
    title: String(title),
    type: 'human',
    style: 'high_quality',
    options: {
      aspectRatio: '16:9',
      characterPrompt: defaultNeuralVaultCharacterPrompt,
      characterNegativePrompt: '',
      motionId: 0,
      parentMotionId: 0,
      motionPrompt: '',
      characterResultUuid: characterUuid,
      characterDrivingMediaId: Number(characterDrivingMediaId),
      characterGender: 'male',
      characterEthnicity: '',
      characterAge: 'adult',
      characterStyle: 'realistic',
      characterBeard: 'shaven',
      backgroundResultUuid: '',
      backgroundPrompt: '',
      backgroundMediaId: 0,
      audioSource: 'library',
      audioMediaId: Number(audioMediaId),
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
  }
}

export function assertNeuralVaultStateProfile(state) {
  if (state?.profile !== neuralVaultStateProfile) {
    throw new Error('Saved TalkingPhotos state does not match the HAR-approved high-quality profile; archive it before starting a fresh run')
  }
}
