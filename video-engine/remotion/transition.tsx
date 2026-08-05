import type { CSSProperties } from 'react'
import { AbsoluteFill, Easing, interpolate } from 'remotion'
import {
  linearTiming,
  TransitionSeries,
  type TransitionPresentation,
  type TransitionPresentationComponentProps,
} from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { slide, type SlideDirection } from '@remotion/transitions/slide'
import { wipe, type WipeDirection } from '@remotion/transitions/wipe'
import type { VideoTransition } from '../../shared/video-engine'

function easingFor(transition: VideoTransition): (value: number) => number {
  switch (transition.easing) {
    case 'ease-in':
      return Easing.in(Easing.ease)
    case 'ease-out':
      return Easing.out(Easing.ease)
    case 'ease-in-out':
      return Easing.inOut(Easing.ease)
    case 'linear':
    default:
      return Easing.linear
  }
}

function slideDirection(direction: VideoTransition['direction']): SlideDirection {
  switch (direction) {
    case 'right':
      return 'from-right'
    case 'up':
      return 'from-top'
    case 'down':
      return 'from-bottom'
    case 'left':
    default:
      return 'from-left'
  }
}

function wipeDirection(direction: VideoTransition['direction']): WipeDirection {
  return slideDirection(direction)
}

/* Zoom, blur, and dip-to-black are hand-written CSS presentations rather than the
   shader-backed ones in `@remotion/transitions`, for two reasons: every frame stays a
   pure function of `presentationProgress` (so a seek in the on-screen player renders
   exactly what the renderer will), and the numbers match the HyperFrames compiler's
   GSAP values, so switching engines does not change how a transition looks. */

type NoProps = Record<string, never>

/** `interpolate` clamped at both ends. `presentationProgress` is not guaranteed to stay inside
 *  [0,1] at a transition's boundary frames, and unclamped extrapolation runs straight past the
 *  range into out-of-gamut opacities and negative blur radii. */
const ramp = (progress: number, from: number, to: number): number =>
  interpolate(progress, [0, 1], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

function ZoomPresentation({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}: TransitionPresentationComponentProps<{ pull: boolean }>): JSX.Element {
  const exiting = presentationDirection === 'exiting'
  const { pull } = passedProps
  // Pushing in scales the outgoing plate up and lets the incoming one rise from
  // under it; pulling out does the reverse.
  const from = exiting ? 1 : pull ? 1.08 : 0.94
  const to = exiting ? (pull ? 0.94 : 1.08) : 1
  const scale = ramp(presentationProgress, from, to)
  const opacity = exiting ? ramp(presentationProgress, 1, 0) : ramp(presentationProgress, 0, 1)
  const style: CSSProperties = { opacity, transform: `scale(${scale})` }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>
}

function zoom(pull: boolean): TransitionPresentation<{ pull: boolean }> {
  return { component: ZoomPresentation, props: { pull } }
}

function BlurPresentation({
  children,
  presentationProgress,
  presentationDirection,
  passedProps,
}: TransitionPresentationComponentProps<{ radius: number }>): JSX.Element {
  const exiting = presentationDirection === 'exiting'
  const radius = exiting
    ? ramp(presentationProgress, 0, passedProps.radius)
    : ramp(presentationProgress, passedProps.radius, 0)
  const opacity = exiting ? ramp(presentationProgress, 1, 0) : ramp(presentationProgress, 0, 1)
  const style: CSSProperties = { opacity, filter: `blur(${radius.toFixed(2)}px)` }
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>
}

function blur(radius: number): TransitionPresentation<{ radius: number }> {
  return { component: BlurPresentation, props: { radius } }
}

/** The outgoing scene falls to black over the first half, the incoming one rises out
 *  of it over the second, with a solid plate underneath so the midpoint is genuinely
 *  black rather than a cross-dissolve. */
function DipToBlackPresentation({
  children,
  presentationProgress,
  presentationDirection,
}: TransitionPresentationComponentProps<NoProps>): JSX.Element {
  const opacity =
    presentationDirection === 'exiting'
      ? interpolate(presentationProgress, [0, 0.5], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : interpolate(presentationProgress, [0.5, 1], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}

function dipToBlack(): TransitionPresentation<NoProps> {
  return { component: DipToBlackPresentation, props: {} as NoProps }
}

/* A FACTORY, not a component — and that distinction is load-bearing.
 *
 * `TransitionSeries` validates its children by type identity: each one must literally be
 * `TransitionSeries.Sequence`, `TransitionSeries.Transition` or `TransitionSeries.Overlay`.
 * While this was a component (`<RemotionTransition transition={…} />`) the child's type was
 * `RemotionTransition`, so the series threw "only accepts a list of
 * <TransitionSeries.Sequence /> … but got [object Object]" and the whole composition
 * rendered nothing — for every project containing a transition, in the on-screen player and
 * in a headless render alike. Returning the element from a plain call keeps the type the
 * series expects.
 *
 * Call it: `{remotionTransition(transition)}` — never `<remotionTransition … />`. */
export function remotionTransition(
  transition: VideoTransition,
  key?: string,
): JSX.Element | null {
  if (transition.durationFrames < 1) return null
  const timing = linearTiming({
    durationInFrames: transition.durationFrames,
    easing: easingFor(transition),
  })

  switch (transition.type) {
    case 'fade':
      return (
        <TransitionSeries.Transition
          key={key}
          timing={timing}
          presentation={fade({ shouldFadeOutExitingScene: true })}
        />
      )
    case 'slide':
      return (
        <TransitionSeries.Transition
          key={key}
          timing={timing}
          presentation={slide({ direction: slideDirection(transition.direction) })}
        />
      )
    case 'wipe':
      return (
        <TransitionSeries.Transition
          key={key}
          timing={timing}
          presentation={wipe({ direction: wipeDirection(transition.direction) })}
        />
      )
    case 'zoom':
      return (
        <TransitionSeries.Transition
          key={key}
          timing={timing}
          // `down`/`right` read as pulling away from the frame; the rest push into it.
          presentation={zoom(transition.direction === 'down' || transition.direction === 'right')}
        />
      )
    case 'blur':
      return <TransitionSeries.Transition key={key} timing={timing} presentation={blur(18)} />
    case 'dip-to-black':
      return <TransitionSeries.Transition key={key} timing={timing} presentation={dipToBlack()} />
    default:
      return null
  }
}
