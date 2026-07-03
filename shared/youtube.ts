export type YoutubeThumbQuality = 'max' | 'sd' | 'hq' | 'mq' | 'default'
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

const THUMB_FILES: Record<YoutubeThumbQuality, string> = {
  max: 'maxresdefault',
  sd: 'sddefault',
  hq: 'hqdefault',
  mq: 'mqdefault',
  default: 'default'
}

export function youtubeThumbUrl(videoId: string, quality: YoutubeThumbQuality = 'hq'): string {
  const id = videoId.trim()
  if (!YOUTUBE_VIDEO_ID_RE.test(id)) return ''
  return `https://i3.ytimg.com/vi/${encodeURIComponent(id)}/${THUMB_FILES[quality]}.jpg`
}

export function youtubeIdFromDownloadId(downloadId: string): string {
  if (!downloadId) return ''
  const id = downloadId.startsWith('dl-') ? downloadId.slice(3) : downloadId
  return id.match(/^(.+)-\d{10,}-\d+$/)?.[1] ?? id
}
