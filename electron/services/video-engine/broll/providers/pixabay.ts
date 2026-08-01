import { fetchJson, matchesDimensions, normalizedPage } from '../http'
import type { BrollCandidate, BrollProvider, BrollSearchQuery } from '../types'

interface PixabayVideoRendition {
  url: string
  width: number
  height: number
  size: number
  thumbnail: string
}

interface PixabayHit {
  id: number
  pageURL: string
  tags: string
  duration: number
  user: string
  videos: Record<string, PixabayVideoRendition>
}

interface PixabayResponse {
  hits: PixabayHit[]
}

function selectRendition(
  renditions: Record<string, PixabayVideoRendition>,
  requestedWidth = 1920
): PixabayVideoRendition | undefined {
  return Object.values(renditions)
    .filter((item) => item.url && item.width > 0 && item.height > 0)
    .sort((a, b) => Math.abs(a.width - requestedWidth) - Math.abs(b.width - requestedWidth))[0]
}

export class PixabayBrollProvider implements BrollProvider {
  readonly id = 'pixabay'

  constructor(private readonly apiKey: string) {}

  async search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]> {
    const { page, perPage } = normalizedPage(query)
    const url = new URL('https://pixabay.com/api/videos/')
    url.searchParams.set('key', this.apiKey)
    url.searchParams.set('q', query.query.slice(0, 100))
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(Math.max(3, perPage)))
    url.searchParams.set('safesearch', String(query.safeSearch ?? true))
    const body = await fetchJson<PixabayResponse>(url, {}, signal)
    return body.hits.flatMap((hit): BrollCandidate[] => {
      const rendition = selectRendition(hit.videos, query.minWidth ?? 1920)
      const durationMs = Math.round(hit.duration * 1000)
      if (!rendition || !matchesDimensions(rendition.width, rendition.height, durationMs, query)) return []
      return [{
        id: String(hit.id),
        provider: this.id,
        // Never the query: a candidate that repeats what was asked for matches it perfectly
        // no matter what it shows, which is how a provider earns relevance it never proved.
        title: hit.tags || `Pixabay video ${hit.id}`,
        sourceUrl: hit.pageURL,
        downloadUrl: rendition.url,
        thumbnailUrl: rendition.thumbnail,
        width: rendition.width,
        height: rendition.height,
        durationMs,
        author: hit.user,
        license: {
          name: 'Pixabay Content License',
          url: 'https://pixabay.com/service/license-summary/',
          attributionRequired: false,
          commercialUseAllowed: true,
          attribution: `Video by ${hit.user} on Pixabay`,
          restrictions: [
            'Do not redistribute content on a standalone basis',
            'Do not imply endorsement',
            'Check depicted trademarks, privacy, and publicity rights'
          ]
        },
        tags: hit.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      }]
    })
  }
}
