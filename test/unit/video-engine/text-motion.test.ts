import { describe, expect, it } from 'vitest'
import { TEXT_ANIMATIONS } from '../../../src/features/video-studio/editor/presets'
import {
  resolveTextMotion,
  splitForTextMotion,
  TEXT_MOTION_IDS,
  textMotionSplit,
  textMotionStyle,
  textMotionUnitCount,
  type TextMotionId,
} from '../../../video-engine/remotion/textMotion'

/* Text Motion.
 *
 * The bug: the Text panel offered ten motions, the scene implemented seven. `typewriter`,
 * `word-by-word` and `stagger` were listed in the dropdown, written onto the scene's
 * template props, saved to disk and accepted by preflight — and the composition's `switch`
 * had no case for any of them, so all three fell through its `default:` and drew the `rise`
 * curve. Measured live at fps 30, frame 6, with `animation: "typewriter"` on disk, the
 * player rendered opacity 0.545455 and translateY(12.7273px): exactly `rise`, the whole
 * string visible from the first frame, no character ever typed.
 *
 * These tests pin the three things that were wrong and the one thing that must not change:
 * every advertised id is implemented, the per-token motions really do split the copy, the
 * two lists cannot drift apart again, and the seven block motions keep the exact numbers
 * they have always rendered. */

const fps = 30

function styleAt(id: TextMotionId, frame: number) {
  return textMotionStyle(id, frame, fps)
}

describe('the panel and the renderer describe the same motions', () => {
  it('offers exactly the motions the composition implements', () => {
    expect(TEXT_ANIMATIONS.map((entry) => entry.id).sort()).toEqual(
      [...TEXT_MOTION_IDS].sort(),
    )
  })

  it('gives every motion a label and a hint', () => {
    for (const entry of TEXT_ANIMATIONS) {
      expect(entry.label.length, entry.id).toBeGreaterThan(0)
      expect(entry.hint.length, entry.id).toBeGreaterThan(0)
    }
  })
})

describe('every advertised motion is really implemented', () => {
  it('cuts the copy up the way each motion needs', () => {
    // Pinned so the split a motion depends on cannot be changed by accident: typing is a
    // per-character act, while the two cascades arrive a word at a time.
    const splits = Object.fromEntries(
      TEXT_MOTION_IDS.map((id) => [id, textMotionSplit(id)]),
    )
    expect(splits).toEqual({
      none: 'none',
      fade: 'none',
      rise: 'none',
      drop: 'none',
      scale: 'none',
      'blur-in': 'none',
      'slide-left': 'none',
      typewriter: 'character',
      'word-by-word': 'word',
      stagger: 'word',
    })
  })

  // The regression itself: three ids used to be indistinguishable from `rise`.
  const previouslyDead: TextMotionId[] = ['typewriter', 'word-by-word', 'stagger']

  it.each(previouslyDead)('%s does not silently render the rise curve', (id) => {
    const split = textMotionSplit(id)
    expect(split).not.toBe('none')

    const groups = splitForTextMotion('Your headline', split)
    const unitCount = textMotionUnitCount(groups)
    expect(unitCount).toBeGreaterThan(1)

    // A later unit must still be waiting while an earlier one is already arriving —
    // that is what makes it a per-token reveal rather than one block moving.
    const first = textMotionStyle(id, 2, fps, 0, unitCount)
    const last = textMotionStyle(id, 2, fps, unitCount - 1, unitCount)
    expect(first.opacity).toBeGreaterThan(last.opacity)
    expect(last.opacity).toBe(0)
  })

  it('gives each motion its own signature partway through', () => {
    // `none` is static; the other nine must be mid-flight and mutually distinguishable
    // at some frame, which they were not while three of them aliased `rise`.
    const seen = new Set<string>()
    for (const id of TEXT_MOTION_IDS) {
      if (id === 'none') continue
      const groups = splitForTextMotion('Two words', textMotionSplit(id))
      const unitCount = textMotionUnitCount(groups)
      const style = textMotionStyle(id, 3, fps, 0, unitCount)
      seen.add(`${style.opacity}|${style.transform}|${style.filter ?? ''}|${unitCount}`)
    }
    expect(seen.size).toBe(TEXT_MOTION_IDS.length - 1)
  })
})

describe('splitting never alters the copy', () => {
  const samples = ['Your headline', 'one', 'a  b\nc', 'Trailing space ', '']

  it.each(samples)('reassembles %j exactly for every split', (text) => {
    for (const id of TEXT_MOTION_IDS) {
      const groups = splitForTextMotion(text, textMotionSplit(id))
      const rebuilt = groups
        .flatMap((group) => group.units.map((unit) => unit.text))
        .join('')
      expect(rebuilt, id).toBe(text)
    }
  })

  it('keeps whitespace out of the word reveal order', () => {
    // "one two" is two beats, not three — a space must not consume one.
    const groups = splitForTextMotion('one two', 'word')
    expect(textMotionUnitCount(groups)).toBe(2)
  })

  it('gives every character its own beat, spaces included', () => {
    const groups = splitForTextMotion('ab cd', 'character')
    expect(textMotionUnitCount(groups)).toBe(5)
  })

  it('groups characters by word so a line cannot break mid-word', () => {
    const groups = splitForTextMotion('ab cd', 'character')
    expect(groups.map((group) => group.units.length)).toEqual([2, 1, 2])
    expect(groups.map((group) => group.whitespace)).toEqual([false, true, false])
  })
})

describe('the block motions keep the numbers they always rendered', () => {
  const blockMotions = TEXT_MOTION_IDS.filter((id) => textMotionSplit(id) === 'none')

  it('still treats seven motions as one block', () => {
    expect(blockMotions).toEqual([
      'none',
      'fade',
      'rise',
      'drop',
      'scale',
      'blur-in',
      'slide-left',
    ])
  })

  it('reproduces the rise curve measured in the live player', () => {
    // fps 30 → an 11-frame runway, so frame 6 is 6/11 of the way in.
    const style = styleAt('rise', 6)
    expect(style.opacity).toBeCloseTo(6 / 11, 6)
    expect(style.transform).toBe(`translateY(${28 * (1 - 6 / 11)}px)`)
  })

  it('holds none fully visible from the first frame', () => {
    expect(styleAt('none', 0)).toEqual({ opacity: 1, transform: 'none' })
  })

  // A finished entrance must leave the text at rest — no residual offset, scale or blur.
  const settledTransform: Record<string, string> = {
    fade: 'none',
    rise: 'translateY(0px)',
    drop: 'translateY(0px)',
    scale: 'scale(1)',
    'blur-in': 'none',
    'slide-left': 'translateX(0px)',
  }

  it.each(blockMotions.filter((id) => id !== 'none'))('%s starts hidden and ends settled', (id) => {
    expect(styleAt(id, 0).opacity).toBe(0)
    const settled = styleAt(id, fps)
    expect(settled.opacity).toBe(1)
    expect(settled.transform).toBe(settledTransform[id])
    if (settled.filter) expect(settled.filter).toBe('blur(0px)')
  })

  it('only blur-in touches the filter', () => {
    for (const id of TEXT_MOTION_IDS) {
      const style = styleAt(id, 3)
      if (id === 'blur-in') expect(style.filter).toBeDefined()
      else expect(style.filter, id).toBeUndefined()
    }
  })
})

describe('a reveal is ordered, bounded and seek-safe', () => {
  const splitMotions = TEXT_MOTION_IDS.filter((id) => textMotionSplit(id) !== 'none')

  it.each(splitMotions)('%s reveals units in order and never runs backwards', (id) => {
    const groups = splitForTextMotion('The quick brown fox', textMotionSplit(id))
    const unitCount = textMotionUnitCount(groups)

    for (let frame = 0; frame <= fps * 2; frame += 1) {
      let previous = Number.POSITIVE_INFINITY
      for (let ordinal = 0; ordinal < unitCount; ordinal += 1) {
        const { opacity } = textMotionStyle(id, frame, fps, ordinal, unitCount)
        expect(opacity).toBeGreaterThanOrEqual(0)
        expect(opacity).toBeLessThanOrEqual(1)
        // An earlier unit is always at least as far along as a later one.
        expect(opacity).toBeLessThanOrEqual(previous + 1e-9)
        previous = opacity
      }
    }
  })

  it.each(splitMotions)('%s starts its first unit immediately and finishes the rest', (id) => {
    const groups = splitForTextMotion('The quick brown fox', textMotionSplit(id))
    const unitCount = textMotionUnitCount(groups)
    expect(textMotionStyle(id, 0, fps, 0, unitCount).opacity).toBe(0)

    // The reveal window is 1.2s; by 2s every unit must be fully in, or a short clip would
    // end while its last word was still arriving.
    for (let ordinal = 0; ordinal < unitCount; ordinal += 1) {
      expect(textMotionStyle(id, fps * 2, fps, ordinal, unitCount).opacity, `${id}#${ordinal}`).toBe(1)
    }
  })

  it('is a pure function of the frame, so a seek matches a sequential render', () => {
    for (const id of TEXT_MOTION_IDS) {
      for (const frame of [0, 1, 7, 40]) {
        expect(textMotionStyle(id, frame, fps, 2, 6)).toEqual(
          textMotionStyle(id, frame, fps, 2, 6),
        )
      }
    }
  })

  it('scales the runway with the frame rate', () => {
    // The same wall-clock moment looks the same at 30 and 60 fps, give or take the one
    // frame a runway loses to rounding (11 frames at 30, 21 at 60). What must not happen is
    // a fixed frame count, which would make the motion twice as fast at 60 fps.
    expect(textMotionStyle('rise', 6, 30).opacity).toBeCloseTo(
      textMotionStyle('rise', 12, 60).opacity,
      1,
    )
    expect(textMotionStyle('rise', 21, 60).opacity).toBe(1)
    expect(textMotionStyle('rise', 11, 60).opacity).toBeLessThan(1)
  })
})

describe('an unknown motion cannot animate as something else', () => {
  it('resolves every real id to itself', () => {
    for (const id of TEXT_MOTION_IDS) expect(resolveTextMotion(id)).toBe(id)
  })

  it('falls back to none rather than to rise', () => {
    // The old `default:` case is what turned three unimplemented names into `rise`.
    expect(resolveTextMotion('kenburns')).toBe('none')
    expect(resolveTextMotion(undefined)).toBe('none')
    expect(resolveTextMotion('')).toBe('none')
  })
})
