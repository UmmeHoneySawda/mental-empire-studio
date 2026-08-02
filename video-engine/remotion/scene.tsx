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
import {
  resolveTextMotion,
  splitForTextMotion,
  textMotionSplit,
  textMotionStyle,
  textMotionUnitCount,
} from './textMotion'

function stringProp(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberProp(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A text clip. Style comes from the `remotion-text-*` template the editor attaches; with
 *  no template it falls back to the heading look this scene has always used, so projects
 *  written before the styles existed keep rendering identically.
 *
 *  Motion comes from `textMotion.ts`. A motion that splits the copy renders one span per
 *  unit; the seven that do not keep the single-element output — and the exact numbers —
 *  this scene has always produced. The per-unit styles are plain function calls, never
 *  hooks, because the unit count changes on every keystroke in the inspector's text box and
 *  a hook inside that loop would break React's hook order and blank the composition. */
function TextScene({ scene }: { readonly scene: VideoScene }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const props = scene.template?.props
  const motion = resolveTextMotion(stringProp(props?.['animation']))
  const fontSize = numberProp(props?.['fontSize'])
  const split = textMotionSplit(motion)
  const groups = splitForTextMotion(scene.text ?? '', split)
  const unitCount = textMotionUnitCount(groups)
  const entrance = textMotionStyle(motion, frame, fps)

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
          // A split motion animates its units, so the block itself stays neutral.
          ...(split === 'none'
            ? {
                opacity: entrance.opacity,
                transform: entrance.transform,
                ...(entrance.filter ? { filter: entrance.filter } : {}),
              }
            : {}),
        }}
      >
        {split === 'none'
          ? scene.text
          : groups.map((group, groupIndex) => (
              // The group is the unbreakable run — a word, or the whitespace after it — so
              // per-character units still wrap at spaces instead of mid-word.
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
                        ...(style.filter ? { filter: style.filter } : {}),
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
    /* The PLAN decides, not the template id.
     *
     * This used to be `HOOK_TEMPLATE_IDS.has(id) || hasValidHookPlan(scene)`, and the id
     * test short-circuiting first is what made the premade hooks draw nothing at all:
     * `HookTemplate` returns null without a plan, and the only path that attaches one is
     * the hook compiler. Placing "30s Kinetic Hook" from the templates panel goes through
     * `instantiateTemplate`, which hands the scene its manifest defaults and no plan — so
     * the id matched, the plan did not exist, and the fallback that would have drawn the
     * headline was unreachable. An empty frame, and a success notice.
     *
     * Ordering the tests this way makes a plan-less hook degrade to the same trusted
     * fallback every other template gets, which is what the HyperFrames compiler already
     * did (`renderSingleHook`). Both engines now behave the same. */
    if (hasValidHookPlan(scene)) {
      return <HookTemplate project={project} scene={scene} />
    }
    return <TrustedTemplateFallback scene={scene} />
  }

  const asset = project.assets.find((candidate) => candidate.id === scene.assetId)
  if (!asset) return null

  const track = project.tracks.find((candidate) => candidate.id === scene.trackId)
  const muted = track?.muted ?? false

  if (scene.kind === 'audio' || asset.kind === 'audio') {
    return <AudioAsset asset={asset} scene={scene} muted={muted} />
  }

  return <VisualAsset asset={asset} scene={scene} muted={muted} />
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
