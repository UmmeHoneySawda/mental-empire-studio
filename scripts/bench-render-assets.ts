/**
 * Deterministic media for the render benchmark fixture (`npm run bench:render`).
 *
 * The fixture project is checked in; its media is NOT. Committing ~50 MB of b-roll to make
 * a benchmark reproducible is the wrong trade, so the media is regenerated from this
 * manifest with ffmpeg instead. Every source is a synthetic ffmpeg filter with no seed and
 * no clock input, so the decoded pixels are identical on every machine and every run.
 *
 * The one exception is audio, which the diagnosis requires to be REAL: `voice.mp3` is the
 * committed `test/fixtures/audio/sample.mp3` concatenated with `-c copy`. Real mp3 frames,
 * real decode path, zero added repo weight, byte-identical every time.
 *
 * What is NOT guaranteed: byte-identical *encoded* files across different ffmpeg builds.
 * x264 output depends on the build. That is why `bench-render.ts` records the ffmpeg
 * version in every result file — a baseline is only comparable to a run from the same
 * build. What IS asserted here is the part that governs render cost: duration, dimensions,
 * frame rate and codec.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ffmpegPath, ffprobePath } from '../electron/services/bin'

export const BENCH_FIXTURE_DIR = resolve('test/fixtures/bench-render')
export const BENCH_ASSET_DIR = join(BENCH_FIXTURE_DIR, 'assets')

/** Fixed forever. A changed duration invalidates every stored baseline. */
export const BENCH_FPS = 30
export const BENCH_WIDTH = 1920
export const BENCH_HEIGHT = 1080
export const BENCH_DURATION_FRAMES = 5400 // 180s @ 30fps

/** Each b-roll clip is longer than any scene that draws from it, so every scene can take a
 *  different `sourceRange` offset without running past the end of the file. */
export const BENCH_BROLL_SECONDS = 20
export const BENCH_BROLL_FRAMES = BENCH_BROLL_SECONDS * BENCH_FPS

/** 16 x 11.98875s = 191.8s, comfortably past the 180s canvas so the audio never runs dry. */
const AUDIO_LOOPS = 16
const SOURCE_AUDIO = resolve('test/fixtures/audio/sample.mp3')

interface VideoSpec {
  readonly file: string
  /** lavfi source. Deterministic only — no `life`, no `gradients`, nothing seeded. */
  readonly source: string
  /** Optional `-vf` chain. Must be a pure function of the frame index `n`. */
  readonly filter?: string
}

/**
 * Six visually distinct clips. Different sources rather than six copies of one, because a
 * single decoded clip would let the OS page cache flatter the decode path.
 *
 * **Every source must produce different pixels on every frame, with real spatial entropy.**
 * The first cut of this list used `smptehdbars`, `rgbtestsrc`, `yuvtestsrc` and `pal75bars`
 * raw, and four of the six clips came out at 56-104 KB for twenty seconds of 1080p — a
 * static pattern encodes to almost nothing, decodes to almost nothing, and lets Chrome's
 * compositor skip work that real footage would force. That would have understated both
 * decode and paint in every number the benchmark went on to produce.
 *
 * A per-frame `hue` rotation alone was not enough either: it changes colour but leaves the
 * flat regions flat, and those clips still landed at ~0.4 MB. Measured alternatives for a
 * 20s clip: hue only ~0.4 MB, hue+slow rotate ~3 MB, hue+seeded temporal noise ~8 MB.
 * The last matches `testsrc2`'s natural 13.6 MB and the 5-15 MB a real 1080p stock clip
 * occupies, so that is what the flat sources carry. `all_seed` is explicit, so the noise is
 * reproducible rather than random.
 */
export const BENCH_BROLL_SPECS: readonly VideoSpec[] = [
  { file: 'broll-01.mp4', source: `testsrc2=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}` },
  { file: 'broll-02.mp4', source: `smptehdbars=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}`, filter: 'hue=h=n*2.0,noise=alls=12:allf=t+u:all_seed=20260806' },
  { file: 'broll-03.mp4', source: `rgbtestsrc=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}`, filter: 'hue=h=n*3.0:s=1+0.4*sin(n/20),noise=alls=12:allf=t+u:all_seed=20260807' },
  { file: 'broll-04.mp4', source: `yuvtestsrc=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}`, filter: 'hue=h=-n*2.5,noise=alls=12:allf=t+u:all_seed=20260808' },
  { file: 'broll-05.mp4', source: `testsrc=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}`, filter: 'noise=alls=12:allf=t+u:all_seed=20260809' },
  { file: 'broll-06.mp4', source: `pal75bars=size=${BENCH_WIDTH}x${BENCH_HEIGHT}:rate=${BENCH_FPS}`, filter: 'hue=h=n*1.5:s=1+0.3*sin(n/15),noise=alls=12:allf=t+u:all_seed=20260810' },
]

/** Every generated clip must exceed this, or it is a static pattern masquerading as footage.
 *  Set well under the ~8 MB the specs above produce, so it catches the failure mode rather
 *  than the encoder's mood. */
const MIN_CLIP_BYTES = 2_000_000

export const BENCH_STILL_SPECS: readonly VideoSpec[] = [
  { file: 'still-01.png', source: `smptehdbars=size=${BENCH_WIDTH}x${BENCH_HEIGHT}` },
  { file: 'still-02.png', source: `testsrc2=size=${BENCH_WIDTH}x${BENCH_HEIGHT}` },
  { file: 'still-03.png', source: `rgbtestsrc=size=${BENCH_WIDTH}x${BENCH_HEIGHT}` },
  { file: 'still-04.png', source: `pal100bars=size=${BENCH_WIDTH}x${BENCH_HEIGHT}` },
]

export const BENCH_AUDIO_FILE = 'voice.mp3'

function run(bin: string, args: readonly string[], label: string): void {
  const result = spawnSync(bin, args as string[], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').split('\n').slice(-6).join('\n')
    throw new Error(`${label} failed (status ${result.status}):\n${detail}`)
  }
}

export interface ProbeFacts {
  readonly durationSec: number
  readonly videoCodec: string
  readonly audioCodec: string
  readonly width: number
  readonly height: number
  readonly fps: number
}

export function probe(filePath: string): ProbeFacts {
  const result = spawnSync(
    ffprobePath(),
    [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of', 'json',
      filePath,
    ],
    { encoding: 'utf8', windowsHide: true },
  )
  if (result.status !== 0) throw new Error(`ffprobe failed for ${filePath}`)
  const parsed = JSON.parse(result.stdout || '{}') as {
    format?: { duration?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
      r_frame_rate?: string
    }>
  }
  const video = parsed.streams?.find((s) => s.codec_type === 'video')
  const audio = parsed.streams?.find((s) => s.codec_type === 'audio')
  const [num, den] = (video?.r_frame_rate ?? '0/1').split('/')
  return {
    durationSec: Number(parsed.format?.duration ?? 0),
    videoCodec: video?.codec_name ?? '',
    audioCodec: audio?.codec_name ?? '',
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: Number(den) > 0 ? Number(num) / Number(den) : 0,
  }
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function buildAudio(target: string): void {
  if (!existsSync(SOURCE_AUDIO)) {
    throw new Error(`The committed source audio is missing: ${SOURCE_AUDIO}`)
  }
  // The concat demuxer over N identical entries, stream-copied: no re-encode, so the output
  // is a deterministic byte concatenation of real mp3 frames.
  const listPath = join(BENCH_ASSET_DIR, 'voice.concat.txt')
  const entry = SOURCE_AUDIO.replace(/\\/g, '/').replace(/'/g, "'\\''")
  writeFileSync(listPath, Array.from({ length: AUDIO_LOOPS }, () => `file '${entry}'`).join('\n') + '\n')
  run(
    ffmpegPath(),
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', target],
    `bench audio (${BENCH_AUDIO_FILE})`,
  )
}

function buildClip(spec: VideoSpec, target: string): void {
  run(
    ffmpegPath(),
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', `${spec.source}:duration=${BENCH_BROLL_SECONDS}`,
      ...(spec.filter ? ['-vf', spec.filter] : []),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-g', String(BENCH_FPS * 2),
      '-an',
      target,
    ],
    `bench clip (${spec.file})`,
  )
}

function buildStill(spec: VideoSpec, target: string): void {
  run(
    ffmpegPath(),
    ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', spec.source, '-frames:v', '1', target],
    `bench still (${spec.file})`,
  )
}

export interface AssetLockEntry {
  readonly file: string
  readonly bytes: number
  readonly sha256: string
  readonly probe: ProbeFacts
}

/**
 * Generate anything missing, then assert the decode-relevant facts. Existing files are left
 * alone — regenerating ~50 MB of 1080p on every run would dominate the measurement it exists
 * to take. Delete `test/fixtures/bench-render/assets/` to force a rebuild.
 */
export function ensureBenchAssets(options: { readonly quiet?: boolean } = {}): readonly AssetLockEntry[] {
  const say = (message: string): void => {
    if (!options.quiet) console.log(message)
  }
  mkdirSync(BENCH_ASSET_DIR, { recursive: true })

  const audioTarget = join(BENCH_ASSET_DIR, BENCH_AUDIO_FILE)
  if (!existsSync(audioTarget)) {
    say(`  generating ${BENCH_AUDIO_FILE} (real mp3, ${AUDIO_LOOPS}x the committed sample)`)
    buildAudio(audioTarget)
  }

  for (const spec of BENCH_BROLL_SPECS) {
    const target = join(BENCH_ASSET_DIR, spec.file)
    if (existsSync(target)) continue
    say(`  generating ${spec.file} (${BENCH_BROLL_SECONDS}s ${BENCH_WIDTH}x${BENCH_HEIGHT} h264)`)
    buildClip(spec, target)
  }

  for (const spec of BENCH_STILL_SPECS) {
    const target = join(BENCH_ASSET_DIR, spec.file)
    if (existsSync(target)) continue
    say(`  generating ${spec.file}`)
    buildStill(spec, target)
  }

  const lock: AssetLockEntry[] = []
  const fail: string[] = []

  const record = (file: string): ProbeFacts => {
    const target = join(BENCH_ASSET_DIR, file)
    const facts = probe(target)
    lock.push({ file, bytes: statSync(target).size, sha256: sha256(target), probe: facts })
    return facts
  }

  const audioFacts = record(BENCH_AUDIO_FILE)
  if (audioFacts.audioCodec !== 'mp3') fail.push(`${BENCH_AUDIO_FILE}: expected mp3, got ${audioFacts.audioCodec}`)
  if (audioFacts.durationSec * BENCH_FPS < BENCH_DURATION_FRAMES) {
    fail.push(`${BENCH_AUDIO_FILE}: ${audioFacts.durationSec.toFixed(2)}s is shorter than the ${BENCH_DURATION_FRAMES}-frame canvas`)
  }

  for (const spec of BENCH_BROLL_SPECS) {
    const facts = record(spec.file)
    const entry = lock[lock.length - 1]!
    // A clip that compresses below this is a still frame repeated 600 times: near-zero
    // decode, and a compositor that can skip work real footage would force. See the note
    // on BENCH_BROLL_SPECS — this exact failure shipped in the first cut of the fixture.
    if (entry.bytes < MIN_CLIP_BYTES) {
      fail.push(
        `${spec.file}: ${entry.bytes} bytes for ${BENCH_BROLL_SECONDS}s of ${BENCH_WIDTH}x${BENCH_HEIGHT} — ` +
          `that is a static pattern, not footage. Give its spec a per-frame filter.`,
      )
    }
    if (facts.videoCodec !== 'h264') fail.push(`${spec.file}: expected h264, got ${facts.videoCodec}`)
    if (facts.width !== BENCH_WIDTH || facts.height !== BENCH_HEIGHT) {
      fail.push(`${spec.file}: expected ${BENCH_WIDTH}x${BENCH_HEIGHT}, got ${facts.width}x${facts.height}`)
    }
    if (Math.round(facts.fps) !== BENCH_FPS) fail.push(`${spec.file}: expected ${BENCH_FPS}fps, got ${facts.fps}`)
    if (Math.round(facts.durationSec) !== BENCH_BROLL_SECONDS) {
      fail.push(`${spec.file}: expected ${BENCH_BROLL_SECONDS}s, got ${facts.durationSec.toFixed(2)}s`)
    }
  }

  for (const spec of BENCH_STILL_SPECS) {
    const facts = record(spec.file)
    if (facts.width !== BENCH_WIDTH || facts.height !== BENCH_HEIGHT) {
      fail.push(`${spec.file}: expected ${BENCH_WIDTH}x${BENCH_HEIGHT}, got ${facts.width}x${facts.height}`)
    }
  }

  if (fail.length > 0) {
    throw new Error(
      `Benchmark media does not match the manifest, so a baseline taken with it would be meaningless:\n  - ${fail.join('\n  - ')}\n` +
        `Delete ${BENCH_ASSET_DIR} and re-run to regenerate.`,
    )
  }

  writeFileSync(join(BENCH_FIXTURE_DIR, 'assets.lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
  return lock
}

export function ffmpegVersion(): string {
  const result = spawnSync(ffmpegPath(), ['-version'], { encoding: 'utf8', windowsHide: true })
  return (result.stdout || '').split('\n')[0]?.trim() ?? 'unknown'
}
