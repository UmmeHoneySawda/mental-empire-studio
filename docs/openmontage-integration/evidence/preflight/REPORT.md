# Acceptance evidence report — preflight-real-electron-health

- Verdict: **PASS**
- Evaluated at: 2026-07-24T20:54:48.503Z
- MES commit: `97b122b2cc3219aa8a9222de78e59b5ff08c4a0b`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: unknown | Runtime: unknown
- MES job id: `none`
- OpenMontage project id: `none`
- Job state: unknown | progress ? | stage ?
- Runner session id: `none`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `health_status` | PASS | expected one of ready, observed ready |

## Behaviours proven by this run

- no  — managed_production
- no  — approval_gate
- no  — revision_request
- no  — duplicate_start_rejected
- no  — normal_application_restart
- no  — resume_existing
- no  — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\mental-empire-studio\docs\openmontage-integration\evidence\preflight\acceptance-spec.json"
```

## Screenshots

- `evidence/preflight\01-dashboard.png`

