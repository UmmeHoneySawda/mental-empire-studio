# Acceptance evidence report — D-real-remotion-editable-export-and-independent-render

- Verdict: **PASS**
- Evaluated at: 2026-07-24T20:54:48.126Z
- MES commit: `97b122b2cc3219aa8a9222de78e59b5ff08c4a0b`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: documentary-montage | Runtime: remotion
- MES job id: `mes-accept-d-remotion-editable-20260725`
- OpenMontage project id: `mes-accept-d-remotion-editable-20260725`
- Job state: completed | progress 100 | stage compose
- Runner session id: `019f9592-44c3-7970-94c3-d0cec94245e8`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `output_present:final_mp4` | PASS | 1 recorded |
| `output_present:editable_project` | PASS | 2 recorded |
| `output_present:captions` | PASS | 1 recorded |
| `final_mp4_exists_on_disk` | PASS | D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\renders\final.mp4 |
| `final_mp4_ffprobe` | PASS | ffprobe parsed the container |
| `final_mp4_has_video` | PASS | video codec h264 |
| `final_mp4_width` | PASS | requested 1280, observed 1280 |
| `final_mp4_height` | PASS | requested 720, observed 720 |
| `final_mp4_locked_fps` | PASS | locked 24 fps, observed 24 fps |
| `final_mp4_min_duration` | PASS | >= 12s, observed 15.6s |
| `editable_project_self_contained` | PASS | 1 of 2 editable project(s) have a package.json |
| `independent_render_exists` | PASS | D:\Work\openmontage-acceptance\independent\D-remotion\out\final.mp4 |
| `independent_render_ffprobe` | PASS | ffprobe parsed the container |

## Checkpoints

- `assets`: completed (human approved)
- `compose`: completed
- `edit`: completed (human approved)
- `idea`: completed (human approved)
- `scene_plan`: completed (human approved)

## Outputs

| Kind | Path | Size | SHA-256 |
| --- | --- | --- | --- |
| final_mp4 | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\renders\final.mp4` | 4435054 | `6c71e7b20f0517a7d21d9d00c64e2ec8c2896b1f2d9ddb51dcb49a7234b168e6` |
| editable_project | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\editable\remotion` | — | `—` |
| editable_project | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\editable\remotion\src` | — | `—` |
| captions | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\assets\subtitles.srt` | 277 | `a3580cf886701f94cf96b93e4b8b9e38d65ffa04f3d31f055218b2e3298e6418` |
| production_assets | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\assets` | — | `—` |
| render_report | `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\artifacts\render_report.json` | 2747 | `79b776504a0451ca3da2cd346d7c9dc52d49335be2f4d64e5e6a0449e3dc17b8` |

## Final video (ffprobe)

- Path: `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\renders\final.mp4`
- Size: 4435054 bytes
- SHA-256: `6c71e7b20f0517a7d21d9d00c64e2ec8c2896b1f2d9ddb51dcb49a7234b168e6`
- Container: mov,mp4,m4a,3gp,3g2,mj2
- Video: h264 1280x720 @ 24 fps
- Audio: aac
- Duration: 15.6s

## Independent render of the exported project (ffprobe)

- Path: `D:\Work\openmontage-acceptance\independent\D-remotion\out\final.mp4`
- Command: `cd D:\Work\openmontage-acceptance\independent\D-remotion && npm install && npm run render`
- Size: 5275569 bytes
- SHA-256: `bf271741c51f54a3487cdc2450cf66c7007156c5efd7d54f83399b5332ad8afc`
- Video: h264 1280x720 @ 24 fps
- Duration: 15.68s

## Behaviours proven by this run

- yes — managed_production
- yes — approval_gate
- yes — revision_request
- yes — duplicate_start_rejected
- no  — normal_application_restart
- yes — resume_existing
- no  — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- yes — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\D-remotion-editable.json"
```

## Screenshots

- `evidence/D-remotion-editable\01-dashboard.png`
- `evidence/D-remotion-editable\03-final.png`

