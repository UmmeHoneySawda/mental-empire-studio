// Writes a tiny valid CBR MP3 (silent) for offline tests so music-metadata can
// report a real duration without ffmpeg. MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono.
// Duration ≈ frames * 1152 / 44100. ~460 frames ≈ 12 s.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = join(__dirname, '..', 'test', 'fixtures', 'audio', 'sample.mp3')

const FRAMES = 460
const FRAME_SIZE = 417 // floor(144 * 128000 / 44100)

// MPEG-1 Layer III, 128kbps (0x9), 44.1kHz (0x0), no padding, mono (0xC0).
const header = Buffer.from([0xff, 0xfb, 0x90, 0xc0])

const buf = Buffer.alloc(FRAMES * FRAME_SIZE)
for (let f = 0; f < FRAMES; f++) {
  header.copy(buf, f * FRAME_SIZE) // rest of the frame stays zero = silence
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, buf)
console.log(`Wrote ${out} (${buf.length} bytes, ~${((FRAMES * 1152) / 44100).toFixed(1)}s)`)
