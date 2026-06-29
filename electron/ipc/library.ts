import { ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { getRepos } from '../db'
import { libraryRoot, cacheDir } from '../services/storage'
import { planReorg, executeReorg, type ReorgInputs, type ReorgPlan } from '../services/storage-migrate'
import { hhmm, pushActivity } from './events'
import { L } from '../services/logger'

// IPC for the master library: build the reorganize plan (dry run) and execute it. The
// heavy lifting lives in the pure planner + executor (storage-migrate.ts); this layer
// only gathers DB rows, sizes the plan for the preview, and wires the transactional DB
// path rewrite + activity log.

/** Gather the denormalized rows the pure planner needs. */
function gatherInputs(): ReorgInputs {
  const repos = getRepos()
  const projects = repos.listProjects()
  const images = projects.flatMap((p) => repos.getProjectImages(p.id))
  return {
    libraryRoot: libraryRoot(),
    downloads: repos.downloads().map((d) => ({ id: d.id, channel: d.channel, title: d.title, filePath: d.filePath })),
    projects: projects.map((p) => ({ id: p.id, downloadId: p.downloadId, channel: p.channel, title: p.title, mp3Path: p.mp3Path, thumbPath: p.thumbPath })),
    images: images.map((im) => ({ id: im.id, projectId: im.projectId, path: im.path, thumb: im.thumb })),
    jobs: repos.renderJobs().map((j) => ({ id: j.id, projectId: j.projectId, outputPath: j.outputPath }))
  }
}

export interface ReorgPreview {
  libraryRoot: string
  fileCount: number
  totalBytes: number
  missing: number
  alreadyOrganized: number
  sample: Array<{ from: string; to: string }>
}

/** Dry-run: size the plan + a few example moves for the confirmation dialog. */
function preview(): ReorgPreview {
  const plan = planReorg(gatherInputs())
  let totalBytes = 0
  let missing = 0
  let fileCount = 0
  for (const op of plan.moves) {
    const files = [op.from, ...op.siblings.map((s) => s.from)]
    for (const f of files) {
      if (existsSync(f)) { fileCount++; try { totalBytes += statSync(f).size } catch { /* ignore */ } }
      else if (f === op.from) missing++
    }
  }
  return {
    libraryRoot: libraryRoot(),
    fileCount,
    totalBytes,
    missing,
    alreadyOrganized: plan.alreadyOrganized,
    sample: plan.moves.slice(0, 8).map((m) => ({ from: m.from, to: m.to }))
  }
}

function reorganize(): { moved: number; skippedMissing: number; alreadyOrganized: number; undoLogPath?: string } {
  const plan: ReorgPlan = planReorg(gatherInputs())
  const repos = getRepos()
  const result = executeReorg(
    plan,
    (updates, resolve) =>
      repos.rewriteAssetPaths(updates.map((u) => ({ table: u.table, column: u.column, id: u.id, value: resolve(u) }))),
    cacheDir('reorg')
  )
  L.info(`library reorganize: moved=${result.moved} skipped=${result.skippedMissing} alreadyOrganized=${result.alreadyOrganized} undo=${result.undoLogPath ?? 'none'}`)
  pushActivity({ t: hhmm(), icon: '📦', color: '#36c98e', text: `Organized library — ${result.moved} files into per-video folders` })
  return { moved: result.moved, skippedMissing: result.skippedMissing, alreadyOrganized: result.alreadyOrganized, undoLogPath: result.undoLogPath }
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:previewReorg', () => preview())
  ipcMain.handle('library:reorganize', () => reorganize())
}
