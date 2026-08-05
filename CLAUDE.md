# CLAUDE.md — working notes for agents

Mental Empire Studio: Electron + React + TS desktop app for faceless-YouTube automation. Read
`README.md` for the product and `PLAN.md` for the full milestone history (M0–M8, all complete).

## The owned-channel ↔ source edge (read before touching channels, Publish, or Automation)

**`source_channels.linkedMyChannelId` is the single authoritative edge.** It is the FK on the
many side, so one owned channel may be fed by several sources, and it is the direction
`ipc/publish.ts`, `automation-supervisor.ts`, `Download.tsx` and `SourcePickerModal.tsx` read.

`my_channels.linkedSourceId` + `my_channels.source` are a **maintained primary-source cache**,
not a source of truth. `writeSourceOwner` in `electron/db/index.ts` is the only writer of the
edge and it refreshes that cache on both sides of a move; `migrate()` back-fills the edge from
the cache once, idempotently. Never write either column directly — go through
`setSourceLinkedMyChannel` (attach/detach one) or `setChannelSource` (make one the only one).
Read with `repos.sourcesForMyChannel(id)`, not by filtering `sourceChannels()`.

This replaced two independent nullable scalars with two one-way setters and no invariant, where
the UI wrote the cache and every consumer read the edge — which had no writer at all, so it was
permanently NULL and linking a source did nothing observable. Regression suite:
`test/unit/channel-source-link.test.ts` (8 tests); UI: `node scripts/e2e-mychannels.mjs`.

**Known remaining divergence:** `src/screens/Profiles.tsx:226` still ORs the edge with the cache
(`s.linkedMyChannelId === id || s.id === ch.linkedSourceId`) while `MyChannels.tsx` reads only
the edge. Now that the cache is always maintained, collapse it to the edge.

**DB-backed vitest suites skip silently** — `better-sqlite3` is built for Electron ABI 128 and
plain Node needs 127, so the guard in those files short-circuits. To actually run them:
`npm rebuild better-sqlite3` → run vitest → `npx @electron/rebuild -f -w better-sqlite3`.
The last step is REQUIRED; leaving the node ABI in place breaks the app.

## Commands

```bash
npm install                # postinstall is NOT auto-run; rebuild native deps explicitly:
npx @electron/rebuild -f -w better-sqlite3   # match better-sqlite3 to Electron's ABI
npm run typecheck          # tsc on tsconfig.json (renderer) + tsconfig.node.json (electron/shared)
npm run build              # electron-vite production build → out/
npm run fetch:bin          # vendor yt-dlp + ffmpeg(from PATH) → resources/bin (gitignored)
npm run dist:dir           # unpacked packaged app (no installer)
```

Run the built app locally: `xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js`
(headless sandbox needs `--no-sandbox`).

## Architecture map

- **Main**: `electron/main.ts` (window, tray, login-item, scheduler, smokes), `electron/ipc/*`
  (`register.ts` wires all handlers), `electron/services/*` (pure-ish logic), `electron/db/index.ts`
  (better-sqlite3 + `migrate()` + `Repositories`), `electron/store/settings.ts` (electron-store).
- **Bridge**: `electron/preload.ts` exposes a typed `window.api` (contextIsolation on, no nodeIntegration).
  The contract is `NativeApi` in `shared/types.ts` — keep preload + handlers + `NativeApi` in sync.
- **Renderer**: `src/screens/*`, `src/store/useStore.ts` (UI/appearance/thumbnail-editor state) +
  `src/store/useData.ts` (live DB/IPC data), `src/features/thumbnail-editor/*` (Konva).
- **Shared**: `shared/types.ts` (domain + IPC types), `shared/thumbnail.ts` (pure auto-arrange).

## Feature map — screen → what it does → backend

Each `src/screens/*.tsx` is a nav destination; each pairs with specific `electron/services/*` +
`electron/ipc/*` files. Use this to find the right subsystem before grepping blind.

| Screen | Does | Backend |
|---|---|---|
| `Home.tsx` | Dashboard/overview | `useData.ts` (aggregates) |
| `MyChannels.tsx` | Owned-channel ↔ source-channel mapping (many sources per channel) | `electron/db/index.ts` (schema/queries/`writeSourceOwner`), `ipc/scrape.ts` (`sources:setLinkedMyChannel`, `scrape:refreshChannel`, mapping recompute), `ipc/register.ts` — NOT `ipc/library.ts` (that file only registers library file-reorg handlers); see the edge section above and the `mental-empire-channels` skill |
| `Niches.tsx` | Browse/pick niches, discover source channels | `services/niche.ts`, `services/scraper.ts`, `ipc/niche.ts` |
| `Profiles.tsx` | Automation profiles (what to scrape/generate on a schedule) | `services/automation-supervisor.ts`, `services/scheduler.ts`, `ipc/automation.ts` |
| `Download.tsx` | Source-video download queue | `services/downloader.ts`, `services/ytdlp.ts`, `ipc/download.ts` |
| `Compose.tsx` | Project library + the timeline editor. One engine, no switch: the header lamp is a readout and "← Library" (`useData.closeProject`) is the way back out (see "Compose → Remotion" below) | `src/features/video-studio/editor/` (the only live path); `src/features/video-studio/{panels,timeline,preview,store,ui}` and `src/features/compose/` are orphaned Classic code — only `store/useVideoStudio` is still live, for Compose's lamp and RenderQueue's jobs; `ipc/compose.ts`, `ipc/video-engine.ts` |
| `Thumbnails.tsx` | Konva-based thumbnail editor + batch generation | `src/features/thumbnail-editor/`, `shared/thumbnail.ts` (auto-arrange), `ipc/thumbnails.ts` |
| `RenderQueue.tsx` | Batch/queued GPU render jobs | `services/render.ts`, `services/engine/` — GPU-only by design, no CPU fallback: encode failures must fail visibly, not silently degrade — `ipc/batch.ts`, `ipc/render.ts` |
| `TalkingVideo.tsx` + `talking-video/` | Talking-photo/avatar video generation | `ipc/talkingphotos.ts`; see `docs/TALKING_VIDEO_REDESIGN.md` |
| `Publish.tsx` | "Ready to Upload" — hand-off, NOT an uploader. Lists finished renders + the upload status persisted by `runUploadDetection`, reveals files, and native-drags them into a browser upload tab. There is no uploader, no OAuth, no network call on this path; nav key stays `publish` because `settings.defaultScreen` persists it | `services/uploads-detect.ts` (the only upload-status writer — never recompute it here), `ipc/publish.ts` |
| `Settings.tsx` | App settings, API keys | `store/settings.ts` (electron-store) |
| `src/features/automation/` | Batch execution + template-creator UI for automations | `ipc/automation.ts`, `ipc/batch.ts` |

Cross-cutting pipeline services (not screen-specific): `services/audio.ts`/`transcribe.ts`/`captions.ts`
(caption pipeline), `services/broll.ts`/`images.ts`/`effects.ts`/`sfx.ts` (b-roll/visual assets),
`services/asset-library.ts`/`asset-hash.ts`/`storage.ts` (asset dedup + storage), `services/sentry.ts`
(observability, see Sentry note above).

Prefer `codebase-memory-mcp` (`search_code`, `get_architecture`, `trace_path`) over raw grep for finding
where a feature actually lives — it's indexed and kept current via a SessionStart hook.

## Conventions

- **Adding an IPC method**: add to `NativeApi` (`shared/types.ts`) → handler in `electron/ipc/*` (register
  in `register.ts`) → method in `electron/preload.ts`. Export orchestration fns for the smoke harness.
- **DB changes**: add a column via `ensureColumn(...)` in `migrate()` (idempotent), never edit old
  `CREATE TABLE`. Map rows in the repo with bool coercion; default legacy nulls.
- **Native modules** (better-sqlite3) are externalized (`externalizeDepsPlugin`) + `asarUnpack`'d.
- **Fonts** are self-hosted via `@fontsource/*` imported in `src/main.tsx` (no CDN; CSP is `font-src
  'self'`).
- **Sentry logging (required):** read `docs/SENTRY_LOGGING.md`. Instrument new pipeline / TalkingPhotos /
  download / render / automation paths with `sentryLog` from `electron/services/sentry.ts`. Prefer wide
  events + snake_case attributes; never log secrets. When debugging user-reported failures, search
  **Sentry Issues + Logs** first (org `buft`, region `de`).

## Testing model (important)

The sandbox blocks YouTube and lacks ffmpeg/whisper, so verification is **fixture + dry-run based**, run
headlessly under `xvfb-run`:

- `ME_SMOKE=1|m3|m4|m5|m6|m7` → each milestone's `runSmokeM*` in `electron/main.ts` drives the real code
  against `test/fixtures/` and asserts; prints `SMOKE…_OK`.
- Seams: `ME_YTDLP_FIXTURE` (recorded scrape JSON), `ME_DOWNLOAD_FIXTURE` (sample mp3 copy),
  `ME_WHISPER_FIXTURE` (word timings), `ME_RENDER_FIXTURE` (stub mp4 instead of ffmpeg).
- `ME_SHOOT=<png>` boots the window and screenshots (`ME_BATCH=1` also drives thumbnail batch).
- Always run `npm run typecheck` + `npm run build` + the smokes after a change. CI (`.github/workflows/
  ci.yml`) runs them all.
- **GPU-only smokes, deliberately NOT in the CI loop** (CI is Linux under xvfb with no WebCodecs
  hardware, so they would always fail there — run them on the real machine):
  `ME_SMOKE=broll-gpu-real` (real NVDEC→WebCodecs→NVENC B-roll render) and `ME_SMOKE=gpu-cancel`
  (asserts the Render Queue's Stop actually reaches the WebCodecs encoder: `cancelRender` →
  `cancelGpuRender` → `gpu:cancel` → the worker's frame loop, and the render stops early instead
  of finishing). `ME_SMOKE=m6` cannot cover that — it forces `renderEngine='ffmpeg'`.
- Screen-level Playwright harnesses drive the real app against a throwaway `ME_USERDATA_DIR`:
  `npm run e2e:studio` (the only one in CI), plus `node scripts/e2e-{renderqueue,publish,mychannels,niches}.mjs`.
  `e2e-niches.mjs` warms a real pool offline through `ME_BROLL_LOCAL`. Note how it observes the
  run: the local seam probes with a **synchronous** ffprobe per file, which parks the main
  process — and CDP is served by the main process, so a harness-side poll cannot sample the DOM
  until the run it is watching has already ended. It choreographs the clicks inside the renderer
  and has the renderer record its own DOM instead. Reuse that trick for any main-process-bound
  progress UI.

## Compose → Remotion is the new timeline editor

`src/features/video-studio/editor/` is a from-scratch timeline editor (kimu-style layout,
renderer-owned state, live `<Player>`, no staged preview). It is the **only** editor: it
has one renderer (Remotion), no `rendererId` prop and no engine branches. HyperFrames was
removed from it in M3 along with `VideoStudio.tsx`, the last thing that mounted it that
way. The engine's hyperframes *renderer* still exists behind
`videoEngine.bindDownload(id, 'hyperframes')` — no UI reaches it.
Read `skills/video-studio-editor/SKILL.md` before
touching it — it documents the one architectural rule (an edit is local and synchronous;
persistence is a debounced `videoEngine.saveProject`) and the traps, notably that
`TransitionSeries` rejects any child that is not literally one of its own components.

Test it live, not with smokes: `node scripts/studio-live.mjs --port 9222` then
`playwright-cli -s=mes attach --cdp=http://localhost:9222`, from **PowerShell**.

## Video Studio E2E

`npm run e2e:studio` drives the real Electron app with Playwright against a throwaway
profile (`ME_USERDATA_DIR`, set in `electron/main.ts` — a plain relocation, no reset). It
catches wiring bugs unit tests and a green build cannot see: a preload method with no
`ipcMain.handle` behind it, a panel that throws on mount, a renderer that fails to report.
Requires `npm run build` first. `--keep` leaves the scratch profile. It drives the Remotion
renderer — the only one Compose offers.

`ME_E2E_SEED_AUDIO` (with `ME_E2E_SEED_ID` / `ME_E2E_SEED_TITLE`) puts one downloaded clip
in the database at startup — a fixture seam like `ME_YTDLP_FIXTURE`, and it hard-exits
unless userData has been relocated. That is what gives the run something to edit: it binds
a project, imports stills, cycles them across the timeline, crossfades two, renames,
rebuilds the preview twice and preflights, all through real IPC.

It does not render a file — that needs NVENC and minutes; the milestone smokes cover it.

## Build trap: `Unterminated string literal` in `out/main/main.js`

If `npm run build` fails with `main.js:<line>:<col>: ERROR: Unterminated string literal`
pointing at innocent-looking code, the source is fine — electron-vite's `esmShimPlugin`
injected its CommonJS shim in the wrong place. It picks the spot by regex-scanning the
built chunk for the *last* `import … '…'` and appending after it, so **a string literal
whose final word is `import`** (e.g. `sentryLog.info('Studio caption import', …)`) emits as
`… import"` and is mistaken for a static import. The shim then lands mid-expression.

Fix: reword the literal so `import` is not the last word before the closing quote. To
confirm, add a `renderChunk: { order: 'pre' }` plugin to `main.plugins` in
`electron.vite.config.ts` that dumps `code` to a file, then look at the reported line.

## User data is sacred — snapshot before, verify after (REQUIRED)

The user's channels, sources, automations, downloads, and API keys live in
`%APPDATA%\Mental Empire Studio\` (`mental-empire.db` + `mental-empire-settings.json`). Agents have
wiped them before. **Before touching anything that runs the app, migrates the DB, or writes
settings:**

```bash
npm run userdata:backup
```

That writes `%APPDATA%\Mental Empire Studio - CLAUDE-BACKUP-<stamp>\` with a `SHA256SUMS.txt`.
When the task is done, confirm the user's data survived — and if it did not, put it back:

```bash
npm run userdata:list
npm run userdata:restore
```

`userdata:restore` snapshots the current state first (so a restore is reversible), refuses to run
while the app is open (a live WAL would overwrite the restored DB), clears stale WAL/SHM, and
verifies against `SHA256SUMS.txt`. Pass `-From <stamp>` to pick a specific point.

Never run a destructive smoke (`ME_SMOKE`, `ME_SHOOT`) without `ME_SMOKE_USERDATA_DIR` pointing at a
throwaway directory — `electron/services/smokeSafety.ts` hard-exits otherwise, and that guard exists
because the harness calls `resetAll()`. Do not weaken it.

## Git / push

Branch: `build/mental-empire-studio`. `git push origin build/mental-empire-studio` works directly
(verified 2026-07-30). Only if a proxy blocks it, fall back to the GitHub Data API
(`scratchpad/push_m2.py` pattern): commit locally, then create blobs/tree/commit and update the
branch ref via the API.

Installed agent-skill content (`.agents/skills/`, `.claude/skills/*`) is git-ignored — the
`.claude/skills` entries are absolute symlinks into the checkout, so they are machine-specific.
`skills-lock.json` pins every source + hash and IS tracked; `npx skills install` reproduces the tree.
