# Sentry logging — agent master guide

**Required reading for every agent working on this codebase.**

When you add features, fix bugs, or touch pipeline code, you must consider Sentry. When you
investigate production failures, **start in Sentry** (Issues + Logs), not only local log files.

---

## Why this exists

Mental Empire Studio is a desktop app. We cannot SSH into user machines. Telemetry is how we see:

- What failed (Issues / exceptions)
- Why it failed (structured Logs + attributes + traces)
- What the machine looked like (resource context, binary presence, encoder, etc.)

Local `electron-log` files still matter for the user’s own debugging. **Sentry is the team’s
remote observability surface.**

---

## First rule: instrument as you go

When you change or add code that:

- Starts/stops a multi-step operation
- Calls an external tool (yt-dlp, ffmpeg, Groq, TalkingPhotos API)
- Connects a session or toggles a provider
- Enters a recoverable failure path (retry, attention, reauth)
- Completes or fails a user-visible job

…add **structured Sentry logs** (and `captureException` for unexpected throws if not already
covered by IPC instrumentation).

Do **not** leave new pipeline paths log-only in `electron-log` without Sentry.

---

## How to add a log (main process)

```ts
import { sentryLog } from '../services/sentry'
// or: import { sentryLog } from '../../services/sentry'

// Wide event — one row per operation with snake_case attributes
sentryLog.info('Render completed', {
  project_id: project.id,
  encoder: 'nvenc',
  duration_ms: 12340,
})

// Parameterized message (searchable template + parameters)
sentryLog.warn(sentryLog.fmt`Auto-watch source failed: ${sourceLabel}`, {
  source_id: id,
  error_message: msg.slice(0, 200),
})

sentryLog.error('Audio download failed', {
  video_id: video.id,
  stderr_category: 'http-403',
  error_message: msg.slice(0, 200),
})
```

### API

| Helper | File | Notes |
|--------|------|--------|
| `sentryLog.info/warn/error/debug` | `electron/services/sentry.ts` | No-ops when telemetry is off |
| `sentryLog.fmt` | same | Tagged template → `message.parameter.N` |
| `captureException` | same | Unexpected throws; IPC wrapper already captures most handler throws |
| Renderer `Sentry.logger.*` / `console.warn/error` | `src/lib/sentry.ts` | Only when telemetry was on at window load |

### Init (already done — do not re-init ad hoc)

- Main: `setSentryEnabled()` in `electron/services/sentry.ts` — `enableLogs: true`, scrubbing, global attrs
- Renderer: `initSentryRenderer()` in `src/lib/sentry.ts` — logs + `consoleLoggingIntegration` (warn/error)
- Kill switch: Settings → Integrations → Telemetry; forced off under `ME_SMOKE` / `ME_SHOOT`
- Unit tests: stub in `test/stubs/sentry-electron.ts`

---

## Best practices (required)

1. **Wide events, not spam** — one log per meaningful outcome (started / completed / failed / retry), not every loop iteration or poll tick.
2. **snake_case attributes** — only `string | number | boolean` (no objects/arrays/undefined).
3. **Namespace via message + attrs** — e.g. message `"TalkingPhotos connect started"`, attrs `operation: 'session'`.
4. **Right signal**
   - Unexpected crash / bug → `captureException` (Issue)
   - Recoverable / business failure → `sentryLog.warn` or `sentryLog.error` (Log)
   - Timing / flow → span (already on IPC via `instrumentIpcMain`)
5. **No secrets** — never log API keys, cookies, proxy URLs, tokens, full cookie files. Prefer flags like `has_api_key: true`. `beforeSendLog` scrubs common keys but is not a license to log carelessly.
6. **Truncate free text** — `error_message: msg.slice(0, 200)`.
7. **Use `fmt` when the variable is part of the message** — keeps templates searchable.
8. **Respect the kill switch** — always use `sentryLog` / `captureException` helpers; they no-op when telemetry is off.

### Levels

| Level | Use |
|-------|-----|
| `info` | Milestones: started, completed, connected, queued |
| `warn` | Recoverable: retry, reauth needed, quota exhausted, attention |
| `error` | Failures that need investigation: download/render/transcribe/provider fail |
| `debug` | Local-only diagnostics — **dropped** by `beforeSendLog` in production path |

---

## Where logging already exists (extend, don’t ignore)

| Area | Examples |
|------|----------|
| Startup | Binary presence, app/electron versions (`logger.ts`) |
| Scheduler | Auto-watch source failures |
| Download | Audio download completed / failed |
| Render | completed, failed, GPU retry, audio-master warn |
| Transcribe | completed / failed (word count, chunked, model) |
| TalkingPhotos / Talking Video | session connect, poller, sync, jobs, TTS, subtitles, captions, merge, quota |

When you add a **new** TalkingPhotos operation, automation step, or service path, mirror these patterns.

---

## Debugging: use Sentry to find errors

### Before digging only in local logs

1. Open the Sentry project (org **buft**, region **de** — DSN host `ingest.de.sentry.io`).
2. **Issues** — uncaught exceptions, grouped stack traces.
3. **Logs** — structured events; filter by message/attributes.
4. **Traces** — IPC spans (`op: ipc.handle`) when performance is on.

### Useful Log queries

```
message:"TalkingPhotos connection"
message:"Render failed"
message:"Audio download failed"
operation:session
operation:poller
binary:ffmpeg
severity:error
```

(Exact field names may show as `severity` or `level` depending on Sentry UI version.)

### Local log file (user machine)

Still useful when the user attaches a file:

`%AppData%\Mental Empire Studio\logs\mental-empire.log` (Windows)

Sentry does **not** replace that file; it complements it for remote diagnosis.

### Volume alert

Error volume alert (≥ 20 error-level issue events / 1h): recreate with

`node scripts/create-sentry-error-volume-alert.mjs`

(requires `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=buft`, `SENTRY_REGION=de`).

---

## Checklist for PRs / agent tasks

- [ ] New multi-step operation has at least one **success** and one **failure** `sentryLog`?
- [ ] Failure attributes answer *what* failed (ids, operation, category) without secrets?
- [ ] Unexpected throws still reach Sentry (IPC wrapper or explicit `captureException`)?
- [ ] High-frequency loops (poll ticks, progress %) are **not** logging every iteration?
- [ ] Investigating a bug: checked Sentry Issues + Logs before assuming “no signal”?

---

## Do not

- Commit Sentry **auth tokens** (org tokens). The DSN in `electron/services/sentry.ts` is a write-only ingest key and is already shipped in-app by design.
- Re-init Sentry outside `setSentryEnabled` / `initSentryRenderer`.
- Log full remote API payloads, cookies, or user script/prompt text by default.
- Rely on `console.log` alone in main process — use `sentryLog` for remote signal.

