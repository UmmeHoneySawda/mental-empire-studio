import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RenderJob, RenderQueueRow } from '../../shared/types'
import { projectVideoOpts } from '../../shared/types'
import { getRepos } from '../db'
import { runAll, abortQueue, outputDir } from '../services/queue'
import { cancelRender, consumeCancelIntent, markCancelIntent } from '../services/render'
import { safeName } from '../../shared/sanitize'
import { itemDirForProject, itemThumbDir } from '../services/storage'
import { cachedBrollClipCount, hasConfiguredBrollSource } from '../services/broll'
import { effectiveBrollPool } from '../../shared/automationBroll'
import { getSettings } from '../store/settings'

// Render queue IPC (M6): the joined queue view, run-all, cancel, and an output
// folder picker for the Render Queue screen.

function jobsView(): RenderQueueRow[] {
  const repos = getRepos()
  const settings = getSettings()
  const thumbsDir = join(outputDir(), 'thumbnails')
  return repos.renderJobs().map((job) => {
    const project = repos.getProject(job.projectId)
    const images = repos.getProjectImages(job.projectId)
    const words = repos.getTranscript(job.projectId)
    const hasThumb = !!project && (
      (!!project.thumbPath && existsSync(project.thumbPath)) ||
      existsSync(join(itemThumbDir(itemDirForProject(project)), `${safeName(project.title)}.png`)) ||
      existsSync(join(thumbsDir, `${safeName(project.title)}.png`))
    )
    const hasMp3 = !!project?.mp3Path && existsSync(project.mp3Path)
    const broll = projectVideoOpts(project).broll.enabled
    // Only the audio actually blocks a render (the graph falls back to a solid
    // background with no images, and captions/thumbnail are optional). hasThumb /
    // hasCaptions / images are still surfaced as advisory checklist columns.
    const missing: string[] = []
    if (!hasMp3) missing.push('MP3')
    if (!project?.durationSec || project.durationSec <= 0) missing.push('duration')
    if (project && images.length === 0) {
      const effectivePool = effectiveBrollPool({ projectBroll: projectVideoOpts(project).broll, sourceNichePoolKey: repos.nicheKeyForDownload(project.downloadId) })
      const poolKey = effectivePool.poolKey
      const brollAvailable = broll && (cachedBrollClipCount(poolKey) > 0 || (effectivePool.allowLive && hasConfiguredBrollSource(settings)))
      if (!brollAvailable) missing.push('visual media')
    }
    return {
      job,
      images: images.length,
      hasMp3,
      hasThumb,
      hasCaptions: words.length > 0,
      isReady: missing.length === 0,
      missing,
      projectDurationSec: project?.durationSec ?? 0,
      firstImagePath: images[0]?.path,
      broll
    }
  })
}

function outputPathForJob(id: string): string {
  return getRepos().renderJob(id)?.outputPath ?? ''
}

/** The two states a Stop can act on: in flight, or waiting in line. Anything else has
 *  nothing to stop — and relabelling it would only lose a finished render's status or blank
 *  a failed row's error text. */
function isStoppable(job?: RenderJob): boolean {
  return job?.status === 'rendering' || job?.status === 'queued'
}

/** Stop one job and record the terminal state, whether or not there was work to kill.
 *  Writing the status here (rather than only from the queue runner's cancel path) is what
 *  makes the row change the instant the user clicks: the GPU/mux stop is cooperative, and a
 *  job that is between stages has nothing to kill at all. */
function cancelOne(id: string): void {
  const job = getRepos().renderJob(id)
  if (!cancelRender(id, 'cancel') && (job?.status === 'rendering' || id.startsWith('preview-'))) {
    markCancelIntent(id, 'cancel')
  }
  if (isStoppable(job)) getRepos().setRenderStatus(id, { status: 'cancelled', pct: 0, error: '' })
}

export function registerRenderIpc(): void {
  ipcMain.handle('render:jobs', () => jobsView())
  ipcMain.handle('render:all', () => runAll())
  ipcMain.handle('render:cancel', (_e, id: string) => cancelOne(id))
  ipcMain.handle('render:cancelAll', () => {
    // Stop the batch first so the pump starts nothing new while we walk the rows.
    abortQueue()
    for (const job of getRepos().renderJobs()) {
      if (isStoppable(job)) cancelOne(job.id)
    }
  })
  ipcMain.handle('render:delete', (_e, id: string) => {
    // Stop work before the row disappears — but only record an intent when there IS work in
    // flight. Job ids are stable across re-creates (createRenderJob upserts), so a 'delete'
    // intent left on an idle id outlives the row and silently aborts the project's next
    // render at the queue's pre-run gate.
    const job = getRepos().renderJob(id)
    if (!cancelRender(id, 'delete') && (job?.status === 'rendering' || id.startsWith('preview-'))) markCancelIntent(id, 'delete')
    getRepos().deleteRenderJob(id)
  })
  ipcMain.handle('render:requeue', (_e, id: string) => {
    consumeCancelIntent(id) // an explicit retry must not be eaten by a stale cancel flag
    getRepos().setRenderStatus(id, { status: 'queued', pct: 0, error: '' })
  })
  ipcMain.handle('render:openFile', async (_e, id: string) => {
    const p = outputPathForJob(id)
    if (p) await shell.openPath(p)
  })
  ipcMain.handle('render:openFolder', async (_e, id: string) => {
    const p = outputPathForJob(id)
    if (p) shell.showItemInFolder(p)
    else await shell.openPath(outputDir())
  })
  ipcMain.handle('fs:chooseFolder', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? '' : res.filePaths[0]
  })
}

// Exported for the headless M6 smoke harness.
export { jobsView }
