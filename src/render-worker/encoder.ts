import type { GpuRenderSpec } from '@shared/renderSpec'
import { GPU_AVC_CODEC, totalFrames, activeImageIndex } from '@shared/renderSpec'
import { Compositor } from './compositor'
import { CaptionLayer } from './captions'
import { VideoMuxer, type StreamingWriteHandle } from './mux'
import { SegmentDecoder } from './decoder'
import { lutTextureById } from './lut'

// Pull-based (not real-time) WebCodecs encode loop. For every output frame we compose on
// the GPU, wrap the canvas in a VideoFrame, and hand it to the hardware H.264 encoder.
// Critical correctness points: always frame.close() (no VRAM leak), throttle on
// encodeQueueSize (backpressure so we don't OOM), force keyframes on an interval, and use
// latencyMode 'quality'. Driven by frame index so output is deterministic.
//
// The muxer streams chunks to disk via the preload bridge (StreamTarget), so memory stays
// flat regardless of video duration — this is the T1 OOM fix.

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

// Keep the host's no-progress watchdog alive across long awaits (the first B-roll clip's
// demux/decode can take several seconds before any frame is composited). Any progress
// message resets the watchdog, so we emit one immediately and on an interval until `work`
// settles. Without this, a legitimately-slow-but-working b-roll prep is misread as a hang.
function heartbeatWhile<T>(work: Promise<T>, beat: () => void, intervalMs = 5000): Promise<T> {
  beat()
  const timer = setInterval(beat, intervalMs)
  return work.finally(() => clearInterval(timer))
}

export interface EncodeCallbacks {
  onProgress: (framesDone: number, totalFrames: number) => void
}

/**
 * Compose + encode + mux the whole spec. Writes the video-only MP4 to disk via the
 * streaming handle as encoding progresses (flat memory). The caller opens and closes
 * the file handle; this function drives the encode loop and finalizes the muxer.
 */
export async function encodeSpec(
  spec: GpuRenderSpec,
  images: ImageBitmap[],
  decoders: (SegmentDecoder | null)[],
  handle: StreamingWriteHandle,
  cb: EncodeCallbacks
): Promise<void> {
  const canvas = new OffscreenCanvas(spec.width, spec.height)
  const compositor = new Compositor(canvas, spec)
  compositor.setImages(images)
  compositor.setLut(lutTextureById(spec.grade.lut))
  const captions = new CaptionLayer(spec.captions, spec.width, spec.height)
  const muxer = new VideoMuxer({ width: spec.width, height: spec.height, fps: spec.fps, handle })

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

  const isBroll = !!(spec.broll && spec.broll.length > 0)
  let lastActiveIdx = -1

  console.log(`[encoder] encodeSpec starting: totalFrames=${frames} keyEvery=${keyEvery} codec=${GPU_AVC_CODEC} isBroll=${isBroll}`)

  for (let f = 0; f < frames; f++) {
    if (encodeError) throw encodeError
    const t = f / spec.fps

    // If B-roll is active, fetch the current video frame and upload it to WebGL. Segments
    // hard-cut rather than cross-dissolve: only one B-roll SegmentDecoder is ever open at a
    // time. A prior version pre-decoded the next segment ~0.4s early for a dissolve blend,
    // which required two concurrent VideoDecoder instances — confirmed live (real GPU,
    // real clips) that this WebCodecs implementation only ever produces output from ONE of
    // them; the second silently emits zero frames forever, hanging the whole render. See
    // decoder.ts for the full account.
    if (isBroll && decoders.length > 0) {
      const idx = activeImageIndex(spec.broll! as any, t)

      if (idx !== lastActiveIdx) {
        console.log(`[encoder] playhead t=${t.toFixed(2)}s: active B-roll segment changed to idx=${idx} (path=${spec.broll![idx].path})`)
        lastActiveIdx = idx
      }

      const segA = spec.broll![idx]

      // On-demand initialization and decoding of the active segment.
      if (!decoders[idx]) {
        console.log(`[encoder] playhead t=${t.toFixed(2)}s: lazy-initializing active segment ${idx} path=${segA.path}`)
        const buffer = window.gpuWorker!.readFile(segA.path)
        const dec = new SegmentDecoder(buffer, segA.path)
        await heartbeatWhile(dec.init(), () => cb.onProgress(f, frames))
        decoders[idx] = dec
        console.log(`[encoder] playhead t=${t.toFixed(2)}s: active segment ${idx} initialized (found ${dec.getSamplesCount()} samples)`)
      }
      await heartbeatWhile(decoders[idx]!.decodeUntil(t - segA.startSec), () => cb.onProgress(f, frames))

      // Close any decoders that are no longer needed (indices < idx) — at most one is ever
      // open going forward, but this also cleans up after the old crossfade-era manifests.
      for (let i = 0; i < idx; i++) {
        if (decoders[i]) {
          console.log(`[encoder] playhead t=${t.toFixed(2)}s: closing completed segment decoder ${i}`)
          decoders[i]!.close()
          decoders[i] = null
        }
      }

      const frameA = decoders[idx] ? decoders[idx]!.getFrameAt(t - segA.startSec) : null
      compositor.updateVideoTextures(frameA, null)
    }

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
  muxer.finalize()
  cb.onProgress(frames, frames)
}
