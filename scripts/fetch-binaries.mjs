// Provisions the native sidecars into resources/bin for the current platform:
//   • yt-dlp            — single self-contained binary (no Python)
//   • ffmpeg + ffprobe  — STATIC builds with libass (BtbN on win/linux, evermeet on mac)
//
// We download static ffmpeg/ffprobe directly rather than copying from PATH, because:
//   1. yt-dlp's mp3 post-processing needs BOTH ffmpeg AND ffprobe — copying only ffmpeg
//      (or a package-manager shim that doesn't relocate) makes downloads fail with
//      "ffprobe and ffmpeg not found" even though ffmpeg.exe is present.
//   2. Rendering (M6) needs ffmpeg built with --enable-libass for burned ASS captions;
//      the BtbN/evermeet builds guarantee that. PATH ffmpeg often isn't built with it.
// Run via `npm run fetch:bin`. resources/bin is gitignored; CI/packaging re-runs this.
import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const binDir = join(__dirname, '..', 'resources', 'bin')
const platform = process.platform
const isWin = platform === 'win32'
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

/** Recursively find the first file named `name` under `root`. */
function findFile(root, name) {
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === name) return p
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------
const YTDLP_ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp' }[platform]
if (!YTDLP_ASSET) {
  console.error(`Unsupported platform: ${platform}`)
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

// ---------------------------------------------------------------------------
// ffmpeg + ffprobe (static, libass) — BtbN (win/linux), evermeet (mac)
// ---------------------------------------------------------------------------
const ffmpegExe = isWin ? 'ffmpeg.exe' : 'ffmpeg'
const ffprobeExe = isWin ? 'ffprobe.exe' : 'ffprobe'
const haveBoth = existsSync(join(binDir, ffmpegExe)) && existsSync(join(binDir, ffprobeExe))

if (haveBoth && !process.env.FORCE) {
  console.log('✓ ffmpeg + ffprobe already vendored (set FORCE=1 to re-download)')
} else if (platform === 'darwin') {
  // evermeet ships ffmpeg + ffprobe as separate zip archives.
  for (const name of ['ffmpeg', 'ffprobe']) {
    const zip = join(tmpdir(), `me-${name}.zip`)
    const work = join(tmpdir(), `me-${name}-x`)
    rmSync(work, { recursive: true, force: true })
    mkdirSync(work, { recursive: true })
    const url = `https://evermeet.cx/ffmpeg/getrelease/${name}/zip`
    console.log(`Downloading ${url}`)
    await download(url, zip)
    execSync(`tar -xf "${zip}" -C "${work}"`) // bsdtar extracts zip on macOS
    const src = findFile(work, name)
    if (!src) throw new Error(`${name} not found in evermeet archive`)
    copyFileSync(src, join(binDir, name))
    chmodSync(join(binDir, name), 0o755)
    rmSync(zip, { force: true })
    rmSync(work, { recursive: true, force: true })
    console.log(`✓ vendored ${name} (evermeet, libass)`)
  }
} else {
  // BtbN: a single archive contains bin/ffmpeg(.exe) + bin/ffprobe(.exe).
  const asset = isWin
    ? { name: 'ffmpeg-master-latest-win64-gpl.zip', ext: 'zip' }
    : { name: 'ffmpeg-master-latest-linux64-gpl.tar.xz', ext: 'txz' }
  const archive = join(tmpdir(), `me-ffmpeg.${asset.ext}`)
  const work = join(tmpdir(), 'me-ffmpeg-x')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const url = `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${asset.name}`
  console.log(`Downloading ${url}`)
  await download(url, archive)
  // tar (bsdtar) on Windows 10+ extracts zip; -xJf for the linux tar.xz.
  execSync(isWin ? `tar -xf "${archive}" -C "${work}"` : `tar -xJf "${archive}" -C "${work}"`)
  for (const exe of [ffmpegExe, ffprobeExe]) {
    const src = findFile(work, exe)
    if (!src) throw new Error(`${exe} not found in BtbN archive`)
    copyFileSync(src, join(binDir, exe))
    if (!isWin) chmodSync(join(binDir, exe), 0o755)
    console.log(`✓ vendored ${exe} (BtbN, libass)`)
  }
  rmSync(archive, { force: true })
  rmSync(work, { recursive: true, force: true })
}

// Final sanity report — both must exist or downloads/renders fail at runtime.
for (const exe of [ffmpegExe, ffprobeExe]) {
  if (!existsSync(join(binDir, exe))) {
    console.error(`✗ ${exe} is MISSING from ${binDir} — downloads + rendering will fail.`)
    process.exit(1)
  }
}
console.log('Sidecars ready:', readdirSync(binDir).join(', '))
