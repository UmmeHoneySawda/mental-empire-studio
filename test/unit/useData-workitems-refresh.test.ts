import { beforeEach, describe, expect, it } from 'vitest'
import { useData } from '../../src/store/useData'
import type { WorkItem } from '../../shared/types'

function workItem(videoId: string): WorkItem {
  return {
    videoId,
    channel: 'Source',
    title: 'Video',
    downloadId: `dl-${videoId}`,
    projectId: `proj-dl-${videoId}`,
    downloaded: true,
    hasImages: false,
    captioned: false,
    hasThumbnail: false,
    rendered: false,
    uploaded: false,
    uploadedTo: [],
    uploadedManual: null,
    archived: false
  }
}

function installWindowApi(api: unknown): void {
  ;(globalThis as unknown as { window: unknown }).window = { api }
}

describe('pipeline refresh after row mutations', () => {
  beforeEach(() => {
    useData.setState({
      downloads: [],
      renderJobs: [],
      workItems: [workItem('stale')],
      renderProgress: { job1: { jobId: 'job1', pct: 44, stage: 'encoding' } },
      activity: []
    })
  })

  it('refreshes work items after download resume/cancel/delete', async () => {
    const calls: string[] = []
    installWindowApi({
      download: {
        resume: async () => { calls.push('resume') },
        cancel: async () => { calls.push('cancel') },
        delete: async () => { calls.push('delete') }
      },
      db: {
        downloads: async () => [],
        workItems: async () => [workItem(`fresh-${calls.at(-1)}`)]
      }
    })

    await useData.getState().resumeDownload('dl-v')
    expect(useData.getState().workItems[0]?.videoId).toBe('fresh-resume')

    await useData.getState().cancelDownload('dl-v')
    expect(useData.getState().workItems[0]?.videoId).toBe('fresh-cancel')

    await useData.getState().deleteDownload('dl-v')
    expect(useData.getState().workItems[0]?.videoId).toBe('fresh-delete')
  })

  it('refreshes work items and clears stale progress after render mutations', async () => {
    const calls: string[] = []
    installWindowApi({
      render: {
        cancel: async () => { calls.push('cancel') },
        delete: async () => { calls.push('delete') },
        requeue: async () => { calls.push('requeue') },
        jobs: async () => []
      },
      db: {
        workItems: async () => [workItem(`render-${calls.at(-1)}`)]
      }
    })

    await useData.getState().cancelJob('job1')
    expect(useData.getState().renderProgress.job1).toBeUndefined()
    expect(useData.getState().workItems[0]?.videoId).toBe('render-cancel')

    useData.setState({ renderProgress: { job1: { jobId: 'job1', pct: 44, stage: 'encoding' } } })
    await useData.getState().deleteJob('job1')
    expect(useData.getState().renderProgress.job1).toBeUndefined()
    expect(useData.getState().workItems[0]?.videoId).toBe('render-delete')

    useData.setState({ renderProgress: { job1: { jobId: 'job1', pct: 44, stage: 'encoding' } } })
    await useData.getState().requeueJob('job1')
    expect(useData.getState().renderProgress.job1).toBeUndefined()
    expect(useData.getState().workItems[0]?.videoId).toBe('render-requeue')
  })

  it('refreshes work items after rendering all queued jobs', async () => {
    installWindowApi({
      render: {
        all: async () => undefined,
        jobs: async () => []
      },
      db: {
        activity: async () => [],
        workItems: async () => [workItem('render-all-fresh')]
      }
    })

    await useData.getState().renderAll()

    expect(useData.getState().rendering).toBe(false)
    expect(useData.getState().workItems[0]?.videoId).toBe('render-all-fresh')
  })
})
