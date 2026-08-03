import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  HookPlanSchema,
  hexColorWithAlpha,
  hookPaletteFor,
  resolveHookStyle,
  type HookBeat,
  type HookBackgroundPreset,
  type HookPlan,
  type HookPalette,
  type VideoAsset,
  type VideoProject,
  type VideoScene,
} from '../../shared/video-engine'
import { sceneTransformStyle, VisualAsset } from './asset'
import { hookEntranceProgress, hookMotionValues } from './hook-motion'

function hookPlanFromScene(scene: VideoScene): HookPlan | null {
  const props = scene.template?.props
  if (!props) return null

  for (const candidate of [props, props['hookPlan'], props['plan']]) {
    const parsed = HookPlanSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }
  return null
}

export function hasValidHookPlan(scene: VideoScene): boolean {
  return hookPlanFromScene(scene) !== null
}

function activeBeat(plan: HookPlan, frame: number): HookBeat | null {
  let low = 0
  let high = plan.beats.length - 1
  while (low <= high) {
    const index = Math.floor((low + high) / 2)
    const beat = plan.beats[index]!
    if (frame < beat.startFrame) {
      high = index - 1
    } else if (frame >= beat.startFrame + beat.durationFrames) {
      low = index + 1
    } else {
      return beat
    }
  }
  return null
}

function backgroundStyle(preset: HookBackgroundPreset, palette: HookPalette): CSSProperties {
  if (preset === 'solid') return { backgroundColor: palette.background }
  if (preset === 'grid') {
    return {
      backgroundColor: palette.background,
      backgroundImage: `radial-gradient(circle at 76% 42%, ${hexColorWithAlpha(palette.accent, 42 / 255)}, transparent 42%)`,
    }
  }
  if (preset === 'spotlight') {
    return {
      backgroundColor: palette.background,
      backgroundImage: `radial-gradient(circle at 68% 30%, ${hexColorWithAlpha(palette.accent, 66 / 255)} 0%, ${hexColorWithAlpha(palette.accent, 18 / 255)} 24%, transparent 58%), linear-gradient(135deg, ${palette.background}, #030407)`,
    }
  }
  if (preset === 'split') {
    return {
      backgroundColor: palette.background,
      backgroundImage: `linear-gradient(90deg, ${palette.background} 0%, ${palette.background} 58%, ${hexColorWithAlpha(palette.accent, 36 / 255)} 58%, #02060D 100%)`,
    }
  }
  return {
    backgroundColor: palette.background,
    backgroundImage: `radial-gradient(circle at 78% 24%, ${hexColorWithAlpha(palette.accent, 69 / 255)}, transparent 42%), linear-gradient(135deg, ${palette.background}, #05070E 72%)`,
  }
}

function templateEyebrow(templateId: string): string {
  if (templateId.includes('motivational')) return 'MOMENTUM'
  if (templateId.includes('psychological')) return 'MIND SHIFT'
  if (templateId.includes('self-improvement')) return 'PROGRESS PATH'
  if (templateId.includes('educational')) return 'LESSON / 01'
  if (templateId.includes('cinematic')) return 'A SHORT FILM'
  if (templateId.includes('custom')) return 'CUSTOM HOOK'
  return 'WATCH THIS'
}

function normalizedToken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

interface ImportantTextPart {
  readonly text: string
  readonly important: boolean
  readonly key: string
}

function prepareImportantText(
  text: string,
  importantIds: ReadonlySet<string>,
  fallbackImportantTexts: ReadonlySet<string>,
  beatId: string,
  field: 'headline' | 'body',
): readonly ImportantTextPart[] {
  const parts = text.split(/(\s+)/)
  const output: ImportantTextPart[] = []
  let tokenIndex = 0
  let plain = ''
  const flushPlain = (): void => {
    if (!plain) return
    output.push({ text: plain, important: false, key: `plain:${output.length}` })
    plain = ''
  }

  for (const [index, part] of parts.entries()) {
    const isWhitespace = /^\s+$/u.test(part)
    const deterministicId = `${beatId}:${field}:${tokenIndex}`
    const important =
      !isWhitespace &&
      (importantIds.has(deterministicId) ||
        fallbackImportantTexts.has(normalizedToken(part)))
    if (!isWhitespace) tokenIndex += 1

    if (important) {
      flushPlain()
      output.push({ text: part, important: true, key: `${part}:${index}` })
    } else {
      plain += part
    }
  }
  flushPlain()
  return output
}

function ImportantText({
  children,
  importantIds,
  fallbackImportantTexts,
  beatId,
  field,
  accent,
}: {
  readonly children: string
  readonly importantIds: ReadonlySet<string>
  readonly fallbackImportantTexts: ReadonlySet<string>
  readonly beatId: string
  readonly field: 'headline' | 'body'
  readonly accent: string
}) {
  const parts = useMemo(
    () => prepareImportantText(
      children,
      importantIds,
      fallbackImportantTexts,
      beatId,
      field,
    ),
    [children, importantIds, fallbackImportantTexts, beatId, field],
  )
  return (
    <>
      {parts.map((part) => (
        <Fragment key={part.key}>
          {part.important ? <span style={{ color: accent }}>{part.text}</span> : part.text}
        </Fragment>
      ))}
    </>
  )
}

function exitStyle(beat: HookBeat, frame: number): CSSProperties {
  const transition = beat.transitionOut
  if (!transition || transition.durationFrames < 1) return {}
  const transitionStart =
    beat.startFrame + beat.durationFrames - transition.durationFrames
  const progress = interpolate(
    frame,
    [transitionStart, beat.startFrame + beat.durationFrames],
    [0, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.ease),
    },
  )

  if (transition.type === 'slide') {
    const distance = progress * 140
    const direction = transition.direction ?? 'left'
    const translate =
      direction === 'left'
        ? `translate3d(${-distance}px, 0, 0)`
        : direction === 'right'
          ? `translate3d(${distance}px, 0, 0)`
          : direction === 'up'
            ? `translate3d(0, ${-distance}px, 0)`
            : `translate3d(0, ${distance}px, 0)`
    return { opacity: 1 - progress, transform: translate }
  }
  if (transition.type === 'wipe') {
    return {
      clipPath: `inset(0 ${progress * 100}% 0 0)`,
    }
  }
  if (transition.type === 'zoom') {
    return {
      opacity: 1 - progress,
      transform: `scale(${1 + progress * 0.18})`,
    }
  }
  if (transition.type === 'dip-to-black' || transition.type === 'fade') {
    return { opacity: 1 - progress }
  }
  return {}
}

function HookVisual({
  asset,
  scene,
  visualScale,
  children,
}: {
  readonly asset: VideoAsset | undefined
  readonly scene: VideoScene
  readonly visualScale: number
  readonly children: ReactNode
}) {
  return (
    <AbsoluteFill>
      {asset ? (
        <AbsoluteFill style={{ transform: `scale(${visualScale})` }}>
          <VisualAsset
            asset={asset}
            scene={{ ...scene, transform: undefined, opacity: 1 }}
            muted
          />
        </AbsoluteFill>
      ) : null}
      {children}
    </AbsoluteFill>
  )
}

function alignmentOverlay(alignment: 'left' | 'center' | 'right'): string {
  if (alignment === 'right') {
    return 'linear-gradient(270deg, rgba(2,3,7,0.84) 0%, rgba(2,3,7,0.38) 56%, rgba(2,3,7,0.05) 100%)'
  }
  if (alignment === 'center') {
    return 'radial-gradient(circle at center, rgba(2,3,7,0.2), rgba(2,3,7,0.62))'
  }
  return 'linear-gradient(90deg, rgba(2,3,7,0.84) 0%, rgba(2,3,7,0.38) 56%, rgba(2,3,7,0.05) 100%)'
}

function HookBeatFrame({
  project,
  scene,
  plan,
  beat,
  planFrame,
  width,
  assetById,
}: {
  readonly project: VideoProject
  readonly scene: VideoScene
  readonly plan: HookPlan
  readonly beat: HookBeat
  readonly planFrame: number
  readonly width: number
  readonly assetById?: ReadonlyMap<string, VideoAsset>
}) {
  const beatFrame = planFrame - beat.startFrame
  const templateProps = scene.template?.props
  const staticData = useMemo(() => {
    const style = resolveHookStyle(plan.templateId, templateProps ?? {})
    const importantIds = new Set(beat.importantWordIds ?? [])
    const fallbackImportantTexts = new Set(
      (project.captions?.words ?? [])
        .filter((word) => importantIds.has(word.id))
        .map((word) => normalizedToken(word.text)),
    )
    const asset = beat.visual.kind === 'asset' && beat.visual.assetId
      ? assetById?.get(beat.visual.assetId)
        ?? project.assets.find((candidate) => candidate.id === beat.visual.assetId)
      : undefined
    return {
      style,
      palette: hookPaletteFor(style, beat.variant),
      importantIds,
      fallbackImportantTexts,
      asset,
      headline: beat.headline
        ?? (typeof templateProps?.['headline'] === 'string' ? templateProps['headline'] : ''),
      body: beat.body
        ?? (typeof templateProps?.['subheadline'] === 'string' ? templateProps['subheadline'] : ''),
      beatNumber: plan.beats.indexOf(beat) + 1,
    }
  }, [assetById, beat, plan, project.assets, project.captions, templateProps])
  const { style, palette } = staticData
  const enter = hookEntranceProgress({
    fps: plan.fps,
    frame: beatFrame,
    durationFrames: beat.durationFrames,
    energy: style.energy,
  })
  const motion = hookMotionValues(style.animationPreset, enter, style.alignment)
  const canvasScale = Math.max(0.72, Math.min(1.25, width / 1920))
  const headlineSize = Math.round(style.fontSize * canvasScale)
  const visualScale = interpolate(
    beatFrame,
    [0, Math.max(1, beat.durationFrames)],
    [1.08, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const contentExit = exitStyle(beat, planFrame)
  const combinedOverlay = `${alignmentOverlay(style.alignment)}, ${assetOverlay(beat.visual.kind, palette)}`

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        ...backgroundStyle(style.backgroundPreset, palette),
        color: palette.text,
        fontFamily: `"${style.fontFamily}", "Space Grotesk", Arial, sans-serif`,
        contain: 'layout style',
        isolation: 'isolate',
        ...sceneTransformStyle(scene),
      }}
    >
      <HookVisual
        asset={staticData.asset}
        scene={scene}
        visualScale={visualScale}
      >
        <AbsoluteFill style={{ background: combinedOverlay }} />
        {style.backgroundPreset === 'grid' ? (
          <AbsoluteFill style={{ overflow: 'hidden', opacity: 0.34 }}>
            <AbsoluteFill
              style={{
                inset: -72,
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
                backgroundSize: '72px 72px',
                transform: `translate3d(0, ${(planFrame * 0.4) % 72}px, 0)`,
              }}
            />
          </AbsoluteFill>
        ) : null}

        <AbsoluteFill
          style={{
            justifyContent: style.position === 'top' ? 'flex-start' : style.position === 'bottom' ? 'flex-end' : 'center',
            alignItems: style.alignment === 'left' ? 'flex-start' : style.alignment === 'right' ? 'flex-end' : 'center',
            textAlign: style.alignment,
            padding: '8%',
            contain: 'layout style',
            ...contentExit,
          }}
        >
          <div
            style={{
              marginBottom: 18,
              color: palette.accent,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: Math.max(15, Math.round(width * 0.011)),
              fontWeight: 600,
              letterSpacing: '0.18em',
              opacity: enter,
            }}
          >
            {templateEyebrow(plan.templateId)}
          </div>
          <div
            style={{
              width: 112,
              height: 10,
              marginBottom: 34,
              borderRadius: 999,
              background: palette.accent,
              transform: `scaleX(${enter})`,
              transformOrigin: style.alignment === 'right' ? 'right center' : style.alignment === 'center' ? 'center' : 'left center',
            }}
          />
          {staticData.headline ? (
            <div
              style={{
                maxWidth: style.backgroundPreset === 'split' ? '54%' : style.alignment === 'center' ? '84%' : '88%',
                fontSize: headlineSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                letterSpacing: style.letterSpacing,
                textTransform: plan.templateId.includes('motivational') || plan.templateId.includes('kinetic') ? 'uppercase' : 'none',
                opacity: motion.opacity,
                transform: `translate3d(${motion.translateX}px, ${motion.translateY}px, 0) scale(${motion.scale}) rotate(${motion.rotate}deg)`,
                clipPath: style.animationPreset === 'cinematic' ? `inset(${(1 - motion.reveal) * 100}% 0 0)` : undefined,
                textShadow: '0 12px 60px rgba(0,0,0,.55)',
              }}
            >
              <ImportantText
                importantIds={staticData.importantIds}
                fallbackImportantTexts={staticData.fallbackImportantTexts}
                beatId={beat.id}
                field="headline"
                accent={palette.accent}
              >
                {staticData.headline}
              </ImportantText>
            </div>
          ) : null}
          {staticData.body ? (
            <div
              style={{
                maxWidth: style.backgroundPreset === 'split' ? '50%' : '70%',
                marginTop: 30,
                color: palette.accentSoft,
                fontSize: Math.max(24, Math.min(46, width * 0.027)),
                fontWeight: 500,
                lineHeight: 1.2,
                letterSpacing: '-0.02em',
                opacity: interpolate(enter, [0.3, 1], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                }),
                transform: `translate3d(0, ${(1 - enter) * 34}px, 0)`,
              }}
            >
              <ImportantText
                importantIds={staticData.importantIds}
                fallbackImportantTexts={staticData.fallbackImportantTexts}
                beatId={beat.id}
                field="body"
                accent={palette.accent}
              >
                {staticData.body}
              </ImportantText>
            </div>
          ) : null}
        </AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            right: '5%',
            bottom: '5%',
            color: 'rgba(255,255,255,.62)',
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: Math.max(16, width * 0.012),
            letterSpacing: '0.12em',
          }}
        >
          {String(staticData.beatNumber).padStart(2, '0')} /{' '}
          {String(plan.beats.length).padStart(2, '0')}
        </div>
      </HookVisual>
    </AbsoluteFill>
  )
}

export function HookTemplate({
  project,
  scene,
  assetById,
}: {
  readonly project: VideoProject
  readonly scene: VideoScene
  readonly assetById?: ReadonlyMap<string, VideoAsset>
}) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const plan = useMemo(() => hookPlanFromScene(scene), [scene])
  if (!plan) return null

  const planFrame = (frame * plan.fps) / fps
  const beat = activeBeat(plan, planFrame)
  if (!beat) return null

  return (
    <HookBeatFrame
      project={project}
      scene={scene}
      plan={plan}
      beat={beat}
      planFrame={planFrame}
      width={width}
      assetById={assetById}
    />
  )
}

function assetOverlay(
  kind: HookBeat['visual']['kind'],
  palette: HookPalette,
): string {
  if (kind === 'asset') {
    return `radial-gradient(circle at 75% 48%, ${hexColorWithAlpha(palette.accent, 24 / 255)}, transparent 48%)`
  }
  if (kind === 'broll') {
    return `radial-gradient(circle at 72% 38%, ${hexColorWithAlpha(palette.accent, 64 / 255)}, transparent 38%), linear-gradient(135deg, ${palette.background}, #121926)`
  }
  return `radial-gradient(circle at 74% 42%, ${hexColorWithAlpha(palette.accent, 51 / 255)}, transparent 38%), linear-gradient(135deg, ${palette.background}, #111725)`
}
