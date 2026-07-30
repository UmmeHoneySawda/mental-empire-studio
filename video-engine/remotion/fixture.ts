import {
  HookPlanSchema,
  VideoProjectSchema,
  createCaptionDocument,
  type VideoProject,
} from '../../shared/video-engine'

export interface RemotionFixtureOptions {
  readonly width?: number
  readonly height?: number
  readonly fps?: number
  readonly durationFrames?: number
}

/**
 * A dependency-free fixture for composition discovery and smoke renders. It
 * intentionally uses only trusted text/shape templates, so CI does not need
 * network access or fixture media files.
 */
export function createRemotionFixtureProject(
  options: RemotionFixtureOptions = {},
): VideoProject {
  const fps = options.fps ?? 30
  const durationFrames = Math.max(30, options.durationFrames ?? fps * 3)
  const midpoint = Math.max(1, Math.floor(durationFrames / 2))
  const createdAt = '2026-01-01T00:00:00.000Z'
  const captions = createCaptionDocument({
    id: 'fixture-captions',
    language: 'en',
    templateId: 'remotion-caption-highlight',
    words: [
      {
        id: 'word-attention',
        text: 'Attention',
        startFrame: 2,
        endFrame: Math.max(3, Math.floor(midpoint * 0.45)),
        importance: 3,
      },
      {
        id: 'word-changes',
        text: 'changes',
        startFrame: Math.max(3, Math.floor(midpoint * 0.45)),
        endFrame: midpoint,
        importance: 0,
      },
      {
        id: 'word-everything',
        text: 'everything',
        startFrame: midpoint,
        endFrame: Math.max(midpoint + 1, Math.floor(durationFrames * 0.76)),
        importance: 2,
      },
      {
        id: 'word-now',
        text: 'now.',
        startFrame: Math.max(midpoint + 1, Math.floor(durationFrames * 0.76)),
        endFrame: durationFrames,
        importance: 1,
      },
    ],
  })
  const hookPlan = HookPlanSchema.parse({
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: 'hook-intro-kinetic',
    templateVersion: '1.0.0',
    fps,
    title: 'Remotion smoke hook',
    durationFrames,
    beats: [
      {
        id: 'beat-one',
        startFrame: 0,
        durationFrames: midpoint,
        headline: 'Attention changes everything',
        body: 'A safe, data-driven hook template.',
        variant: 'urgent',
        importantWordIds: ['beat-one:headline:0'],
        visual: { kind: 'none' },
        transitionOut: {
          type: 'fade',
          durationFrames: Math.min(
            Math.max(1, Math.round(fps * 0.25)),
            midpoint,
          ),
          easing: 'ease-in-out',
        },
      },
      {
        id: 'beat-two',
        startFrame: midpoint,
        durationFrames: durationFrames - midpoint,
        headline: 'Everything starts now',
        body: 'Captions track speech and semantic emphasis.',
        variant: 'cinematic',
        importantWordIds: ['beat-two:headline:0', 'beat-two:headline:2'],
        visual: { kind: 'none' },
      },
    ],
  })

  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: 'remotion-smoke-project',
    name: 'Remotion smoke project',
    revision: 0,
    rendererId: 'remotion',
    createdAt,
    updatedAt: createdAt,
    canvas: {
      width: options.width ?? 1280,
      height: options.height ?? 720,
      fps,
      durationFrames,
      backgroundColor: '#07090D',
    },
    assets: [],
    tracks: [
      {
        id: 'hook-track',
        name: 'Hook',
        kind: 'overlay',
        order: 0,
        muted: false,
        locked: false,
      },
      {
        id: 'caption-track',
        name: 'Captions',
        kind: 'caption',
        order: 100,
        muted: false,
        locked: false,
      },
    ],
    scenes: [
      {
        id: 'hook-scene',
        trackId: 'hook-track',
        kind: 'template',
        startFrame: 0,
        durationFrames,
        zIndex: 0,
        template: {
          id: 'hook-intro-kinetic',
          version: '1.0.0',
          rendererId: 'remotion',
          props: { hookPlan },
        },
      },
      {
        id: 'caption-scene',
        trackId: 'caption-track',
        kind: 'caption',
        startFrame: 0,
        durationFrames,
        zIndex: 0,
        template: {
          id: 'remotion-caption-highlight',
          version: '1.0.0',
          rendererId: 'remotion',
          props: {
            fontFamily: 'Hanken Grotesk',
            textColor: '#FFFFFF',
            activeColor: '#E6FF38',
            importantColor: '#FF5A45',
            maxWordsPerCue: 6,
          },
        },
      },
    ],
    captions,
    transitions: [],
    grading: {
      enabled: false,
      lutIntensity: 1,
      exposure: 0,
      contrast: 0,
      saturation: 1,
      temperature: 0,
      tint: 0,
      vignette: 0,
      grain: 0,
    },
    metadata: {
      description: 'Offline fixture for the Remotion renderer adapter.',
      templateId: 'hook-intro-kinetic',
      templateVersion: '1.0.0',
    },
  })
}
