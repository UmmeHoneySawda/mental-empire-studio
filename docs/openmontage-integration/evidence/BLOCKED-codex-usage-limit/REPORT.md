# BLOCKER — Codex agent-runner usage limit exhausted

- Recorded: 2026-07-25 (local), 2026-07-24T20:0x UTC in the attached logs
- MES commit at time of run: `97b122b` + working tree
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- Runner: `@openai/codex@0.145.0`, ChatGPT-token auth from `~/.codex/auth.json`
- Affects acceptance scenarios: **C, E, G, H, I**

## What happened

Scenario C (Pexels stock footage) and scenario G (runner-interruption recovery) were launched as
real live productions. Both reached the real OpenMontage engine and began real work — C completed
the `idea`, `script` and `scene_plan` stages and was waiting at a genuine approval gate whose
recorded summary reads:

> "Recovery action: approve checkpoint_scene_plan.json to begin real Pexels acquisition."

Then every subsequent Codex turn began failing. C failed 1 of 5 turns and then could not proceed;
G failed **all 4** of its turns, never producing a checkpoint.

## Root cause, confirmed directly

The runner's own event log recorded only `codex_event:error` → `turn.failed` → `turn_failure
{diagnostic: "unknown"}`, because Codex reports fatal turn errors as a **stdout JSON event** and the
runner was only capturing `stderr`. Running the pinned CLI directly against the real OpenMontage
checkout produced the actual message:

```
$ node node_modules/@openai/codex/bin/codex.js exec --json --skip-git-repo-check "Reply with the single word OK."
{"type":"thread.started","thread_id":"019f95c3-b0e9-7863-a6e4-243e68dfdd60"}
{"type":"turn.started"}
{"type":"error","message":"You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro),
 visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jul 31st, 2026 3:56 PM."}
{"type":"turn.failed","error":{"message":"You've hit your usage limit. ..."}}
```

This is an **account capacity limit on the Codex agent runner**, not a defect in the integration and
not a provider/credential problem with Pexels. `PEXELS_API_KEY` is correctly configured (verified
present as a 56-character User environment variable, never printed) and scenario C was blocked
*before* it reached the Pexels acquisition step it was about to perform.

## Two real defects this exposed, both fixed on this branch

1. **The failure was undiagnosable.** The runner discarded the Codex error message, so a spent quota
   looked identical to a generic crash. `codex-runner.mjs` now captures the message from the stdout
   event stream (sanitized, truncated) and reports it in both the local log and the `failed` event.
2. **The failure was misclassified as retryable.** `classifyOpenMontageFailure` matched the generic
   text "…local sanitized **runner** diagnostics…" and returned `category: 'runner', retryable: true`,
   so MES burned its whole retry budget re-running turns that could never succeed. Quota exhaustion is
   now classified deterministically as `credentials` / non-retryable / still fallback-eligible — the
   correct response is to stop retrying and let the MES renderer take over. Covered by two new tests
   in `openmontage-contracts.test.ts`.

## Exact prerequisite to unblock

| | |
| --- | --- |
| **Blocker** | The Codex agent runner account has no usage capacity left. |
| **Why required** | Scenarios C, E, G, H and I each require a *real* agent-governed OpenMontage production. A mock, fixture or deterministic fake process is explicitly not acceptable for these rows. |
| **Exact action needed** | Either wait for the quota to reset at **Jul 31st, 2026 3:56 PM**, or add Codex credits / upgrade at <https://chatgpt.com/codex/settings/usage>. No value needs to be given to the agent — the existing `~/.codex/auth.json` is already valid. |
| **Zero-cost alternative** | Wait for the reset date. No code change can substitute; using a fake runner would violate the acceptance rule. |
| **Work that resumes afterwards** | `node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\<ID>.json"` for `C-pexels-stock`, `E-hyperframes`, `G-runner-interruption`, `H-process-control` and `I-fatal-fallback`. All five specs are written, committed and ready; C and G will **resume from their existing checkpoints** rather than restart. Then `node scripts/openmontage-evidence-report.mjs --all`. |

## Preserved partial evidence

Both workspaces are intact and are *not* deleted, so the resumed runs continue rather than restart:

- `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725` — `idea` and `script` completed
  and human-approved, `scene_plan` at `awaiting_human`.
- `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-20260725` — workspace initialised, no
  checkpoint reached.

Attached sanitized runner event streams:

- `c-pexels-stock-runner-events.jsonl`
- `g-interrupt-runner-events.jsonl`

Both were scanned for credential shapes (`sk-`, `bearer`, `api_key=`, `access_token`) before
committing: zero matches.
