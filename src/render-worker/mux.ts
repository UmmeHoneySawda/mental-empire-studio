import { Muxer, StreamTarget } from 'mp4-muxer'

// Streaming wrapper around mp4-muxer that writes a video-only MP4 (H.264) incrementally
// to disk via the worker preload's fs bridge. This replaces the old ArrayBufferTarget +
// fastStart:'in-memory' approach that buffered the entire MP4 in RAM — the cause of T1
// OOM ("Array buffer allocation failed") on long videos (~22min+, ~1GB).
//
// With StreamTarget, mp4-muxer calls onData(chunk, position) as it produces output;
// each chunk is written to disk immediately via the preload's writeChunk bridge (which
// maps to Node's writeSync). Memory stays flat regardless of video duration.
//
// fastStart is set to false (moov at end), which is fine because the host's ffmpegMux
// already adds -movflags +faststart to the final muxed output.

export interface StreamingWriteHandle {
  /** Write `data` at byte `position` in the output file. */
  write(data: Uint8Array, position: number): void
}

export class VideoMuxer {
  private muxer: Muxer<StreamTarget>

  constructor(opts: { width: number; height: number; fps: number; handle: StreamingWriteHandle }) {
    this.muxer = new Muxer({
      target: new StreamTarget({
        onData: (data, position) => opts.handle.write(data, position)
      }),
      video: { codec: 'avc', width: opts.width, height: opts.height, frameRate: opts.fps },
      // moov-at-end: host's ffmpegMux adds -movflags +faststart to the final output.
      fastStart: false
    })
  }

  addChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    this.muxer.addVideoChunk(chunk, meta)
  }

  /** Finalize the container (flush remaining data to the stream). */
  finalize(): void {
    this.muxer.finalize()
  }
}
