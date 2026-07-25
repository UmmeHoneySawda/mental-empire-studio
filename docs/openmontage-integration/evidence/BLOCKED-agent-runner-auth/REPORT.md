# BLOCKER — no agent runner can currently authenticate

- Recorded: 2026-07-25
- MES commit: `47c68da`
- OpenMontage commit: `0af32ce5e1e830c33992af1f9179dcdcd536549b`
- OS: Windows 10 Pro 19045 · Node 22.16.0 · Electron 32
- Affects acceptance scenarios: **C, E, G, H, I**

Both supported managed runners are now implemented and detected correctly. Neither can currently
authenticate, so no live agent-governed production can run.

| Runner | Installed | Version | Authenticated | Blocker |
| --- | --- | --- | --- | --- |
| Codex CLI | yes | `@openai/codex` 0.145.0 (pinned) | yes | **Usage capacity exhausted** until Jul 31st, 2026 3:56 PM — see `../BLOCKED-codex-usage-limit/REPORT.md` |
| Claude Code | yes | `@anthropic-ai/claude-code` 2.1.220 (pinned) | **no** | `Not logged in · Please run /login` |

## What was verified, not assumed

The Claude Code CLI was **not** present on this machine at the start of this work (`claude` was not
on `PATH`; `%LOCALAPPDATA%\Claude` and `%LOCALAPPDATA%\claude-cli-nodejs` held only empty
state/cache directories). It was installed as a pinned project dependency, mirroring how
`@openai/codex` is pinned and `asarUnpack`'d, and its interface was then probed rather than guessed.

The runner's own probe reports the truth:

```
$ node resources/openmontage-runner/claude-runner.mjs --openmontage-protocol-info \
    --claude-executable node_modules/@anthropic-ai/claude-code/bin/claude.exe

MES_OPENMONTAGE_RUNNER={"protocol":"mes.openmontage.runner/v1",
 "version":"1.0.0 (2.1.220 (Claude Code))","runner":"claude-code",
 "capabilities":["pause","resume","cancel","approval","revision","recovery"],
 "installed":true,"authenticated":false,
 "authFailureCode":"CLAUDE_NOT_AUTHENTICATED",
 "authFailureMessage":"Not logged in · Please run /login"}
```

Confirmed directly against the CLI as well:

```
$ claude -p "…" --output-format json --permission-mode dontAsk
{"is_error":true, … ,"result":"Not logged in · Please run /login","subtype":"success"}
```

Note that this is a **zero exit code carrying an error result**, which is why the runner does not
treat a clean exit as evidence of readiness.

### Why the existing credentials do not help

`%USERPROFILE%\.claude\.credentials.json` exists but contains **only MCP plugin OAuth entries**
(`plugin:design:notion`, `figma`, `linear`, `slack`, …). There is no `claudeAiOauth` account
credential in it, and `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_AUTH_TOKEN` are
unset in the User, Machine and Process scopes. The Claude Code *desktop app* that hosted this
engineering session authenticates by a path the standalone CLI does not read, so its session cannot
be borrowed.

## Exact prerequisite to unblock

| | |
| --- | --- |
| **Blocker** | The Claude Code CLI is not logged in. |
| **Why required** | Scenarios C, E, G, H and I each require a *real* agent-governed OpenMontage production. A mock, fixture or deterministic fake process is explicitly not acceptable for those rows. |
| **Exact action (smallest)** | Run `node_modules\@anthropic-ai\claude-code\bin\claude.exe setup-token` and complete the browser prompt, then set the printed token as a Windows **user** environment variable named `CLAUDE_CODE_OAUTH_TOKEN` and restart the shell. (`claude` then `/login` in an interactive session works too.) |
| **Who must do it** | The account owner. This is an account authentication / OAuth authorization step; it cannot be performed on the user's behalf. |
| **Never do** | Print, log, persist, commit or screenshot the token. MES stores provider/runner credential **status** only. |
| **Zero-cost alternative** | Wait for the Codex quota to reset on Jul 31st, 2026 and run the five scenarios with the Codex runner instead. Both runners implement the same protocol, so either satisfies the scenarios. |
| **Work that resumes afterwards** | Set `integrations.openMontage.runner` to `claude-code` (or leave `automatic`, which now selects it once Codex is quota-blocked), then run the five committed specs and re-grade: `node scripts/openmontage-acceptance.mjs --spec "D:\Work\openmontage-acceptance\specs\<ID>.json"` for `C-pexels-stock`, `E-hyperframes`, `G-runner-interruption`, `H-process-control`, `I-fatal-fallback`, then `node scripts/openmontage-evidence-report.mjs --all`. |

## Preserved partial work

Nothing was reset. The Codex-era checkpoints are intact and are exactly what a Claude handover reads:

- `D:\Work\OpenMontage\projects\mes-accept-c-pexels-stock-20260725` — `idea` and `script` completed
  and human-approved, `scene_plan` at `awaiting_human`.
- `D:\Work\OpenMontage\projects\mes-accept-g-interrupt-20260725` — workspace initialised, no
  checkpoint reached.

The Claude runner resumes from this filesystem state rather than from an agent conversation, is told
which stages are already completed and must not be regenerated, and records a
`runner_transition` event so the Codex → Claude handover is visible in the job's own history.

`PEXELS_API_KEY` remains configured (56-character Windows user variable, value never read or logged)
and is **not** a blocker for scenario C.
