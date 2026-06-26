import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AppSettings, ScrapedVideo } from '../../shared/types'
import { resolveBinDir, resolveYtdlpPath } from './ytdlp'
import { formatOutputName } from './audio'
import { L } from './logger'

/** Vendored ffmpeg dir if present, else undefined → yt-dlp falls back to PATH. */
function vendoredFfmpegDir(): string | undefined {
  const dir = resolveBinDir()
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  return existsSync(join(dir, exe)) ? dir : undefined
}

// Downloads a source video's audio as mp3 via yt-dlp (+ vendored ffmpeg for the
// extraction). Resume-aware: an already-complete file is never re-fetched. In the
// sandbox (no ffmpeg / YouTube blocked) ME_DOWNLOAD_FIXTURE copies a sample mp3 so
// the surrounding history/probe/range logic is exercised for real.

export interface DownloadResult {
  filePath: string
  skipped: boolean
}

export interface DownloadParams {
  video: ScrapedVideo
  channel: string
  outDir: string
  bitrate: number
  settings: AppSettings
  onProgress?: (pct: number) => void
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

/** Target mp3 path for a video, named via the Settings template. */
export function targetPath(outDir: string, channel: string, title: string): string {
  return join(outDir, `${formatOutputName('{channel} - {title}', { channel, title })}.mp3`)
}

export async function downloadAudio(params: DownloadParams): Promise<DownloadResult> {
  const { video, channel, outDir, bitrate, settings, onProgress } = params
  mkdirSync(outDir, { recursive: true })
  const dest = targetPath(outDir, channel, video.title)

  // Resume: a finished file is reused, never re-downloaded.
  if (existsSync(dest) && statSync(dest).size > 0) {
    onProgress?.(100)
    return { filePath: dest, skipped: true }
  }

  // Offline seam: copy a recorded sample mp3 to simulate a completed download.
  const fixture = process.env['ME_DOWNLOAD_FIXTURE']
  if (fixture) {
    copyFileSync(fixture, dest)
    onProgress?.(100)
    return { filePath: dest, skipped: false }
  }

  await runYtdlpDownload(video, dest, bitrate, settings, onProgress)
  return { filePath: dest, skipped: false }
}

function runYtdlpDownload(
  video: ScrapedVideo,
  dest: string,
  bitrate: number,
  settings: AppSettings,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const a = settings.autoScrape
    const args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', `${bitrate}K`,
      '--newline',
      '--continue',
      '--no-warnings',
      '-o', dest.replace(/\.mp3$/, '.%(ext)s')
    ]
    const ffmpegDir = vendoredFfmpegDir()
    if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir)
    else L.warn('downloader: no vendored ffmpeg found — mp3 extraction may fail')
    if (a.proxy) args.push('--proxy', a.proxy)
    if (a.cookiesPath) args.push('--cookies', a.cookiesPath)
    args.push(watchUrl(video.id))

    const bin = resolveYtdlpPath()
    L.info(`yt-dlp download: ${bin} ${args.join(' ')}`)
    if (!existsSync(bin)) L.error(`yt-dlp binary missing at ${bin} — download will fail`)
    const child = spawn(bin, args, { windowsHide: true })
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      const m = d.toString().match(/\[download\]\s+([\d.]+)%/)
      if (m) onProgress?.(parseFloat(m[1]))
    })
    child.stderr.on('data', (d: Buffer) => (err += d))
    child.on('error', (e) => { L.error(`yt-dlp download spawn error: ${e.message} (bin=${bin})`); reject(e) })
    child.on('close', (code) => {
      if (code === 0 && existsSync(dest)) {
        L.info(`download ok: ${dest}`)
        onProgress?.(100)
        resolve()
      } else {
        L.error(`yt-dlp download failed (${code}) for "${video.title}": ${err.slice(0, 600)}`)
        reject(new Error(`yt-dlp download failed (${code}): ${err.slice(0, 300)}`))
      }
    })
  })
}
