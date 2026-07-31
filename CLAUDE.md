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

## Video Studio E2E

`npm run e2e:studio` drives the real Electron app with Playwright against a throwaway
profile (`ME_USERDATA_DIR`, set in `electron/main.ts` — a plain relocation, no reset). It
catches wiring bugs unit tests and a green build cannot see: a preload method with no
`ipcMain.handle` behind it, a panel that throws on mount, a renderer that fails to report.
Requires `npm run build` first. `--keep` leaves the scratch profile for inspection.

It does not yet edit a real clip — that needs a downloaded video seeded into the scratch
database, which is the natural next extension.

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
