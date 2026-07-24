# Next Agent Handoff

## Repository state

- MES root: `D:\Work\mental-empire-studio`
- Branch: `feat/openmontage-integration`
- Base: `origin/build/mental-empire-studio` (merge-base `4d78fab8709a2cd2811e50bc72d8fd16c785c418`)
- OpenMontage root: `D:\Work\OpenMontage` at `0af32ce5e1e830c33992af1f9179dcdcd536549b` — **pinned,
  clean, and must not be modified**
- Current phase: closing the remaining live acceptance scenarios

Commits above the base (oldest first):

```
29fac2f feat(openmontage): define integration contracts
5637b31 feat(openmontage): add persistence and health probes
9e894a2 feat(openmontage): add assisted handoff recovery
417c4c8 feat(openmontage): add managed runner execution
84b7d60 feat(openmontage): add routing and MES fallback
a67c298 feat(openmontage): add production workspace UI
f8b25b2 test(openmontage): complete release validation
1d2d602 feat(openmontage): harden managed production runner
0b93d1f fix(openmontage): repair live health path and make SQLite ABI skips loud
e378957 fix(openmontage): make completion prove the requested output contract
d7c1269 test(openmontage): add real runner-interruption and cancellation coverage
```

The branch has **no upstream yet** — it has never been pushed.

## What this session changed, and why it matters

### 1. A false PASS was found and fixed

The combined `evidence/A-B-D-F-G/` run was recorded as PASS. It requested
`composition.editableOutput: true`, wrote `editable/remotion/` with **no `package.json`**, persisted
**no** `editable_project` output, and still passed — because the harness decided PASS from
`job.state === 'completed'` alone.

Fixed on both sides:

- The **runner** (`resources/openmontage-runner/codex-runner.mjs`) now re-checks the caller's output
  contract before emitting `completed`: required MP4, requested editable project (which must be
  genuinely self-contained — its own `package.json` with dependencies), and, when the MES timeline
  locks them, the frame rate and resolution. Breaches emit `OUTPUT_VALIDATION_FAILED`,
  `EDITABLE_PROJECT_MISSING` or `OUTPUT_CONTRACT_VIOLATION` with checkpoints preserved.
- The **harness** decides PASS from `scripts/lib/openmontage-postconditions.mjs`, which re-probes
  artefacts on disk with ffprobe rather than trusting the runner or the job row.

Re-evaluating the stored evidence now returns the honest verdict:

```
node scripts/openmontage-evidence-report.mjs --all
FAIL A-B-D-F-G-...  (harness recorded PASS)
       FAIL output_present:editable_project
       FAIL editable_project_self_contained
```

### 2. The 24 fps vs 30 fps question is resolved

That job package contained **no `fps` field at all**, so its 30 fps render violated no locked
decision — there was nothing to violate. The evaluator now reports an unlocked frame rate as
`NOT_APPLICABLE` instead of inventing a verdict. Scenario D's package locks 24 fps explicitly, with
four locked scene boundaries, so the enforcement path is exercised for real.

### 3. ~60 tests were silently skipping

`npm test` reported "526 passed | 62 skipped" and looked green. `better-sqlite3` was built for the
**Electron** ABI, so nine SQLite-backed suites hit an inlined silent `describe.skip`. Note that
`require('better-sqlite3')` succeeds even with a broken ABI — the native binding only loads on
`new Database()`, which is why the mismatch is easy to miss.

`test/helpers/sqlite.ts` now prints a banner naming the dropped coverage and both rebuild commands,
and fails hard under `ME_REQUIRE_SQLITE=1`. **True totals with the Node ABI: 73 files / 599 tests
pass, 2 opt-in skips.**

### 4. Stale nested `OpenMontage/` removed

`D:\Work\mental-empire-studio\OpenMontage\` held exactly one entry — an **empty** `.git` directory,
zero files, not a junction (`git -C` there resolved to the parent MES repo, which is what proved it
empty). It was moved to the session scratchpad rather than deleted. The live health test had been
resolving that dead path; it now honours `ME_OPENMONTAGE_PATH` and otherwise the documented sibling.

## Test/ABI discipline — read before running anything

`better-sqlite3` must match whoever loads it:

```powershell
npm rebuild better-sqlite3                    # before Node/Vitest runs
npx @electron/rebuild -f -w better-sqlite3     # before Electron launch, dist, or live acceptance
```

**`better-sqlite3` is currently built for ELECTRON** (the live scenario-D run needed it). Rebuild for
Node before trusting `npm test`.

## Verified this session

```powershell
npm run typecheck                                    # PASS
npm test                                             # PASS - 73 files / 599 tests, 2 opt-in skips
npm run build                                        # PASS
$env:ME_OPENMONTAGE_LIVE='1'; npx vitest run test/unit/openmontage-health.test.ts   # PASS (6/6)
npx vitest run test/unit/openmontage-postconditions.test.ts                          # PASS (11/11, real ffmpeg+ffprobe)
npx vitest run test/unit/openmontage-codex-runner.test.ts                            # PASS (4/4)
node scripts/openmontage-evidence-report.mjs --all                                   # honest re-verdicts
```

## Exact next tasks, in order

1. **Finish scenario D.** A live production was in flight at handoff:
   - job/project `mes-accept-d-remotion-editable-20260725`
   - spec `D:\Work\openmontage-acceptance\specs\D-remotion-editable.json`
   - workspace `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725`
   - profile `D:\Work\openmontage-acceptance\profiles\D-remotion-editable`
   - evidence `docs/openmontage-integration/evidence/D-remotion-editable/`
   - At handoff: `idea` and `scene_plan` completed + human-approved, `assets` in progress.
   Check its state, then either let it finish or re-run:
   ```powershell
   npx @electron/rebuild -f -w better-sqlite3
   npm run build
   cd D:\Work\OpenMontage; python -m backlot serve --port 4750   # separate shell
   node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\D-remotion-editable.json"
   ```
   The spec sets `resumeExisting`, so re-running continues rather than restarting.
2. **Independently render D's exported project** and record it, which is what actually closes D:
   ```powershell
   cd D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\editable\remotion
   npm install
   npm run render
   ```
   Then put the produced file in the spec's `postconditions.independentRender.outputPath` (with the
   exact command) and re-run `scripts/openmontage-evidence-report.mjs --evidence D-remotion-editable`
   so `independent_render_exists` / `independent_render_ffprobe` are graded.
3. **Scenario E — HyperFrames.** New spec with `composition.runtime: 'hyperframes'` and
   `editableOutput: true`. Must show lint, validation, render, ffprobe, exported workspace, and an
   independent render of that workspace. An installed binary or health probe is not acceptance.
4. **Scenario G — real interruption.** Use the new harness action:
   `actions.interruptRunner: { times: 1 }`. It kills the recorded runner PID with `taskkill /T /F`,
   waits for a new runner, and records stage/progress/checkpoint/session before and after plus a
   surviving-descendant count. Assert no stage rewind and eventual completion.
5. **Scenario H — process control.** `actions.pauseResume`, `actions.duplicateStart`, and the new
   `actions.cancelAfterCheckpoint`, asserting exactly one session and `orphanProcesses: 0`.
6. **Scenario I — fatal failure + MES fallback.** Set `actions.interruptRunner.times` **greater than**
   `retryLimit`. Repeated interruption exhausts retries and forces a genuine fatal failure with no
   fault-injection code in the production runner. Then assert classification, the sanitized Sentry
   payload, preserved checkpoints, a real MES fallback video, and linked attempts.
7. **Scenario J — unavailable regression.** Point `repositoryPath` at a non-existent directory; assert
   MES launches, ordinary workflows work, health reports it accurately, routing falls back to MES,
   and the smokes stay green.
8. **Fresh UI screenshots** for all 11 PRD screens from the final built app against real persisted
   jobs (the completed profiles make the live/approval/completed/recovery states reachable).
9. **Apply the one pending dependency fix.** Add to `package.json`:
   ```json
   "overrides": { "fast-uri": "3.1.4" }
   ```
   `fast-uri@3.1.2` reaches the **shipped** runtime via
   `electron-store → conf → ajv → fast-uri`; `ajv` declares `^3.0.1`, so `3.1.4` is in range and
   non-breaking. **It was deliberately not applied yet** because `npm install` would swap
   `node_modules` under the running scenario-D Electron app. Apply it, then re-run typecheck, the full
   suite, build and `dist:dir`. Everything else in the audit is dev-only or needs a breaking major —
   see `SECURITY_REVIEW.md`.
10. **Final matrix, then push.** `npm test`, `typecheck`, `build`, `dist:dir`, smokes `1` and
    `m3`–`m7`; update `TEST_MATRIX.md`; then
    `git push -u origin feat/openmontage-integration` and open a **draft** PR against
    `build/mental-empire-studio`. Do not merge.

## Blockers

**`PEXELS_API_KEY` is missing** — scenario C cannot run truthfully. It is absent from the User,
Machine and Process environments, and neither `D:\Work\OpenMontage\.env` nor `.env.local` exists.
Get a free key at <https://www.pexels.com/api/>, set it as a Windows **user** environment variable,
and restart the shell. Never print, persist, or copy it into evidence — status only. Full blocker
write-up in `TEST_MATRIX.md`.

**macOS is untested.** No macOS machine was available. Recorded as NOT EXECUTED, not N/A.

## Environment notes

- Node 22.16.0 (`NODE_MODULE_VERSION` 127); Electron 32 (ABI 128); Python 3.11.9.
- Codex CLI `@openai/codex@0.145.0`, pinned, ChatGPT-token auth in `~/.codex/auth.json`.
- Backlot: `cd D:\Work\OpenMontage; python -m backlot serve --port 4750` — loopback only. **Stop it
  when validation finishes**; do not leave it or acceptance processes running.
- FFmpeg/ffprobe resolve from `resources/bin`; Remotion and HyperFrames probe available.

## Conventions to keep

- Follow `docs/SENTRY_LOGGING.md`; use `sentryLog`/`captureException` from
  `electron/services/sentry.ts`. Never log secrets, script/media content, or private absolute paths.
- Keep `NativeApi` (`shared/types.ts`), `electron/ipc/*`, and `electron/preload.ts` aligned.
- Add DB columns with `ensureColumn`; `CREATE TABLE IF NOT EXISTS` only for genuinely new tables.
- Credentials live in the OpenMontage/runner environment. MES stores and exposes **status only**.
- Never commit OpenMontage source, generated production media, `.env` files, or temp profiles.
- **When building acceptance specs, construct Windows paths with `path.win32.join` from plain
  segments.** Writing `'D:\\Work\\...'` inside a shell heredoc silently collapses to `\W`, `\o`, `\s`
  escapes and produces a relative path — this already wasted one launch attempt.
