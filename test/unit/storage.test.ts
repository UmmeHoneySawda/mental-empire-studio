import { describe, it, expect } from 'vitest'
import { slug, videoIdFromDownloadId, videoIdFromProjectId, itemFolderName } from '../../electron/services/storage'
import { planReorg, type ReorgInputs } from '../../electron/services/storage-migrate'

describe('storage path helpers', () => {
  it('slug is lowercase, dash-separated, trimmed, bounded', () => {
    expect(slug('Never Gonna Give You Up')).toBe('never-gonna-give-you-up')
    expect(slug("  It's a TEST!! ")).toBe('its-a-test')
    expect(slug('')).toBe('untitled')
    expect(slug('***')).toBe('untitled')
    expect(slug('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('recovers the bare video id from download/project ids', () => {
    expect(videoIdFromDownloadId('dl-abc123')).toBe('abc123')
    expect(videoIdFromProjectId('proj-dl-abc123')).toBe('abc123')
    // tolerant of unexpected shapes
    expect(videoIdFromDownloadId('abc123')).toBe('abc123')
  })

  it('itemFolderName combines videoId + slug', () => {
    expect(itemFolderName({ channel: 'C', videoId: 'abc123', title: 'My Title' })).toBe('abc123__my-title')
  })
})

const ROOT = '/lib'
const posix = (p: string): string => p.replace(/\\/g, '/')

function inputs(over: Partial<ReorgInputs> = {}): ReorgInputs {
  return {
    libraryRoot: ROOT,
    downloads: [{ id: 'dl-v1', channel: 'Chan A', title: 'Hello World', filePath: '/old/Chan A - Hello World.mp3' }],
    projects: [{ id: 'proj-dl-v1', downloadId: 'dl-v1', channel: 'Chan A', title: 'Hello World', mp3Path: '/old/Chan A - Hello World.mp3', thumbPath: '/old/thumbnails/Hello World.png' }],
    images: [{ id: 'proj-dl-v1-img-0', projectId: 'proj-dl-v1', path: '/old/projects/proj-dl-v1/00_a.jpg', thumb: '/old/projects/proj-dl-v1/00_a.jpg' }],
    jobs: [{ id: 'job-proj-dl-v1', projectId: 'proj-dl-v1', outputPath: '/old/Chan A - Hello World.mp4' }],
    ...over
  }
}

describe('planReorg', () => {
  it('routes each asset into the per-video layout', () => {
    const plan = planReorg(inputs())
    const to = (sub: string, file: string) => `/lib/Chan A/v1__hello-world/${sub}/${file}`
    const targets = Object.fromEntries(plan.moves.map((m) => [m.from, posix(m.to)]))
    expect(targets['/old/Chan A - Hello World.mp3']).toBe(to('audio', 'Chan A - Hello World.mp3'))
    expect(targets['/old/thumbnails/Hello World.png']).toBe(to('thumb', 'Hello World.png'))
    expect(targets['/old/projects/proj-dl-v1/00_a.jpg']).toBe(to('images', '00_a.jpg'))
    expect(targets['/old/Chan A - Hello World.mp4']).toBe(to('output', 'Chan A - Hello World.mp4'))
  })

  it('dedupes a file referenced by multiple columns into one move with merged db refs', () => {
    // The mp3 is both download.filePath and project.mp3Path.
    const plan = planReorg(inputs())
    const mp3Move = plan.moves.find((m) => m.from === '/old/Chan A - Hello World.mp3')!
    expect(mp3Move).toBeTruthy()
    const cols = mp3Move.db.map((d) => `${d.table}.${d.column}`).sort()
    expect(cols).toEqual(['downloaded_videos.filePath', 'projects.mp3Path'])
    // image path === thumb → single move, two db refs
    const imgMove = plan.moves.find((m) => m.from === '/old/projects/proj-dl-v1/00_a.jpg')!
    expect(imgMove.db.map((d) => d.column).sort()).toEqual(['path', 'thumb'])
  })

  it('carries the rendered .mp4 siblings (.ass/.render.log) along', () => {
    const plan = planReorg(inputs())
    const mp4 = plan.moves.find((m) => m.from.endsWith('.mp4'))!
    expect(mp4.siblings.map((s) => s.from).sort()).toEqual(['/old/Chan A - Hello World.ass', '/old/Chan A - Hello World.render.log'])
    expect(posix(mp4.siblings[0].to)).toBe('/lib/Chan A/v1__hello-world/output/Chan A - Hello World.ass')
  })

  it('counts already-organized files (from === to) and skips them', () => {
    const organized = '/lib/Chan A/v1__hello-world/audio/Chan A - Hello World.mp3'
    const plan = planReorg(inputs({
      downloads: [{ id: 'dl-v1', channel: 'Chan A', title: 'Hello World', filePath: organized }],
      projects: [{ id: 'proj-dl-v1', downloadId: 'dl-v1', channel: 'Chan A', title: 'Hello World', mp3Path: organized }],
      images: [],
      jobs: []
    }))
    expect(plan.moves).toHaveLength(0)
    expect(plan.alreadyOrganized).toBeGreaterThan(0)
  })

  it('ignores non-file values (urls, gradients, empty)', () => {
    const plan = planReorg(inputs({
      downloads: [{ id: 'dl-v2', channel: 'C', title: 'T', filePath: '' }],
      projects: [{ id: 'proj-dl-v2', downloadId: 'dl-v2', channel: 'C', title: 'T', thumbPath: 'https://img/x.png' }],
      images: [{ id: 'i', projectId: 'proj-dl-v2', path: 'linear-gradient(...)', thumb: null }],
      jobs: []
    }))
    expect(plan.moves).toHaveLength(0)
  })
})
