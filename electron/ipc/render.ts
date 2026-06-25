import { BrowserWindow, dialog, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RenderQueueRow } from '../../shared/types'
import { getRepos } from '../db'
import { runAll, outputDir } from '../services/queue'

// Render queue IPC (M6): the joined queue view, run-all, cancel, and an output
// folder picker for the Render Queue screen.

function safeName(name: string): string {
  return (name.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || 'thumbnail').slice(0, 120)
}

function jobsView(): RenderQueueRow[] {
  const repos = getRepos()
  const thumbsDir = join(outputDir(), 'thumbnails')
  return repos.renderJobs().map((job) => {
    const project = repos.getProject(job.projectId)
    const images = repos.getProjectImages(job.projectId)
    const words = repos.getTranscript(job.projectId)
    const hasThumb = !!project && existsSync(join(thumbsDir, `${safeName(project.title)}.png`))
    return {
      job,
      images: images.length,
      hasMp3: !!project?.mp3Path,
      hasThumb,
      hasCaptions: words.length > 0
    }
  })
}

export function registerRenderIpc(): void {
  ipcMain.handle('render:jobs', () => jobsView())
  ipcMain.handle('render:all', () => runAll())
  ipcMain.handle('render:cancel', (_e, id: string) => getRepos().setRenderStatus(id, { status: 'queued', pct: 0 }))
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
