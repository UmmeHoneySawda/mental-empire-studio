import { describe, it, expect } from 'vitest'
import { orderVideos } from '../../electron/services/scraper'
import type { ScrapedVideo } from '../../shared/types'

function v(id: string, views: number, uploadDate: string): ScrapedVideo {
  return { id, title: id, durationSec: 60, views, uploadDate, thumb: '' }
}

// A2: "Popular" must actually sort by view count; "Latest"/"Oldest" by date.
describe('orderVideos', () => {
  const vids = [v('a', 10, '20240101'), v('b', 500, '20240601'), v('c', 50, '20240301')]

  it('sorts Popular by views descending', () => {
    expect(orderVideos(vids, 'Popular', 3).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts Latest by upload date descending', () => {
    expect(orderVideos(vids, 'Latest', 3).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('caps the result to count', () => {
    expect(orderVideos(vids, 'Popular', 2).map((x) => x.id)).toEqual(['b', 'c'])
  })
})
