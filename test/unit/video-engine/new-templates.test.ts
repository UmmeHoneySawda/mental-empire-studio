import { describe, expect, it } from 'vitest'
import { BUILTIN_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/builtins'
import { NEW_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/new-templates'
import { VideoTemplateRegistry } from '../../../electron/services/video-engine/templates/registry'
import { compileHookPlan } from '../../../electron/services/video-engine/hook-compiler'
import {
  HookPlanSchema,
  TemplateManifestSchema,
  createEmptyVideoProject,
  resolveTemplateProps,
} from '../../../shared/video-engine'
import { defaultHookPlan } from '../../../src/features/video-studio/editor/hookPlan'
import {
  newCaptionDraft,
  newCaptionDraftFromProps,
  newCaptionProps,
  newHookDraft,
  newHookDraftFromProps,
  newHookPlan,
} from '../../../src/features/video-studio/editor/newTemplates'
import {
  CAPTION_STYLE_IDS,
  NEW_CAPTION_DEFINITIONS,
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  NEW_TEMPLATE_ACCENT,
  NEW_TEMPLATE_BONE,
  captionGroupingOptionsForNewTemplate,
  captionStyleIdFromTemplateId,
  isNewCaptionTemplateId,
  isNewHookTemplateId,
  resolveNewCaptionStyle,
} from '../../../shared/video-engine'

/* The display names are written with the \u00B7 escape rather than a literal middle dot on
 * purpose: these assertions have to survive an encoding accident in this very file, and a
 * literal character would be corrupted alongside the thing it is meant to be guarding. */
const NAME_PREFIX = 'Cine \u00B7 '

/* The code units a UTF-8 -> CP1252 -> UTF-8 round trip leaves behind. '\u00B7' becomes
 * '\u00C2\u00B7' and '\u2014' becomes '\u00E2\u20AC\u201D', so spotting any of these in the
 * table means the module has been re-encoded and the e2e harness will stop matching. */
const MOJIBAKE = /[\u00C2\u00C3\u00E2\u20AC]/u

describe('new template definitions', () => {
  it('declares five hooks and five captions with stable ids', () => {
    expect(NEW_HOOK_TEMPLATE_IDS).toHaveLength(5)
    expect(NEW_CAPTION_TEMPLATE_IDS).toHaveLength(5)
    const all = [...NEW_HOOK_TEMPLATE_IDS, ...NEW_CAPTION_TEMPLATE_IDS]
    expect(new Set(all).size).toBe(10)
    for (const id of all) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
  })

  it('pins the ten literal ids that later tasks string-match on', () => {
    expect([...NEW_HOOK_TEMPLATE_IDS]).toEqual([
      'remotion-hook-cine-title-card',
      'remotion-hook-cine-reel-burn',
      'remotion-hook-cine-hard-light',
      'remotion-hook-cine-trailer-drop',
      'remotion-hook-cine-margin-note',
    ])
    expect([...NEW_CAPTION_TEMPLATE_IDS]).toEqual([
      'remotion-caption-cine-word-pop',
      'remotion-caption-cine-keyword-stack',
      'remotion-caption-cine-scrim-roll',
      'remotion-caption-cine-line-build',
      'remotion-caption-cine-held',
    ])
  })

  it('guards only recognise their own ids', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      expect(isNewHookTemplateId(id)).toBe(true)
      expect(isNewCaptionTemplateId(id)).toBe(false)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      expect(isNewCaptionTemplateId(id)).toBe(true)
      expect(isNewHookTemplateId(id)).toBe(false)
    }
    expect(isNewHookTemplateId(undefined)).toBe(false)
    expect(isNewCaptionTemplateId('remotion-caption-highlight')).toBe(false)
    expect(isNewHookTemplateId(null)).toBe(false)
    expect(isNewCaptionTemplateId(null)).toBe(false)
    expect(isNewHookTemplateId('')).toBe(false)
    expect(isNewCaptionTemplateId('')).toBe(false)
  })

  it('never lets a new caption id be mistaken for an existing style', () => {
    // captionStyleIdFromTemplateId matches an existing style by "-<styleId>" suffix. A new id
    // that happened to end that way would silently render as the old style instead.
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      for (const styleId of CAPTION_STYLE_IDS) {
        expect(id.endsWith(`-${styleId}`), `${id} vs ${styleId}`).toBe(false)
      }
      expect(captionStyleIdFromTemplateId(id)).toBe('highlight')
    }
  })

  it('keeps the exact "Cine <U+00B7> " display-name prefix on all ten definitions', () => {
    const names = [
      ...NEW_HOOK_TEMPLATE_IDS.map((id) => NEW_HOOK_DEFINITIONS[id].name),
      ...NEW_CAPTION_TEMPLATE_IDS.map((id) => NEW_CAPTION_DEFINITIONS[id].name),
    ]
    expect(names).toHaveLength(10)
    for (const name of names) {
      expect(name.startsWith(NAME_PREFIX), name).toBe(true)
      // The separator must be U+00B7 itself, not the '\u00C2\u00B7' its mojibake would produce.
      expect(name.codePointAt(5), name).toBe(0x00b7)
      expect(name.length).toBeGreaterThan(NAME_PREFIX.length)
    }
  })

  it('carries no mojibake code units in any table string', () => {
    const strings: string[] = []
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      strings.push(definition.id, definition.name, definition.description)
      for (const field of definition.textFields) {
        strings.push(field.key, field.label, field.default, field.hint ?? '')
      }
      for (const field of definition.numberFields) strings.push(field.key, field.label)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const definition = NEW_CAPTION_DEFINITIONS[id]
      strings.push(definition.id, definition.name, definition.description)
    }
    for (const value of strings) expect(MOJIBAKE.test(value), value).toBe(false)
  })

  it('pins the palette as uppercase literals', () => {
    expect(NEW_TEMPLATE_ACCENT).toBe('#C9553C')
    expect(NEW_TEMPLATE_BONE).toBe('#ECE5D8')
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const definition = NEW_CAPTION_DEFINITIONS[id]
      expect(definition.textColor).toBe(definition.textColor.toUpperCase())
      expect(definition.accentColor).toBe(definition.accentColor.toUpperCase())
    }
  })

  it('freezes both definition tables', () => {
    expect(Object.isFrozen(NEW_HOOK_DEFINITIONS)).toBe(true)
    expect(Object.isFrozen(NEW_CAPTION_DEFINITIONS)).toBe(true)
  })

  it('gives every hook a headline field, a default, and a real length', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      expect(definition.id).toBe(id)
      expect(definition.name.length).toBeGreaterThan(0)
      expect(definition.description.length).toBeGreaterThan(0)
      expect(definition.defaultSeconds).toBeGreaterThan(0)
      expect(definition.defaultSeconds).toBeLessThanOrEqual(30)
      expect(definition.grain).toBeGreaterThanOrEqual(0)
      expect(definition.grain).toBeLessThanOrEqual(1)
      const roles = definition.textFields.map((field) => field.role)
      expect(roles.filter((role) => role === 'headline')).toHaveLength(1)
      expect(roles.filter((role) => role === 'body').length).toBeLessThanOrEqual(1)
      for (const field of definition.textFields) {
        expect(field.default.length).toBeGreaterThan(0)
        expect(field.default.length).toBeLessThanOrEqual(field.maxLength)
      }
      expect(new Set(definition.textFields.map((field) => field.key)).size)
        .toBe(definition.textFields.length)
    }
  })

  it('pins usesAccent per hook', () => {
    expect({
      'remotion-hook-cine-title-card': NEW_HOOK_DEFINITIONS['remotion-hook-cine-title-card'].usesAccent,
      'remotion-hook-cine-reel-burn': NEW_HOOK_DEFINITIONS['remotion-hook-cine-reel-burn'].usesAccent,
      'remotion-hook-cine-hard-light': NEW_HOOK_DEFINITIONS['remotion-hook-cine-hard-light'].usesAccent,
      'remotion-hook-cine-trailer-drop': NEW_HOOK_DEFINITIONS['remotion-hook-cine-trailer-drop'].usesAccent,
      'remotion-hook-cine-margin-note': NEW_HOOK_DEFINITIONS['remotion-hook-cine-margin-note'].usesAccent,
    }).toEqual({
      'remotion-hook-cine-title-card': true,
      'remotion-hook-cine-reel-burn': true,
      'remotion-hook-cine-hard-light': false,
      'remotion-hook-cine-trailer-drop': true,
      'remotion-hook-cine-margin-note': true,
    })
  })

  it('gives only margin-note a number field, and pins its bounds', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      if (id === 'remotion-hook-cine-margin-note') continue
      expect(NEW_HOOK_DEFINITIONS[id].numberFields, id).toEqual([])
    }
    expect(NEW_HOOK_DEFINITIONS['remotion-hook-cine-margin-note'].numberFields).toEqual([
      {
        key: 'startTimecodeSeconds',
        label: 'Start timecode',
        default: 761,
        minimum: 0,
        maximum: 86399,
        integer: true,
      },
    ])
  })

  it('keeps every fontScale inside the render-time clamp band', () => {
    // Outside 0.037..0.089 the render-time clamp would silently override the table.
    // Floor is 0.037 (pins 40px at 1080p), ceiling 0.089 (pins 96px Word Pop at 1080p).
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const { fontScale } = NEW_CAPTION_DEFINITIONS[id]
      expect(fontScale, id).toBeGreaterThanOrEqual(0.037)
      expect(fontScale, id).toBeLessThanOrEqual(0.089)
    }
  })

  it('resolves caption props inside their bounds and rejects unknown ids', () => {
    expect(resolveNewCaptionStyle('remotion-caption-highlight')).toBeNull()
    expect(resolveNewCaptionStyle(undefined)).toBeNull()
    const base = resolveNewCaptionStyle('remotion-caption-cine-word-pop')!
    expect(base.id).toBe('remotion-caption-cine-word-pop')
    expect(base).toEqual(NEW_CAPTION_DEFINITIONS['remotion-caption-cine-word-pop'])

    const overridden = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      accentColor: '#00ffaa',
      textColor: 'not a colour',
      grain: 5,
      maxWordsPerCue: 99,
      maxCharactersPerLine: 1,
    })!
    expect(overridden.accentColor).toBe('#00FFAA')
    expect(overridden.textColor).toBe(base.textColor)
    expect(overridden.grain).toBe(1)
    expect(overridden.maxWordsPerCue).toBe(12)
    expect(overridden.maxCharactersPerLine).toBe(10)
  })

  it('clamps overrides on the low side too', () => {
    const clamped = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      grain: -3,
      maxWordsPerCue: 0,
      maxCharactersPerLine: 900,
    })!
    expect(clamped.grain).toBe(0)
    expect(clamped.maxWordsPerCue).toBe(1)
    expect(clamped.maxCharactersPerLine).toBe(42)
  })

  it('rounds fractional integer overrides', () => {
    const rounded = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      maxWordsPerCue: 4.6,
      maxCharactersPerLine: 20.4,
    })!
    expect(rounded.maxWordsPerCue).toBe(5)
    expect(rounded.maxCharactersPerLine).toBe(20)
  })

  it('falls back to the table for NaN and non-numeric overrides', () => {
    const table = NEW_CAPTION_DEFINITIONS['remotion-caption-cine-word-pop']
    for (const bad of [Number.NaN, 'nope', null, true, [], {}]) {
      const resolved = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
        grain: bad,
        maxWordsPerCue: bad,
        maxCharactersPerLine: bad,
      })!
      expect(resolved.grain, String(bad)).toBe(table.grain)
      expect(resolved.maxWordsPerCue, String(bad)).toBe(table.maxWordsPerCue)
      expect(resolved.maxCharactersPerLine, String(bad)).toBe(table.maxCharactersPerLine)
    }
  })

  it('canonicalises colour to uppercase on the fallback path as well as the override path', () => {
    // Fallback path: no props at all.
    const fallback = resolveNewCaptionStyle('remotion-caption-cine-word-pop')!
    expect(fallback.textColor).toBe('#ECE5D8')
    expect(fallback.accentColor).toBe('#C9553C')
    // Fallback path via a rejected value: a non-string, and an unparseable string.
    const rejected = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      accentColor: 42,
      textColor: '#12345',
    })!
    expect(rejected.accentColor).toBe('#C9553C')
    expect(rejected.textColor).toBe('#ECE5D8')
    // Override path: valid lowercase #RRGGBB and #RRGGBBAA are both accepted and uppercased.
    const overridden = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      textColor: '#00ffaa',
      accentColor: '#00ffaa80',
    })!
    expect(overridden.textColor).toBe('#00FFAA')
    expect(overridden.accentColor).toBe('#00FFAA80')
    // The invariant across every template, so no layer can compare '#c9553c' to '#C9553C'.
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const style = resolveNewCaptionStyle(id)!
      expect(style.textColor, id).toBe(style.textColor.toUpperCase())
      expect(style.accentColor, id).toBe(style.accentColor.toUpperCase())
    }
  })

  it.each([24, 30, 60])('derives deterministic frame paging at %i fps', (fps) => {
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const style = resolveNewCaptionStyle(id)!
      const options = captionGroupingOptionsForNewTemplate(style, fps)
      expect(options.maxDurationFrames).toBe(Math.round(style.maxDurationSeconds * fps))
      expect(options.maxGapFrames).toBe(Math.round(style.maxGapSeconds * fps))
      expect(options.maxCharactersPerCue).toBe(style.maxCharactersPerLine * style.maxLines)
      expect(options.maxLines).toBeLessThanOrEqual(3)
      expect(options.preferSentenceBreaks).toBe(true)
    }
  })

  it('pins one paging row by hand so a wrong formula cannot pass', () => {
    // The loop above restates the implementation with inputs from the same module, so it can
    // only catch drift, never a wrong formula. These numbers are computed off-module:
    // 2.4s * 30 = 72 frames, 0.48s * 30 = 14.4 -> 14 frames, 18 chars * 2 lines = 36.
    const style = resolveNewCaptionStyle('remotion-caption-cine-word-pop')!
    expect(captionGroupingOptionsForNewTemplate(style, 30)).toEqual({
      maxWordsPerCue: 3,
      maxCharactersPerCue: 36,
      maxCharactersPerLine: 18,
      maxLines: 2,
      maxDurationFrames: 72,
      maxGapFrames: 14,
      preferSentenceBreaks: true,
    })
  })

  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats an unusable fps of %s as 30',
    (fps) => {
      for (const id of NEW_CAPTION_TEMPLATE_IDS) {
        const style = resolveNewCaptionStyle(id)!
        const at30 = captionGroupingOptionsForNewTemplate(style, 30)
        const guarded = captionGroupingOptionsForNewTemplate(style, fps)
        expect(guarded.maxDurationFrames, id).toBe(at30.maxDurationFrames)
        expect(guarded.maxGapFrames, id).toBe(at30.maxGapFrames)
        expect(guarded, id).toEqual(at30)
      }
    },
  )

  it('clamps maxLines into the caption schema band', () => {
    // CaptionGroupingOptionsSchema.maxLines is .min(1).max(3); an out-of-band table value must be
    // caught here rather than thrown by the caption layer's parse.
    const style = resolveNewCaptionStyle('remotion-caption-cine-scrim-roll')!
    expect(captionGroupingOptionsForNewTemplate({ ...style, maxLines: 9 }, 30).maxLines).toBe(3)
    expect(captionGroupingOptionsForNewTemplate({ ...style, maxLines: 0 }, 30).maxLines).toBe(1)
    expect(captionGroupingOptionsForNewTemplate({ ...style, maxLines: 2 }, 30).maxLines).toBe(2)
    // The character budget follows the honoured line count, not the raw table value.
    expect(captionGroupingOptionsForNewTemplate({ ...style, maxLines: 9 }, 30).maxCharactersPerCue)
      .toBe(style.maxCharactersPerLine * 3)
  })
})

describe('new template manifests', () => {
  it('publishes ten valid Remotion manifests', () => {
    expect(NEW_VIDEO_TEMPLATES).toHaveLength(10)
    for (const manifest of NEW_VIDEO_TEMPLATES) {
      expect(TemplateManifestSchema.parse(manifest)).toEqual(manifest)
      expect(manifest.rendererId).toBe('remotion')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest.tags).toContain('new-templates')
      expect(manifest.aspectRatios).toHaveLength(5)
    }
    const hooks = NEW_VIDEO_TEMPLATES.filter((manifest) => manifest.kind === 'hook')
    const captions = NEW_VIDEO_TEMPLATES.filter((manifest) => manifest.kind === 'caption')
    expect(hooks.map((manifest) => manifest.id).sort()).toEqual([...NEW_HOOK_TEMPLATE_IDS].sort())
    expect(captions.map((manifest) => manifest.id).sort()).toEqual([...NEW_CAPTION_TEMPLATE_IDS].sort())
  })

  it('adds to the registry without touching the built-in set', () => {
    // The additive claim, asserted rather than assumed. Three existing suites pin these counts.
    const builtinIds = new Set(BUILTIN_VIDEO_TEMPLATES.map((manifest) => manifest.id))
    for (const manifest of NEW_VIDEO_TEMPLATES) expect(builtinIds.has(manifest.id)).toBe(false)
    expect(
      BUILTIN_VIDEO_TEMPLATES.filter((m) => m.rendererId === 'remotion' && m.kind === 'hook'),
    ).toHaveLength(7)
    expect(
      BUILTIN_VIDEO_TEMPLATES.filter((m) => m.rendererId === 'remotion' && m.kind === 'caption'),
    ).toHaveLength(10)

    const registry = new VideoTemplateRegistry()
    for (const manifest of NEW_VIDEO_TEMPLATES) {
      expect(registry.require(manifest.id).id).toBe(manifest.id)
      expect(registry.require(manifest.id, '1.0.0').kind).toBe(manifest.kind)
    }
    expect(registry.list({ rendererId: 'remotion', kind: 'hook' })).toHaveLength(12)
    expect(registry.list({ rendererId: 'remotion', kind: 'caption' })).toHaveLength(15)
    expect(registry.list({ rendererId: 'hyperframes', kind: 'hook' })).toHaveLength(2)
    expect(registry.list({ rendererId: 'hyperframes', kind: 'caption' })).toHaveLength(10)
  })

  it('declares every prop a component reads, with the delivered defaults', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const resolved = resolveTemplateProps(registry.require(id), {})
      for (const field of definition.textFields) expect(resolved[field.key]).toBe(field.default)
      for (const field of definition.numberFields) expect(resolved[field.key]).toBe(field.default)
      expect(resolved['grain']).toBe(definition.grain)
      expect(Object.hasOwn(resolved, 'accentColor')).toBe(definition.usesAccent)
      // Anything undeclared must be rejected, or a typo would render as silence.
      expect(() => resolveTemplateProps(registry.require(id), { nope: 'x' })).toThrow(/Unknown template property/u)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const definition = NEW_CAPTION_DEFINITIONS[id]
      const resolved = resolveTemplateProps(registry.require(id), {})
      expect(resolved['accentColor']).toBe(definition.accentColor.toUpperCase())
      expect(resolved['textColor']).toBe(definition.textColor.toUpperCase())
      expect(resolved['grain']).toBe(definition.grain)
      expect(resolved['maxWordsPerCue']).toBe(definition.maxWordsPerCue)
      expect(resolved['maxCharactersPerLine']).toBe(definition.maxCharactersPerLine)
    }
  })

  it('keeps hook durations inside the range the compiler checks', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const manifest = new VideoTemplateRegistry().require(id)
      expect(manifest.duration.minimumFrames).toBe(12)
      expect(manifest.duration.maximumFrames).toBe(7_200)
      expect(manifest.duration.defaultFrames)
        .toBe(Math.round(NEW_HOOK_DEFINITIONS[id].defaultSeconds * 30))
    }
  })

  /* The parameter set has to be EXACT, not merely sufficient.
   *
   * A missing key makes resolveTemplateProps throw, which is loud. An EXTRA key is silent and
   * worse: it lets a component read a prop the shared table knows nothing about, which is the
   * drift this whole design exists to prevent. Neither the resolve loop above nor the
   * accentColor presence check can see an extra parameter, so pin the set itself. */
  it('declares exactly the parameters the shared table implies, and no more', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const expected = [
        ...definition.textFields.map((field) => field.key),
        ...definition.numberFields.map((field) => field.key),
        'grain',
        ...(definition.usesAccent ? ['accentColor'] : []),
      ].sort()
      expect(registry.require(id).parameters.map((parameter) => parameter.key).sort()).toEqual(expected)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      expect(registry.require(id).parameters.map((parameter) => parameter.key).sort()).toEqual([
        'accentColor',
        'grain',
        'maxCharactersPerLine',
        'maxWordsPerCue',
        'textColor',
      ])
    }
    // Hard Light is the one hook the delivered set gives no accent. Pinned by hand because the
    // loop above would happily agree with itself if usesAccent regressed.
    expect(
      registry.require('remotion-hook-cine-hard-light').parameters.some((p) => p.key === 'accentColor'),
    ).toBe(false)
  })

  it('pins identity and capabilities for all ten', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of [...NEW_HOOK_TEMPLATE_IDS, ...NEW_CAPTION_TEMPLATE_IDS]) {
      const manifest = registry.require(id)
      // implementationId is what a renderer dispatches on, so it must equal the id rather than
      // defaulting to something else.
      expect(manifest.implementationId).toBe(id)
      expect(manifest.aspectRatios).toEqual(['16:9', '9:16', '1:1', '4:5', 'custom'])
    }
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      /* No `audio` and no `broll`. These components render neither `beat.visual` nor audio — their
       * footage is whatever sits under the hook lane — and a capability nothing implements is how a
       * beat carrying an assetId resolves to a blank frame with no error. */
      expect([...registry.require(id).capabilities].sort()).toEqual(['dynamic-duration', 'transitions'])
      expect([...registry.require(id).tags].sort()).toEqual(['cinematic', 'film', 'hook', 'new-templates'])
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      expect([...registry.require(id).capabilities].sort())
        .toEqual(['captions', 'dynamic-duration', 'word-highlighting'])
      expect([...registry.require(id).tags].sort())
        .toEqual(['caption', 'cinematic', 'new-templates', 'word-timed'])
      expect(registry.require(id).duration.defaultFrames).toBe(90)
    }
  })

  /* The manifest bound and the resolver clamp must be the same number.
   *
   * If the manifest accepted a value resolveNewCaptionStyle then clamped, the editor would offer a
   * setting that silently does not apply. Prove both ends survive a round trip instead of trusting
   * that two hand-written pairs of numbers agree. */
  it('agrees with resolveNewCaptionStyle on every caption bound', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const manifest = registry.require(id)
      const bounds = (key: string): { minimum?: number; maximum?: number } =>
        manifest.parameters.find((parameter) => parameter.key === key) as { minimum?: number; maximum?: number }
      expect(bounds('grain')).toMatchObject({ minimum: 0, maximum: 1 })
      expect(bounds('maxWordsPerCue')).toMatchObject({ minimum: 1, maximum: 12 })
      expect(bounds('maxCharactersPerLine')).toMatchObject({ minimum: 10, maximum: 42 })

      for (const [key, low, high] of [
        ['maxWordsPerCue', 1, 12],
        ['maxCharactersPerLine', 10, 42],
      ] as const) {
        for (const value of [low, high]) {
          const style = resolveNewCaptionStyle(id, resolveTemplateProps(manifest, { [key]: value }))
          expect(style?.[key], `${id} ${key}=${value}`).toBe(value)
        }
      }
      for (const value of [0, 1]) {
        const style = resolveNewCaptionStyle(id, resolveTemplateProps(manifest, { grain: value }))
        expect(style?.grain, `${id} grain=${value}`).toBe(value)
      }
    }
  })
})

describe('new hook plans', () => {
  it.each([24, 30, 60])('builds a compiler-accepted single-beat plan at %i fps', (fps) => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const template = registry.require(id)
      const draft = newHookDraft(definition)
      const plan = newHookPlan({ template, definition, draft, fps })

      expect(HookPlanSchema.parse(plan)).toEqual(plan)
      expect(plan.rendererId).toBe('remotion')
      expect(plan.templateId).toBe(id)
      expect(plan.templateVersion).toBe('1.0.0')
      expect(plan.fps).toBe(fps)
      expect(plan.beats).toHaveLength(1)
      expect(plan.beats[0]!.startFrame).toBe(0)
      expect(plan.beats[0]!.durationFrames).toBe(plan.durationFrames)
      expect(plan.beats[0]!.visual).toEqual({ kind: 'none' })
      expect(plan.durationFrames).toBe(Math.round(definition.defaultSeconds * fps))

      const headlineField = definition.textFields.find((field) => field.role === 'headline')!
      const bodyField = definition.textFields.find((field) => field.role === 'body')
      expect(plan.beats[0]!.headline).toBe(headlineField.default)
      expect(plan.beats[0]!.body).toBe(bodyField ? bodyField.default : undefined)

      // Every declared parameter present and nothing undeclared, or resolveTemplateProps throws
      // inside compileHookPlan.
      for (const field of definition.textFields) expect(plan.props![field.key]).toBe(field.default)
      for (const field of definition.numberFields) expect(plan.props![field.key]).toBe(field.default)
      expect(plan.props!['grain']).toBe(definition.grain)
      expect(Object.hasOwn(plan.props!, 'accentColor')).toBe(definition.usesAccent)

      const project = createEmptyVideoProject({
        id: 'proj-new-templates',
        name: 'New templates',
        rendererId: 'remotion',
        width: 1920,
        height: 1080,
        fps,
        durationFrames: fps * 20,
      })
      const compiled = compileHookPlan(project, plan, registry)
      const scene = compiled.project.scenes.find(
        (candidate) => candidate.id === 'video-engine-hook-plan',
      )
      expect(scene?.template?.id).toBe(id)
      expect(scene?.durationFrames).toBe(plan.durationFrames)
      expect(compiled.brollRequests).toHaveLength(0)
      // The renderer reads the plan back out of the scene, so it has to survive the compiler.
      expect(HookPlanSchema.safeParse(scene?.template?.props?.['hookPlan']).success).toBe(true)
    }
  })

  it('never emits an empty headline or an over-long field', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const template = registry.require(id)
      const emptied = newHookDraft(definition)
      for (const key of Object.keys(emptied.text)) emptied.text[key] = '   '
      const plan = newHookPlan({ template, definition, draft: emptied, fps: 30 })
      expect(HookPlanSchema.parse(plan)).toEqual(plan)
      expect(plan.beats[0]!.headline!.length).toBeGreaterThan(0)
      expect(plan.title.length).toBeGreaterThan(0)

      const flooded = newHookDraft(definition)
      for (const key of Object.keys(flooded.text)) flooded.text[key] = 'x'.repeat(5000)
      const bounded = newHookPlan({ template, definition, draft: flooded, fps: 30 })
      expect(HookPlanSchema.parse(bounded)).toEqual(bounded)
      for (const field of definition.textFields) {
        expect(String(bounded.props![field.key]).length).toBeLessThanOrEqual(field.maxLength)
      }
      // compileHookPlan must accept the extremes too, or a long paste breaks "Add this hook".
      const project = createEmptyVideoProject({
        id: 'proj-bounds',
        name: 'Bounds',
        rendererId: 'remotion',
        width: 1080,
        height: 1920,
        fps: 30,
        durationFrames: 900,
      })
      expect(() => compileHookPlan(project, bounded, registry)).not.toThrow()
    }
  })

  it('clamps the length to the manifest range and the 30-second ceiling', () => {
    const registry = new VideoTemplateRegistry()
    const id = NEW_HOOK_TEMPLATE_IDS[0]
    const definition = NEW_HOOK_DEFINITIONS[id]
    const template = registry.require(id)
    const tiny = newHookPlan({
      template,
      definition,
      draft: { ...newHookDraft(definition), seconds: 0 },
      fps: 30,
    })
    expect(tiny.durationFrames).toBe(12)
    const huge = newHookPlan({
      template,
      definition,
      draft: { ...newHookDraft(definition), seconds: 999 },
      fps: 30,
    })
    expect(huge.durationFrames).toBe(900)
    expect(HookPlanSchema.parse(huge)).toEqual(huge)
    // 60fps hits the same 30-second ceiling at twice the frames.
    const huge60 = newHookPlan({
      template,
      definition,
      draft: { ...newHookDraft(definition), seconds: 999 },
      fps: 60,
    })
    expect(huge60.durationFrames).toBe(1800)
  })

  it('sanitises the accent and grain a user can type', () => {
    const registry = new VideoTemplateRegistry()
    const id = 'remotion-hook-cine-title-card'
    const definition = NEW_HOOK_DEFINITIONS[id]
    const template = registry.require(id)
    const base = newHookDraft(definition)

    expect(
      newHookPlan({ template, definition, draft: { ...base, accentColor: 'nonsense' }, fps: 30 })
        .props!['accentColor'],
    ).toBe(NEW_TEMPLATE_ACCENT.toUpperCase())
    expect(
      newHookPlan({ template, definition, draft: { ...base, accentColor: '#00ffaa' }, fps: 30 })
        .props!['accentColor'],
    ).toBe('#00FFAA')
    expect(
      newHookPlan({ template, definition, draft: { ...base, grain: 9 }, fps: 30 }).props!['grain'],
    ).toBe(1)
    expect(
      newHookPlan({ template, definition, draft: { ...base, grain: -4 }, fps: 30 }).props!['grain'],
    ).toBe(0)
    expect(
      newHookPlan({
        template,
        definition,
        draft: { ...base, grain: Number.NaN },
        fps: 30,
      }).props!['grain'],
    ).toBe(0)

    // Hard Light is the hook with no accent parameter: writing one would make
    // resolveTemplateProps throw inside the compiler.
    const hardLight = 'remotion-hook-cine-hard-light'
    const hlPlan = newHookPlan({
      template: registry.require(hardLight),
      definition: NEW_HOOK_DEFINITIONS[hardLight],
      draft: { ...newHookDraft(NEW_HOOK_DEFINITIONS[hardLight]), accentColor: '#00FFAA' },
      fps: 30,
    })
    expect(Object.hasOwn(hlPlan.props!, 'accentColor')).toBe(false)
  })

  it('bounds the margin-note timecode a user can type', () => {
    const registry = new VideoTemplateRegistry()
    const id = 'remotion-hook-cine-margin-note'
    const definition = NEW_HOOK_DEFINITIONS[id]
    const template = registry.require(id)
    const plan = (value: number) =>
      newHookPlan({
        template,
        definition,
        draft: { ...newHookDraft(definition), numbers: { startTimecodeSeconds: value } },
        fps: 30,
      }).props!['startTimecodeSeconds']
    expect(plan(-50)).toBe(0)
    expect(plan(999_999)).toBe(86_399)
    expect(plan(120.6)).toBe(121)
    expect(plan(Number.NaN)).toBe(761)
  })

  it('builds caption props that resolveTemplateProps accepts', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const manifest = registry.require(id)
      const definition = NEW_CAPTION_DEFINITIONS[id]
      const resolved = resolveTemplateProps(manifest, newCaptionProps(id, newCaptionDraft(id)))
      expect(resolved['grain']).toBe(definition.grain)
      expect(resolved['maxWordsPerCue']).toBe(definition.maxWordsPerCue)
      expect(resolved['maxCharactersPerLine']).toBe(definition.maxCharactersPerLine)
      expect(resolved['accentColor']).toBe(definition.accentColor)
      expect(resolved['textColor']).toBe(definition.textColor)
      // The round trip has to land back on the table, or selecting a style would silently
      // change it.
      expect(resolveNewCaptionStyle(id, resolved)).toEqual(definition)

      const wild = newCaptionProps(id, {
        accentColor: 'nonsense',
        textColor: '#abcdef',
        grain: 9,
        maxWordsPerCue: -4,
        maxCharactersPerLine: 900,
      })
      expect(() => resolveTemplateProps(manifest, wild)).not.toThrow()
      expect(wild['accentColor']).toBe(definition.accentColor)
      expect(wild['textColor']).toBe('#ABCDEF')
      expect(wild['grain']).toBe(1)
      expect(wild['maxWordsPerCue']).toBe(1)
      expect(wild['maxCharactersPerLine']).toBe(42)
    }
  })
})

/* The two guards the final whole-branch review asked for.
 *
 * Registering through VideoTemplateRegistry puts all ten manifests into videoEngine.templates(), and
 * the editor's PRE-EXISTING Hook and Caption sections filter that list by `kind` alone. Left
 * unfiltered they gained five cards each — the Cinematic hooks in particular became reachable through
 * `defaultHookPlan`, whose `seedsFor` matches none of the new ids and falls through to the 5-beat
 * KINETIC seed, while the components read only the first beat. Two clicks to a hook drawing a
 * placeholder. These pin the filter predicate and the seed mismatch that made it necessary. */
describe('the new set stays out of the existing panels', () => {
  it('is separable from the built-ins by nothing but the id guards', () => {
    const registry = new VideoTemplateRegistry()
    const hooks = registry.list({ rendererId: 'remotion', kind: 'hook' })
    const captions = registry.list({ rendererId: 'remotion', kind: 'caption' })
    expect(hooks).toHaveLength(12)
    expect(captions).toHaveLength(15)
    // What Inspector.tsx now does. Filtering must restore the exact pre-existing lists.
    expect(hooks.filter((template) => !isNewHookTemplateId(template.id))).toHaveLength(7)
    expect(captions.filter((template) => !isNewCaptionTemplateId(template.id))).toHaveLength(10)
    expect(hooks.filter((template) => isNewHookTemplateId(template.id))).toHaveLength(5)
    expect(captions.filter((template) => isNewCaptionTemplateId(template.id))).toHaveLength(5)
  })

  it('records why the existing hook panel must not offer them', () => {
    /* defaultHookPlan is the existing panel's builder. It is NOT wrong — the new ids simply are not
     * its business — but it produces a plan these components cannot render, which is precisely why
     * the filter above exists. If a future change makes seedsFor aware of the new ids, this test
     * fails and the filter can be reconsidered. */
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const plan = defaultHookPlan({
        template: registry.require(id),
        title: 'A useful opening',
        fps: 30,
        durationFrames: 150,
      })
      expect(plan.beats.length).toBeGreaterThan(1)
      expect(plan.beats[1]?.headline).toBeDefined()
      // newHookPlan, the accordion's builder, is the single-beat one these components read.
      expect(
        newHookPlan({
          template: registry.require(id),
          definition: NEW_HOOK_DEFINITIONS[id],
          draft: newHookDraft(NEW_HOOK_DEFINITIONS[id]),
          fps: 30,
        }).beats,
      ).toHaveLength(1)
    }
  })

  it('reads a saved caption draft back instead of overwriting it with the table', () => {
    /* Seeding the accordion from the table alone meant reopening a customised project showed default
     * swatches, and the first touch of any control wrote those defaults back — a silent discard. */
    const id = 'remotion-caption-cine-word-pop'
    const saved = {
      accentColor: '#00FFAA',
      textColor: '#101010',
      grain: 0.8,
      maxWordsPerCue: 7,
      maxCharactersPerLine: 33,
    }
    expect(newCaptionDraftFromProps(id, saved)).toEqual(saved)
    // Absent, malformed and out-of-range values each fall back field by field, never to NaN.
    expect(newCaptionDraftFromProps(id, undefined)).toEqual(newCaptionDraft(id))
    expect(newCaptionDraftFromProps(id, { accentColor: 'nope', grain: 'x', maxWordsPerCue: 99 })).toEqual({
      ...newCaptionDraft(id),
      maxWordsPerCue: 12,
    })
    // And the round trip through newCaptionProps is stable, so re-applying an untouched panel is a
    // no-op rather than a revision-burning rewrite.
    expect(newCaptionProps(id, newCaptionDraftFromProps(id, saved))).toEqual(saved)
  })
})

describe('new hook draft read-back', () => {
  it('returns table defaults when no saved data', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const base = newHookDraft(definition)
      expect(newHookDraftFromProps({ definition })).toEqual(base)
      expect(newHookDraftFromProps({ definition, props: undefined })).toEqual(base)
      expect(newHookDraftFromProps({ definition, props: {} })).toEqual(base)
    }
  })

  it('reads props text fields, trims and slices to maxLength, ignores empty', () => {
    const id = 'remotion-hook-cine-title-card' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    const long = 'x'.repeat(600)
    const draft = newHookDraftFromProps({
      definition,
      props: { line: long, kicker: '  hello  ' },
    })
    expect(draft.text['line']!.length).toBe(definition.textFields.find((f) => f.key === 'line')!.maxLength)
    expect(draft.text['kicker']).toBe('hello')
    // Empty / whitespace props do not overwrite
    const empty = newHookDraftFromProps({
      definition,
      props: { line: '   ', kicker: '' },
    })
    expect(empty.text['line']).toBe(definition.textFields.find((f) => f.key === 'line')!.default)
  })

  it('headline/body beat fields win over props', () => {
    const id = 'remotion-hook-cine-reel-burn' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    const draft = newHookDraftFromProps({
      definition,
      props: { lineA: 'from props', lineB: 'from props' },
      headline: 'from beat',
      body: 'from body',
    })
    expect(draft.text['lineA']).toBe('from beat')
    expect(draft.text['lineB']).toBe('from body')
    // Whitespace beat does not override
    const white = newHookDraftFromProps({
      definition,
      props: { lineA: 'props' },
      headline: '   ',
    })
    expect(white.text['lineA']).toBe('props')
  })

  it('bounds and rounds number fields, handles NaN and out-of-range', () => {
    const id = 'remotion-hook-cine-margin-note' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    const field = definition.numberFields[0]!
    expect(
      newHookDraftFromProps({ definition, props: { [field.key]: 999_999 } }).numbers[field.key],
    ).toBe(field.maximum)
    expect(newHookDraftFromProps({ definition, props: { [field.key]: -50 } }).numbers[field.key]).toBe(
      field.minimum,
    )
    expect(
      newHookDraftFromProps({ definition, props: { [field.key]: 120.6 } }).numbers[field.key],
    ).toBe(121)
    expect(
      newHookDraftFromProps({ definition, props: { [field.key]: Number.NaN } }).numbers[field.key],
    ).toBe(field.default)
    expect(newHookDraftFromProps({ definition, props: { [field.key]: 'nope' as unknown as number } }).numbers[field.key]).toBe(
      field.default,
    )
  })

  it('normalises hex including 8-digit and falls back', () => {
    const id = 'remotion-hook-cine-title-card' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    expect(
      newHookDraftFromProps({ definition, props: { accentColor: '#00ffaa' } }).accentColor,
    ).toBe('#00FFAA')
    expect(
      newHookDraftFromProps({ definition, props: { accentColor: '#00ffaa80' } }).accentColor,
    ).toBe('#00FFAA80')
    expect(
      newHookDraftFromProps({ definition, props: { accentColor: 'nonsense' } }).accentColor,
    ).toBe(NEW_TEMPLATE_ACCENT.toUpperCase())
    // Hard Light has no accent — prop is ignored via usesAccent gate in the writer, but read-back still normalises if present
  })

  it('clamps grain to 0..1 and seconds to positive', () => {
    const id = 'remotion-hook-cine-title-card' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    expect(newHookDraftFromProps({ definition, props: { grain: 9 } }).grain).toBe(1)
    expect(newHookDraftFromProps({ definition, props: { grain: -4 } }).grain).toBe(0)
    expect(newHookDraftFromProps({ definition, props: { grain: Number.NaN } }).grain).toBe(definition.grain)
    expect(newHookDraftFromProps({ definition, props: {}, seconds: 0 }).seconds).toBe(definition.defaultSeconds)
    expect(newHookDraftFromProps({ definition, props: {}, seconds: 5.5 }).seconds).toBe(5.5)
    expect(newHookDraftFromProps({ definition, props: {}, seconds: -3 }).seconds).toBe(definition.defaultSeconds)
  })

  it('round-trips through newHookPlan bounds', () => {
    const id = 'remotion-hook-cine-margin-note' as const
    const definition = NEW_HOOK_DEFINITIONS[id]
    const draft = newHookDraftFromProps({
      definition,
      props: { startTimecodeSeconds: 999_999, grain: 9, accentColor: '#00ffaa80', line: 'x'.repeat(1000) },
      headline: 'beat headline wins',
      seconds: 999,
    })
    expect(draft.numbers['startTimecodeSeconds']).toBe(86_399)
    expect(draft.grain).toBe(1)
    expect(draft.accentColor).toBe('#00FFAA80')
    expect(draft.text['line']!.length).toBeLessThanOrEqual(500)
    expect(draft.text['line']).toBe('beat headline wins')
  })
})