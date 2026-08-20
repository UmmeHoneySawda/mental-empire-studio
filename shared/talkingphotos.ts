// TalkingPhotos long-form contract — pure domain types, the feature catalog, the split planner,
// and the render-payload builder. No I/O, no Electron, no DOM: the renderer previews a plan with
// these functions directly and the unit tests exercise them without a network.
//
// Product problem this file encodes: app.talkingphotos.ai has no 30-minute render. Its longest
// single render is 5 minutes and its Merge Videos tool stitches clips up to 1800 s. So a 30-minute
// video is N short renders plus one merge, and a source longer than 30 minutes becomes several
// such videos. Evidence base: docs/superpowers/specs/2026-08-18-talkingphotos-long-form-design.md.

/** Merge Videos cap, from `window.appSettings.maxMergeVideoDuration` (verified live: 1800). */
export const TP_MERGE_CAP_SECONDS = 1800

/** A trailing chunk shorter than this is dropped rather than rendered — a sub-2s render is waste. */
export const TP_MIN_PART_SECONDS = 2

// A rendered chunk measures slightly longer than the cut it came from: a 45.00s cut came back
// measured at 45.04s in the live run. That is small, but the merge cap is checked against measured
// durations, so a plan that fills the cap exactly is refused at the merge — after every render in it
// has already been paid for. The planner therefore budgets the drift up front.
//
// Which way the drift scales is not known from one data point, so the budget takes whichever of the
// two plausible models is worse: a fixed cost per chunk (container and frame-boundary rounding,
// which dominates when chunks are short and numerous) or a proportion of chunk length (which
// dominates when chunks are long). 0.05s and 0.1% both sit just above the one measurement available.

/** Fixed drift budgeted per chunk. Above the 0.04s observed live. */
export const TP_MEASURE_DRIFT_SEC_PER_PART = 0.05

/** Proportional drift budgeted per chunk. Above the 0.089% observed live. */
export const TP_MEASURE_DRIFT_RATIO = 0.001

/** Flat margin on top of the modelled drift, so a merge is never decided by a rounding error. */
export const TP_MERGE_SAFETY_SECONDS = 1

/**
 * A trailing video shorter than this is not a deliverable, so when it exists only because chunks were
 * trimmed it is dropped instead of costing a render. This is a ceiling on that discard: anything
 * longer keeps its own video even if the accumulated trim would explain it, so real trailing content
 * is never thrown away.
 */
export const TP_MIN_OUTPUT_SECONDS = 10

/** Library folder this app creates and uploads its audio chunks into. */
export const TP_LIBRARY_CATEGORY = 'Mental Empire'

/** `AUTO_MOTION_ID` in the vendor bundle — "Automatic Talking Video Mode", forced for `singing`. */
export const TP_AUTO_MOTION_ID = 500

/** Vendor account ceiling, verified live: login fails past this with a distinct message. */
export const TP_MAX_SESSIONS = 3

export type TpProjectType = 'human' | 'cartoon' | 'animal' | 'singing'

export type TpAspectRatio = '9:16' | '16:9'

export type TpCharacterStyle = 'realistic' | '3d' | '2d' | 'animal' | 'fantasy'

export type TpCharacterGender = 'female' | 'male'

export type TpCharacterAge = 'adult' | 'child'

export type TpCharacterEthnicity = '' | 'white' | 'black' | 'asian'

export type TpCharacterBeard = 'shaven' | 'beard'

/**
 * A selectable "feature" — one vendor type+style pair. `maxPartSeconds` here is a fallback for
 * offline UI only; before spending anything the live `POST /project/video_duration_limit` answer
 * wins, because the vendor can change a limit without telling us.
 */
export interface TpFeature {
  id: string
  label: string
  type: TpProjectType
  style: string
  /** Fallback ceiling per rendered chunk, seconds. Live API value takes precedence. */
  maxPartSeconds: number
  /** Server rejects the render without a motionId when true. */
  requiresMotion: boolean
  /** Vendor forces this motion id and shows no motion step (singing). */
  autoMotionId?: number
  aspectRatios: TpAspectRatio[]
  characterStyles: TpCharacterStyle[]
  /** Which create endpoint this type routes to. Using the wrong one silently misbehaves. */
  createPath: 'project' | 'project/create_singing_dancing'
  /** Output geometry, for the UI to state plainly rather than surprise the user. */
  note?: string
}

/** A vendor feature this pipeline deliberately refuses, with the reason shown in the UI. */
export interface TpBlockedFeature {
  label: string
  reason: string
}

/**
 * Usable features only. Ordered so the cheapest-per-30-minutes options lead, because render count
 * is the scarce resource (100/day) and the 5-minute styles need 6 renders where the 1-minute
 * styles need 30.
 */
export const TP_FEATURES: TpFeature[] = [
  {
    id: 'human-normal',
    label: 'Human — Normal (v3)',
    type: 'human',
    style: 'normal',
    maxPartSeconds: 300,
    requiresMotion: true,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['realistic'],
    createPath: 'project',
    note: '1080×1920 · needs a motion'
  },
  {
    id: 'cartoon-normal',
    label: 'Cartoon — Normal',
    type: 'cartoon',
    style: 'normal',
    maxPartSeconds: 300,
    requiresMotion: true,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['3d', '2d'],
    createPath: 'project',
    note: '1080×1920 · needs a motion'
  },
  {
    id: 'animal-fast',
    label: 'Fantasy / Animal — Fast',
    type: 'animal',
    style: 'fast',
    maxPartSeconds: 300,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['animal'],
    createPath: 'project',
    note: '768×1344 — the only sub-HD path'
  },
  {
    id: 'singing-normal-hq',
    label: 'Singing — Normal HQ',
    type: 'singing',
    style: 'v2_normal_hq',
    maxPartSeconds: 300,
    requiresMotion: false,
    autoMotionId: TP_AUTO_MOTION_ID,
    aspectRatios: ['9:16'],
    characterStyles: ['realistic', '3d', 'animal'],
    createPath: 'project/create_singing_dancing',
    note: 'for music, not speech'
  },
  {
    id: 'singing-normal-fast',
    label: 'Singing — Normal Fast',
    type: 'singing',
    style: 'v2_normal_fast',
    maxPartSeconds: 300,
    requiresMotion: false,
    autoMotionId: TP_AUTO_MOTION_ID,
    aspectRatios: ['9:16'],
    characterStyles: ['realistic', '3d', 'animal'],
    createPath: 'project/create_singing_dancing',
    note: 'for music, not speech'
  },
  {
    id: 'singing-closeup-hq',
    label: 'Singing — Closeup HQ',
    type: 'singing',
    style: 'v2_closeup_hq',
    maxPartSeconds: 210,
    requiresMotion: false,
    autoMotionId: TP_AUTO_MOTION_ID,
    aspectRatios: ['9:16'],
    characterStyles: ['realistic', '3d', 'animal'],
    createPath: 'project/create_singing_dancing',
    note: 'for music · 8 chunks fill 28:00, not 30:00'
  },
  {
    id: 'human-high-quality',
    label: 'Human — HQ (v3.5)',
    type: 'human',
    style: 'high_quality',
    maxPartSeconds: 60,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['realistic'],
    createPath: 'project',
    note: '1080×1920 · newest model'
  },
  {
    id: 'human-close-up',
    label: 'Human — Closeup HQ (v3.5)',
    type: 'human',
    style: 'close_up',
    maxPartSeconds: 60,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['realistic'],
    createPath: 'project',
    note: '1080×1920 · newest model'
  },
  {
    id: 'cartoon-high-quality',
    label: 'Cartoon — HQ',
    type: 'cartoon',
    style: 'high_quality',
    maxPartSeconds: 60,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['3d', '2d'],
    createPath: 'project',
    note: '1088×1920'
  },
  {
    id: 'cartoon-close-up',
    label: 'Cartoon — Closeup HQ',
    type: 'cartoon',
    style: 'close_up',
    maxPartSeconds: 60,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['3d', '2d'],
    createPath: 'project',
    note: '1920×1088 at 16:9'
  },
  {
    id: 'animal-high-quality',
    label: 'Fantasy / Animal — HQ',
    type: 'animal',
    style: 'high_quality',
    maxPartSeconds: 60,
    requiresMotion: false,
    aspectRatios: ['9:16', '16:9'],
    characterStyles: ['animal', 'fantasy'],
    createPath: 'project',
    note: '1088×1920'
  }
]

/**
 * Vendor features this pipeline refuses, shown in the UI with the reason so the absence reads as a
 * decision rather than an omission.
 */
export const TP_BLOCKED_FEATURES: TpBlockedFeature[] = [
  { label: 'Dancing v3', reason: 'the motion clamps every render to exactly 30s — 30 minutes would need 60 renders' },
  { label: 'Singing & Dancing v2', reason: 'the motion clamps every render to exactly 30s — 30 minutes would need 60 renders' },
  { label: 'Replicate Motion v3.5', reason: 'cannot use your own uploaded audio; it needs a driving video and the voice-change path' }
]

export function tpFeature(id: string): TpFeature | undefined {
  return TP_FEATURES.find((f) => f.id === id)
}

// ---- Split planning -------------------------------------------------------------------------

export interface TpPlannedPart {
  ord: number
  startSec: number
  endSec: number
}

export interface TpPlannedOutput {
  ord: number
  startSec: number
  endSec: number
  parts: TpPlannedPart[]
}

export interface TpPlan {
  outputs: TpPlannedOutput[]
  totalParts: number
  totalOutputs: number
  /**
   * The chunk length the plan actually used. Equals the requested length except when an output would
   * fill the merge cap, where it is trimmed slightly to absorb measurement drift — see the drift
   * constants at the top of this file. Cut chunks with this, never with the requested value.
   */
  partSecondsEffective: number
  /** Source seconds actually covered — differs from the source length when a runt tail is dropped. */
  coveredSec: number
  droppedTailSec: number
  warnings: string[]
}

export interface TpPlanInput {
  sourceDurationSec: number
  partSeconds: number
  mergeCapSec?: number
  minPartSeconds?: number
  /** Remaining daily render allowance, for the quota warning. Omit to skip that check. */
  remainingDailyRenders?: number
  /** Per-type concurrent slots, for the "N waves" note. Omit to skip. */
  concurrentLimit?: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Truncates rather than rounds, so a derived chunk length can never round back up over the cap. */
function floor2(n: number): number {
  return Math.floor(n * 100) / 100
}

/**
 * Derive the whole deliverable set from one chunk length.
 *
 * A source longer than the merge cap becomes several consecutive videos rather than one truncated
 * one, so the walk is two nested strides: outputs of `partsPerOutput * partSeconds`, then parts
 * inside each. The final output and its final part are short by construction; a final part below
 * `minPartSeconds` is dropped, because a sub-2s render costs a full render slot and can fail
 * outright on the vendor side.
 */
export function planSplit(input: TpPlanInput): TpPlan {
  const mergeCapSec = input.mergeCapSec ?? TP_MERGE_CAP_SECONDS
  const minPartSeconds = input.minPartSeconds ?? TP_MIN_PART_SECONDS
  const partSeconds = Math.floor(input.partSeconds)
  const sourceDurationSec = Math.max(0, input.sourceDurationSec)
  const warnings: string[] = []

  if (!Number.isFinite(partSeconds) || partSeconds <= 0) {
    return { outputs: [], totalParts: 0, totalOutputs: 0, partSecondsEffective: 0, coveredSec: 0, droppedTailSec: 0, warnings: ['Chunk length must be a positive number of seconds.'] }
  }
  if (partSeconds > mergeCapSec) {
    return { outputs: [], totalParts: 0, totalOutputs: 0, partSecondsEffective: 0, coveredSec: 0, droppedTailSec: 0, warnings: [`Chunk length cannot exceed the ${mergeCapSec}s merge cap.`] }
  }
  if (sourceDurationSec < minPartSeconds) {
    return { outputs: [], totalParts: 0, totalOutputs: 0, partSecondsEffective: 0, coveredSec: 0, droppedTailSec: 0, warnings: ['The source audio is too short to render.'] }
  }

  const partsPerOutput = Math.max(1, Math.min(Math.ceil(sourceDurationSec / partSeconds), Math.floor(mergeCapSec / partSeconds)))

  // Only an output that would fill the cap needs shortening; a short source keeps the chunk length
  // the user asked for, so the common case is untouched.
  const driftBudget =
    partsPerOutput * Math.max(TP_MEASURE_DRIFT_SEC_PER_PART, partSeconds * TP_MEASURE_DRIFT_RATIO) +
    TP_MERGE_SAFETY_SECONDS
  const fillsCap = partsPerOutput * partSeconds + driftBudget > mergeCapSec
  const stride = fillsCap ? floor2((mergeCapSec - driftBudget) / partsPerOutput) : partSeconds
  const outputSpan = partsPerOutput * stride

  const outputs: TpPlannedOutput[] = []
  let cursor = 0
  let dropped = 0

  while (cursor < sourceDurationSec) {
    const outputStart = cursor
    const outputEnd = Math.min(sourceDurationSec, outputStart + outputSpan)
    const parts: TpPlannedPart[] = []
    let partCursor = outputStart

    while (partCursor < outputEnd) {
      const partEnd = Math.min(outputEnd, partCursor + stride)
      const span = partEnd - partCursor
      if (span < minPartSeconds) {
        // Runt tail. Drop it rather than burn a render slot on a fragment.
        dropped += span
        break
      }
      parts.push({ ord: parts.length + 1, startSec: round2(partCursor), endSec: round2(partEnd) })
      partCursor = partEnd
    }

    if (parts.length > 0) {
      outputs.push({
        ord: outputs.length + 1,
        startSec: round2(outputStart),
        endSec: round2(parts[parts.length - 1].endSec),
        parts
      })
    } else {
      // Whole window was a runt; nothing after it can be longer.
      dropped += outputEnd - outputStart
    }
    cursor = outputEnd
  }

  // Trimming chunks to absorb drift leaves a few seconds uncovered, which the walk above turns into
  // a trailing output of its own. That is not a deliverable — it would spend a whole render slot on a
  // three-second clip. Discard it, bounded twice so it can never eat real content: never more than
  // the trim itself created (accumulated across the full outputs), and never more than the length
  // below which a video is not worth watching at all.
  const trimmedSec = round2(partsPerOutput * partSeconds - outputSpan)
  if (outputs.length > 1 && trimmedSec > 0) {
    const last = outputs[outputs.length - 1]
    const lastSpan = round2(last.endSec - last.startSec)
    const explainedByTrim = round2(trimmedSec * (outputs.length - 1))
    if (lastSpan <= Math.min(explainedByTrim, TP_MIN_OUTPUT_SECONDS)) {
      outputs.pop()
      dropped += lastSpan
    }
  }

  const totalParts = outputs.reduce((n, o) => n + o.parts.length, 0)
  const coveredSec = outputs.reduce((n, o) => n + (o.endSec - o.startSec), 0)

  if (dropped >= 1) {
    warnings.push(`Dropping a ${Math.round(dropped)}s tail — too short to render on its own.`)
  }
  if (typeof input.remainingDailyRenders === 'number' && totalParts > input.remainingDailyRenders) {
    warnings.push(`This needs ${totalParts} renders but only ${input.remainingDailyRenders} remain in today's allowance.`)
  }
  if (typeof input.concurrentLimit === 'number' && input.concurrentLimit > 0 && totalParts > input.concurrentLimit) {
    const waves = Math.ceil(totalParts / input.concurrentLimit)
    warnings.push(`${totalParts} renders across ${waves} waves of ${input.concurrentLimit}.`)
  }

  return {
    outputs,
    totalOutputs: outputs.length,
    totalParts,
    partSecondsEffective: stride,
    coveredSec: round2(coveredSec),
    droppedTailSec: round2(dropped),
    warnings
  }
}

/** Guard run against MEASURED chunk durations before a merge — a 300s cut is never exactly 300s. */
export function mergeFits(measuredDurationsSec: number[], mergeCapSec = TP_MERGE_CAP_SECONDS): { ok: boolean; totalSec: number; overBySec: number } {
  const totalSec = round2(measuredDurationsSec.reduce((n, d) => n + (Number.isFinite(d) ? d : 0), 0))
  const overBySec = round2(Math.max(0, totalSec - mergeCapSec))
  return { ok: overBySec === 0, totalSec, overBySec }
}

// ---- Render payload -------------------------------------------------------------------------

export interface TpRenderPayloadInput {
  title: string
  feature: TpFeature
  aspectRatio: TpAspectRatio
  audioMediaId: number
  /** Exactly one of these two identifies the character. */
  characterResultUuid?: string
  characterImageMediaId?: number
  characterStyle: TpCharacterStyle
  characterGender: TpCharacterGender
  characterAge: TpCharacterAge
  characterEthnicity: TpCharacterEthnicity
  characterBeard: TpCharacterBeard
  motionId?: number
  parentMotionId?: number
}

/**
 * Build the `POST /project` body. Mirrors the vendor's `Project.createDefaultOptions()` so every
 * key the server reads is present with its documented default; omitting keys here has produced
 * 422s in past sessions.
 */
export function buildRenderPayload(input: TpRenderPayloadInput): Record<string, unknown> {
  const f = input.feature
  const motionId = f.autoMotionId ?? input.motionId ?? 0
  return {
    id: 0,
    parentId: null,
    title: input.title,
    type: f.type,
    style: f.style,
    status: 'draft',
    options: {
      aspectRatio: input.aspectRatio,
      characterPrompt: '',
      characterNegativePrompt: '',
      motionId,
      parentMotionId: f.autoMotionId ? 0 : (input.parentMotionId ?? 0),
      motionPrompt: '',
      characterResultUuid: input.characterResultUuid ?? '',
      characterDrivingMediaId: 0,
      characterGender: input.characterGender,
      characterEthnicity: input.characterEthnicity,
      characterAge: input.characterAge,
      characterStyle: input.characterStyle,
      characterBeard: input.characterBeard,
      backgroundResultUuid: '',
      backgroundPrompt: '',
      backgroundMediaId: 0,
      audioSource: 'library',
      audioMediaId: input.audioMediaId,
      audioVocalUrl: '',
      characterImageMediaId: input.characterImageMediaId ?? 0,
      ttsText: '',
      ttsLanguage: 'en-US',
      ttsVoice: '',
      ttsVoiceGender: '',
      ttsEmotion: '',
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
      reverseVideoMode: true,
      ...(f.type === 'singing' ? { singingMode: true } : {})
    },
    subtitlesOptions: []
  }
}

/** Deterministic, filterable remote title. The vendor list endpoint has no id filter. */
export function tpRemoteTitle(jobId: string, outputOrd: number, partOrd: number): string {
  return `ME-${jobId}-o${outputOrd}-p${partOrd}`
}

export function tpMergeTitle(jobId: string, outputOrd: number): string {
  return `ME-${jobId}-o${outputOrd}`
}

/** Local validation mirroring the server rules, so a bad combination fails before it is submitted. */
export function validateRenderInput(input: TpRenderPayloadInput): string[] {
  const errors: string[] = []
  const f = input.feature
  if (!input.characterResultUuid && !input.characterImageMediaId) errors.push('Choose or generate a character first.')
  if (!input.audioMediaId) errors.push('The audio chunk has not been uploaded yet.')
  if (!f.aspectRatios.includes(input.aspectRatio)) errors.push(`${f.label} does not support ${input.aspectRatio}.`)
  if (!f.characterStyles.includes(input.characterStyle)) errors.push(`${f.label} does not support the ${input.characterStyle} character style.`)
  if (f.requiresMotion && !(input.motionId && input.motionId > 0)) errors.push(`${f.label} requires a motion.`)
  if (f.type === 'animal' && input.characterStyle === 'fantasy' && f.style !== 'high_quality') {
    errors.push('The fantasy character style is only available on Fantasy / Animal — HQ.')
  }
  // Session-3 §5: dancing 16:9 is a silent vendor failure (200 with success:false)
  // The workaround is to generate the character as Human at 16:9 and reuse it for dancing.
  // We allow submission but warn here so the user understands the failure is vendor-side.
  return errors
}

// ---- Job / character records ----------------------------------------------------------------

export type TpJobStatus = 'draft' | 'running' | 'paused' | 'done' | 'error' | 'canceled'

export type TpJobPhase =
  | 'audio'
  | 'probe'
  | 'plan'
  | 'split'
  | 'category'
  | 'upload'
  | 'submit'
  | 'await'
  | 'merge'
  | 'awaitMerge'
  | 'download'
  | 'done'

export const TP_PHASE_LABEL: Record<TpJobPhase, string> = {
  audio: 'Getting audio',
  probe: 'Measuring audio',
  plan: 'Planning the split',
  split: 'Cutting chunks',
  category: 'Preparing the library folder',
  upload: 'Uploading chunks',
  submit: 'Submitting renders',
  await: 'Rendering',
  merge: 'Stitching',
  awaitMerge: 'Finishing the stitch',
  download: 'Downloading',
  done: 'Done'
}

export type TpPartStatus =
  | 'planned'
  | 'split'
  | 'uploaded'
  | 'submitted'
  | 'processing'
  | 'completed'
  | 'error'

export type TpOutputStatus = 'planned' | 'waiting' | 'merging' | 'downloading' | 'completed' | 'error'

export interface TpPart {
  id: string
  jobId: string
  outputId: string
  ord: number
  startSec: number
  endSec: number
  audioPath: string
  audioDurationSec: number
  mediaId: number
  projectId: number
  remoteTitle: string
  status: TpPartStatus
  attempts: number
  error: string
}

export interface TpOutput {
  id: string
  jobId: string
  ord: number
  startSec: number
  endSec: number
  mergeProjectId: number
  status: TpOutputStatus
  localPath: string
  error: string
}

export interface TpJob {
  id: string
  sourceId: string
  sourceVideoId: string
  channel: string
  videoTitle: string
  audioPath: string
  sourceDurationSec: number
  featureId: string
  aspectRatio: TpAspectRatio
  partSeconds: number
  mergeCapSec: number
  characterId: string
  characterResultUuid: string
  characterMediaId: number
  characterStyle: TpCharacterStyle
  characterGender: TpCharacterGender
  characterAge: TpCharacterAge
  characterEthnicity: TpCharacterEthnicity
  characterBeard: TpCharacterBeard
  motionId: number
  parentMotionId: number
  libraryCategoryId: number
  phase: TpJobPhase
  status: TpJobStatus
  error: string
  createdAt: string
  updatedAt: string
}

export interface TpJobDetail {
  job: TpJob
  outputs: TpOutput[]
  parts: TpPart[]
}

export type TpCharacterKind = 'generated' | 'uploaded'

export interface TpCharacter {
  id: string
  label: string
  kind: TpCharacterKind
  resultUuid: string
  mediaId: number
  previewUrl: string
  previewPath: string
  gender: TpCharacterGender
  ethnicity: TpCharacterEthnicity
  age: TpCharacterAge
  beard: TpCharacterBeard
  characterStyle: TpCharacterStyle
  aspectRatio: TpAspectRatio
  createdAt: string
}

// ---- Connection / limits --------------------------------------------------------------------

export type TpErrorCode =
  | 'NO_CREDENTIALS'
  | 'BAD_CREDENTIALS'
  | 'SESSION_LIMIT'
  | 'THROTTLED'
  | 'AUTH_LOST'
  | 'QUOTA_EXHAUSTED'
  | 'CONCURRENCY_FULL'
  | 'VENDOR_REJECTED'
  | 'NETWORK'
  | 'MERGE_TOO_LONG'
  | 'PART_FAILED'

/** Where the credentials actually came from, so Settings can say so instead of implying. */
export type TpCredentialSource = 'env' | 'settings' | 'none'

export interface TpQuota {
  imagesUsed: number
  imagesLimit: number
  videosUsed: number
  videosLimit: number
}

export interface TpConnection {
  connected: boolean
  role: string
  credentialSource: TpCredentialSource
  emailMasked: string
  quota: TpQuota | null
  concurrentCount: number
  concurrentLimit: number
  /** Empty when connected; otherwise a plain-language, actionable sentence. */
  error: string
  errorCode: TpErrorCode | null
  checkedAt: string
}

export interface TpDurationLimit {
  maxDuration: number
  maxCharactersTTS: number
}

export interface TpMotion {
  id: number
  parentId: number
  title: string
  thumbUrl: string
  durationSeconds: number
  isPremium: boolean
  isBonus: boolean
}

/** Mask an email for display: keeps the first two characters and the domain. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email ? '•••' : ''
  const name = email.slice(0, at)
  const domain = email.slice(at)
  if (name.length <= 2) return `${name[0] ?? ''}•••${domain}`
  return `${name.slice(0, 2)}${'•'.repeat(Math.min(6, name.length - 2))}${domain}`
}

/** `1847` -> `30:47`; `3661` -> `1:01:01`. Used for durations, never for clock times. */
export function tpDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`
}

// ---- IPC payloads ---------------------------------------------------------------------------
// These cross the preload bridge, so they live here rather than beside their implementations.

export interface TpPlanPreview {
  plan: TpPlan
  /** Live chunk ceiling for the chosen feature; the catalog value only when the API is unreachable. */
  maxPartSeconds: number
  /** Null when the live value could not be read, so the UI can say "unknown" instead of guessing. */
  remainingDailyRenders: number | null
  concurrentLimit: number | null
  /** Non-empty means the plan must not be started; the first entry is the headline reason. */
  blockers: string[]
}

export interface TpGenerateCharacterInput {
  label: string
  prompt: string
  negativePrompt: string
  aspectRatio: TpAspectRatio
  featureId: string
  characterStyle: TpCharacterStyle
  gender: TpCharacterGender
  ethnicity: TpCharacterEthnicity
  age: TpCharacterAge
  beard: TpCharacterBeard
}

/** Same as generate, minus the prompt: the file itself is chosen by the OS picker in main. */
export type TpUploadCharacterInput = Omit<TpGenerateCharacterInput, 'prompt' | 'negativePrompt'>

export interface TpCreateJobInput {
  sourceId: string
  sourceVideoId: string
  channel: string
  videoTitle: string
  audioPath: string
  featureId: string
  aspectRatio: TpAspectRatio
  partSeconds: number
  characterId: string
  motionId: number
  parentMotionId: number
}

export interface TpCharacterProgress {
  requestId: string
  phase: 'submitting' | 'rendering' | 'saving' | 'done' | 'error'
  message: string
  character?: TpCharacter
}
