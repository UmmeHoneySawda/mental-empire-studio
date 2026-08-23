import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  HookPlanSchema,
  NEW_HOOK_DEFINITIONS,
  isNewHookTemplateId,
  type HookPlan,
  type JsonObject,
  type VideoScene,
} from '../../../shared/video-engine'
import { sceneTransformStyle } from '../asset'
import {
  ACCENT,
  BONE,
  COND,
  DIM,
  Ease,
  FilmFrame,
  MONO,
  MOTION,
  Mark,
  SERIF,
  clamp,
  colorProp,
  numberProp,
  textProp,
} from './kit'

/* The five Cinematic hooks.
 *
 * Each is a port of the matching Hook0*.tsx in the delivered set
 * (scratch/cinematic-hooks-and-captions/remotion/src/templates/). Two rules apply everywhere:
 *
 *   · Every delivered time goes through T(), which scales it by dur / defaultSeconds. At the
 *     delivered length that is the identity, so the choreography is unchanged; at any other length
 *     the beats keep their proportions instead of the tail being clipped. `t` itself is never
 *     scaled — Margin Note's timecode has to advance in real seconds.
 *   · Delivered pixel sizes are authored at 1920x1080. Geometry goes through px(), type through
 *     tp() — 1.38x on portrait and square canvases, which is the 0.78x the delivered handoff
 *     prescribes for 9:16.
 *
 * Reel Burn and Margin Note are the footage-backed two: they pass background 'transparent' so the
 * clip under the hook lane shows through. The rest are type on black on purpose.
 *
 * `dur` comes from scene.durationFrames so the choreography is anchored to the authored scene
 * length and cannot be shortened by the composition-end clamp Remotion applies to
 * useVideoConfig().durationInFrames inside a Sequence. */

interface HookContext {
  readonly t: number
  readonly dur: number
  readonly k: number
  /** Delivered seconds, retimed to this scene's length. */
  readonly T: (seconds: number) => number
  /** Geometry: delivered pixels authored at 1920 wide. */
  readonly px: (value: number) => number
  /** Type: delivered pixels, with the portrait/square uplift applied. */
  readonly tp: (value: number) => number
  readonly width: number
  readonly height: number
  readonly props: JsonObject
  readonly headline: string | undefined
  readonly body: string | undefined
}

function planFromScene(scene: VideoScene): HookPlan | null {
  const parsed = HookPlanSchema.safeParse(scene.template?.props?.['hookPlan'])
  return parsed.success ? parsed.data : null
}

export function NewHookScene({ scene }: { readonly scene: VideoScene }): JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const plan = useMemo(() => planFromScene(scene), [scene])
  const id = scene.template?.id
  if (!isNewHookTemplateId(id)) return null

  const scale = Math.max(0.3, width / 1920)
  const portraitish = width <= height * 1.05
  const typeScale = scale * (portraitish ? 1.38 : 1)
  const dur = Math.max(1, scene.durationFrames) / fps
  const k = dur / NEW_HOOK_DEFINITIONS[id].defaultSeconds
  const beat = plan?.beats[0]
  const context: HookContext = {
    t: frame / fps,
    dur,
    k,
    T: (seconds) => seconds * k,
    px: (value) => Math.round(value * scale),
    tp: (value) => Math.max(10, Math.round(value * typeScale)),
    width,
    height,
    props: scene.template?.props ?? {},
    headline: beat?.headline,
    body: beat?.body,
  }

  return (
    <AbsoluteFill style={sceneTransformStyle(scene)}>
      {id === 'remotion-hook-cine-title-card' ? <CineTitleCard c={context} /> : null}
      {id === 'remotion-hook-cine-reel-burn' ? <CineReelBurn c={context} /> : null}
      {id === 'remotion-hook-cine-hard-light' ? <CineHardLight c={context} /> : null}
      {id === 'remotion-hook-cine-trailer-drop' ? <CineTrailerDrop c={context} /> : null}
      {id === 'remotion-hook-cine-margin-note' ? <CineMarginNote c={context} /> : null}
    </AbsoluteFill>
  )
}

/** HOOK 01 · TITLE CARD — prestige open on black. Rule opens, letterspacing settles. 4.0s. */
function CineTitleCard({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, props } = c
  const line = c.headline ?? textProp(props, 'line', "THAT ISN'T THE ENDING.")
  const kicker = textProp(props, 'kicker', 'ON LEAVING')
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.55)
  const out = 1 - MOTION.sweep(t, dur - T(0.8), T(0.8))
  const settle = MOTION.sweep(t, T(0.3), T(2.4), Ease.outExpo)
  const rule = MOTION.sweep(t, T(0.15), T(1.3))
  const letterSpacing = `${(0.4 - 0.16 * settle).toFixed(3)}em`

  return (
    <FilmFrame t={t} grain={grain}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: `0 ${px(140)}px`,
          opacity: out,
          transform: `scale(${(1 + 0.014 * settle).toFixed(4)})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: px(22),
            marginBottom: px(54),
            opacity: rule * 0.8,
          }}
        >
          <div
            style={{
              width: px(170) * rule,
              height: 1,
              background: 'linear-gradient(90deg, transparent, rgba(236,229,216,0.7))',
            }}
          />
          <div
            style={{
              width: Math.max(4, px(5)),
              height: Math.max(4, px(5)),
              background: accent,
              transform: 'rotate(45deg)',
            }}
          />
          <div
            style={{
              width: px(170) * rule,
              height: 1,
              background: 'linear-gradient(90deg, rgba(236,229,216,0.7), transparent)',
            }}
          />
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: tp(96),
            color: BONE,
            textAlign: 'center',
            lineHeight: 1.18,
            letterSpacing,
            textIndent: letterSpacing,
            overflowWrap: 'anywhere',
            ...MOTION.rise(t, T(0.35), T(1.4), px(26)),
          }}
        >
          {line}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: tp(20),
            letterSpacing: '0.42em',
            color: DIM,
            marginTop: px(58),
            opacity: MOTION.sweep(t, T(1.5), T(1.1)),
          }}
        >
          {kicker}
        </div>
      </AbsoluteFill>
    </FilmFrame>
  )
}

/** HOOK 02 · REEL BURN — a light leak wipes the line in over the footage underneath. 5.0s. */
function CineReelBurn({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, k, px, tp, props } = c
  const lineA = c.headline ?? textProp(props, 'lineA', "They didn't reach out")
  const lineB = c.body ?? textProp(props, 'lineB', 'when you were *falling apart*.')
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.7)
  const out = 1 - MOTION.sweep(t, dur - T(0.7), T(0.7))
  const leak = MOTION.sweep(t, T(0.5), T(1.5), Ease.inOutCubic)
  const flash = Math.max(0, 1 - (Math.abs(t - (dur - T(1))) * 5) / Math.max(0.0001, k))

  return (
    <FilmFrame t={t} grain={grain} background="transparent">
      <AbsoluteFill
        style={{ opacity: out, transform: `translateY(${(Math.sin(t * 8.2) * 1.6).toFixed(2)}px)` }}
      >
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(75% 60% at 26% 22%, rgba(255,196,128,0.30) 0%, rgba(255,150,80,0.07) 42%, transparent 72%)',
          }}
        />
        <AbsoluteFill
          style={{
            background:
              'radial-gradient(120% 100% at 50% 50%, transparent 38%, rgba(0,0,0,0.82) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: px(520),
            left: `${-30 + leak * 130}%`,
            background:
              'linear-gradient(90deg, transparent, rgba(255,208,150,0.55), rgba(255,240,220,0.85), rgba(255,208,150,0.4), transparent)',
            mixBlendMode: 'screen',
            filter: `blur(${Math.max(2, px(9))}px)`,
            opacity: 0.85 * (1 - Math.abs(leak - 0.5) * 1.2),
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: px(150),
            right: px(150),
            top: '50%',
            transform: 'translateY(-50%)',
          }}
        >
          <div style={{ clipPath: `inset(0 ${((1 - Math.min(1, leak * 1.35)) * 100).toFixed(1)}% 0 0)` }}>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: tp(74),
                lineHeight: 1.3,
                letterSpacing: '0.1em',
                color: '#fff6e6',
                textShadow: `0 0 ${px(46)}px rgba(255,190,130,0.45)`,
                overflowWrap: 'anywhere',
              }}
            >
              {lineA}
              <br />
              <Mark text={lineB} accent={accent} glow />
            </div>
          </div>
          <div
            style={{
              marginTop: px(44),
              height: 1,
              width: `${60 * MOTION.sweep(t, T(1.6), T(1.4))}%`,
              background: 'linear-gradient(90deg, rgba(255,220,180,0.75), transparent)',
            }}
          />
        </div>
        <AbsoluteFill
          style={{
            background: `rgba(255,226,190,${(flash * 0.5).toFixed(3)})`,
            mixBlendMode: 'screen',
          }}
        />
      </AbsoluteFill>
    </FilmFrame>
  )
}

/** HOOK 03 · HARD LIGHT — noir. A shaft rakes in, slab caps slide out of shadow. 3.5s. */
function CineHardLight({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, props } = c
  const lineA = c.headline ?? textProp(props, 'lineA', "You've been braced")
  const lineB = c.body ?? textProp(props, 'lineB', 'for the explosion.')
  const grain = numberProp(props, 'grain', 0.45)
  const out = 1 - MOTION.sweep(t, dur - T(0.4), T(0.4))
  const shaft = MOTION.sweep(t, T(0.05), T(0.85), Ease.outExpo)
  const slide = (1 - Ease.outQuart(clamp(t / T(0.9)))) * -px(90)
  const blind = Math.max(6, px(26))
  const gap = Math.max(18, px(74))

  return (
    <FilmFrame t={t} grain={grain} weave={false} background="#070706">
      <AbsoluteFill style={{ opacity: out }}>
        <div
          style={{
            position: 'absolute',
            top: -px(200),
            bottom: -px(200),
            left: `${-20 + shaft * 24}%`,
            width: px(640),
            transform: 'skewX(-18deg)',
            background:
              'linear-gradient(90deg, transparent, rgba(240,232,214,0.16), rgba(240,232,214,0.05), transparent)',
            filter: `blur(${Math.max(1, px(2))}px)`,
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.3 + 0.14 * shaft,
            background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.9) 0 ${blind}px, rgba(0,0,0,0) ${blind}px ${gap}px)`,
            transform: `translateY(${(((t * 5) % 100) - 50).toFixed(1)}px)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: px(160),
            right: px(260),
            top: '50%',
            transform: `translateY(-50%) translateX(${slide.toFixed(1)}px)`,
            opacity: MOTION.rise(t, T(0.12), T(0.75), 0).opacity,
          }}
        >
          <div
            style={{
              fontFamily: COND,
              fontWeight: 700,
              fontSize: tp(128),
              lineHeight: 0.98,
              color: '#f4efe4',
              textTransform: 'uppercase',
              textShadow: `${px(14)}px ${px(15)}px 0 rgba(0,0,0,0.92)`,
              overflowWrap: 'anywhere',
            }}
          >
            {lineA}
            <br />
            {lineB}
          </div>
        </div>
        <AbsoluteFill
          style={{
            background: 'radial-gradient(100% 90% at 30% 45%, transparent 30%, rgba(0,0,0,0.9) 100%)',
          }}
        />
      </AbsoluteFill>
    </FilmFrame>
  )
}

/** HOOK 04 · TRAILER DROP — clipped beats, then the line scales up and a flare crosses. 6.0s. */
function CineTrailerDrop({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, k, px, tp, props } = c
  const drop = c.headline ?? textProp(props, 'drop', "THAT'S THEM STILL PAYING *RENT* IN YOUR HEAD.")
  const beats = [
    textProp(props, 'beatA', 'THE SCREAMING MATCH.'),
    textProp(props, 'beatB', 'THE BLOCKED NUMBER.'),
  ]
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.5)
  const out = 1 - MOTION.sweep(t, dur - T(0.6), T(0.6))
  const beatAt = [T(0.15), T(1.85)]
  const beatOff = [T(1.7), T(3.3)]
  const dropIn = MOTION.sweep(t, T(3.45), T(2.2), Ease.outExpo)
  const flare = Math.max(0, 1 - (Math.abs(t - T(3.95)) * 2.2) / Math.max(0.0001, k))

  return (
    <FilmFrame t={t} grain={grain} background="#070606">
      <AbsoluteFill style={{ opacity: out, alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            bottom: 0,
            width: 1,
            background: 'linear-gradient(180deg, transparent, rgba(236,229,216,0.14), transparent)',
          }}
        />
        {beats.map((beat, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: px(120),
              right: px(120),
              textAlign: 'center',
              fontFamily: SERIF,
              fontSize: tp(60),
              letterSpacing: '0.5em',
              textIndent: '0.5em',
              color: DIM,
              opacity: clamp((t - beatAt[index]!) / T(0.22)) * (t < beatOff[index]! ? 1 : 0),
            }}
          >
            {beat}
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            left: px(130),
            right: px(130),
            textAlign: 'center',
            opacity: clamp((t - T(3.4)) / T(0.3)),
            transform: `scale(${(0.84 + 0.16 * dropIn).toFixed(3)})`,
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: tp(104),
              lineHeight: 1.12,
              letterSpacing: '0.06em',
              color: '#f6f1e6',
              textShadow: `0 0 ${px(70)}px rgba(255,220,180,${(0.16 + 0.2 * flare).toFixed(2)})`,
              overflowWrap: 'anywhere',
            }}
          >
            <Mark text={drop} accent={accent} glow />
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: px(2400),
            height: Math.max(2, px(5)),
            marginLeft: -px(1200),
            marginTop: -px(2),
            background: 'linear-gradient(90deg, transparent, #fff8ec, transparent)',
            filter: `blur(${Math.max(2, px(6))}px)`,
            transform: `scaleX(${(0.1 + flare).toFixed(2)})`,
            opacity: flare * 0.95,
          }}
        />
      </AbsoluteFill>
    </FilmFrame>
  )
}

/** HH:MM:SS:FF at 24 frames, the delivered slate format. Hours roll: the delivered version divided
 *  the whole elapsed time by 60 into the minutes field, so a start timecode anywhere near its
 *  86399-second bound rendered `00:1439:59:xx`. */
function timecodeStamp(startSeconds: number, t: number): string {
  const total = Math.max(0, startSeconds + t)
  const pad = (value: number): string => String(Math.floor(value)).padStart(2, '0')
  return `${pad((total / 3600) % 24)}:${pad((total / 60) % 60)}:${pad(total % 60)}:${pad((t * 24) % 24)}`
}

/** HOOK 05 · MARGIN NOTE — documentary column, running timecode, line builds word by word. 5.5s.
 *  The delivered handoff says the two-column split does not port to vertical, so a canvas that is
 *  taller than it is wide gets the stacked layout instead of a badly reflowed one. */
function CineMarginNote({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, width, height, props } = c
  const line =
    c.headline ?? textProp(props, 'line', 'The ending is a Tuesday where nothing happens at all.')
  const reel = textProp(props, 'reel', 'REEL 04')
  const startSeconds = Math.round(numberProp(props, 'startTimecodeSeconds', 761))
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.6)
  const out = 1 - MOTION.sweep(t, dur - T(0.7), T(0.7))
  const exit = MOTION.sweep(t, dur - T(0.7), T(0.7))
  const words = line.split(' ')
  const stamp = timecodeStamp(startSeconds, t)
  const stacked = width <= height
  // The fixed 0.13s stagger fits ~30 words into the 5.5s window; a 500-char line is ~80 words and
  // would never finish building, and lengthening the scene does not help because T() scales the
  // stagger too. Derive the step from the word count so the whole line lands before the exit
  // (0.9s initial rise + 0.8s rise duration + 0.7s exit = 2.4s non-stagger budget).
  const marginBudget = NEW_HOOK_DEFINITIONS['remotion-hook-cine-margin-note'].defaultSeconds - 2.4
  const wordStep = words.length > 1 ? Math.min(0.13, marginBudget / (words.length - 1)) : 0.13

  const slate = (
    <>
      <div
        style={{
          fontFamily: MONO,
          fontSize: tp(20),
          letterSpacing: '0.3em',
          color: accent,
          opacity: MOTION.sweep(t, T(0.3), T(0.6)),
        }}
      >
        {reel}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: tp(20),
          letterSpacing: '0.24em',
          color: DIM,
          marginTop: px(12),
          opacity: MOTION.sweep(t, T(0.45), T(0.6)),
        }}
      >
        {stamp}
      </div>
    </>
  )
  const body = (
    <div
      style={{
        fontFamily: SERIF,
        fontSize: tp(54),
        lineHeight: 1.34,
        letterSpacing: '0.06em',
        color: BONE,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: px(16),
        overflowWrap: 'anywhere',
      }}
    >
      {words.map((word, index) => (
        <span key={index} style={MOTION.rise(t, T(0.9 + index * wordStep), T(0.8), px(14))}>
          {word}
        </span>
      ))}
    </div>
  )

  return (
    <FilmFrame t={t} grain={grain} background="transparent">
      <AbsoluteFill style={{ opacity: out }}>
        {stacked ? (
          <>
            <div
              style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '46%', background: '#0a0908' }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '42%',
                height: '14%',
                background: 'linear-gradient(180deg, #0a0908 30%, transparent)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: px(96),
                right: px(96),
                top: px(120),
                height: 1,
                background: 'rgba(236,229,216,0.22)',
                transform: `scaleX(${MOTION.sweep(t, T(0.15), T(1.1))})`,
                transformOrigin: 'left',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: px(96),
                top: px(150),
                transform: `translateY(${(-px(60) * exit).toFixed(1)}px)`,
              }}
            >
              {slate}
            </div>
            <div
              style={{
                position: 'absolute',
                left: px(96),
                right: px(96),
                top: '24%',
                transform: `translateY(${(-px(60) * exit).toFixed(1)}px)`,
              }}
            >
              {body}
            </div>
          </>
        ) : (
          <>
            <div
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '34%', background: '#0a0908' }}
            />
            <div
              style={{
                position: 'absolute',
                left: '30%',
                top: 0,
                bottom: 0,
                width: '14%',
                background: 'linear-gradient(90deg, #0a0908 30%, transparent)',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: px(96),
                top: px(130),
                bottom: px(130),
                width: 1,
                background: 'rgba(236,229,216,0.22)',
                transform: `scaleY(${MOTION.sweep(t, T(0.15), T(1.1))})`,
                transformOrigin: 'top',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: px(148),
                top: px(150),
                width: px(500),
                transform: `translateX(${(-px(160) * exit).toFixed(1)}px)`,
              }}
            >
              {slate}
            </div>
            <div
              style={{
                position: 'absolute',
                left: px(148),
                bottom: px(190),
                width: px(620),
                transform: `translateX(${(-px(160) * exit).toFixed(1)}px)`,
              }}
            >
              {body}
            </div>
          </>
        )}
      </AbsoluteFill>
    </FilmFrame>
  )
}
