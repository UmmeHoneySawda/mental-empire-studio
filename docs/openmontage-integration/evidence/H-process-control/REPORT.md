# Acceptance evidence report — H-pause-resume-cancel-and-duplicate-prevention

- Verdict: **PASS**
- Evaluated at: 2026-07-25T09:08:09.203Z
- MES commit: `5a0872e676c56678ddd38896fc398bb076221cc0`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: remotion
- MES job id: `mes-accept-h-control-20260725`
- OpenMontage project id: `mes-accept-h-control-20260725`
- Job state: cancelled | progress 100 | stage research
- Runner session id: `none`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected cancelled, observed cancelled |

## Checkpoints

- `idea`: in_progress

## Behaviours proven by this run

- yes — managed_production
- no  — approval_gate
- no  — revision_request
- yes — duplicate_start_rejected
- no  — normal_application_restart
- no  — resume_existing
- no  — runner_interruption_recovery
- yes — pause_resume
- yes — cancellation
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\H-process-control.json"
```

## Screenshots

- `evidence/H-process-control\01-dashboard.png`
- `evidence/H-process-control\03-final.png`

