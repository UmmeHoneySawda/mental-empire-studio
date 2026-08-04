import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ensureDirectory } from '../paths'

const pathLocks = new Map<string, Promise<void>>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeLockKey(path: string): string {
  return resolve(path).toLowerCase()
}

async function withPathLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = normalizeLockKey(path)
  const previous = pathLocks.get(key) ?? Promise.resolve()
  let resolveLock!: () => void
  const current = new Promise<void>((resolve) => {
    resolveLock = resolve
  })
  pathLocks.set(key, previous.then(() => current, () => current))
  try {
    await previous.catch(() => undefined)
    return await fn()
  } finally {
    resolveLock()
    if (pathLocks.get(key) === current) {
      pathLocks.delete(key)
    }
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  return withPathLock(path, async () => {
    const directory = await ensureDirectory(dirname(path))
    const temporaryPath = join(directory, `.${randomUUID()}.tmp`)
    try {
      await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      let replaced = false
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          await rename(temporaryPath, path)
          replaced = true
          break
        } catch (error: any) {
          const code = error?.code
          if (
            attempt < 14 &&
            (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EMFILE' || code === 'EEXIST')
          ) {
            await sleep(25 * (attempt + 1))
          } else {
            break
          }
        }
      }
      if (!replaced) {
        for (let attempt = 0; attempt < 15; attempt++) {
          try {
            await copyFile(temporaryPath, path)
            replaced = true
            break
          } catch (error: any) {
            const code = error?.code
            if (
              attempt < 14 &&
              (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES' || code === 'EMFILE' || code === 'EEXIST')
            ) {
              await sleep(25 * (attempt + 1))
            } else {
              throw error
            }
          }
        }
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  })
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
