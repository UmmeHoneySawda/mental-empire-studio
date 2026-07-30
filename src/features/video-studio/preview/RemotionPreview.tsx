import { useEffect, useMemo, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import type { VideoProject } from '@shared/video-engine'
import { RemotionVideo } from '../../../../video-engine/remotion/composition'

/* The preview runs the production composition, not a lookalike: `RemotionVideo` is
   the exact component the renderer bundles for the final MP4. Asset URIs arrive
   rewritten to the app's `mestudio://` scheme, because `file:` is unreachable under
   the renderer CSP. Colour grading is deliberately absent — it is a deterministic
   FFmpeg pass on the finished file, so showing it here would be a lie. */

export function RemotionPreview({
  project,
  durationInFrames,
  frame,
  playing,
  onFrame,
  onPlayingChange
}: {
  project: VideoProject
  durationInFrames: number
  frame: number
  playing: boolean
  onFrame: (frame: number) => void
  onPlayingChange: (playing: boolean) => void
}): JSX.Element {
  const player = useRef<PlayerRef>(null)
  const inputProps = useMemo(() => ({ project }), [project])

  // The player owns the clock while it plays; the store owns it while paused. Both
  // directions are guarded so a seek from the timeline does not fight playback.
  useEffect(() => {
    const instance = player.current
    if (!instance) return
    const onFrameUpdate = (event: { detail: { frame: number } }): void => onFrame(event.detail.frame)
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
  }, [onFrame, onPlayingChange])

  useEffect(() => {
    const instance = player.current
    if (!instance || instance.isPlaying()) return
    if (Math.abs(instance.getCurrentFrame() - frame) > 0) instance.seekTo(frame)
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
      durationInFrames={Math.max(1, durationInFrames)}
      fps={project.canvas.fps}
      compositionWidth={project.canvas.width}
      compositionHeight={project.canvas.height}
      style={{ width: '100%', height: '100%' }}
      acknowledgeRemotionLicense
      overflowVisible={false}
      doubleClickToFullscreen
    />
  )
}
