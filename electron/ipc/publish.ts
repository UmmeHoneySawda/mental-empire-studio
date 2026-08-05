import { ipcMain, nativeImage, shell } from 'electron'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { IpcMainEvent } from 'electron'
import type { PublishItem, WorkItem } from '../../shared/types'
import { getRepos } from '../db'
import { effectiveThumbnailPath } from './compose'
import { trayIconPath } from '../services/background'
import { sentryLog } from '../services/sentry'
import { uploadStatusOf } from '../../shared/match'

// Hand-off hub (P2 H): removes the manual folder-hunting for upload by listing every
// finished render with its "already uploaded?" status, plus reveal + native drag-out so the
// video/thumbnail can be dragged straight into a browser upload dialog. The app itself never
// uploads anything — this screen is the hand-off point, not a publisher.

// The status is READ, never recomputed here — `uploadStatusOf` reads out what
// `runUploadDetection` already persisted to work_item_state, using the one configurable
// confidence band (settings.detection.confirmBand) and needing no channel link at all.
function listPublishItems(): PublishItem[] {
  const repos = getRepos()
  const jobs = repos.renderJobs()
    .filter((job) => job.status === 'done' && !!job.outputPath && existsSync(job.outputPath))
  if (!jobs.length) return []

  // One pass, keyed the way workItems() itself keys projects — no second copy of the
  // download-id -> videoId convention, and the status is byte-identical to the pipeline board.
  const workByProject = new Map<string, WorkItem>()
  for (const w of repos.workItems()) if (w.projectId) workByProject.set(w.projectId, w)
  const channelName = new Map(repos.myChannels().map((c) => [c.id, c.name]))

  return jobs
    .map((job): PublishItem | null => {
      const project = repos.getProject(job.projectId)
      if (!project) return null
      const work = workByProject.get(job.projectId)
      const uploadStatus = uploadStatusOf(work)
      const matched = uploadStatus === 'uploaded' || uploadStatus === 'maybe-uploaded'
        ? (work?.uploadedTo ?? []).map((id) => channelName.get(id) ?? id)
        : []

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
        matchedChannels: matched.length ? matched : undefined,
        uploadMatchScore: work?.uploadMatchScore,
        videoId: work?.videoId
      }
    })
    .filter((row): row is PublishItem => !!row)
    .sort((a, b) => new Date(b.renderedAt).getTime() - new Date(a.renderedAt).getTime())
}

export function registerPublishIpc(): void {
  ipcMain.handle('publish:list', () => {
    const items = listPublishItems()
    sentryLog.info('Ready-to-upload list built', {
      operation: 'publish_list',
      items: items.length,
      unchecked: items.filter((i) => i.uploadStatus === 'unchecked').length,
      maybe_uploaded: items.filter((i) => i.uploadStatus === 'maybe-uploaded').length,
      uploaded: items.filter((i) => i.uploadStatus === 'uploaded').length
    })
    return items
  })
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
    // The only outward-facing action on this screen, and it writes nothing to the DB — the OS
    // owns the drop target, so this log is the app's sole record that a hand-off happened.
    // Basename only: the full path is user-identifying.
    sentryLog.info('Video handed off by drag', { operation: 'publish_handoff', file: basename(path) })
  })
}
