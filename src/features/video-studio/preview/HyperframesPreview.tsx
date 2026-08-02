import { useCallback, useEffect, useRef } from 'react'
import type { HyperframesPreviewPayload } from '@shared/video-engine'

/* A compiled HyperFrames composition ships its DOM, GSAP, a paused timeline, and the
   HyperFrames browser runtime, which exposes a postMessage control channel. Driving
   that channel directly from a plain iframe keeps the studio's playhead the single clock. */

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
  loopRange = null,
  onFrame,
  onPlayingChange
}: {
  payload: HyperframesPreviewPayload
  frame: number
  playing: boolean
  loopRange?: { startFrame: number; endFrame: number } | null
  onFrame: (frame: number) => void
  onPlayingChange: (playing: boolean) => void
}): JSX.Element {
  const iframe = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const requested = useRef(-1)
  const frameRef = useRef(frame)
  const playingRef = useRef(playing)
  const loopRangeRef = useRef(loopRange)
  frameRef.current = frame
  playingRef.current = playing
  loopRangeRef.current = loopRange

  const send = useCallback((action: ControlAction, extra: Record<string, unknown> = {}) => {
    const target = iframe.current?.contentWindow
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
        seek(frameRef.current)
        if (playingRef.current) send('play')
        return
      }
      if (event.data.type !== 'state') return
      const state = event.data as RuntimeStateMessage
      if (typeof state.isPlaying === 'boolean' && state.isPlaying !== playingRef.current) {
        playingRef.current = state.isPlaying
        onPlayingChange(state.isPlaying)
      }
      if (typeof state.frame !== 'number') return
      const range = loopRangeRef.current
      if (state.isPlaying && range && state.frame >= range.endFrame - 1) {
        seek(range.startFrame)
        onFrame(range.startFrame)
        return
      }
      if (state.isPlaying) onFrame(state.frame)
      else if (state.frame === requested.current) requested.current = -1
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onFrame, onPlayingChange, seek, send])

  useEffect(() => {
    if (!ready.current || playing) return
    seek(frame)
  }, [frame, playing, seek])

  useEffect(() => {
    if (!ready.current) return
    send(playing ? 'play' : 'pause')
  }, [playing, send])

  return (
    <iframe
      ref={iframe}
      src={payload.url}
      title="HyperFrames composition preview"
      sandbox="allow-scripts allow-same-origin"
      allow="autoplay"
      style={{
        display: 'block',
        border: 0,
        width: payload.width,
        height: payload.height,
        transform: 'scale(var(--hf-preview-scale, 1))',
        transformOrigin: 'top left'
      }}
    />
  )
}
