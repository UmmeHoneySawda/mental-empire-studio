import type { GpuRenderSpec } from '@shared/renderSpec'
import { GPU_AVC_CODEC, totalFrames } from '@shared/renderSpec'
import { Compositor } from './compositor'
import { CaptionLayer } from './captions'
import { VideoMuxer } from './mux'

// Pull-based (not real-time) WebCodecs encode loop. For every output frame we compose on
// the GPU, wrap the canvas in a VideoFrame, and hand it to the hardware H.264 encoder.
// Critical correctness points: always frame.close() (no VRAM leak), throttle on
// encodeQueueSize (backpressure so we don't OOM), force keyframes on an interval, and use
// latencyMode 'quality'. Driven by frame index so output is deterministic.

export interface ProbeResult { supported: boolean; hardware: boolean; detail?: string }

/** Probe whether WebCodecs hardware H.264 encode is available for this spec. */
export async function probeHardwareEncode(width: number, height: number, fps: number): Promise<ProbeResult> {
  if (typeof VideoEncoder === 'undefined') return { supported: false, hardware: false, detail: 'VideoEncoder missing' }
  const config: VideoEncoderConfig = {
    codec: GPU_AVC_CODEC,
    width,
    height,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware'
  }
  try {
    const hw = await VideoEncoder.isConfigSupported(config)
    if (hw.supported) return { supported: true, hardware: true }
    const sw = await VideoEncoder.isConfigSupported({ ...config, hardwareAcceleration: 'no-preference' })
    return { supported: !!sw.supported, hardware: false, detail: sw.supported ? 'software only' : 'unsupported' }
  } catch (e) {
    return { supported: false, hardware: false, detail: (e as Error).message }
  }
}

function waitForDrain(encoder: VideoEncoder): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (encoder.encodeQueueSize <= 4) resolve()
      else setTimeout(tick, 4)
    }
    tick()
  })
}

export interface EncodeCallbacks {
  onProgress: (framesDone: number, totalFrames: number) => void
}

/**
 * Compose + encode + mux the whole spec. Returns the finished video-only MP4 bytes.
 * The caller (worker entry) writes them to disk and reports done; the host then muxes
 * audio in via ffmpeg stream-copy.
 */
export async function encodeSpec(
  spec: GpuRenderSpec,
  images: ImageBitmap[],
  overlay: ImageBitmap | null,
  cb: EncodeCallbacks
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(spec.width, spec.height)
  const compositor = new Compositor(canvas, spec)
  compositor.setImages(images)
  compositor.setOverlay(overlay)
  const captions = new CaptionLayer(spec.captions, spec.width, spec.height)
  const muxer = new VideoMuxer({ width: spec.width, height: spec.height, fps: spec.fps })

  let encodeError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addChunk(chunk, meta),
    error: (e) => { encodeError = e instanceof Error ? e : new Error(String(e)) }
  })
  encoder.configure({
    codec: GPU_AVC_CODEC,
    width: spec.width,
    height: spec.height,
    bitrate: Math.round(spec.encoder.bitrateMbps * 1_000_000),
    framerate: spec.fps,
    hardwareAcceleration: 'prefer-hardware',
    latencyMode: 'quality'
  })

  const frames = totalFrames(spec)
  const keyEvery = Math.max(1, Math.round(spec.fps * spec.encoder.keyIntervalSec))

  for (let f = 0; f < frames; f++) {
    if (encodeError) throw encodeError
    const t = f / spec.fps
    if (captions.draw(t)) compositor.updateCaption(captions.canvas)
    compositor.drawFrame(t)

    const frame = new VideoFrame(canvas, { timestamp: Math.round((f / spec.fps) * 1_000_000) })
    encoder.encode(frame, { keyFrame: f % keyEvery === 0 })
    frame.close() // critical: release the GPU surface immediately

    if (encoder.encodeQueueSize > 8) await waitForDrain(encoder)
    if (f % spec.fps === 0) cb.onProgress(f, frames)
  }

  await encoder.flush()
  encoder.close()
  if (encodeError) throw encodeError
  cb.onProgress(frames, frames)
  return muxer.finalize()
}
