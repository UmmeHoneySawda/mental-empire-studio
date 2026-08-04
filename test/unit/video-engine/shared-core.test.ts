import { describe, expect, it } from 'vitest'
import {
  BrollLicenseMetadataSchema,
  CaptionWord,
  HookPlan,
  TemplateManifest,
  TemplateManifestSchema,
  TemplateRegistry,
  VideoProject,
  VideoProjectSchema,
  buildImportantWordsPrompt,
  createCaptionDocument,
  createEmptyVideoProject,
  groupCaptionCues,
  importImportantWords,
  migrateVideoProject,
  parseHookPlan,
  parseImportantWordsResponse,
  parseVideoProject,
  safeParseVideoProject,
  stableTranscriptHash,
} from '@shared/video-engine'

const NOW = '2026-07-30T10:00:00.000Z'

function transcriptWords(count = 10): CaptionWord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `word-${index + 1}`,
    text: `word${index + 1}`,
    startFrame: index * 12,
    endFrame: index * 12 + 10,
  }))
}

function completeProject(): VideoProject {
  const empty = createEmptyVideoProject({
    id: 'project-1',
    name: 'Shared core fixture',
    rendererId: 'remotion',
    width: 1920,
    height: 1080,
    fps: 30,
    durationFrames: 600,
    now: NOW,
  })
  const captions = createCaptionDocument({
    id: 'captions-1',
    language: 'en',
    templateId: 'caption.bold',
    words: [
      { id: 'word-one', text: 'Start', startFrame: 0, endFrame: 12 },
      { id: 'word-two', text: 'strong.', startFrame: 13, endFrame: 28, importance: 3 },
    ],
  })
  return VideoProjectSchema.parse({
    ...empty,
    revision: 4,
    assets: [
      {
        id: 'asset-video',
        name: 'Opening footage',
        kind: 'video',
        uri: 'media/opening.mp4',
        mimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationFrames: 600,
        source: { kind: 'local' },
      },
      {
        id: 'asset-lut',
        name: 'Cinematic LUT',
        kind: 'lut',
        uri: 'looks/cinematic.cube',
        source: { kind: 'local' },
      },
    ],
    tracks: [
      { id: 'track-video', name: 'Video', kind: 'video', order: 0, muted: false, locked: false },
      {
        id: 'track-captions',
        name: 'Captions',
        kind: 'caption',
        order: 1,
        muted: false,
        locked: false,
      },
    ],
    scenes: [
      {
        id: 'scene-opening',
        trackId: 'track-video',
        kind: 'media',
        startFrame: 0,
        durationFrames: 300,
        zIndex: 0,
        assetId: 'asset-video',
        sourceRange: { startFrame: 0, durationFrames: 300 },
        fit: 'cover',
      },
      {
        id: 'scene-closing',
        trackId: 'track-video',
        kind: 'solid',
        startFrame: 300,
        durationFrames: 300,
        zIndex: 0,
        color: '#090B12',
      },
      {
        id: 'scene-captions',
        trackId: 'track-captions',
        kind: 'caption',
        startFrame: 0,
        durationFrames: 600,
        zIndex: 10,
      },
    ],
    captions,
    transitions: [
      {
        id: 'transition-main',
        fromSceneId: 'scene-opening',
        toSceneId: 'scene-closing',
        startFrame: 285,
        durationFrames: 15,
        type: 'fade',
        easing: 'ease-in-out',
      },
    ],
    grading: {
      enabled: true,
      lutAssetId: 'asset-lut',
      lutIntensity: 0.75,
      exposure: 0.1,
      contrast: 0.15,
      saturation: 1.05,
      temperature: -0.05,
      tint: 0.02,
      vignette: 0.2,
      grain: 0.08,
    },
    metadata: {
      description: 'Round-trip fixture',
      tags: ['hook', 'cinematic'],
      templateId: 'hook.basic',
      templateVersion: '1.0.0',
    },
  })
}

function validHookPlan(): HookPlan {
  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: 'hook.basic',
    templateVersion: '1.0.0',
    fps: 30,
    title: 'Thirty-second hook',
    durationFrames: 900,
    props: { accent: '#FFCC00' },
    beats: [
      {
        id: 'beat-1',
        startFrame: 0,
        durationFrames: 300,
        headline: 'Open with tension',
        visual: { kind: 'none' },
        transitionOut: { type: 'fade', durationFrames: 15, easing: 'ease-out' },
      },
      {
        id: 'beat-2',
        startFrame: 300,
        durationFrames: 300,
        headline: 'Escalate',
        visual: { kind: 'broll', searchQuery: 'storm clouds over a city' },
      },
      {
        id: 'beat-3',
        startFrame: 600,
        durationFrames: 300,
        headline: 'Promise the payoff',
        visual: { kind: 'asset', assetId: 'asset-video' },
      },
    ],
  }
}

function templateManifest(input: {
  id?: string
  version?: string
  rendererId?: 'remotion' | 'hyperframes'
  kind?: 'hook' | 'caption' | 'transition' | 'scene' | 'overlay'
  capabilities?: Array<
    | 'audio'
    | 'broll'
    | 'captions'
    | 'dynamic-duration'
    | 'lut-grading'
    | 'transparent-background'
    | 'transitions'
    | 'word-highlighting'
  >
  aspectRatios?: Array<'16:9' | '9:16' | '1:1' | '4:5' | 'custom'>
} = {}): TemplateManifest {
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: input.id ?? 'hook.basic',
    version: input.version ?? '1.0.0',
    rendererId: input.rendererId ?? 'remotion',
    kind: input.kind ?? 'hook',
    name: `${input.id ?? 'hook.basic'} ${input.version ?? '1.0.0'}`,
    implementationId: `${input.id ?? 'hook.basic'}.implementation`,
    aspectRatios: input.aspectRatios ?? ['16:9'],
    duration: { minimumFrames: 30, maximumFrames: 900, defaultFrames: 300 },
    capabilities: input.capabilities ?? ['broll', 'transitions'],
    parameters: [
      {
        key: 'headline',
        label: 'Headline',
        type: 'string',
        required: true,
        maxLength: 100,
      },
      {
        key: 'accent',
        label: 'Accent',
        type: 'color',
        required: false,
        default: '#FFCC00',
      },
    ],
  })
}

describe('renderer-neutral project schema and migration', () => {
  it('round-trips a complete v1 project through JSON without losing data', () => {
    const project = completeProject()
    const parsed = parseVideoProject(JSON.stringify(project))

    expect(parsed).toEqual(project)
    expect(safeParseVideoProject(parsed)).toEqual({ success: true, data: project })
  })

  it('migrates the strict pre-versioned shape to schema version 1', () => {
    const { schemaVersion: _schemaVersion, ...versionZero } = completeProject()
    const migrated = migrateVideoProject(versionZero)

    expect(migrated.schemaVersion).toBe(1)
    expect(migrated.id).toBe('project-1')
    expect(migrated).toEqual({ ...versionZero, schemaVersion: 1 })
  })

  it('rejects future schema versions', () => {
    expect(() =>
      parseVideoProject({ ...completeProject(), schemaVersion: 2 }),
    ).toThrow(/unsupported future video project schema version/i)
  })

  it('rejects unknown fields at both project and nested object boundaries', () => {
    expect(() =>
      parseVideoProject({ ...completeProject(), unexpectedRootField: true }),
    ).toThrow()
    expect(() =>
      parseVideoProject({
        ...completeProject(),
        canvas: { ...completeProject().canvas, unexpectedCanvasField: true },
      }),
    ).toThrow()
  })

  it.each(['../outside', 'track/../../escape', '.hidden', 'bad id'])(
    'rejects traversal-like or unstable project ID %s',
    (id) => {
      const result = safeParseVideoProject({ ...completeProject(), id })
      expect(result.success).toBe(false)
    },
  )

  it('validates stock attribution metadata without permitting unknown keys', () => {
    expect(
      BrollLicenseMetadataSchema.parse({
        provider: 'pexels',
        providerAssetId: '12345',
        sourceUrl: 'https://www.pexels.com/video/12345/',
        licenseName: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
        author: 'Creator',
      }),
    ).toMatchObject({ provider: 'pexels', providerAssetId: '12345' })

    expect(() =>
      BrollLicenseMetadataSchema.parse({
        provider: 'pexels',
        providerAssetId: '12345',
        sourceUrl: 'https://www.pexels.com/video/12345/',
        licenseName: 'Pexels License',
        executable: 'do-something',
      }),
    ).toThrow()
  })
})

describe('hook plan validation', () => {
  it('accepts exactly 30 seconds at the declared frame rate', () => {
    expect(parseHookPlan(validHookPlan())).toEqual(validHookPlan())
  })

  it('rejects plans longer than 30 seconds', () => {
    expect(() =>
      parseHookPlan({ ...validHookPlan(), durationFrames: 901 }),
    ).toThrow(/cannot exceed 30 seconds/i)
  })

  it('rejects out-of-order and overlapping beats', () => {
    const plan = validHookPlan()
    plan.beats[1] = { ...plan.beats[1]!, startFrame: 299 }

    expect(() => parseHookPlan(plan)).toThrow(/ordered and cannot overlap/i)
  })

  it('rejects unknown structured fields', () => {
    expect(() =>
      parseHookPlan({ ...validHookPlan(), arbitraryInstruction: 'ignore validation' }),
    ).toThrow()
  })

  it.each([
    { props: { script: 'alert(1)' } },
    { props: { nested: { sourceCode: 'export default function X() {}' } } },
    { props: { command: 'ffmpeg -i input output' } },
  ])('rejects code-like fields anywhere in AI payload data', (patch) => {
    expect(() => parseHookPlan({ ...validHookPlan(), ...patch })).toThrow(
      /forbidden code-like field/i,
    )
  })
})

describe('caption grouping and important-word import', () => {
  it('groups captions deterministically by word count, punctuation, duration, and gaps', () => {
    const words: CaptionWord[] = [
      { id: 'w-1', text: 'One', startFrame: 0, endFrame: 8 },
      { id: 'w-2', text: 'two,', startFrame: 9, endFrame: 18, importance: 2 },
      { id: 'w-3', text: 'three', startFrame: 19, endFrame: 29 },
      { id: 'w-4', text: 'after', startFrame: 80, endFrame: 90 },
      { id: 'w-5', text: 'gap.', startFrame: 91, endFrame: 100 },
    ]
    const document = createCaptionDocument({ id: 'caption-deterministic', words })
    const options = {
      maxWordsPerCue: 3,
      maxCharactersPerCue: 30,
      maxDurationFrames: 60,
      maxGapFrames: 10,
    }

    const first = groupCaptionCues(document, options)
    const second = groupCaptionCues(document, options)

    expect(second).toEqual(first)
    expect(first.map((cue) => cue.text)).toEqual(['One two, three', 'after gap.'])
    expect(first[0]!.importantWordIds).toEqual(['w-2'])
    expect(first.every((cue) => /^cue:[0-9a-f]{16}$/.test(cue.id))).toBe(true)
  })

  it('produces a stable transcript hash that ignores emphasis but changes with transcript data', () => {
    const words = transcriptWords(3)
    const original = stableTranscriptHash(words)
    const emphasized = stableTranscriptHash(
      words.map((word, index) => ({ ...word, importance: index === 0 ? (3 as const) : undefined })),
    )
    const edited = stableTranscriptHash(
      words.map((word, index) => (index === 0 ? { ...word, text: 'edited' } : word)),
    )

    expect(emphasized).toBe(original)
    expect(edited).not.toBe(original)
  })

  it('builds a prompt containing the stable hash and exact word IDs', () => {
    const document = createCaptionDocument({ id: 'caption-prompt', words: transcriptWords(3) })
    const prompt = buildImportantWordsPrompt(document)

    expect(prompt).toContain(document.transcriptHash)
    expect(prompt).toContain('"id":"word-1"')
    expect(prompt).toContain('Return JSON only')
  })

  it('imports valid selections and clears previous emphasis by default', () => {
    const document = createCaptionDocument({
      id: 'caption-import',
      words: transcriptWords(5).map((word, index) => ({
        ...word,
        importance: index === 0 ? (1 as const) : undefined,
      })),
    })
    const imported = importImportantWords(
      {
        schemaVersion: 1,
        transcriptHash: document.transcriptHash,
        selections: [{ wordId: 'word-2', weight: 3 }],
      },
      document,
      { maximumSelectionRatio: 0.5 },
    )

    expect(imported.words[0]!.importance).toBe(0)
    expect(imported.words[1]!.importance).toBe(3)
  })

  it('rejects a stale transcript hash', () => {
    const document = createCaptionDocument({ id: 'caption-stale', words: transcriptWords(5) })

    expect(() =>
      importImportantWords(
        {
          schemaVersion: 1,
          transcriptHash: 'fnv1a64:0000000000000000',
          selections: [{ wordId: 'word-1', weight: 2 }],
        },
        document,
      ),
    ).toThrow(/different or stale transcript/i)
  })

  it('rejects unknown word IDs', () => {
    const document = createCaptionDocument({ id: 'caption-unknown', words: transcriptWords(5) })

    expect(() =>
      importImportantWords(
        {
          schemaVersion: 1,
          transcriptHash: document.transcriptHash,
          selections: [{ wordId: 'word-does-not-exist', weight: 2 }],
        },
        document,
      ),
    ).toThrow(/unknown word id/i)
  })

  it('rejects duplicate word IDs before import', () => {
    const document = createCaptionDocument({ id: 'caption-duplicates', words: transcriptWords(5) })
    const response = {
      schemaVersion: 1,
      transcriptHash: document.transcriptHash,
      selections: [
        { wordId: 'word-1', weight: 1 },
        { wordId: 'word-1', weight: 3 },
      ],
    }

    expect(() => parseImportantWordsResponse(response)).toThrow(/duplicate word ids/i)
  })

  it('enforces both ratio and absolute selection limits', () => {
    const document = createCaptionDocument({ id: 'caption-limit', words: transcriptWords(10) })
    const selections = ['word-1', 'word-2', 'word-3'].map((wordId) => ({
      wordId,
      weight: 2,
    }))

    expect(() =>
      importImportantWords(
        { schemaVersion: 1, transcriptHash: document.transcriptHash, selections },
        document,
        { maximumSelectionRatio: 0.2 },
      ),
    ).toThrow(/selection limit of 2/i)

    expect(() =>
      importImportantWords(
        { schemaVersion: 1, transcriptHash: document.transcriptHash, selections },
        document,
        { maximumSelectionRatio: 1, maximumSelections: 2 },
      ),
    ).toThrow(/selection limit of 2/i)
  })
})

describe('template registry', () => {
  it('filters by renderer, kind, aspect ratio, and required capabilities', () => {
    const remotionHook = templateManifest()
    const remotionCaption = templateManifest({
      id: 'caption.bold',
      kind: 'caption',
      capabilities: ['captions', 'word-highlighting'],
      aspectRatios: ['16:9', '9:16'],
    })
    const hyperframesHook = templateManifest({
      id: 'hook.hyper',
      rendererId: 'hyperframes',
      capabilities: ['broll', 'transitions'],
    })
    const registry = new TemplateRegistry([remotionHook, remotionCaption, hyperframesHook])

    expect(registry.list({ rendererId: 'remotion', kind: 'hook' })).toEqual([remotionHook])
    expect(
      registry.list({
        rendererId: 'remotion',
        kind: 'caption',
        aspectRatio: '9:16',
        capabilities: ['word-highlighting'],
      }),
    ).toEqual([remotionCaption])
    expect(registry.list({ rendererId: 'hyperframes' })).toEqual([hyperframesHook])
  })

  it('rejects duplicate template ID/version registrations', () => {
    const manifest = templateManifest()
    const registry = new TemplateRegistry([manifest])

    expect(() => registry.register(manifest)).toThrow(/already registered/i)
  })

  it('resolves the newest numeric semantic version unless a version is requested', () => {
    const v120 = templateManifest({ version: '1.2.0' })
    const v1100 = templateManifest({ version: '1.10.0' })
    const v200 = templateManifest({ version: '2.0.0' })
    const registry = new TemplateRegistry([v120, v1100, v200])

    expect(registry.get('hook.basic')?.version).toBe('2.0.0')
    expect(registry.get('hook.basic', '1.10.0')).toEqual(v1100)
  })

  it('instantiates defaults into a strict template scene', () => {
    const registry = new TemplateRegistry([templateManifest()])
    const result = registry.instantiate({
      templateId: 'hook.basic',
      instanceId: 'scene-template',
      trackId: 'track-overlay',
      startFrame: 10,
      props: { headline: 'A sharp opening' },
    })

    expect(result.scene).toMatchObject({
      id: 'scene-template',
      kind: 'template',
      startFrame: 10,
      durationFrames: 300,
      template: {
        id: 'hook.basic',
        version: '1.0.0',
        rendererId: 'remotion',
        props: { headline: 'A sharp opening', accent: '#FFCC00' },
      },
    })
  })

  it('rejects unknown and missing required template properties', () => {
    const registry = new TemplateRegistry([templateManifest()])

    expect(() =>
      registry.instantiate({
        templateId: 'hook.basic',
        instanceId: 'scene-unknown-prop',
        trackId: 'track-overlay',
        startFrame: 0,
        props: { headline: 'Valid', notDeclared: true },
      }),
    ).toThrow(/unknown template property/i)

    expect(() =>
      registry.instantiate({
        templateId: 'hook.basic',
        instanceId: 'scene-missing-prop',
        trackId: 'track-overlay',
        startFrame: 0,
      }),
    ).toThrow(/missing required template property/i)
  })

  it.each([29, 901])('rejects an out-of-range duration of %i frames', (durationFrames) => {
    const registry = new TemplateRegistry([templateManifest()])

    expect(() =>
      registry.instantiate({
        templateId: 'hook.basic',
        instanceId: `scene-duration-${durationFrames}`,
        trackId: 'track-overlay',
        startFrame: 0,
        durationFrames,
        props: { headline: 'Duration check' },
      }),
    ).toThrow(/between 30 and 900 frames/i)
  })

  it('automatically clamps transition duration when it exceeds connected scene duration', () => {
    const base = completeProject()
    const projectWithOverlongTransition = {
      ...base,
      scenes: [
        { id: 'scene-1', trackId: base.tracks[0].id, assetId: 'asset-video', startFrame: 0, durationFrames: 15, kind: 'media' as const, zIndex: 0 },
        { id: 'scene-2', trackId: base.tracks[0].id, assetId: 'asset-video', startFrame: 15, durationFrames: 60, kind: 'media' as const, zIndex: 0 },
      ],
      transitions: [
        {
          id: 'trans-1-2',
          fromSceneId: 'scene-1',
          toSceneId: 'scene-2',
          startFrame: 0,
          durationFrames: 30, // Exceeds scene-1 duration (15 frames)
          type: 'fade' as const,
        },
      ],
    }

    const parsed = parseVideoProject(projectWithOverlongTransition)
    expect(parsed.transitions[0].durationFrames).toBe(15)
  })
})
