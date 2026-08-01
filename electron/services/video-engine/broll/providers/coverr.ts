import { fetchJson, matchesDimensions } from '../http'
import type { BrollCandidate, BrollProvider, BrollSearchQuery } from '../types'

interface CoverrVideo {
  id: string
  title: string
  description?: string
  poster?: string
  thumbnail?: string
  duration?: number
  max_width: number
  max_height: number
  urls?: { mp4?: string; mp4_preview?: string; mp4_download?: string }
  tags?: string[]
}

interface CoverrResponse {
  hits: CoverrVideo[]
}

export class CoverrBrollProvider implements BrollProvider {
  readonly id = 'coverr'

  constructor(private readonly apiKey: string) {}

  async search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]> {
    const url = new URL('https://api.coverr.co/videos')
    url.searchParams.set('query', query.query.slice(0, 100))
    url.searchParams.set('page', String(Math.max(0, (query.page ?? 1) - 1)))
    url.searchParams.set('page_size', String(Math.min(80, Math.max(1, query.perPage ?? 20))))
    url.searchParams.set('urls', 'true')
    const body = await fetchJson<CoverrResponse>(url, {
      headers: { Authorization: `Bearer ${this.apiKey}` }
    }, signal)
    return body.hits.flatMap((video): BrollCandidate[] => {
      const downloadUrl = video.urls?.mp4_download || video.urls?.mp4
      const durationMs = video.duration === undefined ? undefined : Math.round(video.duration * 1000)
      if (!downloadUrl || !matchesDimensions(video.max_width, video.max_height, durationMs, query)) return []
      return [{
        id: video.id,
        provider: this.id,
        // Never the query — see the note in pixabay.ts. The description is the provider's
        // own words and is a fair thing to rank on; the query is not.
        title: video.title || video.description || `Coverr video ${video.id}`,
        sourceUrl: `https://coverr.co/videos/${encodeURIComponent(video.id)}`,
        downloadUrl,
        previewUrl: video.urls?.mp4_preview,
        thumbnailUrl: video.poster || video.thumbnail,
        width: video.max_width,
        height: video.max_height,
        durationMs,
        license: {
          name: 'Coverr License',
          url: 'https://coverr.co/license',
          attributionRequired: true,
          commercialUseAllowed: true,
          attribution: 'Video provided by Coverr',
          restrictions: [
            'Do not resell or redistribute the source media',
            'Do not use to build a competing stock-media or video-editing service without permission',
            'Do not use for AI training or datasets',
            'Check depicted trademarks, privacy, and publicity rights'
          ]
        },
        tags: video.tags ?? []
      }]
    })
  }
}
