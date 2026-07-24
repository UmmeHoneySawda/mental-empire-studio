# Acceptance evidence report — J-openmontage-unavailable-mes-regression

- Verdict: **PASS**
- Evaluated at: 2026-07-24T20:54:48.439Z
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
| `health_status` | PASS | expected one of unavailable/misconfigured, observed unavailable |
| `ordinary_mes_workflows_operate` | PASS | {"settingsReadable":true,"projectCount":0,"renderQueueReadable":true,"assetLibraryReadable":true} |
| `automatic_routing_selects_mes` | PASS | engine mental-empire-studio — Automatic routing selected Mental Empire Studio because OpenMontage is not launch-ready. |
| `no_openmontage_job_created` | PASS | 0 OpenMontage job(s) present in this isolated profile |

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
node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\J-unavailable.json"
```

## Screenshots

- `evidence/J-unavailable\01-dashboard.png`

## Notes

- Scenario J is the OpenMontage-unavailable regression. The integration was deliberately pointed at D:\Work\openmontage-acceptance\does-not-exist-on-purpose, which is not a real checkout.
- The real Electron app launched normally against an isolated profile and stayed usable: settings, the compose project list, the render queue and the asset library were all readable through the real preload bridge.
- Health reported 'unavailable' — accurate rather than optimistic — and named the specific remediation ('Select a valid OpenMontage repository location.', 'No compatible composition runtime is available.').
- An Automatic-mode production request routed to engine 'mental-empire-studio' with the reason 'Automatic routing selected Mental Empire Studio because OpenMontage is not launch-ready.', and no OpenMontage job row was created.
- openMontagePath in this report override points at the real pinned checkout only so the report can record the OpenMontage commit; the scenario itself ran against the non-existent path above.

