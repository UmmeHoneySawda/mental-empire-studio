// Provisions the native sidecars into resources/bin for the current platform:
//   • yt-dlp  — downloaded (single self-contained binary, no Python)
//   • ffmpeg / ffprobe — copied from PATH if present (CI installs them via the OS
//     package manager; locally, install ffmpeg or drop static builds here).
// Run via `npm run fetch:bin`. resources/bin is gitignored; CI/packaging re-runs this.
import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const binDir = join(__dirname, '..', 'resources', 'bin')
const isWin = process.platform === 'win32'
mkdirSync(binDir, { recursive: true })

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

/** First match of a command on PATH, or '' if not found. */
function onPath(cmd) {
  try {
    const which = isWin ? 'where' : 'which'
    return execSync(`${which} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().split(/\r?\n/)[0].trim()
  } catch {
    return ''
  }
}

/** Copy a binary from PATH into resources/bin so electron-builder bundles it. */
function vendorFromPath(name) {
  const exe = isWin ? `${name}.exe` : name
  const dst = join(binDir, exe)
  if (existsSync(dst) && !process.env.FORCE) {
    console.log(`✓ ${exe} already vendored`)
    return true
  }
  const src = onPath(name) || onPath(exe)
  if (src && existsSync(src)) {
    copyFileSync(src, dst)
    if (!isWin) chmodSync(dst, 0o755)
    console.log(`✓ vendored ${exe} from ${src}`)
    return true
  }
  return false
}

// --- yt-dlp (download) ---
const YTDLP_ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp' }[process.platform]
if (!YTDLP_ASSET) {
  console.error(`Unsupported platform: ${process.platform}`)
  process.exit(1)
}
const ytdlpDest = join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp')
if (existsSync(ytdlpDest) && !process.env.FORCE) {
  console.log('✓ yt-dlp already present (set FORCE=1 to re-download)')
} else {
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`
  console.log(`Downloading ${url}`)
  await download(url, ytdlpDest)
  if (!isWin) chmodSync(ytdlpDest, 0o755)
  console.log('✓ yt-dlp ready')
}

// --- ffmpeg / ffprobe (vendor from PATH) ---
const haveFfmpeg = vendorFromPath('ffmpeg')
vendorFromPath('ffprobe') // optional (duration uses music-metadata); nice for completeness
if (!haveFfmpeg) {
  console.log(
    '\nℹ ffmpeg not found on PATH. Rendering (M6) needs ffmpeg built with --enable-libass.\n' +
      '  • Linux:  apt-get install ffmpeg    • macOS: brew install ffmpeg    • Windows: choco install ffmpeg\n' +
      `  …then re-run \`npm run fetch:bin\`, or drop a static ffmpeg into ${binDir}.`
  )
}
