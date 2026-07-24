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
| A | Open archival footage workflow | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/A-B-D-F-G/` |
| B | Approval and revision flow | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/A-B-D-F-G/` |
| C | Additional stock footage (Pexels) | PASS | PASS | PASS | NOT EXECUTED | **BLOCKED** | NOT EXECUTED | NOT EXECUTED | none — see blocker below |
| D | Remotion render + self-contained editable project | PASS | PASS | PASS | PASS | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | `evidence/D-remotion-editable/` |
| E | HyperFrames render + editable workspace | PASS | PASS | NOT EXECUTED | NOT EXECUTED | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | none |
| F | Restart recovery — normal application restart | PASS | PASS | PASS | PASS | PASS | PASS | NOT EXECUTED | `evidence/A-B-D-F-G/` |
| G | Recovery from real runner/agent interruption | PASS | PASS | PASS | PASS | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | none |
| H | Pause / resume / cancel / duplicate prevention | PASS | PASS | PASS | PASS | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | none |
| I | Forced fatal failure + MES fallback | PASS | PASS | PASS | PASS | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | none |
| J | OpenMontage-unavailable MES regression | PASS | PASS | PASS | N/R — no external process involved | **NOT EXECUTED** | NOT EXECUTED | NOT EXECUTED | none |

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
