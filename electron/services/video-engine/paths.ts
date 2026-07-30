import { mkdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { VideoEngineError } from './errors'

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
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, ...segments)
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
