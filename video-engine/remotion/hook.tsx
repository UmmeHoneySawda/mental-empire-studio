import type { CSSProperties, ReactNode } from 'react'
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  HookPlanSchema,
  type HookBeat,
  type HookPlan,
  type VideoProject,
  type VideoScene,
} from '../../shared/video-engine'
import { sceneTransformStyle, VisualAsset } from './asset'

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
  return (
    plan.beats.find(
      (beat) =>
        frame >= beat.startFrame && frame < beat.startFrame + beat.durationFrames,
    ) ?? null
  )
}

function paletteFor(variant: string | undefined): {
  accent: string
  accentSoft: string
  background: string
} {
  switch (variant) {
    case 'warning':
    case 'urgent':
      return {
        accent: '#FF4D35',
        accentSoft: '#FFB21A',
        background: '#190504',
      }
    case 'luxury':
    case 'cinematic':
      return {
        accent: '#EBCB83',
        accentSoft: '#FFF2C9',
        background: '#090A0D',
      }
    case 'clean':
    case 'minimal':
      return {
        accent: '#1CE1C5',
        accentSoft: '#B9FFF5',
        background: '#071210',
      }
    default:
      return {
        accent: '#B8FF35',
        accentSoft: '#E8FFB9',
        background: '#07090D',
      }
  }
}

function normalizedToken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
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
  const parts = children.split(/(\s+)/)
  let tokenIndex = 0
  return (
    <>
      {parts.map((part, index) => {
        const isWhitespace = /^\s+$/u.test(part)
        const deterministicId = `${beatId}:${field}:${tokenIndex}`
        const important =
          !isWhitespace &&
          (importantIds.has(deterministicId) ||
            fallbackImportantTexts.has(normalizedToken(part)))
        if (!isWhitespace) tokenIndex += 1
        return (
          <span
            // The text plus index is stable even when the same word repeats.
            key={`${part}:${index}`}
            style={
              important
                ? {
                    color: accent,
                    textShadow: `0 0 28px ${accent}55`,
                  }
                : undefined
            }
          >
            {part}
          </span>
        )
      })}
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
        ? `translateX(${-distance}px)`
        : direction === 'right'
          ? `translateX(${distance}px)`
          : direction === 'up'
            ? `translateY(${-distance}px)`
            : `translateY(${distance}px)`
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
  beat,
  project,
  scene,
  children,
}: {
  readonly beat: HookBeat
  readonly project: VideoProject
  readonly scene: VideoScene
  readonly children: ReactNode
}) {
  const asset =
    beat.visual.kind === 'asset'
      ? project.assets.find((candidate) => candidate.id === beat.visual.assetId)
      : undefined

  return (
    <AbsoluteFill>
      {asset ? (
        <VisualAsset
          asset={asset}
          scene={{ ...scene, transform: undefined, opacity: 1 }}
          muted
        />
      ) : null}
      {children}
    </AbsoluteFill>
  )
}

export function HookTemplate({
  project,
  scene,
}: {
  readonly project: VideoProject
  readonly scene: VideoScene
}) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const plan = hookPlanFromScene(scene)
  if (!plan) return null

  const planFrame = (frame * plan.fps) / fps
  const beat = activeBeat(plan, planFrame)
  if (!beat) return null

  const beatFrame = planFrame - beat.startFrame
  const enter = spring({
    fps: plan.fps,
    frame: beatFrame,
    config: { damping: 18, stiffness: 170, mass: 0.7 },
    durationInFrames: Math.max(8, Math.min(24, beat.durationFrames)),
  })
  const palette = paletteFor(beat.variant)
  const importantIds = new Set(beat.importantWordIds ?? [])
  const fallbackImportantTexts = new Set(
    (project.captions?.words ?? [])
      .filter((word) => importantIds.has(word.id))
      .map((word) => normalizedToken(word.text)),
  )
  const headlineSize = Math.max(48, Math.min(132, Math.round(width * 0.074)))
  const visualScale = interpolate(
    beatFrame,
    [0, Math.max(1, beat.durationFrames)],
    [1.08, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  const contentExit = exitStyle(beat, planFrame)

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        backgroundColor: palette.background,
        color: '#FFFFFF',
        fontFamily: '"Space Grotesk", "Arial Black", Arial, sans-serif',
        ...sceneTransformStyle(scene),
      }}
    >
      <HookVisual beat={beat} project={project} scene={scene}>
        <AbsoluteFill
          style={{
            transform: `scale(${visualScale})`,
            background: assetOverlay(beat.visual.kind, palette),
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'linear-gradient(90deg, rgba(2,3,7,0.94) 0%, rgba(2,3,7,0.64) 48%, rgba(2,3,7,0.14) 100%)',
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.28,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.07) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
            transform: `translateY(${(planFrame * 0.4) % 72}px)`,
          }}
        />

        <AbsoluteFill
          style={{
            justifyContent: 'center',
            padding: '8%',
            ...contentExit,
          }}
        >
          <div
            style={{
              width: 112,
              height: 10,
              marginBottom: 34,
              borderRadius: 999,
              background: palette.accent,
              boxShadow: `0 0 42px ${palette.accent}99`,
              transform: `scaleX(${enter})`,
              transformOrigin: 'left center',
            }}
          />
          {beat.headline ? (
            <div
              style={{
                maxWidth: '88%',
                fontSize: headlineSize,
                fontWeight: 800,
                lineHeight: 0.94,
                letterSpacing: '-0.055em',
                textTransform: 'uppercase',
                opacity: enter,
                transform: `translateY(${(1 - enter) * 64}px)`,
                textShadow: '0 12px 60px rgba(0,0,0,.55)',
              }}
            >
              <ImportantText
                importantIds={importantIds}
                fallbackImportantTexts={fallbackImportantTexts}
                beatId={beat.id}
                field="headline"
                accent={palette.accent}
              >
                {beat.headline}
              </ImportantText>
            </div>
          ) : null}
          {beat.body ? (
            <div
              style={{
                maxWidth: '70%',
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
                transform: `translateY(${(1 - enter) * 34}px)`,
              }}
            >
              <ImportantText
                importantIds={importantIds}
                fallbackImportantTexts={fallbackImportantTexts}
                beatId={beat.id}
                field="body"
                accent={palette.accent}
              >
                {beat.body}
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
          {String(plan.beats.indexOf(beat) + 1).padStart(2, '0')} /{' '}
          {String(plan.beats.length).padStart(2, '0')}
        </div>
      </HookVisual>
    </AbsoluteFill>
  )
}

function assetOverlay(
  kind: HookBeat['visual']['kind'],
  palette: ReturnType<typeof paletteFor>,
): string {
  if (kind === 'asset') {
    return `radial-gradient(circle at 75% 48%, ${palette.accent}18, transparent 48%)`
  }
  if (kind === 'broll') {
    return `radial-gradient(circle at 72% 38%, ${palette.accent}40, transparent 38%), linear-gradient(135deg, ${palette.background}, #121926)`
  }
  return `radial-gradient(circle at 74% 42%, ${palette.accent}33, transparent 38%), linear-gradient(135deg, ${palette.background}, #111725)`
}
