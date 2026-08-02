import { useMemo, type CSSProperties } from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  activeCaptionCue,
  captionGroupingOptionsForStyle,
  captionLayoutMetrics,
  captionNeedsLeadingSpace,
  captionWordIsActive,
  captionWordRenderProgress,
  groupCaptionCues,
  hexColorWithAlpha,
  readableTextColor,
  resolveCaptionStyle,
  type CaptionStyleDefinition,
  type CaptionWord,
  type ResolvedCaptionStyle,
  type VideoProject,
  type VideoScene,
} from '../../shared/video-engine'
import { sceneTransformStyle } from './asset'
import { sceneLayerStyle } from './scene'

export function captionLayerZIndex(
  project: VideoProject,
  scene: VideoScene | null | undefined,
): number {
  if (scene) return Number(sceneLayerStyle(project, scene).zIndex ?? 0)
  const highestVisualOrder = Math.max(
    0,
    ...project.tracks.filter((track) => track.kind !== 'audio').map((track) => track.order),
  )
  return (highestVisualOrder + 1) * 100_000
}

function activeCaptionScene(
  project: VideoProject,
  frame: number,
): VideoScene | null | undefined {
  const captionScenes = project.scenes.filter((scene) => scene.kind === 'caption')
  if (captionScenes.length === 0) return undefined
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  return (
    captionScenes.find(
      (scene) =>
        !tracks.get(scene.trackId)?.muted &&
        frame >= scene.startFrame &&
        frame < scene.startFrame + scene.durationFrames,
    ) ?? null
  )
}

function outerStyle(
  style: CaptionStyleDefinition,
  metrics: ReturnType<typeof captionLayoutMetrics>,
): CSSProperties {
  if (style.placement === 'center') {
    return {
      alignItems: 'center',
      justifyContent: 'center',
      padding: metrics.safeInset,
    }
  }
  return {
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: `0 ${metrics.safeInset}px ${metrics.bottomOffset}px`,
  }
}

function pageStyle(
  style: ResolvedCaptionStyle,
  metrics: ReturnType<typeof captionLayoutMetrics>,
): CSSProperties {
  const shared: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.12em',
    maxWidth: metrics.maxWidth,
    padding: '0.28em 0.48em 0.34em',
    color: style.textColor,
    fontFamily: `"${style.fontFamily}", Arial, sans-serif`,
    fontSize: metrics.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: 1.08,
    letterSpacing: style.uppercase ? '-0.025em' : '-0.02em',
    textAlign: 'center',
    textTransform: style.uppercase ? 'uppercase' : undefined,
    textShadow: '0 0.08em 0.24em rgba(0,0,0,.9)',
    transformOrigin: '50% 70%',
  }
  if (style.id === 'clip-wipe') {
    return {
      ...shared,
      background: 'rgba(2,4,8,.86)',
      borderRadius: '0.28em',
      boxShadow: '0 0.28em 0.8em rgba(0,0,0,.34)',
    }
  }
  if (style.id === 'mindset-pill') {
    return {
      ...shared,
      background: 'rgba(22,14,45,.62)',
      border: '1px solid rgba(167,139,250,.3)',
      borderRadius: '0.3em',
    }
  }
  if (style.id === 'neon-accent') {
    return {
      ...shared,
      background: 'rgba(3,5,14,.58)',
      border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '0.24em',
      textShadow: '0 0 0.15em rgba(67,246,255,.48), 0 0.08em 0.24em rgba(0,0,0,.9)',
    }
  }
  if (style.id === 'weight-shift' || style.id === 'coach-clean') {
    return {
      ...shared,
      background: 'rgba(0,0,0,.3)',
      borderRadius: '0.24em',
    }
  }
  if (style.id === 'progress-underline') {
    return {
      ...shared,
      background: 'rgba(3,12,18,.48)',
      borderRadius: '0.24em',
    }
  }
  return shared
}

function pageMotion(
  style: CaptionStyleDefinition,
  frame: number,
  startFrame: number,
  endFrame: number,
  fps: number,
): CSSProperties {
  const localFrame = frame - startFrame
  const duration = Math.max(5, Math.round(fps * 0.28))
  const exit = interpolate(
    frame,
    [Math.max(startFrame, endFrame - Math.max(2, Math.round(fps * 0.12))), endFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  if (style.entrance === 'fade') {
    const opacity = interpolate(localFrame, [0, Math.max(2, Math.round(fps * 0.2))], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    return { opacity: opacity * exit }
  }
  const progress = spring({
    frame: localFrame,
    fps,
    durationInFrames: duration,
    config: style.entrance === 'pop'
      ? { damping: 13, stiffness: 240, mass: 0.7 }
      : { damping: 22, stiffness: 210, mass: 0.72 },
  })
  return {
    opacity: progress * exit,
    transform: style.entrance === 'pop'
      ? `translate3d(0, ${(1 - progress) * 30}px, 0) scale(${0.78 + progress * 0.22})`
      : `translate3d(0, ${(1 - progress) * 24}px, 0) scale(${0.96 + progress * 0.04})`,
    clipPath: style.entrance === 'wipe'
      ? `inset(0 ${(1 - progress) * 100}% 0 0)`
      : undefined,
  }
}

const BURST_MARKS = [
  { left: '-0.22em', top: '-0.2em' },
  { right: '-0.22em', top: '-0.18em' },
  { left: '-0.18em', bottom: '-0.2em' },
  { right: '-0.18em', bottom: '-0.18em' },
] as const

function CaptionToken({
  word,
  style,
  frame,
  fps,
}: {
  readonly word: CaptionWord
  readonly style: ResolvedCaptionStyle
  readonly frame: number
  readonly fps: number
}): JSX.Element {
  const active = captionWordIsActive(word, frame)
  const progress = active ? captionWordRenderProgress(word, frame) : 0
  const importance = word.importance ?? 0
  const important = importance > 0
  const attack = active
    ? Math.min(1, (frame - word.startFrame + 1) / Math.max(1, Math.round(fps * 0.12)))
    : 0
  const activeColor = active ? style.activeColor : important ? style.importantColor : style.textColor
  const pillTextColor = readableTextColor(style.activeColor)
  const isPill = style.activeTreatment === 'pill'
  const isUnderline = style.activeTreatment === 'underline'
  const scale = !active
    ? 1
    : style.activeTreatment === 'punch' || style.activeTreatment === 'burst'
      ? 1 + attack * (important ? 0.2 : 0.14)
      : style.activeTreatment === 'clean'
        ? 1
        : 1 + attack * (important ? 0.1 : 0.06)
  const persistentWeight = important ? Math.max(style.fontWeight, 800) : style.fontWeight

  return (
    <span
      style={{
        position: 'relative',
        isolation: 'isolate',
        zIndex: 0,
        display: 'inline-block',
        padding: isPill ? '0.06em 0.14em 0.09em' : '0.05em 0.04em 0.08em',
        borderRadius: isPill ? '0.18em' : '0.12em',
        color: active && isPill ? pillTextColor : activeColor,
        fontWeight: active && (style.activeTreatment === 'weight' || isUnderline)
          ? Math.max(800, persistentWeight)
          : persistentWeight,
        letterSpacing: active && style.activeTreatment === 'weight' ? '-0.035em' : undefined,
        background: active && (style.activeTreatment === 'punch' || style.activeTreatment === 'burst')
          ? 'rgba(0,0,0,.72)'
          : undefined,
        textDecoration: important && !active && style.activeTreatment === 'highlight'
          ? 'underline'
          : undefined,
        textDecorationThickness: important ? '0.1em' : undefined,
        textUnderlineOffset: important ? '0.12em' : undefined,
        textShadow: active && style.activeTreatment === 'neon'
          ? `0 0 0.14em ${activeColor}, 0 0 0.36em ${activeColor}`
          : active && style.activeTreatment !== 'clean'
            ? `0 0 0.24em ${hexColorWithAlpha(activeColor, 0.53)}, 0 0.08em 0.24em rgba(0,0,0,.9)`
            : undefined,
        transform: `translate3d(0, ${active && (style.activeTreatment === 'punch' || style.activeTreatment === 'burst') ? -attack * 0.08 : 0}em, 0) scale(${scale})`,
        transformOrigin: '50% 75%',
        transition: 'none',
      }}
    >
      {(isPill || isUnderline) && active && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            zIndex: -1,
            left: 0,
            bottom: isUnderline ? '0.02em' : 0,
            width: `${Math.max(8, progress * 100)}%`,
            height: isUnderline ? '0.11em' : '100%',
            borderRadius: isUnderline ? '999px' : '0.18em',
            background: style.activeColor,
          }}
        />
      )}
      {active && style.activeTreatment === 'burst' && BURST_MARKS.map((position, index) => (
        <span
          key={index}
          aria-hidden
          style={{
            position: 'absolute',
            ...position,
            width: '0.1em',
            height: '0.1em',
            borderRadius: index % 2 === 0 ? '50%' : '0.02em',
            background: index % 2 === 0 ? style.activeColor : style.importantColor,
            opacity: attack,
            transform: `scale(${0.4 + attack * 0.6})`,
          }}
        />
      ))}
      <span style={{ position: 'relative', zIndex: 1 }}>{word.text}</span>
    </span>
  )
}

export function CaptionLayer({ project }: { readonly project: VideoProject }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const document = project.captions
  const scene = document && document.words.length > 0 ? activeCaptionScene(project, frame) : null
  const templateId = scene?.template?.id ?? document?.templateId
  const templateProps = scene?.template?.props
  const style = useMemo(
    () => document ? resolveCaptionStyle(templateId, templateProps) : null,
    [document, templateId, templateProps],
  )
  const cues = useMemo(
    () => document && style
      ? groupCaptionCues(document, captionGroupingOptionsForStyle(style, fps))
      : [],
    [document, style, fps],
  )
  const wordById = useMemo(
    () => new Map((document?.words ?? []).map((word) => [word.id, word])),
    [document],
  )

  if (!document || document.words.length === 0 || !style) return null
  if (scene === null) return null
  const cue = activeCaptionCue(cues, frame)
  if (!cue) return null
  const metrics = captionLayoutMetrics(
    style,
    width,
    height,
    cue.lines.map((line) => [...line.text].length),
  )

  return (
    <AbsoluteFill
      style={{
        ...outerStyle(style, metrics),
        ...(scene ? sceneTransformStyle(scene) : {}),
        pointerEvents: 'none',
        zIndex: captionLayerZIndex(project, scene),
      }}
    >
      <div
        data-caption-style={style.id}
        style={{
          ...pageStyle(style, metrics),
          ...pageMotion(style, frame, cue.startFrame, cue.endFrame, fps),
        }}
      >
        {cue.lines.map((line, lineIndex) => {
          const words = line.wordIds
            .map((id) => wordById.get(id))
            .filter((word): word is CaptionWord => Boolean(word))
          return (
            <div
              key={`${cue.id}:line:${lineIndex}`}
              style={{ display: 'block', maxWidth: '100%', overflowWrap: 'anywhere', textWrap: 'balance' }}
            >
              {words.map((word, wordIndex) => (
                <span key={word.id}>
                  {wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : null}
                  <CaptionToken word={word} style={style} frame={frame} fps={fps} />
                </span>
              ))}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
