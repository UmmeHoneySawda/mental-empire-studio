# Next Agent Handoff

## Repository state

- MES root: `D:\Work\mental-empire-studio`
- Branch: `feat/openmontage-integration`
- Base: `origin/build/mental-empire-studio` (merge-base `4d78fab8709a2cd2811e50bc72d8fd16c785c418`)
- OpenMontage root: `D:\Work\OpenMontage` at `0af32ce5e1e830c33992af1f9179dcdcd536549b` — **pinned,
  clean, and must not be modified**
- Current phase: two agent runners implemented; five acceptance scenarios blocked on runner authentication

## The one blocker

**No agent runner can currently authenticate.** Both supported runners are implemented, pinned and
detected correctly:

| Runner | Installed | Authenticated | Blocker |
| --- | --- | --- | --- |
| Codex CLI 0.145.0 | yes | yes | usage capacity exhausted until **Jul 31st, 2026 3:56 PM** |
| Claude Code 2.1.220 | yes | **no** | `Not logged in · Please run /login` |

This blocks acceptance scenarios **C, E, G, H and I**, each of which needs a real agent-governed
production. Full write-up, probe transcripts and the exact unblock:
`docs/openmontage-integration/evidence/BLOCKED-agent-runner-auth/REPORT.md`.

**Smallest action to unblock (account owner only):**

```powershell
node_modules/@anthropic-ai/claude-code/bin/claude.exe setup-token
# then set the printed token as a Windows USER env var:
#   CLAUDE_CODE_OAUTH_TOKEN
# and restart the shell. Never print, log or commit it.
```

Then set `integrations.openMontage.runner` to `claude-code` (or leave `automatic`, which now selects
Claude once Codex is quota-blocked) and run the five committed specs:

```powershell
npx @electron/rebuild -f -w better-sqlite3
npm run build
cd D:\Work\OpenMontage; python -m backlot serve --port 4750   # separate shell, loopback only
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\C-pexels-stock.json"
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\E-hyperframes.json"
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\G-runner-interruption.json"
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\H-process-control.json"
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\I-fatal-fallback.json"
node scripts/openmontage-evidence-report.mjs --all
```

C and G **resume** from their preserved Codex-era checkpoints; the Claude runner reads the canonical
OpenMontage filesystem state rather than an agent conversation, is told which stages are already
complete, and records a `runner_transition` event. No destructive reset is needed.

`PEXELS_API_KEY` **is configured** (56-character Windows user variable, value never read or logged)
and is not a blocker.

## Acceptance status

| ID | Scenario | Live E2E |
| --- | --- | --- |
| A | Open archival footage | **PASS** — `evidence/A-archive-footage/` |
| B | Approval and revision | **PASS** — `evidence/B-approval-revision/` |
| C | Additional stock footage (Pexels) | BLOCKED — no runner auth |
| D | Remotion render + self-contained editable project | **PASS** — `evidence/D-remotion-editable/` |
| E | HyperFrames render + editable workspace | BLOCKED — no runner auth |
| F | Restart recovery (normal app restart) | **PASS** — `evidence/F-normal-restart/` |
| G | Runner/agent interruption recovery | BLOCKED — no runner auth |
| H | Pause / resume / cancel / duplicate | BLOCKED — no runner auth |
| I | Fatal failure + MES fallback | BLOCKED — no runner auth |
| J | OpenMontage-unavailable regression | **PASS** — `evidence/J-unavailable/` |

## What this session changed

### 1. Scenario D is genuinely closed

The live production completed at **exactly the locked 24 fps** (1280×720, h264+aac, 15.6s) and
exported a self-contained `editable/remotion/` project. That project was then copied to
`D:\Work\openmontage-acceptance\independent\D-remotion` — outside both checkouts, without
`node_modules` — installed from its own pinned `package.json`, and rendered with the README's
documented `npm run render`. It produced **375 frames = 15.6s × 24fps**, byte-size identical to the
in-workspace master. No absolute path leaks into the exported sources.

### 2. Scenario J is closed

Pointed at a non-existent checkout, MES launched normally, settings/compose/render-queue/asset-library
all stayed readable, health reported `unavailable` accurately, and an Automatic request routed to
`mental-empire-studio` with no OpenMontage job created.

### 3. Per-scenario evidence, and the evidence tool no longer inherits verdicts

`scripts/openmontage-evidence-report.mjs` previously echoed the harness's own `result` whenever it
could not re-verify — the exact false-pass it exists to catch. It now:

- refuses to inherit a verdict (`INDETERMINATE` + a failing `evidence_reverifiable` check),
- supports `sourceEvidence` + `specPatch` so one live run yields **independent** per-scenario reports
  (A, B and F each grade only their own contract against the combined run),
- supports `requiredBehaviours` so behaviour-shaped scenarios (approval, revision, restart) cannot
  pass on a terminal state alone,
- hashes artefacts itself instead of trusting runner-reported digests,
- credits behaviour proven in a resumed run's `priorRun`.

The harness now writes `acceptance-spec.json` beside the evidence so offline re-grading always works.

The combined `evidence/A-B-D-F-G/` keeps its honest **FAIL** (it requested an editable project and
did not deliver one). That is not hidden — A, B and F simply do not depend on it.

### 4. Three real product bugs found and fixed

- **Approval race (recurrence).** The checkpoint watcher deferred the gate only *while a Codex child
  was alive*, but in the window **between** turns it could publish `awaiting_approval` from a stale
  `awaiting_human` file; MES approved, the runner had already auto-continued, and the command was
  rejected. This killed live scenario C after three successful approvals. The watcher now **never**
  publishes a gate — only `afterSuccessfulTurn`, which alone knows the runner will actually wait.
  Regression: `openmontage-codex-runner.test.ts` "never surfaces an approval gate from a checkpoint
  the runner has already moved past".
- **Fatal failures were undiagnosable.** Codex reports errors as a **stdout JSON event**, not stderr,
  so the runner logged `diagnostic: "unknown"`. It now captures and sanitizes that message.
- **Quota exhaustion was classified as retryable.** The generic failure text contains the word
  "runner", so `classifyOpenMontageFailure` returned `retryable: true` and MES burned its retry
  budget on turns that could never succeed. Quota is now classified deterministically as
  `credentials` / non-retryable / still fallback-eligible. Two new contract tests.

### 5. `fallback_running` was a dead end

`monitor()` returned on `fallback_running` and `recoverPolicyMonitors` excluded it, so a job that
fell back could **never** reach "completed with fallback" even after MES finished rendering. Added
`reconcileFallback` + a `mesProductionStatus` dependency; the monitor keeps watching and completes
the job when the linked MES project reaches `rendered`. Regression test included. The acceptance
harness can now drive that render for real via `actions.driveMesFallbackRender`, and the
postcondition evaluator grades a fallback completion on its own contract (linked attempts, preserved
OpenMontage workspace, classified failure, real fallback video) instead of demanding an OpenMontage
render that by definition never happened.

### 6. Dependency fixes (both on shipped paths)

```json
"overrides": { "fast-uri": "3.1.4", "js-yaml": "4.3.0" }
```

`js-yaml` was previously documented as build-tooling only — **that was wrong**: `electron-updater`
(a production dependency) pulls it, so the high-severity advisory reached the shipped auto-update
path. `npm audit --omit=dev` went from 1 high + 2 moderate to **2 moderate**, both of which are
`react-router` advisories that are **unreachable** — `react-router-dom` is declared but imported
nowhere in the repo. Details and follow-ups: `docs/openmontage-integration/SECURITY_REVIEW.md`.

## Test/ABI discipline — read before running anything

`better-sqlite3` must match whoever loads it:

```powershell
npm rebuild better-sqlite3                    # before Node/Vitest runs
npx @electron/rebuild -f -w better-sqlite3     # before Electron launch, dist, or live acceptance
```

**Never rebuild while a live acceptance run is in flight** — it swaps the native module under the
running Electron app. It is currently built for **ELECTRON**.

## Verified this session

```powershell
npm run typecheck                       # PASS
npm test                                # PASS - 73 files / 603 tests, 2 opt-in skips (ME_REQUIRE_SQLITE=1)
npm run build                           # PASS
npm run dist:dir                        # see VALIDATION.md
node scripts/openmontage-evidence-report.mjs --all   # A/B/D/F/J PASS; A-B-D-F-G honest FAIL
node scripts/openmontage-screenshots.mjs --profile ...\profiles\D-remotion-editable --out ...\screenshots\live-D
```

## Known gaps, stated as gaps

- **macOS is NOT EXECUTED.** No macOS machine was available.
- **Three UI screens were not captured from real data** (new production, production plan, runtime
  comparison) — the capture script cannot resolve those controls through the Electron automation
  channel. Recorded as NOT EXECUTED in `TEST_MATRIX.md`, not as passes. The completed-outputs and
  recovery screens need the job-row click fixed, or the G/I profiles once quota returns.
- The real `codex-security` `security-diff-scan` skill does not exist in this environment; the
  security work is a manual audit against the cached threat model and says so.

## Conventions to keep

- Follow `docs/SENTRY_LOGGING.md`; use `sentryLog`/`captureException` from
  `electron/services/sentry.ts`. Never log secrets, script/media content, or private absolute paths.
- Keep `NativeApi` (`shared/types.ts`), `electron/ipc/*`, and `electron/preload.ts` aligned.
- Add DB columns with `ensureColumn`; `CREATE TABLE IF NOT EXISTS` only for genuinely new tables.
- Credentials live in the OpenMontage/runner environment. MES stores and exposes **status only**.
- Never commit OpenMontage source, generated production media, `.env` files, or temp profiles.
- **Build acceptance-spec Windows paths with `path.win32.join` from plain segments.** Writing
  `'D:\\Work\\...'` inside a shell heredoc collapses to `\W`, `\o`, `\s` escapes.
- Metadata keys in a job package must not look secret-shaped — `credential_prerequisite` is rejected
  by the validator (correctly). Use e.g. `provider_env_var`.
