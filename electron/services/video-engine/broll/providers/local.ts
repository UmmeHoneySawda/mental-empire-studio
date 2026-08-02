import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrollCandidate, BrollProvider, BrollSearchQuery, CachedBrollAsset } from '../types'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v'])

async function readMetadata(path: string): Promise<Partial<CachedBrollAsset> | null> {
  try {
    const value = JSON.parse(await readFile(`${path}.license.json`, 'utf8')) as Partial<CachedBrollAsset>
    return value && typeof value === 'object' ? value : null
  } catch {
    // Legacy/user-supplied clips have no sidecar and remain searchable by their path.
    return null
  }
}

async function walk(root: string, signal?: AbortSignal): Promise<string[]> {
  const output: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    signal?.throwIfAborted()
    const current = queue.shift()!
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) queue.push(path)
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) output.push(path)
    }
  }
  return output
}

export class LocalBrollProvider implements BrollProvider {
  readonly id: string
  private readonly root: string

  constructor(root: string, id = 'local') {
    this.root = resolve(root)
    this.id = id
  }

  async search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]> {
    const tokens = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    const files = await walk(this.root, signal)
    const indexed = await Promise.all(files.map(async (path) => ({ path, metadata: await readMetadata(path) })))
    const ranked = indexed
      .map(({ path, metadata }) => {
        // Scored on the path relative to the root, not just the filename. The warmed
        // library stores clips as <sourceKey>/<keyword>/<provider>-<id>.mp4, so the only
        // place the searchable word appears is the directory — matching the basename
        // alone meant every query scored zero and the provider looked empty.
        const relativePath = relative(this.root, path)
        const pathWords = relativePath
          .slice(0, relativePath.length - extname(relativePath).length)
          .toLocaleLowerCase()
          .replace(/[\\/_-]+/gu, ' ')
        const haystack = [
          pathWords,
          typeof metadata?.title === 'string' ? metadata.title : '',
          typeof metadata?.description === 'string' ? metadata.description : '',
          ...(Array.isArray(metadata?.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === 'string') : [])
        ].join(' ').toLocaleLowerCase()
        return {
          path,
          metadata,
          score: tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0)
        }
      })
      .filter(({ score }) => tokens.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, query.perPage ?? 20)
    return Promise.all(ranked.map(async ({ path, metadata }): Promise<BrollCandidate> => {
      const info = await stat(path)
      const localUrl = pathToFileURL(path).toString()
      const title = typeof metadata?.title === 'string' && metadata.title.trim()
        ? metadata.title
        : basename(path, extname(path))
      const tags = Array.isArray(metadata?.tags)
        ? metadata.tags.filter((tag): tag is string => typeof tag === 'string' && !!tag.trim())
        : basename(path, extname(path)).split(/[-_\s]+/u).filter(Boolean)
      const fallbackLicense = {
        name: 'User-provided local media',
        url: 'about:blank',
        attributionRequired: false,
        commercialUseAllowed: false,
        restrictions: ['Rights must be supplied and verified by the user']
      }
      return {
        id: typeof metadata?.id === 'string' ? metadata.id : `${info.size}-${Math.round(info.mtimeMs)}-${basename(path)}`,
        provider: typeof metadata?.provider === 'string' ? metadata.provider : this.id,
        title,
        description: typeof metadata?.description === 'string' ? metadata.description : undefined,
        sourceUrl: typeof metadata?.sourceUrl === 'string' ? metadata.sourceUrl : localUrl,
        downloadUrl: localUrl,
        width: typeof metadata?.width === 'number' ? metadata.width : 0,
        height: typeof metadata?.height === 'number' ? metadata.height : 0,
        durationMs: typeof metadata?.durationMs === 'number' ? metadata.durationMs : undefined,
        author: typeof metadata?.author === 'string' ? metadata.author : undefined,
        license: metadata?.license?.name && metadata.license.url ? metadata.license : fallbackLicense,
        tags
      }
    }))
  }
}
