import { existsSync } from 'node:fs'
import { join } from 'node:path'

function compositorPackageName(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string | null {
  if (platform === 'win32' && arch === 'x64') return 'compositor-win32-x64-msvc'
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return `compositor-darwin-${arch}`
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64')) {
    return `compositor-linux-${arch}-gnu`
  }
  return null
}

/**
 * Electron cannot spawn Remotion's FFmpeg from inside app.asar. electron-builder
 * unpacks the compositor package, so packaged renders must point Remotion at that
 * physical directory explicitly.
 */
export function packagedRemotionBinariesDirectory(
  resourcesPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): string | undefined {
  if (!resourcesPath) return undefined
  const packageName = compositorPackageName(platform, arch)
  if (!packageName) return undefined

  const candidate = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@remotion',
    packageName
  )
  const executableSuffix = platform === 'win32' ? '.exe' : ''
  const required = [
    `remotion${executableSuffix}`,
    `ffmpeg${executableSuffix}`,
    `ffprobe${executableSuffix}`
  ]
  return required.every((name) => existsSync(join(candidate, name)))
    ? candidate
    : undefined
}
