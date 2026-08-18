# TalkingPhotos long-form video pipeline — design

*Date: 2026-08-18. Supersedes and replaces the previous TalkingPhotos implementation, which milestone M0
deletes. Evidence base: `D:\talkingphotos-session` (three reverse-engineering sessions) plus live probes
made while writing this document.*

## Goal

Turn a source-channel audio track into finished ~30-minute talking-head videos on
[app.talkingphotos.ai](https://app.talkingphotos.ai), driven from Mental Empire Studio.

TalkingPhotos has no 30-minute render. Its longest single render is 5 minutes and its **Merge Videos**
tool stitches clips up to **1800 s**. So a 30-minute video is *N* short renders plus one merge. The app
automates that: cut the audio, render each chunk, stitch, download.

## Verified facts this design rests on

All confirmed live on 2026-08-18, not inherited from the session docs.

| Fact | Evidence |
|---|---|
| `POST /login` is a Symfony form login: `_csrf_token`, `_username`, `_password`, `_remember_me` | read off the live login form |
| A **plain HTTP client** authenticates and calls the JSON API — no Cloudflare, no JS challenge, no CSRF header on XHR | logged in from PowerShell, `GET /ai_api/user_daily_restrictions` → 200 JSON |
| Own audio can be fed in: `POST /library/categories/upload/{catId}`, multipart field `file` | uploaded a 191 KB mp3, got `{id:4419530, type:"audio", data:{duration:11.99}}`; deleted afterwards |
| **The account allows only 3 simultaneous logins.** Exceeding it fails login with `Maximum number of simultaneous logins exceeded. Maximum allowed: 3` | three probe logins locked the account out |
| That lockout **self-heals in ~15 minutes** as stale PHP sessions expire | re-login succeeded after the wait |
| `appSettings.maxMergeVideoDuration === 1800`, `filesStoreDays === 60`, role `Deluxe Bonus` | read from `window.appSettings` |
| Merge cap is enforced **client-side only** (`total + next > max` → reject) | `chunk-MRLPR36A.js`, `addItem()` |
| `POST /project/merge_videos` body is `{itemsIds, title, audioMediaId}`; order of `itemsIds` is play order | `chunk-DR4ZCEK6.js`, `startMergingVideo()` |
| `GET /project/{id}` returns **422 unless the project is `completed`** — it cannot poll a render | session-3 `API-DELTAS.md` §1.4, reproduced 4× |
| `POST /project` is **not idempotent**; a blind retry produced duplicate renders | session-2 `FINDINGS.md` §5 |
| Per-type concurrency is the real ceiling: **5** for human/cartoon/animal/singing_v2, 2 for dancing/singing/replicate-motion | `GET /project/concurrent_limit/{type}` |
| Daily video quota 100 (23 used at time of writing); counters reset per calendar day | `GET /ai_api/user_daily_restrictions` |

## Decisions taken

| Question | Decision |
|---|---|
| Transport | **Direct HTTP client in the Electron main process.** No Playwright, no browser automation. |
| Existing TalkingPhotos code | **Deleted** in M0. |
| Which render preset | **User-selected per job.** The app offers a catalog and derives the chunk-length ceiling from the live API, rather than hard-coding one recipe. |
| Source audio longer than 30 min | **Split into consecutive ≤30-minute videos.** One job can produce several deliverables. |
| Character | **Generate, upload, or pick from a saved library** persisted in the app. One character per job. |
| Motion (where required) | **User picks** from the live catalog, with a sensible pre-selection. |
| Finished video | **Downloaded into the library.** Does not touch the publish/upload pipeline. |
| Job supervision | **Manual wizard, one job at a time.** No unattended automation in this scope. |

## Architecture

```
shared/talkingphotos.ts                       pure: types, feature catalog, split planner, payload builder
electron/services/talkingphotos/client.ts     HTTP, cookie jar, login, typed errors
electron/services/talkingphotos/api.ts        one typed wrapper per endpoint
electron/services/talkingphotos/audio.ts      ffmpeg chunk extraction + ffprobe verification
electron/services/talkingphotos/characters.ts generate / poll / upload / persist
electron/services/talkingphotos/pipeline.ts   resumable phase machine + concurrency gate
electron/ipc/talkingphotos.ts                 registerTalkingPhotosIpc()
src/screens/TalkingPhotos.tsx                 wizard + live job panel
src/store/useTalkingPhotos.ts                 renderer state
```

The planner and payload builder live in `shared/` so they are pure, unit-testable, and previewable in the
wizard with no IPC round-trip — the same rationale as `shared/thumbnail.ts`.

### Transport and session

Cookie jar (`PHPSESSID`, `REMEMBERME`) persisted into settings as an **encrypted secret field**, reusing the
existing `safeStorage` mechanism at `electron/store/settings.ts:20`. Every request sends
`X-Requested-With: XMLHttpRequest` and uses `redirect: 'manual'`.

Login: `GET /login` → scrape `_csrf_token` → `POST /login` form-urlencoded with `_remember_me=on`. Success is
a 302 whose `Location` is **not** `/login`. On a 302 back to `/login`, re-read the page and classify the
flash message:

| Message | Code | User-facing message |
|---|---|---|
| `Maximum number of simultaneous logins exceeded` | `SESSION_LIMIT` | 3 sessions allowed; sign out elsewhere or wait ~15 min |
| invalid credentials | `BAD_CREDENTIALS` | check email/password |
| throttle message | `THROTTLED` | wait a minute; do not retry |

Because of the 3-session limit the app keeps **one** persisted session and reuses it. On auth loss it
re-logs in **once**, then fails with an actionable error. A manual **Sign out** button calls `GET /logout` to
free the slot immediately. `POST /project` and `POST /project/merge_videos` are **never** retried on
timeout — the project list is read back instead.

### Credential resolution

1. `process.env.TALKINGPHOTOS_EMAIL` / `TALKINGPHOTOS_PASSWORD`
2. else `settings.talkingphotos.email` / `.password`
3. else throw `NO_CREDENTIALS`

Env-var precedence is inverted relative to the existing `applyEnvFallback` convention
(`settings.ts:155`, where the setting wins) because the user asked for env-first. When an env var supplies
the value the Settings field renders read-only and labelled, so the effective source is always visible.

Both Windows user environment variables were set on 2026-08-18. Note two properties of that choice: `setx`
stores the password as **plaintext in `HKCU\Environment`**, readable by any process running as the user,
which is weaker at rest than the DPAPI-encrypted settings field; and env vars are only visible to the app
after a full restart.

### Feature catalog

A static table in `shared/talkingphotos.ts`, one row per usable `type` + `style`. The chunk ceiling is
confirmed per selection with `POST /project/video_duration_limit`, and **the live value wins**; the table is
only an offline fallback.

Chunk counts are per 30-minute deliverable.

| Label | type | style | max chunk | chunks | motion | notes |
|---|---|---|---|---|---|---|
| Human — Normal (v3) | `human` | `normal` | 300 s | 6 | required | 1080×1920 |
| Human — HQ (v3.5) | `human` | `high_quality` | 60 s | 30 | no | 1080×1920 |
| Human — Closeup HQ (v3.5) | `human` | `close_up` | 60 s | 30 | no | 1080×1920 |
| Cartoon — Normal | `cartoon` | `normal` | 300 s | 6 | required | 1080×1920 |
| Cartoon — HQ | `cartoon` | `high_quality` | 60 s | 30 | no | 1088×1920 |
| Cartoon — Closeup HQ | `cartoon` | `close_up` | 60 s | 30 | no | 1920×1088 at 16:9 |
| Fantasy/Animal — Fast | `animal` | `fast` | 300 s | 6 | no | **sub-HD** 768×1344 |
| Fantasy/Animal — HQ | `animal` | `high_quality` | 60 s | 30 | no | 1088×1920 |
| Singing — Normal HQ | `singing` | `v2_normal_hq` | 300 s | 6 | auto (500) | music, not speech |
| Singing — Normal Fast | `singing` | `v2_normal_fast` | 300 s | 6 | auto (500) | music, not speech |
| Singing — Closeup HQ | `singing` | `v2_closeup_hq` | 210 s | 8 | auto (500) | output 28:00, not 30:00 |

Disabled, with the reason surfaced in the UI:

| Feature | Why |
|---|---|
| Dancing, Singing & Dancing v2 | the motion clamps every render to exactly 30 s, so 30 minutes needs 60 renders |
| Replicate Motion | cannot use library audio; requires a driving video and the voice-change path |

Create endpoint by type: `human`/`cartoon`/`animal` → `POST /project`; `singing` → `POST /project/create_singing_dancing`.

Each catalog row also declares its permitted `aspectRatio` values and `characterStyle` values, because they
differ by type (`animal` offers `animal`/`fantasy`; `cartoon` offers `3d`/`2d`; `human`/`singing` offer
`realistic`). **Aspect ratio is chosen in the feature step**, next to the style, since it changes the output
geometry and must be fixed before the character is generated.

The payload builder starts from `Project.createDefaultOptions()` (session-2 `API-REFERENCE.md` §2.2) and
applies the per-type required overrides, which are not uniform:

| type | required overrides |
|---|---|
| all | `audioSource: 'library'`, `audioMediaId`, `aspectRatio`, and either `characterResultUuid` or `characterImageMediaId` |
| `human`, `cartoon` | `motionId` + `parentMotionId` only when `style === 'normal'` |
| `animal` | `characterStyle` must be `animal` or `fantasy`; `fantasy` only on `high_quality` |
| `singing` | `singingMode: true`, `motionId: 500` (the `AUTO_MOTION_ID` constant), no motion step |

### Split planner (pure)

Input `{ sourceDurationSec, partSeconds, mergeCapSec, minPartSeconds }` →
`{ outputs: [{ ord, startSec, endSec, parts: [{ ord, startSec, endSec }] }], totalParts, warnings[] }`.

- `partsPerOutput = floor(mergeCapSec / partSeconds)`; `outputSpan = partsPerOutput × partSeconds`.
- Walk the source in `outputSpan` windows. The final window is short, so it yields fewer parts and a
  possibly shorter final part.
- A trailing part shorter than `minPartSeconds` (2 s) is dropped rather than rendered.
- Worked example: 47:12 source, 300 s parts, cap 1800 → output 1 = 0–1800 s (6 parts), output 2 =
  1800–2832 s (4 parts: 3×300 s + 1×132 s). 10 renders.

### Chunk extraction

Per part: `ffmpeg -ss <start> -t <len> -i <src> -vn -c:a libmp3lame -b:a 128k <out>`. Explicit per-part
seek rather than `-f segment`, because parts must align to output windows and each part's real duration
must be known.

Binaries resolve through `ffmpegPath()` / `ffprobePath()` (`electron/services/bin.ts:21`), reusing the
`runFfmpeg` wrapper pattern at `electron/services/transcribe.ts:49`. Output lands in
`<libraryRoot>/<Channel>/<videoId>__<slug>/talking/parts/`, respecting `assertNotOnCDrive`
(`electron/services/video-engine/paths.ts:66`). Every part is then probed with `probeDuration()`
(`electron/services/audio.ts:50`) and the **measured** duration is what the merge-cap guard uses, because a
300 s cut is never exactly 300 s.

### Pipeline phases

`audio → probe → plan → split → category → character → motion → upload → submit → await → merge → awaitMerge → download → done`

Each phase is idempotent and its results are persisted, so a crash or restart re-enters at the first
incomplete phase instead of re-spending renders.

- **category** — ensure a `Mental Empire` library folder exists (`GET /library/categories?query=`, then
  `POST /library/categories`), cache its id.
- **upload** — one multipart upload per part; the server-reported duration is validated against the live
  chunk ceiling.
- **submit** — one project per part, titled `ME-{jobId}-o{output}-p{part}` so it is filterable. Gated on
  `GET /project/concurrent_limit/{type}`; submit only while `concurrentCount < concurrentLimit`.
  **Always branch on the response `success`/error body, never on the HTTP status alone** — session 3 proved
  `create_image_from_prompt` fails silently with HTTP 200.
- **await** — poll `GET /project?page=1&limit=N` and match the title prefix locally. Never `GET /project/{id}`.
- **merge** — one merge per output, `itemsIds` in part order.
- **download** — pull each finished mp4 to `<item>/talking/output-{n}.mp4`.

### Guardrails

- Refuse to start if the plan needs more renders than the remaining daily quota; show the numbers.
- Refuse to start if `partSeconds` exceeds the live ceiling for the chosen feature.
- Refuse to merge unless **every** part of that output is `completed`. A merge missing a part produces a
  silently wrong video; instead the output is marked failed and its good parts are preserved for retry.
- Refuse to merge if the **measured** part durations sum above `mergeCapSec`.
- Submit at most `concurrentLimit` renders at once; treat `422 Please wait…` as back-pressure, not failure.
- Retry a failed part render at most twice, reusing the already-uploaded audio.
- On `SESSION_LIMIT`, `THROTTLED`, `AUTH_LOST` or quota exhaustion, **pause** the job with a plain-language
  reason. Never hammer the site.

### Data model

Four tables in `SCHEMA`, later columns via `ensureColumn`, all added to the `resetAll()` list.

- **`tp_characters`** — `id, label, kind('generated'|'uploaded'), resultUuid, mediaId, previewUrl,
  previewPath, gender, ethnicity, age, beard, characterStyle, aspectRatio, createdAt`
- **`tp_jobs`** — `id, sourceId, sourceVideoId, channel, videoTitle, audioPath, sourceDurationSec, type,
  style, aspectRatio, partSeconds, mergeCapSec, characterId, characterResultUuid, characterMediaId,
  characterGender, characterEthnicity, characterAge, characterBeard, characterStyle, motionId,
  parentMotionId, libraryCategoryId, phase, status, error, createdAt, updatedAt`
- **`tp_job_outputs`** — `id, jobId, ord, startSec, endSec, mergeProjectId, status, localPath, error`
- **`tp_job_parts`** — `id, jobId, outputId, ord, startSec, endSec, audioPath, audioDurationSec, mediaId,
  projectId, remoteTitle, status, attempts, error`

Three levels because one job can yield several deliverables: a 47-minute source is 1 job → 2 outputs →
10 parts.

### IPC surface (`talkingphotos:*`)

`connection:test`, `connection:signOut`, `catalog:list`, `limits:get`, `quota:get`, `concurrency:get`,
`motions:list`, `characters:{list,generate,generateStatus,upload,delete}`, `plan:preview` (pure, no
network), `job:{create,list,get,start,pause,resume,cancel,retryPart,reveal}`.

Events: `talkingphotos:job` (job/output/part state), `talkingphotos:characterProgress`. Both broadcast
through `emit()` (`electron/ipc/events.ts:8`) with a guaranteed terminal frame in a `finally`.

### Observability

One wide `sentryLog.info` per phase transition with `operation: 'tp_<phase>'`, `job_id`, and counts;
`captureException` on unexpected failures. The password, the cookie jar and full user paths are never
logged — basenames only, per the `electron/ipc/publish.ts:86` convention and the sensitive-key stripping in
`electron/services/sentry.ts:15-26`.

### UI

One nav entry, **TalkingPhotos**, with a wizard above and a jobs list below.

Wizard: pick audio (source channel → video → download, reusing an existing file if present) → pick feature,
style and aspect ratio → set chunk length and confirm the computed plan → pick character → pick motion (only
when required) → Start.

Step order is a dependency chain, not a preference: aspect ratio must be fixed before a character is
generated (it is an input to `create_image_from_prompt`), and the character's **gender** is a query parameter
of the motion catalog (`GET /motions/list/{type}?gender=&aspect_ratio=&style=`), so the motion step must come
after the character step.

Jobs list: one expandable row per job showing each output and each part with live state
(*cutting → uploading → queued → rendering → done*), Retry on failed parts, Reveal in Explorer on finished
outputs, and Resume with a plain-language reason on paused jobs. Per-part visibility is deliberate: a
30-minute job is 6–30 separate renders spanning up to an hour, and an opaque "working…" would make a stall
indistinguishable from normal progress.

Settings gains a **TalkingPhotos** section: Email, Password, **Test connection**, **Sign out**.

## Milestones

| M | Scope | Gate |
|---|---|---|
| **M0** | Delete the previous implementation and unhook its references | `typecheck`, `build`, `test` clean |
| **M1** | HTTP client, login, credential resolution, Settings section, Test connection | user confirms Test connection reports the live role and quota |
| **M2** | Split planner, ffmpeg chunk extraction, four tables | unit tests for the planner and merge-cap guard |
| **M3** | Library category, part upload, character generate/upload/saved, motion catalog | fixture-backed tests |
| **M4** | Pipeline: submit → await → merge → download, with every guardrail | fixture-backed pipeline test incl. failure, retry, resume |
| **M5** | Wizard screen and live job panel | manual walk-through |
| **M6** | One cheap real run (2 parts, 1 output), then one real 30-minute run | finished mp4 on disk |

M0 must precede M1: the previous implementation owns `electron/ipc/talkingphotos.ts`, the `talkingphotos`
namespace on `NativeApi`, and the `talkingphotos:*` channel names.

## Verification strategy

1. **Pure unit tests** — split planner, payload builder, login-error classifier, merge-cap guard, catalog
   ceilings. Run under `npm test`.
2. **Fixture seam** (`ME_TP_FIXTURE`) — replays recorded responses so the whole phase machine, including
   failure, retry and resume-after-restart, is exercised with no network and no spend.
3. **One cheap live run** — short source, 2 parts, 1 output. Proves login → cut → upload → render → merge →
   download. Costs 2 of 100 daily renders.
4. **One live 30-minute run** — only after step 3 passes.
5. `npm run typecheck` and `npm run build` for every code change; `npm run userdata:backup` before any
   milestone that migrates the database.

Live failures are diagnosed in Chrome DevTools against the real request/response, and cross-checked against
the saved frontend bundle in `D:\talkingphotos-session\session-2\network\chunks\` rather than guessed at.
