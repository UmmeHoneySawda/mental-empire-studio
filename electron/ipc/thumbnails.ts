import { ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ThumbnailTemplate } from '../../shared/types'
import { getRepos } from '../db'
import { safeName } from '../../shared/sanitize'
import { cacheDir, itemThumbDir, itemDirForProject, ensureDir, writeProjectManifest } from '../services/storage'


// Thumbnail engine IPC (M5): template library + per-profile lock + PNG writer.
// Rasterization happens in the renderer (offscreen Konva → PNG data URL); main
// just persists the bytes. Per-project thumbnails go into the video's library folder
// (<lib>/<channel>/<id>__<slug>/thumb); ad-hoc template previews go to _cache/thumbnails.

function previewThumbsDir(): string {
  return ensureDir(cacheDir('thumbnails'))
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
    const file = join(previewThumbsDir(), `${safeName(name)}.png`)
    writeFileSync(file, Buffer.from(b64, 'base64'))
    return file
  })
  ipcMain.handle('thumbnails:saveProjectThumb', (_e, projectId: string, name: string, dataUrl: string) => {
    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const repos = getRepos()
    const project = repos.getProject(projectId)
    // Per-project thumbnails live with the video's other assets; fall back to the
    // shared preview cache if the project can't be resolved.
    const dir = project ? ensureDir(itemThumbDir(itemDirForProject(project))) : previewThumbsDir()
    const file = join(dir, `${safeName(name)}.png`)
    writeFileSync(file, Buffer.from(b64, 'base64'))
    repos.updateProject(projectId, { thumbPath: file })
    if (project) writeProjectManifest(itemDirForProject(project), { thumbPath: file })
    // Auto-requeue any render jobs for this project that were blocked by a missing thumbnail.
    const blocked = repos.renderJobs().filter(
      (j) => j.projectId === projectId && j.status === 'error' && j.error?.includes('Missing required render assets')
    )
    blocked.forEach((j) => repos.setRenderStatus(j.id, { status: 'queued', pct: 0, error: '' }))
    return file
  })
}
