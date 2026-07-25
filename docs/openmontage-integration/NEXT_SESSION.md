# Next session — OpenMontage integration

## Status (2026-07-25)

All remaining live acceptance scenarios now have **PASS** evidence:

| ID | Live E2E | Evidence |
| --- | --- | --- |
| C | PASS (Claude) | `evidence/C-pexels-stock-claude/` |
| E | PASS (Grok Build) | `evidence/E-hyperframes/` |
| G | PASS (Grok Build) | `evidence/G-runner-interruption/` |
| H | PASS (Grok Build) | `evidence/H-process-control/` |
| I | PASS (Grok Build + MES fallback) | `evidence/I-fatal-fallback/` |

A/B/D/F/J were already PASS.

## What landed this session

1. **Grok Build runner** (`resources/openmontage-runner/grok-runner.mjs`) behind the existing `mes.openmontage.runner/v1` abstraction.
2. Runner selection order: Codex → Claude → **Grok** → custom.
3. Health auth-cache so forced plan checks do not re-spend a Grok auth turn and false-fail.
4. Acceptance harness: nested `render:jobs` path + filesystem recovery for MES fallback MP4s.
5. Live scenarios C–I executed with real processes (Claude for C; Grok for E/G/H/I).

## Remaining housekeeping (if not done in the same commit)

- Update `TEST_MATRIX.md`, `PROGRESS.md`, root `NEXT_AGENT.md` if still showing BLOCKED.
- Final suite: `ME_REQUIRE_SQLITE=1 npm test`, typecheck, build, dist:dir, smokes, secret scan.
- Push `feat/openmontage-integration` and refresh draft PR #11 (do not merge until review).
