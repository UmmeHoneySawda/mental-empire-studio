import { describe, it, expect } from 'vitest'
import { youtubeThumbUrl, youtubeIdFromDownloadId } from '../../shared/youtube'

// A1: deterministic YouTube thumbnail URLs (no yt-dlp fetch).
describe('youtubeThumbUrl', () => {
  it('builds the i.ytimg.com URL for a quality', () => {
    expect(youtubeThumbUrl('abc123', 'hq')).toBe('https://i3.ytimg.com/vi/abc123/hqdefault.jpg')
    expect(youtubeThumbUrl('abc123', 'max')).toBe('https://i3.ytimg.com/vi/abc123/maxresdefault.jpg')
  })

  it('returns empty string for a blank id', () => {
    expect(youtubeThumbUrl('')).toBe('')
  })
})

describe('youtubeIdFromDownloadId', () => {
  it('strips the dl- prefix', () => {
    expect(youtubeIdFromDownloadId('dl-XyZ')).toBe('XyZ')
    expect(youtubeIdFromDownloadId('XyZ')).toBe('XyZ')
  })
})
