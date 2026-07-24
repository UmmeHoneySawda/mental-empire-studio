# OpenMontage Integration Progress

Last updated: 2026-07-24

## Current status

Phases 1–7 are complete. The MES integration is implemented, tested, packaged, visually validated, and ready for review.

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
- Added tamper-checked production plans with persisted route decisions, health evidence, reasons, and warnings.
- Connected forced MES, forced OpenMontage, and Automatic routing to real production start paths.
- Enforced the Documentary Montage → Remotion constraint before launch.
- Added managed-to-assisted degradation when the configured runner is unavailable.
- Added classified automatic retry supervision with checkpoint-preserving resume.
- Added eligible MES fallback after retry exhaustion and explicit cancellation/fallback-disable protections.
- Added an idempotent adapter that reuses or creates ordinary MES Compose projects from local narration.
- Added routing/retry/fallback Sentry lifecycle events with sanitized primitive fields.
- Added eleven production/fallback integration tests, including real subprocess faults and the real MES project adapter.
- Added the native OpenMontage navigation destination and live integration dashboard.
- Added the seven-step source, media-control, style, composition, approval, output, and review workflow.
- Added a pure Compose-project-to-v1-package renderer model with locked-media preservation and dimension mapping.
- Added the health-backed automatic plan review and start flow without trusting renderer-selected engines.
- Added the neutral Remotion/HyperFrames comparison modal and project-specific recommendation.
- Added live stage progress, scene selection, telemetry, activity, pause, cancel, and logs controls.
- Added storyboard approval and revision controls routed through the managed API.
- Added restart recovery, checkpoint history, failure/fallback, assisted handoff, cancellation, and completed-output workspaces.
- Added Settings → OpenMontage for installation, runners, capabilities, credential status, reliability, and full health checks.
- Added loading, empty, degraded/offline, keyboard focus, and scroll-reset behavior.
- Added browser QA fixtures for live, approval, recovery, fallback, completion, and assisted jobs through the typed production API.
- Completed a 1352×868 browser visual pass of all ten PRD states with no renderer console errors.
- Added five renderer-model tests; the focused Phase 1–6 suite now passes 62 tests with one opt-in live test skipped by default.
- Installed the external Remotion composer dependencies with `npm ci`; OpenMontage remained clean because `node_modules` is ignored and no lock/source file changed.
- Enumerated all 13 bundled Remotion compositions successfully with the external CLI.
- Tightened the opt-in live health test so a real Remotion installation is required, then passed that probe.
- Ran the complete MES suite: 69 files and 574 tests passed; two documented opt-in/manual tests were skipped.
- Rebuilt `better-sqlite3` for Electron and passed TypeScript, production build, all supported milestone smokes (`1`, `m3`–`m7`), and `dist:dir` packaging.
- Exercised Local Assets through the real SQLite/process/protocol boundary with package, locked-media, checkpoint, output, retry, and restart-recovery evidence.
- Attempted the Web Content and Open Archival Footage acceptance gates. Capability discovery and Remotion validation pass, but a truthful full production requires a configured supported agent runner plus provider/operator execution.
- Saved all ten final PRD screenshots at exactly 1352×868 in `docs/openmontage-integration/screenshots/`.
- Audited the branch scope, secret patterns, production-media extensions, and nested repository cleanliness.

## Verified facts

- Backlot exposes read-only health, project state, event streams, thumbnail, and media routes.
- OpenMontage orchestration is agent-driven; its Python modules are tools and persistence, not a production orchestrator.
- Current machine probe: Python 3.11.9, Node 22.16.0, FFmpeg, HyperFrames, and Remotion available.
- The external Remotion CLI enumerates `Explainer`, `CinematicRenderer`, `SignalFromTomorrowWithMusic`, `TalkingHead`, `TitledVideo`, `HeroTitle`, `ProductReveal`, `ProductRevealVertical`, `CaptionOverlayOnly`, `CollageBurst`, `LyricOverlay`, `EndTag`, and `EndTagOverlay`.
- Documentary Montage correctly requires Remotion; that runtime gate now passes on this machine.

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
| Focused Phase 1–5 suite (ten files) | PASS — 57 tests; live-only case skipped by default |
| Production/fallback fault suite | PASS — 11 tests |
| Focused Phase 1–6 suite (eleven files) | PASS — 62 tests; live-only case skipped by default |
| `npm run typecheck` after renderer integration | PASS |
| `npm run build` after renderer integration | PASS |
| Browser QA at 1352×868 | PASS — ten PRD states reachable; no console errors |
| `npm test` | PASS — 69 files, 574 tests; 2 documented skips |
| Opt-in live health probe after Remotion install | PASS — installation/revision/Python/FFmpeg/Remotion/HyperFrames |
| `npx remotion compositions src/index.tsx` in external composer | PASS — 13 compositions enumerated |
| `npx @electron/rebuild -f -w better-sqlite3` | PASS — Electron ABI rebuild complete |
| Supported Electron smokes | PASS — `SMOKE_OK`, `SMOKE_M3_OK` through `SMOKE_M7_OK` |
| `npm run dist:dir` | PASS — Windows unpacked application packaged |
| Final screenshot dimensions | PASS — ten PNGs, each 1352×868 |
| Nested OpenMontage status | PASS — clean at `0af32ce5e1e830c33992af1f9179dcdcd536549b` |

## External acceptance limitations

- Managed mode requires a configured runner executable that proves `mes.openmontage.runner/v1`; assisted mode remains launch-ready without it.
- Web Content was not reported as a live pass: provider capability discovery succeeds, but no supported production agent runner was configured for an acquired-through-completion run.
- Open Archival Footage was not reported as a live pass: Archive and Remotion capabilities are available, but full agent-governed acquisition/composition was not run without a supported runner and its required approval flow.
- `npm ci` reported one high-severity advisory in the external Remotion dependency tree. No automatic audit fix was applied because that could mutate OpenMontage's lock/source boundary.
- Remotion composition enumeration emitted two non-fatal localhost `/public/` 404 warnings after successfully listing the compositions.

## Next task

Review the branch and, when a production runner is selected, execute the two explicitly blocked live scenarios without changing the MES/OpenMontage ownership boundary.
