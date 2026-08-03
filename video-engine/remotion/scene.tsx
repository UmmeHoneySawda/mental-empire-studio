import { useMemo, type CSSProperties } from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type {
  JsonValue,
  VideoAsset,
  VideoProject,
  VideoScene,
} from '../../shared/video-engine'
import { AudioAsset, sceneTransformStyle, VisualAsset } from './asset'
import { hasValidHookPlan, HookTemplate } from './hook'
import {
  resolveTextMotion,
  splitForTextMotion,
  textMotionSplit,
  textMotionStyle,
  textMotionUnitCount,
} from './textMotion'

export interface PreparedSceneRenderData {
  readonly asset?: VideoAsset
  readonly muted: boolean
  readonly trackOrder: number
}

function stringProp(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberProp(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function TextScene({ scene }: { readonly scene: VideoScene }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const props = scene.template?.props
  const motion = resolveTextMotion(stringProp(props?.['animation']))
  const fontSize = numberProp(props?.['fontSize'])
  const split = textMotionSplit(motion)
  const { groups, unitCount } = useMemo(() => {
    const nextGroups = splitForTextMotion(scene.text ?? '', split)
    return {
      groups: nextGroups,
      unitCount: textMotionUnitCount(nextGroups),
    }
  }, [scene.text, split])
  const entrance = textMotionStyle(motion, frame, fps)
  const typewriterReveal = motion === 'typewriter'
    ? interpolate(
        frame,
        [0, Math.max(1, fps * 1.2)],
        [0, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
    : 1

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '7%',
        contain: 'layout style',
        isolation: 'isolate',
        ...sceneTransformStyle(scene),
      }}
    >
      <div
        style={{
          maxWidth: '92%',
          color: stringProp(props?.['color']) ?? scene.color ?? '#FFFFFF',
          fontFamily: `"${stringProp(props?.['fontFamily']) ?? 'Space Grotesk'}", "Arial Black", Arial, sans-serif`,
          fontSize: fontSize === undefined ? '7vw' : `${fontSize}px`,
          fontWeight: numberProp(props?.['fontWeight']) ?? 800,
          fontStyle: stringProp(props?.['fontStyle']) ?? 'normal',
          lineHeight: numberProp(props?.['lineHeight']) ?? 0.98,
          letterSpacing:
            props?.['letterSpacing'] === undefined
              ? '-0.05em'
              : `${numberProp(props['letterSpacing']) ?? 0}px`,
          textAlign: (stringProp(props?.['align']) ?? 'center') as CSSProperties['textAlign'],
          whiteSpace: 'pre-wrap',
          textShadow: '0 10px 45px rgba(0,0,0,.55)',
          ...(split === 'none'
            ? {
                opacity: entrance.opacity,
                transform: entrance.transform,
                ...(entrance.filter ? { filter: entrance.filter } : {}),
              }
            : motion === 'typewriter'
              ? {
                  clipPath: `inset(0 ${(1 - typewriterReveal) * 100}% 0 0)`,
                }
              : {}),
        }}
      >
        {split === 'none' || motion === 'typewriter'
          ? scene.text
          : groups.map((group, groupIndex) => (
              <span
                key={`g${groupIndex}`}
                style={{ display: 'inline-block', whiteSpace: 'pre' }}
              >
                {group.units.map((unit, unitIndex) => {
                  const style = textMotionStyle(motion, frame, fps, unit.ordinal, unitCount)
                  return (
                    <span
                      key={`u${unitIndex}`}
                      style={{
                        display: 'inline-block',
                        whiteSpace: 'pre',
                        opacity: style.opacity,
                        transform: style.transform,
                      }}
                    >
                      {unit.text}
                    </span>
                  )
                })}
              </span>
            ))}
      </div>
    </AbsoluteFill>
  )
}

function TrustedTemplateFallback({ scene }: { readonly scene: VideoScene }) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const props = scene.template?.props
  const headline =
    stringProp(props?.['headline']) ??
    stringProp(props?.['title']) ??
    scene.text ??
    scene.template?.id ??
    ''
  const body = stringProp(props?.['body']) ?? stringProp(props?.['subtitle'])
  const accent = stringProp(props?.['accentColor']) ?? '#B8FF35'
  const entrance = spring({
    fps,
    frame,
    config: { damping: 18, stiffness: 180, mass: 0.7 },
    durationInFrames: Math.max(8, Math.round(fps * 0.6)),
  })
  const sweep = interpolate(frame, [0, fps * 2], [-60, 60], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'extend',
  })

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        color: '#FFFFFF',
        background:
          'radial-gradient(circle at 76% 30%, rgba(91,109,255,.35), transparent 35%), linear-gradient(145deg, #080B12, #101827)',
        fontFamily: '"Space Grotesk", Arial, sans-serif',
        contain: 'layout style',
        isolation: 'isolate',
        ...sceneTransformStyle(scene),
      }}
    >
      <AbsoluteFill
        style={{
          left: '-50%',
          width: '200%',
          opacity: 0.12,
          background: `linear-gradient(110deg, transparent 42%, ${accent} 50%, transparent 58%)`,
          transform: `translate3d(${sweep}%, 0, 0)`,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          padding: '8%',
          transform: `translate3d(0, ${(1 - entrance) * 50}px, 0)`,
          opacity: entrance,
        }}
      >
        <div
          style={{
            width: Math.max(70, width * 0.075),
            height: Math.max(6, width * 0.006),
            marginBottom: 30,
            borderRadius: 99,
            background: accent,
          }}
        />
        <div
          style={{
            maxWidth: '84%',
            fontSize: Math.max(52, Math.min(126, width * 0.075)),
            fontWeight: 800,
            lineHeight: 0.96,
            letterSpacing: '-0.055em',
          }}
        >
          {headline}
        </div>
        {body ? (
          <div
            style={{
              maxWidth: '68%',
              marginTop: 28,
              color: 'rgba(255,255,255,.74)',
              fontSize: Math.max(24, Math.min(44, width * 0.027)),
              lineHeight: 1.2,
            }}
          >
            {body}
          </div>
        ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

export function SceneContent({
  project,
  scene,
  prepared,
  assetById,
}: {
  readonly project: VideoProject
  readonly scene: VideoScene
  readonly prepared?: PreparedSceneRenderData
  readonly assetById?: ReadonlyMap<string, VideoAsset>
}) {
  if (scene.kind === 'caption') return null

  if (scene.kind === 'solid') {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: scene.color ?? project.canvas.backgroundColor,
          ...sceneTransformStyle(scene),
        }}
      />
    )
  }

  if (scene.kind === 'text') return <TextScene scene={scene} />

  if (scene.kind === 'template') {
    if (hasValidHookPlan(scene)) {
      return <HookTemplate project={project} scene={scene} assetById={assetById} />
    }
    return <TrustedTemplateFallback scene={scene} />
  }

  const asset = prepared?.asset
    ?? (scene.assetId ? assetById?.get(scene.assetId) : undefined)
    ?? project.assets.find((candidate) => candidate.id === scene.assetId)
  if (!asset) return null

  const muted = prepared?.muted
    ?? project.tracks.find((candidate) => candidate.id === scene.trackId)?.muted
    ?? false

  if (scene.kind === 'audio' || asset.kind === 'audio') {
    return <AudioAsset asset={asset} scene={scene} muted={muted} />
  }

  return <VisualAsset asset={asset} scene={scene} muted={muted} />
}

export function sceneLayerStyle(
  project: VideoProject,
  scene: VideoScene,
  prepared?: PreparedSceneRenderData,
): CSSProperties {
  const trackOrder = prepared?.trackOrder
    ?? project.tracks.find((track) => track.id === scene.trackId)?.order
    ?? 0
  return {
    zIndex: trackOrder * 100_000 + scene.zIndex,
    contain: 'layout style',
    isolation: 'isolate',
  }
}
