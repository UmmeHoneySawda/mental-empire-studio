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
  it('fits a 30-minute source into one video, trimming what the merge cap cannot hold', () => {
    // 1800 / 300 is exactly 6 chunks, but the cap is enforced on measured duration, so one video
    // cannot actually hold a full 30 minutes of source. The shortfall is trimmed and reported up
    // front instead of failing the merge after all six renders have been spent.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 300 })
    expect(plan.totalOutputs).toBe(1)
    expect(plan.totalParts).toBe(6)
    expect(plan.partSecondsEffective).toBeCloseTo(299.53, 2)
    expect(plan.outputs[0].endSec).toBeCloseTo(1797.18, 2)
    expect(plan.droppedTailSec).toBeCloseTo(2.82, 2)
    // The point of all of it: this plan still merges once the chunks come back measuring long.
    expect(mergeFits(plan.outputs[0].parts.map((p) => p.endSec - p.startSec + 0.3)).ok).toBe(true)
  })

  it('splits a 47:12 source into a full first video and the remainder', () => {
    // The worked example from the design spec. 2832s total.
    const plan = planSplit({ sourceDurationSec: 2832, partSeconds: 300 })
    expect(plan.totalOutputs).toBe(2)
    expect(plan.totalParts).toBe(10)

    expect(plan.outputs[0].startSec).toBe(0)
    expect(plan.outputs[0].endSec).toBeCloseTo(1797.18, 2)
    expect(plan.outputs[0].parts).toHaveLength(6)

    expect(plan.outputs[1].startSec).toBeCloseTo(1797.18, 2)
    expect(plan.outputs[1].endSec).toBe(2832)
    expect(plan.outputs[1].parts).toHaveLength(4)
    // The remainder is real content, so nothing is dropped here.
    expect(plan.droppedTailSec).toBe(0)
  })

  it('leaves headroom so a cap-filling video still merges after measurement drift', () => {
    // The regression this exists to stop: 1800 / 45 = exactly 40 chunks, so the planner used to
    // plan an output of exactly 1800.00s. But mergeFits runs on MEASURED durations, and the vendor
    // measures a 45.00s cut at ~45.04s — so 40 chunks came to ~1801.6s and the merge was refused
    // after all 40 renders had already been paid for. The plan must absorb that drift up front.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 45 })
    const measured = plan.outputs[0].parts.map((p) => p.endSec - p.startSec + 0.05)
    expect(mergeFits(measured).ok).toBe(true)
  })

  it('reports the shortened chunk length it actually used', () => {
    // Shrinking the chunk rather than dropping one keeps the chunk count — and therefore the render
    // cost the user approved in the plan preview — identical.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 45 })
    expect(plan.outputs[0].parts).toHaveLength(40)
    expect(plan.partSecondsEffective).toBeLessThan(45)
    expect(plan.partSecondsEffective).toBeGreaterThan(44.5)
  })

  it('does not shorten chunks for a source that never approaches the cap', () => {
    // The live smoke's source. Nothing here is near 1800s, so the requested chunk length stands.
    const plan = planSplit({ sourceDurationSec: 96.16, partSeconds: 45 })
    expect(plan.partSecondsEffective).toBe(45)
    expect(plan.outputs[0].parts.map((p) => p.endSec)).toEqual([45, 90, 96.16])
  })

  it('absorbs drift for short chunks too, where per-chunk overhead dominates', () => {
    // 1800 / 10 = 180 chunks. If the overhead is a fixed ~0.05s per chunk it totals 9s here, far
    // more than a percentage-of-length model would predict, so the budget must cover whichever
    // model is worse rather than assuming drift scales with chunk length.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 10 })
    const measured = plan.outputs[0].parts.map((p) => p.endSec - p.startSec + 0.05)
    expect(mergeFits(measured).ok).toBe(true)
  })

  it('drops a trailing video that exists only because of the drift trim', () => {
    // A 30-minute source cannot fit in one video at all: the cap is checked against measured
    // duration, so a single video holds at most ~1797s of source. The leftover is therefore an
    // artefact of the trim, not content — emitting it as its own video would spend a render slot on
    // a 3-second clip. Drop it, and say so.
    const plan = planSplit({ sourceDurationSec: 1800, partSeconds: 45 })
    expect(plan.totalOutputs).toBe(1)
    expect(plan.totalParts).toBe(40)
    expect(plan.droppedTailSec).toBeGreaterThan(0)
    expect(plan.droppedTailSec).toBeLessThan(4)
    expect(plan.warnings.join(' ')).toMatch(/dropping/i)
  })

  it('keeps a trailing video when the leftover is real content rather than the trim', () => {
    // 1800 + 30s. Only ~3s of that is trim, so the other 30s is genuine audio and earns its video.
    const plan = planSplit({ sourceDurationSec: 1830, partSeconds: 45 })
    expect(plan.totalOutputs).toBe(2)
    expect(plan.outputs[1].endSec).toBe(1830)
    expect(plan.droppedTailSec).toBe(0)
  })

  it('drops a trailing video created by trim accumulated across several videos', () => {
    // 3600s at 60s chunks fills two videos of ~1797s each, and the ~3s trimmed from each leaves a 6s
    // leftover at the end. That is still trim rather than content, so it goes the same way.
    const plan = planSplit({ sourceDurationSec: 3600, partSeconds: 60 })
    expect(plan.totalOutputs).toBe(2)
    expect(plan.totalParts).toBe(60)
    expect(plan.droppedTailSec).toBeCloseTo(6, 1)
  })

  it('never discards a trailing video long enough to be worth watching', () => {
    // Ten videos' worth of trim accumulates to ~28s, but a 28s tail is real content and a usable
    // short on its own, so the accumulated-trim rule must not reach it.
    const plan = planSplit({ sourceDurationSec: 10 * 1797.18 + 28, partSeconds: 300 })
    expect(plan.droppedTailSec).toBe(0)
    const last = plan.outputs[plan.outputs.length - 1]
    expect(last.endSec - last.startSec).toBeCloseTo(28, 1)
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
