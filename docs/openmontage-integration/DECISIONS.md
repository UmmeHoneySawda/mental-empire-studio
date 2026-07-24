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
