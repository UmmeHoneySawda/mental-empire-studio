# Acceptance evidence report — E-real-hyperframes-render-and-editable-workspace

- Verdict: **PASS**
- Evaluated at: 2026-07-25T08:31:47.227Z
- MES commit: `5a0872e676c56678ddd38896fc398bb076221cc0`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: hyperframes
- MES job id: `mes-accept-e-hyperframes-grok-20260725`
- OpenMontage project id: `mes-accept-e-hyperframes-grok-20260725`
- Job state: completed | progress 100 | stage export
- Runner session id: `019f9859-df70-7a90-8e2c-44010b7c0d66`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `output_present:final_mp4` | PASS | 1 recorded |
| `output_present:editable_project` | PASS | 2 recorded |
| `output_present:captions` | PASS | 1 recorded |
| `final_mp4_exists_on_disk` | PASS | D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\renders\final.mp4 |
| `final_mp4_ffprobe` | PASS | ffprobe parsed the container |
| `final_mp4_has_video` | PASS | video codec h264 |
| `final_mp4_width` | PASS | requested 1280, observed 1280 |
| `final_mp4_height` | PASS | requested 720, observed 720 |
| `final_mp4_locked_fps` | PASS | locked 30 fps, observed 30 fps |
| `final_mp4_min_duration` | PASS | >= 12s, observed 15.616s |
| `editable_project_self_contained` | PASS | 1 of 2 editable project(s) have a package.json |

## Checkpoints

- `assets`: completed (human approved)
- `compose`: completed
- `edit`: completed
- `idea`: completed (human approved)
- `publish`: completed (human approved)
- `scene_plan`: completed (human approved)
- `script`: completed (human approved)

## Outputs

| Kind | Path | Size | SHA-256 |
| --- | --- | --- | --- |
| editable_project | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\hyperframes` | — | `—` |
| final_mp4 | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\renders\final.mp4` | 892186 | `9f8f5afa1e5c3d38c9dacc753c0e3eee5051b3f6b4b5eb3092c9fc8af021de35` |
| captions | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\editable\hyperframes\captions\subtitles.srt` | 358 | `1cc46384e60a28a3a66c7ace2c50bc1d64fc3782885c8f66f687c8921bcc480d` |
| decision_log | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\decision_log.json` | 8048 | `e38a00120703c4df179df32226d3d846731740bc5a06bcee247e2dd4262ed677` |
| editable_project | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\editable\hyperframes` | — | `—` |
| render_report | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\artifacts\render_report.json` | 12560 | `60c98dbd0f8515087f9dfadc8bc9635938d8fad1d7958a6bb84f91d296a8b9ab` |
| production_assets | `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\assets` | — | `—` |

## Final video (ffprobe)

- Path: `D:\Work\OpenMontage\projects\mes-accept-e-hyperframes-grok-20260725\renders\final.mp4`
- Size: 892186 bytes
- SHA-256: `9f8f5afa1e5c3d38c9dacc753c0e3eee5051b3f6b4b5eb3092c9fc8af021de35`
- Container: mov,mp4,m4a,3gp,3g2,mj2
- Video: h264 1280x720 @ 30 fps
- Audio: aac
- Duration: 15.616s

## Behaviours proven by this run

- yes — managed_production
- yes — approval_gate
- no  — revision_request
- no  — duplicate_start_rejected
- no  — normal_application_restart
- no  — resume_existing
- no  — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- yes — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\E-hyperframes.json"
```

## Screenshots

- `evidence/E-hyperframes\01-dashboard.png`
- `evidence/E-hyperframes\02-approval.png`
- `evidence/E-hyperframes\03-final.png`

