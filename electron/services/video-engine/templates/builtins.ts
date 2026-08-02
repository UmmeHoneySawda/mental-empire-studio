import {
  CAPTION_STYLE_DEFINITIONS,
  CAPTION_STYLE_IDS,
  captionStyleTemplateDefaults,
  hookStylePresetFor,
  REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
  TemplateManifestSchema,
  type HookStyleProps,
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

function hookParameters(style?: HookStyleProps): TemplateManifest['parameters'] {
  const parameters: TemplateManifest['parameters'] = [
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
    default: style?.accentColor ?? '#F8E71C'
  },
  {
    key: 'backgroundColor',
    label: 'Background color',
    type: 'color',
    required: false,
    default: style?.backgroundColor ?? '#080808'
  },
  {
    key: 'energy',
    label: 'Motion energy',
    type: 'enum',
    required: false,
    values: ['restrained', 'balanced', 'intense'],
    default: style?.energy ?? 'balanced'
  }
  ]
  if (!style) return parameters
  return [
    ...parameters,
    { key: 'textColor', label: 'Text color', type: 'color', required: false, default: style.textColor },
    {
      key: 'animationPreset',
      label: 'Animation',
      type: 'enum',
      required: false,
      values: ['kinetic', 'cinematic', 'punch', 'focus', 'rise', 'slide'],
      default: style.animationPreset
    },
    {
      key: 'backgroundPreset',
      label: 'Background',
      type: 'enum',
      required: false,
      values: ['solid', 'gradient', 'grid', 'spotlight', 'split'],
      default: style.backgroundPreset
    },
    {
      key: 'alignment',
      label: 'Alignment',
      type: 'enum',
      required: false,
      values: ['left', 'center', 'right'],
      default: style.alignment
    },
    {
      key: 'position',
      label: 'Position',
      type: 'enum',
      required: false,
      values: ['top', 'center', 'bottom'],
      default: style.position
    },
    {
      key: 'fontFamily',
      label: 'Font',
      type: 'enum',
      required: false,
      values: ['Space Grotesk', 'Hanken Grotesk', 'Anton', 'JetBrains Mono'],
      default: style.fontFamily
    },
    { key: 'fontSize', label: 'Headline size', type: 'number', required: false, default: style.fontSize, minimum: 32, maximum: 180, integer: true },
    { key: 'fontWeight', label: 'Weight', type: 'number', required: false, default: style.fontWeight, minimum: 400, maximum: 700, integer: true },
    { key: 'lineHeight', label: 'Line height', type: 'number', required: false, default: style.lineHeight, minimum: 0.8, maximum: 1.6, integer: false },
    { key: 'letterSpacing', label: 'Letter spacing', type: 'number', required: false, default: style.letterSpacing, minimum: -10, maximum: 16, integer: false }
  ]
}

function captionParameters(styleId: (typeof CAPTION_STYLE_IDS)[number]): TemplateManifest['parameters'] {
  const style = CAPTION_STYLE_DEFINITIONS[styleId]
  const defaults = captionStyleTemplateDefaults(style)
  return [
  {
    key: 'fontFamily',
    label: 'Font family',
    type: 'enum',
    required: false,
    default: defaults.fontFamily,
    values: ['Space Grotesk', 'Hanken Grotesk', 'Anton', 'JetBrains Mono']
  },
  {
    key: 'textColor',
    label: 'Text color',
    type: 'color',
    required: false,
    default: defaults.textColor
  },
  {
    key: 'activeColor',
    label: 'Spoken-word color',
    type: 'color',
    required: false,
    default: defaults.activeColor
  },
  {
    key: 'importantColor',
    label: 'Important-word color',
    type: 'color',
    required: false,
    default: defaults.importantColor
  },
  {
    key: 'maxWordsPerCue',
    label: 'Maximum words per cue',
    type: 'number',
    required: false,
    default: defaults.maxWordsPerCue,
    minimum: 1,
    maximum: 12,
    integer: true
  },
  {
    key: 'maxCharactersPerLine',
    label: 'Maximum characters per line',
    type: 'number',
    required: false,
    default: defaults.maxCharactersPerLine,
    minimum: 10,
    maximum: 42,
    integer: true
  }
  ]
}

function hookTemplates(rendererId: RendererId): TemplateManifest[] {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  const parametersFor = (id: string): TemplateManifest['parameters'] =>
    rendererId === 'remotion' ? hookParameters(hookStylePresetFor(id)) : hookParameters()
  const templates = [
    manifest({
      id: `${prefix}-hook-kinetic-30`,
      rendererId,
      kind: 'hook',
      name: 'Kinetic Hook',
      description: 'Fast oversized type for a concise promise, proof, tension, payoff, and turn.',
      minimumFrames: 24,
      maximumFrames: 7_200,
      defaultFrames: 300,
      capabilities: ['audio', 'broll', 'dynamic-duration', 'transitions'],
      parameters: parametersFor(`${prefix}-hook-kinetic-30`),
      tags: ['hook', 'intro', 'kinetic', 'short-form']
    }),
    manifest({
      id: `${prefix}-hook-cinematic-30`,
      rendererId,
      kind: 'hook',
      name: 'Cinematic Hook',
      description: 'Restrained editorial typography, a soft spotlight, and measured reveal beats.',
      minimumFrames: 24,
      maximumFrames: 7_200,
      defaultFrames: 300,
      capabilities: ['audio', 'broll', 'dynamic-duration', 'lut-grading', 'transitions'],
      parameters: parametersFor(`${prefix}-hook-cinematic-30`),
      tags: ['hook', 'intro', 'cinematic', 'editorial']
    })
  ]
  if (rendererId !== 'remotion') return templates

  const remotionPresets: ReadonlyArray<{
    id: string
    name: string
    description: string
    tags: string[]
  }> = [
    {
      id: 'remotion-hook-motivational',
      name: 'Motivational Punch',
      description: 'Centered Anton type with an energetic scale punch and warm high-contrast palette.',
      tags: ['hook', 'motivational', 'punch', 'creator']
    },
    {
      id: 'remotion-hook-psychological-tip',
      name: 'Mind Shift',
      description: 'Calm focus motion and a violet spotlight for psychology, mindset, and behavior tips.',
      tags: ['hook', 'psychology', 'mindset', 'tip']
    },
    {
      id: 'remotion-hook-self-improvement',
      name: 'Progress Path',
      description: 'Grounded rising type and a structured grid for habits, growth, and self-improvement.',
      tags: ['hook', 'self-improvement', 'habits', 'progress']
    },
    {
      id: 'remotion-hook-educational',
      name: 'Lesson Board',
      description: 'A left teaching panel that preserves visual room for talking-head or demonstration footage.',
      tags: ['hook', 'educational', 'talking-head', 'lesson']
    },
    {
      id: REMOTION_CUSTOM_HOOK_TEMPLATE_ID,
      name: 'Custom Declarative Hook',
      description: 'A bounded JSON-configured hook using trusted typography, motion, layout, and background presets.',
      tags: ['hook', 'custom', 'declarative', 'safe']
    }
  ]
  return [
    ...templates,
    ...remotionPresets.map((preset) => manifest({
      ...preset,
      rendererId,
      kind: 'hook',
      minimumFrames: 24,
      maximumFrames: 7_200,
      defaultFrames: 240,
      capabilities: ['audio', 'broll', 'dynamic-duration', 'transitions'],
      parameters: parametersFor(preset.id)
    }))
  ]
}

function captionTemplates(rendererId: RendererId): TemplateManifest[] {
  const prefix = rendererId === 'remotion' ? 'remotion' : 'hyperframes'
  return CAPTION_STYLE_IDS.map((id) => {
    const style = CAPTION_STYLE_DEFINITIONS[id]
    return manifest({
    id: `${prefix}-caption-${id}`,
    implementationId: `caption-${id}`,
    rendererId,
    kind: 'caption',
    name: style.name,
    description: `${style.description} Spoken and AI-selected important words remain separate.`,
    defaultFrames: 90,
    capabilities: ['captions', 'dynamic-duration', 'word-highlighting'],
    parameters: captionParameters(id),
    tags: ['caption', 'word-timed', 'highlight', id]
    })
  })
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
