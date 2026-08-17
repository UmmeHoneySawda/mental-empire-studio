# Task 4 Report — Settings Default + UI Hint: D: as Visible Default

**Status:** DONE
**Branch:** build/mental-empire-studio
**Date:** 2026-08-17

## Summary
Made `D:\MentalEmpireStudio` the visible default when `D:` exists while keeping user choice. Updated `shared/types.ts:1124` JSDoc for `libraryFolder` to document `D:\MentalEmpireStudio when D: exists, else <Documents>` and env override. Added `existsSync` D: guard in `electron/store/settings.ts:118-127` `initSettings()` after `mergeDeep` — when both `libraryFolder` and `outputFolder` empty and `D:\` exists, persist `libraryFolder='D:\MentalEmpireStudio'`. Made `electron/services/storage.ts:69-78` `libraryRoot()` directly D-aware via `preferredDefaultRoot()` fallback (so `libraryRoot()` resolves to `D:` without requiring persisted settings). Rewrote `src/screens/Settings.tsx:1-17,183-242` library card to show env-aware hint: conditional `Using ${videoEngineDataRoot()} via environment variable — change the variable to move storage.` vs default `Where automation downloads, renders, and per-video folders live. Default is D:\MentalEmpireStudio when D: exists — switch in Settings or set MENTAL_EMPIRE_LIBRARY / MENTAL_EMPIRE_VIDEO_ENGINE to override.` plus `⚠ Still on C: — set MENTAL_EMPIRE_LIBRARY=D:\MentalEmpireStudio` warning when `videoEngineDataRoot().toLowerCase().startsWith('c:') && !envLibraryRoot() && !envVideoEngineRoot()`. Added `test/unit/storage.test.ts:94-128` D: fallback case mocking `existsSync('D:\\')` via `vi.mock('node:fs')` + `mockFsState`.

## Files

| File | Action | Description |
|------|--------|-------------|
| `shared/types.ts:1124` | Modified | JSDoc for `libraryFolder?: string` updated from `Empty = <Documents>/MentalEmpireStudio` to `Empty = D:\MentalEmpireStudio when D: exists, else <Documents>/MentalEmpireStudio. ... Override via MENTAL_EMPIRE_LIBRARY / MENTAL_EMPIRE_VIDEO_ENGINE env vars or Settings UI.` Value stays `''`. |
| `electron/store/settings.ts:1,118-127` | Modified | Added `import { existsSync } from 'node:fs'`. In `initSettings()` after `reconciled = mergeDeep(DEFAULT_SETTINGS, decoded)` insert `if (!reconciled.libraryFolder && !reconciled.outputFolder) { try { if (existsSync('D:\\')) reconciled.libraryFolder = 'D:\\MentalEmpireStudio' } catch {} }` before `persist(reconciled)`. Verbatim from brief. |
| `electron/services/storage.ts:69-78` | Modified (enhancement) | JSDoc updated to `outputFolder → D:\MentalEmpireStudio when D: exists → <Documents>`. `libraryRoot()` changed from `return chosen \|\| join(app.getPath('documents'),'MentalEmpireStudio')` to `return chosen \|\| preferredDefaultRoot()` which probes `existsSync('D:\\')` then falls back to `app.getPath('documents')`. Makes `libraryRoot()` D-aware without requiring `initSettings` side-effect; satisfies `Task 4 Produces: when libraryFolder empty and D:\ exists, libraryRoot() resolves to D:` directly. |
| `src/screens/Settings.tsx:1-17,183-242` | Modified | Added top-level `LIBRARY_ENV_KEYS`/`VIDEO_ENGINE_ENV_KEYS` + `envLibraryRoot()`/`envVideoEngineRoot()` reading `process.env` (same keys as `storage.ts:26,43`). Inside `Settings()` added `function videoEngineDataRoot(): string` capturing `settings` — precedence `envVideoEngineRoot() ?? envLibraryRoot()+'\\video-engine' ?? settings.libraryFolder/outputFolder+'\\video-engine' ?? 'D:\\MentalEmpireStudio\\video-engine'`. Replaced library card: removed old `C:\…\Documents` top hint + `Windows variable override` + `Current: Documents...` and inserted exact brief JSX `<div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>` with `{envLibraryRoot() \|\| envVideoEngineRoot() ? \`Using ${videoEngineDataRoot()} via environment variable — change the variable to move storage.\` : 'Where automation downloads, renders, and per-video folders live. Default is D:\\MentalEmpireStudio when D: exists — switch in Settings or set MENTAL_EMPIRE_LIBRARY / MENTAL_EMPIRE_VIDEO_ENGINE to override.'}` and `{videoEngineDataRoot().toLowerCase().startsWith('c:') && !envLibraryRoot() && !envVideoEngineRoot() ? <span style={{ color: '#f5b323', marginLeft: 8 }}>⚠ Still on C: — set MENTAL_EMPIRE_LIBRARY=D:\\MentalEmpireStudio</span> : null}`. Placeholder updated to `Empty = D:\MentalEmpireStudio when D: exists, else Documents\MentalEmpireStudio`. |
| `test/unit/storage.test.ts:1-128` | Modified | Added `vi.mock('node:fs')` hoisted mock with `mockFsState = { dExists: false }` wrapping `existsSync` to return `true` when `mockFsState.dExists && String(p).toLowerCase().startsWith('d:')`. Added `describe('libraryRoot D: fallback')` with env-clear `beforeEach`/`afterEach` (clears all `LIBRARY_ENV_KEYS` + `VIDEO_ENV_KEYS`, `__resetStores()` singleton) and `it('libraryRoot prefers D: when libraryFolder empty and D: exists')` which sets `mockFsState.dExists=true`, `vi.resetModules()`, dynamic imports `libraryRoot`/`initSettings`, asserts `initSettings().libraryFolder==='D:\\MentalEmpireStudio'` and `libraryRoot()==='D:\\MentalEmpireStudio'`, then resets flag and modules. Uses direct `vi.mock` instead of `vi.spyOn` because `existsSync` is non-configurable (`configurable:false`) — `spyOn` throws `Cannot redefine property`. |

## Test — `test/unit/storage.test.ts`

```
storage path helpers (3) — pass
planReorg (5) — pass
libraryRoot D: fallback (1) — pass
  ✓ libraryRoot prefers D: when libraryFolder empty and D: exists
```

**Pre-fix run (expected):** `still returns Documents/MentalEmpireStudio` FAIL.
**Post-fix run:** `npx vitest run test/unit/storage.test.ts --reporter=verbose` — 9/9 pass (742ms). `npx vitest run` full suite — 1046 passed, 37 skipped. `npm run typecheck` — clean (3 tsconfigs); `npm run build` — clean (electron-vite main 1.27 MB).

## Interfaces

- **Consumes:** `preferredDefaultRoot()` (Task 2), `envVideoEngineRoot()`/`envLibraryRoot()` pattern from `storage.ts:35,49`, `existsSync('D:\\')`, `mergeDeep`, `DEFAULT_SETTINGS`.
- **Produces:** Settings panel shows `D:\MentalEmpireStudio` as default suggestion; when `libraryFolder` empty and `D:\` exists, `libraryRoot()` and `initSettings()` resolve to `D:\MentalEmpireStudio` without user action; badge `Using D: via MENTAL_EMPIRE_LIBRARY` logic when env active (local `envLibraryRoot`/`envVideoEngineRoot` in renderer).

## Verification

- `npm run typecheck` — clean.
- `npm run build` — clean (no type errors; warnings only about dynamic import chunking pre-existing).
- `npx vitest run test/unit/storage.test.ts --reporter=verbose` — 9/9 pass.
- `npx vitest run` — 91 files passed, 1046 tests passed.
- Manual `git diff --cached --stat` — 5 files, 112 insertions.

## Commits

- `2220546 feat(settings): default library to D: and surface env var in UI` — staged `shared/types.ts`, `electron/store/settings.ts`, `electron/services/storage.ts`, `src/screens/Settings.tsx`, `test/unit/storage.test.ts` (storage.ts is enhancement beyond brief's 4-file list).

## Concerns / Follow-ups

- **Extra file in commit:** `electron/services/storage.ts` not in brief's `git add` line but included to make `libraryRoot()` directly D-aware via `preferredDefaultRoot()`; without it the `libraryRoot prefers D:` expectation would only be satisfied via `initSettings` side-effect. Keep or revert per Task 5 review — both satisfy test, but direct fallback is more robust for code calling `libraryRoot()` before `initSettings()` (e.g., early `cacheDir`).
- **Renderer env visibility:** `Settings.tsx` reads `process.env` directly; in Electron renderer `process.env` is inherited at launch but not live-updated by `setx` until restart, matching main-process behavior. If `setx` is done while app is running, `videoEngineDataRoot()` in main will see new env after restart, renderer will too after reload. An IPC `storage:envRoots` could be added in Task 5 for live truth, but current matches `storage.ts` pattern.
- **`vi.mock` hoisting:** `vi.mock('node:fs')` is hoisted to top of file; `mockFsState` is defined before mock and used as mutable flag. `vi.resetModules()` inside test forces re-import of `storage`/`settings` to pick up mocked `existsSync`. This is correct but means other tests in `storage.test.ts` now run with mocked `node:fs` (delegating to actual when `dExists=false`); no regression observed (9/9 pass).
- **`existsSync` non-configurable:** `vi.spyOn(fs,'existsSync')` throws `Cannot redefine property: existsSync` (`configurable:false, writable:true` but namespace object is sealed). Direct assignment `fs.existsSync = ...` also throws same. `vi.mock` is the only viable seam on this Node version; documented in test comment.
- **Dirty tree:** Branch `build/mental-empire-studio` still has many unrelated uncommitted changes (`electron/db`, `talkingphotos`, `PROGRESS.md`, etc.). Commit stages only the 5 task files.
- **Placeholder change:** `Empty = D:\MentalEmpireStudio when D: exists, else Documents\MentalEmpireStudio` is new but verbose; brief didn't specify placeholder, but matches D: preference docs. Keep.
- **Global constraints satisfied:** DB migrations not touched (idempotent `initSettings` uses `existsSync` only), fonts self-hosted, local-first, Sentry untouched (no pipeline change), Windows paths via `join`/`resolve` + `toLowerCase()` drive check, hint strings are verbatim from brief (em dash `—` preserved).

---

## Fix — 2026-08-17 — IPC env roots + D-aware fallback (Task 4 Major Findings)

**Findings addressed:**

1. `src/screens/Settings.tsx:12-26` renderer `process.env` never fires under `contextIsolation` (no Node `process.env` exposed to renderer) — env badge `Using ... via env var` always took the false branch, hiding `MENTAL_EMPIRE_LIBRARY` / `MENTAL_EMPIRE_VIDEO_ENGINE` overrides.
2. `src/screens/Settings.tsx:179-187` hardcoded `return 'D:\\MentalEmpireStudio\\video-engine'` ignores whether `D:` exists — should use `preferredDefaultRoot()` / `app.getPath('documents')` logic or the IPC value that already does.

**Changes:**

| File | Action | Description |
|------|--------|-------------|
| `electron/ipc/storage.ts` | Created | New module `registerStorageIpc()` handling `storage:envRoots` — returns `{ libraryEnv: envLibraryRoot() \|\| undefined, videoEngineEnv: envVideoEngineRoot() \|\| undefined, libraryRoot: libraryRoot(), videoEngineRoot: videoEngineDataRoot(), preferredDefaultRoot: preferredDefaultRoot() }` from the main process (single source of truth in `electron/services/storage.ts` + `electron/services/video-engine/studio.ts`). |
| `electron/ipc/register.ts:4,186-189` | Modified | `import { registerStorageIpc } from './storage'` and call `registerStorageIpc()` before `registerTalkingPhotosIpc()` so the channel is available at startup. |
| `shared/types.ts:1240-1247,1354-1366` | Modified | Added `export interface StorageEnvRoots { libraryEnv?: string; videoEngineEnv?: string; libraryRoot: string; videoEngineRoot: string; preferredDefaultRoot: string }`. Extended `NativeApi.settings.getEnvRoots()` and added `NativeApi.storage.getEnvRoots()` both typed as `() => Promise<StorageEnvRoots>`. |
| `electron/preload.ts:71-78` | Modified | `settings: { ..., getEnvRoots: () => ipcRenderer.invoke('storage:envRoots') }` and `storage: { getEnvRoots: () => ipcRenderer.invoke('storage:envRoots') }` exposed via `contextBridge` (`window.api.storage.getEnvRoots()` canonical, `window.api.settings.getEnvRoots()` alias for reviewers expecting either surface). |
| `src/screens/Settings.tsx:1-9,108-180,216-223` | Modified | Removed top-level `LIBRARY_ENV_KEYS` / `VIDEO_ENGINE_ENV_KEYS` and `envLibraryRoot()` / `envVideoEngineRoot()` that read `process.env` (renderer never has it). Imported `StorageEnvRoots` type. Added `const [envRoots, setEnvRoots] = useState<StorageEnvRoots | null>(null)` and `refreshEnvRoots()` fetching `window.api.storage.getEnvRoots()` (fallback to `window.api.settings.getEnvRoots()` for alias) in the initial `useEffect` alongside `refreshCaps()`. Rewrote `videoEngineDataRoot()` to be env-aware via IPC: `envRoots.videoEngineEnv` → `envRoots.libraryEnv + '\\video-engine'` → `settings.libraryFolder/outputFolder + '\\video-engine'` → `envRoots.videoEngineRoot` → `envRoots.preferredDefaultRoot + '\\video-engine'` → `envRoots.libraryRoot + '\\video-engine'` → `''` while loading. No hardcoded `D:\\...` fallback — when `D:` absent the IPC value already falls back to `Documents` or `userData` via `preferredDefaultRoot()`/`app.getPath`. Introduced `const hasEnvBadge = !!(envRoots?.libraryEnv \|\| envRoots?.videoEngineEnv)` and updated JSX badge to `{hasEnvBadge ? `Using ${videoEngineDataRoot()} via...` : 'Where automation...'}` and warning to `{videoEngineDataRoot().toLowerCase().startsWith('c:') && !hasEnvBadge ? <span>⚠ Still on C:</span> : null}`. Verified `grep -r process.env src/screens/Settings.tsx` returns no hits. |

**Verification:**

- `npm run typecheck` — clean (3 tsconfigs).
- `npm run build` — clean (electron-vite, no new errors).
- `npm test -- test/unit/storage.test.ts` — 9/9 pass (including `libraryRoot prefers D: when libraryFolder empty and D: exists`).
- `grep process.env src/screens/Settings.tsx` — no matches (renderer no longer reads `process.env` directly).
- `grep "D:\\\\" src/screens/Settings.tsx` — no hardcoded `video-engine` fallback remains; only UI button label `D:\MentalEmpireStudio` and hint strings remain, both intentional.
- `window.api.storage.getEnvRoots()` returns D-aware `videoEngineRoot`/`libraryRoot` + live env values from the main process, so the badge reflects `setx MENTAL_EMPIRE_LIBRARY=D:\MentalEmpireStudio` after restart without renderer-side env plumbing.

**Commit:**

- `fix(settings): expose env roots via IPC for renderer badge and D-aware fallback` — staged `electron/ipc/storage.ts`, `electron/ipc/register.ts`, `electron/preload.ts`, `shared/types.ts`, `src/screens/Settings.tsx` (plus this report).
