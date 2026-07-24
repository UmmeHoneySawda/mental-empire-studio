# OpenMontage Integration Test Matrix

Legend: PASS = executed with evidence; PENDING = not implemented/executed; BLOCKED = environment prevents truthful execution.

## Contract and unit coverage

| Area | Test | Status | Evidence |
| --- | --- | --- | --- |
| Job package | Valid v1 package accepted | PASS | `openmontage-contracts.test.ts` |
| Job package | Duplicate media IDs rejected | PASS | `openmontage-contracts.test.ts` |
| Security | Secret-shaped keys rejected | PASS | `openmontage-contracts.test.ts` |
| Timeline | Ordered ranges, duration math, overlap, and asset references | PASS | `openmontage-contracts.test.ts`, `openmontage-ui-model.test.ts` |
| Environment | Quote parsing, precedence, fixed overrides, blocked process controls | PASS | `openmontage-environment.test.ts` |
| Environment | Missing default allowed; missing explicit/invalid file fails closed without values | PASS | `openmontage-environment.test.ts`, `openmontage-health.test.ts` |
| Lifecycle | Valid transitions and terminal protection | PASS | `openmontage-contracts.test.ts` |
| Routing | Healthy automatic request selects OpenMontage/Remotion | PASS | `openmontage-contracts.test.ts` |
| Routing | Unavailable automatic request selects MES | PASS | `openmontage-contracts.test.ts` |
| Routing | Explicit unavailable runtime is not substituted | PASS | `openmontage-contracts.test.ts` |
| Execution mode | Assisted mode does not require managed runner | PASS | `openmontage-contracts.test.ts` |
| Failure/security | Failure classification and recursive redaction | PASS | `openmontage-contracts.test.ts` |
| Type safety | Renderer and main TypeScript projects | PASS | `npm run typecheck` |

## Infrastructure and integration coverage

| Area | Scenario | Status |
| --- | --- | --- |
| Migration | Fresh database creates OpenMontage tables | PASS — Node ABI DB test |
| Migration | Legacy database upgrades idempotently | PASS — Node ABI DB test |
| Persistence | Events deduplicate and guarded jobs reject stale/invalid transitions | PASS — Node ABI DB test |
| Health | Valid installation returns compatible report | PASS — fixture + real live probe |
| Health | Missing/moved/disabled installation degrades safely | PASS |
| Runtime | Remotion/HyperFrames/FFmpeg availability is accurate | PASS — real provider-registry probe |
| Backlot | Loopback validation, health, state, SSE parsing, malformed/oversized payload | PASS |
| Backlot | Fragmented SSE parsing, sanitization, and bounded buffering | PASS |
| Backlot | Automatic reconnect of an ended observer stream | NOT REQUIRED — production reconciliation uses checkpoint snapshots; a caller may establish a new observation stream |
| Assisted | Package/workspace/prompt creation and restart recovery | PASS — 7 fixture-backed tests |
| Managed | Protocol handshake and malformed/oversized event rejection | PASS — 5 tests |
| Managed | Fixture runner start/pause/resume/cancel/approval/revision | PASS — real Node subprocess |
| Managed | Repository environment reaches runner without persistence/event leakage | PASS — real Node subprocess |
| Managed | Crash, stall, invalid output, and restart recovery | PASS — real Node subprocess |
| Routing | Forced MES, forced OpenMontage, Automatic, and tampered/stale plans | PASS |
| Routing | Documentary Montage rejects missing/non-Remotion runtime | PASS |
| Reliability | Transient provider failure resumes and completes | PASS — real subprocess |
| Fallback | Retry exhaustion starts MES and preserves OpenMontage files | PASS — real subprocess + Compose adapter |
| Fallback | Credentials skip retry; disabled fallback and cancellation never fallback | PASS |
| Fallback | Adapter failure is terminal and secret-redacted | PASS |
| Sentry | Plan/start/retry/failure/fallback fields are structured and redacted | PASS — lifecycle/fault fixtures |
| IPC | Health/read/control APIs aligned across NativeApi, preload, and IPC; IDs/text validated | PASS |
| Renderer model | Compose inputs, dimensions, locked media/timing, motion, fillable gaps, state views, and output formatting | PASS — 6 tests |

## UI coverage

| PRD state | Status |
| --- | --- |
| Integration dashboard | PASS — typed health/jobs + 1352×868 browser QA |
| New Production seven-step setup | PASS — typed Compose source + browser QA |
| Automatic workflow decision | PASS — main-process plan + browser QA |
| Live production progress | PASS — typed polling/controls + browser QA |
| Storyboard approval gate | PASS — approve/revise API + browser QA |
| Remotion versus HyperFrames comparison | PASS — browser QA |
| Recoverable interruption | PASS — durable recovery event + browser QA |
| Failure and MES fallback | PASS — backend fault test + browser QA |
| Completed production outputs | PASS — persisted output API + browser QA |
| OpenMontage settings | PASS — typed settings/health + browser QA |
| Loading/empty/degraded/offline/focus states | PASS — defensive state rendering + keyboard controls |
| Final viewport artifacts | PASS — ten saved PNGs, each 1352×868 |

## Acceptance scenarios

| Scenario | Required evidence | Status |
| --- | --- | --- |
| Local Assets | End-to-end package, run, checkpoint, output, restart recovery | PASS — deterministic real-process integration fixture plus SQLite/workspace/locked-media/recovery evidence |
| Web Content | Live/provider-backed acquisition through completion | BLOCKED — provider discovery passes, but no supported production agent runner is configured |
| Open Archival Footage | Archive acquisition and Remotion compose through completion | BLOCKED — Archive and Remotion probe successfully, but a full agent-governed production was not run without a supported runner/approval flow |

No PENDING or BLOCKED row may be reported as passing.

## Release validation

| Gate | Status |
| --- | --- |
| Full test suite | PASS — 69 files, 574 tests; 2 skips |
| Live OpenMontage health | PASS — real revision and both composition runtimes |
| Typecheck | PASS |
| Production build | PASS |
| Electron native ABI | PASS |
| Smokes `1`, `m3`–`m7` | PASS |
| Windows unpacked package | PASS |
| Secret/scope/media audit | PASS |
| External repository cleanliness | PASS |
