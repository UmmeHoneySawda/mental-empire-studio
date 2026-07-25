# Unattended OpenMontage acceptance run — live status

Started: 2026-07-25T06:43:13.747Z
Orchestrator PID: 4964 (STOPPED by next agent at 2026-07-25T13:57:12.6329544+06:00)

## Scenario log
- 2026-07-25T06:58:59.572Z — Scenario C (Pexels additional stock footage): **PASS** (EXITED). See reports/C.md
- 2026-07-25T07:00:35.590Z — Scenario E (HyperFrames render + editable workspace): **BLOCKED** (EXITED). See reports/E.md
- 2026-07-25T07:00:35.846Z — Scenario G (Runner interruption recovery): **STOPPED** — harness adopted a prior Codex-era job stuck in `fallback_running/preparing` with no runner PID; no interruption could be exercised. OpenMontage project preserved. Will re-run with a fresh MES job.
