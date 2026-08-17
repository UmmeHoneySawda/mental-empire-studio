import { mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { VideoEngineError } from './errors'
import { getSettings as getSettingsEsm } from '../../store/settings'

/**
 * Returns true when a D: video-engine or library root is configured via env
 * OR settings-driven D: (getSettings().libraryFolder / outputFolder).
 * Uses lazy dynamic import via createRequire to avoid the cycle
 * paths -> studio -> storage, with a static fallback for test mocking.
 * Note: preferredDefaultRoot / existsSync D: is intentionally not part of
 * the hard guard — it would block every C: temp dir on D: machines and
 * break isolated test roots. The storage layer's warn guard covers that
 * via preferredDefaultRoot, while this hard guard stays explicit.
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
  // settings-driven D: via lazy dynamic import (covers Settings UI without env)
  try {
    const require = createRequire(import.meta.url)
    const mod = require('../../store/settings') as {
      getSettings?: () => { libraryFolder?: string; outputFolder?: string }
    }
    const getSettings = mod?.getSettings
    if (getSettings) {
      const s = getSettings()
      const chosen = (s.libraryFolder || s.outputFolder || '').trim()
      if (chosen.toLowerCase().startsWith('d:')) return true
    }
  } catch {}
  // ESM static fallback (mock-friendly in vitest)
  try {
    const s = getSettingsEsm()
    const chosen = (s.libraryFolder || s.outputFolder || '').trim()
    if (chosen.toLowerCase().startsWith('d:')) return true
  } catch {}
  return false
}

export function assertNotOnCDrive(target: string): void {
  const lower = target.toLowerCase()
  const isC = lower.startsWith('c:')
  if (!isC) return
  // Isolated test fixtures live in the OS temp dir — allow them even when D: is configured.
  // The hard guard is for library / video-engine writes, not transient test roots.
  try {
    const tmp = tmpdir().toLowerCase()
    if (tmp && lower.startsWith(tmp)) return
    // 8.3 short-path variant (e.g. SIFAHI~1 when username contains a space)
    if (lower.includes('\\temp\\mental-empire')) return
    if (lower.includes('\\appdata\\local\\temp\\')) return
  } catch {}
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
