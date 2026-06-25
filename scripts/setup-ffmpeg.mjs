// Downloads a static ffmpeg + ffprobe (built with libass, required for burned ASS
// captions) into resources/bin. Used by the e2e render test and as a fallback when
// the OS package manager isn't available. Linux/x64 (BtbN). Idempotent.
import { existsSync, mkdirSync, chmodSync, createWriteStream, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const binDir = join(__dirname, '..', 'resources', 'bin')
mkdirSync(binDir, { recursive: true })

if (process.platform !== 'linux') {
  console.log('setup-ffmpeg.mjs targets linux/x64; on mac/win use `brew/choco install ffmpeg` then `npm run fetch:bin`.')
  process.exit(0)
}
if (existsSync(join(binDir, 'ffmpeg')) && !process.env.FORCE) {
  console.log('✓ ffmpeg already vendored (FORCE=1 to re-download)')
  process.exit(0)
}

const url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz'
const tar = join(tmpdir(), 'me-ffmpeg.tar.xz')
const work = join(tmpdir(), 'me-ffmpeg-x')

console.log(`Downloading ${url}`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) throw new Error(`ffmpeg download failed ${res.status}`)
await new Promise((resolve, reject) => {
  const f = createWriteStream(tar)
  res.body.pipeTo(new WritableStream({ write: (c) => new Promise((r) => f.write(c, r)), close: () => f.end(resolve), abort: reject }))
})

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
execSync(`tar -xJf "${tar}" -C "${work}"`)

function find(name) {
  const stack = [work]
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
for (const name of ['ffmpeg', 'ffprobe']) {
  const src = find(name)
  if (!src) throw new Error(`${name} not found in archive`)
  copyFileSync(src, join(binDir, name))
  chmodSync(join(binDir, name), 0o755)
  console.log(`✓ vendored ${name}`)
}
rmSync(tar, { force: true })
rmSync(work, { recursive: true, force: true })
console.log('ffmpeg ready (libass).')
