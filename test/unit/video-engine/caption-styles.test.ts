import { describe, expect, it } from 'vitest'
import {
  CAPTION_STYLE_DEFINITIONS,
  CAPTION_STYLE_IDS,
  activeCaptionCue,
  captionGroupingOptionsForStyle,
  captionLayoutMetrics,
  captionStyleIdFromTemplateId,
  captionWordIsActive,
  captionWordProgress,
  captionWordRenderProgress,
  createCaptionDocument,
  groupCaptionCues,
  hexColorWithAlpha,
  readableTextColor,
  resolveCaptionStyle,
  resolveTemplateProps,
  wrapCaptionLines,
  VideoProjectSchema,
  type CaptionCue,
  type CaptionWord,
} from '../../../shared/video-engine'
import { BUILTIN_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/builtins'
import { captionWordsFromRemotionCaptions } from '../../../electron/services/video-engine/captions/import'
import { captionWordsFromTranscript } from '../../../electron/services/video-engine/studio'
import { compileHyperframesProject, createHyperframesSmokeProject } from '../../../video-engine/hyperframes'

function timedWords(texts: readonly string[], framesPerWord = 8): CaptionWord[] {
  return texts.map((text, index) => ({
    id: `caption-word-${index + 1}`,
    text,
    startFrame: index * framesPerWord,
    endFrame: (index + 1) * framesPerWord,
    importance: index === 1 ? 2 : 0,
  }))
}

describe('caption style registry', () => {
  it('keeps six legacy recipes and adds four truthful new recipes', () => {
    expect(CAPTION_STYLE_IDS).toHaveLength(10)
    expect(CAPTION_STYLE_DEFINITIONS['emoji-pop'].name).toBe('Impact Pop')
    expect(CAPTION_STYLE_DEFINITIONS['particle-burst'].name).toBe('Accent Burst')
    expect(CAPTION_STYLE_IDS).toEqual(expect.arrayContaining([
      'motivation-bold',
      'mindset-pill',
      'progress-underline',
      'coach-clean',
    ]))
    expect(captionStyleIdFromTemplateId('caption-clean')).toBe('coach-clean')
    expect(captionStyleIdFromTemplateId('caption-karaoke')).toBe('clip-wipe')
    expect(captionStyleIdFromTemplateId('caption-punch')).toBe('emoji-pop')
  })

  it('publishes distinct, renderer-aligned defaults for every style', () => {
    for (const rendererId of ['remotion', 'hyperframes'] as const) {
      const manifests = BUILTIN_VIDEO_TEMPLATES.filter(
        (template) => template.rendererId === rendererId && template.kind === 'caption',
      )
      expect(manifests).toHaveLength(CAPTION_STYLE_IDS.length)
      for (const styleId of CAPTION_STYLE_IDS) {
        const manifest = manifests.find((candidate) => candidate.id === `${rendererId}-caption-${styleId}`)
        expect(manifest, `${rendererId}:${styleId}`).toBeDefined()
        const resolved = resolveTemplateProps(manifest!, {})
        const style = resolveCaptionStyle(manifest!.id, resolved)
        expect(style.id).toBe(styleId)
        expect(style.fontFamily).toBe(CAPTION_STYLE_DEFINITIONS[styleId].fontFamily)
        expect(style.activeColor).toBe(CAPTION_STYLE_DEFINITIONS[styleId].activeColor)
        expect(style.maxWordsPerCue).toBe(CAPTION_STYLE_DEFINITIONS[styleId].maxWordsPerCue)
      }
    }
    const signatures = new Set(CAPTION_STYLE_IDS.map((id) => {
      const style = CAPTION_STYLE_DEFINITIONS[id]
      return [style.fontFamily, style.activeColor, style.activeTreatment, style.maxWordsPerCue].join('|')
    }))
    expect(signatures.size).toBe(CAPTION_STYLE_IDS.length)
  })

  it('derives aspect-safe metrics and fits a long unbroken word', () => {
    const style = CAPTION_STYLE_DEFINITIONS['coach-clean']
    const portrait = captionLayoutMetrics(style, 1080, 1920, [24])
    const fourFive = captionLayoutMetrics(style, 1080, 1350, [24])
    const square = captionLayoutMetrics(style, 1080, 1080, [24])
    const landscape = captionLayoutMetrics(style, 1920, 1080, [24])
    const longWord = captionLayoutMetrics(style, 1080, 1920, [60])

    expect(portrait.aspect).toBe('portrait')
    expect(fourFive.aspect).toBe('portrait')
    expect(square.aspect).toBe('square')
    expect(landscape.aspect).toBe('landscape')
    expect(portrait.bottomOffset).toBeGreaterThan(square.bottomOffset)
    expect(square.bottomOffset).toBeGreaterThan(landscape.bottomOffset)
    expect(portrait.maxWidth / 1080).toBeCloseTo(0.84, 2)
    expect(landscape.maxWidth / 1920).toBeCloseTo(0.78, 2)
    expect(longWord.fontSize).toBeLessThan(portrait.fontSize)
  })
})

describe('shared caption pages and timing', () => {
  it('creates deterministic explicit lines and keeps closing punctuation attached', () => {
    const words = timedWords(['One', 'clear', ',', 'That', 'is', 'wise.', 'Then', 'act', 'today.'])
    const options = {
      maxWordsPerCue: 3,
      maxCharactersPerCue: 22,
      maxCharactersPerLine: 11,
      maxLines: 2,
      maxDurationFrames: 80,
      maxGapFrames: 20,
      preferSentenceBreaks: true,
    }
    const first = groupCaptionCues(words, options)
    const second = groupCaptionCues(words, options)

    expect(second).toEqual(first)
    expect(first[0]!.text).toBe('One clear,')
    expect(first[0]!.lines.flatMap((line) => line.wordIds)).toEqual([
      'caption-word-1',
      'caption-word-2',
      'caption-word-3',
    ])
    expect(first.every((cue) => cue.lines.length <= 2)).toBe(true)
    expect(first.some((cue) => cue.text === 'That is wise.')).toBe(true)
  })

  it('places one long token on its own line instead of clipping or orphaning it', () => {
    const words = timedWords(['A', 'supercalifragilisticexpialidocious', 'lesson'])
    const lines = wrapCaptionLines(words.slice(0, 2), { maxCharactersPerLine: 12, maxLines: 2 })
    expect(lines).toEqual([
      { text: 'A', wordIds: ['caption-word-1'] },
      { text: 'supercalifragilisticexpialidocious', wordIds: ['caption-word-2'] },
    ])
    const cues = groupCaptionCues(words, {
      maxWordsPerCue: 5,
      maxCharactersPerCue: 60,
      maxCharactersPerLine: 12,
      maxLines: 2,
    })
    expect(cues.map((cue) => cue.text)).toEqual([
      'A supercalifragilisticexpialidocious',
      'lesson',
    ])
  })

  it('uses half-open active intervals and binary page lookup for seeking', () => {
    const word = timedWords(['focus'])[0]!
    expect(captionWordIsActive(word, -1)).toBe(false)
    expect(captionWordIsActive(word, 0)).toBe(true)
    expect(captionWordIsActive(word, 7)).toBe(true)
    expect(captionWordIsActive(word, 8)).toBe(false)
    expect(captionWordProgress(word, 0)).toBe(0)
    expect(captionWordProgress(word, 4)).toBe(0.5)
    expect(captionWordProgress(word, 8)).toBe(1)

    const cues = groupCaptionCues(timedWords(['one', 'two', 'three', 'four']), {
      maxWordsPerCue: 2,
    })
    expect(activeCaptionCue(cues, 0)?.id).toBe(cues[0]!.id)
    expect(activeCaptionCue(cues, 15)?.id).toBe(cues[0]!.id)
    expect(activeCaptionCue(cues, 16)?.id).toBe(cues[1]!.id)
    expect(activeCaptionCue(cues, 32)).toBeNull()
    expect(activeCaptionCue(cues, 4)?.id).toBe(activeCaptionCue(cues, 4)?.id)
  })

  it('finds the earliest active cue even when legacy cue intervals overlap', () => {
    const cue = (id: string, startFrame: number, endFrame: number): CaptionCue => ({
      id,
      startFrame,
      endFrame,
      text: id,
      wordIds: [`word-${id}`],
      importantWordIds: [],
      lines: [{ text: id, wordIds: [`word-${id}`] }],
    })
    const cues = [cue('long', 0, 100), cue('short', 10, 20), cue('later', 30, 40)]

    expect(activeCaptionCue(cues, 15)?.id).toBe('long')
    expect(activeCaptionCue(cues, 50)?.id).toBe('long')
    expect(activeCaptionCue(cues, 100)).toBeNull()
  })

  it('attaches distant closing punctuation without extending a cue past hard timing limits', () => {
    const words: CaptionWord[] = [
      { id: 'word-wait', text: 'Wait', startFrame: 0, endFrame: 10, importance: 0 },
      { id: 'word-bang', text: '!', startFrame: 1_000, endFrame: 1_010, importance: 0 },
      { id: 'word-now', text: 'Now', startFrame: 1_020, endFrame: 1_030, importance: 0 },
    ]
    const cues = groupCaptionCues(words, {
      maxDurationFrames: 90,
      maxGapFrames: 15,
      preferSentenceBreaks: false,
    })

    expect(cues[0]).toMatchObject({
      startFrame: 0,
      endFrame: 10,
      text: 'Wait!',
      wordIds: ['word-wait', 'word-bang'],
    })
    expect(cues[1]).toMatchObject({ startFrame: 1_020, endFrame: 1_030, text: 'Now' })
  })

  it('renders one-frame words fully active and derives valid readable color treatments', () => {
    const word: CaptionWord = {
      id: 'one-frame',
      text: 'Now',
      startFrame: 5,
      endFrame: 6,
      importance: 0,
    }
    expect(captionWordProgress(word, 5)).toBe(0)
    expect(captionWordRenderProgress(word, 5)).toBe(1)
    expect(hexColorWithAlpha('#12345678', 0.6)).toBe('#12345699')
    expect(readableTextColor('#E6FF38')).toBe('#07090D')
    expect(readableTextColor('#A78BFA')).toBe('#07090D')
    expect(readableTextColor('#05070D')).toBe('#FFFFFF')
    expect(readableTextColor('#FFFFFF10')).toBe('#FFFFFF')
  })

  it.each([24, 30, 60])('converts style timing to deterministic frame limits at %i FPS', (fps) => {
    const style = resolveCaptionStyle('remotion-caption-mindset-pill')
    const options = captionGroupingOptionsForStyle(style, fps)
    expect(options.maxDurationFrames).toBe(Math.round(style.maxDurationSeconds * fps))
    expect(options.maxGapFrames).toBe(Math.round(style.maxGapSeconds * fps))
    expect(options.maxCharactersPerCue).toBe(style.maxCharactersPerLine * style.maxLines)
  })
})

describe('caption timestamp normalization', () => {
  it('repairs missing and overlapping transcript boundaries into one active word at a time', () => {
    const converted = captionWordsFromTranscript([
      { id: 'a', projectId: 'p', ord: 1, word: 'First', start: 0, end: 0.5, emphasis: false },
      { id: 'b', projectId: 'p', ord: 2, word: 'overlap', start: 0.4, end: 0.9, emphasis: true },
      { id: 'c', projectId: 'p', ord: 3, word: 'missing', start: Number.NaN, end: Number.NaN, emphasis: false },
      { id: 'd', projectId: 'p', ord: 4, word: 'known', start: 1.4, end: 1.8, emphasis: false },
    ], 30, 120)

    expect(converted.dropped).toBe(0)
    expect(converted.words).toHaveLength(4)
    for (let index = 0; index < converted.words.length; index += 1) {
      const word = converted.words[index]!
      expect(word.endFrame).toBeGreaterThan(word.startFrame)
      if (index > 0) expect(word.startFrame).toBeGreaterThanOrEqual(converted.words[index - 1]!.endFrame)
    }
    expect(converted.words[1]!.importance).toBe(2)
  })

  it('distributes phrase-timed SRT captions without overlapping rounded frames', () => {
    const words = captionWordsFromRemotionCaptions([
      {
        text: 'One extraordinary choice',
        startMs: 0,
        endMs: 1_000,
        timestampMs: null,
        confidence: null,
      },
    ], 30)
    expect(words.map((word) => word.text)).toEqual(['One', 'extraordinary', 'choice'])
    expect(words[0]!.startFrame).toBe(0)
    expect(words.at(-1)!.endFrame).toBe(30)
    for (let index = 1; index < words.length; index += 1) {
      expect(words[index]!.startFrame).toBe(words[index - 1]!.endFrame)
    }
  })

  it('rejects a phrase cue that cannot assign one positive frame per token', () => {
    expect(() => captionWordsFromRemotionCaptions([
      {
        text: 'too many words',
        startMs: 0,
        endMs: 50,
        timestampMs: null,
        confidence: null,
      },
    ], 30)).toThrow(/too short to assign 3 words/i)
  })
})

describe('HyperFrames caption parity', () => {
  it('keeps Active Pill Sweep words readable and activates a one-frame word immediately', () => {
    const base = createHyperframesSmokeProject()
    const project = VideoProjectSchema.parse({
      ...base,
      captions: createCaptionDocument({
        id: 'one-frame-captions',
        templateId: 'hyperframes-caption-clip-wipe',
        words: [{
          id: 'one-frame-word',
          text: 'Now',
          startFrame: 8,
          endFrame: 9,
          importance: 0,
        }],
      }),
    })
    const html = compileHyperframesProject(project).html

    expect(html).not.toContain(
      '.hf-caption-clip-wipe .hf-caption-word{padding:.1em .14em;clip-path:inset(0 100% 0 0)}',
    )
    expect(html).toContain('"kind":"set","elementId":"caption-word-one-frame-word"')
  })

  it.each(['hyperframes-caption-motivation-bold', 'hyperframes-caption-mindset-pill', 'hyperframes-caption-progress-underline', 'hyperframes-caption-coach-clean'])(
    'compiles %s with explicit lines, local fonts, and its shared recipe',
    (templateId) => {
      const base = createHyperframesSmokeProject()
      const manifest = BUILTIN_VIDEO_TEMPLATES.find((candidate) => candidate.id === templateId)!
      const props = resolveTemplateProps(manifest, {})
      const project = VideoProjectSchema.parse({
        ...base,
        captions: { ...base.captions!, templateId },
        scenes: base.scenes.map((scene) => scene.kind === 'caption'
          ? {
              ...scene,
              template: {
                id: templateId,
                version: manifest.version,
                rendererId: 'hyperframes',
                props,
              },
            }
          : scene),
      })
      const html = compileHyperframesProject(project).html
      const style = resolveCaptionStyle(templateId, props)

      expect(html).toContain(`data-caption-style="${style.id}"`)
      expect(html).toContain('class="hf-caption-line"')
      expect(html).toContain(style.activeColor)
      expect(html).toContain('hanken-grotesk-700.woff2')
      expect(html).toContain('jetbrains-mono-700.woff2')
      expect(html).not.toMatch(/https?:\/\//u)
    },
  )
})
