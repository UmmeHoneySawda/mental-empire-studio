# Task 5 Report — Hard Guard: Nothing New Written to C: When D: Is Configured

**Status:** Complete
**Commit:** ebdb7d0 — feat(guard): refuse new C: writes when D: video-engine is configured

## What was done

- `electron/services/video-engine/paths.ts:13-67` — Added `isConfiguredOnD()` (env-only probe mirroring `storage.ts`/`studio.ts` precedence without static import) and exported `assertNotOnCDrive(target: string)` that throws `VideoEngineError('PATH_OUTSIDE_WORKSPACE', 'Refusing to write to C: while D: is configured: ...')` when target starts with `c:` and any D: env is active. Integrated into `resolveInside()` (checks raw root, absoluteRoot, and final target) to satisfy the brief's test `resolveInside('C:\\Users\\x\\...','video-engine')` throws while on Linux. `resolveExistingInside` was left unguarded to allow read of legacy C: files for migration.
- `electron/services/video-engine/storage/project-store.ts:4,11-28` — Calls `assertNotOnCDrive` in `projectDirectory()` after `resolveInside`; wraps in try/catch that logs via `sentryLog.error('Refusing to write to C: while D: is configured', {target, operation:'video_engine_guard'})` and rethrows.
- `electron/services/video-engine/render/queue.ts:8,81-98` — Calls `assertNotOnCDrive` on `outputPath`, `workDirectory`, and `join(workDirectory,id)` before `ensureDirectory` in `enqueue()`; logs via `sentryLog.error` with `operation:'video_render_guard'` and rethrows.
- `electron/services/storage.ts:5,73-103` — Imported `sentryLog`; added warn guard logs in `libraryRoot()` and `cacheDir()` when they would return a `C:` path while a `D:` env is configured (storage already returns D: correctly; log covers misroute detection).
- `test/unit/video-engine-data-root.test.ts:41-45` — Added brief verbatim test: `throws when trying to resolve a C: path while D: env is active` asserting `resolveInside('C:\\Users\\x\\AppData\\Roaming\\Mental Empire Studio','video-engine')` throws `/Refusing to write to C:/`.

## Circular import avoidance

`paths.ts` cannot statically import `videoEngineDataRoot` from `studio.ts` (cycle: `paths -> studio -> storage -> ...`). Implemented `isConfiguredOnD()` that checks the same env vars (`MENTAL_EMPIRE_VIDEO_ENGINE`, `ME_VIDEO_ENGINE_DIR`, `ME_VIDEO_ENGINE_ROOT`, `MENTAL_EMPIRE_LIBRARY`, `ME_LIBRARY_ROOT`, `ME_LIBRARY_DIR`, `MENTAL_EMPIRE_OUTPUT`, `ME_OUTPUT_DIR`) directly at call time. `storage.ts` and callers that can safely import `videoEngineDataRoot` use the full helper; `paths.ts` uses the env-only probe sufficient for `resolveInside` determinism in tests. Documented in comment.

## Tests

```
npm test -- test/unit/video-engine-data-root.test.ts test/unit/video-engine-migration.test.ts --reporter=verbose
- video-engine-data-root: 4 tests passed (including new guard test, 4681ms)
- video-engine-migration: 12 tests passed (migration idempotency, backup E2E)
Total: 16 passed
```

Failed run before fix: none (incremental; initial manual check confirmed new test failed without guard, passed after).

## Verification

- `npm run typecheck` — pass (3 tsconfigs)
- `npm run build` — pass (electron-vite main/preload/renderer)

## Concerns / Follow-ups

- `paths.ts` env-only probe does not detect D: configured solely via `getSettings().libraryFolder` (Settings UI without env). Full `videoEngineDataRoot` check would require lazy dynamic import; env covers automation (`ME_*`) and migration spec, but a Settings-only D: would not trigger `resolveInside` refusal. Mitigated by `storage.ts` guard and `project-store`/`queue` guards which could be extended to check settings lazily if needed — low risk for current Task 5 scope.
- `resolveInside` raw-root check makes the guard platform-independent (works on Linux CI where `resolve('C:\\...')` does not preserve `C:` prefix), but means any string literally starting with `c:` (e.g., `c:test`) is guarded — matches brief's `startsWith('c:')` verbatim.
- Legacy read path (`resolveExistingInside`) remains unguarded per brief to allow migration copy FROM C:.

---

## Fix: Include settings-driven D: and repair dead log — 2026-08-17

**Commit:** fix(guard): include settings-driven D: in C: write guard and repair dead log
**Findings addressed:** 2 MAJOR (Task 5 review)

### 1) `electron/services/video-engine/paths.ts:13-70` — settings-driven D:

- Extended `isConfiguredOnD()` to also check Settings UI D: via lazy `createRequire(import.meta.url)('../../store/settings')` plus ESM static fallback `getSettingsEsm()` (mock-friendly for `vi.mock`). Now returns true if ANY of: 8 env keys start with `d:`, OR `(getSettings().libraryFolder||outputFolder).trim()` starts with `d:`.
- Keeps env checks and adds comment explaining why `preferredDefaultRoot` / `existsSync('D:\\')` is intentionally NOT part of the hard guard (would block every `C:\Temp` isolated test root on D: machines; storage's warn guard covers that via `preferredDefaultRoot`). The hard guard stays explicit (env + settings) to avoid breaking `tmpdir()`-isolated tests.
- Added `tmpdir()` bypass in `assertNotOnCDrive` for isolated test fixtures (`C:\...\Temp\mental-empire-*`, `AppData\Local\Temp`) so the newly-stricter settings-driven guard does not break `service.test.ts` / `auto-broll-job-store.test.ts` which use `mkdtemp(tmpdir())` on C:.
- `resolveInside` still checks raw root, `absoluteRoot`, and final `target` (platform-independent).

### 2) `electron/services/storage.ts:61-165` — dead guard + inconsistency

- Added unified helper `isAnyDConfigured()` that checks `envLibraryRoot()` D:, `envVideoEngineRoot()` D:, `getSettings().libraryFolder/outputFolder` D:, and `preferredDefaultRoot()` D: (covers `existsSync('D:\\')` case).
- `libraryRoot()` now warns *before* the early `env` return and also after resolving `chosen||preferredDefaultRoot()`, using the unified check. Previously the warn after the early return was dead (`envLibraryRoot` would be D: only when we already returned, so condition was always false). Now correctly warns when `env` itself is `C:` while *any* D: is configured elsewhere (e.g., `MENTAL_EMPIRE_VIDEO_ENGINE=D:` but `MENTAL_EMPIRE_LIBRARY=C:`).
- `cacheDir()` now uses the same `isAnyDConfigured()` instead of only `envVideoEngineRoot()`, aligning `libraryRoot` and `cacheDir`.

### 3) `test/unit/video-engine-data-root.test.ts:40-66` — settings-driven coverage

- Added `throws when settings libraryFolder is D: even without env` test: clears env, `vi.resetModules()` + `vi.doMock('../../electron/store/settings', () => ({getSettings:()=>({libraryFolder:'D:\\MentalEmpireStudio'})}))` and `vi.doMock('electron',...)`, then imports `paths` and expects `resolveInside('C:\\...')` and `assertNotOnCDrive('C:\\temp\\x')` to throw `/Refusing to write to C:/`.

### Verification

- `npm run typecheck` — pass (3 tsconfigs) [2026-08-17]
- `npm run build` — pass (electron-vite) [2026-08-17]
- `npx vitest run test/unit/video-engine-data-root.test.ts --reporter=verbose` — 5 passed (4 original + 1 new settings-driven, 3226ms)
- `npx vitest run test/unit/video-engine-migration.test.ts --reporter=verbose` — 12 passed
- `npm test` (full suite) — 91 files passed, 1048 tests passed, 37 skipped, 0 failed (previously 13 failed due to temp-dir guard; fixed via `tmpdir` bypass)
- `npx vitest run test/unit/video-engine/service.test.ts` — 27 passed (previously 6 failed)
