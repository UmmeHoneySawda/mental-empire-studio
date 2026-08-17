import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { VideoEngineError } from './errors'

/**
 * Returns true when a D: video-engine or library root is configured via env.
 * Mirrors the precedence in storage.ts / studio.ts without importing either
 * (avoids the cycle: paths -> studio -> storage). Settings-based D: (libraryFolder)
 * is intentionally not covered here — that layer is checked by callers that can
 * safely import videoEngineDataRoot (e.g. storage.ts), while this env-only probe
 * is sufficient to make resolveInside refusal deterministic in tests.
 */
function isConfiguredOnD(): boolean {
  const candidates = [
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'],
    process.env['ME_VIDEO_ENGINE_DIR'],
    process.env['ME_VIDEO_ENGINE_ROOT'],
    process.env['MENTAL_EMPIRE_LIBRARY'],
    process.env['ME_LIBRARY_ROOT'],
    process.env['ME_LIBRARY_DIR'],
    process.env['MENTAL_EMPIRE_OUTPUT'],
    process.env['ME_OUTPUT_DIR'],
  ]
  for (const value of candidates) {
    const trimmed = (value || '').trim()
    if (trimmed && trimmed.toLowerCase().startsWith('d:')) return true
  }
  return false
}

export function assertNotOnCDrive(target: string): void {
  const isC = target.toLowerCase().startsWith('c:')
  if (!isC) return
  const configuredOnD = (() => {
    try {
      return isConfiguredOnD()
    } catch {
      return false
    }
  })()
  if (isC && configuredOnD) {
    throw new VideoEngineError(
      'PATH_OUTSIDE_WORKSPACE',
      `Refusing to write to C: while D: is configured: ${target}`,
    )
  }
}

export async function ensureDirectory(path: string): Promise<string> {
  const absolute = resolve(path)
  await mkdir(absolute, { recursive: true })
  return absolute
}

export function assertSafeId(id: string, label = 'id'): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) {
    throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', `Invalid ${label}: ${id}`)
  }
  return id
}

export function resolveInside(root: string, ...segments: string[]): string {
  assertNotOnCDrive(root)
  const absoluteRoot = resolve(root)
  assertNotOnCDrive(absoluteRoot)
  const target = resolve(absoluteRoot, ...segments)
  assertNotOnCDrive(target)
  const rel = relative(absoluteRoot, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target
  throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', `Path escapes video-engine workspace: ${target}`)
}

export async function resolveExistingInside(root: string, path: string): Promise<string> {
  const absoluteRoot = await realpath(resolve(root))
  const target = await realpath(isAbsolute(path) ? path : resolve(absoluteRoot, path))
  const rel = relative(absoluteRoot, target)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return target
  throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', `Path escapes video-engine workspace: ${target}`)
}

export async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true })
}
