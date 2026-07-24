# OpenMontage Integration Test Matrix

Legend: PASS = executed with evidence; PENDING = not implemented/executed; BLOCKED = environment prevents truthful execution.

## Contract and unit coverage

| Area | Test | Status | Evidence |
| --- | --- | --- | --- |
| Job package | Valid v1 package accepted | PASS | `openmontage-contracts.test.ts` |
| Job package | Duplicate media IDs rejected | PASS | `openmontage-contracts.test.ts` |
| Security | Secret-shaped keys rejected | PASS | `openmontage-contracts.test.ts` |
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
| Backlot | SSE reconnect and long-running ingestion | PENDING |
| Assisted | Package/workspace/prompt creation and restart recovery | PASS — 7 fixture-backed tests |
| Managed | Protocol handshake and malformed/oversized event rejection | PASS — 5 tests |
| Managed | Fixture runner start/pause/resume/cancel/approval/revision | PASS — real Node subprocess |
| Managed | Crash, stall, invalid output, and restart recovery | PASS — real Node subprocess |
| Routing | Forced MES, forced OpenMontage, Automatic, and tampered/stale plans | PASS |
| Routing | Documentary Montage rejects missing/non-Remotion runtime | PASS |
| Reliability | Transient provider failure resumes and completes | PASS — real subprocess |
| Fallback | Retry exhaustion starts MES and preserves OpenMontage files | PASS — real subprocess + Compose adapter |
| Fallback | Credentials skip retry; disabled fallback and cancellation never fallback | PASS |
| Fallback | Adapter failure is terminal and secret-redacted | PASS |
| Sentry | Plan/start/retry/failure/fallback fields are structured and redacted | PASS — lifecycle/fault fixtures |
| IPC | Health/read/control APIs aligned across NativeApi, preload, and IPC; IDs/text validated | PASS |

## UI coverage

| PRD state | Status |
| --- | --- |
| Integration dashboard | PENDING |
| New Production seven-step setup | PENDING |
| Automatic workflow decision | BACKEND PASS; UI PENDING |
| Live production progress | PENDING |
| Storyboard approval gate | PENDING |
| Remotion versus HyperFrames comparison | PENDING |
| Recoverable interruption | PENDING |
| Failure and MES fallback | BACKEND PASS; UI PENDING |
| Completed production outputs | PENDING |
| OpenMontage settings | PENDING |
| Loading/empty/degraded/offline/focus states | PENDING |

## Acceptance scenarios

| Scenario | Required evidence | Status |
| --- | --- | --- |
| Local Assets | End-to-end package, run, checkpoint, output, restart recovery | PENDING |
| Web Content | Live/provider-backed acquisition through completion | PENDING |
| Open Archival Footage | Archive acquisition and Remotion compose through completion | BLOCKED — Remotion currently unavailable |

No PENDING or BLOCKED row may be reported as passing.
