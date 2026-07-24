# OpenMontage Integration Decision Log

## D-001 — External repository boundary

**Decision:** Treat OpenMontage as an independent installation. Do not copy its source or build-time types into MES.

**Reason:** OpenMontage is an agent-first system with its own pipelines and checkpoints. A stable MES adapter boundary prevents source drift and preserves independent upgrades.

## D-002 — MES-owned versioned job package

**Decision:** Use `mes.openmontage.job/v1` as a strict, credential-free handoff format, backed by a JSON Schema and runtime validation.

**Reason:** OpenMontage does not expose a single versioned production-request API. The package gives the renderer, IPC, persistence, assisted workflow, and future runners one stable contract.

## D-003 — Capability fingerprint over guessed semantic version

**Decision:** Record the OpenMontage Git revision and probe required modules, manifests, routes, and runtimes.

**Reason:** The inspected repository does not publish a root semantic-version compatibility contract. Feature probing is safer than assuming compatibility from a package version.

## D-004 — Backlot is observation-only

**Decision:** Use Backlot HTTP/SSE for health, state, events, thumbnails, and media. Send approvals and control commands to the agent runner or provide an assisted instruction.

**Reason:** The current Backlot API is deliberately read-only and must never become a hidden mutation API through MES assumptions.

## D-005 — Two execution modes

**Decision:** Ship assisted mode as the universal baseline and managed mode behind a replaceable runner adapter.

**Reason:** OpenMontage orchestration belongs to an agent, not a Python CLI orchestrator. Assisted mode remains honest and useful without tying MES to one agent product; managed mode automates the same package when a runner is configured.

## D-006 — Credential isolation

**Decision:** MES stores only configured/unconfigured status. Credential values remain in OpenMontage or runner environments.

**Reason:** This minimizes secret exposure across SQLite, IPC, logs, job packages, prompts, and Sentry.

## D-007 — No silent composition substitution

**Decision:** An unavailable explicit runtime blocks launch. Automatic selection may choose an available runtime but must disclose the reason and warnings.

**Reason:** Remotion and HyperFrames produce materially different editable outputs. Silent substitution would violate user intent and OpenMontage guidance.

## D-008 — Persistent guarded lifecycle

**Decision:** MES owns a persisted integration lifecycle with explicit transitions and terminal-state protection, while OpenMontage checkpoints remain canonical production evidence.

**Reason:** MES must recover after restart, deduplicate delayed events, and present fallback without overwriting or impersonating OpenMontage stage state.

## D-009 — Failure preserves evidence

**Decision:** Retry/fallback policy uses a stable failure taxonomy, and fallback never deletes the OpenMontage project or checkpoints.

**Reason:** Operators need honest diagnostics and recovery. Cancellation is not a failure and must not auto-fallback.

## D-010 — Existing MES visual system resolves conflicts

**Decision:** Follow the supplied Figma/reference information architecture while retaining the existing MES shell, tokens, amber action accent, green health status, and self-hosted typography.

**Reason:** The objective explicitly makes the existing design system authoritative on conflicts. This avoids a visually disconnected microsite inside the desktop app.

## D-011 — Backlot is loopback-only from MES

**Decision:** Accept only HTTP(S) Backlot URLs on `localhost`, `127.0.0.1`, or `::1`, with bounded response/event buffers.

**Reason:** Backlot is a local observer with no authentication contract. Restricting its configurable URL prevents renderer-controlled requests from becoming a general network/credential exfiltration surface.

## D-012 — Full provider discovery is explicit, cached, and bounded

**Decision:** Allow up to 60 seconds for the full OpenMontage registry probe, cache results for 30 seconds, and keep ordinary Backlot calls at a three-second timeout.

**Reason:** The real installation takes about 29 seconds to discover all providers on this machine. A shorter limit produced a truthful but unnecessarily limited report; an unbounded probe would make the settings experience unreliable.

## D-013 — Initialize workspaces through OpenMontage

**Decision:** Assisted preparation calls `lib.checkpoint.init_project` in the external Python environment and then writes only three MES-owned handoff files into that runtime workspace.

**Reason:** OpenMontage must remain authoritative for project layout and `project.json`. Calling its idempotent initializer avoids copying implementation details while keeping MES files clearly namespaced.

## D-014 — Assisted handoff files are atomic and resumable

**Decision:** Write the job package, agent instruction, and recovery prompt through same-directory temporary files and atomic rename; persist paths before the final `handoff_required` transition.

**Reason:** A crash can be retried safely from `validating`/`ready`, and MES never advertises a ready handoff until all files exist. Existing completed checkpoints remain untouched.

## D-015 — Managed execution is a versioned process protocol

**Decision:** A managed runner must advertise and speak `mes.openmontage.runner/v1` over bounded JSON lines. MES invokes it without a shell and requires explicit command acknowledgements.

**Reason:** OpenMontage is agent-first and exposes no supported monolithic orchestration API. A replaceable protocol automates the handoff without copying OpenMontage internals or binding MES to one agent vendor.

## D-016 — Runner output paths fail closed

**Decision:** Accept output records only when their absolute paths are contained by the canonical OpenMontage workspace or the package's configured export root.

**Reason:** Runner output is an external trust boundary. Path containment prevents a compromised or faulty adapter from publishing arbitrary local files through MES.

## D-017 — Production plans carry verifiable routing evidence

**Decision:** Persist health-backed engine/runtime decisions and their reasons, and re-derive the decision before start rather than trusting a renderer-supplied engine value.

**Reason:** The plan drives local process launch and fallback behavior. Revalidation prevents stale or modified renderer state from bypassing runtime and compatibility gates while preserving a transparent review screen.

## D-018 — Assisted degradation precedes engine fallback

**Decision:** When managed mode is selected but its runner is unavailable, use the same package in assisted mode if assisted fallback is enabled and the remaining OpenMontage capabilities are launch-ready.

**Reason:** A missing agent adapter does not make the OpenMontage workspace or operator-driven workflow unusable. Assisted mode remains the honest universal baseline.

## D-019 — MES fallback is an ordinary Compose project

**Decision:** Reuse the originating MES project when available; otherwise create an idempotent local Compose project from narration and local image inputs.

**Reason:** Fallback must use the existing MES production model, storage, editor, and render queue rather than introducing a second hidden renderer.

## D-020 — Renderer plans from existing Compose projects

**Decision:** The New Production workflow selects an existing MES Compose project, reads its narration and media through typed APIs, and maps that source into the stable job package with a pure renderer model.

**Reason:** This preserves the local-first source of truth, makes fallback idempotent, avoids another upload/import silo, and keeps the renderer package builder deterministic and unit-testable.

## D-021 — Browser QA uses the production bridge shape

**Decision:** Make all required UI states reachable in the browser-only mock through the exact `NativeApi.openMontage` methods and durable record types used by Electron.

**Reason:** Static view switches would not validate integration behavior. Typed fixture jobs exercise polling, routing plans, controls, events, outputs, degraded/empty handling, and screenshot layouts without launching providers or a fake in-process orchestrator.

## D-022 — External runtime setup may not mutate OpenMontage source

**Decision:** Install the external Remotion workspace only through its committed lockfile with `npm ci`, and treat ignored dependencies and downloaded browser binaries as machine setup rather than MES content.

**Reason:** This proves the real runtime while preserving the independent-repository boundary. Automatic audit fixes, source edits, lockfile churn, and copied OpenMontage code remain out of scope.

## D-023 — Acceptance labels distinguish integration fixtures from live provider runs

**Decision:** Report Local Assets as a deterministic integration-boundary pass, while keeping Web Content and Open Archival Footage blocked until a supported production agent runner completes their provider and approval stages.

**Reason:** The MES adapter, persistence, subprocess, recovery, and output contracts can be validated deterministically. OpenMontage itself is intentionally agent-governed; a fixture or capability probe must never be presented as a live provider production.
