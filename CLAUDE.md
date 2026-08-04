# CLAUDE.md — working notes for agents

Mental Empire Studio: Electron + React + TS desktop app for faceless-YouTube automation. Read
`README.md` for the product and `PLAN.md` for the full milestone history (M0–M8, all complete).

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
| `MyChannels.tsx` | Owned-channel ↔ source-channel mapping | `ipc/library.ts`; see `mental-empire-channels` skill |
| `Niches.tsx` | Browse/pick niches, discover source channels | `services/niche.ts`, `services/scraper.ts`, `ipc/niche.ts` |
| `Profiles.tsx` | Automation profiles (what to scrape/generate on a schedule) | `services/automation-supervisor.ts`, `services/scheduler.ts`, `ipc/automation.ts` |
| `Download.tsx` | Source-video download queue | `services/downloader.ts`, `services/ytdlp.ts`, `ipc/download.ts` |
| `Compose.tsx` | Video timeline editor entry point, 3 engines: Classic, HyperFrames, Remotion | `src/features/compose/`, `src/features/video-studio/` (Classic/HyperFrames), `src/features/video-studio/editor/` (Remotion-only, see "Compose → Remotion" below); `ipc/compose.ts`, `ipc/video-engine.ts` |
| `Thumbnails.tsx` | Konva-based thumbnail editor + batch generation | `src/features/thumbnail-editor/`, `shared/thumbnail.ts` (auto-arrange), `ipc/thumbnails.ts` |
| `RenderQueue.tsx` | Batch/queued GPU render jobs | `services/render.ts`, `services/engine/` — GPU-only by design, no CPU fallback: encode failures must fail visibly, not silently degrade — `ipc/batch.ts`, `ipc/render.ts` |
| `TalkingVideo.tsx` + `talking-video/` | Talking-photo/avatar video generation | `ipc/talkingphotos.ts`; see `docs/TALKING_VIDEO_REDESIGN.md` |
| `Publish.tsx` | Upload/publish finished videos to YouTube | `services/uploads-detect.ts`, `services/webhook.ts`, `ipc/publish.ts` |
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

## Compose → Remotion is the new timeline editor

`src/features/video-studio/editor/` is a from-scratch timeline editor (kimu-style layout,
renderer-owned state, live `<Player>`, no staged preview). Compose mounts it for the
**Remotion** engine only; Classic and HyperFrames still use the older
`src/features/video-studio/` studio. Read `skills/video-studio-editor/SKILL.md` before
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
Requires `npm run build` first. `--keep` leaves the scratch profile; `--engine remotion`
drives the other renderer (HyperFrames is the default — it compiles far faster).

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
