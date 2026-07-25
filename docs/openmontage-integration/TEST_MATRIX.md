# OpenMontage Integration Test Matrix

## How to read this table

Every requirement is graded independently on each axis. A cell is **PASS** only when that specific
kind of verification was actually executed and left evidence behind.

| Value | Meaning |
| --- | --- |
| PASS | Executed, and evidence exists. |
| FAIL | Executed and did not meet the requirement. |
| NOT EXECUTED | The verification has not been run. Not a pass. |
| BLOCKED | Cannot be run truthfully here; the exact missing prerequisite is named. |
| N/R | Not required for this row, with the reason stated in the notes. |

Column meanings:

- **Implemented** — the behaviour exists in shipped code.
- **Unit tested** — deterministic in-process assertions.
- **Fixture tested** — driven through a recorded/stand-in boundary (e.g. the fake Codex CLI standing
  in for the model while the *real* runner is under test).
- **Real-process tested** — a real OS process was spawned, killed, or terminated.
- **Live end-to-end tested** — the real MES Electron app drove the real OpenMontage engine through
  the real integration boundary and produced real media.
- **Windows passed** / **macOS passed** — the platform the verification actually ran on.

**macOS is NOT EXECUTED across the board.** No macOS machine was available in this environment. This
is stated as an untested platform rather than hidden behind N/A. The code paths are written to be
portable (POSIX process-group termination alongside the Windows `taskkill` branch), but portability
is not evidence.

---

## Acceptance scenarios

| ID | Scenario | Implemented | Unit | Fixture | Real-process | Live E2E | Windows | macOS | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Open archival footage workflow | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/A-archive-footage/` |
| B | Approval and revision flow | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/B-approval-revision/` |
| C | Additional stock footage (Pexels) | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/C-pexels-stock-claude/` |
| D | Remotion render + self-contained editable project | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/D-remotion-editable/` |
| E | HyperFrames render + editable workspace | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/E-hyperframes/` |
| F | Restart recovery — normal application restart | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/F-normal-restart/` |
| G | Recovery from real runner/agent interruption | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/G-runner-interruption/` |
| H | Pause / resume / cancel / duplicate prevention | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/H-process-control/` |
| I | Forced fatal failure + MES fallback | PASS | PASS | PASS | PASS | **PASS** | PASS | NOT EXECUTED | `evidence/I-fatal-fallback/` |
| J | OpenMontage-unavailable MES regression | PASS | PASS | PASS | N/R — no external process involved | **PASS** | PASS | NOT EXECUTED | `evidence/J-unavailable/` |

**Five rows are BLOCKED because no agent runner can currently authenticate.** Both supported
runners are implemented and detected correctly: Codex CLI 0.145.0 is authenticated but out of usage
capacity until Jul 31st, 2026, and Claude Code 2.1.220 is installed but reports
`Not logged in · Please run /login`. Full write-up and the exact one-command unblock:
`evidence/BLOCKED-agent-runner-auth/REPORT.md`. C and G were launched as real live productions and reached the real
engine — C completed `idea`, `script` and `scene_plan` and was waiting at a genuine approval gate
whose own summary said the next step was "begin real Pexels acquisition" — before every subsequent
Codex turn began failing. The full write-up, the confirming CLI transcript, the preserved partial
workspaces and the exact unblock steps are in `evidence/BLOCKED-codex-usage-limit/REPORT.md`.

These are recorded as BLOCKED, not as passes and not as N/A. Specs for all five
(`C-pexels-stock`, `E-hyperframes`, `G-runner-interruption`, `H-process-control`,
`I-fatal-fallback`) are written and committed under `D:\Work\openmontage-acceptance\specs\`; C and G
resume from their existing checkpoints rather than restarting.

`PEXELS_API_KEY` is **configured and not a blocker** — verified present as a 56-character Windows
user environment variable (value never read, printed or persisted). Scenario C was stopped before it
reached the Pexels call it was about to make.

### Correction to the previously recorded A/B/D/F/G result

The combined run `evidence/A-B-D-F-G/` was recorded as **PASS**. Re-evaluating it against the
output contract it actually requested yields **FAIL**:

```
FAIL A-B-D-F-G-real-managed-archive-remotion-approval-restart  (harness recorded PASS)
       FAIL output_present:editable_project
       FAIL editable_project_self_contained
```

The job requested `composition.editableOutput: true`. `editable/remotion/` was written with
composition sources but **no `package.json`**, so nothing was independently renderable, no
`editable_project` output was ever persisted, and the old harness still passed the run because it
decided PASS from `job.state === 'completed'` alone.

What that run *does* legitimately prove — real archive footage, the approval and revision gates, a
normal application restart preserving checkpoint and session, and duplicate-start rejection — is
credited above as A, B and F. The Remotion **editable-export** requirement is not credited, which is
why row D does not inherit that run's verdict.

The frame-rate question is also resolved: that job package contained **no `fps` field at all**, so
its 30 fps render violated no locked decision. The evaluator now reports an unlocked frame rate as
`NOT_APPLICABLE` rather than inventing a pass or a failure. Scenario D's package locks 24 fps
explicitly so the enforcement path is exercised for real.

---

## Agent runner support

Two managed runners are implemented behind one abstraction, both speaking the same
runner-neutral protocol `mes.openmontage.runner/v1`. No protocol version change was required.

| Capability | Codex CLI | Claude Code | Evidence |
| --- | --- | --- | --- |
| Pinned and bundled | PASS — `@openai/codex` 0.145.0 | PASS — `@anthropic-ai/claude-code` 2.1.220 | `package.json`, `electron-builder.yml` asarUnpack |
| Detect + version parse | PASS | PASS | `openmontage-codex-runner.test.ts`, `openmontage-claude-runner.test.ts` |
| Protocol probe against the real CLI | PASS | PASS | both suites |
| Authentication state reported truthfully | N/R — authenticated | PASS — reports `CLAUDE_NOT_AUTHENTICATED` | `openmontage-claude-runner.test.ts` |
| Launch construction (shell-free, array args) | PASS | PASS | both suites |
| Quota / auth / permission / network classification | PASS | PASS | `openmontage-contracts.test.ts`, `claude-failures` cases |
| Approval + revision handling | PASS — real subprocess | Implemented; **live NOT EXECUTED** (auth) | fixture-driven |
| Pause / resume / cancel | PASS — real subprocess | Implemented; **live NOT EXECUTED** (auth) | — |
| Windows process-tree cleanup | PASS — real parent+descendant | Shared `agent-core` implementation | `openmontage-process-tree.test.ts` |
| Stall detection | PASS | Implemented | — |
| Duplicate-launch prevention | PASS — live rejected | Managed-service level, runner-agnostic | `evidence/B-approval-revision/` |
| Secret redaction | PASS | PASS — shared redactor over env values | both suites |
| Runner selection (automatic / explicit / assisted) | PASS | PASS | `selectOpenMontageRunner` cases |
| Codex → Claude checkpoint migration | N/A | Implemented — resumes from canonical checkpoints, records a `runner_transition` event, regenerates nothing; **live NOT EXECUTED** (auth) | `claude-runner.mjs` |

The Claude runner's live rows are **NOT EXECUTED**, not passed: the CLI is installed and detected but
not logged in. Fixture-level and real-process coverage of the shared machinery is real, but it is not
a substitute for a live agent-governed production.

---

## UI validation from the real application

Captured by `scripts/openmontage-screenshots.mjs`, which launches the **built** Electron app against
a **real acceptance profile** (`profiles/D-remotion-editable`) — not the seeded UI fixture — so every
pixel comes from job, event, health and output rows a live production actually wrote.

| Screen | Status | Artefact |
| --- | --- | --- |
| Integration dashboard | PASS — real health probe + persisted jobs | `screenshots/live-D/01-integration-dashboard.png` |
| Health and capabilities | PASS — real capability/provider matrix | `screenshots/live-D/02-health-and-capabilities.png` |
| Settings → OpenMontage | PASS — credential **status** only, no values | `screenshots/live-D/11-settings.png` |
| New production, production plan, runtime comparison | NOT EXECUTED — the capture script could not resolve those controls in the automation channel; recorded as a gap, not a pass | — |
| Live production, storyboard approval | PASS — captured **in-run** by the acceptance harness during real productions | `evidence/D-remotion-editable/01-dashboard.png`, `02-approval.png`, `03-final.png`; `evidence/A-B-D-F-G/*.png` |
| Completed outputs | NOT EXECUTED in this pass — the job row click did not resolve; the completed job's data is captured in `evidence/D-remotion-editable/report.json` | — |
| Recovery | NOT EXECUTED — the D job recorded no recovery events; this state belongs to scenarios G/I, which are quota-blocked | — |
| Failure and fallback | NOT EXECUTED — belongs to scenario I, which is quota-blocked | — |

Measured on the same real render (`screenshots/live-D/ui-validation.json`):

- Windows viewport 1352×868, `documentScrollWidth == documentClientWidth` → **no horizontal overflow**.
- **0 renderer console errors.**
- 26 focusable controls; 4 flagged unlabelled, of which 3 are `<link rel=...>` elements matched by the
  audit's `[href]` selector (false positives) and 1 is an input carrying a `placeholder`. No
  genuinely unlabelled interactive control was found.

The ten screenshots under `screenshots/` from the earlier pass were taken from the real app but with
**fixture-seeded** UI state (`ME_SHOOT_SEED=1`). They are retained for layout reference and are
explicitly **not** counted as real-data evidence.

## Contract and unit coverage

| Area | Test | Status | Evidence |
| --- | --- | --- | --- |
| Job package | Valid v1 package accepted; duplicate media IDs rejected | PASS | `openmontage-contracts.test.ts` |
| Job package | Secret-shaped keys rejected before any write | PASS | `openmontage-contracts.test.ts` |
| Timeline | Ordered ranges, duration math, overlap, asset references, locked flags | PASS | `openmontage-contracts.test.ts`, `openmontage-ui-model.test.ts` |
| Output contract | Required kinds derived from the job request | PASS | `openmontage-postconditions.test.ts` |
| Output contract | Locked fps honoured; mismatch fails; unlocked fps reported honestly | PASS | `openmontage-postconditions.test.ts` (real ffmpeg + ffprobe) |
| Output contract | Requested resolution enforced | PASS | `openmontage-postconditions.test.ts` |
| Output contract | Editable export must be self-contained; sources-only rejected | PASS | `openmontage-postconditions.test.ts`, `openmontage-codex-runner.test.ts` |
| Failure taxonomy | Output-contract codes classify deterministically as retryable runtime faults | PASS | `openmontage-postconditions.test.ts` |
| Environment | Quote parsing, OS precedence, blocked process-control keys | PASS | `openmontage-environment.test.ts` |
| Environment | Missing default allowed; invalid explicit file fails closed without values | PASS | `openmontage-environment.test.ts`, `openmontage-health.test.ts` |
| Lifecycle | Valid transitions and terminal protection | PASS | `openmontage-contracts.test.ts` |
| Routing | Healthy → OpenMontage/Remotion; unavailable → MES; explicit runtime never substituted | PASS | `openmontage-contracts.test.ts` |
| Failure/security | Classification and recursive redaction | PASS | `openmontage-contracts.test.ts` |
| Type safety | Renderer and main TypeScript projects | PASS | `npm run typecheck` |

## Infrastructure and integration coverage

| Area | Scenario | Status | Evidence |
| --- | --- | --- | --- |
| Migration | Fresh database creates OpenMontage tables | PASS | `openmontage-db.test.ts` |
| Migration | Legacy database upgrades idempotently, existing data untouched | PASS | `openmontage-db.test.ts` |
| Migration | `runnerSessionId` column added idempotently | PASS | `openmontage-db.test.ts` |
| Persistence | Events deduplicate; guarded jobs reject stale/invalid transitions | PASS | `openmontage-db.test.ts` |
| Persistence | No credential columns exist | PASS | `openmontage-db.test.ts` |
| Health | Valid installation returns a compatible report | PASS | fixture + **real live probe** against `D:\Work\OpenMontage` |
| Health | Missing/moved/disabled installation degrades safely | PASS | `openmontage-health.test.ts` |
| Runtime | Remotion/HyperFrames/FFmpeg availability accurate | PASS | real provider-registry probe |
| Backlot | Loopback-only validation, health, state, SSE parsing, malformed/oversized payloads | PASS | `openmontage-backlot.test.ts` |
| Assisted | Package/workspace/prompt creation and restart recovery | PASS | `openmontage-assisted.test.ts` (7 tests) |
| Assisted | Traversal and secret-bearing packages rejected pre-write | PASS | `openmontage-assisted.test.ts` |
| Managed | Protocol handshake; malformed/oversized event rejection | PASS | `openmontage-runner-protocol.test.ts` |
| Managed | Start/pause/resume/cancel/approve/revise through a real subprocess | PASS | `openmontage-managed.test.ts` |
| Managed | Repository environment reaches the runner without persistence or event leakage | PASS | `openmontage-managed.test.ts` |
| Managed | Crash, stall, invalid output path, restart recovery | PASS | `openmontage-managed.test.ts` |
| Managed | Windows `taskkill` descendant cleanup, no orphan left | PASS | `openmontage-process-tree.test.ts` (real parent + child) |
| Codex runner | Pinned executable callable; protocol adapter reports `mes.openmontage.runner/v1` | PASS | `openmontage-codex-runner.test.ts` |
| Codex runner | Session persisted, real checkpoint revised, approved once, outputs validated | PASS | `openmontage-codex-runner.test.ts` |
| Codex runner | Requested editable export missing or sources-only ⇒ job fails, checkpoints preserved | PASS | `openmontage-codex-runner.test.ts` |
| Routing | Forced MES, forced OpenMontage, Automatic, tampered/stale plans | PASS | `openmontage-production.test.ts` |
| Fallback | Retry exhaustion starts MES and preserves OpenMontage files | PASS | `openmontage-production.test.ts` + Compose adapter |
| Fallback | Credentials skip retry; disabled fallback and cancellation never fall back | PASS | `openmontage-production.test.ts` |
| Sentry | Plan/start/retry/failure/fallback fields structured and redacted | PASS | lifecycle/fault fixtures |
| IPC | Health/read/control APIs aligned across `NativeApi`, preload, IPC; IDs/text validated | PASS | `openmontage-ipc-validation.test.ts` |
| Renderer model | Compose inputs, locked media/timing, motion, fillable gaps, state views, output formatting | PASS | `openmontage-ui-model.test.ts` |
| Test integrity | SQLite ABI mismatch is announced loudly and can be made fatal | PASS | verified in both directions against a genuinely broken ABI |

## UI coverage

Browser-level QA of every PRD state was completed in an earlier milestone (ten 1352×868 captures
under `docs/openmontage-integration/screenshots/`). The objective requires **fresh** captures from
the final built application driven by real persisted jobs.

| PRD screen | Implemented | Real-data binding | Fresh screenshot from final build |
| --- | --- | --- | --- |
| Integration dashboard | PASS | PASS | NOT EXECUTED |
| Health and capabilities | PASS | PASS | NOT EXECUTED |
| New production | PASS | PASS | NOT EXECUTED |
| Production plan | PASS | PASS | NOT EXECUTED |
| Live production | PASS | PASS | NOT EXECUTED |
| Storyboard approval | PASS | PASS | NOT EXECUTED |
| Runtime comparison | PASS | PASS | NOT EXECUTED |
| Recovery | PASS | PASS | NOT EXECUTED |
| Failure and fallback | PASS | PASS | NOT EXECUTED |
| Completed outputs | PASS | PASS | NOT EXECUTED |
| Settings → OpenMontage | PASS | PASS | NOT EXECUTED |

## Release validation gates

| Gate | Status | Detail |
| --- | --- | --- |
| Full test suite (Node ABI) | PASS | 73 files / 599 tests pass; 2 opt-in skips |
| Live OpenMontage health probe | PASS | `ME_OPENMONTAGE_LIVE=1`, real revision + both composition runtimes |
| Typecheck | PASS | renderer + main projects |
| Production build | PASS | `npm run build` |
| Electron native ABI | PASS | `@electron/rebuild -f -w better-sqlite3` |
| Windows unpacked package | NOT EXECUTED | `npm run dist:dir` pending the final code change |
| Smokes `1`, `m3`–`m7` | NOT EXECUTED | pending the final code change |
| Secret scan | PASS | 398 tracked files; 7 hits, all intentional fixture values |
| Committed-evidence credential audit | PASS | statuses and counts only; no values or tokens |
| Security review | PASS (manual) | `SECURITY_REVIEW.md` — the `codex-security` skill is unavailable here |
| Dependency advisories | PASS (analysed) | shipped vs dev split; one safe non-breaking override |
| External repository cleanliness | PASS | pinned OpenMontage checkout untouched; empty nested residual removed |

### The 2 remaining test skips

Both are deliberate opt-in gates, not hidden failures:

1. `preset-frames-manual.test.ts` — manual visual harness.
2. `openmontage-health.test.ts` live probe — requires `ME_OPENMONTAGE_LIVE=1`; **executed
   separately and passing** against the real checkout.

Earlier runs of this suite reported 62 skips because `better-sqlite3` was built for Electron, which
silently dropped ~60 tests across OpenMontage persistence, the managed runner, production
routing/fallback, the Codex runner, assisted handoff and TalkingPhotos. That failure mode is now
loud and can be made fatal with `ME_REQUIRE_SQLITE=1`.

---

## Blockers

### C — Additional stock footage: `PEXELS_API_KEY`

1. **Blocker.** No Pexels API key is available. `PEXELS_API_KEY` is absent from the User, Machine
   and Process environments, and neither `D:\Work\OpenMontage\.env` nor `.env.local` exists.
2. **Why required.** Scenario C must demonstrate a *real* provider API request, a real downloaded
   motion clip, and real provider/licence provenance. A fixture would not satisfy it.
3. **Exactly what is needed.** A free Pexels API key set as the Windows **user** environment
   variable `PEXELS_API_KEY`.
4. **Where to get it.** <https://www.pexels.com/api/> — free, no payment.
5. **Zero-cost alternative already taken.** Scenario A used keyless open sources (NASA and Wikimedia
   Commons) and passed, so archive-footage acquisition is proven without any credential. There is no
   zero-cost substitute for *Pexels specifically*.
6. **What resumes on receipt.** A scenario-C spec is generated, `npm run build` runs, the harness
   drives a live Pexels-backed production, and the evidence report records the provider request,
   licence provenance, asset SHA-256s, the final MP4's ffprobe output and a PASS/FAIL verdict.

The key is never printed, persisted, or copied into evidence — only `configured: true/false` status.
