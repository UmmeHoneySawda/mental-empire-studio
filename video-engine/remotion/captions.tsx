import { useMemo, type CSSProperties } from 'react'
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  groupCaptionCues,
  type CaptionWord,
  type VideoProject,
  type VideoScene,
} from '../../shared/video-engine'
import { sceneTransformStyle } from './asset'

type CaptionPreset =
  | 'emoji-pop'
  | 'clip-wipe'
  | 'highlight'
  | 'neon-accent'
  | 'particle-burst'
  | 'weight-shift'

interface CaptionTheme {
  readonly fontFamily?: string
  readonly textColor?: string
  readonly activeColor?: string
  readonly importantColor?: string
  readonly maxWordsPerCue: number
}

function captionTheme(scene: VideoScene | undefined): CaptionTheme {
  const props = scene?.template?.props
  const text = (key: string): string | undefined => {
    const value = props?.[key]
    return typeof value === 'string' && value.trim() ? value : undefined
  }
  const requestedWords = props?.['maxWordsPerCue']
  return {
    fontFamily: text('fontFamily'),
    textColor: text('textColor'),
    activeColor: text('activeColor'),
    importantColor: text('importantColor'),
    maxWordsPerCue:
      typeof requestedWords === 'number' && Number.isFinite(requestedWords)
        ? Math.max(1, Math.min(12, Math.round(requestedWords)))
        : 6,
  }
}

function presetFromId(id: string | undefined): CaptionPreset {
  const normalized = id?.toLowerCase() ?? ''
  if (normalized.includes('emoji-pop')) return 'emoji-pop'
  if (normalized.includes('clip-wipe')) return 'clip-wipe'
  if (normalized.includes('neon-accent')) return 'neon-accent'
  if (normalized.includes('particle-burst')) return 'particle-burst'
  if (normalized.includes('weight-shift')) return 'weight-shift'
  // Legacy names remain deterministic while new projects use the six manifests.
  if (normalized.includes('karaoke') || normalized.includes('pop')) return 'emoji-pop'
  if (normalized.includes('box') || normalized.includes('cinematic')) {
    return 'clip-wipe'
  }
  return 'highlight'
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

function layoutStyle(
  preset: CaptionPreset,
  width: number,
  theme: CaptionTheme,
): CSSProperties {
  const fontSize = Math.max(32, Math.min(76, width * 0.047))
  const shared: CSSProperties = {
    maxWidth: '88%',
    textAlign: 'center',
    fontFamily:
      theme.fontFamily ??
      '"Hanken Grotesk", "Arial Black", Arial, sans-serif',
    fontSize,
    fontWeight: 800,
    lineHeight: 1.08,
    letterSpacing: '-0.035em',
    color: theme.textColor ?? '#FFFFFF',
    textShadow: '0 4px 18px rgba(0,0,0,.9)',
  }

  switch (preset) {
    case 'clip-wipe':
      return {
        ...shared,
        maxWidth: '82%',
        padding: '0.28em 0.46em 0.34em',
        borderRadius: '0.22em',
        background: 'rgba(2,4,8,.86)',
        boxShadow: '0 14px 45px rgba(0,0,0,.34)',
      }
    case 'emoji-pop':
      return {
        ...shared,
        fontSize: fontSize * 1.13,
        fontWeight: 900,
        textTransform: 'uppercase',
        WebkitTextStroke: `${Math.max(1, width / 900)}px rgba(0,0,0,.72)`,
      }
    case 'weight-shift':
      return {
        ...shared,
        maxWidth: '76%',
        fontSize: fontSize * 0.92,
        fontWeight: 520,
        lineHeight: 1.14,
        letterSpacing: '-0.015em',
      }
    case 'particle-burst':
      return {
        ...shared,
        maxWidth: '90%',
        fontSize: fontSize * 1.08,
        fontWeight: 900,
        textTransform: 'uppercase',
      }
    case 'neon-accent':
      return {
        ...shared,
        fontSize: fontSize * 1.03,
        textTransform: 'uppercase',
        letterSpacing: '-0.025em',
        textShadow:
          '0 0 12px rgba(65,246,255,.65), 0 0 34px rgba(65,246,255,.25), 0 4px 18px rgba(0,0,0,.9)',
      }
    case 'highlight':
    default:
      return shared
  }
}

function verticalPosition(preset: CaptionPreset): CSSProperties {
  if (preset === 'emoji-pop' || preset === 'particle-burst') {
    return { alignItems: 'center', justifyContent: 'center', padding: '6%' }
  }
  return {
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: preset === 'weight-shift' ? '0 5% 7%' : '0 5% 10%',
  }
}

function punctuationWithoutLeadingSpace(text: string): boolean {
  return /^[,.;:!?%)\]}]/u.test(text)
}

function wordStyle(
  word: CaptionWord,
  active: boolean,
  preset: CaptionPreset,
  theme: CaptionTheme,
): CSSProperties {
  const importance = word.importance ?? 0
  const important = importance > 0
  const activeColor =
    theme.activeColor ??
    (preset === 'neon-accent'
      ? '#43F6FF'
      : preset === 'particle-burst'
        ? '#FFF23D'
        : '#E6FF38')
  const importantColor =
    theme.importantColor ??
    (preset === 'neon-accent'
      ? '#FF4FD8'
      : importance >= 3
        ? '#FF5A45'
        : importance === 2
          ? '#FFB928'
          : '#67E8F9')

  return {
    display: 'inline-block',
    color:
      active
        ? activeColor
        : important
          ? importantColor
          : theme.textColor ?? '#FFFFFF',
    fontWeight:
      preset === 'weight-shift'
        ? active
          ? 950
          : important
            ? 800
            : 500
        : important || active
          ? 900
          : undefined,
    transform: active ? 'scale(1.12) translateY(-0.04em)' : 'scale(1)',
    transformOrigin: 'center bottom',
    transition: 'none',
    textDecoration:
      important && !active && preset === 'highlight' ? 'underline' : undefined,
    textDecorationThickness: important ? '0.11em' : undefined,
    textUnderlineOffset: important ? '0.12em' : undefined,
    textShadow: active
      ? `0 0 22px ${activeColor}77, 0 4px 18px rgba(0,0,0,.9)`
      : important
        ? `0 0 18px ${importantColor}55, 0 4px 18px rgba(0,0,0,.9)`
        : undefined,
    padding:
      (preset === 'emoji-pop' ||
        preset === 'particle-burst' ||
        preset === 'clip-wipe') &&
      (active || important)
        ? '0.05em 0.12em 0.08em'
        : 0,
    borderRadius:
      preset === 'emoji-pop' || preset === 'particle-burst' ? '0.14em' : undefined,
    background:
      preset === 'clip-wipe' && active
        ? activeColor
        : (preset === 'emoji-pop' || preset === 'particle-burst') && active
        ? 'rgba(0,0,0,.76)'
        : (preset === 'emoji-pop' || preset === 'particle-burst') && important
          ? 'rgba(0,0,0,.48)'
          : undefined,
    WebkitTextFillColor:
      preset === 'clip-wipe' && active ? '#07090D' : undefined,
  }
}

export function CaptionLayer({ project }: { readonly project: VideoProject }) {
  const frame = useCurrentFrame()
  const { fps, width } = useVideoConfig()
  const document = project.captions

  // Everything below the hooks used to run per frame, including groupCaptionCues —
  // which starts with a full CaptionDocumentSchema.parse whose refinement hashes every
  // word. On a 2500-word transcript that is ~16 ms of work 30 times a second, and it is
  // what made the studio crawl as soon as captions were imported. Neither the cue
  // grouping nor the id index depends on the frame, so both are computed once.
  //
  // Hooks stay above every early return so their order is fixed; the guards that used to
  // sit here now gate the render below instead.
  const scene = document && document.words.length > 0 ? activeCaptionScene(project, frame) : null
  const theme = scene ? captionTheme(scene) : null
  const maxWordsPerCue = theme?.maxWordsPerCue ?? 0

  const cues = useMemo(
    () =>
      document && maxWordsPerCue > 0
        ? groupCaptionCues(document, {
            maxWordsPerCue,
            maxCharactersPerCue: 56,
            maxDurationFrames: Math.max(1, Math.round(fps * 3.2)),
            maxGapFrames: Math.max(0, Math.round(fps * 0.55)),
          })
        : [],
    [document, maxWordsPerCue, fps],
  )
  const wordById = useMemo(
    () => new Map((document?.words ?? []).map((word) => [word.id, word])),
    [document],
  )

  if (!document || document.words.length === 0) return null
  if (scene === null || theme === null) return null

  const cue = cues.find(
    (candidate) => frame >= candidate.startFrame && frame < candidate.endFrame,
  )
  if (!cue) return null

  const words = cue.wordIds
    .map((id) => wordById.get(id))
    .filter((word): word is CaptionWord => Boolean(word))
  const preset = presetFromId(scene?.template?.id ?? document.templateId)
  const cueFrame = frame - cue.startFrame
  const entrance = spring({
    fps,
    frame: cueFrame,
    config: { damping: 20, stiffness: 250, mass: 0.62 },
    durationInFrames: Math.max(5, Math.round(fps * 0.28)),
  })
  const cueExit = interpolate(
    frame,
    [Math.max(cue.startFrame, cue.endFrame - Math.max(2, fps * 0.12)), cue.endFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )

  return (
    <AbsoluteFill
      style={{
        ...verticalPosition(preset),
        ...(scene ? sceneTransformStyle(scene) : {}),
        pointerEvents: 'none',
        zIndex: 1_000_000,
      }}
    >
      <div
        style={{
          ...layoutStyle(preset, width, theme),
          opacity: entrance * cueExit,
          transform: `translateY(${(1 - entrance) * 28}px) scale(${
            preset === 'emoji-pop' || preset === 'particle-burst'
              ? 0.82 + entrance * 0.18
              : 0.94 + entrance * 0.06
          })`,
          clipPath:
            preset === 'clip-wipe'
              ? `inset(0 ${(1 - entrance) * 100}% 0 0)`
              : undefined,
        }}
      >
        {words.map((word, index) => {
          const active = frame >= word.startFrame && frame < word.endFrame
          return (
            <span key={word.id}>
              {index > 0 && !punctuationWithoutLeadingSpace(word.text) ? ' ' : null}
              <span style={wordStyle(word, active, preset, theme)}>
                {word.text}
              </span>
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
