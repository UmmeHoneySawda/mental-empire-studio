# Whole-Codebase Review & Solutions Plan — 2026-06-29

A thorough pass over the **entire** codebase (main process, preload, IPC, services,
render engine, stores, screens, shared logic) beyond the already-shipped fixes
(`PRIORITY-FIXES-2026-06-29.md`, `ADDITIONAL-IMPROVEMENTS-2026-06-29.md`). Each finding
has a **severity**, **location**, **root cause**, and a **concrete, step-by-step fix**.

> Severity: 🔴 high (correctness/data-loss/security) · 🟠 medium (reliability/perf/UX) · 🟡 low (polish/tech-debt)

## Executive summary

The codebase is well-structured and unusually well-documented, with a strong fixture-based
smoke harness. The biggest *new* risks are **lifecycle/resource** issues that only bite in
real long-running use (DB not closed on tray-quit, hung downloads with no timeout, temp-file
growth) and a few **security-hardening** gaps in the main process. There are also clear
**UX/architecture** improvements (per-project thumbnails, splitting the 1480-line `main.ts`).
None block shipping, but the 🔴 items below should land before a wider release.

Counts: 3 🔴 · 9 🟠 · 8 🟡.

---

## A. Correctness & reliability

### A1 🔴 Database is never closed on the common (tray) quit path
**Location:** `electron/main.ts` — `app.on('before-quit')` and `app.on('window-all-closed')`.
**Root cause:** `closeDatabase()` is only called in `window-all-closed` **and only when the
tray is disabled**. With the tray enabled (the default for auto-watch users), closing the
window hides it; the real quit goes through the tray's "Quit" → `app.quit()` → `before-quit`,
which calls `scheduler.stop()` but **never** `closeDatabase()`. better-sqlite3 in WAL mode
relies on a clean close to checkpoint; an abrupt exit can leave a growing `-wal` file and, in
the worst case, risk a partial write on power loss.
**Fix:**
1. In `before-quit`, call `closeDatabase()` after `scheduler.stop()`:
   ```ts
   app.on('before-quit', () => {
     isQuitting = true
     scheduler.stop()
     try { closeDatabase() } catch { /* already closed */ }
   })
   ```
2. Make `closeDatabase()` idempotent (guard if the handle is already closed) so the
   `window-all-closed` path can't double-close.
3. Verify with a manual run: enable tray, quit from the tray, confirm `-wal`/`-shm` are
   checkpointed away on next launch.

### A2 🔴 yt-dlp downloads have no timeout / stall watchdog
**Location:** `electron/services/downloader.ts` — `runYtdlpDownload`.
**Root cause:** the spawned `yt-dlp` is only resolved on `close`/`error`. If the process
hangs (network stall, throttling, an interactive prompt), it never resolves: the download
row stays "Downloading" forever, and because `startDownloads` (and the profile pipeline)
awaits sequentially, a single hang **stalls the whole batch / auto-watch run** indefinitely.
**Fix:**
1. Add a no-progress watchdog: track the last `onProgress`/stdout time; if no output for
   `N` seconds (e.g. 120s configurable), `child.kill('SIGKILL')` and `reject(new Error('download timed out'))`.
2. Add a hard ceiling (e.g. 30 min) per download as a backstop.
3. Pass `--socket-timeout 30` and `--retries 3` to yt-dlp so the binary self-recovers from
   transient stalls before the watchdog fires.
4. Surface "timed out" as a `Failed` stage with a resume affordance (already supported).

### A3 🟠 Scheduler ticks can overlap (no re-entrancy guard)
**Location:** `electron/services/scheduler.ts` — `start()` uses `setInterval(() => void tick())`.
**Root cause:** `tick()` is async and can take longer than the interval (many watched
profiles × scrape + download + render). `setInterval` doesn't await, so a slow tick overlaps
the next, doubling scrape load and `checkReminders()` work. `runProfile` is guarded per
profile, but the scheduler itself is not.
**Fix:**
1. Add a module-level `let ticking = false`; at the top of `tick()` return early if `ticking`,
   set it true in a `try`, reset in `finally`.
2. Prefer a self-scheduling `setTimeout` loop over `setInterval` so the next tick is queued
   only after the previous finishes:
   ```ts
   function loop() { timer = setTimeout(async () => { await tick(); loop() }, interval) }
   ```

### A4 🟠 Weekly/monthly goal progress is never auto-tracked
**Location:** `electron/services/notify.ts` (`behindPace`), `src/screens/MyChannels.tsx`,
DB `weekDone`/`monthDone`.
**Root cause:** `behindPace` compares `weekDone < weekGoal`, but `weekDone`/`monthDone` are
only ever seeded/edited manually — nothing increments them when a video is uploaded or a
render completes. So the "behind pace" desktop reminder is driven by numbers that don't move,
making the whole reminder feature misleading.
**Fix (pick one):**
- **Automatic:** when channel mapping runs (`persistScrape` → `setChannelMapping`), derive
  `weekDone`/`monthDone` from uploads whose `publishedAt` falls in the current week/month, and
  persist them. This makes the goal real and hands-free.
- **Manual (smaller):** relabel the field as a manual counter with +/- controls and drop the
  automatic "behind pace" notification, so nothing claims to be automatic that isn't.

### A5 🟠 `download` quantity is unbounded
**Location:** `src/screens/Download.tsx` — `qty` state; `sourceVideos` flat path uses `count`
directly for Latest/Oldest.
**Root cause:** the QTY input does `Math.max(1, parseInt())` with no upper clamp, so a user can
request thousands; Latest/Oldest pass it straight to yt-dlp's flat fetch.
**Fix:** clamp to a sane max (e.g. `Math.min(50, …)`) in the input handler and document the
limit in the UI; the Popular path already caps its pool at 40.

### A6 🟡 Stale download cancel-intent
**Location:** `electron/services/downloader.ts` — `cancelDownload`/`consumeCancel`.
**Root cause:** `cancelDownload(id)` adds to `cancelIntents` even when no child is running and
returns `false`; the intent is only cleared on the next `close`/`error`. A later download
reusing the same id would be cancelled on its first close check.
**Fix:** only record the intent when a child is actually running, or clear the intent at the
start of `downloadAudio` for that id.

---

## B. Security & hardening

### B1 🔴 External-URL handling has no protocol allowlist or navigation guard
**Location:** `electron/main.ts` — `webContents.setWindowOpenHandler` opens **every** URL via
`shell.openExternal(url)`; there is **no `will-navigate` handler**.
**Root cause:** `shell.openExternal` will happily launch non-web protocols (`file:`, `smb:`,
custom handlers). If any attacker-influenced string (e.g. scraped metadata) ever becomes a
clickable link or a programmatic `window.open`, it could trigger an unexpected protocol
launch. Separately, nothing stops the main renderer from being navigated away from the app
(e.g. a stray `location.href`), which would wipe in-memory state.
**Fix:**
1. Allowlist in the window-open handler:
   ```ts
   mainWindow.webContents.setWindowOpenHandler(({ url }) => {
     if (/^https?:\/\//i.test(url)) shell.openExternal(url)
     return { action: 'deny' }
   })
   ```
2. Block in-app navigation:
   ```ts
   mainWindow.webContents.on('will-navigate', (e, url) => {
     const dev = process.env['ELECTRON_RENDERER_URL']
     if (url !== (dev ?? mainWindow!.webContents.getURL())) e.preventDefault()
   })
   ```

### B2 🟠 No validation on IPC arguments
**Location:** `electron/ipc/register.ts` and all `register*Ipc()` handlers.
**Root cause:** handlers trust whatever the renderer sends (file paths for `setImages` /
`writePng` / `pathForFile`, settings patch shape, ids). The renderer is first-party and
contextIsolation is on, so this is **defense-in-depth**, not an open hole — but a renderer
compromise (XSS via some future remote content) would have unrestricted main-process file
access.
**Fix:**
1. Add lightweight validation at the boundary (zod or hand-rolled guards): assert ids are
   strings, paths exist / are under expected roots, settings patches match the schema.
2. For path-accepting handlers, reject paths outside the output folder / user-picked dirs
   where feasible.

### B3 🟡 CSP still allows `'unsafe-inline'` styles
**Location:** `index.html` CSP `style-src 'self' 'unsafe-inline'`.
**Root cause:** the UI is built almost entirely with inline `style={{…}}`, which requires
`'unsafe-inline'`. Removing it is impractical without a styling refactor.
**Fix:** accept for now; if the inline-style → token/class refactor (D-series) happens, drop
`'unsafe-inline'` then. Document the rationale next to the CSP.

---

## C. Performance & resources

### C1 🟠 Temp files accumulate without cleanup
**Location:** `electron/services/sfx.ts` (`me-sfx/sfx-*.wav`), `engine/audio-master.ts`
(`.<ts>.master.mp4` on error), preview mp4s (`compose.ts`), b-roll segment dirs (`queue.ts`).
**Root cause:** the SFX track is a **full-length stereo 44.1kHz WAV** written per render and
never deleted — a 20-minute video produces ~200 MB, and every render adds another. The
audio-master temp file leaks if pass 2 throws. Preview mp4s and b-roll caches grow too.
**Fix:**
1. Delete the SFX WAV (and any per-job temp) in a `finally` after `runRender` completes.
2. Wrap `masterAudioTwoPass` pass 2 in try/finally that removes the temp on failure.
3. On app startup, sweep `app.getPath('temp')/me-sfx`, `…/me-*-out` preview dirs older than
   N days.
4. Cap/expire the b-roll normalized-segment cache.

### C2 🟠 ~1000 lines of smoke/e2e/demo harness ship in the production main bundle
**Location:** `electron/main.ts` — `runSmokeTest`, `runSmokeM3..M7`, `runSmokeE2E`,
`runSmokeBrollReal`, `runDemoRender`, plus ffprobe/frame-stat helpers.
**Root cause:** all of it lives in `main.ts` and is bundled into the packaged app even though
it only runs under `ME_SMOKE`/`ME_DEMO` env flags. It bloats the bundle and enlarges the
attack/maintenance surface.
**Fix:**
1. Move the harness into `electron/dev/smoke.ts` (and `dev/demo.ts`), exporting a single
   `runHarness(kind)` dispatcher.
2. In `main.ts`, lazy-import it only when an env flag is set:
   `if (process.env.ME_SMOKE) { (await import('./dev/smoke')).runHarness(...) }`.
3. Configure electron-vite to drop `electron/dev/**` from production builds (or guard with a
   `import.meta.env` define) so it tree-shakes out entirely.

### C3 🟠 Thumbnail templates store base64 images inside SQLite
**Location:** `src/store/useStore.ts` `saveCurrentTemplate`, DB `thumbnail_templates`.
**Root cause:** a template's layers include `BackgroundLayer.src` / `SubjectLayer.src` as
data URLs. Saving templates with image backgrounds embeds multi-hundred-KB base64 blobs in
the row; several templates bloat the DB and slow `templates()` reads (which load all rows).
**Fix:**
1. On save, write each layer image to `userData/thumb-assets/<hash>.png` and store the file
   path in `src` instead of the data URL.
2. On load/rasterize, read the file (or convert to a `file://`/data URL as needed).
3. Migration: leave existing data-URL templates working (the renderer already handles both).

### C4 🟡 Two full audio passes after the main encode
**Location:** `engine/audio-master.ts` `masterAudioTwoPass` (called by `runRender`).
**Root cause:** loudness mastering decodes the whole file twice (measure, then apply) **after**
the main encode — extra minutes on long videos.
**Fix:** for long-form, fold a single-pass `loudnorm` (or `dynaudnorm`) into the main filter
graph, or skip the second pass when the first-pass measurement is already within tolerance.
Keep two-pass for short videos where quality matters most. (Trade-off — measure before changing.)

### C5 🟡 Renderer initial bundle is ~869 KB
**Location:** build output `out/renderer/assets/index-*.js`.
**Root cause:** Konva + react-konva (the thumbnail editor) load eagerly even though most
sessions start on the Library/Download screens.
**Fix:** `React.lazy` the `Thumbnails` screen + its Konva imports so the editor is a separate
chunk fetched on first navigation. (We already lazy-split `mockApi`.)

---

## D. UX & product

### D1 🟠 The thumbnail editor is global, not per-project
**Location:** `src/store/useStore.ts` (`layers` is a single module-level singleton seeded from
`initialLayers`), `src/screens/Thumbnails.tsx`.
**Root cause:** the canvas/layers aren't tied to a project. Switching the active project does
**not** load that project's saved thumbnail, and "Save thumbnail" writes the current global
canvas to whichever project happens to be active — easy to overwrite the wrong project's
thumbnail, and edits don't persist per project.
**Fix:**
1. When entering Thumbnails from a project (or when `activeProject` changes), load that
   project's saved thumbnail layers (or its locked profile template) into the editor.
2. Persist working layers per project (e.g. a `thumbLayers` JSON column on `projects`, or keep
   a `Map<projectId, layers>` in the store) and restore on switch.
3. Make "Save thumbnail" explicitly show the target project title.

### D2 🟠 Accessibility rollout is incomplete
**Location:** ~45 remaining `div/span onClick` across `Compose`, `Thumbnails`, `Profiles`,
`Settings`, `Library`, `Download`, `RenderQueue`.
**Root cause:** only the Sidebar nav and TitleBar controls got the `clickableProps` helper.
**Fix:** apply `clickableProps()` (already in `components/primitives.tsx`) to the primary
action buttons, toggles, chips, and cards; prefer real `<button>` where layout allows.

### D3 🟡 Inconsistent loading/empty/error affordances
**Location:** various screens.
**Root cause:** some screens show good empty states (Download, RenderQueue); others lack
skeletons during async hydrate and surface errors inconsistently.
**Fix:** add a shared `<Empty>`, `<Loading>`, and `<ErrorNote>` primitive and use them
consistently. Low effort, improves perceived quality.

---

## E. Architecture & tech debt

### E1 🟠 `main.ts` is a 1,480-line monolith
**Location:** `electron/main.ts`.
**Root cause:** window management, tray, IPC bootstrap, screenshot/thumb harness, and all the
milestone smoke tests live in one file.
**Fix:** split into `electron/window.ts` (create/show/tray/quit), `electron/bootstrap.ts`
(persistence + ipc init), and `electron/dev/*` (harness, per C2). `main.ts` becomes a thin
entry that wires them.

### E2 🟡 Pervasive inline styles
**Location:** every screen/component.
**Root cause:** all styling is inline `style={{…}}` objects, which makes files long, blocks
removing CSP `'unsafe-inline'`, and prevents theming/reuse.
**Fix (incremental):** extract the most-repeated patterns (cards, rows, chips, buttons,
sliders) into styled primitives or CSS-module classes driven by the existing CSS tokens.

### E3 🟡 Loose DB-row typing at the boundary
**Location:** `electron/db/index.ts` `rowToProject`/`rowToProfile` (`...(r as unknown as T)`).
**Root cause:** rows are spread then a few fields overridden; new columns pass through
untyped. (`coerceNum` was added for numerics, but strings/enums are still trusted.)
**Fix:** introduce a zod schema (or explicit field-by-field mapping) per table and parse rows
through it at the boundary, so the DB shape is validated once and the rest of the app gets
guaranteed types.

### E4 🟡 Test coverage beyond pure functions
**Location:** `test/unit/*` (added), services/db untested except via the env-gated smoke.
**Fix:** add fast unit tests for the DB repos against an in-memory better-sqlite3, for
`matchDownloadsToUploads`, `planCoverage`, and the settings encrypt/decrypt round-trip; wire
them into CI alongside `npm test`.

---

## Prioritized roadmap

**Ship before wider release (🔴 + top 🟠):**
1. A1 close DB on tray-quit · A2 download timeout/watchdog · B1 external-URL allowlist + navigation guard
2. A3 scheduler re-entrancy · C1 temp-file cleanup · C2 strip smoke harness from prod bundle

**Next (reliability + UX):**
3. A4 real goal tracking · A5 qty clamp · C3 template image files · D1 per-project thumbnails

**Then (polish + debt):**
4. B2 IPC validation · C4/C5 audio + bundle perf · D2 a11y · E1 split main.ts · E3 zod DB boundary · E4 tests

**Quick wins (≤ ~30 min each):** A1, A5, A6, B1, C2 (dispatcher), D2 (incremental).
