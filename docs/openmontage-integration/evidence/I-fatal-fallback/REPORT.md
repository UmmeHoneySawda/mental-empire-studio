# Acceptance evidence report — I-forced-fatal-failure-and-mes-fallback

- Verdict: **PASS**
- Evaluated at: 2026-07-25T09:23:01.545Z
- MES commit: `5a0872e676c56678ddd38896fc398bb076221cc0`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: remotion
- MES job id: `mes-accept-i-fallback-20260725`
- OpenMontage project id: `mes-accept-i-fallback-grok2-20260725`
- Job state: completed | progress 100 | stage research
- Runner session id: `none`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `fallback_attempts_linked` | PASS | MES fallback project proj-openmontage-mes-accept-i-fallback-20260725 |
| `openmontage_project_preserved` | PASS | workspace D:\Work\OpenMontage\projects\mes-accept-i-fallback-20260725 |
| `openmontage_failure_classified` | PASS | category runner, code RUNNER_EXITED |
| `fallback_render_exists` | PASS | C:\Users\SI Fahim\Documents\MentalEmpireStudio\OpenMontage fallback\openmontage-mes-accept-i-fallback-20260725__mes-acceptance-i-fatal-failure-and-mes-fallback\output\OpenMontage fallback - MES Acceptance I - Fatal failure and MES fallback.mp4 |
| `fallback_render_ffprobe` | PASS | ffprobe parsed the container |
| `fallback_render_has_video` | PASS | video codec h264 |
| `fallback_render_min_duration` | PASS | >= 5s, observed 15.6s |

## Checkpoints

- `idea`: in_progress

## Mental Empire Studio fallback render (ffprobe)

- Path: `C:\Users\SI Fahim\Documents\MentalEmpireStudio\OpenMontage fallback\openmontage-mes-accept-i-fallback-20260725__mes-acceptance-i-fatal-failure-and-mes-fallback\output\OpenMontage fallback - MES Acceptance I - Fatal failure and MES fallback.mp4`
- Size: 2972280 bytes
- SHA-256: `4112ba5f404fc888c997743165a28d67ab2844370975208a59f6eb22e31b7c71`
- Video: h264 1920x1080 @ 24 fps
- Audio: aac
- Duration: 15.6s

## Behaviours proven by this run

- yes — managed_production
- no  — approval_gate
- no  — revision_request
- no  — duplicate_start_rejected
- no  — normal_application_restart
- no  — resume_existing
- yes — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\I-fatal-fallback.json"
```

## Screenshots

- `evidence/I-fatal-fallback\01-dashboard.png`
- `evidence/I-fatal-fallback\03-final.png`

