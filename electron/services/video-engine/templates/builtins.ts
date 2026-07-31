import {
  TemplateManifestSchema,
  type RendererId,
  type TemplateKind,
  type TemplateManifest
} from '../../../../shared/video-engine'

function manifest(input: {
  id: string
  rendererId: RendererId
  kind: TemplateKind
  name: string
  description: string
  implementationId?: string
  minimumFrames?: number
  maximumFrames?: number
  defaultFrames?: number
  capabilities?: TemplateManifest['capabilities']
  parameters?: TemplateManifest['parameters']
  tags?: string[]
}): TemplateManifest {
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: input.id,
    version: '1.0.0',
    rendererId: input.rendererId,
    kind: input.kind,
    name: input.name,
    description: input.description,
    implementationId: input.implementationId ?? input.id,
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', 'custom'],
    duration: {
      minimumFrames: input.minimumFrames ?? 1,
      maximumFrames: input.maximumFrames ?? 7_200,
      defaultFrames: input.defaultFrames ?? 90
    },
    capabilities: input.capabilities ?? [],
    parameters: input.parameters ?? [],
    tags: input.tags ?? []
  })
}

const hookParameters: TemplateManifest['parameters'] = [
  {
    key: 'headline',
    label: 'Headline',
    type: 'string',
    required: false,
    default: 'A stronger opening starts here.',
    maxLength: 180
  },
  {
    key: 'subheadline',
    label: 'Subheadline',
    type: 'string',
    required: false,
    maxLength: 280
  },
  {
    key: 'accentColor',
    label: 'Accent color',
    type: 'color',
    required: false,
    default: '#F8E71C'
  },
  {
    key: 'backgroundColor',
    label: 'Background color',
    type: 'color',
    required: false,
    default: '#080808'
  },
  {
    key: 'energy',
    label: 'Motion energy',
    type: 'enum',
    required: false,
    values: ['restrained', 'balanced', 'intense'],
    default: 'balanced'
  }
]

const captionParameters: TemplateManifest['parameters'] = [
  {
    key: 'fontFamily',
    label: 'Font family',
    type: 'string',
    required: false,
    default: 'Hanken Grotesk',
    maxLength: 128
  },
  {
    key: 'textColor',
    label: 'Text color',
    type: 'color',
    required: false,
    default: '#FFFFFF'
  },
  {
    key: 'activeColor',
    label: 'Spoken-word color',
    type: 'color',
    required: false,
    default: '#F8E71C'
  },
  {
    key: 'importantColor',
    label: 'Important-word color',
    type: 'color',
    required: false,
    default: '#FF4D4D'
  },
  {
    key: 'maxWordsPerCue',
    label: 'Maximum words per cue',
    type: 'number',
    required: false,
    default: 6,
    minimum: 1,
    maximum: 12,
    integer: true
  }
]

function hookTemplates(rendererId: RendererId): TemplateManifest[] {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  return [
    manifest({
      id: `${prefix}-hook-kinetic-30`,
      rendererId,
      kind: 'hook',
      name: '30s Kinetic Hook',
      description: 'A configurable five-beat hook with oversized kinetic type, proof beat, tension beat, and payoff.',
      minimumFrames: 24,
      maximumFrames: 7_200,
      defaultFrames: 900,
      capabilities: ['audio', 'broll', 'dynamic-duration', 'transitions'],
      parameters: hookParameters,
      tags: ['hook', 'intro', 'kinetic', '30-second']
    }),
    manifest({
      id: `${prefix}-hook-cinematic-30`,
      rendererId,
      kind: 'hook',
      name: '30s Cinematic Hook',
      description: 'A restrained cinematic hook with layered media, editorial typography, light leaks, and reveal beats.',
      minimumFrames: 24,
      maximumFrames: 7_200,
      defaultFrames: 900,
      capabilities: ['audio', 'broll', 'dynamic-duration', 'lut-grading', 'transitions'],
      parameters: hookParameters,
      tags: ['hook', 'intro', 'cinematic', '30-second']
    })
  ]
}

const captionStyles = [
  ['emoji-pop', 'Emoji Pop'],
  ['clip-wipe', 'Clip Wipe'],
  ['highlight', 'Active Highlight'],
  ['neon-accent', 'Neon Accent'],
  ['particle-burst', 'Particle Burst'],
  ['weight-shift', 'Weight Shift']
] as const

function captionTemplates(rendererId: RendererId): TemplateManifest[] {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  return captionStyles.map(([id, name]) => manifest({
    id: `${prefix}-caption-${id}`,
    implementationId: `caption-${id}`,
    rendererId,
    kind: 'caption',
    name,
    description: `${name} word-timed captions with separate spoken-word and AI-selected important-word emphasis.`,
    defaultFrames: 90,
    capabilities: ['captions', 'dynamic-duration', 'word-highlighting'],
    parameters: captionParameters,
    tags: ['caption', 'word-timed', 'highlight']
  }))
}

function transitionTemplate(
  rendererId: RendererId,
  id: string,
  name: string
): TemplateManifest {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  return manifest({
    id: `${prefix}-transition-${id}`,
    implementationId: `transition-${id}`,
    rendererId,
    kind: 'transition',
    name,
    description: `${name} transition approved for the ${rendererId} renderer.`,
    minimumFrames: 1,
    maximumFrames: 300,
    defaultFrames: 15,
    capabilities: ['transitions'],
    parameters: [{
      key: 'durationFrames',
      label: 'Duration',
      type: 'number',
      required: false,
      default: 15,
      minimum: 1,
      maximum: 300,
      integer: true
    }],
    tags: ['transition', id]
  })
}

/* Text styles the editor's Text panel offers. These are real registered templates rather
 * than loose props because preflight refuses any scene whose template is not installed —
 * and because a named style is what lets a project keep its typography when it is reopened.
 * The type scale is the one from editor-pro-max's `TextStyles.ts`, mapped onto the fonts
 * this app self-hosts (the renderer CSP forbids a font CDN). */
const textParameters: TemplateManifest['parameters'] = [
  { key: 'fontSize', label: 'Size', type: 'number', required: false, default: 72, minimum: 8, maximum: 400, integer: true },
  { key: 'fontFamily', label: 'Font', type: 'string', required: false, default: 'Space Grotesk', maxLength: 64 },
  { key: 'fontWeight', label: 'Weight', type: 'number', required: false, default: 800, minimum: 100, maximum: 900, integer: true },
  { key: 'lineHeight', label: 'Line height', type: 'number', required: false, default: 1.1, minimum: 0.7, maximum: 3, integer: false },
  { key: 'letterSpacing', label: 'Letter spacing', type: 'number', required: false, default: -1, minimum: -20, maximum: 40, integer: false },
  { key: 'color', label: 'Colour', type: 'string', required: false, default: '#FFFFFF', maxLength: 32 },
  { key: 'align', label: 'Align', type: 'string', required: false, default: 'center', maxLength: 16 },
  { key: 'animation', label: 'Motion', type: 'string', required: false, default: 'rise', maxLength: 32 },
  { key: 'fontStyle', label: 'Style', type: 'string', required: false, default: 'normal', maxLength: 16 }
]

const TEXT_STYLE_NAMES: ReadonlyArray<readonly [string, string, string]> = [
  ['display', 'Display', 'Full-frame statement type at the heaviest weight.'],
  ['heading', 'Heading', 'The default title size.'],
  ['subheading', 'Subheading', 'Sits under a heading.'],
  ['body', 'Body', 'For copy you expect read.'],
  ['caption', 'Caption', 'Matches the burnt-in caption weight.'],
  ['quote', 'Quote', 'Italic, generous leading.'],
  ['code', 'Mono', 'JetBrains Mono, for code and data.']
]

function textTemplate(rendererId: RendererId, id: string, name: string, description: string): TemplateManifest {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  return manifest({
    id: `${prefix}-text-${id}`,
    implementationId: `text-${id}`,
    rendererId,
    kind: 'overlay',
    name,
    description,
    minimumFrames: 1,
    maximumFrames: 7_200,
    defaultFrames: 90,
    capabilities: ['dynamic-duration'],
    parameters: textParameters,
    tags: ['text', 'title', id]
  })
}

/** Both renderers implement the same six transitions with matching numbers, so a
 *  project keeps its look when the engine is switched. */
const TRANSITION_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['fade', 'Fade'],
  ['slide', 'Slide'],
  ['wipe', 'Wipe'],
  ['zoom', 'Zoom'],
  ['blur', 'Blur'],
  ['dip-to-black', 'Dip to Black']
]

export const BUILTIN_VIDEO_TEMPLATES: readonly TemplateManifest[] = Object.freeze([
  ...hookTemplates('remotion'),
  ...hookTemplates('hyperframes'),
  ...captionTemplates('remotion'),
  ...captionTemplates('hyperframes'),
  ...TRANSITION_NAMES.map(([id, name]) => transitionTemplate('remotion', id, name)),
  ...TRANSITION_NAMES.map(([id, name]) => transitionTemplate('hyperframes', id, name)),
  ...TEXT_STYLE_NAMES.map(([id, name, description]) => textTemplate('remotion', id, name, description)),
  ...TEXT_STYLE_NAMES.map(([id, name, description]) => textTemplate('hyperframes', id, name, description))
])
