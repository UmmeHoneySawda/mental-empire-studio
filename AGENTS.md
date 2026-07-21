# AGENTS.md

## Project overview

Mental Empire Studio is a local-first Electron desktop application for faceless-YouTube automation.
It uses Electron, React, TypeScript, Zustand, and SQLite (`better-sqlite3`). Read `README.md` for
product behavior and `PLAN.md` for completed milestone history.

## Working conventions

- Keep the renderer, preload bridge, IPC handlers, and `NativeApi` in `shared/types.ts` aligned.
  For a new IPC method: update `NativeApi` → add/register a handler in `electron/ipc/` → expose it
  from `electron/preload.ts`.
- Make database migrations idempotent. Add columns with `ensureColumn(...)`; do not modify existing
  `CREATE TABLE` statements. Coerce database booleans and handle legacy null values in repositories.
- Keep fonts self-hosted through `@fontsource/*` imports in `src/main.tsx`; do not add CDN fonts.
- Native dependencies are externalized and unpacked for Electron packaging. Rebuild `better-sqlite3`
  against Electron when dependencies change.
- Preserve the app's local-first design: no cloud dependencies or API keys except the optional Groq
  transcription key.
- **Sentry logging is mandatory for pipeline work.** Read `docs/SENTRY_LOGGING.md` before adding
  services, provider jobs, or automation steps. Use `sentryLog` / `captureException` from
  `electron/services/sentry.ts`. When diagnosing production failures, **check Sentry Issues + Logs
  first** (org `buft`, region `de`), not only local log files.

## Key locations

- `electron/main.ts`: application window, tray, scheduling, and smoke entry points.
- `electron/ipc/`: IPC handler implementations; `register.ts` wires them up.
- `electron/services/`: service logic.
- `electron/db/index.ts`: SQLite migrations and repositories.
- `electron/store/settings.ts`: settings and secrets.
- `electron/preload.ts`: typed `window.api` bridge.
- `src/screens/`: React screens.
- `src/store/useStore.ts`: UI and appearance state; `src/store/useData.ts`: live IPC/database state.
- `src/features/thumbnail-editor/`: Konva thumbnail editor.
- `shared/types.ts`: domain and IPC contracts; `shared/thumbnail.ts`: pure thumbnail arrangement logic.

## Commands

```bash
npm install
npx @electron/rebuild -f -w better-sqlite3
npm run typecheck
npm run build
npm test
npm run dev
```

Use `npm run fetch:bin` to vendor yt-dlp and an available ffmpeg into `resources/bin`.
Use `npm run dist:dir` for an unpacked packaged-app check.

## Verification

Run `npm run typecheck` and `npm run build` for code changes. The integration smoke harness uses
fixtures because the sandbox cannot reach YouTube or run ffmpeg/Whisper:

```bash
ME_SMOKE=m6 ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 \
  ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json \
  xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

Supported smoke values are `1`, `m3`, `m4`, `m5`, `m6`, and `m7`. Use fixture seams such as
`ME_RENDER_FIXTURE` instead of live external tools. The built app needs `--no-sandbox` when run
headlessly in this environment.

## Change safety

- Keep changes scoped; do not overwrite unrelated work in a dirty tree.
- Avoid editing generated output (`out/`, `dist/`, and build artifacts) unless explicitly asked.
- Do not commit or push unless the user requests it.
