# Current Objective
Rebuild TalkingPhotos integration from scratch: turn a source-channel audio track into finished ~30-minute
talking-head videos by cutting the audio into chunks, rendering each on app.talkingphotos.ai, merging them,
and downloading the result. Design of record: `docs/superpowers/specs/2026-08-18-talkingphotos-long-form-design.md`.

# Verified Completed
- **M0 — previous TalkingPhotos implementation deleted.** 31 files (10,521 lines) removed, plus reference
  removal in 14 shared files. Verified: `npm run typecheck` 0 errors across all 3 projects, `npm test`
  796 passed / 0 failed (baseline was 1048 passed / 0 failed; the 252-test delta is exactly the 15 deleted
  test files plus 2 removed automation-goal assertions), `npm run build` exit 0.
- Removed with it: the `talkingphotos-video` automation goal, its supervisor step branch, its
  `automationConfig` block, the `provider_connections` / `provider_jobs` / `provider_assets` /
  `transcript_documents` tables and repositories, the `talkingPhotos` `NativeApi` namespace, the
  `integrations.talkingPhotos` setting, the Settings card, the RenderQueue section, and the `.tp-*`/`.tv-*` CSS.
- Data backed up first: `CLAUDE-BACKUP-20260818-182415`.
- Windows user env vars set and verified in `HKCU\Environment`: `TALKINGPHOTOS_EMAIL`,
  `TALKINGPHOTOS_PASSWORD`. Not visible to the app until it is fully restarted.
- Live contract facts proven this session (see the spec's "Verified facts" table): plain-HTTP Symfony form
  login works with no bot protection; own audio uploads via `POST /library/categories/upload/{catId}`
  returning `{id, data.duration}`; **the account allows only 3 simultaneous logins** and that lockout
  self-heals in ~15 min; `maxMergeVideoDuration` is 1800.

# Current Problem
None open. M0 is verified and M1 has not started.

# Relevant Files
- docs/superpowers/specs/2026-08-18-talkingphotos-long-form-design.md   design of record
- D:\talkingphotos-session\                                            reverse-engineering evidence (3 sessions)
- docs/trace-mining/api-bodies-live/                                   16 captured live request/response bodies
- electron/store/settings.ts                                           secret-field encryption + env fallback pattern
- electron/services/bin.ts, electron/services/transcribe.ts             ffmpeg/ffprobe resolution + runFfmpeg wrapper
- electron/services/downloader.ts, electron/services/audio.ts           audio download + probeDuration

# Do Not Modify
- `docs/trace-mining/` — captured API evidence, deliberately kept.
- Anything under `.kilo/`, `.claude/worktrees/`, `scratchpad*` — historical worktrees.
- Never edit source with PowerShell `Get-Content`/`Set-Content`: PS 5.1 reads ANSI and writes UTF-8-with-BOM,
  which double-encodes every non-ASCII character. Use the editing tool, or .NET
  `File.ReadAllText/WriteAllText` with `UTF8Encoding($false)`.

# Next Action
M1: HTTP client + login + credential resolution (env → settings → typed error), the Settings
**TalkingPhotos** section, **Test connection**, and **Sign out**.

# Verification
- Per change: `npm run typecheck`
- Milestone gate: `npm test` (expect 796 passed / 0 failed plus any new tests) and `npm run build`
- M1 acceptance: Test connection reports the live role and remaining daily quota.
- Before any DB migration: `npm run userdata:backup`
