import { describe, it, expect } from 'vitest'
import { classifyWorkItem, progressScore, resumeCandidate, nextStepFor, actionLabel, sourceVideoBadge } from '../../src/lib/workitems'
import type { WorkItem } from '../../shared/types'

function wi(over: Partial<WorkItem>): WorkItem {
  return {
    videoId: 'v', channel: 'C', title: 'T', downloadId: 'dl-v', projectId: 'proj-dl-v',
    downloaded: true, hasImages: false, captioned: false, hasThumbnail: false, rendered: false,
    uploaded: false, uploadedTo: [], uploadedManual: null, archived: false, ...over
  }
}

describe('classifyWorkItem', () => {
  it('rendered → done', () => {
    expect(classifyWorkItem(wi({ rendered: true }))).toBe('done')
  })
  it('any production progress (images/captions/thumb) but not rendered → inprogress', () => {
    expect(classifyWorkItem(wi({ hasImages: true }))).toBe('inprogress')
    expect(classifyWorkItem(wi({ captioned: true }))).toBe('inprogress')
    expect(classifyWorkItem(wi({ hasThumbnail: true }))).toBe('inprogress')
  })
  it('downloaded only → todo', () => {
    expect(classifyWorkItem(wi({}))).toBe('todo')
  })
  it('done takes precedence even if earlier stages are missing', () => {
    expect(classifyWorkItem(wi({ rendered: true, hasImages: false }))).toBe('done')
  })
})

describe('progressScore', () => {
  it('counts completed stages', () => {
    expect(progressScore(wi({}))).toBe(1) // downloaded
    expect(progressScore(wi({ hasImages: true, captioned: true }))).toBe(3)
    expect(progressScore(wi({ hasImages: true, captioned: true, hasThumbnail: true, rendered: true }))).toBe(5)
  })
})

describe('resumeCandidate', () => {
  it('returns the most-advanced unfinished item', () => {
    const items = [
      wi({ videoId: 'a' }),
      wi({ videoId: 'b', hasImages: true, captioned: true }),
      wi({ videoId: 'c', hasImages: true })
    ]
    expect(resumeCandidate(items)?.videoId).toBe('b')
  })
  it('skips rendered + archived items', () => {
    const items = [
      wi({ videoId: 'done', rendered: true, hasImages: true, captioned: true, hasThumbnail: true }),
      wi({ videoId: 'arch', archived: true, hasImages: true, captioned: true }),
      wi({ videoId: 'go', hasImages: true })
    ]
    expect(resumeCandidate(items)?.videoId).toBe('go')
  })
  it('returns null when everything is done/archived/empty', () => {
    expect(resumeCandidate([])).toBeNull()
    expect(resumeCandidate([wi({ rendered: true })])).toBeNull()
  })
  it('keeps input order on ties', () => {
    const items = [wi({ videoId: 'x', hasImages: true }), wi({ videoId: 'y', captioned: true })]
    expect(resumeCandidate(items)?.videoId).toBe('x')
  })
})

describe('nextStepFor / actionLabel', () => {
  it('rendered → render queue', () => {
    expect(nextStepFor(wi({ rendered: true }))).toEqual({ screen: 'render' })
    expect(actionLabel(wi({ rendered: true }))).toBe('Queue')
  })
  it('downloaded → compose with the project to open', () => {
    expect(nextStepFor(wi({ downloadId: 'dl-z' }))).toEqual({ screen: 'compose', openProjectId: 'dl-z' })
    expect(actionLabel(wi({}))).toBe('Edit')
  })
  it('captioned project → thumbnail editor', () => {
    expect(nextStepFor(wi({ hasImages: true, captioned: true, hasThumbnail: false, downloadId: 'dl-z' }))).toEqual({ screen: 'thumb', openProjectId: 'dl-z' })
    expect(actionLabel(wi({ hasImages: true, captioned: true, hasThumbnail: false }))).toBe('Thumbnail')
  })
  it('thumbnail complete → render queue', () => {
    expect(nextStepFor(wi({ hasImages: true, captioned: true, hasThumbnail: true, rendered: false }))).toEqual({ screen: 'render' })
    expect(actionLabel(wi({ hasThumbnail: true, rendered: false }))).toBe('Render')
  })
  it('not downloaded → sources', () => {
    expect(nextStepFor(wi({ downloaded: false, downloadId: undefined }))).toEqual({ screen: 'sources' })
    expect(actionLabel(wi({ downloaded: false }))).toBe('Download')
  })
})

describe('sourceVideoBadge', () => {
  const channels = [{ id: 'ch-a', name: 'Mental Empire', handle: '@mental', mono: '', avatar: '', views: '', subs: '', total: 0, source: '', mapDone: 0, mapTotal: 0, weekDone: 0, weekGoal: 0, monthDone: 0, monthGoal: 0, reminder: '', reminderNote: '' }]

  it('marks unseen source videos as NEW', () => {
    expect(sourceVideoBadge().kind).toBe('new')
  })

  it('shows pending upload matches as confirmable, not uploaded', () => {
    const badge = sourceVideoBadge(wi({ uploadedTo: ['ch-a'], uploadMatchScore: 0.7, uploadConfidence: 'pending' }), channels)
    expect(badge.kind).toBe('pending')
    expect(badge.label).toBe('confirm?')
    expect(badge.title).toContain('@mental')
  })

  it('shows high-confidence uploads with the channel handle', () => {
    const badge = sourceVideoBadge(wi({ uploaded: true, uploadedTo: ['ch-a'], uploadMatchScore: 0.94, uploadConfidence: 'high' }), channels)
    expect(badge.kind).toBe('uploaded')
    expect(badge.label).toBe('Uploaded -> @mental')
  })

  it('falls through to rendered and in-progress states', () => {
    expect(sourceVideoBadge(wi({ rendered: true })).kind).toBe('rendered')
    expect(sourceVideoBadge(wi({ captioned: true })).kind).toBe('inprogress')
    expect(sourceVideoBadge(wi({})).kind).toBe('downloaded')
  })
})
