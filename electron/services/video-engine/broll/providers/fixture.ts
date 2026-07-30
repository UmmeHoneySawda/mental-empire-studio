import { readFile } from 'node:fs/promises'
import type { BrollCandidate, BrollProvider, BrollSearchQuery } from '../types'

export class FixtureBrollProvider implements BrollProvider {
  readonly id: string

  constructor(
    id: string,
    private readonly fixture: readonly BrollCandidate[] | string
  ) {
    this.id = id
  }

  async search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]> {
    signal?.throwIfAborted()
    const candidates = typeof this.fixture === 'string'
      ? JSON.parse(await readFile(this.fixture, 'utf8')) as BrollCandidate[]
      : [...this.fixture]
    const tokens = query.query.toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    return candidates
      .filter((candidate) => {
        const haystack = `${candidate.title} ${candidate.tags.join(' ')}`.toLocaleLowerCase()
        return tokens.every((token) => haystack.includes(token))
      })
      .slice(0, query.perPage ?? 20)
  }
}
