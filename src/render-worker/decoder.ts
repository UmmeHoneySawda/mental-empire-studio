import { MP4Demuxer } from './demuxer'

// Manages a VideoDecoder instance for a single B-roll video segment.
// It loads the MP4 buffer, demuxes it using MP4Demuxer, configures WebCodecs VideoDecoder,
// and decodes all frames chronologically. During rendering, getFrameAt(timeSec) retrieves
// the nearest decoded frame, while immediately closing and disposing of past frames to
// prevent GPU memory leaks.

// Upper bound on demux + decoder configuration. mp4box can hang on an unexpected container;
// without this the host's 60s no-progress watchdog would fire with a generic message.
const INIT_TIMEOUT_MS = 20_000

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
  })
  return Promise.race([work, guard]).finally(() => clearTimeout(timer)) as Promise<T>
}

export class SegmentDecoder {
  private decoder!: VideoDecoder
  private demuxer: MP4Demuxer
  private frames: VideoFrame[] = []
  private samples: any[] = []
  private nextSampleIdx = 0
  private flushed = false
  private decodeError: Error | null = null

  constructor(buffer: ArrayBuffer, private label = 'b-roll clip') {
    this.demuxer = new MP4Demuxer(buffer)
  }

  async init(): Promise<void> {
    // Bound demux + sample extraction: mp4box can silently never fire onReady/onSamples
    // for an unexpected container, which would otherwise hang the whole encode loop until
    // the host's 60s no-progress watchdog kills it with a useless generic error. Surface a
    // specific, actionable failure instead.
    await withTimeout(this.demuxAndConfigure(), INIT_TIMEOUT_MS, `${this.label}: demux/decoder init`)
  }

  private async demuxAndConfigure(): Promise<void> {
    const meta = await this.demuxer.parse()
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.frames.push(frame)
      },
      error: (e) => {
        this.decodeError = e instanceof Error ? e : new Error(String(e))
        console.error('VideoDecoder error:', e)
      }
    })

    this.decoder.configure({
      codec: meta.codec,
      codedWidth: meta.width,
      codedHeight: meta.height,
      description: meta.description,
      // Software decode on purpose: the encode already holds a hardware NVENC session, and
      // running NVDEC concurrently on consumer GPUs (e.g. GTX 1660 Ti) can silently stall
      // (no frame output, no error). B-roll clips are short, so software H.264 decode is
      // cheap and reliable. The output is still composited on the GPU and encoded on NVENC.
      hardwareAcceleration: 'prefer-software'
    })

    // Extract samples metadata at init time
    await new Promise<void>((resolve) => {
      this.demuxer.extractSamples((samples) => {
        this.samples = samples
        resolve()
      })
    })
  }

  async decodeUntil(timeSec: number): Promise<void> {
    if (this.decodeError) throw this.decodeError
    const targetTimestampUs = Math.round(timeSec * 1_000_000)
    // 0.5s lookahead buffer
    const lookaheadUs = 500_000
    const limitUs = targetTimestampUs + lookaheadUs

    const startIdx = this.nextSampleIdx
    // Feed samples until we reach the limit
    while (this.nextSampleIdx < this.samples.length) {
      const sample = this.samples[this.nextSampleIdx]
      const sampleTimeUs = Math.round((sample.cts / sample.timescale) * 1_000_000)

      if (sampleTimeUs > limitUs) {
        break
      }

      const chunk = new EncodedVideoChunk({
        type: sample.is_sync ? 'key' : 'delta',
        timestamp: sampleTimeUs,
        duration: Math.round((sample.duration / sample.timescale) * 1_000_000),
        data: sample.data
      })

      this.decoder.decode(chunk)
      this.nextSampleIdx++
      if (this.decodeError) throw this.decodeError
    }

    if (this.nextSampleIdx > startIdx) {
      console.log(`[decoder] fed ${this.nextSampleIdx - startIdx} chunks to VideoDecoder (nextSampleIdx=${this.nextSampleIdx}/${this.samples.length})`)
    }

    if (this.nextSampleIdx >= this.samples.length && !this.flushed) {
      console.log(`[decoder] end of samples reached, flushing VideoDecoder`)
      this.flushed = true
      void this.decoder.flush().catch((e) => {
        this.decodeError = e instanceof Error ? e : new Error(String(e))
      })
    }

    const hasNeededFrame = () => {
      if (this.decodeError) throw this.decodeError
      if (this.frames.some((f) => f.timestamp >= targetTimestampUs)) return true
      if (this.nextSampleIdx >= this.samples.length && this.decoder.decodeQueueSize === 0) return true
      return false
    }

    if (!hasNeededFrame()) {
      console.log(`[decoder] waiting for frame around ${targetTimestampUs}us (currently have ${this.frames.length} decoded frames in queue)`)
      const waitStart = Date.now()
      const timeoutMs = 15_000
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          try {
            if (hasNeededFrame()) {
              resolve()
              return
            }
          } catch (e) {
            reject(e)
            return
          }
          if (Date.now() - waitStart > timeoutMs) {
            reject(new Error(`B-roll decoder timed out waiting for frame at ${(targetTimestampUs / 1_000_000).toFixed(2)}s`))
          } else {
            setTimeout(check, 4)
          }
        }
        check()
      })
      console.log(`[decoder] wait complete in ${Date.now() - waitStart}ms (have ${this.frames.length} frames)`)
    }
    if (this.decodeError) throw this.decodeError
  }

  getSamplesCount(): number {
    return this.samples.length
  }

  getFrameAt(timeSec: number): VideoFrame | null {
    if (this.frames.length === 0) return null
    const targetTimestampUs = Math.round(timeSec * 1_000_000)
    let bestFrame: VideoFrame | null = null
    let bestDiff = Infinity
    let bestIdx = -1

    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i]
      const diff = Math.abs(frame.timestamp - targetTimestampUs)
      if (diff < bestDiff) {
        bestDiff = diff
        bestFrame = frame
        bestIdx = i
      }
    }

    // Actively close and dispose of consumed frames before the active one
    // to prevent GPU memory/VRAM leaks (L7/L12 memory safety).
    if (bestIdx > 0) {
      for (let i = 0; i < bestIdx; i++) {
        this.frames[i].close()
      }
      this.frames = this.frames.slice(bestIdx)
    }

    return bestFrame
  }

  close(): void {
    this.frames.forEach((f) => f.close())
    this.frames = []
    try {
      this.decoder.close()
    } catch { /* ignore */ }
  }
}
