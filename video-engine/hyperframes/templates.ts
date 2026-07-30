import {
  HookPlanSchema,
  TemplateManifestSchema,
  assertDataOnlyAiPayload,
  parseJsonInput,
  type HookPlan,
  type JsonObject,
  type TemplateManifest,
  type TemplateReference,
} from '../../shared/video-engine'

export const HYPERFRAMES_TEMPLATE_VERSION = '1.0.0'

export const HYPERFRAMES_HOOK_TEMPLATE_IDS = [
  'hyperframes-hook-kinetic-30',
  'hyperframes-hook-cinematic-30',
  'hook-kinetic',
  'hook-editorial',
  'hook-cinematic',
] as const

export const HYPERFRAMES_SCENE_TEMPLATE_IDS = [
  'scene-title-card',
  'scene-stat-card',
  'scene-quote-card',
] as const

export const HYPERFRAMES_CAPTION_TEMPLATE_IDS = [
  'hyperframes-caption-emoji-pop',
  'hyperframes-caption-clip-wipe',
  'hyperframes-caption-highlight',
  'hyperframes-caption-neon-accent',
  'hyperframes-caption-particle-burst',
  'hyperframes-caption-weight-shift',
  'caption-clean',
  'caption-karaoke',
  'caption-punch',
] as const

export const HYPERFRAMES_TRANSITION_TEMPLATE_IDS = [
  'transition-cut',
  'transition-fade',
  'transition-slide',
  'transition-wipe',
  'transition-zoom',
  'transition-blur',
  'transition-dip-to-black',
] as const

export type HyperframesHookTemplateId = (typeof HYPERFRAMES_HOOK_TEMPLATE_IDS)[number]
export type HyperframesSceneTemplateId = (typeof HYPERFRAMES_SCENE_TEMPLATE_IDS)[number]
export type HyperframesCaptionTemplateId =
  (typeof HYPERFRAMES_CAPTION_TEMPLATE_IDS)[number]
export type HyperframesTransitionTemplateId =
  (typeof HYPERFRAMES_TRANSITION_TEMPLATE_IDS)[number]
export type HyperframesVisualTemplateId =
  | HyperframesHookTemplateId
  | HyperframesSceneTemplateId
export type HyperframesHookStyle = 'kinetic' | 'editorial' | 'cinematic'
export type HyperframesCaptionStyle =
  | 'emoji-pop'
  | 'clip-wipe'
  | 'highlight'
  | 'neon-accent'
  | 'particle-burst'
  | 'weight-shift'

const allHookIds = new Set<string>(HYPERFRAMES_HOOK_TEMPLATE_IDS)
const allSceneIds = new Set<string>(HYPERFRAMES_SCENE_TEMPLATE_IDS)
const allCaptionIds = new Set<string>(HYPERFRAMES_CAPTION_TEMPLATE_IDS)

export function isHyperframesHookTemplateId(value: string): value is HyperframesHookTemplateId {
  return allHookIds.has(value)
}

export function isHyperframesSceneTemplateId(
  value: string,
): value is HyperframesSceneTemplateId {
  return allSceneIds.has(value)
}

export function isHyperframesCaptionTemplateId(
  value: string,
): value is HyperframesCaptionTemplateId {
  return allCaptionIds.has(value)
}

export function hyperframesHookStyle(
  templateId: HyperframesHookTemplateId,
): HyperframesHookStyle {
  if (
    templateId === 'hyperframes-hook-cinematic-30' ||
    templateId === 'hook-cinematic'
  ) {
    return 'cinematic'
  }
  if (templateId === 'hook-editorial') return 'editorial'
  return 'kinetic'
}

export function hyperframesCaptionStyle(
  templateId: HyperframesCaptionTemplateId,
): HyperframesCaptionStyle {
  switch (templateId) {
    case 'hyperframes-caption-emoji-pop':
      return 'emoji-pop'
    case 'hyperframes-caption-clip-wipe':
    case 'caption-karaoke':
      return 'clip-wipe'
    case 'hyperframes-caption-neon-accent':
      return 'neon-accent'
    case 'hyperframes-caption-particle-burst':
      return 'particle-burst'
    case 'hyperframes-caption-weight-shift':
    case 'caption-punch':
      return 'weight-shift'
    case 'hyperframes-caption-highlight':
    case 'caption-clean':
      return 'highlight'
  }
}

const commonVisualParameters = [
  {
    key: 'accent',
    label: 'Accent',
    type: 'color',
    default: '#FFD166',
    required: false,
  },
  {
    key: 'background',
    label: 'Background',
    type: 'color',
    default: '#090B10',
    required: false,
  },
  {
    key: 'textColor',
    label: 'Text color',
    type: 'color',
    default: '#FFFFFF',
    required: false,
  },
  {
    key: 'fontAssetId',
    label: 'Custom font',
    type: 'asset',
    acceptedKinds: ['font'],
    required: false,
  },
] as const

const canonicalHookParameters = [
  {
    key: 'headline',
    label: 'Headline',
    type: 'string',
    default: 'A stronger opening starts here.',
    maxLength: 180,
    required: true,
  },
  {
    key: 'subheadline',
    label: 'Subheadline',
    type: 'string',
    default: '',
    maxLength: 280,
    required: false,
  },
  {
    key: 'accentColor',
    label: 'Accent color',
    type: 'color',
    default: '#F8E71C',
    required: false,
  },
  {
    key: 'backgroundColor',
    label: 'Background color',
    type: 'color',
    default: '#080808',
    required: false,
  },
  {
    key: 'energy',
    label: 'Motion energy',
    type: 'enum',
    values: ['restrained', 'balanced', 'intense'],
    default: 'balanced',
    required: false,
  },
] as const

const hookManifests = HYPERFRAMES_HOOK_TEMPLATE_IDS.map((id) =>
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id,
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'hook',
    name:
      id === 'hyperframes-hook-kinetic-30'
        ? '30s Kinetic Hook'
        : id === 'hyperframes-hook-cinematic-30'
          ? '30s Cinematic Hook'
          : id === 'hook-kinetic'
        ? 'Kinetic Hook'
        : id === 'hook-editorial'
          ? 'Editorial Hook'
          : 'Cinematic Hook',
    description: 'Trusted, data-driven hook motion graphics with timed beats.',
    implementationId: id,
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 7200, defaultFrames: 900 },
    capabilities: ['broll', 'dynamic-duration', 'transitions'],
    parameters: id.startsWith('hyperframes-hook-')
      ? canonicalHookParameters
      : [
          {
            key: 'eyebrow',
            label: 'Eyebrow',
            type: 'string',
            default: 'WATCH THIS',
            maxLength: 120,
            required: false,
          },
          {
            key: 'headline',
            label: 'Headline',
            type: 'string',
            default: 'A stronger opening starts here.',
            maxLength: 500,
            required: false,
          },
          {
            key: 'body',
            label: 'Body',
            type: 'string',
            default: '',
            maxLength: 2000,
            required: false,
          },
          ...commonVisualParameters,
          {
            key: 'assetId',
            label: 'Background asset',
            type: 'asset',
            acceptedKinds: ['video', 'image'],
            required: false,
          },
          {
            key: 'showGrid',
            label: 'Show grid',
            type: 'boolean',
            default: true,
            required: false,
          },
        ],
    tags: ['hook', 'intro', 'motion-graphics'],
  }),
)

const sceneManifests = [
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: 'scene-title-card',
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'scene',
    name: 'Title Card',
    description: 'Bold title and supporting copy.',
    implementationId: 'scene-title-card',
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 100_000, defaultFrames: 150 },
    capabilities: ['dynamic-duration'],
    parameters: [
      {
        key: 'eyebrow',
        label: 'Eyebrow',
        type: 'string',
        default: '',
        maxLength: 120,
        required: false,
      },
      {
        key: 'headline',
        label: 'Headline',
        type: 'string',
        default: 'Title',
        maxLength: 500,
        required: false,
      },
      {
        key: 'body',
        label: 'Body',
        type: 'string',
        default: '',
        maxLength: 2000,
        required: false,
      },
      ...commonVisualParameters,
      {
        key: 'assetId',
        label: 'Background asset',
        type: 'asset',
        acceptedKinds: ['video', 'image'],
        required: false,
      },
    ],
    tags: ['title', 'typography'],
  }),
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: 'scene-stat-card',
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'scene',
    name: 'Stat Card',
    description: 'A large statistic with a supporting label.',
    implementationId: 'scene-stat-card',
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 100_000, defaultFrames: 120 },
    capabilities: ['dynamic-duration'],
    parameters: [
      {
        key: 'value',
        label: 'Value',
        type: 'string',
        default: '10×',
        maxLength: 80,
        required: false,
      },
      {
        key: 'label',
        label: 'Label',
        type: 'string',
        default: 'THE RESULT',
        maxLength: 240,
        required: false,
      },
      {
        key: 'body',
        label: 'Body',
        type: 'string',
        default: '',
        maxLength: 1000,
        required: false,
      },
      ...commonVisualParameters,
    ],
    tags: ['stat', 'number', 'typography'],
  }),
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: 'scene-quote-card',
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'scene',
    name: 'Quote Card',
    description: 'Editorial quote and attribution.',
    implementationId: 'scene-quote-card',
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 100_000, defaultFrames: 180 },
    capabilities: ['dynamic-duration'],
    parameters: [
      {
        key: 'quote',
        label: 'Quote',
        type: 'string',
        default: 'Make the first seconds impossible to ignore.',
        maxLength: 1000,
        required: false,
      },
      {
        key: 'attribution',
        label: 'Attribution',
        type: 'string',
        default: '',
        maxLength: 240,
        required: false,
      },
      ...commonVisualParameters,
    ],
    tags: ['quote', 'editorial', 'typography'],
  }),
]

const captionManifests = HYPERFRAMES_CAPTION_TEMPLATE_IDS.map((id) =>
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id,
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'caption',
    name:
      id === 'hyperframes-caption-emoji-pop'
        ? 'Emoji Pop'
        : id === 'hyperframes-caption-clip-wipe'
          ? 'Clip Wipe'
          : id === 'hyperframes-caption-highlight'
            ? 'Active Highlight'
            : id === 'hyperframes-caption-neon-accent'
              ? 'Neon Accent'
              : id === 'hyperframes-caption-particle-burst'
                ? 'Particle Burst'
                : id === 'hyperframes-caption-weight-shift'
                  ? 'Weight Shift'
                  : id === 'caption-clean'
                    ? 'Clean Captions'
                    : id === 'caption-karaoke'
                      ? 'Karaoke Captions'
                      : 'Punch Captions',
    description: 'Word-timed captions with optional important-word emphasis.',
    implementationId: id,
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 1_000_000, defaultFrames: 90 },
    capabilities: ['captions', 'dynamic-duration', 'word-highlighting'],
    parameters: [
      {
        key: 'accent',
        label: 'Accent',
        type: 'color',
        default: '#FFD166',
        required: false,
      },
      {
        key: 'textColor',
        label: 'Text color',
        type: 'color',
        default: '#FFFFFF',
        required: false,
      },
    ],
    tags: ['captions', 'subtitles', 'word-highlighting'],
  }),
)

const transitionNames: Record<(typeof HYPERFRAMES_TRANSITION_TEMPLATE_IDS)[number], string> = {
  'transition-cut': 'Cut',
  'transition-fade': 'Fade',
  'transition-slide': 'Slide',
  'transition-wipe': 'Wipe',
  'transition-zoom': 'Zoom',
  'transition-blur': 'Blur',
  'transition-dip-to-black': 'Dip to Black',
}

const transitionManifests = HYPERFRAMES_TRANSITION_TEMPLATE_IDS.map((id) =>
  TemplateManifestSchema.parse({
    schemaVersion: 1,
    id,
    version: HYPERFRAMES_TEMPLATE_VERSION,
    rendererId: 'hyperframes',
    kind: 'transition',
    name: transitionNames[id],
    description: 'Seek-safe transition implemented with trusted GSAP properties.',
    implementationId: id,
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: { minimumFrames: 1, maximumFrames: 600, defaultFrames: 15 },
    capabilities: ['transitions'],
    parameters: [],
    tags: ['transition'],
  }),
)

export const HYPERFRAMES_TEMPLATE_MANIFESTS: readonly TemplateManifest[] = Object.freeze([
  ...hookManifests,
  ...sceneManifests,
  ...captionManifests,
  ...transitionManifests,
])

const manifestsByKey = new Map(
  HYPERFRAMES_TEMPLATE_MANIFESTS.map((manifest) => [
    `${manifest.id}@${manifest.version}`,
    manifest,
  ]),
)

export function getHyperframesTemplateManifest(
  id: string,
  version = HYPERFRAMES_TEMPLATE_VERSION,
): TemplateManifest | undefined {
  return manifestsByKey.get(`${id}@${version}`)
}

const COMMON_VISUAL_KEYS = new Set([
  'accent',
  'accentColor',
  'background',
  'backgroundColor',
  'textColor',
  'fontAssetId',
])

const HOOK_VISUAL_KEYS = new Set([
  ...COMMON_VISUAL_KEYS,
  'hookPlan',
  'hookPlanJson',
  'eyebrow',
  'headline',
  'body',
  'subheadline',
  'assetId',
  'showGrid',
  'energy',
])

const allowedPropsByTemplate: Record<HyperframesVisualTemplateId, ReadonlySet<string>> = {
  'hyperframes-hook-kinetic-30': HOOK_VISUAL_KEYS,
  'hyperframes-hook-cinematic-30': HOOK_VISUAL_KEYS,
  'hook-kinetic': HOOK_VISUAL_KEYS,
  'hook-editorial': HOOK_VISUAL_KEYS,
  'hook-cinematic': HOOK_VISUAL_KEYS,
  'scene-title-card': new Set([
    ...COMMON_VISUAL_KEYS,
    'eyebrow',
    'headline',
    'body',
    'assetId',
  ]),
  'scene-stat-card': new Set([
    ...COMMON_VISUAL_KEYS,
    'value',
    'label',
    'body',
  ]),
  'scene-quote-card': new Set([
    ...COMMON_VISUAL_KEYS,
    'quote',
    'attribution',
  ]),
}

export function unknownTemplateProps(reference: TemplateReference): string[] {
  if (
    !isHyperframesHookTemplateId(reference.id) &&
    !isHyperframesSceneTemplateId(reference.id)
  ) {
    return Object.keys(reference.props)
  }
  const allowed = allowedPropsByTemplate[reference.id]
  return Object.keys(reference.props).filter((key) => !allowed.has(key))
}

export function hookPlanFromTemplateProps(props: JsonObject): HookPlan | null {
  const raw = props.hookPlan ?? props.hookPlanJson
  if (raw === undefined) return null
  const payload = typeof raw === 'string' ? parseJsonInput(raw) : raw
  assertDataOnlyAiPayload(payload)
  return HookPlanSchema.parse(payload)
}
