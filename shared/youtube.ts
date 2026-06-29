export type YoutubeThumbQuality = 'max' | 'sd' | 'hq' | 'mq' | 'default'

const THUMB_FILES: Record<YoutubeThumbQuality, string> = {
  max: 'maxresdefault',
  sd: 'sddefault',
  hq: 'hqdefault',
  mq: 'mqdefault',
  default: 'default'
}

export function youtubeThumbUrl(videoId: string, quality: YoutubeThumbQuality = 'hq'): string {
  const id = videoId.trim()
  if (!id) return ''
  return `https://i3.ytimg.com/vi/${encodeURIComponent(id)}/${THUMB_FILES[quality]}.jpg`
}

export function youtubeIdFromDownloadId(downloadId: string): string {
  if (!downloadId) return ''
  return downloadId.startsWith('dl-') ? downloadId.slice(3) : downloadId
}
