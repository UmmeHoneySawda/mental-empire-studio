// Downloads the standalone yt-dlp binary into resources/bin for the current platform.
// yt-dlp is a single self-contained executable (no Python needed). Run via
// `node scripts/fetch-binaries.mjs`. The binary is gitignored; CI/packaging re-fetches it.
import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const binDir = join(__dirname, '..', 'resources', 'bin')

const ASSET = {
  win32: 'yt-dlp.exe',
  darwin: 'yt-dlp_macos',
  linux: 'yt-dlp'
}

const outName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
const asset = ASSET[process.platform]
if (!asset) {
  console.error(`Unsupported platform: ${process.platform}`)
  process.exit(1)
}

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`
const dest = join(binDir, outName)

async function download(from, to) {
  const res = await fetch(from, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${from}`)
  await new Promise((resolve, reject) => {
    const file = createWriteStream(to)
    res.body.pipeTo(
      new WritableStream({
        write: (chunk) => new Promise((r) => file.write(chunk, r)),
        close: () => file.end(resolve),
        abort: reject
      })
    )
  })
}

mkdirSync(binDir, { recursive: true })
if (existsSync(dest) && !process.env.FORCE) {
  console.log(`yt-dlp already present at ${dest} (set FORCE=1 to re-download)`)
  process.exit(0)
}

console.log(`Downloading ${url} → ${dest}`)
await download(url, dest)
if (process.platform !== 'win32') chmodSync(dest, 0o755)
console.log('yt-dlp ready.')

// ffmpeg/ffprobe are needed for mp3 extraction (M4) and rendering (M6). Static,
// single-file builds vary per platform; place ffmpeg(.exe)/ffprobe(.exe) in
// resources/bin, or have them on PATH (yt-dlp/our downloader fall back to PATH).
const ffName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
if (!existsSync(join(binDir, ffName))) {
  console.log(
    '\nℹ ffmpeg/ffprobe not vendored yet. Get static builds from ' +
      'https://github.com/ffbinaries/ffbinaries-prebuilt/releases and drop ' +
      `ffmpeg + ffprobe into ${binDir} (or install them on PATH).`
  )
}
