import { app, ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThumbnailTemplate } from '../../shared/types'
import { getRepos } from '../db'
import { getSettings } from '../store/settings'


// Thumbnail engine IPC (M5): template library + per-profile lock + PNG writer.
// Rasterization happens in the renderer (offscreen Konva → PNG data URL); main
// just persists the bytes to the output folder.

function thumbsDir(): string {
  const s = getSettings()
  const base = s.outputFolder || join(app.getPath('downloads'), 'MentalEmpire_out')
  const dir = join(base, 'thumbnails')
  mkdirSync(dir, { recursive: true })
  return dir
}

function safeName(name: string): string {
  return (name.replace(/[^a-z0-9\-_. ]/gi, '_').trim() || 'thumbnail').slice(0, 120)
}

export function registerThumbnailsIpc(): void {
  ipcMain.handle('thumbnails:saveTemplate', (_e, t: ThumbnailTemplate) => getRepos().saveTemplate(t))
  ipcMain.handle('thumbnails:deleteTemplate', (_e, id: string) => getRepos().deleteTemplate(id))
  ipcMain.handle('thumbnails:templates', () => getRepos().templates())
  ipcMain.handle('thumbnails:assignToProfile', (_e, profileId: string, templateId: string) =>
    getRepos().assignTemplateToProfile(profileId, templateId)
  )
  ipcMain.handle('thumbnails:writePng', (_e, name: string, dataUrl: string) => {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const file = join(thumbsDir(), `${safeName(name)}.png`)
    writeFileSync(file, Buffer.from(b64, 'base64'))
    return file
  })
  ipcMain.handle('thumbnails:saveProjectThumb', (_e, projectId: string, name: string, dataUrl: string) => {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const file = join(thumbsDir(), `${safeName(name)}.png`)
    writeFileSync(file, Buffer.from(b64, 'base64'))
    getRepos().updateProject(projectId, { thumbPath: file })
    // Auto-requeue any render jobs for this project that were blocked by a missing thumbnail.
    const repos = getRepos()
    const blocked = repos.renderJobs().filter(
      (j) => j.projectId === projectId && j.status === 'error' && j.error?.includes('Missing required render assets')
    )
    blocked.forEach((j) => repos.setRenderStatus(j.id, { status: 'queued', pct: 0, error: '' }))
    return file
  })
}
