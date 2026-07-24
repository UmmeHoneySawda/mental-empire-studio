# Acceptance evidence report — G-recovery-from-real-runner-process-interruption

- Verdict: **NOT EXECUTED**
- Evaluated at: 2026-07-24T20:54:48.374Z
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
- Credential prerequisites: Codex agent-runner usage capacity (EXHAUSTED — this is the blocker)

## Postconditions

| Check | Result | Detail |
| --- | --- | --- |
| `scenario_executed` | NOT EXECUTED | No acceptance run was recorded in this directory; see the notes for the blocker. |

## Behaviours proven by this run


## Notes

- INCOMPLETE RUN — BLOCKED, not a product failure. See ../BLOCKED-codex-usage-limit/REPORT.md.
- The production was launched against the real OpenMontage engine and its workspace was initialised, but every one of its four Codex turns failed immediately: the agent-runner account had no usage capacity left (resets Jul 31st, 2026 3:56 PM). No checkpoint was ever reached, so the planned interruption could not be exercised.
- The interruption mechanism itself is implemented and covered below the live tier: the harness action `actions.interruptRunner` kills the recorded runner PID with `taskkill /T /F`, waits for a new runner, and records stage/progress/checkpoint/session before and after plus a surviving-descendant count. Windows process-tree termination is separately proven against a real parent+descendant process in `openmontage-process-tree.test.ts`.
- This run is also what exposed two real defects, both fixed on this branch: the runner discarded the Codex error message (so the failure logged only `diagnostic: "unknown"`), and quota exhaustion was classified as a retryable `runner` fault, which burned the retry budget on turns that could never succeed.
- Resume with: node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\G-runner-interruption.json"
- Preserved workspace: D:\Work\OpenMontage\projects\mes-accept-g-interrupt-20260725

