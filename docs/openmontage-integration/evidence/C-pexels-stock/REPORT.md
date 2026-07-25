# Acceptance evidence report — C-real-additional-stock-footage-pexels

- Verdict: **INDETERMINATE**
- Evaluated at: 2026-07-24T20:54:47.927Z
- MES commit: `97b122b2cc3219aa8a9222de78e59b5ff08c4a0b`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Operating system: win32 x64
- Runner: codex-cli @openai/codex 0.145.0
- Pipeline: hybrid | Runtime: remotion
- MES job id: `mes-accept-c-pexels-stock-20260725`
- OpenMontage project id: `mes-accept-c-pexels-stock-20260725`
- Job state: unknown | progress ? | stage ?
- Runner session id: `none`
- Asset cost (USD): 0
- Credential prerequisites: PEXELS_API_KEY (configured; value never read, printed or persisted), Codex agent-runner usage capacity (EXHAUSTED — this is the blocker)

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `evidence_reverifiable` | FAIL | acceptance.json records no final job row, so nothing can be re-verified. |

## Checkpoints

- `idea`: completed (human approved)
- `scene_plan`: awaiting_human
- `script`: completed (human approved)

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
- no  — editable_output_requested

## Commands executed

```powershell
npm run build
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\C-pexels-stock.json"
```

## Screenshots

- `evidence/C-pexels-stock\01-dashboard.png`
- `evidence/C-pexels-stock\02-approval.png`

## Notes

- INCOMPLETE RUN — BLOCKED, not a product failure. See ../BLOCKED-codex-usage-limit/REPORT.md.
- This directory holds the recorded evidence of a real live production that reached the real OpenMontage engine and then could not continue because the Codex agent-runner account ran out of usage capacity (resets Jul 31st, 2026).
- Progress actually achieved: the `idea` and `script` stages completed and were human-approved through the real MES approval API, and `scene_plan` reached a genuine agent-raised approval gate whose own recorded summary reads 'Recovery action: approve checkpoint_scene_plan.json to begin real Pexels acquisition.'
- The run therefore stopped immediately BEFORE the Pexels API call it was about to make, which is why no provider/licence metadata or downloaded motion clip exists yet. PEXELS_API_KEY is configured and is NOT the blocker.
- An earlier attempt in the same directory failed differently, with 'Managed runner rejected the approval command'. That was a real product bug — the checkpoint watcher could publish an approval gate from a checkpoint the runner had already moved past — and it is fixed on this branch with a regression test ('never surfaces an approval gate from a checkpoint the runner has already moved past').
- Resume with: node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\C-pexels-stock.json" — the spec sets resumeExisting, so it continues from the preserved scene_plan checkpoint rather than restarting.
- Preserved workspace: D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725

