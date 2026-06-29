import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

// Thin wrapper around mp4-muxer that produces a video-only MP4 (H.264) in memory. The
// Electron host muxes this with the mastered AAC audio via a single ffmpeg stream-copy
// (no re-encode), so the costly per-frame work stays on the GPU and ffmpeg's remaining
// job is just the container assembly.

export class VideoMuxer {
  private muxer: Muxer<ArrayBufferTarget>

  constructor(opts: { width: number; height: number; fps: number }) {
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: opts.width, height: opts.height, frameRate: opts.fps },
      // 'in-memory' Fast Start: compact, seekable output. The whole video lives in RAM
      // until finalize(); acceptable for the typical slideshow sizes here.
      fastStart: 'in-memory'
    })
  }

  addChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.muxer.addVideoChunk(chunk, meta)
  }

  /** Finalize the container and return the bytes. */
  finalize(): ArrayBuffer {
    this.muxer.finalize()
    return this.muxer.target.buffer
  }
}
