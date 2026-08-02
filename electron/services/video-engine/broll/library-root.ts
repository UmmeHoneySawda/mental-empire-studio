import { posix, win32 } from 'node:path'

/** Resolve the durable stock-footage library without importing Electron. */
export function resolveBrollLibraryRoot(
  userDataRoot: string,
  override = process.env['ME_BROLL_LIBRARY_DIR'],
  platform: NodeJS.Platform = process.platform,
  isolatedProfile = process.env['ME_E2E'] === '1' || !!process.env['ME_SMOKE_USERDATA_DIR']
): string {
  const configured = override?.trim()
  if (configured) return platform === 'win32' ? win32.resolve(configured) : posix.resolve(configured)
  if (isolatedProfile) {
    return platform === 'win32'
      ? win32.join(userDataRoot, 'broll-library')
      : posix.join(userDataRoot, 'broll-library')
  }
  if (platform === 'win32') return win32.join('D:\\', 'Mental Empire Studio', 'broll-library')
  return posix.join(userDataRoot, 'broll-library')
}
