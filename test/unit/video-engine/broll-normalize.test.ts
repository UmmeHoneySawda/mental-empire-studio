import { describe, expect, it } from 'vitest'
import {
  BROLL_TARGET_FPS,
  normalizationReasonForRates,
  parseFrameRate
} from '../../../electron/services/video-engine/broll/normalize'

/* These cases mirror clips measured against the real render harness: every
 * source above the 30 fps timeline stalled Remotion's frame extractor, and the
 * same clip resampled to 30 fps rendered in ~4s. */
describe('B-roll frame-rate normalization decision', () => {
  it('parses ffprobe rationals including NTSC rates', () => {
    expect(parseFrameRate('30/1')).toBe(30)
    expect(parseFrameRate('60000/1001')).toBeCloseTo(59.94, 2)
    expect(parseFrameRate('25')).toBe(25)
  })

  it('treats unusable rate fields as unknown', () => {
    expect(parseFrameRate('0/0')).toBeUndefined()
    expect(parseFrameRate('N/A')).toBeUndefined()
    expect(parseFrameRate(undefined)).toBeUndefined()
    expect(parseFrameRate('')).toBeUndefined()
  })

  it('leaves clips at or below the timeline rate untouched', () => {
    for (const fps of [23.976, 24, 25, 29.97, BROLL_TARGET_FPS]) {
      expect(normalizationReasonForRates({ avgFps: fps, rFps: fps, ok: true })).toBeUndefined()
    }
  })

  it('resamples clips above the timeline rate, which is what stalled the extractor', () => {
    for (const fps of [50, 59.94, 60, 120]) {
      expect(normalizationReasonForRates({ avgFps: fps, rFps: fps, ok: true }))
        .toBe('fps-above-timeline')
    }
  })

  it('ignores the harmless rounding gap normal CFR clips report', () => {
    // 29.97 vs 30 is how plain NTSC footage probes; a scan of the 788-clip
    // library flagged zero clips on divergence alone, so this stays quiet.
    expect(normalizationReasonForRates({ avgFps: 29.97, rFps: 30, ok: true })).toBeUndefined()
  })

  it('resamples variable-frame-rate clips whose average hides a ragged timebase', () => {
    // Non-uniform frame durations stall the extractor the same way a high rate
    // does, even when the average alone looks acceptable.
    expect(normalizationReasonForRates({ avgFps: 24, rFps: 30, ok: true }))
      .toBe('variable-frame-rate')
  })

  it('resamples when the frame rate cannot be read at all', () => {
    // Guessing "fine" here risks a 40s stall for a single asset; re-encoding is
    // seconds. A clip with no readable rate is already anomalous.
    expect(normalizationReasonForRates({ ok: false })).toBe('probe-failed')
  })

  it('judges on the higher of the two reported rates', () => {
    // A 60 fps stream reporting avg_frame_rate 30 must still be caught.
    expect(normalizationReasonForRates({ avgFps: 30, rFps: 60, ok: true }))
      .toBe('fps-above-timeline')
  })
})
