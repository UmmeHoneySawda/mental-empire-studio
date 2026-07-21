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

## Git / push

The environment's git proxy blocks direct `git push`; pushes go through the GitHub Data API
(`scratchpad/push_m2.py` pattern): commit locally, then create blobs/tree/commit and update the branch
ref via the API. Branch: `build/mental-empire-studio`.
