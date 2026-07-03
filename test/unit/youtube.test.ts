import { describe, it, expect } from 'vitest'
import { youtubeThumbUrl, youtubeIdFromDownloadId } from '../../shared/youtube'

// A1: deterministic YouTube thumbnail URLs (no yt-dlp fetch).
describe('youtubeThumbUrl', () => {
  it('builds the i.ytimg.com URL for a quality', () => {
    expect(youtubeThumbUrl('dQw4w9WgXcQ', 'hq')).toBe('https://i3.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
    expect(youtubeThumbUrl('dQw4w9WgXcQ', 'max')).toBe('https://i3.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg')
  })

  it('returns empty string for blank or non-YouTube ids', () => {
    expect(youtubeThumbUrl('')).toBe('')
    expect(youtubeThumbUrl('pw-1')).toBe('')
  })
})

describe('youtubeIdFromDownloadId', () => {
  it('strips the dl- prefix', () => {
    expect(youtubeIdFromDownloadId('dl-XyZ')).toBe('XyZ')
    expect(youtubeIdFromDownloadId('XyZ')).toBe('XyZ')
  })

  it('strips browser mock timestamp suffixes', () => {
    expect(youtubeIdFromDownloadId('dl-pw-5-1783099034185-518')).toBe('pw-5')
  })
})
