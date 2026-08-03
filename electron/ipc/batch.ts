import { BrowserWindow } from 'electron'
import type { BatchRenderInput, BatchRenderResult } from '../../shared/types'
import { getRepos } from '../db'
import { bindDownload, getVideoEngine, renderFileName } from '../services/video-engine/studio'
import { exportFastPreview } from '../services/video-engine/fast-preview-export'
import log from 'electron-log/main'

export function countUnpublishedVideos(sourceIds: string[]): number {
  if (!sourceIds || sourceIds.length === 0) return 0
  return getRepos().countUnpublishedSourceVideos(sourceIds)
}

export async function executeBatchRender(input: BatchRenderInput): Promise<BatchRenderResult> {
  const repos = getRepos()
  const engine = await getVideoEngine()

  const videos = repos.getUnpublishedSourceVideos(input.sourceIds, input.count)
  if (videos.length === 0) {
    return { projectIds: [], renderJobCount: 0 }
  }

  const template = repos.getVisualTemplate(input.templateId)
  const projectIds: string[] = []
  let renderJobCount = 0

  for (const video of videos) {
    try {
      const downloads = repos.getDownloadsBySource(video.sourceId)
      let download = downloads.find((d) => d.title === video.title || d.id === `dl-${video.id}`)
      if (!download) {
        download = {
          id: `dl-${video.id}`,
          sourceId: video.sourceId,
          title: video.title,
          channel: video.sourceId,
          size: '—',
          when: 'just now',
          stage: 'Queued',
          pct: '100%',
          action: 'Resume',
          thumb: video.thumb || ''
        }
        repos.upsertDownload(download)
      }

      const { project } = await bindDownload(download.id, 'remotion')
      projectIds.push(project.id)

      if (template) {
        const [w, h] = template.aspectRatio === '9:16' ? [1080, 1920] : template.aspectRatio === '1:1' ? [1080, 1080] : [1920, 1080]
        const currentProject = await engine.openProject(project.id)
        const updated = {
          ...currentProject,
          canvas: { ...currentProject.canvas, width: w, height: h }
        }
        if (template.captionStyle && updated.captions) {
          updated.captions = { ...updated.captions, templateId: template.captionStyle }
        }
        await engine.saveProject(updated)
      }

      if (input.renderMode === 'fast') {
        const win = BrowserWindow.getAllWindows()[0]
        const sourceUrl = win ? win.webContents.getURL() : 'http://localhost:3000'
        await exportFastPreview({
          projectId: project.id,
          sourceUrl
        }).catch((err) => {
          log.error(`[batch] Fast preview export failed for ${project.id}:`, err)
        })
        renderJobCount++
      } else {
        const currentProject = await engine.openProject(project.id)
        await engine.enqueueRender(project.id, renderFileName(currentProject, '.mp4'))
        renderJobCount++
      }
    } catch (err) {
      log.error(`[batch] Error processing video ${video.id}:`, err)
    }
  }

  return { projectIds, renderJobCount }
}
