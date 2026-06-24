import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import type { AppSettings } from '../../shared/types'

// Low-level yt-dlp runner. yt-dlp is the no-API way to read public channel/video
// metadata: we spawn the standalone binary, ask for a single JSON dump of the
// (flat) playlist, and parse it. All scraping flows through here so proxy / cookies
// / request-delay / retries live in one place.

/** Locate the bundled yt-dlp binary (override via ME_YTDLP_PATH; packaged under resources/bin). */
export function resolveYtdlpPath(): string {
  const override = process.env['ME_YTDLP_PATH']
  if (override) return override
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'bin', exe) : ''
  if (packaged && existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'bin', exe)
}

/** Directory holding the vendored sidecars (yt-dlp, ffmpeg) — used for --ffmpeg-location. */
export function resolveBinDir(): string {
  return dirname(resolveYtdlpPath())
}

export interface YtdlpEntry {
  id?: string
  title?: string
  duration?: number
  view_count?: number
  upload_date?: string
  thumbnails?: Array<{ url?: string }>
}

export interface YtdlpPlaylist {
  id?: string
  channel?: string
  uploader?: string
  uploader_id?: string
  channel_id?: string
  channel_follower_count?: number
  entries?: Array<YtdlpEntry | null>
}

export interface YtdlpOptions {
  proxy?: string
  cookiesPath?: string
  delaySec?: number
  retries?: number
}

export function ytdlpOptionsFromSettings(s: AppSettings): YtdlpOptions {
  const a = s.autoScrape
  return { proxy: a.proxy, cookiesPath: a.cookiesPath, delaySec: a.delaySec, retries: a.retries }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Extract the @handle from a channel URL, used to key offline fixtures. */
function handleFromUrl(url: string): string {
  const m = url.match(/@([A-Za-z0-9_.-]+)/)
  return m ? m[1] : url.replace(/[^A-Za-z0-9]+/g, '_')
}

/** Offline test seam: read a recorded yt-dlp JSON dump instead of hitting the network. */
function readFixture(url: string): YtdlpPlaylist {
  const dir = process.env['ME_YTDLP_FIXTURE'] as string
  const file = join(dir, `${handleFromUrl(url)}.json`)
  if (!existsSync(file)) throw new Error(`No yt-dlp fixture for ${url} (expected ${file})`)
  return JSON.parse(readFileSync(file, 'utf8')) as YtdlpPlaylist
}

/** Run yt-dlp for a URL and return the parsed playlist JSON, retrying with backoff. */
export async function runYtdlpJson(url: string, opts: YtdlpOptions = {}): Promise<YtdlpPlaylist> {
  if (process.env['ME_YTDLP_FIXTURE']) return readFixture(url)
  const retries = Math.max(0, opts.retries ?? 0)
  let lastErr: Error | null = null
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await spawnYtdlp(url, opts)
    } catch (e) {
      lastErr = e as Error
      if (attempt < retries) await sleep(1000 * 2 ** attempt) // exponential backoff
    }
  }
  throw lastErr ?? new Error('yt-dlp failed')
}

function spawnYtdlp(url: string, opts: YtdlpOptions): Promise<YtdlpPlaylist> {
  return new Promise((resolve, reject) => {
    const args = ['-J', '--flat-playlist', '--no-warnings', '--ignore-errors']
    if (opts.proxy) args.push('--proxy', opts.proxy)
    if (opts.cookiesPath) args.push('--cookies', opts.cookiesPath)
    if (opts.delaySec) args.push('--sleep-requests', String(opts.delaySec))
    args.push(url)

    const child = spawn(resolveYtdlpPath(), args, { windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 && !out.trim()) {
        return reject(new Error(`yt-dlp exited ${code}: ${err.slice(0, 300)}`))
      }
      try {
        resolve(JSON.parse(out) as YtdlpPlaylist)
      } catch {
        reject(new Error(`yt-dlp JSON parse failed: ${out.slice(0, 200)}`))
      }
    })
  })
}
