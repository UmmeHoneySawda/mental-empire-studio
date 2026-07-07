import { ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { getRepos } from '../db'

// Image library (P2 I): images used in past projects, grouped by channel, so a later
// project targeting the same channel can reuse the same set instead of re-picking from
// disk. Recorded as a side effect of compose:setImages (see ipc/compose.ts).

export function registerAssetsIpc(): void {
  ipcMain.handle('assets:list', () =>
    // A project's images live under its own per-video folder; if that project (or the
    // file) was since deleted, drop the stale row rather than surfacing a broken thumbnail.
    getRepos().listAssets().filter((a) => existsSync(a.path))
  )
}
