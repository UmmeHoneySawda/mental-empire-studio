import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, copyFile, rename, rm, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { VideoEngineError } from '../errors'
import { ensureDirectory } from '../paths'
import { writeJsonAtomic } from '../storage/atomic-json'
import type { BrollCandidate, CachedBrollAsset } from './types'

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v'])

function extensionFor(candidate: BrollCandidate, contentType?: string | null): string {
  const fromUrl = extname(new URL(candidate.downloadUrl).pathname).toLowerCase()
  if (ALLOWED_EXTENSIONS.has(fromUrl)) return fromUrl
  if (contentType?.includes('webm')) return '.webm'
  if (contentType?.includes('quicktime')) return '.mov'
  return '.mp4'
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

export class BrollCache {
  private readonly maxBytes: number

  constructor(
    private readonly cacheRoot: string,
    options: { maxBytes?: number } = {}
  ) {
    this.maxBytes = options.maxBytes ?? 2 * 1024 * 1024 * 1024
  }

  async store(candidate: BrollCandidate, signal?: AbortSignal): Promise<CachedBrollAsset> {
    signal?.throwIfAborted()
    if (!candidate.license?.name || !candidate.license.url) {
      throw new VideoEngineError('BROLL_LICENSE_MISSING', 'B-roll candidate is missing license metadata')
    }
    const root = await ensureDirectory(this.cacheRoot)
    const temporaryPath = join(root, `.${randomUUID()}.download`)
    const hash = createHash('sha256')
    let bytes = 0
    const maxBytes = this.maxBytes
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > maxBytes) {
          callback(new VideoEngineError('ASSET_DOWNLOAD_FAILED', 'B-roll asset exceeds cache size limit'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      }
    })

    let contentType: string | null | undefined
    try {
      const url = new URL(candidate.downloadUrl)
      if (url.protocol === 'file:') {
        const localPath = fileURLToPath(url)
        const info = await stat(localPath)
        if (info.size > this.maxBytes) {
          throw new VideoEngineError('ASSET_DOWNLOAD_FAILED', 'B-roll asset exceeds cache size limit')
        }
        await pipeline(createReadStream(localPath), counter, createWriteStream(temporaryPath, { flags: 'wx' }), { signal })
      } else {
        if (url.protocol !== 'https:') {
          throw new VideoEngineError(
            'ASSET_DOWNLOAD_FAILED',
            `B-roll downloads require HTTPS or a local file URL; received ${url.protocol}`
          )
        }
        const response = await fetch(url, {
          redirect: 'follow',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
        })
        if (new URL(response.url).protocol !== 'https:') {
          throw new VideoEngineError(
            'ASSET_DOWNLOAD_FAILED',
            'B-roll download redirected to a non-HTTPS URL'
          )
        }
        if (!response.ok || !response.body) {
          throw new VideoEngineError(
            'ASSET_DOWNLOAD_FAILED',
            `B-roll download returned HTTP ${response.status}`,
            { http_status: response.status }
          )
        }
        const declaredSize = Number(response.headers.get('content-length') ?? 0)
        if (declaredSize > this.maxBytes) {
          throw new VideoEngineError('ASSET_DOWNLOAD_FAILED', 'B-roll asset exceeds cache size limit')
        }
        contentType = response.headers.get('content-type')
        await pipeline(
          Readable.from(response.body as unknown as AsyncIterable<Uint8Array>),
          counter,
          createWriteStream(temporaryPath, { flags: 'wx' }),
          { signal }
        )
      }
      const sha256 = hash.digest('hex')
      const destination = join(root, `${sha256}${extensionFor(candidate, contentType)}`)
      if (await exists(destination)) {
        await rm(temporaryPath, { force: true })
      } else {
        try {
          await rename(temporaryPath, destination)
        } catch (error) {
          if (await exists(destination)) await rm(temporaryPath, { force: true })
          else throw error
        }
      }
      const record: CachedBrollAsset = {
        id: candidate.id,
        provider: candidate.provider,
        absolutePath: destination,
        sha256,
        bytes,
        sourceUrl: candidate.sourceUrl,
        cachedAt: new Date().toISOString(),
        license: candidate.license
      }
      await writeJsonAtomic(`${destination}.license.json`, record)
      return record
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      if (error instanceof VideoEngineError) throw error
      throw new VideoEngineError(
        'ASSET_DOWNLOAD_FAILED',
        `Could not cache B-roll asset ${basename(candidate.sourceUrl)}`,
        undefined,
        { cause: error }
      )
    }
  }

  async importLocal(path: string, candidate: BrollCandidate): Promise<CachedBrollAsset> {
    const localCandidate = { ...candidate, downloadUrl: pathToFileURL(path).toString() }
    return this.store(localCandidate)
  }

  async copyTo(path: string, asset: CachedBrollAsset): Promise<void> {
    await copyFile(asset.absolutePath, path)
  }
}
