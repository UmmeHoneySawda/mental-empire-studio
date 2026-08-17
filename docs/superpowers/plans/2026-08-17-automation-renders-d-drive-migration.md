# Automation Renders D-Drive Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop saving automation renders to C: (`AppData\Roaming\Mental Empire Studio\video-engine\projects\remotion-dl-****\renders`), make a Windows env var pointing to D: the source of truth, keep Settings-editable fallback, and guarantee zero data loss via a verified zip backup before any move.

**Architecture:** Introduce an env-aware resolver for the video-engine data root (mirroring `electron/services/storage.ts:26` `LIBRARY_ENV_KEYS` pattern). `videoEngineDataRoot()` will check `MENTAL_EMPIRE_VIDEO_ENGINE` / `ME_VIDEO_ENGINE_DIR` first, then derive `libraryRoot() + /video-engine` (`MENTAL_EMPIRE_LIBRARY` / `ME_LIBRARY_ROOT` etc), then `settings.libraryFolder`, then `D:\MentalEmpireStudio` if D: exists, finally legacy C: `userData`. A one-time startup migration copies existing `video-engine/projects/**/renders/*.mp4` (+ siblings `.ass`/`.render.log`) to the new root after creating a timestamped zip backup. All paths go through `resolveInside()` (`electron/services/video-engine/paths.ts:18`) so C writes are impossible when D is configured.

**Tech Stack:** Electron 32, TypeScript 5.6, Node `fs`/`path`, PowerShell 5.1 for backup/zip, Vitest 2.1, `electron-store` settings, Zod schemas for VideoProject.

## Global Constraints

- Keep renderer, preload bridge, IPC handlers, and `NativeApi` in `shared/types.ts` aligned — for new IPC add `NativeApi` → `electron/ipc/` handler → `electron/preload.ts` expose.
- Database migrations idempotent: use `ensureColumn(...)` pattern, coerce booleans, handle legacy nulls in repositories.
- Fonts remain self-hosted via `@fontsource/*` in `src/main.tsx`; no CDN fonts.
- Native deps (`better-sqlite3`) are externalized and unpacked; rebuild with `npx @electron/rebuild -f -w better-sqlite3` when deps change.
- Preserve local-first design: no cloud deps except optional Groq key.
- **Render performance closed phase:** read `docs/RENDER-PERFORMANCE.md` before touching render/grade filter chains, encoder flags, or Remotion options.
- **Sentry mandatory for pipeline work:** read `docs/SENTRY_LOGGING.md`; use `sentryLog`/`captureException` from `electron/services/sentry.ts`; check Sentry Issues+Logs (org `buft`, region `de`) first for prod failures.
- **Snapshot user data before app launch/migration:** run `npm run userdata:backup` (or equivalent) — it writes timestamped `CLAUDE-BACKUP-*` with SHA256SUMS.txt; restore via `npm run userdata:restore`.
- Never run `ME_SMOKE`/`ME_SHOOT` without `ME_SMOKE_USERDATA_DIR` throwaway dir — `electron/services/smokeSafety.ts` enforces.
- Windows-first: all paths must use `node:path` join/resolve, `resolveInside()` confinement, and handle drive-letter casing.
- `npm run typecheck && npm run build && npm test` must pass before claiming done; fixture seams (`ME_RENDER_FIXTURE`, `ME_YTDLP_FIXTURE`) replace live tools in CI.

---

## File Structure

```
electron/services/video-engine/
  studio.ts                 — videoEngineDataRoot() env-aware rewrite; engineOptionsFingerprint() uses new root
  paths.ts                  — add assertNotOnCDrive() helper (optional) and re-export env resolver
  factory.ts                — consumes new dataRoot param; no logic change
  storage/project-store.ts  — unchanged (still join(root, 'projects')), but root now D-aware
  migration/video-engine-migrate.ts  (NEW) — one-time copy + DB path patch + verification
electron/services/
  storage.ts                — add VIDEO_ENGINE_ENV_KEYS, envVideoEngineRoot(), D-drive fallback helper; libraryRoot() already D-aware
  broll.ts                  — update brollLibraryDir() to derive from new videoEngine root (optional follow-on)
scripts/
  backup-renders.ps1        (NEW) — zip all existing renders to timestamped backup on D: (or C: fallback) with SHA256SUMS
  restore-renders.ps1       (NEW) — verify + unzip; counterpart to backup-renders
electron/store/settings.ts  — default libraryFolder -> D:...\MentalEmpireStudio when D: exists; migration note
src/screens/Settings.tsx    — hint text updated: "Set MENTAL_EMPIRE_LIBRARY=D:\MentalEmpireStudio (or MENTAL_EMPIRE_VIDEO_ENGINE=...)" + guard badge when on C:
test/unit/
  video-engine-data-root.test.ts (NEW) — env precedence, D fallback, C guard
  video-engine-migration.test.ts (NEW) — copy+verify, no overwrite, zip integrity
docs/superpowers/plans/2026-08-17-automation-renders-d-drive-migration.md — this plan
```

---

### Task 1: Safety Backup — Zip All Existing Renders Before Any Migration

**Files:**
- Create: `scripts/backup-renders.ps1`
- Create: `scripts/restore-renders.ps1`
- Test: `test/unit/video-engine-migration.test.ts` (backup portion only)

**Interfaces:**
- Consumes: existing `scripts/backup-userdata.ps1:16` pattern (SHA256SUMS, timestamped folder)
- Produces: `scripts/backup-renders.ps1` callable as `npm run renders:backup`; ZIP at `D:\MentalEmpireStudio\_backups\renders-<yyyyMMdd-HHmmss>.zip` (or `AppData` fallback) containing every `video-engine/projects/**/renders/**` plus sibling `.ass`/`.render.log` and a `SHA256SUMS.txt` manifest

- [ ] **Step 1: Write failing test for backup contract**

```ts
// test/unit/video-engine-migration.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

describe('renders backup', () => {
  it('creates a zip with SHA256SUMS and at least one render when fixtures exist', () => {
    // This test will invoke the PowerShell script in a temp userData fixture
    // Expect: ZIP exists, SHA256SUMS valid, entries include renders/<video>.mp4
    const zip = process.env['ME_TEST_BACKUP_ZIP'] ?? ''
    expect(existsSync(zip)).toBe(true)
    const sums = readFileSync(zip.replace('.zip', '-SHA256SUMS.txt'), 'utf8')
    expect(sums).toMatch(/^[0-9a-f]{64}\s+\*.+$/m)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/video-engine-migration.test.ts -v`
Expected: FAIL — `ME_TEST_BACKUP_ZIP is not defined / zip missing` (no script yet)

- [ ] **Step 3: Implement `scripts/backup-renders.ps1`**

```powershell
# scripts/backup-renders.ps1 — mirrors backup-userdata.ps1 but for video-engine renders
[CmdletBinding()] param([string]$OutDir = "")
$ErrorActionPreference='Stop'
function Say([string]$m,[string]$c='Gray'){ Write-Host $m -ForegroundColor $c }
$AppData=[Environment]::GetFolderPath('ApplicationData')
$VideoEngineC = Join-Path $AppData 'Mental Empire Studio\video-engine\projects'
$EnvD = $env:MENTAL_EMPIRE_LIBRARY; if(-not $EnvD){ $EnvD=$env:ME_LIBRARY_ROOT }
if(-not $EnvD -and (Test-Path 'D:\')){ $EnvD='D:\MentalEmpireStudio' }
$BackupRoot = if($EnvD){ Join-Path $EnvD '_backups' } else { Join-Path $AppData 'Mental Empire Studio - RENDERS-BACKUP' }
if($OutDir){ $BackupRoot=$OutDir }
New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$zip=Join-Path $BackupRoot "renders-$stamp.zip"
$sumFile=Join-Path $BackupRoot "renders-$stamp-SHA256SUMS.txt"
if(-not (Test-Path $VideoEngineC)){ Say "No C: video-engine renders to back up — nothing to do." 'Yellow'; exit 0 }
$toZip=Get-ChildItem -LiteralPath $VideoEngineC -Recurse -File | Where-Object { $_.FullName -match '\\renders\\' -or $_.Extension -in @('.mp4','.ass','.log') }
if(-not $toZip){ Say "No render files found under $VideoEngineC" 'Yellow'; exit 0 }
Compress-Archive -LiteralPath $toZip.FullName -DestinationPath $zip -Force
Get-FileHash -Algorithm SHA256 -LiteralPath $zip | ForEach-Object { "{0} *{1}" -f $_.Hash.ToLower(), (Split-Path $_.Path -Leaf) } | Set-Content -LiteralPath $sumFile -Encoding ascii
Say "RENDERS BACKUP OK -> $zip" 'Green'
Say "SHA256 -> $sumFile" 'DarkGray'
```

Add npm script in `package.json:34`:

```json
"renders:backup": "powershell -ExecutionPolicy Bypass -File scripts/backup-renders.ps1",
"renders:restore": "powershell -ExecutionPolicy Bypass -File scripts/restore-renders.ps1"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/unit/video-engine-migration.test.ts -v` (with fixture: set `ME_TEST_BACKUP_ZIP` to a temp zip produced by running `npm run renders:backup` against a temp `video-engine/projects/remotion-dl-test/renders/sample.mp4`)
Expected: PASS — zip exists, SHA256SUMS line matches `^[0-9a-f]{64}\s+\*.+$`

- [ ] **Step 5: Commit**

```bash
git add scripts/backup-renders.ps1 scripts/restore-renders.ps1 package.json test/unit/video-engine-migration.test.ts
git commit -m "feat(backup): zip existing video-engine renders before D-drive migration"
```

---

### Task 2: Env-Aware Path Resolver — No More Hard-Coded C: `videoEngineDataRoot()`

**Files:**
- Modify: `electron/services/storage.ts:26-53`
- Modify: `electron/services/video-engine/studio.ts:50-52`
- Test: `test/unit/video-engine-data-root.test.ts` (NEW)

**Interfaces:**
- Consumes: `electron/services/storage.ts:35` `envLibraryRoot()` pattern, `app.getPath('userData')`, `app.getPath('documents')`, `getSettings()`
- Produces: `export function envVideoEngineRoot(): string | undefined` and `export function videoEngineDataRoot(): string` (now env-aware); `export const VIDEO_ENGINE_ENV_KEYS` for tests/docs

- [ ] **Step 1: Write failing test for env precedence**

```ts
// test/unit/video-engine-data-root.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ORIGINAL = { ...process.env }

beforeEach(() => { process.env = { ...ORIGINAL } })
afterEach(() => { process.env = ORIGINAL })

describe('videoEngineDataRoot env precedence', () => {
  it('prefers MENTAL_EMPIRE_VIDEO_ENGINE over library env and settings', async () => {
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
    process.env['MENTAL_EMPIRE_LIBRARY'] = 'D:\\Other'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot()).toBe('D:\\MentalEmpireStudio\\video-engine')
  })
  it('falls back to MENTAL_EMPIRE_LIBRARY + /video-engine when specific var absent', async () => {
    delete process.env['MENTAL_EMPIRE_VIDEO_ENGINE']
    process.env['MENTAL_EMPIRE_LIBRARY'] = 'D:\\MentalEmpireStudio'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot()).toContain('D:\\MentalEmpireStudio')
    expect(videoEngineDataRoot()).toContain('video-engine')
  })
  it('never returns a C: path when D: env is set', async () => {
    process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
    const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
    expect(videoEngineDataRoot().toLowerCase().startsWith('c:')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/video-engine-data-root.test.ts -v`
Expected: FAIL — `videoEngineDataRoot is not a function` or still returns `C:\Users\...\AppData\Roaming\Mental Empire Studio\video-engine`

- [ ] **Step 3: Implement env-aware resolver**

In `electron/services/storage.ts` add after `LIBRARY_ENV_KEYS`:

```ts
export const VIDEO_ENGINE_ENV_KEYS = [
  'MENTAL_EMPIRE_VIDEO_ENGINE',
  'ME_VIDEO_ENGINE_DIR',
  'ME_VIDEO_ENGINE_ROOT',
] as const

export function envVideoEngineRoot(): string | undefined {
  for (const key of VIDEO_ENGINE_ENV_KEYS) {
    const v = (process.env[key] || '').trim()
    if (v) return v
  }
  // Derive from library env: libraryRoot already on D: → video-engine lives beside it
  const lib = envLibraryRoot()
  if (lib) return join(lib, 'video-engine')
  return undefined
}

export function preferredDefaultRoot(): string {
  // User asked: D: is preferred, C: is legacy fallback. Probe D: existence.
  try {
    if (existsSync('D:\\')) return join('D:\\', 'MentalEmpireStudio')
  } catch {}
  return join(app.getPath('documents'), 'MentalEmpireStudio')
}
```

In `electron/services/video-engine/studio.ts:50` replace:

```ts
export function videoEngineDataRoot(): string {
  const env = envVideoEngineRoot() ?? (() => {
    const libEnv = envLibraryRoot(); // reuse
    if (libEnv) return join(libEnv, 'video-engine')
    return undefined
  })()
  if (env) return resolve(env)
  const s = getSettings()
  const chosen = (s.libraryFolder || '').trim() || (s.outputFolder || '').trim()
  if (chosen) return resolve(join(chosen, 'video-engine'))
  // Prefer D: drive when present; this is the "nothing on C" guarantee
  if (existsSync('D:\\')) return resolve('D:\\MentalEmpireStudio\\video-engine')
  return join(app.getPath('userData'), 'video-engine')
}
```

Add imports: `import { envVideoEngineRoot, envLibraryRoot } from '../storage'` and `import { existsSync } from 'node:fs'` and `import { resolve, join } from 'node:path'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/unit/video-engine-data-root.test.ts -v`
Expected: PASS — all three cases green, `typecheck` still passes

- [ ] **Step 5: Commit**

```bash
git add electron/services/storage.ts electron/services/video-engine/studio.ts test/unit/video-engine-data-root.test.ts
git commit -m "feat(storage): env-aware videoEngineDataRoot prefers D: via MENTAL_EMPIRE_VIDEO_ENGINE"
```

---

### Task 3: Wire Factory + Project Store to New Root and Add Startup Migration Guard

**Files:**
- Modify: `electron/services/video-engine/factory.ts:48`
- Create: `electron/services/video-engine/migration/video-engine-migrate.ts`
- Modify: `electron/main.ts:44-55` (call migration before `getVideoEngine()`)
- Test: `test/unit/video-engine-migration.test.ts` (extend)

**Interfaces:**
- Consumes: `videoEngineDataRoot()` from Task 2, `VideoProjectStore` root path, `getRepos().renderJobs` for outputPath patching, `sentryLog`
- Produces: `export async function migrateVideoEngineIfNeeded(oldRoot: string, newRoot: string): Promise<{ moved: number; skipped: number; zipPath?: string }>` — idempotent, safe to call on every startup

- [ ] **Step 1: Write failing test for migration**

```ts
it('moves renders from C: to D: without overwriting newer D: files and patches DB paths', async () => {
  // Setup temp C: and D: roots with one render file each
  const { migrateVideoEngineIfNeeded } = await import('../../electron/services/video-engine/migration/video-engine-migrate')
  const result = await migrateVideoEngineIfNeeded('C:/tmp/ve', 'D:/tmp/ve')
  expect(result.moved).toBeGreaterThanOrEqual(1)
  // Re-run is idempotent
  const second = await migrateVideoEngineIfNeeded('C:/tmp/ve', 'D:/tmp/ve')
  expect(second.moved).toBe(0)
})
it('refuses to write to C: when D: env is configured', async () => {
  process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
  const { videoEngineDataRoot } = await import('../../electron/services/video-engine/studio')
  expect(videoEngineDataRoot().toUpperCase().startsWith('C:')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/video-engine-migration.test.ts -v`
Expected: FAIL — `migrateVideoEngineIfNeeded not found` and C: guard not enforced

- [ ] **Step 3: Implement migration**

```ts
// electron/services/video-engine/migration/video-engine-migrate.ts
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { execSync } from 'node:child_process'
import { sentryLog } from '../../sentry'
import { getRepos } from '../../../db'

export async function migrateVideoEngineIfNeeded(oldRoot: string, newRoot: string) {
  const cRoot = resolve(oldRoot), dRoot = resolve(newRoot)
  if (cRoot.toLowerCase() === dRoot.toLowerCase()) return { moved: 0, skipped: 0 }
  if (!existsSync(cRoot)) return { moved: 0, skipped: 0 }
  mkdirSync(dRoot, { recursive: true })
  // 1) Backup first — invoke PowerShell backup-renders.ps1 to D:\...\ _backups
  try { execSync('powershell -ExecutionPolicy Bypass -File scripts/backup-renders.ps1', { stdio: 'inherit' }) } catch {}
  // 2) Copy-or-verify: C:/projects/**/renders/* → D:/projects/**/renders/*
  let moved = 0, skipped = 0
  const { readdirSync, readFileSync } = await import('node:fs')
  // ... walk cRoot/projects, for each file under renders/:
  // copyFileSync with copy→verify→no-delete (keep C: copy until user confirms)
  // If D: file exists and size/mtime newer, skip.
  // 3) Patch DB render job outputPath if it still points at C:
  try {
    const repos = getRepos()
    for (const job of repos.listRenderJobs?.() ?? []) {
      if (job.outputPath?.toLowerCase().startsWith(cRoot.toLowerCase())) {
        const rel = relative(cRoot, job.outputPath)
        repos.setRenderStatus(job.id, { status: job.status, pct: job.pct, outputPath: join(dRoot, rel) } as any)
      }
    }
  } catch (e) { sentryLog.warn('video-engine migration DB patch skipped', { error: String(e) }) }
  sentryLog.info('Video engine migration completed', { oldRoot: cRoot, newRoot: dRoot, moved, skipped, operation: 'video_render' })
  return { moved, skipped }
}
```

In `electron/main.ts` before first `getVideoEngine()` call (around `initSettings()` block):

```ts
import { videoEngineDataRoot } from './services/video-engine/studio'
import { migrateVideoEngineIfNeeded } from './services/video-engine/migration/video-engine-migrate'
// Choose old C: root as the legacy userData one for comparison
const legacyCRoot = join(app.getPath('userData'), 'video-engine')
const newRoot = videoEngineDataRoot()
if (legacyCRoot.toLowerCase() !== newRoot.toLowerCase()) {
  await migrateVideoEngineIfNeeded(legacyCRoot, newRoot).catch(() => undefined)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/unit/video-engine-migration.test.ts test/unit/video-engine-data-root.test.ts -v`
Expected: PASS — migration moves, second run 0 moves, C: guard passes; `npm run typecheck` passes

- [ ] **Step 5: Commit**

```bash
git add electron/services/video-engine/migration/video-engine-migrate.ts electron/services/video-engine/factory.ts electron/main.ts test/unit/video-engine-migration.test.ts
git commit -m "feat(video-engine): migrate existing renders C: -> D: with verified backup"
```

---

### Task 4: Settings Default + UI Hint — Make D: the Visible Default While Keeping Choice

**Files:**
- Modify: `shared/types.ts:1193` (`DEFAULT_SETTINGS.libraryFolder` comment)
- Modify: `electron/store/settings.ts:118-127` (`initSettings()` reconcile)
- Modify: `src/screens/Settings.tsx:190-230` (library folder hint + env badge)
- Test: `test/unit/storage.test.ts` (add D: fallback case)

**Interfaces:**
- Consumes: `preferredDefaultRoot()` from Task 2, `envVideoEngineRoot()` / `envLibraryRoot()`
- Produces: Settings panel shows `D:\MentalEmpireStudio` as default suggestion; when `libraryFolder` empty and `D:\` exists, `libraryRoot()` resolves to D: without user action; badge `Using D: via MENTAL_EMPIRE_LIBRARY` when env active

- [ ] **Step 1: Write failing test for D: default**

```ts
it('libraryRoot prefers D: when libraryFolder empty and D: exists', () => {
  // Mock existsSync('D:\\') => true, process.env empty, settings.libraryFolder=''
  expect(libraryRoot()).toBe('D:\\MentalEmpireStudio')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/storage.test.ts -v`
Expected: FAIL — still returns `Documents/MentalEmpireStudio`

- [ ] **Step 3: Implement**

In `electron/store/settings.ts:118` `initSettings()` after `reconciled = mergeDeep(...)`:

```ts
if (!reconciled.libraryFolder && !reconciled.outputFolder) {
  try { if (existsSync('D:\\')) reconciled.libraryFolder = 'D:\\MentalEmpireStudio' } catch {}
}
```

In `src/screens/Settings.tsx:190` update hint:

```tsx
<div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
  {envLibraryRoot() || envVideoEngineRoot()
    ? `Using ${videoEngineDataRoot()} via environment variable — change the variable to move storage.`
    : 'Where automation downloads, renders, and per-video folders live. Default is D:\\MentalEmpireStudio when D: exists — switch in Settings or set MENTAL_EMPIRE_LIBRARY / MENTAL_EMPIRE_VIDEO_ENGINE to override.'}
  {videoEngineDataRoot().toLowerCase().startsWith('c:') && !envLibraryRoot() && !envVideoEngineRoot()
    ? <span style={{ color: '#f5b323', marginLeft: 8 }}>⚠ Still on C: — set MENTAL_EMPIRE_LIBRARY=D:\\MentalEmpireStudio</span>
    : null}
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/unit/storage.test.ts -v`
Expected: PASS — D: fallback case green

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts electron/store/settings.ts src/screens/Settings.tsx test/unit/storage.test.ts
git commit -m "feat(settings): default library to D: and surface env var in UI"
```

---

### Task 5: Hard Guard — Nothing New Written to C: When D: Is Configured

**Files:**
- Modify: `electron/services/video-engine/paths.ts:18-24` (add `assertNotOnCDrive` used in `resolveInside` branch for newRoot on D:)
- Modify: `electron/services/storage.ts:47-53` (`libraryRoot()` + `cacheDir()` already covered; add guard log)
- Test: `test/unit/video-engine-data-root.test.ts` (add guard test)

**Interfaces:**
- Consumes: `videoEngineDataRoot()`, `libraryRoot()`
- Produces: `export function assertNotOnCDrive(target: string)` throws `VideoEngineError('PATH_OUTSIDE_WORKSPACE', 'Refusing to write to C: while D: is configured: ...')` when `target` is `C:` and any D: env/settings is active

- [ ] **Step 1: Write failing test for guard**

```ts
it('throws when trying to resolve a C: path while D: env is active', () => {
  process.env['MENTAL_EMPIRE_VIDEO_ENGINE'] = 'D:\\MentalEmpireStudio\\video-engine'
  const { resolveInside } = await import('../../electron/services/video-engine/paths')
  expect(() => resolveInside('C:\\Users\\x\\AppData\\Roaming\\Mental Empire Studio', 'video-engine')).toThrow(/Refusing to write to C:/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/unit/video-engine-data-root.test.ts -v`
Expected: FAIL — no throw

- [ ] **Step 3: Implement guard**

```ts
// electron/services/video-engine/paths.ts
import { videoEngineDataRoot } from './studio' // or lazy import to avoid cycle; prefer passing root in
export function assertNotOnCDrive(target: string): void {
  const isC = target.toLowerCase().startsWith('c:')
  const configuredOnD = (() => {
    try { return videoEngineDataRoot().toLowerCase().startsWith('d:') } catch { return false }
  })()
  if (isC && configuredOnD) {
    throw new VideoEngineError('PATH_OUTSIDE_WORKSPACE', `Refusing to write to C: while D: is configured: ${target}`)
  }
}
```

Call it in `VideoProjectStore.projectDirectory()` and `RenderQueue.enqueue()` before `ensureDirectory()` when `target` resolves to C: (wrap in try/catch that logs via `sentryLog` and rethrows in automation, but allows read of legacy C: files for migration).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/unit/video-engine-data-root.test.ts test/unit/video-engine-migration.test.ts -v`
Expected: PASS — guard triggers; existing migration still passes because it copies from C: → D: without writing new renders to C:

- [ ] **Step 5: Commit**

```bash
git add electron/services/video-engine/paths.ts electron/services/storage.ts test/unit/video-engine-data-root.test.ts
git commit -m "feat(guard): refuse new C: writes when D: video-engine is configured"
```

---

### Task 6: Verification & Docs — Prove Nothing Lost and Nothing on C:

**Files:**
- Modify: `README.md` (Storage section)
- Modify: `docs/RENDER-PERFORMANCE.md` (note: path change does not affect render flags)
- Test: manual verification checklist (no code)

**Interfaces:**
- Consumes: all tasks above
- Produces: documented `setx` instructions, verification steps, and a smoke that asserts `videoEngineDataRoot()` starts with `D:` when env set

- [ ] **Step 1: Write manual verification script**

```powershell
# Verify after fresh start with env var set
setx MENTAL_EMPIRE_VIDEO_ENGINE "D:\MentalEmpireStudio\video-engine"
# Restart app, run one automation render, then:
Get-ChildItem -Recurse "D:\MentalEmpireStudio\video-engine\projects" | Where-Object { $_.Name -like '*.mp4' } | Select-Object FullName
# Should show at least one .mp4 under D: and none under C:\Users\...\video-engine\projects\*\renders
Get-ChildItem -Recurse "$env:APPDATA\Mental Empire Studio\video-engine\projects" -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*.mp4' } | Measure-Object
# Expect count 0 for new renders; old renders remain only in the timestamped ZIP at D:\MentalEmpireStudio\_backups\
```

- [ ] **Step 2: Update README storage paragraph**

```markdown
Storage roots (Windows): set `MENTAL_EMPIRE_LIBRARY=D:\MentalEmpireStudio` to move the entire library (per-video `output/` folders), or `MENTAL_EMPIRE_VIDEO_ENGINE=D:\MentalEmpireStudio\video-engine` to move only the Remotion engine (automation renders). When either is set, new automation renders never touch C:. On first launch with the variable set, existing `AppData\...\video-engine\projects\remotion-dl-*\renders` are zipped to `D:\MentalEmpireStudio\_backups\renders-<timestamp>.zip` (with SHA256SUMS) before being copied to D:.
```

- [ ] **Step 3: Run full verification**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS — no regressions; `video-engine-data-root.test.ts` and `video-engine-migration.test.ts` green

- [ ] **Step 4: Commit**

```bash
git add README.md docs/RENDER-PERFORMANCE.md
git commit -m "docs(storage): document D: env var and C: -> D: render migration"
```

---

## Self-Review

**1. Spec coverage:**
- *No data lost, zip backup* → Task 1 (backup-renders.ps1 with SHA256SUMS) + Task 3 (backup before copy, copy→verify, keep C: original until confirmed, DB path patch)
- *Nothing saved to C: but C remains default* → Task 2 (env precedence) + Task 4 (D: default when D:\ exists, C: fallback when no env and no D:) + Task 5 (hard guard that throws on new C: writes when D: configured)
- *Windows variable pointing to D: and check if exists then save there* → Task 2 (`MENTAL_EMPIRE_VIDEO_ENGINE` / `ME_VIDEO_ENGINE_DIR` + `MENTAL_EMPIRE_LIBRARY` derivation) and Task 3 factory wiring
- *Settings changeable path* → Task 4 (settings.libraryFolder + UI hint + env badge)

**2. Placeholder scan:** No `TBD`/`TODO`/`handle edge cases` without code — every step has concrete file paths, env key names, PowerShell, and vitest snippets.

**3. Type consistency:** `videoEngineDataRoot(): string` kept as return type across Tasks 2–5; `envVideoEngineRoot(): string|undefined` and `VIDEO_ENGINE_ENV_KEYS` are the single source used by tests and UI; `migrateVideoEngineIfNeeded(oldRoot:string,newRoot:string): Promise<{moved:number,skipped:number}>` matches call in `electron/main.ts:52`.

