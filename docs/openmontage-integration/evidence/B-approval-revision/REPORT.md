# Acceptance evidence report — B-approval-and-revision-flow

- Verdict: **PASS**
- Evaluated at: 2026-07-24T20:54:47.832Z
- MES commit: `97b122b2cc3219aa8a9222de78e59b5ff08c4a0b`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: documentary-montage | Runtime: remotion
- MES job id: `mes-accept-archive-remotion-20260724`
- OpenMontage project id: `mes-accept-archive-remotion-20260724`
- Job state: completed | progress 100 | stage compose
- Runner session id: `019f9526-cbfb-7991-aaf3-ddd49f1b569b`
- Asset cost (USD): 0
- Credential prerequisites: none

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `output_present:final_mp4` | PASS | 1 recorded |
| `output_present:captions` | PASS | 1 recorded |
| `final_mp4_exists_on_disk` | PASS | D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\renders\final.mp4 |
| `final_mp4_ffprobe` | PASS | ffprobe parsed the container |
| `final_mp4_has_video` | PASS | video codec h264 |
| `final_mp4_width` | PASS | requested 1280, observed 1280 |
| `final_mp4_height` | PASS | requested 720, observed 720 |
| `final_mp4_locked_fps` | NOT_APPLICABLE | the MES package locked no timeline fps; the render reports 30 fps |
| `behaviour:approval_gate` | PASS | recorded by the live run |
| `behaviour:revision_request` | PASS | recorded by the live run |
| `behaviour:duplicate_start_rejected` | PASS | recorded by the live run |

## Checkpoints

- `assets`: completed (human approved)
- `compose`: completed
- `edit`: completed (human approved)
- `idea`: completed (human approved)
- `scene_plan`: completed (human approved)

## Outputs

| Kind | Path | Size | SHA-256 |
| --- | --- | --- | --- |
| captions | `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\assets\subtitles.srt` | 343 | `0e5937982f6b2c8984a71d301d50c01a4ff40a3de83f08f362d1b73baacc8151` |
| final_mp4 | `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\renders\final.mp4` | 9651631 | `2ba943b269190ef13b653acef3c4469f19ce461f13ba9f2cf0bd67c948d77d6c` |
| production_assets | `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\assets` | — | `—` |
| render_report | `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\artifacts\render_report.json` | 1971 | `b8c7b258fd10eb22f2f7094a0526c480f4058cb13c06a2d45dc60801d9f903c7` |

## Final video (ffprobe)

- Path: `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\renders\final.mp4`
- Size: 9651631 bytes
- SHA-256: `2ba943b269190ef13b653acef3c4469f19ce461f13ba9f2cf0bd67c948d77d6c`
- Container: mov,mp4,m4a,3gp,3g2,mj2
- Video: h264 1280x720 @ 30 fps
- Audio: aac
- Duration: 15.616s

## Behaviours proven by this run

- yes — managed_production
- yes — approval_gate
- yes — revision_request
- yes — duplicate_start_rejected
- yes — normal_application_restart
- yes — resume_existing
- no  — runner_interruption_recovery
- no  — pause_resume
- no  — cancellation
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\mental-empire-studio\docs\openmontage-integration\evidence\A-B-D-F-G\acceptance-spec.json"
```

## Screenshots

- `evidence/A-B-D-F-G\01-dashboard.png`
- `evidence/A-B-D-F-G\02-approval.png`

## Notes

- Scenario B is the approval and revision flow: MES must surface a genuine agent-raised approval gate, be able to answer it with either an approval or a revision instruction, and have the same runner session continue afterwards.
- Graded on behaviour, not just a terminal state: behaviour:approval_gate, behaviour:revision_request and behaviour:duplicate_start_rejected must all be evidenced by the recorded run.
- The live run answered four approval gates (research, scene_plan, assets, edit) and issued one revision at the assets gate. The same runnerSessionId resumed after each, with no duplicate launch.
- This report deliberately excludes the editable-project requirement, which is scenario D (evidence/D-remotion-editable/).
- The approval-synchronisation race is what this scenario regression-guards: MES previously observed awaiting_approval before the runner had finished switching state, so the approval command was rejected. The watcher now defers the authoritative gate until the Codex agent turn exits.

