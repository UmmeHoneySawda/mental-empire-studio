import * as MP4Box from 'mp4box'

// Thin wrapper around mp4box.js to parse H.264 video streams in memory.
// It parses the MP4 container structure, extracts track configuration (width, height,
// codec, and the avcC extradata/description required by VideoDecoder), and yields
// individual encoded frames as EncodedVideoChunk data.

export interface DemuxResult {
  codec: string
  width: number
  height: number
  description: Uint8Array
  samples: any[]
}

export class MP4Demuxer {
  private file: any

  constructor(private buffer: ArrayBuffer) {
    this.file = MP4Box.createFile()
  }

  /**
   * Parse the container AND extract every sample in one pass. mp4box.js only delivers
   * `onSamples` for data it processes WHILE extraction is armed (setExtractionOptions +
   * start()) — arming it only after a separate appendBuffer()/flush() has already fully
   * consumed the buffer means it waits forever for data that will never arrive again,
   * since we hand it the whole file in one shot. That was the actual cause of the b-roll
   * GPU render stall: decode never even started because sample extraction silently never
   * fired. Fix: call setExtractionOptions + start() from inside onReady, before appendBuffer
   * finishes walking the rest of the box tree, so the still-in-flight parse delivers samples.
   */
  async demux(): Promise<DemuxResult> {
    return new Promise((resolve, reject) => {
      let meta: Omit<DemuxResult, 'samples'> | null = null
      let settled = false
      const settle = (samples: any[]): void => {
        if (settled || !meta) return
        settled = true
        resolve({ ...meta, samples })
      }

      this.file.onReady = (info: any) => {
        const videoTrack = info.videoTracks[0]
        if (!videoTrack) {
          reject(new Error('No video track found in MP4 B-roll segment'))
          return
        }

        let description: Uint8Array
        try {
          const trak = this.file.getTrackById(videoTrack.id)
          const entry = trak.mdia.minf.stbl.stsd.entries[0]
          const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C
          if (box) {
            // DataStream is attached to the MP4Box constructor
            const stream = new MP4Box.DataStream(undefined, 0)
            box.write(stream)
            // Skip 8-byte box header (4 bytes size + 4 bytes type)
            description = new Uint8Array(stream.buffer, 8)
          } else {
            throw new Error('avcC/codec description box not found')
          }
        } catch (e) {
          reject(new Error(`Failed to parse codec description: ${(e as Error).message}`))
          return
        }

        meta = { codec: videoTrack.codec, width: videoTrack.video.width, height: videoTrack.video.height, description }

        // Arm extraction now, still inside onReady/appendBuffer's call stack, so mp4box
        // delivers samples as it continues parsing the buffer we already handed it.
        this.file.onSamples = (_id: number, _user: any, samples: any[]) => settle(samples)
        this.file.setExtractionOptions(videoTrack.id, null, { nbSamples: 100000 })
        this.file.start()
      }

      this.file.onError = (e: any) => reject(new Error(`MP4Box error: ${e}`))

      // Attach fileStart offset and append buffer to start parsing
      const ab = this.buffer as any
      ab.fileStart = 0
      this.file.appendBuffer(ab)
      this.file.flush()
    })
  }
}
