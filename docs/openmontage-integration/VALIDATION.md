# OpenMontage Integration Validation

Validated on 2026-07-24 on Windows x64.

## Automated gates

| Gate | Evidence |
| --- | --- |
| Full MES suite | `npm test` — 69 files, 574 tests passed; 2 documented skips |
| Live installation | `ME_OPENMONTAGE_LIVE=1` health test — revision, Python, FFmpeg, Remotion, and HyperFrames passed |
| TypeScript | `npm run typecheck` — passed |
| Production build | `npm run build` — passed |
| Native dependency | `npx @electron/rebuild -f -w better-sqlite3` — passed |
| Electron smokes | `1`, `m3`, `m4`, `m5`, `m6`, and `m7` — passed in isolated disposable profiles |
| Packaging | `npm run dist:dir` — Windows unpacked package created |

## External OpenMontage checks

- Repository revision: `0af32ce5e1e830c33992af1f9179dcdcd536549b`.
- `npm ci` completed in `OpenMontage/remotion-composer` without changing tracked files.
- `npx remotion compositions src/index.tsx` enumerated 13 compositions.
- The external repository remained clean on `main`.
- The dependency audit reported one high-severity advisory. No automatic fix was applied because that could mutate the independent lock/source boundary.
- Two localhost `/public/` 404 warnings appeared after composition enumeration; enumeration itself completed successfully.

## Acceptance scenarios

| Scenario | Result |
| --- | --- |
| Local Assets | PASS — deterministic real-process adapter path covers package materialization, locked assets, SQLite lifecycle, checkpoint, output, classified retry, and restart recovery |
| Web Content | BLOCKED — capability discovery passes, but a supported production agent runner is not configured for a provider-backed acquired-through-completion run |
| Open Archival Footage | BLOCKED — Archive and Remotion are available, but full agent-governed acquisition/composition was not run without a supported runner and approval flow |

Capability checks and fixture completions are not presented as live provider productions.

## Visual artifacts

Every image is 1352×868.

| PRD state | File |
| --- | --- |
| Integration dashboard | `screenshots/01-dashboard.png` |
| New Production | `screenshots/02-new-production.png` |
| Automatic workflow decision | `screenshots/03-production-plan.png` |
| Live production | `screenshots/04-live-production.png` |
| Storyboard approval | `screenshots/05-storyboard-approval.png` |
| Runtime comparison | `screenshots/06-runtime-comparison.png` |
| Recovery | `screenshots/07-recovery.png` |
| Failure and fallback | `screenshots/08-fallback.png` |
| Completed outputs | `screenshots/09-completed.png` |
| Settings | `screenshots/10-settings.png` |

## Scope and security audit

- The nested `OpenMontage/` repository is independent, untracked by MES, and clean.
- The user-provided `docs/openmontage-integration/PRD.md` remains untracked.
- No production audio/video artifact is part of the MES changeset; the only generated artifacts included are the requested PNG screenshots.
- High-confidence secret patterns produced no matches. Remaining secret-shaped strings are deliberate redaction fixtures and placeholders.
- Job packages, prompts, IPC responses, runner streams, persistence, and Sentry fields retain credential-value isolation.
