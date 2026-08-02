import { fetchJson, matchesDimensions, normalizedPage } from '../http'
import type { BrollCandidate, BrollProvider, BrollSearchQuery } from '../types'

interface PexelsVideoFile {
  id: number
  quality: string
  file_type: string
  width: number
  height: number
  link: string
}

interface PexelsVideo {
  id: number
  width: number
  height: number
  duration: number
  url: string
  image: string
  user: { name: string; url: string }
  video_files: PexelsVideoFile[]
  /** Present in the response but empty on every video seen so far; honoured if it fills. */
  tags?: string[]
}

interface PexelsResponse {
  videos: PexelsVideo[]
}

function selectFile(files: PexelsVideoFile[], requestedWidth = 1920): PexelsVideoFile | undefined {
  return [...files]
    .filter((file) => file.file_type === 'video/mp4' && file.width > 0 && file.height > 0)
    .sort((a, b) => Math.abs(a.width - requestedWidth) - Math.abs(b.width - requestedWidth))[0]
}

/**
 * The clip's own description, read out of its public URL.
 *
 * Pexels' video endpoint returns no title and, in practice, an empty `tags` array — but the
 * page URL carries a human description as its slug:
 * `/video/dog-in-front-of-the-door-5357497/`. That slug is the only thing this provider
 * says about the footage, so it is what the ranker gets to judge.
 *
 * What it must NOT be is the search query. `title = query.query` made every Pexels
 * candidate contain every query token, so the relevance bonus was awarded for content the
 * clip had never been compared against — Pexels ranked well by construction rather than by
 * being right. When the slug is missing this returns empty and the ranker reads relevance
 * as unknown, which is the honest answer, rather than perfect.
 */
function describeFromUrl(url: string): string {
  const slug = /\/video\/([^/?#]+)/u.exec(url)?.[1] ?? ''
  const words = slug.split('-').filter(Boolean)
  // The trailing segment is the numeric id, not a word about the picture.
  if (/^\d+$/u.test(words[words.length - 1] ?? '')) words.pop()
  return words.join(' ')
}

export class PexelsBrollProvider implements BrollProvider {
  readonly id = 'pexels'

  constructor(private readonly apiKey: string) {}

  async search(query: BrollSearchQuery, signal?: AbortSignal): Promise<BrollCandidate[]> {
    const { page, perPage } = normalizedPage(query)
    const url = new URL('https://api.pexels.com/v1/videos/search')
    url.searchParams.set('query', query.query.slice(0, 100))
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(perPage))
    if (query.orientation && query.orientation !== 'any' && query.orientation !== 'square') {
      url.searchParams.set('orientation', query.orientation)
    }
    const body = await fetchJson<PexelsResponse>(url, {
      headers: { Authorization: this.apiKey }
    }, signal)
    return body.videos.flatMap((video): BrollCandidate[] => {
      const file = selectFile(video.video_files, query.minWidth ?? 1920)
      if (!file || !matchesDimensions(file.width, file.height, video.duration * 1000, query)) return []
      const described = describeFromUrl(video.url)
      return [{
        id: String(video.id),
        provider: this.id,
        title: described || `Pexels video ${video.id}`,
        description: described || undefined,
        sourceUrl: video.url,
        downloadUrl: file.link,
        thumbnailUrl: video.image,
        width: file.width,
        height: file.height,
        durationMs: Math.round(video.duration * 1000),
        author: video.user.name,
        license: {
          name: 'Pexels License',
          url: 'https://www.pexels.com/license/',
          attributionRequired: false,
          commercialUseAllowed: true,
          attribution: `Video by ${video.user.name} on Pexels`,
          restrictions: [
            'Do not resell unaltered media',
            'Do not imply endorsement',
            'Do not redistribute through a stock-media service',
            'Do not use as a trademark'
          ]
        },
        tags: video.tags?.length ? video.tags : described.split(' ').filter(Boolean)
      }]
    })
  }
}
