# OpenMontage Integration Progress

Last updated: 2026-07-24

## Current status

Phases 1–4 are complete. Phase 5 (routing, fallback, and telemetry) is next.

## Completed

- Created and switched to `feat/openmontage-integration`.
- Read the MES product, milestone, Sentry, PRD, and project instruction docs.
- Read the relevant OpenMontage architecture, agent, checkpoint, pipeline, asset, compose, and Backlot docs/code.
- Verified OpenMontage is an independent clean repository at revision `0af32ce5e1e830c33992af1f9179dcdcd536549b`.
- Probed local providers and composition runtimes without modifying OpenMontage.
- Inspected the Figma Make context and all supplied reference screenshots.
- Defined the code-first integration contract in `shared/openmontage.ts`.
- Published `schemas/job-package.v1.schema.json`.
- Added guarded job states, deterministic routing, failure classification, validation, and recursive diagnostic redaction.
- Added nine focused unit tests.
- Documented architecture, implementation plan, decisions, and initial test matrix.
- Added idempotent SQLite tables for integration jobs, deduplicated events, and outputs.
- Added compare-and-set job transitions, restart recovery queries, reset behavior, and boundary redaction.
- Added credential-free OpenMontage settings and defaults.
- Added repository revision/compatibility, Python, provider, composition runtime, Backlot, and runner-mode health probes.
- Added a loopback-only Backlot JSON/SSE client with response limits and recursive sanitization.
- Added typed health/job/event/output/Backlot APIs across `NativeApi`, preload, IPC, and service layers.
- Added Sentry-wide health and Backlot observation events using sanitized primitive attributes.
- Added idempotent assisted preparation backed by OpenMontage's own `init_project` API.
- Added atomic job package, agent instruction, and recovery prompt files in the canonical project workspace.
- Added strict project-ID containment checks, locked-media preservation, and pipeline-specific runtime blocking.
- Added copy prompt, open project folder, and start/open Backlot actions through typed IPC.
- Added startup recovery for prepared or interrupted assisted jobs.
- Added seven fixture-backed assisted lifecycle/recovery/security tests.
- Added the replaceable `mes.openmontage.runner/v1` JSON-lines protocol and compatibility proof.
- Added shell-free external runner launch with bounded/redacted streams and explicit handshake, command, and stall timeouts.
- Added durable stage/checkpoint/output/activity ingestion with runner-event deduplication and output-path containment.
- Added pause, resume, cancel, approval, revision, retry, and restart-recovery controls across service, IPC, preload, and `NativeApi`.
- Added Backlot observation at runner checkpoints without mutating OpenMontage state.
- Added a real Node subprocess fixture covering completion, controls, approvals, redaction, crashes, stalls, invalid output, and recovery.
- Added startup recovery for managed jobs when managed mode is configured.

## Verified facts

- Backlot exposes read-only health, project state, event streams, thumbnail, and media routes.
- OpenMontage orchestration is agent-driven; its Python modules are tools and persistence, not a production orchestrator.
- Current machine probe: Python 3.11.9, Node 22.16.0, FFmpeg available, HyperFrames available.
- Remotion is currently unavailable because the external composer workspace is not installed/configured.
- Documentary Montage currently requires Remotion for compose; HyperFrames availability alone does not satisfy that acceptance scenario.

## Verification

| Command | Result |
| --- | --- |
| `npm test -- --run test/unit/openmontage-contracts.test.ts` | PASS — 9 tests |
| `npm run typecheck` | PASS |
| Focused Phase 1–2 suite (five files) | PASS — 26 tests; live-only case skipped by default |
| `ME_OPENMONTAGE_LIVE=1` health test | PASS — real external repository and provider registry |
| `npm run build` | PASS |
| Focused Phase 1–3 suite (six files) | PASS — 33 tests; live-only case skipped by default |
| Managed protocol/subprocess suite | PASS — 12 tests |
| Focused Phase 4 infrastructure suite | PASS — 34 tests; live-only case skipped by default |

## Blockers / limitations

- Managed mode requires a configured runner executable that proves `mes.openmontage.runner/v1`; assisted mode remains launch-ready without it.
- Remotion must be installed and re-probed before claiming the archival-footage acceptance scenario.
- Provider-dependent acceptance may require credentials/network. Any unavailable provider will be reported rather than mocked as a live pass.
- `better-sqlite3` is currently rebuilt for Node to execute DB tests. Rebuild it for Electron before app/smoke/package validation.

## Next task

Implement Phase 5: connect routing to production creation, enforce fallback eligibility/retry limits, preserve OpenMontage evidence, and add Sentry/fault-injection coverage.
