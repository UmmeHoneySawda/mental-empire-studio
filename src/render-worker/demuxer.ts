import * as MP4Box from 'mp4box'

// Thin wrapper around mp4box.js to parse H.264 video streams in memory.
// It parses the MP4 container structure, extracts track configuration (width, height,
// codec, and the avcC extradata/description required by VideoDecoder), and yields
// individual encoded frames as EncodedVideoChunk data.

export class MP4Demuxer {
  private file: any
  private track: any
  private info: any

  constructor(private buffer: ArrayBuffer) {
    this.file = MP4Box.createFile()
  }

  async parse(): Promise<{ codec: string; width: number; height: number; description: Uint8Array }> {
    return new Promise((resolve, reject) => {
      this.file.onReady = (info: any) => {
        this.info = info
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

        this.track = videoTrack
        resolve({
          codec: videoTrack.codec,
          width: videoTrack.video.width,
          height: videoTrack.video.height,
          description
        })
      }

      this.file.onError = (e: any) => {
        reject(new Error(`MP4Box error: ${e}`))
      }

      // Attach fileStart offset and append buffer to start parsing
      const ab = this.buffer as any
      ab.fileStart = 0
      this.file.appendBuffer(ab)
      this.file.flush()
    })
  }

  extractSamples(onSamples: (samples: any[]) => void): void {
    this.file.onSamples = (id: number, user: any, samples: any[]) => {
      onSamples(samples)
    }
    this.file.setExtractionOptions(this.track.id, null, { nbSamples: 100000 })
    this.file.start()
  }
}
