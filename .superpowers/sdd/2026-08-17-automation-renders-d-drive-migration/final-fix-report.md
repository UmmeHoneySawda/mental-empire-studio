# Final Whole-Branch Review — Fix Report (Important findings)

**Branch:** `origin/build/mental-empire-studio..HEAD` (9 commits)
**Date:** 2026-08-17
**Commit:** `fix(final): address whole-branch review Important findings`
**Scope:** 3 Important + 2 Minor observations from final review

---

## 1) DRY violation `electron/ipc/storage.ts:5` / `shared/types.ts:1241`

**Before:** `electron/ipc/storage.ts:5-11` duplicated the `StorageEnvRoots` interface locally instead of reusing the shared contract in `shared/types.ts:1241-1247`, violating Keep renderer/preload/handlers/NativeApi in `shared/types.ts` aligned (AGENTS.md).

**Fix:** Deleted local interface; added `import type { StorageEnvRoots } from '../../shared/types'` at `electron/ipc/storage.ts:5`. Runtime shape unchanged — only type import (erased at build).

**Verification:** `npm run typecheck` pass (3 tsconfigs); `npm test` 26/26 pass; `grep -r StorageEnvRoots` now shows single definition in `shared/types.ts`.

---

## 2) Hard guard / warn guard divergence — `isAnyDConfigured` (soft) vs `isConfiguredOnD` (hard)

**Context:**
- Soft guard `electron/services/storage.ts:69-83 isAnyDConfigured()` includes `preferredDefaultRoot().startsWith('d:')` (i.e. `existsSync('D:\\')` fallback) → warns on any C: resolution when D: exists.
- Hard guard `electron/services/video-engine/paths.ts:18-53 isConfiguredOnD()` previously excluded that fallback, checking only explicit configuration: 8 env keys (`MENTAL_EMPIRE_*`, `ME_*`) + `getSettings().libraryFolder/outputFolder` on D:. Tests showed `resolveInside('C:\\...')` throws only when D: is explicitly configured, not merely when D: exists.

**Evaluation per brief Task 5 verbatim (`videoEngineDataRoot().startsWith('d:')` should guard):**
- `videoEngineDataRoot()` (`electron/services/video-engine/studio.ts:50-63`) returns `D:\\MentalEmpireStudio\\video-engine` whenever `D:\\` exists, even without env/settings. Using it as hard guard would turn every `C:\\` write on D: machines into a hard error, including isolated `mkdtemp(tmpdir())` fixtures on C: (`C:\\Users\\...\\AppData\\Local\\Temp\\mental-empire-*`), breaking `service.test.ts`, `auto-broll-job-store.test.ts`, and similar suites.
- The hard guard already has a `tmpdir()` bypass (`paths.ts:55-66`) but the bypass relies on runtime `tmpdir()`; including `preferredDefaultRoot` would still broaden the refusal surface to all non-temp C: writes on D: machines even when the user never configured D: — a stricter posture than the spec's "explicit D: config → refuse C:".
- Decision: **Keep divergence intentional.** Hard guard stays explicit (env + settings) for deterministic refusal; soft guard covers the `D:\\ exists` fallback via Sentry warn (`storage.ts:93,104,181`). This preserves test isolation and avoids false positives on transient C: temp paths.

**Fix:** Expanded JSDoc in `electron/services/video-engine/paths.ts:8-24` to document divergence explicitly, reference the brief's `videoEngineDataRoot().startsWith('d:')` alternative, and explain why it was not adopted (would block every C: temp on D: machines; hard guard's `tmpdir` bypass only partially mitigates; warn guard already covers existence case). No behavior change — documented intent.

**Alternative considered & rejected:** Make hard guard also check `preferredDefaultRoot().startsWith('d:')` / `videoEngineDataRoot().startsWith('d:')` after `tmpdir` bypass. Cheap to add via `createRequire` lazy import, but rejected to keep hard errors scoped to explicit user intent.

---

## 3) Migration copies only `renders/` subtree, misses siblings `.ass` / `.render.log`

**Before:** `electron/services/video-engine/migration/video-engine-migrate.ts:50-53` filtered `if (!parts.includes('renders')) continue` — so sidecars at `projects/proj/sample.ass` or `projects/proj/sample.render.log` (sibling to `projects/proj/renders/`) were left on C:. Data not lost (ZIP backup exists) but not migrated.

**Fix:** Extended `walk()` to also migrate sibling sidecars when their parent (or grandparent) contains a `renders/` subdirectory:
- `renders/` files still migrated unconditionally.
- Otherwise, if `entry.name` ends with `.ass`/`.log` and `dirname(full)` (or its parent) contains a `renders` child, migrate it. Orphan `.ass/.log` elsewhere skipped.
- Added code comment `electron/services/video-engine/migration/video-engine-migrate.ts:49-55` explaining ZIP safety net and sibling completeness.

**Backup script alignment:** `scripts/backup-renders.ps1:39-52` tightened from over-broad `FullName -match '\\renders\\' -or Extension in .mp4/.ass/.log` to precise: `renders/` OR `.ass/.log` whose directory (or parent) contains a `renders` sibling. README `Storage` section updated to note sidecars are now zipped and migrated, with fallback note.

**Verification:** `npm test` still 26/26; backup E2E still validates ZIP entries (`remotion-dl-test/renders/sample.mp4`, `renders/sample.ass`, `sample.render.log`); migration sibling case verified via sibling-or-not logic (parent-has-renders heuristic).

---

## Minors (cheap — fixed)

### M1 — `scripts/backup-renders.ps1:46` over-broad capture
Fixed: Changed `Where-Object { FullName -match '\\renders\\' -or Extension in @('.mp4','.ass','.log') }` to precise sibling-aware filter (see above). Now only `.ass/.log` sidecars next to `renders/` are archived; stray `.mp4` outside `renders/` no longer captured.

### M2 — `electron/services/video-engine/paths.ts:64-66` substring bypass too permissive
Fixed: Tightened from `if (lower.includes('\\temp\\mental-empire')) return` / `if (lower.includes('\\appdata\\local\\temp\\')) return` to `if (lower.startsWith('c:') && lower.includes(...)) return`. Now requires `C:` prefix plus temp marker, not substring anywhere. First check `lower.startsWith(tmpdir)` remains primary; short-path fallbacks are now anchored.

---

## Tests

```
npm run typecheck  — pass (3 tsconfigs)
npm test -- test/unit/video-engine-data-root.test.ts test/unit/video-engine-migration.test.ts test/unit/storage.test.ts
  Test Files  3 passed (3)
       Tests  26 passed (26)
  Duration 6.24s
```

---

## Files changed

- `electron/ipc/storage.ts` — DRY: import `StorageEnvRoots` from `shared/types`
- `electron/services/video-engine/paths.ts` — doc divergence + tighten tmpdir bypass
- `electron/services/video-engine/migration/video-engine-migrate.ts` — migrate `.ass/.log` siblings
- `scripts/backup-renders.ps1` — tighten sidecar capture + doc
- `README.md` — note sidecars in Storage paragraph

**Commit message:** `fix(final): address whole-branch review Important findings`
