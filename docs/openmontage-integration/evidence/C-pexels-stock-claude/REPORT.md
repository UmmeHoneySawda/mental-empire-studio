# Acceptance evidence report — C-real-additional-stock-footage-pexels-claude

- Verdict: **PASS**
- Evaluated at: 2026-07-25T06:58:58.550Z
- MES commit: `5a0872e676c56678ddd38896fc398bb076221cc0`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: remotion
- MES job id: `mes-accept-c-pexels-claude-20260725`
- OpenMontage project id: `mes-accept-c-pexels-stock-20260725`
- Job state: completed | progress 100 | stage export
- Runner session id: `45db0602-bc55-42e8-9852-5fd95fa02f20`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `output_present:final_mp4` | PASS | 1 recorded |
| `output_present:captions` | PASS | 1 recorded |
| `final_mp4_exists_on_disk` | PASS | D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\renders\final.mp4 |
| `final_mp4_ffprobe` | PASS | ffprobe parsed the container |
| `final_mp4_has_video` | PASS | video codec h264 |
| `final_mp4_width` | PASS | requested 1280, observed 1280 |
| `final_mp4_height` | PASS | requested 720, observed 720 |
| `final_mp4_locked_fps` | PASS | locked 24 fps, observed 24 fps |
| `final_mp4_min_duration` | PASS | >= 12s, observed 15.708s |

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
| captions | `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\assets\subtitles.srt` | 432 | `b02000ff211ea395239e480469215141f3a625af3afd33c23d436726e776672a` |
| decision_log | `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\decision_log.json` | 6363 | `8347776517afe4dd89a3a96d6f1f18d6bc66e23259cca9fde772cc81250fe453` |
| final_mp4 | `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\renders\final.mp4` | 2007972 | `cb5422889e48f1831f5a7ea4d12d8705179f42ea40d93b645b58e10ac4db898e` |
| production_assets | `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\assets` | — | `—` |
| render_report | `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\artifacts\render_report.json` | 3547 | `4976a1284784b80d19591733bf821afc7fa8abf5a889c0c10113f696c3f748da` |

## Final video (ffprobe)

- Path: `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725\renders\final.mp4`
- Size: 2007972 bytes
- SHA-256: `cb5422889e48f1831f5a7ea4d12d8705179f42ea40d93b645b58e10ac4db898e`
- Container: mov,mp4,m4a,3gp,3g2,mj2
- Video: h264 1280x720 @ 24 fps
- Audio: aac
- Duration: 15.708s

## Behaviours proven by this run

- yes — managed_production
- yes — approval_gate
- no  — revision_request
- yes — duplicate_start_rejected
- no  — normal_application_restart
- no  — resume_existing
- no  — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\C-pexels-stock-claude.json"
```

