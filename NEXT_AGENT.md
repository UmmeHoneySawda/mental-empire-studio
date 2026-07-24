# Next Agent Handoff

## Repository state

- MES root: `D:\Work\mental-empire-studio`
- Branch: `feat/openmontage-integration`
- Base commit: `4d78fab8709a2cd2811e50bc72d8fd16c785c418`
- Latest completed milestone: Phase 4 — managed runner execution
- OpenMontage root: `D:\Work\mental-empire-studio\OpenMontage`
- OpenMontage revision: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Current phase: Phase 5 — routing, fallback, and telemetry

## Completed

- Architecture and runtime investigation.
- Figma/reference review.
- MES-owned job package v1 and JSON Schema.
- Lifecycle, routing, failure taxonomy, validation, and redaction.
- Focused unit tests and continuity docs.
- Idempotent SQLite integration job/event/output persistence with guarded transitions.
- Credential-free settings, real compatibility/provider/runtime probing, and cached health reports.
- Loopback-only Backlot health/state/SSE observation.
- Typed service, IPC, preload, and renderer contracts.
- Assisted workspace initialization through OpenMontage's checkpoint library.
- Atomic job package/instruction/recovery files with typed local actions.
- Startup rediscovery and resume of interrupted preparation.
- Versioned JSON-lines runner protocol with compatibility proof and strict parsing.
- Shell-free managed subprocess execution with bounded/redacted streams.
- Durable checkpoint/output/activity ingestion and Backlot observation.
- Pause/resume/cancel/approval/revision/retry controls.
- Managed restart recovery, fault classification, and output-path containment.
- Deterministic real-subprocess fixture coverage.

## Changed files

- `shared/openmontage.ts`
- `test/unit/openmontage-contracts.test.ts`
- `electron/db/index.ts`
- `electron/ipc/openmontage.ts`
- `electron/ipc/register.ts`
- `electron/preload.ts`
- `electron/services/openmontage/backlot.ts`
- `electron/services/openmontage/health.ts`
- `electron/services/openmontage/index.ts`
- `shared/types.ts`
- `test/unit/openmontage-backlot.test.ts`
- `test/unit/openmontage-db.test.ts`
- `test/unit/openmontage-health.test.ts`
- `test/unit/openmontage-ipc-validation.test.ts`
- `electron/main.ts`
- `electron/services/openmontage/assisted.ts`
- `electron/services/openmontage/managed.ts`
- `test/stubs/electron.ts`
- `test/unit/openmontage-assisted.test.ts`
- `shared/openmontage-runner.ts`
- `test/fixtures/openmontage-runner.mjs`
- `test/unit/openmontage-runner-protocol.test.ts`
- `test/unit/openmontage-managed.test.ts`
- `docs/openmontage-integration/schemas/job-package.v1.schema.json`
- `docs/openmontage-integration/ARCHITECTURE.md`
- `docs/openmontage-integration/IMPLEMENTATION_PLAN.md`
- `docs/openmontage-integration/DECISIONS.md`
- `docs/openmontage-integration/PROGRESS.md`
- `docs/openmontage-integration/TEST_MATRIX.md`
- `NEXT_AGENT.md`

The pre-existing untracked `OpenMontage/` and `docs/openmontage-integration/PRD.md` are user-provided. Do not stage the nested OpenMontage repository as MES content.

## Tests run

```powershell
npm test -- --run test/unit/openmontage-contracts.test.ts
npm run typecheck
npm test -- --run test/unit/openmontage-contracts.test.ts test/unit/openmontage-db.test.ts test/unit/openmontage-backlot.test.ts test/unit/openmontage-health.test.ts test/unit/openmontage-ipc-validation.test.ts
$env:ME_OPENMONTAGE_LIVE='1'; npm test -- --run test/unit/openmontage-health.test.ts
npm run build
npm test -- --run test/unit/openmontage-assisted.test.ts
npm test -- --run test/unit/openmontage-runner-protocol.test.ts test/unit/openmontage-managed.test.ts
```

All pass. Managed protocol/subprocess suite: 12 tests. The opt-in live probe also passes against the checked-out external repository.

## Current environment and blockers

- Python 3.11.9 and Node 22.16.0.
- FFmpeg and HyperFrames probe as available.
- Remotion probes unavailable until its external workspace dependencies are installed.
- Managed mode needs a configured runner that proves `mes.openmontage.runner/v1`; the test fixture is not a production runner.
- Backlot is read-only; do not invent approval/control HTTP endpoints.
- `better-sqlite3` is currently built for Node so DB tests execute. Run `npx @electron/rebuild -f -w better-sqlite3` before launching Electron, smoke tests, or packaging.

## Exact next task

Implement Phase 5:

1. Add a production-routing service that combines user selection, health, pipeline/runtime requirements, and execution mode.
2. Persist and expose the selected engine/runtime and user-visible decision reasons.
3. Apply retry limits only to eligible classified failures.
4. Start the existing MES production path after eligible retry exhaustion when policy allows.
5. Preserve the failed OpenMontage workspace/checkpoints and never fallback on cancellation.
6. Add structured Sentry lifecycle/fallback events and fault-injection tests.
7. Update continuity docs and commit the verified milestone.

## Useful commands

```powershell
git status --short --branch
npm test -- --run test/unit/openmontage-contracts.test.ts
npm run typecheck
npm run build
git -C OpenMontage status --short --branch
```

## Setup notes

- Follow `docs/SENTRY_LOGGING.md` for every integration service/job log.
- Use `sentryLog` and `captureException` from `electron/services/sentry.ts`.
- Keep `NativeApi`, IPC registration, and `electron/preload.ts` aligned.
- Add new DB columns with `ensureColumn`; use idempotent `CREATE TABLE IF NOT EXISTS` only for genuinely new tables.
- Credentials remain in OpenMontage/runner environments; store and expose status only.
- Preserve the existing MES design tokens and self-hosted fonts.
