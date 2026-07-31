import type { CSSProperties } from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { AnimatedText } from 'remotion-bits'
import type {
  JsonValue,
  VideoProject,
  VideoScene,
} from '../../shared/video-engine'
import { AudioAsset, sceneTransformStyle, VisualAsset } from './asset'
import { HOOK_TEMPLATE_IDS } from './constants'
import { hasValidHookPlan, HookTemplate } from './hook'

function stringProp(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberProp(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Entrance motion for a text scene, by the `animation` prop its style template carries.
 *  Every curve is a pure function of the frame, so a seek lands on exactly the same
 *  picture a sequential render would produce. */
function textEntrance(
  animation: string,
  frame: number,
  fps: number,
): { opacity: number; transform: string; filter?: string } {
  // Roughly a third of a second: long enough to read as motion, short enough that a
  // three-second title is not still animating when it should be legible.
  const runway = Math.max(1, Math.round(fps * 0.35))
  const t = interpolate(frame, [0, runway], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  switch (animation) {
    case 'none':
      return { opacity: 1, transform: 'none' }
    case 'fade':
      return { opacity: t, transform: 'none' }
    case 'drop':
      return { opacity: t, transform: `translateY(${interpolate(t, [0, 1], [-60, 0])}px)` }
    case 'scale':
      return { opacity: t, transform: `scale(${interpolate(t, [0, 1], [0.9, 1])})` }
    case 'blur-in':
      return {
        opacity: t,
        transform: 'none',
        filter: `blur(${interpolate(t, [0, 1], [14, 0])}px)`,
      }
    case 'slide-left':
      return { opacity: t, transform: `translateX(${interpolate(t, [0, 1], [80, 0])}px)` }
    case 'rise':
    default:
      return { opacity: t, transform: `translateY(${interpolate(t, [0, 1], [28, 0])}px)` }
  }
}

/** A text clip. Style comes from the `remotion-text-*` template the editor attaches; with
 *  no template it falls back to the heading look this scene has always used, so projects
 *  written before the styles existed keep rendering identically. */
function TextScene({ scene }: { readonly scene: VideoScene }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const props = scene.template?.props
  const animation = stringProp(props?.['animation']) ?? 'none'
  const fontSize = numberProp(props?.['fontSize'])
  const entrance = textEntrance(animation, frame, fps)

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '7%',
        ...sceneTransformStyle(scene),
      }}
    >
      <div
        style={{
          maxWidth: '92%',
          color: stringProp(props?.['color']) ?? scene.color ?? '#FFFFFF',
          fontFamily: `"${stringProp(props?.['fontFamily']) ?? 'Space Grotesk'}", "Arial Black", Arial, sans-serif`,
          // An explicit size is in composition pixels; without one keep the viewport-
          // relative default so the text scales with the canvas.
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
          opacity: entrance.opacity,
          transform: entrance.transform,
          ...(entrance.filter ? { filter: entrance.filter } : {}),
        }}
      >
        {scene.text}
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
  const sweep = interpolate(frame, [0, fps * 2], [-35, 135], {
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
        ...sceneTransformStyle(scene),
      }}
    >
      <AbsoluteFill
        style={{
          opacity: 0.12,
          background: `linear-gradient(110deg, transparent ${sweep - 20}%, ${accent} ${sweep}%, transparent ${sweep + 20}%)`,
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          padding: '8%',
          transform: `translateY(${(1 - entrance) * 50}px)`,
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
        <AnimatedText
          transition={{
            opacity: [0, 1],
            y: [44, 0],
            blur: [8, 0],
            duration: Math.max(8, Math.round(fps * 0.6)),
            easing: 'easeOutCubic',
          }}
          style={{
            maxWidth: '84%',
            fontSize: Math.max(52, Math.min(126, width * 0.075)),
            fontWeight: 800,
            lineHeight: 0.96,
            letterSpacing: '-0.055em',
          }}
        >
          {headline}
        </AnimatedText>
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
}: {
  readonly project: VideoProject
  readonly scene: VideoScene
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
    if (
      HOOK_TEMPLATE_IDS.has(scene.template?.id ?? '') ||
      hasValidHookPlan(scene)
    ) {
      return <HookTemplate project={project} scene={scene} />
    }
    return <TrustedTemplateFallback scene={scene} />
  }

  const asset = project.assets.find((candidate) => candidate.id === scene.assetId)
  if (!asset) return null

  if (scene.kind === 'audio' || asset.kind === 'audio') {
    return <AudioAsset asset={asset} scene={scene} />
  }

  return <VisualAsset asset={asset} scene={scene} />
}

export function sceneLayerStyle(
  project: VideoProject,
  scene: VideoScene,
): CSSProperties {
  const trackOrder =
    project.tracks.find((track) => track.id === scene.trackId)?.order ?? 0
  return {
    zIndex: trackOrder * 100_000 + scene.zIndex,
  }
}
