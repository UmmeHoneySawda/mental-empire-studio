import {
  DEFAULT_VIDEO_TRANSFORM,
  VideoProjectSchema,
  captionGroupingOptionsForStyle,
  captionLayoutMetrics,
  captionNeedsLeadingSpace,
  groupCaptionCues,
  readableTextColor,
  resolveCaptionStyle,
  type CaptionStyleDefinition,
  type CaptionWord,
  type HookBeat,
  type HookPlan,
  type JsonObject,
  type VideoAsset,
  type VideoProject,
  type VideoScene,
  type VideoTransition,
} from '../../shared/video-engine'
import {
  HYPERFRAMES_CAPTION_TEMPLATE_IDS,
  HYPERFRAMES_TEMPLATE_VERSION,
  getHyperframesTemplateManifest,
  hyperframesCaptionStyle,
  hyperframesHookStyle,
  hookPlanFromTemplateProps,
  isHyperframesCaptionTemplateId,
  isHyperframesHookTemplateId,
  isHyperframesSceneTemplateId,
  unknownTemplateProps,
  type HyperframesCaptionTemplateId,
  type HyperframesCaptionStyle,
  type HyperframesHookTemplateId,
  type HyperframesVisualTemplateId,
} from './templates'
import {
  booleanProp,
  colorProp,
  escapeAttribute,
  escapeHtml,
  isHexColor,
  optionalStringProp,
  safeDomToken,
  scriptJson,
  seconds,
  stringProp,
} from './safe'
import type {
  HyperframesAssetSources,
  HyperframesCompiledComposition,
  HyperframesCompileOptions,
  HyperframesCompileVariables,
  HyperframesValidationIssue,
} from './types'

const DEFAULT_VARIABLES: HyperframesCompileVariables = Object.freeze({
  hfBackground: '#000000',
  hfCaptionText: '#FFFFFF',
  hfCaptionAccent: '#FFD166',
  hfCaptionImportant: '#FF4D4D',
})

const SUPPORTED_FPS = new Set([24, 25, 30, 50, 60])
const VISUAL_SCENE_KINDS = new Set<VideoScene['kind']>([
  'media',
  'template',
  'text',
  'solid',
  'caption',
])

type AnimatableValue = string | number | boolean
type AnimationValues = Record<string, AnimatableValue>

interface AnimationOperation {
  kind: 'fromTo' | 'to' | 'set'
  elementId: string
  at: number
  from?: AnimationValues
  to: AnimationValues
}

interface SceneTargets {
  entrance: string[]
  exit: string[]
}

interface BuildContext {
  project: VideoProject
  assets: Map<string, VideoAsset>
  sources: Map<string, string>
  variables: HyperframesCompileVariables
  nodes: string[]
  operations: AnimationOperation[]
  sceneTargets: Map<string, SceneTargets>
  customFonts: Map<string, string>
  nextTrack: number
  nextOverlay: number
}

interface RenderedHookBeat {
  targets: string[]
  contentId: string
  startFrame: number
  durationFrames: number
}

function sourceMap(input: HyperframesAssetSources | undefined): Map<string, string> {
  if (!input) return new Map()
  if (input instanceof Map) return new Map(input)
  return new Map(Object.entries(input))
}

function issue(
  severity: HyperframesValidationIssue['severity'],
  code: string,
  message: string,
  path?: string,
): HyperframesValidationIssue {
  return { severity, code, message, path }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> }).issues
    if (issues?.length) {
      return issues
        .slice(0, 4)
        .map((item) => {
          const path = item.path?.map(String).join('.')
          return `${path ? `${path}: ` : ''}${item.message ?? 'Invalid value'}`
        })
        .join('; ')
    }
  }
  return error instanceof Error ? error.message : String(error)
}

function assetIdProp(props: JsonObject, key: string): string | undefined {
  const value = props[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function hookPlanForScene(scene: VideoScene): HookPlan | null {
  if (!scene.template || !isHyperframesHookTemplateId(scene.template.id)) return null
  return hookPlanFromTemplateProps(scene.template.props)
}

function hookWordId(beatId: string, field: 'headline' | 'body', index: number): string {
  return `${beatId}:${field}:${index}`
}

function textWordIds(beat: HookBeat): Set<string> {
  const ids = new Set<string>()
  for (const field of ['headline', 'body'] as const) {
    const text = beat[field]
    if (!text) continue
    let index = 0
    for (const token of text.split(/(\s+)/u)) {
      if (!token || /^\s+$/u.test(token)) continue
      ids.add(hookWordId(beat.id, field, index))
      index += 1
    }
  }
  return ids
}

function validateTemplateScene(
  project: VideoProject,
  scene: VideoScene,
  sceneIndex: number,
  assets: Map<string, VideoAsset>,
): HyperframesValidationIssue[] {
  const issues: HyperframesValidationIssue[] = []
  const reference = scene.template!
  const path = `scenes.${sceneIndex}.template`
  const manifest = getHyperframesTemplateManifest(reference.id, reference.version)
  if (!manifest || (!isHyperframesHookTemplateId(reference.id) && !isHyperframesSceneTemplateId(reference.id))) {
    issues.push(
      issue(
        'error',
        'hyperframes-template-unsupported',
        `Unsupported HyperFrames visual template: ${reference.id}@${reference.version}`,
        path,
      ),
    )
    return issues
  }
  if (reference.rendererId !== 'hyperframes') {
    issues.push(
      issue(
        'error',
        'hyperframes-template-renderer',
        'Template renderer must be hyperframes',
        `${path}.rendererId`,
      ),
    )
  }
  const unknown = unknownTemplateProps(reference)
  if (unknown.length > 0) {
    issues.push(
      issue(
        'error',
        'hyperframes-template-props',
        `Template contains unsupported properties: ${unknown.join(', ')}`,
        `${path}.props`,
      ),
    )
  }
  for (const [key, expectedKind] of [
    ['fontAssetId', 'font'],
    ['assetId', 'visual'],
  ] as const) {
    const id = assetIdProp(reference.props, key)
    if (!id) continue
    const asset = assets.get(id)
    if (!asset) {
      issues.push(
        issue(
          'error',
          'hyperframes-template-asset-missing',
          `Template property ${key} references an unknown asset: ${id}`,
          `${path}.props.${key}`,
        ),
      )
    } else if (
      (expectedKind === 'font' && asset.kind !== 'font') ||
      (expectedKind === 'visual' && asset.kind !== 'image' && asset.kind !== 'video')
    ) {
      issues.push(
        issue(
          'error',
          'hyperframes-template-asset-kind',
          `${key} references a ${asset.kind} asset, which is not supported here`,
          `${path}.props.${key}`,
        ),
      )
    }
  }

  if (isHyperframesHookTemplateId(reference.id)) {
    if (scene.durationFrames > project.canvas.fps * 30) {
      issues.push(
        issue(
          'error',
          'hyperframes-hook-too-long',
          'Hook templates cannot exceed 30 seconds',
          `scenes.${sceneIndex}.durationFrames`,
        ),
      )
    }
    let plan: HookPlan | null = null
    try {
      plan = hookPlanForScene(scene)
    } catch (error) {
      issues.push(
        issue(
          'error',
          'hyperframes-hook-plan-invalid',
          `Invalid data-only hook plan: ${errorMessage(error)}`,
          `${path}.props`,
        ),
      )
    }
    if (plan) {
      if (plan.rendererId !== 'hyperframes') {
        issues.push(
          issue(
            'error',
            'hyperframes-hook-plan-renderer',
            'Hook plan renderer must be hyperframes',
            `${path}.props.hookPlan.rendererId`,
          ),
        )
      }
      if (plan.templateId !== reference.id) {
        issues.push(
          issue(
            'error',
            'hyperframes-hook-plan-template',
            `Hook plan template ${plan.templateId} does not match scene template ${reference.id}`,
            `${path}.props.hookPlan.templateId`,
          ),
        )
      }
      if (plan.templateVersion && plan.templateVersion !== reference.version) {
        issues.push(
          issue(
            'error',
            'hyperframes-hook-plan-version',
            `Hook plan version ${plan.templateVersion} does not match ${reference.version}`,
            `${path}.props.hookPlan.templateVersion`,
          ),
        )
      }
      if (plan.fps !== project.canvas.fps) {
        issues.push(
          issue(
            'error',
            'hyperframes-hook-plan-fps',
            `Hook plan FPS ${plan.fps} does not match project FPS ${project.canvas.fps}`,
            `${path}.props.hookPlan.fps`,
          ),
        )
      }
      if (plan.durationFrames > scene.durationFrames) {
        issues.push(
          issue(
            'error',
            'hyperframes-hook-plan-duration',
            'Hook plan extends beyond its template scene',
            `${path}.props.hookPlan.durationFrames`,
          ),
        )
      }
      for (let beatIndex = 0; beatIndex < plan.beats.length; beatIndex += 1) {
        const beat = plan.beats[beatIndex]!
        if (beat.visual.kind === 'asset') {
          const asset = assets.get(beat.visual.assetId!)
          if (!asset) {
            issues.push(
              issue(
                'error',
                'hyperframes-hook-asset-missing',
                `Hook beat references an unknown asset: ${beat.visual.assetId}`,
                `${path}.props.hookPlan.beats.${beatIndex}.visual.assetId`,
              ),
            )
          } else if (asset.kind !== 'image' && asset.kind !== 'video') {
            issues.push(
              issue(
                'error',
                'hyperframes-hook-asset-kind',
                `Hook visuals require an image or video, not ${asset.kind}`,
                `${path}.props.hookPlan.beats.${beatIndex}.visual.assetId`,
              ),
            )
          }
        } else if (beat.visual.kind === 'broll') {
          issues.push(
            issue(
              'warning',
              'hyperframes-hook-broll-unresolved',
              `B-roll query "${beat.visual.searchQuery}" has not been resolved to a local asset; a graphic fallback will render`,
              `${path}.props.hookPlan.beats.${beatIndex}.visual`,
            ),
          )
        }
        const knownWordIds = textWordIds(beat)
        for (const importantId of beat.importantWordIds ?? []) {
          if (!knownWordIds.has(importantId)) {
            issues.push(
              issue(
                'warning',
                'hyperframes-hook-word-id',
                `Unknown hook word ID ${importantId}; expected ${beat.id}:headline:<index> or ${beat.id}:body:<index>`,
                `${path}.props.hookPlan.beats.${beatIndex}.importantWordIds`,
              ),
            )
          }
        }
      }
    }
  }
  return issues
}

export function validateHyperframesProject(projectInput: VideoProject): HyperframesValidationIssue[] {
  const parsed = VideoProjectSchema.safeParse(projectInput)
  if (!parsed.success) {
    return parsed.error.issues.map((item) =>
      issue(
        'error',
        'hyperframes-project-schema',
        item.message,
        item.path.map(String).join('.'),
      ),
    )
  }
  const project = parsed.data
  const issues: HyperframesValidationIssue[] = []
  if (project.rendererId !== 'hyperframes') {
    issues.push(
      issue(
        'error',
        'hyperframes-renderer-mismatch',
        `Expected rendererId "hyperframes", received "${project.rendererId}"`,
        'rendererId',
      ),
    )
  }
  if (!SUPPORTED_FPS.has(project.canvas.fps)) {
    issues.push(
      issue(
        'error',
        'hyperframes-fps-unsupported',
        `Supported frame rates are ${[...SUPPORTED_FPS].join(', ')} FPS`,
        'canvas.fps',
      ),
    )
  }
  if (project.canvas.width > 7680 || project.canvas.height > 7680) {
    issues.push(
      issue(
        'error',
        'hyperframes-resolution-unsupported',
        'HyperFrames rendering is limited to 7680 pixels per dimension',
        'canvas',
      ),
    )
  }

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const scenes = new Map(project.scenes.map((scene) => [scene.id, scene]))
  for (let index = 0; index < project.scenes.length; index += 1) {
    const scene = project.scenes[index]!
    const asset = scene.assetId ? assets.get(scene.assetId) : undefined
    if (scene.kind === 'media' && asset && asset.kind !== 'image' && asset.kind !== 'video') {
      issues.push(
        issue(
          'error',
          'hyperframes-media-asset-kind',
          `Media scenes require image or video assets, not ${asset.kind}`,
          `scenes.${index}.assetId`,
        ),
      )
    }
    if (scene.kind === 'audio' && asset && asset.kind !== 'audio' && asset.kind !== 'video') {
      issues.push(
        issue(
          'error',
          'hyperframes-audio-asset-kind',
          `Audio scenes require audio or video assets, not ${asset.kind}`,
          `scenes.${index}.assetId`,
        ),
      )
    }
    if (scene.volume !== undefined && scene.volume > 1) {
      issues.push(
        issue(
          'warning',
          'hyperframes-volume-clamped',
          'HyperFrames static volume is limited to 1; this scene will be clamped',
          `scenes.${index}.volume`,
        ),
      )
    }
    if (
      scene.sourceRange &&
      scene.sourceRange.durationFrames < scene.durationFrames &&
      (scene.kind === 'media' || scene.kind === 'audio')
    ) {
      issues.push(
        issue(
          'warning',
          'hyperframes-source-range-short',
          'The source range is shorter than the scene; the final source frame may hold',
          `scenes.${index}.sourceRange`,
        ),
      )
    }
    if (scene.kind === 'template') {
      issues.push(...validateTemplateScene(project, scene, index, assets))
    }
  }

  const captionTemplateId = project.captions?.templateId ?? HYPERFRAMES_CAPTION_TEMPLATE_IDS[0]
  if (project.captions && !isHyperframesCaptionTemplateId(captionTemplateId)) {
    issues.push(
      issue(
        'error',
        'hyperframes-caption-template-unsupported',
        `Unsupported HyperFrames caption template: ${captionTemplateId}`,
        'captions.templateId',
      ),
    )
  }

  for (let index = 0; index < project.transitions.length; index += 1) {
    const transition = project.transitions[index]!
    const from = scenes.get(transition.fromSceneId)
    const to = scenes.get(transition.toSceneId)
    if (!from || !to) continue
    if (!VISUAL_SCENE_KINDS.has(from.kind) || !VISUAL_SCENE_KINDS.has(to.kind)) {
      issues.push(
        issue(
          'error',
          'hyperframes-transition-nonvisual',
          'Transitions can only connect visual scenes',
          `transitions.${index}`,
        ),
      )
      continue
    }
    if (transition.type !== 'cut') {
      const transitionEnd = transition.startFrame + transition.durationFrames
      const fromEnd = from.startFrame + from.durationFrames
      const toEnd = to.startFrame + to.durationFrames
      if (transition.startFrame < from.startFrame || transitionEnd > fromEnd) {
        issues.push(
          issue(
            'error',
            'hyperframes-transition-from-window',
            'Animated transition must remain inside its outgoing scene',
            `transitions.${index}`,
          ),
        )
      }
      if (transition.startFrame < to.startFrame || transitionEnd > toEnd) {
        issues.push(
          issue(
            'error',
            'hyperframes-transition-to-window',
            'Animated transition must remain inside its incoming scene',
            `transitions.${index}`,
          ),
        )
      }
    }
  }
  return issues
}

export function collectHyperframesAssetIds(project: VideoProject): string[] {
  const ids = new Set<string>()
  for (const scene of project.scenes) {
    if (scene.assetId) ids.add(scene.assetId)
    if (!scene.template) continue
    for (const key of ['assetId', 'fontAssetId'] as const) {
      const id = assetIdProp(scene.template.props, key)
      if (id) ids.add(id)
    }
    if (isHyperframesHookTemplateId(scene.template.id)) {
      try {
        const plan = hookPlanForScene(scene)
        for (const beat of plan?.beats ?? []) {
          if (beat.visual.kind === 'asset' && beat.visual.assetId) {
            ids.add(beat.visual.assetId)
          }
        }
      } catch {
        // Validation reports malformed plans. Collection remains side-effect free.
      }
    }
  }
  return [...ids].sort()
}

function sourceFor(context: BuildContext, assetId: string): string {
  const source = context.sources.get(assetId)
  if (!source) throw new Error(`No prepared local source for asset: ${assetId}`)
  return source
}

function nextTrack(context: BuildContext): number {
  const value = context.nextTrack
  context.nextTrack += 1
  return value
}

function transformStyle(scene: VideoScene): string {
  const transform = scene.transform ?? DEFAULT_VIDEO_TRANSFORM
  const opacity = scene.opacity ?? 1
  return [
    `transform:translate3d(${transform.x}px,${transform.y}px,0) rotate(${transform.rotationDeg}deg) scale(${transform.scaleX},${transform.scaleY})`,
    `transform-origin:${transform.anchorX * 100}% ${transform.anchorY * 100}%`,
    `opacity:${opacity}`,
  ].join(';')
}

function visualTiming(
  context: BuildContext,
  id: string,
  startFrame: number,
  durationFrames: number,
  hfId: string,
  className = 'clip hf-scene-clip',
): string {
  return [
    `id="${escapeAttribute(id)}"`,
    `class="${escapeAttribute(className)}"`,
    `data-start="${seconds(startFrame, context.project.canvas.fps)}"`,
    `data-duration="${seconds(durationFrames, context.project.canvas.fps)}"`,
    `data-track-index="${nextTrack(context)}"`,
    `data-hf-id="${escapeAttribute(hfId)}"`,
  ].join(' ')
}

function mediaTiming(
  context: BuildContext,
  startFrame: number,
  durationFrames: number,
  sourceStartFrame: number | undefined,
): string {
  return [
    `data-start="${seconds(startFrame, context.project.canvas.fps)}"`,
    `data-duration="${seconds(durationFrames, context.project.canvas.fps)}"`,
    `data-track-index="${nextTrack(context)}"`,
    sourceStartFrame === undefined
      ? ''
      : `data-media-start="${seconds(sourceStartFrame, context.project.canvas.fps)}"`,
  ]
    .filter(Boolean)
    .join(' ')
}

function customFontFamily(context: BuildContext, props: JsonObject): string {
  const fontAssetId = assetIdProp(props, 'fontAssetId')
  if (!fontAssetId) return 'HF Space'
  const source = sourceFor(context, fontAssetId)
  const family = `HF Custom ${safeDomToken(fontAssetId)}`
  context.customFonts.set(family, source)
  return family
}

function cssFamily(value: string): string {
  return JSON.stringify(value).replaceAll('</', '<\\/')
}

function addOperation(context: BuildContext, operation: AnimationOperation): void {
  if (!Number.isFinite(operation.at) || operation.at < 0) return
  context.operations.push(operation)
}

function addSimpleEntrance(
  context: BuildContext,
  elementId: string,
  startFrame: number,
  durationFrames: number,
  style: 'kinetic' | 'editorial' | 'cinematic' | 'standard',
  energy: 'restrained' | 'balanced' | 'intense' = 'balanced',
): void {
  const fps = context.project.canvas.fps
  const start = startFrame / fps
  const energyDuration =
    energy === 'restrained' ? 1.2 : energy === 'intense' ? 0.72 : 1
  const energyDistance =
    energy === 'restrained' ? 0.65 : energy === 'intense' ? 1.3 : 1
  const duration =
    Math.min(0.9, Math.max(2 / fps, durationFrames / fps / 4)) * energyDuration
  const from: AnimationValues =
    style === 'cinematic'
      ? { opacity: 0, scale: 1 + 0.06 * energyDistance }
      : style === 'editorial'
        ? { opacity: 0, x: -48 * energyDistance }
        : style === 'kinetic'
          ? {
              opacity: 0,
              y: 72 * energyDistance,
              scale: 1 - 0.06 * energyDistance,
            }
          : { opacity: 0, y: 32 * energyDistance }
  addOperation(context, {
    kind: 'fromTo',
    elementId,
    at: start,
    from,
    to: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration,
      ease: style === 'cinematic' ? 'power2.out' : 'power3.out',
      immediateRender: false,
    },
  })
}

function renderAudioElement(
  context: BuildContext,
  input: {
    id: string
    hfId: string
    assetId: string
    startFrame: number
    durationFrames: number
    sourceStartFrame?: number
    volume: number
  },
): string {
  return `<audio id="${escapeAttribute(input.id)}" data-hf-id="${escapeAttribute(
    input.hfId,
  )}" ${mediaTiming(
    context,
    input.startFrame,
    input.durationFrames,
    input.sourceStartFrame,
  )} data-volume="${Math.min(1, Math.max(0, input.volume))}" src="${escapeAttribute(
    sourceFor(context, input.assetId),
  )}" preload="auto"></audio>`
}

function renderVideoLayer(
  context: BuildContext,
  input: {
    domKey: string
    hfId: string
    assetId: string
    startFrame: number
    durationFrames: number
    sourceStartFrame?: number
    zIndex: number
    transformStyle?: string
    fit?: VideoScene['fit']
    opacity?: number
  },
): { node: string; targetId: string } {
  const targetId = `target-${safeDomToken(input.domKey)}`
  const mediaId = `media-${safeDomToken(input.domKey)}`
  const fit = input.fit ?? 'cover'
  const staticStyle =
    input.transformStyle ?? `transform:none;transform-origin:50% 50%;opacity:${input.opacity ?? 1}`
  const node = `<div id="${targetId}" class="hf-transition-target hf-media-shell" data-hf-id="${escapeAttribute(
    input.hfId,
  )}" style="z-index:${input.zIndex}">
  <div class="hf-scene-transform" style="${escapeAttribute(staticStyle)}">
    <video id="${mediaId}" class="hf-video" data-hf-id="${escapeAttribute(
      `${input.hfId}:video`,
    )}" ${mediaTiming(
      context,
      input.startFrame,
      input.durationFrames,
      input.sourceStartFrame,
    )} src="${escapeAttribute(sourceFor(context, input.assetId))}" style="object-fit:${fit}" muted playsinline preload="auto"></video>
  </div>
</div>`
  return { node, targetId }
}

function renderMediaScene(context: BuildContext, scene: VideoScene): void {
  const asset = context.assets.get(scene.assetId!)!
  const key = `scene-${scene.id}`
  const targetId = `target-${safeDomToken(key)}`
  if (asset.kind === 'video') {
    const rendered = renderVideoLayer(context, {
      domKey: key,
      hfId: `scene:${scene.id}`,
      assetId: asset.id,
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sourceStartFrame: scene.sourceRange?.startFrame,
      zIndex: scene.zIndex,
      transformStyle: transformStyle(scene),
      fit: scene.fit,
    })
    context.nodes.push(rendered.node)
    context.sceneTargets.set(scene.id, {
      entrance: [rendered.targetId],
      exit: [rendered.targetId],
    })
    if ((scene.volume ?? 0) > 0) {
      const track = context.project.tracks.find((candidate) => candidate.id === scene.trackId)
      if (!track?.muted) {
        context.nodes.push(
          renderAudioElement(context, {
            id: `audio-${safeDomToken(key)}`,
            hfId: `scene:${scene.id}:audio`,
            assetId: asset.id,
            startFrame: scene.startFrame,
            durationFrames: scene.durationFrames,
            sourceStartFrame: scene.sourceRange?.startFrame,
            volume: scene.volume ?? 0,
          }),
        )
      }
    }
    return
  }

  const clipId = `clip-${safeDomToken(key)}`
  const source = sourceFor(context, asset.id)
  context.nodes.push(`<section ${visualTiming(
    context,
    clipId,
    scene.startFrame,
    scene.durationFrames,
    `scene:${scene.id}`,
  )} style="z-index:${scene.zIndex}">
  <div id="${targetId}" class="hf-transition-target">
    <div class="hf-scene-transform" style="${escapeAttribute(transformStyle(scene))}">
      <img class="hf-image" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:image`,
      )}" src="${escapeAttribute(source)}" alt="" draggable="false" style="object-fit:${
        scene.fit ?? 'cover'
      }" />
    </div>
  </div>
</section>`)
  context.sceneTargets.set(scene.id, { entrance: [targetId], exit: [targetId] })
}

function renderAudioScene(context: BuildContext, scene: VideoScene): void {
  const track = context.project.tracks.find((candidate) => candidate.id === scene.trackId)
  if (track?.muted) return
  context.nodes.push(
    renderAudioElement(context, {
      id: `audio-scene-${safeDomToken(scene.id)}`,
      hfId: `scene:${scene.id}:audio`,
      assetId: scene.assetId!,
      startFrame: scene.startFrame,
      durationFrames: scene.durationFrames,
      sourceStartFrame: scene.sourceRange?.startFrame,
      volume: scene.volume ?? 1,
    }),
  )
}

function renderPlainScene(context: BuildContext, scene: VideoScene): void {
  const key = `scene-${scene.id}`
  const clipId = `clip-${safeDomToken(key)}`
  const targetId = `target-${safeDomToken(key)}`
  const contentId = `content-${safeDomToken(key)}`
  const minimum = Math.min(context.project.canvas.width, context.project.canvas.height)
  const fontSize = Math.max(28, Math.round(minimum * (scene.kind === 'caption' ? 0.055 : 0.075)))
  let content = ''
  if (scene.kind === 'solid') {
    content = `<div class="hf-solid" style="background:${escapeAttribute(scene.color!)}"></div>`
  } else {
    content = `<div id="${contentId}" data-hf-id="${escapeAttribute(
      `scene:${scene.id}:text`,
    )}" class="hf-plain-text ${
      scene.kind === 'caption' ? 'hf-plain-caption' : ''
    }" style="font-size:${fontSize}px">${escapeHtml(scene.text ?? '')}</div>`
  }
  context.nodes.push(`<section ${visualTiming(
    context,
    clipId,
    scene.startFrame,
    scene.durationFrames,
    `scene:${scene.id}`,
  )} style="z-index:${scene.zIndex}">
  <div id="${targetId}" class="hf-transition-target">
    <div class="hf-scene-transform" style="${escapeAttribute(transformStyle(scene))}">
      ${content}
    </div>
  </div>
</section>`)
  context.sceneTargets.set(scene.id, { entrance: [targetId], exit: [targetId] })
  if (scene.kind !== 'solid') {
    addSimpleEntrance(context, contentId, scene.startFrame, scene.durationFrames, 'standard')
  }
}

function highlightedHookText(
  beat: HookBeat,
  field: 'headline' | 'body',
  text: string,
): string {
  const important = new Set(beat.importantWordIds ?? [])
  let index = 0
  return text
    .split(/(\s+)/u)
    .map((token) => {
      if (!token) return ''
      if (/^\s+$/u.test(token)) return token.replaceAll('\n', '<br />')
      const id = hookWordId(beat.id, field, index)
      index += 1
      return `<span data-hf-id="${escapeAttribute(`hook-word:${id}`)}" data-word-id="${escapeAttribute(id)}"${
        important.has(id) ? ' class="hf-hook-important"' : ''
      }>${escapeHtml(token)}</span>`
    })
    .join('')
}

function hookColorProp(
  props: JsonObject,
  canonicalKey: 'accentColor' | 'backgroundColor',
  legacyKey: 'accent' | 'background',
  fallback: string,
): string {
  const canonical = props[canonicalKey]
  if (isHexColor(canonical)) return canonical
  return colorProp(props, legacyKey, fallback)
}

function hookEnergy(
  props: JsonObject,
): 'restrained' | 'balanced' | 'intense' {
  const value = props.energy
  return value === 'restrained' || value === 'intense' ? value : 'balanced'
}

function renderHookBeat(
  context: BuildContext,
  scene: VideoScene,
  templateId: HyperframesHookTemplateId,
  props: JsonObject,
  beat: HookBeat,
): RenderedHookBeat {
  const globalStart = scene.startFrame + beat.startFrame
  const key = `hook-${scene.id}-${beat.id}`
  const clipId = `clip-${safeDomToken(key)}`
  const targetId = `target-${safeDomToken(key)}`
  const contentId = `content-${safeDomToken(key)}`
  const style = hyperframesHookStyle(templateId)
  const energy = hookEnergy(props)
  const accent = hookColorProp(props, 'accentColor', 'accent', '#FFD166')
  const background = hookColorProp(
    props,
    'backgroundColor',
    'background',
    '#090B10',
  )
  const textColor = colorProp(props, 'textColor', '#FFFFFF')
  const family = customFontFamily(context, props)
  const minimum = Math.min(context.project.canvas.width, context.project.canvas.height)
  const headlineSize = Math.max(58, Math.round(minimum * 0.112))
  const bodySize = Math.max(24, Math.round(minimum * 0.035))
  const targets: string[] = []
  let visualMarkup = ''

  if (beat.visual.kind === 'asset' && beat.visual.assetId) {
    const asset = context.assets.get(beat.visual.assetId)!
    if (asset.kind === 'video') {
      const media = renderVideoLayer(context, {
        domKey: `${key}-visual`,
        hfId: `scene:${scene.id}:beat:${beat.id}:visual`,
        assetId: asset.id,
        startFrame: globalStart,
        durationFrames: beat.durationFrames,
        zIndex: scene.zIndex,
        fit: 'cover',
      })
      context.nodes.push(media.node)
      targets.push(media.targetId)
    } else {
      visualMarkup = `<img class="hf-template-media" src="${escapeAttribute(
        sourceFor(context, asset.id),
      )}" alt="" draggable="false" />`
    }
  }

  const eyebrow =
    beat.variant ??
    optionalStringProp(props, 'eyebrow', 120) ??
    (style === 'cinematic' ? 'THE STORY STARTS NOW' : 'PAY ATTENTION')
  const headline = beat.headline ?? 'A stronger opening starts here.'
  const body = beat.body ?? ''
  const grid = booleanProp(props, 'showGrid', style === 'kinetic')
    ? '<div class="hf-grid" aria-hidden="true"></div>'
    : ''
  context.nodes.push(`<article ${visualTiming(
    context,
    clipId,
    globalStart,
    beat.durationFrames,
    `scene:${scene.id}:beat:${beat.id}`,
    `clip hf-scene-clip hf-hook hf-hook-${style} hf-hook-energy-${energy}`,
  )} style="z-index:${
    scene.zIndex + 1
  };--hf-accent:${escapeAttribute(accent)};--hf-hook-bg:${escapeAttribute(
    background,
  )};--hf-hook-text:${escapeAttribute(textColor)}">
  <div id="${targetId}" class="hf-transition-target">
    <div class="hf-hook-backdrop"></div>
    ${visualMarkup}
    <div class="hf-template-scrim"></div>
    ${grid}
    <div id="${contentId}" data-hf-id="${escapeAttribute(
      `scene:${scene.id}:beat:${beat.id}:content`,
    )}" class="hf-hook-content" style="font-family:${escapeAttribute(
      cssFamily(family),
    )}">
      <div class="hf-hook-eyebrow" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:beat:${beat.id}:eyebrow`,
      )}">${escapeHtml(eyebrow)}</div>
      <div class="hf-hook-rule"></div>
      <h1 class="hf-hook-headline" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:beat:${beat.id}:headline`,
      )}" style="font-size:${headlineSize}px">${highlightedHookText(
        beat,
        'headline',
        headline,
      )}</h1>
      ${
        body
          ? `<p class="hf-hook-body" data-hf-id="${escapeAttribute(
              `scene:${scene.id}:beat:${beat.id}:body`,
            )}" style="font-size:${bodySize}px">${highlightedHookText(
              beat,
              'body',
              body,
            )}</p>`
          : ''
      }
    </div>
  </div>
</article>`)
  targets.push(targetId)
  addSimpleEntrance(
    context,
    contentId,
    globalStart,
    beat.durationFrames,
    style,
    energy,
  )
  return {
    targets,
    contentId,
    startFrame: globalStart,
    durationFrames: beat.durationFrames,
  }
}

function renderSingleHook(
  context: BuildContext,
  scene: VideoScene,
  templateId: HyperframesHookTemplateId,
  props: JsonObject,
): void {
  const beat: HookBeat = {
    id: `${scene.id}-beat`,
    startFrame: 0,
    durationFrames: scene.durationFrames,
    headline: stringProp(props, 'headline', 'A stronger opening starts here.', 500),
    body:
      optionalStringProp(props, 'subheadline', 280) ??
      optionalStringProp(props, 'body', 2000),
    variant: optionalStringProp(props, 'eyebrow', 120),
    visual: assetIdProp(props, 'assetId')
      ? { kind: 'asset', assetId: assetIdProp(props, 'assetId')! }
      : { kind: 'none' },
  }
  const rendered = renderHookBeat(context, scene, templateId, props, beat)
  context.sceneTargets.set(scene.id, {
    entrance: rendered.targets,
    exit: rendered.targets,
  })
}

function transitionOffset(direction: VideoTransition['direction'], amount: number): {
  x: number
  y: number
  origin: string
} {
  switch (direction ?? 'left') {
    case 'right':
      return { x: amount, y: 0, origin: '100% 50%' }
    case 'up':
      return { x: 0, y: -amount, origin: '50% 0%' }
    case 'down':
      return { x: 0, y: amount, origin: '50% 100%' }
    case 'left':
      return { x: -amount, y: 0, origin: '0% 50%' }
  }
}

function easing(value: VideoTransition['easing']): string {
  switch (value) {
    case 'linear':
      return 'none'
    case 'ease-in':
      return 'power2.in'
    case 'ease-out':
      return 'power2.out'
    case 'ease-in-out':
    default:
      return 'power2.inOut'
  }
}

function renderDipOverlay(
  context: BuildContext,
  id: string,
  startFrame: number,
  durationFrames: number,
): void {
  if (durationFrames < 1) return
  const clipId = `transition-overlay-${safeDomToken(id)}-${context.nextOverlay}`
  context.nextOverlay += 1
  const innerId = `${clipId}-inner`
  context.nodes.push(`<section ${visualTiming(
    context,
    clipId,
    startFrame,
    durationFrames,
    `transition:${id}:black`,
    'clip hf-scene-clip hf-transition-overlay',
  )} style="z-index:2147483000">
  <div id="${innerId}" class="hf-dip-black"></div>
</section>`)
  const fps = context.project.canvas.fps
  const at = startFrame / fps
  const half = durationFrames / fps / 2
  addOperation(context, {
    kind: 'fromTo',
    elementId: innerId,
    at,
    from: { opacity: 0 },
    to: { opacity: 1, duration: half, ease: 'power2.in', immediateRender: false },
  })
  addOperation(context, {
    kind: 'to',
    elementId: innerId,
    at: at + half,
    to: { opacity: 0, duration: half, ease: 'power2.out' },
  })
}

function addTransitionOperations(
  context: BuildContext,
  input: {
    id: string
    type: VideoTransition['type']
    direction?: VideoTransition['direction']
    easing?: VideoTransition['easing']
    startFrame: number
    durationFrames: number
    fromTargets: string[]
    toTargets: string[]
  },
): void {
  if (input.type === 'cut' || input.durationFrames < 1) return
  const fps = context.project.canvas.fps
  const at = input.startFrame / fps
  const duration = input.durationFrames / fps
  const ease = easing(input.easing)
  const amount =
    input.direction === 'up' || input.direction === 'down'
      ? context.project.canvas.height
      : context.project.canvas.width
  const offset = transitionOffset(input.direction, amount)

  const addFromTo = (
    target: string,
    from: AnimationValues,
    to: AnimationValues,
  ): void => {
    addOperation(context, {
      kind: 'fromTo',
      elementId: target,
      at,
      from,
      to: { ...to, duration, ease, immediateRender: false },
    })
  }

  switch (input.type) {
    case 'fade':
      for (const target of input.fromTargets) addFromTo(target, { opacity: 1 }, { opacity: 0 })
      for (const target of input.toTargets) addFromTo(target, { opacity: 0 }, { opacity: 1 })
      break
    case 'slide':
      for (const target of input.fromTargets) {
        addFromTo(target, { x: 0, y: 0 }, { x: offset.x, y: offset.y })
      }
      for (const target of input.toTargets) {
        addFromTo(target, { x: -offset.x, y: -offset.y }, { x: 0, y: 0 })
      }
      break
    case 'wipe': {
      const axis = input.direction === 'up' || input.direction === 'down' ? 'scaleY' : 'scaleX'
      for (const target of input.fromTargets) {
        addFromTo(target, { opacity: 1 }, { opacity: 0 })
      }
      for (const target of input.toTargets) {
        addFromTo(
          target,
          { [axis]: 0, transformOrigin: offset.origin },
          { [axis]: 1, transformOrigin: offset.origin },
        )
      }
      break
    }
    case 'zoom':
      for (const target of input.fromTargets) {
        addFromTo(target, { opacity: 1, scale: 1 }, { opacity: 0, scale: 1.08 })
      }
      for (const target of input.toTargets) {
        addFromTo(target, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 })
      }
      break
    case 'blur':
      // GSAP animates the `filter` shorthand, and blur is composited on the GPU, so
      // this stays seek-safe: any frame's blur radius is a pure function of progress.
      for (const target of input.fromTargets) {
        addFromTo(
          target,
          { opacity: 1, filter: 'blur(0px)' },
          { opacity: 0, filter: 'blur(18px)' },
        )
      }
      for (const target of input.toTargets) {
        addFromTo(
          target,
          { opacity: 0, filter: 'blur(18px)' },
          { opacity: 1, filter: 'blur(0px)' },
        )
      }
      break
    case 'dip-to-black':
      for (const target of input.fromTargets) {
        addFromTo(target, { opacity: 1 }, { opacity: 0 })
      }
      for (const target of input.toTargets) {
        addFromTo(target, { opacity: 0 }, { opacity: 1 })
      }
      renderDipOverlay(context, input.id, input.startFrame, input.durationFrames)
      break
  }
}

function addHookTransition(
  context: BuildContext,
  scene: VideoScene,
  beat: HookBeat,
  current: RenderedHookBeat,
  next: RenderedHookBeat | undefined,
): void {
  const transition = beat.transitionOut
  if (!transition || transition.type === 'cut' || transition.durationFrames < 1) return
  const half = Math.max(1, Math.floor(transition.durationFrames / 2))
  const boundary = current.startFrame + current.durationFrames
  const outgoingStart = Math.max(current.startFrame, boundary - half)
  addTransitionOperations(context, {
    id: `hook:${scene.id}:${beat.id}:out`,
    type: transition.type === 'dip-to-black' ? 'fade' : transition.type,
    direction: transition.direction,
    easing: transition.easing,
    startFrame: outgoingStart,
    durationFrames: boundary - outgoingStart,
    fromTargets: current.targets,
    toTargets: [],
  })
  if (next) {
    const incomingDuration = Math.min(
      transition.durationFrames - (boundary - outgoingStart),
      next.durationFrames,
    )
    if (incomingDuration > 0) {
      addTransitionOperations(context, {
        id: `hook:${scene.id}:${beat.id}:in`,
        type: transition.type === 'dip-to-black' ? 'fade' : transition.type,
        direction: transition.direction,
        easing: transition.easing,
        startFrame: next.startFrame,
        durationFrames: incomingDuration,
        fromTargets: [],
        toTargets: next.targets,
      })
    }
  }
  if (transition.type === 'dip-to-black') {
    const overlayStart = Math.max(scene.startFrame, boundary - half)
    const overlayDuration = Math.min(
      transition.durationFrames,
      scene.startFrame + scene.durationFrames - overlayStart,
    )
    renderDipOverlay(
      context,
      `hook:${scene.id}:${beat.id}`,
      overlayStart,
      overlayDuration,
    )
  }
}

function renderHookPlan(
  context: BuildContext,
  scene: VideoScene,
  templateId: HyperframesHookTemplateId,
  props: JsonObject,
  plan: HookPlan,
): void {
  const rendered = plan.beats.map((beat) =>
    renderHookBeat(context, scene, templateId, props, beat),
  )
  for (let index = 0; index < plan.beats.length; index += 1) {
    addHookTransition(context, scene, plan.beats[index]!, rendered[index]!, rendered[index + 1])
  }
  context.sceneTargets.set(scene.id, {
    entrance: rendered[0]?.targets ?? [],
    exit: rendered.at(-1)?.targets ?? [],
  })
}

function renderSceneTemplate(
  context: BuildContext,
  scene: VideoScene,
  templateId: Exclude<HyperframesVisualTemplateId, HyperframesHookTemplateId>,
  props: JsonObject,
): void {
  const key = `template-${scene.id}`
  const clipId = `clip-${safeDomToken(key)}`
  const targetId = `target-${safeDomToken(key)}`
  const contentId = `content-${safeDomToken(key)}`
  const accent = colorProp(props, 'accent', '#FFD166')
  const background = colorProp(props, 'background', '#090B10')
  const textColor = colorProp(props, 'textColor', '#FFFFFF')
  const family = customFontFamily(context, props)
  const minimum = Math.min(context.project.canvas.width, context.project.canvas.height)
  let body = ''
  if (templateId === 'scene-stat-card') {
    body = `<div class="hf-stat-value" data-hf-id="${escapeAttribute(
      `scene:${scene.id}:value`,
    )}" style="font-size:${Math.round(
      minimum * 0.2,
    )}px">${escapeHtml(stringProp(props, 'value', '10×', 80))}</div>
      <div class="hf-stat-label" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:label`,
      )}">${escapeHtml(stringProp(props, 'label', 'THE RESULT', 240))}</div>
      <p class="hf-template-body" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:body`,
      )}">${escapeHtml(stringProp(props, 'body', '', 1000))}</p>`
  } else if (templateId === 'scene-quote-card') {
    body = `<div class="hf-quote-mark">“</div>
      <blockquote data-hf-id="${escapeAttribute(
        `scene:${scene.id}:quote`,
      )}" style="font-size:${Math.round(minimum * 0.075)}px">${escapeHtml(
        stringProp(props, 'quote', 'Make the first seconds impossible to ignore.', 1000),
      )}</blockquote>
      <div class="hf-attribution" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:attribution`,
      )}">${escapeHtml(
        stringProp(props, 'attribution', '', 240),
      )}</div>`
  } else {
    body = `<div class="hf-hook-eyebrow" data-hf-id="${escapeAttribute(
      `scene:${scene.id}:eyebrow`,
    )}">${escapeHtml(
      stringProp(props, 'eyebrow', '', 120),
    )}</div>
      <h1 class="hf-scene-title" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:headline`,
      )}" style="font-size:${Math.round(
        minimum * 0.105,
      )}px">${escapeHtml(stringProp(props, 'headline', 'Title', 500))}</h1>
      <p class="hf-template-body" data-hf-id="${escapeAttribute(
        `scene:${scene.id}:body`,
      )}">${escapeHtml(stringProp(props, 'body', '', 2000))}</p>`
  }

  const backgroundAssetId = assetIdProp(props, 'assetId')
  let mediaMarkup = ''
  const targets: string[] = []
  if (backgroundAssetId) {
    const asset = context.assets.get(backgroundAssetId)!
    if (asset.kind === 'video') {
      const media = renderVideoLayer(context, {
        domKey: `${key}-visual`,
        hfId: `scene:${scene.id}:visual`,
        assetId: asset.id,
        startFrame: scene.startFrame,
        durationFrames: scene.durationFrames,
        zIndex: scene.zIndex,
        fit: 'cover',
      })
      context.nodes.push(media.node)
      targets.push(media.targetId)
    } else {
      mediaMarkup = `<img class="hf-template-media" src="${escapeAttribute(
        sourceFor(context, asset.id),
      )}" alt="" draggable="false" />`
    }
  }

  context.nodes.push(`<article ${visualTiming(
    context,
    clipId,
    scene.startFrame,
    scene.durationFrames,
    `scene:${scene.id}`,
    `clip hf-scene-clip hf-scene-template hf-${templateId}`,
  )} style="z-index:${
    scene.zIndex + 1
  };--hf-accent:${escapeAttribute(accent)};--hf-hook-bg:${escapeAttribute(
    background,
  )};--hf-hook-text:${escapeAttribute(textColor)}">
  <div id="${targetId}" class="hf-transition-target">
    <div class="hf-hook-backdrop"></div>
    ${mediaMarkup}
    <div class="hf-template-scrim"></div>
    <div id="${contentId}" data-hf-id="${escapeAttribute(
      `scene:${scene.id}:content`,
    )}" class="hf-scene-template-content" style="font-family:${escapeAttribute(
      cssFamily(family),
    )}">
      ${body}
    </div>
  </div>
</article>`)
  targets.push(targetId)
  context.sceneTargets.set(scene.id, { entrance: targets, exit: targets })
  addSimpleEntrance(context, contentId, scene.startFrame, scene.durationFrames, 'editorial')
}

function renderTemplateScene(context: BuildContext, scene: VideoScene): void {
  const templateId = scene.template!.id
  const props = scene.template!.props
  if (isHyperframesHookTemplateId(templateId)) {
    const plan = hookPlanForScene(scene)
    if (plan) renderHookPlan(context, scene, templateId, props, plan)
    else renderSingleHook(context, scene, templateId, props)
    return
  }
  if (isHyperframesSceneTemplateId(templateId)) {
    renderSceneTemplate(context, scene, templateId, props)
  }
}

function captionPresetClass(templateId: HyperframesCaptionTemplateId): string {
  return `hf-caption-${hyperframesCaptionStyle(templateId)}`
}

function captionDefaultColor(
  word: CaptionWord,
  style: CaptionStyleDefinition,
): string {
  return (word.importance ?? 0) > 0 ? style.importantColor : style.textColor
}

function captionFontFamily(fontFamily: CaptionStyleDefinition['fontFamily']): string {
  if (fontFamily === 'Anton') return cssFamily('HF Anton')
  if (fontFamily === 'Hanken Grotesk') return cssFamily('HF Hanken')
  if (fontFamily === 'JetBrains Mono') return cssFamily('HF JetBrains')
  return cssFamily('HF Space')
}

function captionEntrance(
  style: CaptionStyleDefinition,
): {
  entrance: 'kinetic' | 'editorial' | 'cinematic' | 'standard'
  energy: 'restrained' | 'balanced' | 'intense'
} {
  if (style.entrance === 'pop') return { entrance: 'kinetic', energy: 'intense' }
  if (style.entrance === 'wipe') return { entrance: 'editorial', energy: 'balanced' }
  if (style.entrance === 'fade') return { entrance: 'cinematic', energy: 'restrained' }
  return { entrance: 'standard', energy: 'restrained' }
}

function captionTemplateProps(project: VideoProject): JsonObject {
  const scene = project.scenes.find(
    (candidate) =>
      candidate.kind === 'caption' &&
      candidate.template?.id === project.captions?.templateId,
  )
  return scene?.template?.props ?? {}
}

function renderCaptions(context: BuildContext): void {
  if (!context.project.captions || context.project.captions.words.length === 0) return
  const document = context.project.captions
  const props = captionTemplateProps(context.project)
  const templateId = (document.templateId ??
    HYPERFRAMES_CAPTION_TEMPLATE_IDS[0]) as HyperframesCaptionTemplateId
  const words = new Map(document.words.map((word) => [word.id, word]))
  const style = resolveCaptionStyle(templateId, props)
  const cues = groupCaptionCues(
    document,
    captionGroupingOptionsForStyle(style, context.project.canvas.fps),
  )
  const captionStyle = hyperframesCaptionStyle(templateId)
  const entrance = captionEntrance(style)
  for (const cue of cues) {
    const key = `caption-${cue.id}`
    const clipId = `clip-${safeDomToken(key)}`
    const innerId = `content-${safeDomToken(key)}`
    const cueWords = cue.wordIds.map((id) => words.get(id)!).filter(Boolean)
    const metrics = captionLayoutMetrics(
      style,
      context.project.canvas.width,
      context.project.canvas.height,
      cue.lines.map((line) => [...line.text].length),
    )
    const lineHtml = cue.lines.map((line, lineIndex) => {
      const spans = line.wordIds.map((wordId, wordIndex) => {
        const word = words.get(wordId)!
        const id = `caption-word-${safeDomToken(word.id)}`
        const importance = word.importance ?? 0
        const leadingSpace = wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : ''
        const backgroundSize = style.activeTreatment === 'underline' ? '0% .12em' : '0% 100%'
        return `${leadingSpace}<span id="${id}" data-hf-id="${escapeAttribute(
          `caption-word:${word.id}`,
        )}" class="hf-caption-word${
          importance > 0 ? ` hf-important hf-important-${importance}` : ''
        }" data-word-id="${escapeAttribute(word.id)}" style="color:${captionDefaultColor(
          word,
          style,
        )};font-weight:${importance > 0 ? Math.max(style.fontWeight, 800) : style.fontWeight};background-size:${backgroundSize}">${escapeHtml(word.text)}</span>`
      }).join('')
      return `<div class="hf-caption-line" data-hf-id="${escapeAttribute(
        `caption:${cue.id}:line:${lineIndex}`,
      )}">${spans}</div>`
    }).join('')
    const sectionLayout = style.placement === 'center'
      ? `align-items:center;justify-content:center;padding:${metrics.safeInset}px`
      : `align-items:center;justify-content:flex-end;padding:0 ${metrics.safeInset}px ${metrics.bottomOffset}px`
    context.nodes.push(`<section ${visualTiming(
      context,
      clipId,
      cue.startFrame,
      cue.endFrame - cue.startFrame,
      `caption:${cue.id}`,
      `clip hf-scene-clip hf-caption-clip ${captionPresetClass(templateId)}`,
    )} data-caption-style="${escapeAttribute(captionStyle)}" style="z-index:2147482000;font-size:${metrics.fontSize}px;${sectionLayout}">
  <div id="${innerId}" data-hf-id="${escapeAttribute(
    `caption:${cue.id}:page`,
  )}" class="hf-caption-inner" style="max-width:${metrics.maxWidth}px;font-family:${captionFontFamily(
    style.fontFamily,
  )};font-weight:${style.fontWeight};color:${style.textColor};text-transform:${style.uppercase ? 'uppercase' : 'none'}">${lineHtml}</div>
</section>`)
    addSimpleEntrance(
      context,
      innerId,
      cue.startFrame,
      cue.endFrame - cue.startFrame,
      entrance.entrance,
      entrance.energy,
    )
    for (const word of cueWords) {
      const wordId = `caption-word-${safeDomToken(word.id)}`
      const activeDuration = Math.min(
        0.1,
        Math.max(1 / context.project.canvas.fps, (word.endFrame - word.startFrame) / context.project.canvas.fps / 3),
      )
      const important = (word.importance ?? 0) > 0
      const activeTo: AnimationValues = {
        color: style.activeColor,
        scale: important ? 1.14 : 1.07,
        duration: activeDuration,
        ease: 'power2.out',
      }
      if (style.activeTreatment === 'punch') {
        Object.assign(activeTo, {
          y: important ? -10 : -6,
          backgroundColor: 'rgba(0,0,0,0.76)',
          boxShadow: important
            ? `0 0 0 4px ${style.importantColor}`
            : '0 0 0 0 rgba(0,0,0,0)',
          scale: important ? 1.24 : 1.16,
          ease: 'back.out(2.2)',
        })
      } else if (style.activeTreatment === 'pill') {
        Object.assign(activeTo, {
          color: readableTextColor(style.activeColor),
          backgroundImage: `linear-gradient(${style.activeColor},${style.activeColor})`,
          backgroundSize: '100% 100%',
          scale: important ? 1.1 : 1.04,
        })
      } else if (style.activeTreatment === 'neon') {
        Object.assign(activeTo, {
          color: important ? style.importantColor : style.activeColor,
          textShadow: important
            ? `0 0 10px ${style.importantColor},0 0 24px ${style.importantColor}`
            : `0 0 8px ${style.activeColor},0 0 18px ${style.activeColor}`,
          scale: important ? 1.16 : 1.08,
        })
      } else if (style.activeTreatment === 'burst') {
        Object.assign(activeTo, {
          y: important ? -8 : -4,
          color: important ? style.importantColor : style.activeColor,
          boxShadow: `-18px -12px 0 -7px ${style.activeColor},18px -10px 0 -7px ${style.importantColor},16px 13px 0 -8px ${style.activeColor},-14px 14px 0 -8px ${style.importantColor}`,
          scale: important ? 1.25 : 1.14,
          ease: 'back.out(2.5)',
        })
      } else if (style.activeTreatment === 'weight') {
        Object.assign(activeTo, {
          color: important ? style.importantColor : style.activeColor,
          fontWeight: important ? 900 : 800,
          letterSpacing: important ? '-0.04em' : '-0.02em',
          scale: important ? 1.1 : 1.04,
        })
      } else if (style.activeTreatment === 'underline') {
        Object.assign(activeTo, {
          color: important ? style.importantColor : style.activeColor,
          backgroundImage: `linear-gradient(${style.activeColor},${style.activeColor})`,
          backgroundSize: '100% .12em',
          fontWeight: important ? 900 : 800,
          scale: 1.04,
        })
      } else if (style.activeTreatment === 'clean') {
        Object.assign(activeTo, {
          color: important ? style.importantColor : style.activeColor,
          fontWeight: important ? 850 : 800,
          scale: 1,
        })
      }
      const oneFrameWord = word.endFrame - word.startFrame === 1
      if (oneFrameWord) {
        delete activeTo.duration
        delete activeTo.ease
      }
      addOperation(context, {
        kind: oneFrameWord ? 'set' : 'to',
        elementId: wordId,
        at: word.startFrame / context.project.canvas.fps,
        to: activeTo,
      })
      addOperation(context, {
        kind: 'to',
        elementId: wordId,
        at: word.endFrame / context.project.canvas.fps,
        to: {
          color: captionDefaultColor(word, style),
          backgroundColor: 'rgba(0,0,0,0)',
          backgroundImage: 'linear-gradient(transparent,transparent)',
          backgroundSize: style.activeTreatment === 'underline' ? '0% .12em' : '0% 100%',
          boxShadow: '0 0 0 0 rgba(0,0,0,0)',
          textShadow: '0 0 0 rgba(0,0,0,0)',
          y: 0,
          rotation: 0,
          fontWeight: important ? Math.max(style.fontWeight, 800) : style.fontWeight,
          letterSpacing: '0em',
          scale: 1,
          duration: 1 / context.project.canvas.fps,
          ease: 'none',
        },
      })
    }
  }
}

function applyProjectTransitions(context: BuildContext): void {
  for (const transition of context.project.transitions) {
    const from = context.sceneTargets.get(transition.fromSceneId)
    const to = context.sceneTargets.get(transition.toSceneId)
    if (!from || !to) continue
    addTransitionOperations(context, {
      id: transition.id,
      type: transition.type,
      direction: transition.direction,
      easing: transition.easing,
      startFrame: transition.startFrame,
      durationFrames: transition.durationFrames,
      fromTargets: from.exit,
      toTargets: to.entrance,
    })
  }
}

function renderScenes(context: BuildContext): void {
  const tracks = new Map(context.project.tracks.map((track) => [track.id, track]))
  const sorted = [...context.project.scenes].sort((left, right) => {
    const leftTrack = tracks.get(left.trackId)?.order ?? 0
    const rightTrack = tracks.get(right.trackId)?.order ?? 0
    return (
      left.zIndex - right.zIndex ||
      leftTrack - rightTrack ||
      left.startFrame - right.startFrame ||
      left.id.localeCompare(right.id)
    )
  })
  for (const scene of sorted) {
    switch (scene.kind) {
      case 'media':
        renderMediaScene(context, scene)
        break
      case 'audio':
        renderAudioScene(context, scene)
        break
      case 'template':
        renderTemplateScene(context, scene)
        break
      case 'text':
      case 'solid':
        renderPlainScene(context, scene)
        break
      case 'caption':
        // Caption scenes carry preset props and visibility windows. The
        // word-timed caption document is rendered once in renderCaptions().
        break
    }
  }
}

function customFontCss(context: BuildContext): string {
  return [...context.customFonts.entries()]
    .map(
      ([family, source]) =>
        `@font-face{font-family:${cssFamily(family)};src:url(${JSON.stringify(
          source,
        )}) format("woff2");font-style:normal;font-weight:100 900;font-display:block;}`,
    )
    .join('\n')
}

function compositionCss(context: BuildContext): string {
  const { width, height } = context.project.canvas
  const safe = Math.round(Math.min(width, height) * 0.07)
  const captionBottom = Math.round(height * 0.09)
  return `
@font-face{font-family:"HF Space";src:url("./vendor/space-grotesk-400.woff2") format("woff2");font-style:normal;font-weight:400;font-display:block}
@font-face{font-family:"HF Space";src:url("./vendor/space-grotesk-700.woff2") format("woff2");font-style:normal;font-weight:700;font-display:block}
@font-face{font-family:"HF Anton";src:url("./vendor/anton-400.woff2") format("woff2");font-style:normal;font-weight:400;font-display:block}
@font-face{font-family:"HF Hanken";src:url("./vendor/hanken-grotesk-700.woff2") format("woff2");font-style:normal;font-weight:700;font-display:block}
@font-face{font-family:"HF Hanken";src:url("./vendor/hanken-grotesk-800.woff2") format("woff2");font-style:normal;font-weight:800;font-display:block}
@font-face{font-family:"HF JetBrains";src:url("./vendor/jetbrains-mono-700.woff2") format("woff2");font-style:normal;font-weight:700;font-display:block}
${customFontCss(context)}
*{box-sizing:border-box}
html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#000}
body{font-family:"HF Space";color:#fff}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;isolation:isolate}
.clip{position:absolute;inset:0;width:100%;height:100%;visibility:hidden}
.hf-base-background{position:absolute;inset:0;background:var(--hfBackground)}
.hf-scene-clip{overflow:hidden}
.hf-transition-target,.hf-scene-transform,.hf-media-shell{position:absolute;inset:0;width:100%;height:100%}
.hf-scene-transform{overflow:hidden}
.hf-image,.hf-video,.hf-template-media{position:absolute;inset:0;width:100%;height:100%;display:block}
.hf-image,.hf-template-media{object-fit:cover}
.hf-video{visibility:hidden}
.hf-solid{position:absolute;inset:0}
.hf-plain-text{position:absolute;inset:${safe}px;display:grid;place-items:center;text-align:center;font-weight:700;white-space:pre-wrap;line-height:1.03;text-wrap:balance}
.hf-plain-caption{align-items:end;padding-bottom:${captionBottom}px;text-shadow:0 3px 12px rgba(0,0,0,.8)}
.hf-hook-backdrop{position:absolute;inset:0;background:var(--hf-hook-bg)}
.hf-template-scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.74),rgba(0,0,0,.15))}
.hf-grid{position:absolute;inset:0;opacity:.13;background-image:linear-gradient(rgba(255,255,255,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.35) 1px,transparent 1px);background-size:${Math.max(
    48,
    Math.round(Math.min(width, height) * 0.08),
  )}px ${Math.max(48, Math.round(Math.min(width, height) * 0.08))}px}
.hf-hook-content,.hf-scene-template-content{position:absolute;inset:${safe}px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;color:var(--hf-hook-text)}
.hf-hook-content{max-width:${Math.round(width * 0.86)}px}
.hf-hook-eyebrow,.hf-stat-label,.hf-attribution{font-size:${Math.max(
    18,
    Math.round(Math.min(width, height) * 0.025),
  )}px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--hf-accent)}
.hf-hook-rule{width:${Math.round(Math.min(width, height) * 0.12)}px;height:${Math.max(
    4,
    Math.round(Math.min(width, height) * 0.007),
  )}px;margin:${Math.round(Math.min(width, height) * 0.025)}px 0;background:var(--hf-accent)}
.hf-hook-headline,.hf-scene-title{max-width:${Math.round(
    width * 0.84,
  )}px;margin:0;font-family:"HF Anton","HF Space";font-weight:400;line-height:.94;letter-spacing:-.015em;text-transform:uppercase;text-wrap:balance}
.hf-hook-body,.hf-template-body{max-width:${Math.round(width * 0.66)}px;margin:${Math.round(
    Math.min(width, height) * 0.035,
  )}px 0 0;line-height:1.32;text-wrap:balance}
.hf-hook-important{color:var(--hf-accent)}
.hf-hook-editorial .hf-hook-content{justify-content:flex-end;padding-bottom:${safe}px}
.hf-hook-cinematic .hf-hook-content{align-items:center;text-align:center;max-width:none}
.hf-hook-cinematic .hf-template-scrim{background:rgba(0,0,0,.5)}
.hf-hook-cinematic .hf-hook-headline,.hf-hook-cinematic .hf-hook-body{max-width:${Math.round(
    width * 0.8,
  )}px}
.hf-scene-template-content{max-width:${Math.round(width * 0.82)}px}
.hf-stat-value{font-family:"HF Anton","HF Space";line-height:.9;color:var(--hf-accent)}
.hf-stat-label{margin-top:${Math.round(Math.min(width, height) * 0.025)}px}
.hf-quote-mark{font-family:"HF Space";font-size:${Math.round(
    Math.min(width, height) * 0.18,
  )}px;line-height:.5;color:var(--hf-accent)}
blockquote{max-width:${Math.round(width * 0.78)}px;margin:${Math.round(
    Math.min(width, height) * 0.04,
  )}px 0;line-height:1.12;font-weight:700;text-wrap:balance}
.hf-caption-clip{display:flex;align-items:flex-end;justify-content:center;padding:0 ${safe}px ${captionBottom}px;pointer-events:none}
.hf-caption-inner{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.12em;max-width:${Math.round(
    width * 0.88,
  )}px;padding:.34em .55em;color:var(--hfCaptionText);font-weight:700;line-height:1.08;text-align:center;text-shadow:0 .08em .24em rgba(0,0,0,.9)}
.hf-caption-line{display:block;max-width:100%;overflow-wrap:anywhere;text-wrap:balance}
.hf-caption-word{display:inline-block;transform-origin:50% 70%;padding:.08em .04em;border-radius:.18em;background-repeat:no-repeat;background-position:left bottom}
.hf-caption-emoji-pop{align-items:center;padding-bottom:0}
.hf-caption-emoji-pop .hf-caption-inner{font-family:"HF Anton","HF Space";font-weight:700;text-transform:uppercase;background:transparent}
.hf-caption-emoji-pop .hf-caption-word{padding:.08em .14em;-webkit-text-stroke:.025em rgba(0,0,0,.72)}
.hf-caption-clip-wipe .hf-caption-inner{background:rgba(2,4,8,.86);border-radius:.28em;box-shadow:0 .28em .8em rgba(0,0,0,.34)}
.hf-caption-clip-wipe .hf-caption-word{padding:.1em .14em}
.hf-caption-highlight .hf-caption-inner{background:rgba(0,0,0,.34);border-radius:.32em}
.hf-caption-highlight .hf-important{color:var(--hfCaptionImportant);text-decoration:underline;text-decoration-thickness:.08em;text-underline-offset:.12em}
.hf-caption-neon-accent .hf-caption-inner{font-family:"HF Anton","HF Space";text-transform:uppercase;background:rgba(3,5,14,.58);border:.025em solid rgba(255,255,255,.2);border-radius:.24em}
.hf-caption-neon-accent .hf-important{color:var(--hfCaptionImportant);text-shadow:0 0 .2em var(--hfCaptionImportant)}
.hf-caption-particle-burst{align-items:center;padding-bottom:0}
.hf-caption-particle-burst .hf-caption-inner{font-family:"HF Anton","HF Space";font-weight:700;text-transform:uppercase;background:transparent}
.hf-caption-particle-burst .hf-caption-word{padding:.08em .13em}
.hf-caption-weight-shift .hf-caption-inner{font-family:"HF Space";font-weight:480;letter-spacing:0;background:rgba(0,0,0,.28);border-radius:.26em}
.hf-caption-weight-shift .hf-important{font-weight:760;color:var(--hfCaptionImportant)}
.hf-caption-motivation-bold .hf-caption-inner{background:rgba(0,0,0,.18);border-radius:.2em;-webkit-text-stroke:.02em rgba(0,0,0,.72)}
.hf-caption-mindset-pill .hf-caption-inner{background:rgba(22,14,45,.62);border:1px solid rgba(167,139,250,.3);border-radius:.3em}
.hf-caption-progress-underline .hf-caption-inner{background:rgba(3,12,18,.48);border-radius:.24em}
.hf-caption-coach-clean .hf-caption-inner{background:rgba(0,0,0,.3);border-radius:.24em;text-shadow:0 .06em .2em rgba(0,0,0,.85)}
.hf-important-2,.hf-important-3{font-weight:700}
.hf-important-3{text-decoration-color:var(--hfCaptionImportant)}
.hf-transition-overlay{pointer-events:none}
.hf-dip-black{position:absolute;inset:0;background:#000;opacity:0}
`
}

function timelineScript(
  compositionId: string,
  operations: readonly AnimationOperation[],
): string {
  return `<script>
(function () {
  "use strict";
  if (!window.gsap) throw new Error("HyperFrames composition could not load GSAP");
  var timeline = window.gsap.timeline({ paused: true });
  var operations = ${scriptJson(operations)};
  for (var index = 0; index < operations.length; index += 1) {
    var operation = operations[index];
    var element = document.getElementById(operation.elementId);
    if (!element) throw new Error("Missing trusted animation target: " + operation.elementId);
    if (operation.kind === "fromTo") {
      timeline.fromTo(element, operation.from || {}, operation.to, operation.at);
    } else if (operation.kind === "set") {
      timeline.set(element, operation.to, operation.at);
    } else {
      timeline.to(element, operation.to, operation.at);
    }
  }
  window.__timelines = window.__timelines || {};
  window.__timelines[${scriptJson(compositionId)}] = timeline;
})();
</script>`
}

export function compileHyperframesProject(
  projectInput: VideoProject,
  options: HyperframesCompileOptions = {},
): HyperframesCompiledComposition {
  const project = VideoProjectSchema.parse(projectInput)
  const validation = validateHyperframesProject(project)
  const errors = validation.filter((candidate) => candidate.severity === 'error')
  if (errors.length > 0) {
    throw new Error(
      `HyperFrames project is not renderable: ${errors
        .slice(0, 8)
        .map((candidate) => candidate.message)
        .join('; ')}`,
    )
  }
  const sources = sourceMap(options.assetSources)
  const referencedAssetIds = collectHyperframesAssetIds(project)
  for (const id of referencedAssetIds) {
    if (!sources.has(id)) throw new Error(`No prepared local source for asset: ${id}`)
  }
  const captionProps = captionTemplateProps(project)
  const variables: HyperframesCompileVariables = {
    ...DEFAULT_VARIABLES,
    hfBackground: project.canvas.backgroundColor,
    hfCaptionText: colorProp(
      captionProps,
      'textColor',
      DEFAULT_VARIABLES.hfCaptionText,
    ),
    hfCaptionAccent: colorProp(
      captionProps,
      'activeColor',
      DEFAULT_VARIABLES.hfCaptionAccent,
    ),
    hfCaptionImportant: colorProp(
      captionProps,
      'importantColor',
      DEFAULT_VARIABLES.hfCaptionImportant,
    ),
    ...options.variables,
  }
  for (const [id, value] of Object.entries(variables)) {
    if (!isHexColor(value)) throw new Error(`HyperFrames variable ${id} must be a hex color`)
  }
  const compositionId = `mental-empire-${safeDomToken(project.id)}`
  const context: BuildContext = {
    project,
    assets: new Map(project.assets.map((asset) => [asset.id, asset])),
    sources,
    variables,
    nodes: [],
    operations: [],
    sceneTargets: new Map(),
    customFonts: new Map(),
    nextTrack: 1,
    nextOverlay: 0,
  }

  context.nodes.push(`<section id="clip-project-background" class="clip hf-base-background" data-start="0" data-duration="${seconds(
    project.canvas.durationFrames,
    project.canvas.fps,
  )}" data-track-index="0" data-hf-id="project:${escapeAttribute(project.id)}:background"></section>`)
  renderScenes(context)
  applyProjectTransitions(context)
  renderCaptions(context)
  context.operations.sort(
    (left, right) =>
      left.at - right.at ||
      left.elementId.localeCompare(right.elementId) ||
      left.kind.localeCompare(right.kind),
  )

  const declarations = [
    {
      id: 'hfBackground',
      type: 'color',
      label: 'Canvas background',
      default: variables.hfBackground,
    },
    {
      id: 'hfCaptionText',
      type: 'color',
      label: 'Caption text',
      default: variables.hfCaptionText,
    },
    {
      id: 'hfCaptionAccent',
      type: 'color',
      label: 'Caption accent',
      default: variables.hfCaptionAccent,
    },
    {
      id: 'hfCaptionImportant',
      type: 'color',
      label: 'Important caption words',
      default: variables.hfCaptionImportant,
    },
  ]
  const duration = seconds(project.canvas.durationFrames, project.canvas.fps)
  const html = `<!doctype html>
<html lang="en" data-composition-variables='${JSON.stringify(declarations)}'>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${project.canvas.width}, height=${project.canvas.height}" />
  <title>${escapeHtml(project.name)}</title>
  <script src="./vendor/gsap.min.js"></script>
  <style>${compositionCss(context)}</style>
</head>
<body>
  <div id="root" data-composition-id="${escapeAttribute(
    compositionId,
  )}" data-start="0" data-width="${project.canvas.width}" data-height="${
    project.canvas.height
  }" data-duration="${duration}" data-fps="${
    project.canvas.fps
  }" data-hf-id="project:${escapeAttribute(project.id)}">
    ${context.nodes.join('\n    ')}
  </div>
  ${timelineScript(compositionId, context.operations)}
</body>
</html>
`
  return {
    html,
    compositionId,
    durationFrames: project.canvas.durationFrames,
    width: project.canvas.width,
    height: project.canvas.height,
    fps: project.canvas.fps,
    referencedAssetIds,
    variables,
  }
}

export const HYPERFRAMES_SUPPORTED_FPS = Object.freeze([...SUPPORTED_FPS])
export const HYPERFRAMES_TEMPLATE_VERSION_SUPPORTED = HYPERFRAMES_TEMPLATE_VERSION
