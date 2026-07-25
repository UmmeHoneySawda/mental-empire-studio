# OpenMontage integration — release validation

Everything below was executed on this machine against this branch. Commands that were *not* run are
absent rather than assumed.

- Host: Windows 10 Pro 19045, Node 22.16.0 (`NODE_MODULE_VERSION` 127), Electron 32 (ABI 128),
  Python 3.11.9
- OpenMontage: `D:\Work\OpenMontage` @ `0af32ce5e1e830c33992af1f9179dcdcd536549b` (pinned, clean)
- Agent runner: `@openai/codex@0.145.0` (pinned, bundled and unpacked into the package)

## Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — renderer + main projects |
| `npm test` (with `ME_REQUIRE_SQLITE=1`) | **PASS** — 73 files / **603 tests**, 1 skipped file, 2 opt-in skips |
| `npm run build` | **PASS** |
| `npm run dist:dir` | **PASS** — `dist/win-unpacked/Mental Empire Studio.exe` |
| `ME_SMOKE=1` | **PASS** — `SMOKE_OK` |
| `ME_SMOKE=m3` | **PASS** — `SMOKE_M3_OK` |
| `ME_SMOKE=m4` | **PASS** — `SMOKE_M4_OK` |
| `ME_SMOKE=m5` | **PASS** — `SMOKE_M5_OK` |
| `ME_SMOKE=m6` | **PASS** — `SMOKE_M6_OK` |
| `ME_SMOKE=m7` | **PASS** — `SMOKE_M7_OK` |
| `node scripts/openmontage-evidence-report.mjs --all` | A, B, D, F, J **PASS**; `A-B-D-F-G` honest **FAIL** (see below) |
| Production `npm audit --omit=dev` | 2 moderate, both unreachable `react-router` advisories |

### Native ABI discipline

`better-sqlite3` must be rebuilt for whichever runtime loads it. Rebuilding while a live acceptance
run is in flight swaps the module under the running app, so it is never done mid-run.

```powershell
npm rebuild better-sqlite3                    # Node/Vitest
npx @electron/rebuild -f -w better-sqlite3     # Electron launch, dist, live acceptance
```

The full suite above was run on the **Node** ABI with `ME_REQUIRE_SQLITE=1`, which makes the nine
SQLite-backed suites fail loudly instead of silently skipping. Build, packaging and every live/UI run
were done on the **Electron** ABI.

### Smoke fixture seams

The smokes are fixture-driven by design — this environment has no reliable YouTube access and no Groq
key. Running them without the seams makes `m3` fail on a real YouTube channel lookup and `m4` fail on
a missing Groq key; that is harness misuse, not a product failure. The documented invocation:

```powershell
$F = "D:\Work\mental-empire-studio\test\fixtures"
$env:ME_SMOKE_USERDATA_DIR = "<isolated temp dir>"   # refuses to run against the real profile
$env:ME_YTDLP_FIXTURE      = "$F\ytdlp"
$env:ME_DOWNLOAD_FIXTURE   = "$F\audio\sample.mp3"
$env:ME_WHISPER_FIXTURE    = "$F\whisper\sample-words.json"
node_modules\electron\dist\electron.exe --no-sandbox out\main\main.js
```

## Live acceptance

| ID | Scenario | Verdict |
| --- | --- | --- |
| A | Open archival footage workflow | **PASS** — `evidence/A-archive-footage/` |
| B | Approval and revision flow | **PASS** — `evidence/B-approval-revision/` |
| C | Additional stock footage (Pexels) | **BLOCKED** — Codex quota |
| D | Remotion render + self-contained editable project | **PASS** — `evidence/D-remotion-editable/` |
| E | HyperFrames render + editable workspace | **BLOCKED** — Codex quota |
| F | Restart recovery (normal application restart) | **PASS** — `evidence/F-normal-restart/` |
| G | Recovery from real runner/agent interruption | **BLOCKED** — Codex quota |
| H | Pause / resume / cancel / duplicate prevention | **BLOCKED** — Codex quota |
| I | Forced fatal failure + MES fallback | **BLOCKED** — Codex quota |
| J | OpenMontage-unavailable MES regression | **PASS** — `evidence/J-unavailable/` |

The five BLOCKED rows share one external prerequisite — the Codex agent-runner account is out of
usage capacity until **Jul 31st, 2026 3:56 PM**. C and G were launched as real live productions and
reached the real engine before quota loss. Full write-up, confirming CLI transcript and resume
commands: `evidence/BLOCKED-codex-usage-limit/REPORT.md`.

### Scenario D — what actually closed it

The live production rendered at **exactly the locked 24 fps** (1280×720, h264 + aac, 15.6s,
sha256 `6c71e7b2…`). Its exported `editable/remotion/` project was then copied **outside both
checkouts** to `D:\Work\openmontage-acceptance\independent\D-remotion` without `node_modules`,
installed from its own pinned manifest, and rendered with the README's documented command:

```powershell
cd D:\Work\openmontage-acceptance\independent\D-remotion
npm install      # 189 packages, 0 vulnerabilities
npm run render   # remotion render index.tsx MesEditableOpenEarthAtelier out/final.mp4 --codec=h264 --crf=18
```

Result: **375 frames = 15.6s × 24 fps**, h264 1280×720 @ 24/1, 5,275,569 bytes,
sha256 `bf271741c51f54a3487cdc2450cf66c7007156c5efd7d54f83399b5332ad8afc` — byte-size identical to
the in-workspace master, and no absolute path from either checkout appears in the exported sources.

### The combined run keeps its honest FAIL

`evidence/A-B-D-F-G/` requested `composition.editableOutput: true` and did not deliver a
self-contained project, so it re-grades as **FAIL**. That verdict is left standing. Scenarios A, B
and F have their own reports that grade only their own contracts, so none of them inherits it.

## UI validation

Captured from the **built** app against a **real** acceptance profile (not the seeded UI fixture) by
`scripts/openmontage-screenshots.mjs`. Measured on that render at 1352×868:

- `documentScrollWidth == documentClientWidth` → **no horizontal overflow**
- **0 renderer console errors**
- 26 focusable controls; the 4 flagged unlabelled are 3 `<link rel=…>` elements matched by the
  audit's `[href]` selector plus 1 input carrying a `placeholder` — no genuinely unlabelled
  interactive control

Three screens (new production, production plan, runtime comparison) could not be driven through the
Electron automation channel and are recorded in `TEST_MATRIX.md` as NOT EXECUTED, not as passes.

## Media not committed

Generated production media stays on disk and out of git. Absolute local paths:

- `D:\Work\OpenMontage\projects\mes-accept-archive-remotion-20260724\renders\final.mp4`
- `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\renders\final.mp4`
- `D:\Work\OpenMontage\projects\mes-accept-d-remotion-editable-20260725\editable\remotion\`
- `D:\Work\openmontage-acceptance\independent\D-remotion\out\final.mp4`

Committed evidence is limited to reports, hashes, ffprobe output, sanitized logs and small
screenshots.

## Cost

**USD 0.00 in provider spend.** Every asset came from keyless open sources (NASA, Wikimedia Commons);
`asset_manifest.json` records `cost 0` for all four clips. Agent-runner time was consumed from the
existing Codex subscription, which is what ran out.
