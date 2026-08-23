import {
  NEW_CAPTION_DEFINITIONS,
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  NEW_TEMPLATE_ACCENT,
  TemplateManifestSchema,
  type NewCaptionDefinition,
  type NewHookDefinition,
  type TemplateManifest
} from '../../../../shared/video-engine'

/* Manifests for the Cinematic Hooks and Captions set.
 *
 * Deliberately NOT part of BUILTIN_VIDEO_TEMPLATES. That array is pinned by three test suites to
 * exact counts and exact id sets, and this set is additive: it joins the app through
 * VideoTemplateRegistry instead, which is the only thing compileHookPlan, setCaptionTemplate,
 * preflight and videoEngine.templates() actually read.
 *
 * The hooks advertise `dynamic-duration` and `transitions` and nothing else. They deliberately do NOT
 * claim `audio` or `broll`: unlike the generic HookTemplate, these components render no `beat.visual`
 * and no audio — their footage is whatever sits under the hook lane on the timeline. Claiming a
 * capability nothing implements is how a beat carrying an assetId or a search query ends up resolving
 * to a blank frame with no error. */

const ASPECT_RATIOS: TemplateManifest['aspectRatios'] = ['16:9', '9:16', '1:1', '4:5', 'custom']

function grainParameter(value: number): TemplateManifest['parameters'][number] {
  return {
    key: 'grain',
    label: 'Film grain',
    type: 'number',
    required: false,
    default: value,
    minimum: 0,
    maximum: 1,
    integer: false
  }
}

function accentParameter(): TemplateManifest['parameters'][number] {
  return {
    key: 'accentColor',
    label: 'Accent',
    type: 'color',
    required: false,
    default: NEW_TEMPLATE_ACCENT.toUpperCase()
  }
}

function hookManifest(definition: NewHookDefinition): TemplateManifest {
  const parameters: TemplateManifest['parameters'] = [
    ...definition.textFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: 'string' as const,
      required: false,
      default: field.default,
      maxLength: field.maxLength
    })),
    ...definition.numberFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: 'number' as const,
      required: false,
      default: field.default,
      minimum: field.minimum,
      maximum: field.maximum,
      integer: field.integer
    })),
    grainParameter(definition.grain),
    ...(definition.usesAccent ? [accentParameter()] : [])
  ]
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    version: '1.0.0',
    rendererId: 'remotion',
    kind: 'hook',
    name: definition.name,
    description: definition.description,
    implementationId: definition.id,
    aspectRatios: ASPECT_RATIOS,
    duration: {
      minimumFrames: 12,
      maximumFrames: 7_200,
      // The delivered length at 30fps. The accordion converts defaultSeconds to the project's
      // own fps, so this only seeds the manifest's range.
      defaultFrames: Math.round(definition.defaultSeconds * 30)
    },
    capabilities: ['dynamic-duration', 'transitions'],
    parameters,
    tags: ['hook', 'cinematic', 'new-templates', 'film']
  })
}

function captionManifest(definition: NewCaptionDefinition): TemplateManifest {
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    version: '1.0.0',
    rendererId: 'remotion',
    kind: 'caption',
    name: definition.name,
    description: definition.description,
    implementationId: definition.id,
    aspectRatios: ASPECT_RATIOS,
    duration: { minimumFrames: 12, maximumFrames: 7_200, defaultFrames: 90 },
    capabilities: ['captions', 'dynamic-duration', 'word-highlighting'],
    parameters: [
      {
        key: 'textColor',
        label: 'Text',
        type: 'color',
        required: false,
        default: definition.textColor.toUpperCase()
      },
      {
        key: 'accentColor',
        label: 'Accent',
        type: 'color',
        required: false,
        default: definition.accentColor.toUpperCase()
      },
      grainParameter(definition.grain),
      {
        key: 'maxWordsPerCue',
        label: 'Maximum words per cue',
        type: 'number',
        required: false,
        default: definition.maxWordsPerCue,
        minimum: 1,
        maximum: 12,
        integer: true
      },
      {
        key: 'maxCharactersPerLine',
        label: 'Maximum characters per line',
        type: 'number',
        required: false,
        default: definition.maxCharactersPerLine,
        minimum: 10,
        maximum: 42,
        integer: true
      }
    ],
    tags: ['caption', 'cinematic', 'new-templates', 'word-timed']
  })
}

export const NEW_VIDEO_TEMPLATES: readonly TemplateManifest[] = Object.freeze([
  ...NEW_HOOK_TEMPLATE_IDS.map((id) => hookManifest(NEW_HOOK_DEFINITIONS[id])),
  ...NEW_CAPTION_TEMPLATE_IDS.map((id) => captionManifest(NEW_CAPTION_DEFINITIONS[id]))
])
