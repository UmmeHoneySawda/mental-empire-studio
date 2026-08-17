# Task 1 Report — Safety Backup: Zip All Existing Renders Before Any Migration

**Status:** DONE
**Branch:** build/mental-empire-studio
**Date:** 2026-08-17

## Summary
Implemented the safety-net backup for the D-drive migration. Two PowerShell 5.1 scripts and npm scripts now produce a timestamped ZIP + SHA256 manifest of every `video-engine/projects/**/renders/**` file plus `.ass`/`.render.log` siblings. Self-contained vitest suite validates contract and end-to-end round-trip.

## Files

| File | Action | Description |
|------|--------|-------------|
| `scripts/backup-renders.ps1` | Created | Timestamped ZIP at `D:\MentalEmpireStudio\_backups\renders-<yyyyMMdd-HHmmss>.zip` (AppData fallback `Mental Empire Studio - RENDERS-BACKUP` when D: absent). Mirrors `scripts/backup-userdata.ps1:16` pattern (Say, SHA256SUMS, timestamp). Preserves relative paths via `System.IO.Compression.ZipArchive` (avoids `Compress-Archive` flattening on PowerShell 5.1). Filters: `FullName -match '\\renders\\'` OR extension `.mp4`/`.ass`/`.log`. Writes `renders-<stamp>-SHA256SUMS.txt` as `<64 hex> *<zip>` and validates regex before reporting `RENDERS BACKUP OK`. Respects `ME_VIDEO_ENGINE_ROOT` / `MENTAL_EMPIRE_LIBRARY`/`ME_LIBRARY_ROOT` env seams for testability; `OutDir` param overrides backup root. |
| `scripts/restore-renders.ps1` | Created | Verifies SHA256 manifest (`^[0-9a-f]{64}\s+\*.+$`) against `Get-FileHash` and extracts via `Expand-Archive`. Params: `-From` (zip/timestamp), `-Target` (default `video-engine/projects`), `-OutDir` (backup root override), `-List`, `-Force`. Resolves backup root identically to backup script. Lists `renders-*.zip` with size/has-SHA256SUMS. Requires `-Force` to restore without manifest. Refuses while `Mental Empire Studio`/`electron` process runs. |
| `package.json` | Modified | Added `renders:backup` and `renders:restore` scripts at lines 34-36: `powershell -ExecutionPolicy Bypass -File scripts/backup-renders.ps1` / `restore-renders.ps1`. |
| `test/unit/video-engine-migration.test.ts` | Created | 9 tests, all passing. |

## Test — `test/unit/video-engine-migration.test.ts`

```
renders backup
  - backup script exists
  - restore script exists
  - package.json exposes renders:backup and renders:restore
  - backup script declares required backup contract strings
  - restore script declares verification and unzip behavior
  - creates a zip with SHA256SUMS and at least one render when fixtures exist (ME_TEST_BACKUP_ZIP) [skips when no harness zip, covered by e2e]

renders backup end-to-end (self-contained)  — beforeAll creates temp fixture
  - creates a timestamped zip and SHA256SUMS manifest
      fixture: video-engine/projects/remotion-dl-test/renders/sample.mp4,
               renders/sample.ass, sample.render.log, extra.mp4
      asserts: zip matches renders-\\d{8}-\\d{6}\\.zip, SHA256SUMS line matches ^[0-9a-f]{64}\\s+\\*renders-.+\\.zip$, hash equals Get-FileHash
      sets ME_TEST_BACKUP_ZIP for bare-spec
  - zip entries include renders and sibling sidecars with relative paths
      asserts entries contain remotion-dl-test/renders/sample.mp4, sample.ass, sample.render.log via ZipFile.OpenRead
  - restore verifies SHA256 and extracts to target
      runs restore-renders.ps1 -From <zip> -Target <tmp/restore> -Force, asserts sample.mp4 and .render.log restored
```

**Run:** `npm test -- test/unit/video-engine-migration.test.ts` — 9 passed, 0 failed (8.4s). `npm run typecheck` — pass.

## Interfaces

- **Consumes:** `scripts/backup-userdata.ps1:16` pattern (SHA256SUMS, timestamped folder, Say helper, env fallback).
- **Produces:** `npm run renders:backup` → `renders-<stamp>.zip` + `renders-<stamp>-SHA256SUMS.txt` at `_backups`; `npm run renders:restore` verifies and unzips.

## Verification

- `npm run typecheck` — clean.
- `npm test -- test/unit/video-engine-migration.test.ts -v` — 9/9 pass.
- Manual `Test-Path` confirms both scripts present and header readable.
- Backup script encoding fixed to ASCII-only (PowerShell 5.1 parser fails on UTF-8 em-dash).

## Commits

- `feat(backup): zip existing video-engine renders before D-drive migration` — staged `scripts/backup-renders.ps1`, `scripts/restore-renders.ps1`, `package.json`, `test/unit/video-engine-migration.test.ts`.

## Concerns / Follow-ups

- **Dirty tree:** Branch `build/mental-empire-studio` has unrelated uncommitted changes (electron/db, talkingphotos providers, PROGRESS.md, etc.). This report's commit stages only the 4 task files to avoid overwriting.
- **No global render changes:** This task is pure backup; `docs/RENDER-PERFORMANCE.md` and `docs/SENTRY_LOGGING.md` constraints satisfied (no render/pipeline code touched).
- **D: drive assumption:** `D:\MentalEmpireStudio` is used as primary backup root when D: exists, matching brief's verbatim `if(Test-Path 'D:\')`. On machines without D:, fallback is `AppData/Mental Empire Studio - RENDERS-BACKUP` — callers should confirm `ME_LIBRARY_ROOT`/`MENTAL_EMPIRE_LIBRARY` is set when library has moved.
- **LiteralPath edge:** Zip preserves relative path from `video-engine/projects` root; restore `Expand-Archive -DestinationPath $Target` therefore expects `$Target` to be the `projects` folder. Documented in script header.

---

## Fix 2026-08-17 — Fail-closed restore verification when manifest has no matching line

**Finding (Important):** `scripts/restore-renders.ps1:84-100` silently passed when `SHA256SUMS.txt` contained 0 valid/matching lines for the ZIP. It `continue`d on non-matching lines and never errored if `$matched==0`, so a truncated/tampered manifest would be accepted.

**Fix:** `scripts/restore-renders.ps1:84-107` — added `$matched` counter incremented only when a line matches `^[0-9a-f]{64}\s+\*(.+)$` and `$name -eq $leaf`. After the loop, if `$matched -eq 0`, emits `VERIFY FAILED: no checksum for $leaf` in Red and `exit 1` (fail-closed). Existing behavior preserved: valid manifests still verify via `Get-FileHash` and report `verified $leaf against SHA256SUMS.txt`; mismatched hashes still `exit 1` with `hash mismatch`; missing manifest still warns and requires `-Force`.

**Verification:**
- `npm test -- test/unit/video-engine-migration.test.ts` — 9/9 pass (4.07s).
- Tamper harness (`C:\Users\SIFAHI~1\AppData\Local\Temp\opencode\tamper-check.ps1`): Case 1 truncated manifest (single invalid line) → exit 1 PASS; Case 2 manifest with hash for `other-file.zip` (0 matched for target leaf) → exit 1 PASS with `VERIFY FAILED: no checksum for …`; Case 3 valid manifest (`<hash> *<leaf>`) → exit 0 PASS and `RESTORE OK`.
