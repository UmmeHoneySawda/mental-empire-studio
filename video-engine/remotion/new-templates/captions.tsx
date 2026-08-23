import { Fragment, useMemo, type CSSProperties } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  activeCaptionCue,
  captionGroupingOptionsForNewTemplate,
  captionNeedsLeadingSpace,
  captionWordIsActive,
  groupCaptionCues,
  isNewCaptionTemplateId,
  resolveNewCaptionStyle,
  NEW_CAPTION_DEFINITIONS,
  type CaptionCue,
  type CaptionWord,
  type ResolvedNewCaptionStyle,
  type VideoProject,
  type VideoScene,
} from '../../../shared/video-engine'
import { sceneTransformStyle } from '../asset'
import { captionLayerZIndex } from '../captions'
import { COND, DIM, Ease, Grain, MONO, MOTION, SERIF } from './kit'

/* The five Cinematic caption systems.
 *
 * The delivered catalog hardcodes its text and a fixed seconds-per-word step. These are driven by
 * the project's caption document instead: every onset is a CaptionWord.startFrame, and paging comes
 * from the same groupCaptionCues the existing styles use, with per-template limits from
 * shared/video-engine/new-templates.ts. That is exactly the retiming the delivered handoff asks for
 * on Caption 01 and Caption 04.
 *
 * Grain belongs to the LAYER, not to a cue: the caption scene spans the whole canvas, so grain drawn
 * per cue would blink on and off at every cue boundary. Scrim Roll's scrim is on the layer for the
 * same reason. Neither vignette nor gate weave is applied — a caption style has no business moving
 * the user's footage. */

interface Metrics {
  readonly safeInset: number
  readonly bottomOffset: number
  readonly maxWidth: number
  readonly fontSize: number
  readonly minimum: number
}

/** The same shape captionLayoutMetrics derives for the existing styles, recomputed here because
 *  that function takes a CaptionStyleDefinition this set deliberately does not implement. */
function metricsFor(
  style: ResolvedNewCaptionStyle,
  width: number,
  height: number,
  lineCharacterCounts: readonly number[],
): Metrics {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const minimum = Math.min(safeWidth, safeHeight)
  const ratio = safeWidth / safeHeight
  const aspect = ratio < 0.9 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square'
  const bottomRatio = aspect === 'portrait' ? 0.18 : aspect === 'square' ? 0.12 : 0.09
  const longestLine = Math.max(1, ...lineCharacterCounts)
  const fit =
    longestLine > style.maxCharactersPerLine
      ? Math.max(0.58, style.maxCharactersPerLine / longestLine)
      : 1
  const raw = minimum * style.fontScale * fit
  return {
    safeInset: Math.round(minimum * 0.07),
    bottomOffset: Math.round(safeHeight * bottomRatio),
    maxWidth: Math.round(safeWidth * (aspect === 'landscape' ? 0.78 : 0.84)),
    fontSize: Math.round(Math.max(minimum * 0.037, Math.min(minimum * 0.089, raw))),
    minimum,
  }
}

function activeCaptionScene(
  captionScenes: readonly VideoScene[],
  mutedTrackIds: ReadonlySet<string>,
  frame: number,
): VideoScene | null | undefined {
  if (captionScenes.length === 0) return undefined
  return (
    captionScenes.find(
      (scene) =>
        !mutedTrackIds.has(scene.trackId) &&
        frame >= scene.startFrame &&
        frame < scene.startFrame + scene.durationFrames,
    ) ?? null
  )
}

function lastStartedIndex(cues: readonly CaptionCue[], frame: number): number {
  let found = -1
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index]!.startFrame > frame) break
    found = index
  }
  return found
}

/** True when this project's captions belong to the Cinematic set, so exactly one caption layer ever
 *  draws. Checks the scene as well as the document, because CaptionLayer prefers the scene's
 *  template id and a project could carry one without the other. */
export function usesNewCaptionTemplate(project: VideoProject): boolean {
  if (isNewCaptionTemplateId(project.captions?.templateId)) return true
  return project.scenes.some(
    (scene) => scene.kind === 'caption' && isNewCaptionTemplateId(scene.template?.id),
  )
}

export function NewCaptionLayer({
  project,
}: {
  readonly project: VideoProject
}): JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const document = project.captions
  const context = useMemo(
    () => ({
      scenes: project.scenes.filter((scene) => scene.kind === 'caption'),
      mutedTrackIds: new Set(project.tracks.filter((track) => track.muted).map((track) => track.id)),
    }),
    [project.scenes, project.tracks],
  )
  const scene =
    document && document.words.length > 0
      ? activeCaptionScene(context.scenes, context.mutedTrackIds, frame)
      : null
  const style = useMemo(() => {
    const fromScene = resolveNewCaptionStyle(scene?.template?.id, scene?.template?.props)
    if (fromScene) return fromScene
    // A Cinematic document with a stale non-Cinematic scene would otherwise resolve null and
    // the composition — which already suppressed <CaptionLayer/> — would draw nothing. Fall back
    // to the document's id so the text still appears with its table defaults.
    return resolveNewCaptionStyle(document?.templateId, undefined)
  }, [document?.templateId, scene?.template?.id, scene?.template?.props])
  const cues = useMemo(() => {
    if (!document || !style) return []
    const base = captionGroupingOptionsForNewTemplate(style, fps)
    const ratio = width / Math.max(1, height)
    const isPortrait = ratio < 0.9
    if (!isPortrait) return groupCaptionCues(document, base)
    // Narrow canvas: a 26-char line at 82px needs ~1350px but only 898px are available.
    // Shrink the grouping budget so the logical line fits the visual line.
    const portraitChars = Math.max(12, Math.round(base.maxCharactersPerLine * 0.62))
    return groupCaptionCues(document, {
      ...base,
      maxCharactersPerLine: portraitChars,
      maxCharactersPerCue: portraitChars * base.maxLines,
    })
  }, [document, style, fps, width, height])
  const wordById = useMemo(
    () => new Map((document?.words ?? []).map((word) => [word.id, word])),
    [document],
  )

  if (!document || document.words.length === 0 || !style) return null
  if (scene === null) return null

  const active = activeCaptionCue(cues, frame)
  const index = active ? cues.indexOf(active) : lastStartedIndex(cues, frame)
  const cue = index >= 0 ? cues[index]! : null
  /* Line Build is a running stack: it must keep the last lines on screen through the pauses between
   * cues, or a stack that took four cues to assemble flickers away in every gap.
   *
   * Bounded, though. The caption scene spans project.canvas.durationFrames, so an unbounded hold left
   * the stack burnt onto the rest of the video — captions ending at 0:30 of a 1:00 clip stayed up to
   * the end. It holds for one cue's worth of silence past the last word and then lets go. */
  const holdFrames = Math.round(NEW_CAPTION_DEFINITIONS[style.id].maxGapSeconds * fps * 2)
  const holdsBetweenCues =
    style.id === 'remotion-caption-cine-line-build' &&
    cue !== null &&
    frame < cue.endFrame + holdFrames
  const showBody = cue !== null && (active !== null || holdsBetweenCues)
  /* Scrim and grain are layer-level (not per cue) so they don't blink at cue boundaries, but they
   * must not run for the whole video. Before the first cue and after the last cue (+hold) the
   * user's footage would otherwise carry a dark gradient and grain with no text. */
  const firstCueStart = cues[0]?.startFrame ?? Number.POSITIVE_INFINITY
  const lastCueEnd = cues.length > 0 ? cues[cues.length - 1]!.endFrame : Number.NEGATIVE_INFINITY
  const inCaptionedSpan =
    cues.length > 0 && frame >= firstCueStart && frame < lastCueEnd + holdFrames
  // Fade scrim/grain over the last 0.4s of the span — instant appearance over footage is a flash.
  const spanFade =
    cues.length === 0
      ? 0
      : MOTION.sweep(frame / fps, firstCueStart / fps, 0.4) *
        (1 - MOTION.sweep(frame / fps, (lastCueEnd + holdFrames) / fps - 0.4, 0.4))
  const metrics = metricsFor(
    style,
    width,
    height,
    cue ? cue.lines.map((line) => [...line.text].length) : [],
  )

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: captionLayerZIndex(project, scene),
        contain: 'layout style',
        isolation: 'isolate',
        ...(scene ? sceneTransformStyle(scene) : {}),
      }}
    >
      {style.id === 'remotion-caption-cine-scrim-roll' && inCaptionedSpan ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '58%',
            opacity: spanFade,
            background:
              'linear-gradient(180deg, transparent, rgba(6,6,5,0.72) 46%, rgba(6,6,5,0.96))',
          }}
        />
      ) : null}

      {showBody && cue ? (
        <AbsoluteFill style={outerStyle(style, metrics)} data-caption-style={style.id}>
          {style.id === 'remotion-caption-cine-word-pop' ? (
            <WordPop style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-keyword-stack' ? (
            <KeywordStack style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-scrim-roll' ? (
            <ScrimRoll style={style} cue={cue} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-line-build' ? (
            <LineBuild style={style} cues={cues} index={index} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-held' ? (
            <Held style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
        </AbsoluteFill>
      ) : null}

      {style.grain > 0.01 && inCaptionedSpan && spanFade > 0.01 ? (
        <Grain t={frame / fps} amount={style.grain * spanFade} />
      ) : null}
    </AbsoluteFill>
  )
}

function outerStyle(style: ResolvedNewCaptionStyle, metrics: Metrics): CSSProperties {
  if (style.id === 'remotion-caption-cine-keyword-stack') {
    // Delivered left inset is 190 at 1920×1080 — re-anchor to minimum*0.176 so 16:9 is exact and portrait still scales.
    return {
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: `0 ${metrics.safeInset}px 0 ${Math.round(metrics.minimum * 0.176)}px`,
    }
  }
  if (style.id === 'remotion-caption-cine-scrim-roll') {
    // Delivered 150 at 1080 — 0.139×minimum reproduces it at 16:9 while staying aspect-aware.
    return {
      alignItems: 'flex-start',
      justifyContent: 'flex-end',
      padding: `0 ${metrics.safeInset}px ${Math.round(metrics.minimum * 0.139)}px ${Math.round(metrics.minimum * 0.139)}px`,
    }
  }
  if (style.id === 'remotion-caption-cine-line-build') {
    // Delivered bottom is 240 at 1080 — 0.222×minimum, not height×0.09 (which gave 97 and shifted the stack 143px).
    return {
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: `0 ${metrics.safeInset}px ${Math.round(metrics.minimum * 0.222)}px`,
    }
  }
  return { alignItems: 'center', justifyContent: 'center', padding: metrics.safeInset }
}

interface BodyProps {
  readonly style: ResolvedNewCaptionStyle
  readonly cue: CaptionCue
  readonly wordById: ReadonlyMap<string, CaptionWord>
  readonly frame: number
  readonly fps: number
  readonly metrics: Metrics
}

/** CAPTION 01 · WORD POP — karaoke. Each word pops at its own measured onset; the word being spoken
 *  burns accent. */
function WordPop({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const shadow = `0 ${Math.max(2, Math.round(metrics.fontSize * 0.06))}px 0 rgba(0,0,0,0.6)`
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: Math.round(metrics.fontSize * 0.29),
        rowGap: Math.round(metrics.fontSize * 0.04),
        maxWidth: metrics.maxWidth,
        overflowWrap: 'anywhere',
      }}
    >
      {cue.wordIds.map((id) => {
        const word = wordById.get(id)
        if (!word) return null
        const pop = MOTION.pop(t, word.startFrame / fps)
        const now = captionWordIsActive(word, frame)
        return (
          <span
            key={word.id}
            style={{
              fontFamily: COND,
              fontWeight: 600,
              fontSize: metrics.fontSize,
              textTransform: 'uppercase',
              lineHeight: 1.08,
              display: 'inline-block',
              color: now ? style.accentColor : style.textColor,
              opacity: pop.opacity * (now ? 1 : 0.9),
              transform: pop.transform,
              textShadow: now
                ? `0 0 ${Math.round(metrics.fontSize * 0.42)}px ${style.accentColor}55, ${shadow}`
                : shadow,
            }}
          >
            {word.text}
          </span>
        )
      })}
    </div>
  )
}

/** CAPTION 02 · KEYWORD STACK — the opening line sits dim as setup; the key word turns accent as a
 *  rule swipes under it, timed to that word. */
function KeywordStack({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  const setup = cue.lines.length > 1 ? cue.lines[0]! : null
  const payoff = cue.lines.length > 1 ? cue.lines.slice(1) : cue.lines

  /* The keyword has to be ONE word, on the PAYOFF, and the same word for the whole cue.
   *
   * Picking it from the whole cue and preferring whichever word is being spoken looked reasonable
   * and was wrong twice over: for most of a cue the spoken word sits on the setup line, where no
   * swipe is drawn, so the accent simply vanished — and when it did land on the payoff it hopped from
   * word to word, which is not a keyword, it is a second karaoke. Caption 01 already does karaoke.
   *
   * So: the first AI-marked important payoff word, else the longest payoff word, which is stable for
   * the cue's whole life. The swipe is still timed to that word's own measured onset. */
  const payoffWordIds = payoff.flatMap((line) => line.wordIds)
  const importantPayoff = payoffWordIds.find((id) => cue.importantWordIds.includes(id))
  const longestPayoff = payoffWordIds.reduce<string | undefined>((best, id) => {
    const word = wordById.get(id)
    if (!word || /^[^\p{L}\p{N}]+$/u.test(word.text)) return best
    const bestWord = best ? wordById.get(best) : undefined
    return !bestWord || word.text.length > bestWord.text.length ? id : best
  }, undefined)
  const targetId = importantPayoff ?? longestPayoff ?? payoffWordIds[payoffWordIds.length - 1]
  const target = targetId ? wordById.get(targetId) : undefined
  const swipe = target ? MOTION.sweep(t, target.startFrame / fps, 0.7, Ease.outExpo) : 0
  const hot = swipe > 0.15

  return (
    <div style={{ maxWidth: metrics.maxWidth }}>
      {setup ? (
        <div
          style={{
            fontFamily: SERIF,
            fontSize: Math.round(metrics.fontSize * 0.8),
            letterSpacing: '0.14em',
            color: DIM,
            ...MOTION.rise(t, cueStart, 0.9, Math.round(metrics.fontSize * 0.22)),
          }}
        >
          {setup.text}
        </div>
      ) : null}
      <div
        style={{
          marginTop: setup ? Math.round(metrics.fontSize * 0.36) : 0,
          ...MOTION.rise(t, cueStart + 0.12, 0.9, Math.round(metrics.fontSize * 0.3)),
        }}
      >
        {payoff.map((line, lineIndex) => (
          <div
            key={`${cue.id}:${lineIndex}`}
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: metrics.fontSize,
              letterSpacing: '0.08em',
              color: style.textColor,
              lineHeight: 1.2,
              overflowWrap: 'anywhere',
            }}
          >
            {line.wordIds.map((id, wordIndex) => {
              const word = wordById.get(id)
              if (!word) return null
              const isTarget = word.id === targetId
              const lead = wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : null
              return (
                <Fragment key={word.id}>
                  {lead}
                  <span style={{ position: 'relative', display: 'inline-block' }}>
                    <span
                      style={{
                        color: isTarget && hot ? style.accentColor : style.textColor,
                        textShadow:
                          isTarget && hot
                            ? `0 0 ${Math.round(metrics.fontSize * 0.4)}px ${style.accentColor}4d`
                            : 'none',
                      }}
                    >
                      {word.text}
                    </span>
                    {isTarget ? (
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: -Math.round(metrics.fontSize * 0.17),
                          height: Math.max(2, Math.round(metrics.fontSize * 0.06)),
                          background: style.accentColor,
                          transform: `scaleX(${swipe.toFixed(3)})`,
                          transformOrigin: 'left',
                        }}
                      />
                    ) : null}
                  </span>
                </Fragment>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** CAPTION 03 · SCRIM ROLL — lower-third narration on the layer's scrim; lines rise in sequence
 *  behind a blinking accent block. */
function ScrimRoll({ style, cue, frame, fps, metrics }: Omit<BodyProps, 'wordById'>): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  return (
    <div style={{ maxWidth: metrics.maxWidth }}>
      {cue.lines.map((line, index) => (
        <div
          key={`${cue.id}:${index}`}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: Math.round(metrics.fontSize * 0.35),
            ...MOTION.rise(t, cueStart + index * 0.18, 0.7, Math.round(metrics.fontSize * 0.3)),
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: metrics.fontSize,
              letterSpacing: '0.05em',
              lineHeight: 1.48,
              color: style.textColor,
              overflowWrap: 'anywhere',
            }}
          >
            {line.text}
          </span>
          {index === cue.lines.length - 1 ? (
            <span
              style={{
                width: Math.round(metrics.fontSize * 0.4),
                height: Math.round(metrics.fontSize * 0.85),
                background: style.accentColor,
                opacity: Math.floor(t * 2) % 2 ? 0.9 : 0.15,
              }}
            />
          ) : null}
        </div>
      ))}
      <div
        style={{
          marginTop: Math.round(metrics.fontSize * 0.9),
          fontFamily: MONO,
          fontSize: Math.max(9, Math.round(metrics.fontSize * 0.45)),
          letterSpacing: '0.34em',
          color: 'rgba(236,229,216,0.34)',
        }}
      >
        NARRATION
      </div>
    </div>
  )
}

/** CAPTION 04 · LINE BUILD — lines stack upward as they are spoken; earlier ones drift and dim while
 *  the newest lands in accent. Each cue's onset is its first word's real onset. */
function LineBuild({
  style,
  cues,
  index,
  frame,
  fps,
  metrics,
}: {
  readonly style: ResolvedNewCaptionStyle
  readonly cues: readonly CaptionCue[]
  readonly index: number
  readonly frame: number
  readonly fps: number
  readonly metrics: Metrics
}): JSX.Element {
  const t = frame / fps
  const visible = cues.slice(Math.max(0, index - 3), index + 1)
  const shadow = `0 ${Math.max(2, Math.round(metrics.fontSize * 0.06))}px 0 rgba(0,0,0,0.6)`
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: metrics.maxWidth,
      }}
    >
      {visible.map((cue, position) => {
        const age = visible.length - 1 - position
        const newest = age === 0
        const rise = MOTION.rise(t, cue.startFrame / fps, 0.75, Math.round(metrics.fontSize * 0.55))
        const offset = Number.parseFloat(rise.transform.replace(/[^\d.-]/gu, '')) || 0
        return (
          <div
            key={cue.id}
            style={{
              fontFamily: COND,
              fontWeight: newest ? 600 : 300,
              fontSize: newest ? metrics.fontSize : Math.round(metrics.fontSize * 0.74),
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.32,
              textAlign: 'center',
              color: newest ? style.accentColor : style.textColor,
              opacity: rise.opacity * (newest ? 1 : 0.26),
              transform: `translateY(${(-age * metrics.fontSize * 0.24 + offset).toFixed(2)}px) scale(${(1 - age * 0.03).toFixed(3)})`,
              textShadow: shadow,
              overflowWrap: 'anywhere',
            }}
          >
            {cue.text}
          </div>
        )
      })}
      <div
        style={{
          marginTop: Math.round(metrics.fontSize * 0.48),
          width: Math.round(metrics.fontSize * 2.2),
          height: 1,
          background: 'rgba(236,229,216,0.3)',
        }}
      />
    </div>
  )
}

/** CAPTION 05 · HELD STATEMENT — letterspacing tightens as the cue settles; the emphasised word
 *  switches to accent with a glow, under a hairline rule. */
function Held({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  const span = Math.max(0.3, (cue.endFrame - cue.startFrame) / fps)
  const tighten = MOTION.sweep(t, cueStart + 0.05, span * 0.62, Ease.outExpo)
  const letterSpacing = `${(0.46 - 0.3 * tighten).toFixed(3)}em`

  /* The delivered template marks its accent word by hand (`*Tuesday*`). Nothing here is hand-marked,
   * so the AI/manual important word comes first — and when a transcript has none, the longest word of
   * the cue takes it. Without that fallback the template had no accent at all on an ordinary
   * transcript: the earlier version computed a fallback ONSET but left the target undefined, so the
   * glow was timed for a word that never lit. One accent per frame is the rule; zero is not. */
  const importantId =
    cue.importantWordIds[0] ??
    cue.wordIds.reduce<string | undefined>((best, id) => {
      const word = wordById.get(id)
      if (!word || /^[^\p{L}\p{N}]+$/u.test(word.text)) return best
      const bestWord = best ? wordById.get(best) : undefined
      return !bestWord || word.text.length > bestWord.text.length ? id : best
    }, undefined)
  const hotAt = importantId
    ? (wordById.get(importantId)?.startFrame ?? cue.startFrame) / fps
    : cueStart + span * 0.5
  const hot = MOTION.sweep(t, hotAt, 0.55)

  return (
    <div style={{ textAlign: 'center', maxWidth: metrics.maxWidth }}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: metrics.fontSize,
          lineHeight: 1.42,
          color: style.textColor,
          letterSpacing,
          textIndent: letterSpacing,
          opacity: MOTION.sweep(t, cueStart, 0.4),
          overflowWrap: 'anywhere',
        }}
      >
        {cue.wordIds.map((id, wordIndex) => {
          const word = wordById.get(id)
          if (!word) return null
          const emphasised = word.id === importantId && hot > 0.1
          const lead = wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : null
          return (
            <Fragment key={word.id}>
              {lead}
              <span
                style={{
                  color: emphasised ? style.accentColor : style.textColor,
                  textShadow: emphasised
                    ? `0 0 ${Math.round(metrics.fontSize * 0.45)}px ${style.accentColor}66`
                    : 'none',
                }}
              >
                {word.text}
              </span>
            </Fragment>
          )
        })}
      </div>
      <div
        style={{
          margin: `${Math.round(metrics.fontSize * 0.84)}px auto 0`,
          width: Math.round(metrics.fontSize * 5.5 * MOTION.sweep(t, cueStart + 0.25, 0.9)),
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(236,229,216,0.6), transparent)',
        }}
      />
    </div>
  )
}
