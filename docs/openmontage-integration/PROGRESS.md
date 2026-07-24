# OpenMontage Integration Progress

Last updated: 2026-07-24

## Current status

Phase 1 is complete. Phase 2 (persistence and health infrastructure) is next.

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

## Blockers / limitations

- No managed agent runner has been configured yet. Assisted mode is the implementation baseline.
- Remotion must be installed and re-probed before claiming the archival-footage acceptance scenario.
- Provider-dependent acceptance may require credentials/network. Any unavailable provider will be reported rather than mocked as a live pass.

## Next task

Implement Phase 2: SQLite persistence, safe settings, compatibility/health probes, Backlot client, typed service/IPC/preload APIs, and fixture-backed tests.
