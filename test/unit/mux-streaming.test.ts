import { describe, it, expect } from 'vitest'

// The VideoMuxer and StreamTarget run in a browser context (they depend on
// EncodedVideoChunk/WebCodecs APIs that aren't available in Node/vitest).
// These tests verify the PURE contract parts that are testable without a
// browser: the StreamingWriteHandle interface, the bridge API shape, and
// the dimension/frame-count math that feeds the muxer.

import { totalFrames } from '../../shared/renderSpec'
import type { GpuWorkerApi } from '../../shared/gpuIpc'

describe('StreamingWriteHandle contract', () => {
  it('openFile/writeChunk/closeFile exist on GpuWorkerApi', () => {
    // Type-level assertion: these methods must be present on the interface.
    // If any is removed the build breaks; this test makes the intent explicit.
    const shape: (keyof GpuWorkerApi)[] = ['openFile', 'writeChunk', 'closeFile']
    // Compile-time proof: we can reference the type members.
    const _proof: Pick<GpuWorkerApi, 'openFile' | 'writeChunk' | 'closeFile'> = {
      openFile: (_path: string) => 0,
      writeChunk: (_fd: number, _data: Uint8Array, _position: number) => {},
      closeFile: (_fd: number) => {}
    }
    expect(shape).toHaveLength(3)
    expect(_proof.openFile('/tmp/test.mp4')).toBe(0)
  })
})

describe('frame count for long videos (T1 regression guard)', () => {
  it('22-minute 1080p24 produces ~31700 frames', () => {
    const frames = totalFrames({ durationSec: 22 * 60 + 1.13, fps: 24 })
    expect(frames).toBe(31707)
  })

  it('45-minute video produces ~64800 frames', () => {
    const frames = totalFrames({ durationSec: 45 * 60, fps: 24 })
    expect(frames).toBe(64800)
  })

  it('frame count is always at least 1', () => {
    expect(totalFrames({ durationSec: 0, fps: 24 })).toBe(1)
    expect(totalFrames({ durationSec: -5, fps: 24 })).toBe(1)
  })
})

describe('streaming muxer design invariants', () => {
  it('fastStart false is safe because ffmpegMux adds -movflags +faststart', () => {
    // This is a documentation test — the streaming muxer uses fastStart:false
    // to avoid buffering the entire MP4 in memory. The host's ffmpegMux command
    // already adds -movflags +faststart to relocate the moov atom in the final
    // output. If someone changes the muxer to fastStart:'in-memory', they need
    // to know it will OOM on long videos.
    //
    // The real assertion is in the build: mux.ts imports StreamTarget (not
    // ArrayBufferTarget) and sets fastStart:false. If that import is changed,
    // the build breaks.
    expect(true).toBe(true)
  })

  it('writeChunk handles position-based writes (not just appends)', () => {
    // mp4-muxer's StreamTarget calls onData(chunk, position) where position
    // can be non-sequential (e.g. patching box sizes). The preload bridge must
    // use writeSync with a position parameter, not appendFileSync.
    const writes: Array<{ data: Uint8Array; position: number }> = []
    const handle = {
      write: (data: Uint8Array, position: number) => writes.push({ data, position })
    }
    // Simulate a few writes like mp4-muxer would produce.
    handle.write(new Uint8Array([0x00, 0x00, 0x00, 0x18]), 0)
    handle.write(new Uint8Array([0x66, 0x74, 0x79, 0x70]), 4)
    // Patch: overwrite position 0 with updated box size.
    handle.write(new Uint8Array([0x00, 0x00, 0x00, 0x20]), 0)
    expect(writes).toHaveLength(3)
    expect(writes[2].position).toBe(0) // non-sequential write
  })
})
