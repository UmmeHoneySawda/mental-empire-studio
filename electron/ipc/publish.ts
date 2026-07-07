import { ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import type { IpcMainEvent } from 'electron'
import type { PublishItem } from '../../shared/types'
import { getRepos } from '../db'
import { effectiveThumbnailPath } from './compose'
import { similarity } from '../services/mapping'
import { trayIconPath } from '../services/background'

// Library/Publish hub (P2 H): removes the manual folder-hunting for upload by listing every
// finished render with a fuzzy-matched "already uploaded?" status, plus reveal + native
// drag-out so the video/thumbnail can be dragged straight into a browser upload dialog.

// A render is only counted as "checkable" once its source is linked to a My Channel (the
// existing Sources -> My Channel automation link, source_channels.linkedMyChannelId — see
// Download.tsx). Below that similarity, titles are considered genuinely different videos —
// above it, small rewrites/punctuation differences still count as the same upload.
const UPLOAD_MATCH_THRESHOLD = 0.5

function listPublishItems(): PublishItem[] {
  const repos = getRepos()
  const sources = repos.sourceChannels()
  const uploadsByChannel = new Map<string, ReturnType<typeof repos.getUploads>>()

  return repos.renderJobs()
    .filter((job) => job.status === 'done' && !!job.outputPath && existsSync(job.outputPath))
    .map((job): PublishItem | null => {
      const project = repos.getProject(job.projectId)
      if (!project) return null
      const source = sources.find((s) => s.handle === job.channel || s.name === job.channel)
      const myChannelId = source?.linkedMyChannelId

      let uploadStatus: PublishItem['uploadStatus'] = 'unlinked'
      let matchedTitle: string | undefined
      if (myChannelId) {
        let uploads = uploadsByChannel.get(myChannelId)
        if (!uploads) {
          uploads = repos.getUploads(myChannelId)
          uploadsByChannel.set(myChannelId, uploads)
        }
        let best: { title: string; score: number } | null = null
        for (const u of uploads) {
          const score = similarity(project.title, u.title)
          if (!best || score > best.score) best = { title: u.title, score }
        }
        if (best && best.score >= UPLOAD_MATCH_THRESHOLD) {
          uploadStatus = 'uploaded'
          matchedTitle = best.title
        } else {
          uploadStatus = 'not-uploaded'
        }
      }

      return {
        jobId: job.id,
        projectId: job.projectId,
        title: project.title,
        channel: job.channel,
        videoPath: job.outputPath!,
        thumbPath: effectiveThumbnailPath(project),
        durationSec: project.durationSec,
        renderedAt: job.createdAt,
        uploadStatus,
        matchedTitle
      }
    })
    .filter((row): row is PublishItem => !!row)
    .sort((a, b) => new Date(b.renderedAt).getTime() - new Date(a.renderedAt).getTime())
}

export function registerPublishIpc(): void {
  ipcMain.handle('publish:list', () => listPublishItems())
  ipcMain.handle('publish:reveal', (_e, path: string) => {
    if (path && existsSync(path)) shell.showItemInFolder(path)
  })
  // startDrag must run synchronously in response to the renderer's native `dragstart` —
  // ipcMain.on (fire-and-forget) rather than handle, so there's no promise round-trip delay
  // that would miss the drag gesture window.
  ipcMain.on('publish:startDrag', (event: IpcMainEvent, path: string) => {
    if (!path || !existsSync(path)) return
    const icon = nativeImage.createFromPath(trayIconPath())
    event.sender.startDrag({ file: path, icon: icon.isEmpty() ? nativeImage.createEmpty() : icon })
  })
}
