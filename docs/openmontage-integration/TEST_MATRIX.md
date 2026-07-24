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
| Migration | Fresh database creates OpenMontage tables | PENDING |
| Migration | Legacy database upgrades idempotently | PENDING |
| Persistence | Events deduplicate and terminal jobs cannot regress | PENDING |
| Health | Valid installation returns compatible report | PENDING |
| Health | Missing/moved installation degrades safely | PENDING |
| Runtime | Remotion/HyperFrames/FFmpeg availability is accurate | PENDING |
| Backlot | Health, state, SSE reconnect, timeout, malformed payload | PENDING |
| Assisted | Package/workspace/prompt creation and restart recovery | PENDING |
| Managed | Fixture runner start/pause/resume/cancel/approval | PENDING |
| Fallback | Retry exhaustion starts MES and preserves files | PENDING |
| Sentry | Structured lifecycle fields present; secrets absent | PENDING |
| IPC | Renderer has typed, sanitized errors for all actions | PENDING |

## UI coverage

| PRD state | Status |
| --- | --- |
| Integration dashboard | PENDING |
| New Production seven-step setup | PENDING |
| Automatic workflow decision | PENDING |
| Live production progress | PENDING |
| Storyboard approval gate | PENDING |
| Remotion versus HyperFrames comparison | PENDING |
| Recoverable interruption | PENDING |
| Failure and MES fallback | PENDING |
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
