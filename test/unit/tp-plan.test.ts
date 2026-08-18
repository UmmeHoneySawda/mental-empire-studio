import { describe, it, expect } from 'vitest'
import {
  planSplit,
  mergeFits,
  buildRenderPayload,
  validateRenderInput,
  tpFeature,
  tpRemoteTitle,
  tpDuration,
  maskEmail,
  TP_FEATURES,
  TP_MERGE_CAP_SECONDS,
  type TpFeature
} from '@shared/talkingphotos'

const human5 = tpFeature('human-normal') as TpFeature
const humanHq = tpFeature('human-high-quality') as TpFeature
const animalFast = tpFeature('animal-fast') as TpFeature
const singing = tpFeature('singing-normal-hq') as TpFeature

describe('planSplit', () => {
  it('fills exactly one 30-minute video from a 30-minute source at 5-minute chunks', () => {
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 300 })
    expect(plan.totalOutputs).toBe(1)
    expect(plan.totalParts).toBe(6)
    expect(plan.outputs[0].parts.map((p) => p.startSec)).toEqual([0, 300, 600, 900, 1200, 1500])
    expect(plan.outputs[0].endSec).toBe(1800)
    expect(plan.droppedTailSec).toBe(0)
  })

  it('splits a 47:12 source into a full 30:00 video and a 17:12 remainder', () => {
    // The worked example from the design spec. 2832s total.
    const plan = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    expect(plan.totalOutputs).toBe(2)
    expect(plan.totalParts).toBe(10)

    expect(plan.outputs[0].startSec).toBe(0)
    expect(plan.outputs[0].endSec).toBe(1800)
    expect(plan.outputs[0].parts).toHaveLength(6)

    expect(plan.outputs[1].startSec).toBe(1800)
    expect(plan.outputs[1].endSec).toBe(2832)
    expect(plan.outputs[1].parts).toHaveLength(4)
    // 3 full chunks then a 132s tail.
    expect(plan.outputs[1].parts.map((p) => p.endSec - p.startSec)).toEqual([300, 300, 300, 132])
  })

  it('never lets one video exceed the 1800s merge cap', () => {
    for (const partSeconds of [37, 60, 90, 137, 210, 300]) {
      const plan = planSplit({ sourceDurationSec: 7 * 3600, partSeconds })
      for (const output of plan.outputs) {
        expect(output.endSec - output.startSec).toBeLessThanOrEqual(TP_MERGE_CAP_SECONDS)
      }
    }
  })

  it('needs 30 chunks for a 30-minute video at 1-minute chunks', () => {
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 60 })
    expect(plan.totalOutputs).toBe(1)
    expect(plan.totalParts).toBe(30)
  })

  it('reports the 28:00 shortfall for the 210s singing style rather than overrunning', () => {
    // 1800 / 210 = 8.57 -> 8 chunks -> 1680s per video, not 1800s.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 210 })
    expect(plan.outputs[0].parts).toHaveLength(8)
    expect(plan.outputs[0].endSec).toBe(1680)
    expect(plan.totalOutputs).toBe(2)
  })

  it('drops a runt tail instead of burning a render slot on it', () => {
    const plan = planSplit({ sourceDurationSec: 301, partSeconds: 300 })
    expect(plan.totalParts).toBe(1)
    expect(plan.droppedTailSec).toBe(1)
    expect(plan.warnings.join(' ')).toMatch(/tail/i)
  })

  it('keeps a tail that is long enough to be worth a render', () => {
    const plan = planSplit({ sourceDurationSec: 330, partSeconds: 300 })
    expect(plan.totalParts).toBe(2)
    expect(plan.outputs[0].parts[1].endSec - plan.outputs[0].parts[1].startSec).toBe(30)
    expect(plan.droppedTailSec).toBe(0)
  })

  it('produces a single short video for a source under the cap', () => {
    const plan = planSplit({ sourceDurationSec: 480, partSeconds: 300 })
    expect(plan.totalOutputs).toBe(1)
    expect(plan.totalParts).toBe(2)
    expect(plan.outputs[0].endSec).toBe(480)
  })

  it('covers the whole source when nothing is dropped', () => {
    const plan = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    expect(plan.coveredSec).toBe(2832)
  })

  it('refuses a chunk length above the merge cap', () => {
    const plan = planSplit({ sourceDurationSec: 4000, partSeconds: 2000 })
    expect(plan.totalParts).toBe(0)
    expect(plan.warnings.join(' ')).toMatch(/merge cap/i)
  })

  it('refuses a non-positive chunk length', () => {
    expect(planSplit({ sourceDurationSec: 600, partSeconds: 0 }).totalParts).toBe(0)
    expect(planSplit({ sourceDurationSec: 600, partSeconds: -5 }).totalParts).toBe(0)
  })

  it('refuses a source shorter than the minimum chunk', () => {
    const plan = planSplit({ sourceDurationSec: 1, partSeconds: 300 })
    expect(plan.totalParts).toBe(0)
    expect(plan.warnings.join(' ')).toMatch(/too short/i)
  })

  it('warns when the plan needs more renders than remain today', () => {
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 60, remainingDailyRenders: 12 })
    expect(plan.totalParts).toBe(30)
    expect(plan.warnings.join(' ')).toMatch(/only 12 remain/i)
  })

  it('does not warn about quota when the plan fits', () => {
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 300, remainingDailyRenders: 77 })
    expect(plan.warnings.join(' ')).not.toMatch(/remain/i)
  })

  it('reports the number of concurrency waves', () => {
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 300, concurrentLimit: 5 })
    expect(plan.warnings.join(' ')).toMatch(/6 renders across 2 waves of 5/i)
  })

  it('is deterministic', () => {
    const a = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    const b = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('numbers parts from 1 within each output, and outputs from 1', () => {
    const plan = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    expect(plan.outputs.map((o) => o.ord)).toEqual([1, 2])
    expect(plan.outputs[1].parts.map((p) => p.ord)).toEqual([1, 2, 3, 4])
  })
})

describe('mergeFits', () => {
  it('accepts measured chunks that sum inside the cap', () => {
    const r = mergeFits([300.04, 299.98, 300.11, 300.0, 299.87, 299.9])
    expect(r.ok).toBe(true)
    expect(r.overBySec).toBe(0)
  })

  it('rejects measured chunks that overrun the cap, and says by how much', () => {
    const r = mergeFits([300.5, 300.5, 300.5, 300.5, 300.5, 300.5])
    expect(r.ok).toBe(false)
    expect(r.overBySec).toBe(3)
    expect(r.totalSec).toBe(1803)
  })

  it('treats a non-finite measurement as zero rather than poisoning the total', () => {
    const r = mergeFits([300, Number.NaN, 300])
    expect(r.totalSec).toBe(600)
  })

  it('accepts a total exactly at the cap — the vendor rejects only strictly over', () => {
    expect(mergeFits([900, 900]).ok).toBe(true)
  })
})

describe('buildRenderPayload', () => {
  const base = {
    title: 'ME-j1-o1-p1',
    aspectRatio: '9:16' as const,
    audioMediaId: 4419530,
    characterResultUuid: 'bf3aa229-d31e-490f-a86b-4cdb905e012e',
    characterStyle: 'realistic' as const,
    characterGender: 'female' as const,
    characterAge: 'adult' as const,
    characterEthnicity: '' as const,
    characterBeard: 'shaven' as const
  }

  it('always feeds the render from library audio, never TTS', () => {
    const p = buildRenderPayload({ ...base, feature: humanHq })
    const options = p.options as Record<string, unknown>
    expect(options.audioSource).toBe('library')
    expect(options.audioMediaId).toBe(4419530)
    expect(options.ttsText).toBe('')
  })

  it('carries type and style from the chosen feature', () => {
    const p = buildRenderPayload({ ...base, feature: animalFast })
    expect(p.type).toBe('animal')
    expect(p.style).toBe('fast')
  })

  it('passes a real motion through for a motion-requiring feature', () => {
    const p = buildRenderPayload({ ...base, feature: human5, motionId: 374, parentMotionId: 12 })
    const options = p.options as Record<string, unknown>
    expect(options.motionId).toBe(374)
    expect(options.parentMotionId).toBe(12)
  })

  it('forces the auto motion id for singing and ignores any supplied motion', () => {
    const p = buildRenderPayload({ ...base, feature: singing, motionId: 374, parentMotionId: 9 })
    const options = p.options as Record<string, unknown>
    expect(options.motionId).toBe(500)
    expect(options.parentMotionId).toBe(0)
    expect(options.singingMode).toBe(true)
  })

  it('does not set singingMode for non-singing types', () => {
    const options = buildRenderPayload({ ...base, feature: humanHq }).options as Record<string, unknown>
    expect(options.singingMode).toBeUndefined()
  })

  it('includes every default option key the vendor reads', () => {
    const options = buildRenderPayload({ ...base, feature: humanHq }).options as Record<string, unknown>
    for (const key of [
      'aspectRatio', 'characterPrompt', 'characterNegativePrompt', 'motionId', 'parentMotionId',
      'motionPrompt', 'characterResultUuid', 'characterDrivingMediaId', 'characterGender',
      'characterEthnicity', 'characterAge', 'characterStyle', 'characterBeard',
      'backgroundResultUuid', 'backgroundPrompt', 'backgroundMediaId', 'audioSource', 'audioMediaId',
      'audioVocalUrl', 'characterImageMediaId', 'ttsText', 'ttsLanguage', 'ttsVoice',
      'ttsVoiceGender', 'ttsEmotion', 'ttsSpeed', 'ttsPitch', 'voiceCloneCategory',
      'voiceCloneLanguage', 'voiceCloneVoice', 'songPrompt', 'songLyrics', 'songLength',
      'songStylesSelectedList', 'songResultUuid', 'audioResultUuid', 'replicateMotionUseSource',
      'replicateUseVoiceChanger', 'replicateMotionMode', 'reverseVideoMode'
    ]) {
      expect(options, `missing option key ${key}`).toHaveProperty(key)
    }
  })

  it('uses an uploaded character media id when there is no generated uuid', () => {
    const options = buildRenderPayload({
      ...base, feature: humanHq, characterResultUuid: undefined, characterImageMediaId: 999
    }).options as Record<string, unknown>
    expect(options.characterImageMediaId).toBe(999)
    expect(options.characterResultUuid).toBe('')
  })
})

describe('validateRenderInput', () => {
  const base = {
    title: 't',
    aspectRatio: '9:16' as const,
    audioMediaId: 1,
    characterResultUuid: 'uuid',
    characterStyle: 'realistic' as const,
    characterGender: 'female' as const,
    characterAge: 'adult' as const,
    characterEthnicity: '' as const,
    characterBeard: 'shaven' as const
  }

  it('accepts a well-formed non-motion render', () => {
    expect(validateRenderInput({ ...base, feature: humanHq })).toEqual([])
  })

  it('catches the missing motion the server would 422 on', () => {
    expect(validateRenderInput({ ...base, feature: human5 }).join(' ')).toMatch(/requires a motion/i)
    expect(validateRenderInput({ ...base, feature: human5, motionId: 0 }).join(' ')).toMatch(/requires a motion/i)
    expect(validateRenderInput({ ...base, feature: human5, motionId: 374 })).toEqual([])
  })

  it('catches a character that was never resolved', () => {
    const errors = validateRenderInput({ ...base, feature: humanHq, characterResultUuid: undefined })
    expect(errors.join(' ')).toMatch(/character/i)
  })

  it('catches an un-uploaded audio chunk', () => {
    expect(validateRenderInput({ ...base, feature: humanHq, audioMediaId: 0 }).join(' ')).toMatch(/not been uploaded/i)
  })

  it('catches an aspect ratio the feature does not offer', () => {
    expect(validateRenderInput({ ...base, feature: singing, aspectRatio: '16:9' }).join(' ')).toMatch(/16:9/)
  })

  it('catches a character style the feature does not offer', () => {
    expect(validateRenderInput({ ...base, feature: humanHq, characterStyle: '2d' }).join(' ')).toMatch(/character style/i)
  })

  it('restricts the fantasy style to the HQ animal feature', () => {
    expect(validateRenderInput({ ...base, feature: animalFast, characterStyle: 'fantasy' }).join(' ')).toMatch(/fantasy/i)
  })
})

describe('feature catalog', () => {
  it('has unique ids', () => {
    const ids = TP_FEATURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('offers only chunk ceilings that fit inside the merge cap', () => {
    for (const f of TP_FEATURES) expect(f.maxPartSeconds).toBeLessThanOrEqual(TP_MERGE_CAP_SECONDS)
  })

  it('gives every feature at least one aspect ratio and character style', () => {
    for (const f of TP_FEATURES) {
      expect(f.aspectRatios.length).toBeGreaterThan(0)
      expect(f.characterStyles.length).toBeGreaterThan(0)
    }
  })

  it('routes singing to the create_singing_dancing endpoint and everything else to /project', () => {
    for (const f of TP_FEATURES) {
      expect(f.createPath).toBe(f.type === 'singing' ? 'project/create_singing_dancing' : 'project')
    }
  })

  it('never marks a feature as both auto-motion and motion-requiring', () => {
    for (const f of TP_FEATURES) expect(f.autoMotionId !== undefined && f.requiresMotion).toBe(false)
  })

  it('leads with the cheapest features by render count', () => {
    expect(TP_FEATURES[0].maxPartSeconds).toBe(300)
  })
})

describe('formatting helpers', () => {
  it('formats durations as m:ss and h:mm:ss', () => {
    expect(tpDuration(0)).toBe('0:00')
    expect(tpDuration(59)).toBe('0:59')
    expect(tpDuration(1800)).toBe('30:00')
    expect(tpDuration(2832)).toBe('47:12')
    expect(tpDuration(3661)).toBe('1:01:01')
  })

  it('masks an email without hiding the domain', () => {
    expect(maskEmail('presenter.studio@example.com')).toBe('pr••••••@example.com')
    expect(maskEmail('abcd@x.io')).toBe('ab••@x.io')
    expect(maskEmail('ab@x.io')).toBe('a•••@x.io')
    expect(maskEmail('')).toBe('')
  })

  it('builds filterable remote titles', () => {
    expect(tpRemoteTitle('abc', 2, 4)).toBe('ME-abc-o2-p4')
  })
})
