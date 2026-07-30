import { readdir, stat } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrollCandidate, BrollProvider, BrollSearchQuery } from '../types'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v'])

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
    const ranked = files
      .map((path) => {
        const name = basename(path, extname(path)).toLocaleLowerCase()
        return { path, score: tokens.reduce((score, token) => score + (name.includes(token) ? 1 : 0), 0) }
      })
      .filter(({ score }) => tokens.length === 0 || score > 0)
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, query.perPage ?? 20)
    return Promise.all(ranked.map(async ({ path }): Promise<BrollCandidate> => {
      const info = await stat(path)
      const sourceUrl = pathToFileURL(path).toString()
      return {
        id: `${info.size}-${Math.round(info.mtimeMs)}-${basename(path)}`,
        provider: this.id,
        title: basename(path, extname(path)),
        sourceUrl,
        downloadUrl: sourceUrl,
        width: 0,
        height: 0,
        license: {
          name: 'User-provided local media',
          url: 'about:blank',
          attributionRequired: false,
          commercialUseAllowed: false,
          restrictions: ['Rights must be supplied and verified by the user']
        },
        tags: basename(path, extname(path)).split(/[-_\s]+/u).filter(Boolean)
      }
    }))
  }
}
