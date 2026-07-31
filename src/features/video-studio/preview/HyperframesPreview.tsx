import { useCallback, useEffect, useRef } from 'react'
import type { HyperframesPreviewPayload } from '@shared/video-engine'

/* A compiled HyperFrames composition ships its DOM, GSAP, a paused timeline, and the
   HyperFrames browser runtime, which exposes a postMessage control channel. Driving
   that channel directly from a plain iframe — rather than through the packaged
   <hyperframes-player> web component — keeps the studio's playhead the single clock:
   we seek, the runtime paints that exact frame, and it reports back where it is.

   Protocol (HyperFrames runtime, composition contract v1):
     parent → frame  { source: 'hf-parent', type: 'control', action, … }
     frame → parent  { source: 'hf-preview', type: 'ready' | 'state' | 'timeline', … } */

type ControlAction = 'play' | 'pause' | 'seek' | 'tick' | 'set-muted'

interface RuntimeStateMessage {
  source: 'hf-preview'
  type: 'state'
  frame: number
  isPlaying: boolean
}

function isRuntimeMessage(data: unknown): data is { source: string; type: string; frame?: number; isPlaying?: boolean } {
  return !!data && typeof data === 'object' && (data as { source?: unknown }).source === 'hf-preview'
}

export function HyperframesPreview({
  payload,
  frame,
  playing,
  onFrame,
  onPlayingChange
}: {
  payload: HyperframesPreviewPayload
  frame: number
  playing: boolean
  onFrame: (frame: number) => void
  onPlayingChange: (playing: boolean) => void
}): JSX.Element {
  const iframe = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  // The frame we last asked for, so a state report echoing it back is not treated as
  // the user scrubbing and does not fight the next seek.
  const requested = useRef(-1)

  const send = useCallback((action: ControlAction, extra: Record<string, unknown> = {}) => {
    const target = iframe.current?.contentWindow
    // Nothing may be posted before the runtime has announced itself. A message sent into
    // a document that is still navigating is silently dropped, and the studio would then
    // sit waiting for a state report that never comes.
    if (!target || !ready.current) return
    target.postMessage({ source: 'hf-parent', type: 'control', action, ...extra }, '*')
  }, [])

  const seek = useCallback((toFrame: number) => {
    requested.current = toFrame
    send('seek', { timeSeconds: toFrame / Math.max(1, payload.fps), seekMode: 'commit' })
  }, [send, payload.fps])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframe.current?.contentWindow || !isRuntimeMessage(event.data)) return
      if (event.data.type === 'ready') {
        ready.current = true
        seek(frame)
        if (playing) send('play')
        return
      }
      if (event.data.type !== 'state') return
      const state = event.data as RuntimeStateMessage
      if (typeof state.isPlaying === 'boolean') onPlayingChange(state.isPlaying)
      if (typeof state.frame !== 'number') return
      // While playing the runtime owns the clock; while paused it is only echoing
      // the seek we just issued.
      if (state.isPlaying) onFrame(state.frame)
      else if (state.frame === requested.current) requested.current = -1
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // `frame`/`playing` are read only inside the one-shot ready branch; re-subscribing
    // on every playhead move would tear the listener down mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek, send, onFrame, onPlayingChange])

  useEffect(() => {
    if (!ready.current || playing) return
    seek(frame)
  }, [frame, playing, seek])

  useEffect(() => {
    if (!ready.current) return
    send(playing ? 'play' : 'pause')
  }, [playing, send])

  // No reset effect for `ready`/`requested`: PreviewStage keys this component on
  // payload.url, so a restaged preview remounts it and both refs start fresh. The reset
  // effect that used to live here could not work — it was declared after the seek and
  // play effects, which therefore ran first and still saw the dead document as ready.

  return (
    <iframe
      ref={iframe}
      src={payload.url}
      title="HyperFrames composition preview"
      // allow-same-origin lets the runtime read its own assets; the document is served
      // from the app's own confined scheme, not from anywhere a user can point it.
      sandbox="allow-scripts allow-same-origin"
      allow="autoplay"
      style={{
        display: 'block',
        border: 0,
        width: payload.width,
        height: payload.height,
        // The stage sizes itself to the fitted box; the composition renders at its own
        // pixel dimensions and scales down, so text stays crisp at any preview size.
        transform: 'scale(var(--hf-preview-scale, 1))',
        transformOrigin: 'top left'
      }}
    />
  )
}
