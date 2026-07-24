# OpenMontage Integration Implementation Plan

## Phase 1 — Architecture and contracts

- [x] Inspect MES and OpenMontage architecture and operational docs.
- [x] Verify the nested OpenMontage repository and current runtime capabilities.
- [x] Define versioned MES job package and JSON Schema.
- [x] Define health, capability, routing, lifecycle, stage, and failure contracts.
- [x] Add pure validation, routing, state-machine, failure, and redaction tests.
- [x] Record architecture and decisions.

Exit evidence: focused contract tests and TypeScript typecheck pass.

## Phase 2 — Persistence and health infrastructure

- [x] Add idempotent SQLite tables/repository methods for jobs, events, and outputs.
- [x] Add OpenMontage settings with safe defaults and no credential values.
- [x] Implement installation resolution and compatibility/runtime/provider probes.
- [x] Implement loopback-only Backlot health/state/SSE client and sanitized event ingestion.
- [x] Add service, IPC, preload, and `NativeApi` surfaces.
- [x] Add health and persistence tests.

Exit evidence: health report from the real local installation, migration/restart tests, full typecheck/build.

## Phase 3 — Assisted handoff

- [x] Materialize a validated job package atomically.
- [x] Initialize or reuse an OpenMontage project workspace.
- [x] Generate a deterministic agent instruction and recovery prompt.
- [x] Add open folder, open Backlot, and copy prompt actions.
- [x] Persist handoff and recovery state.
- [x] Add fixture-backed assisted lifecycle tests.

Exit evidence: new project can be handed off and rediscovered after MES restart.

## Phase 4 — Managed execution

- [x] Define replaceable runner adapter protocol.
- [x] Implement configured process runner with structured JSON events.
- [x] Add pause/resume/cancel, retries, timeouts, and process recovery.
- [x] Reconcile runner events with Backlot/checkpoint observation.
- [x] Route approval/revision commands through the runner.
- [x] Add fixture runner for deterministic integration tests.

Exit evidence: managed fixture completes, pauses/resumes, awaits approval, and recovers after service restart.

## Phase 5 — Routing, fallback, and telemetry

- [x] Connect pure routing to production creation.
- [x] Enforce pipeline-specific runtime constraints.
- [x] Implement classified retries and MES fallback.
- [x] Preserve OpenMontage workspace on failure.
- [x] Add wide Sentry lifecycle/failure/fallback logs and exception capture.
- [x] Add fault-injection tests.

Exit evidence: forced modes, automatic decision reasons, retry policy, cancel behavior, and fallback are deterministic.

## Phase 6 — Production UI

- [ ] Add OpenMontage dashboard and navigation group.
- [ ] Add seven-step New Production setup and plan review.
- [ ] Add neutral Remotion/HyperFrames comparison.
- [ ] Add live timeline, activity, telemetry, and stage controls.
- [ ] Add storyboard approval/revision interface.
- [ ] Add recovery, failure/fallback, completion/output, and settings states.
- [ ] Add empty, loading, degraded, offline, and keyboard/focus states.
- [ ] Keep renderer data live through typed APIs.

Exit evidence: all ten PRD screen states are reachable from real or fixture-backed data.

## Phase 7 — Validation and handoff

- [ ] Run unit/integration tests, typecheck, build, and supported smoke harnesses.
- [ ] Exercise Local Assets, Web Content, and Open Archival Footage scenarios.
- [ ] Install/validate Remotion dependencies if required for archival acceptance.
- [ ] Capture screenshots at the required desktop viewport and compare with references.
- [ ] Verify dirty-tree scope, secret scan, nested OpenMontage cleanliness, and no generated media.
- [ ] Finalize test matrix, progress, and next-agent handoff.

Acceptance scenarios are reported as passed only with captured command/output evidence. Environment or provider limitations are recorded as blockers, not reclassified as success.
