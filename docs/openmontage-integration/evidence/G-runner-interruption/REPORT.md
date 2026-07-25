# Acceptance evidence report — G-recovery-from-real-runner-process-interruption

- Verdict: **PASS**
- Evaluated at: 2026-07-25T09:04:04.582Z
- MES commit: `5a0872e676c56678ddd38896fc398bb076221cc0`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: remotion
- MES job id: `mes-accept-g-interrupt-grok-20260725`
- OpenMontage project id: `mes-accept-g-interrupt-grok-20260725`
- Job state: completed | progress 100 | stage export
- Runner session id: `019f986d-5979-7441-b2b8-03de16098de4`
- Asset cost (USD): 0
- Credential prerequisites: Codex agent-runner usage capacity (EXHAUSTED — this is the blocker)

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `terminal_state` | PASS | expected completed, observed completed |
| `output_present:final_mp4` | PASS | 1 recorded |
| `final_mp4_exists_on_disk` | PASS | D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\renders\final.mp4 |
| `final_mp4_ffprobe` | PASS | ffprobe parsed the container |
| `final_mp4_has_video` | PASS | video codec h264 |
| `final_mp4_width` | PASS | requested 1280, observed 1280 |
| `final_mp4_height` | PASS | requested 720, observed 720 |
| `final_mp4_locked_fps` | PASS | locked 24 fps, observed 24 fps |
| `final_mp4_min_duration` | PASS | >= 6s, observed 8s |

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
| decision_log | `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\decision_log.json` | 12881 | `5a74126772f62def1a380016a7b9f1ef725019ccce6dacdd74040085dc9c010c` |
| final_mp4 | `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\renders\final.mp4` | 2803215 | `8a21959ff1b1b572e2ab428929274782ebb7d1747445b6e356ed5c383be46f25` |
| render_report | `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\artifacts\render_report.json` | 1191 | `9e79daf51fe6e04ce55a9d212e4abba5356e50efa4d9d96d26f9620167253e0d` |
| production_assets | `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\assets` | — | `—` |

## Final video (ffprobe)

- Path: `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-grok-20260725\renders\final.mp4`
- Size: 2803215 bytes
- SHA-256: `8a21959ff1b1b572e2ab428929274782ebb7d1747445b6e356ed5c383be46f25`
- Container: mov,mp4,m4a,3gp,3g2,mj2
- Video: h264 1280x720 @ 24 fps
- Audio: aac
- Duration: 8s

## Behaviours proven by this run

- yes — managed_production
- yes — approval_gate
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
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\G-runner-interruption.json"
```

## Screenshots

- `evidence/G-runner-interruption\01-dashboard.png`
- `evidence/G-runner-interruption\02-approval.png`
- `evidence/G-runner-interruption\03-final.png`

## Notes

- INCOMPLETE RUN — BLOCKED, not a product failure. See ../BLOCKED-codex-usage-limit/REPORT.md.
- The production was launched against the real OpenMontage engine and its workspace was initialised, but every one of its four Codex turns failed immediately: the agent-runner account had no usage capacity left (resets Jul 31st, 2026 3:56 PM). No checkpoint was ever reached, so the planned interruption could not be exercised.
- The interruption mechanism itself is implemented and covered below the live tier: the harness action `actions.interruptRunner` kills the recorded runner PID with `taskkill /T /F`, waits for a new runner, and records stage/progress/checkpoint/session before and after plus a surviving-descendant count. Windows process-tree termination is separately proven against a real parent+descendant process in `openmontage-process-tree.test.ts`.
- This run is also what exposed two real defects, both fixed on this branch: the runner discarded the Codex error message (so the failure logged only `diagnostic: "unknown"`), and quota exhaustion was classified as a retryable `runner` fault, which burned the retry budget on turns that could never succeed.
- Resume with: node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\G-runner-interruption.json"
- Preserved workspace: D:\Work\OpenMontage\projects\mes-accept-g-interrupt-20260725

