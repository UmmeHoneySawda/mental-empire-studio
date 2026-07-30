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
}

interface PexelsResponse {
  videos: PexelsVideo[]
}

function selectFile(files: PexelsVideoFile[], requestedWidth = 1920): PexelsVideoFile | undefined {
  return [...files]
    .filter((file) => file.file_type === 'video/mp4' && file.width > 0 && file.height > 0)
    .sort((a, b) => Math.abs(a.width - requestedWidth) - Math.abs(b.width - requestedWidth))[0]
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
      return [{
        id: String(video.id),
        provider: this.id,
        title: query.query,
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
        tags: query.query.split(/\s+/u).filter(Boolean)
      }]
    })
  }
}
