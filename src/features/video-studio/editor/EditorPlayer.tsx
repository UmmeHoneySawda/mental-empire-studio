import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import type { VideoProject } from '@shared/video-engine'
import { RemotionVideo } from '../../../../video-engine/remotion/composition'
import { projectForPlayer } from './assetUrl'
import { PLAYHEAD_THROTTLE_MS } from './constants'

/* The live preview.
 *
 * `RemotionVideo` is the exact component the renderer bundles for the final MP4 — the
 * preview is the production composition, not a lookalike, so what you scrub is what you
 * get. The only transformation is `projectForPlayer`, which rewrites `file:` asset URIs to
 * `mestudio://` because the renderer CSP's `img-src` does not include `file:`.
 *
 * What changed from the studio this replaces: it takes the LIVE project as a prop. There
 * is no `videoEngine.preview()` call, no staged snapshot, and no "Build preview" button —
 * an edit is on screen on the same tick it happens.
 *
 * Colour grading is deliberately absent: it is a deterministic FFmpeg pass over the
 * finished file, so showing it here would be a lie about what renders. */

/** Two clocks, one truth. The Player owns time while it plays and reports frames outward;
 *  the store owns time while paused and seeks inward. Both directions are guarded so a
 *  timeline scrub does not fight playback. */
export function EditorPlayer({
  project,
  frame,
  playing,
  loopRange,
  onFrame,
  onPlayingChange
}: {
  project: VideoProject
  frame: number
  playing: boolean
  loopRange: { startFrame: number; endFrame: number } | null
  onFrame: (frame: number) => void
  onPlayingChange: (playing: boolean) => void
}): JSX.Element {
  const player = useRef<PlayerRef>(null)

  // Rewriting URIs is pure and returns the same object when nothing needed changing, so
  // this only produces a new identity when the project genuinely changed.
  const staged = useMemo(() => projectForPlayer(project), [project])
  const inputProps = useMemo(() => ({ project: staged }), [staged])

  const durationInFrames = Math.max(1, project.canvas.durationFrames)

  // Playback reports every frame; at 60fps writing each one into the store re-rendered
  // the whole editor sixty times a second just to move a marker. Throttled, with a
  // trailing call so the playhead still lands on the real final frame when it stops.
  const lastSent = useRef(0)
  const pending = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  const report = useCallback(
    (next: number) => {
      const now = performance.now()
      const wait = PLAYHEAD_THROTTLE_MS - (now - lastSent.current)
      pending.current = next
      if (wait <= 0) {
        lastSent.current = now
        pending.current = null
        onFrame(next)
        return
      }
      if (timer.current) return
      timer.current = setTimeout(() => {
        timer.current = undefined
        lastSent.current = performance.now()
        if (pending.current !== null) {
          const value = pending.current
          pending.current = null
          onFrame(value)
        }
      }, wait)
    },
    [onFrame]
  )

  // Inside a loop range, playback returns to the start rather than running on into the
  // rest of the video — that is what makes checking one hook or one caption quick.
  const loopStart = loopRange?.startFrame
  const loopEnd = loopRange?.endFrame
  const handleFrame = useCallback(
    (next: number) => {
      if (loopStart !== undefined && loopEnd !== undefined && next >= loopEnd - 1) {
        player.current?.seekTo(loopStart)
        onFrame(loopStart)
        return
      }
      report(next)
    },
    [loopStart, loopEnd, onFrame, report]
  )

  useEffect(() => {
    const instance = player.current
    if (!instance) return
    const onFrameUpdate = (event: { detail: { frame: number } }): void => handleFrame(event.detail.frame)
    const onPlay = (): void => onPlayingChange(true)
    const onPause = (): void => onPlayingChange(false)
    instance.addEventListener('frameupdate', onFrameUpdate)
    instance.addEventListener('play', onPlay)
    instance.addEventListener('pause', onPause)
    return () => {
      instance.removeEventListener('frameupdate', onFrameUpdate)
      instance.removeEventListener('play', onPlay)
      instance.removeEventListener('pause', onPause)
    }
  }, [handleFrame, onPlayingChange])

  // Only seek from outside while paused. Doing it during playback would fight the
  // Player's own clock and stutter.
  useEffect(() => {
    const instance = player.current
    if (!instance || instance.isPlaying()) return
    if (instance.getCurrentFrame() !== frame) instance.seekTo(frame)
  }, [frame])

  useEffect(() => {
    const instance = player.current
    if (!instance) return
    if (playing && !instance.isPlaying()) instance.play()
    if (!playing && instance.isPlaying()) instance.pause()
  }, [playing])

  return (
    <Player
      ref={player}
      component={RemotionVideo}
      inputProps={inputProps}
      // Without this a composition that throws renders Remotion's bare "⚠️" and nothing
      // else — which is precisely how a real bug (a Fragment inside TransitionSeries)
      // stayed invisible as "the preview is just black". Show the message.
      errorFallback={({ error }) => (
        <div className="ve-player-error">
          <strong>The composition could not render</strong>
          <span>{error.message}</span>
        </div>
      )}
      durationInFrames={durationInFrames}
      fps={project.canvas.fps}
      compositionWidth={project.canvas.width}
      compositionHeight={project.canvas.height}
      style={{ width: '100%', height: '100%' }}
      acknowledgeRemotionLicense
      overflowVisible={false}
      doubleClickToFullscreen
      // One shared tag per concurrent audio layer. Too few and a second voice-over or a
      // b-roll clip's audio silently drops; the pool is allocated up front because tags
      // cannot be created during playback under an autoplay policy.
      numberOfSharedAudioTags={8}
    />
  )
}
