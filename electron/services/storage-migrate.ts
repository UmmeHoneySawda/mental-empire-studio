import { basename, dirname, join, normalize } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { safeName } from '../../shared/sanitize'
import { itemFolderName, videoIdFromDownloadId } from './storage'

// Reorganize-existing migration (decision #5 of the workflow plan). Takes whatever the
// app has written so far — wherever it landed (flat <Downloads> dir, <userData>/projects,
// OS temp) — and MOVES it into the deterministic per-video library layout, rewriting the
// absolute paths stored in SQLite to match. The planner is PURE (string-only, no fs/db)
// so it is fully unit-testable; the executor does copy → verify → DB-rewrite → delete with
// an undo log, so an interruption can never lose data.

/** Which DB column an asset path is stored in. The executor + repo allowlist use these. */
export interface DbPathRef {
  table: 'downloaded_videos' | 'projects' | 'project_images' | 'render_jobs'
  column: 'filePath' | 'mp3Path' | 'thumbPath' | 'path' | 'thumb' | 'outputPath'
  id: string
}

/** One file to relocate, plus every DB column that points at it. */
export interface MoveOp {
  from: string
  to: string
  /** DB updates to apply (transactionally) AFTER the file copy is verified */
  db: DbPathRef[]
  /** sibling files (same base, e.g. .ass/.log next to a rendered .mp4) to move too */
  siblings: Array<{ from: string; to: string }>
}

export interface ReorgPlan {
  moves: MoveOp[]
  /** files already inside their correct per-item location (from === to) */
  alreadyOrganized: number
}

/** Pure inputs — denormalized DB rows. Kept primitive so the planner has no electron/db dep. */
export interface ReorgInputs {
  libraryRoot: string
  downloads: Array<{ id: string; channel: string; title: string; filePath?: string | null }>
  projects: Array<{ id: string; downloadId: string; channel: string; title: string; mp3Path?: string | null; thumbPath?: string | null }>
  images: Array<{ id: string; projectId: string; path?: string | null; thumb?: string | null }>
  jobs: Array<{ id: string; projectId: string; outputPath?: string | null }>
}

type Sub = 'audio' | 'images' | 'thumb' | 'output'

interface Ref { channel: string; videoId: string; title: string }

/** Target absolute path for one asset under the per-video layout. Pure. */
function targetPath(libraryRoot: string, ref: Ref, sub: Sub, sourcePath: string): string {
  return join(libraryRoot, safeName(ref.channel, 'Unknown'), itemFolderName(ref), sub, basename(sourcePath))
}

/** Looks like a real, absolute-ish on-disk file path (not a URL, gradient, or data URI). */
function isLocalFile(p?: string | null): p is string {
  if (!p) return false
  if (/^(https?:|data:|linear-gradient)/i.test(p)) return false
  return true
}

/**
 * Build the move plan (pure). Groups by source path so a file referenced by multiple
 * columns (the mp3 is both a download.filePath and a project.mp3Path) is moved once with
 * all its DB updates merged. The .mp4's sibling .ass/.log are carried along.
 */
export function planReorg(inputs: ReorgInputs): ReorgPlan {
  const { libraryRoot } = inputs
  const projectsById = new Map(inputs.projects.map((p) => [p.id, p]))
  const bySource = new Map<string, MoveOp>()
  let alreadyOrganized = 0

  const add = (sourcePath: string | null | undefined, ref: Ref, sub: Sub, dbRef: DbPathRef | null, withSiblings = false): void => {
    if (!isLocalFile(sourcePath)) return
    const from = sourcePath
    const to = targetPath(libraryRoot, ref, sub, from)
    if (normalize(from) === normalize(to)) {
      alreadyOrganized++
      // Still record the no-op DB ref? No need — value is unchanged.
      return
    }
    let op = bySource.get(normalize(from))
    if (!op) {
      const siblings = withSiblings ? siblingMoves(from, to) : []
      op = { from, to, db: [], siblings }
      bySource.set(normalize(from), op)
    }
    if (dbRef) op.db.push(dbRef)
  }

  // Downloaded audio
  for (const d of inputs.downloads) {
    const ref: Ref = { channel: d.channel, videoId: videoIdFromDownloadId(d.id), title: d.title }
    add(d.filePath, ref, 'audio', { table: 'downloaded_videos', column: 'filePath', id: d.id })
  }
  // Project audio + thumbnail
  for (const p of inputs.projects) {
    const ref: Ref = { channel: p.channel, videoId: videoIdFromDownloadId(p.downloadId), title: p.title }
    add(p.mp3Path, ref, 'audio', { table: 'projects', column: 'mp3Path', id: p.id })
    add(p.thumbPath, ref, 'thumb', { table: 'projects', column: 'thumbPath', id: p.id })
  }
  // Project images (path + thumb, often identical → merged by source)
  for (const im of inputs.images) {
    const p = projectsById.get(im.projectId)
    if (!p) continue
    const ref: Ref = { channel: p.channel, videoId: videoIdFromDownloadId(p.downloadId), title: p.title }
    add(im.path, ref, 'images', { table: 'project_images', column: 'path', id: im.id })
    add(im.thumb, ref, 'images', { table: 'project_images', column: 'thumb', id: im.id })
  }
  // Rendered output (+ sibling .ass/.log)
  for (const j of inputs.jobs) {
    const p = projectsById.get(j.projectId)
    if (!p) continue
    const ref: Ref = { channel: p.channel, videoId: videoIdFromDownloadId(p.downloadId), title: p.title }
    add(j.outputPath, ref, 'output', { table: 'render_jobs', column: 'outputPath', id: j.id }, true)
  }

  return { moves: [...bySource.values()], alreadyOrganized }
}

/** The .ass + .render.log that sit next to a rendered .mp4 share its base name. Pure. */
function siblingMoves(mp4From: string, mp4To: string): Array<{ from: string; to: string }> {
  if (!/\.mp4$/i.test(mp4From)) return []
  const fromBase = mp4From.replace(/\.mp4$/i, '')
  const toBase = mp4To.replace(/\.mp4$/i, '')
  return ['.ass', '.render.log'].map((ext) => ({ from: fromBase + ext, to: toBase + ext }))
}

export interface ReorgResult {
  moved: number
  skippedMissing: number
  alreadyOrganized: number
  undoLogPath?: string
  dbUpdates: DbPathRef[]
}

/** Verified copy: copy then assert the destination exists with a matching byte size. */
function copyVerified(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  const srcSize = statSync(from).size
  const dstSize = statSync(to).size
  if (srcSize !== dstSize) {
    try { rmSync(to, { force: true }) } catch { /* ignore */ }
    throw new Error(`copy size mismatch ${from} (${srcSize}) → ${to} (${dstSize})`)
  }
}

/**
 * Execute a reorg plan: copy-verify every file (and siblings) first, then apply all DB
 * path rewrites in one transaction (via applyDb), then delete the originals. Writes an
 * undo log (new→old) before deleting so the move is reversible. If any copy fails, the
 * already-copied destinations are removed and the DB is left untouched.
 */
export function executeReorg(
  plan: ReorgPlan,
  applyDb: (updates: DbPathRef[], resolve: (ref: DbPathRef) => string) => void,
  undoDir: string
): ReorgResult {
  const copied: Array<{ from: string; to: string }> = []
  const newValueByRef = new Map<DbPathRef, string>()
  let skippedMissing = 0

  try {
    for (const op of plan.moves) {
      if (!existsSync(op.from)) { skippedMissing++; continue }
      copyVerified(op.from, op.to)
      copied.push({ from: op.from, to: op.to })
      op.db.forEach((ref) => newValueByRef.set(ref, op.to))
      for (const sib of op.siblings) {
        if (existsSync(sib.from)) {
          copyVerified(sib.from, sib.to)
          copied.push({ from: sib.from, to: sib.to })
        }
      }
    }
  } catch (e) {
    // Roll back: remove everything we copied; never touch the DB or originals.
    for (const c of copied) { try { rmSync(c.to, { force: true }) } catch { /* ignore */ } }
    throw new Error(`reorg aborted before any change committed: ${(e as Error).message}`)
  }

  // All copies verified. Persist the undo log (new→old) BEFORE deleting originals.
  let undoLogPath: string | undefined
  try {
    mkdirSync(undoDir, { recursive: true })
    undoLogPath = join(undoDir, `reorg-${Date.now()}.json`)
    writeFileSync(undoLogPath, JSON.stringify({ createdAt: new Date().toISOString(), moves: copied }, null, 2))
  } catch { /* undo log is best-effort */ }

  // Rewrite DB paths transactionally.
  const dbUpdates = [...newValueByRef.keys()]
  applyDb(dbUpdates, (ref) => newValueByRef.get(ref) as string)

  // Delete originals (best-effort: a failure here leaves a harmless duplicate, not data loss).
  for (const c of copied) {
    if (normalize(c.from) !== normalize(c.to)) {
      try { rmSync(c.from, { force: true }) } catch { /* ignore */ }
    }
  }

  return {
    moved: copied.length,
    skippedMissing,
    alreadyOrganized: plan.alreadyOrganized,
    undoLogPath,
    dbUpdates
  }
}
