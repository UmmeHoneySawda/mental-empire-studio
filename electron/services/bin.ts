import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

function binName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

export function resolveYtdlpPath(): string {
  const override = process.env['ME_YTDLP_PATH']
  if (override) return override
  const exe = binName('yt-dlp')
  const packaged = process.resourcesPath ? join(process.resourcesPath, 'bin', exe) : ''
  if (packaged && existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'bin', exe)
}

export function resolveBinDir(): string {
  return dirname(resolveYtdlpPath())
}

export function ffmpegPath(): string {
  const exe = binName('ffmpeg')
  const vendored = join(resolveBinDir(), exe)
  return existsSync(vendored) ? vendored : exe
}

export function ffprobePath(): string {
  const exe = binName('ffprobe')
  const vendored = join(resolveBinDir(), exe)
  return existsSync(vendored) ? vendored : exe
}
