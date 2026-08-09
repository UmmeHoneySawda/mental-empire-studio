# Mental Empire Studio — Automation/Remotion Reliability

## Original problem statement
Fix automation bugs and rendering-state problems without modifying Remotion rendering internals or video-editor code. Automation should collect the user's production choices, apply them through the existing Remotion backend/editor services, render reliably, synchronize completion, and continue through Ready to Upload.

User-confirmed scope:
- Both batch automation and failed-render retry flows were affected.
- Successful worker completion must mark the render complete, enable output actions, continue remaining checkpoints, and appear in Ready to Upload.
- Only automation orchestration, status polling, API handoff, asset handling, and related state synchronization may change.
- The Windows Remotion worker was unavailable during implementation, so verification was code-level/build/unit based.

## Architecture decisions
- Keep the classic project as the durable automation/download checkpoint and source of selected media/transcript.
- Bind/reseed that checkpoint into the existing `remotion` video-engine project during Apply style.
- Use only existing video-engine APIs for assets, captions, transitions, grading, hook plans, Auto B-roll, preflight, render enqueue/retry/cancel, and progress polling.
- Never invoke the legacy renderer from automation. Retire stale legacy queue jobs when encountered.
- Mirror a successfully completed Remotion artifact into the legacy render-status table only as a compatibility/readiness record, allowing existing Ready to Upload queries to work without a second render.
- Preserve slideshow duration and shuffle in the automation style contract so template choices survive into Remotion scene planning.

## Implemented
- Added an automation-to-Remotion orchestration adapter.
- Apply style now creates a preflighted Remotion project and applies selected slideshow timing/order, transitions, grading, caption presence/style binding, hook plan, and Auto B-roll density.
- Render videos now enqueues/polls/retries/cancels through the existing Remotion render queue.
- Completed outputs are checkpointed, verified on disk, synchronized to Ready to Upload, and followed by quality-check/finish checkpoints.
- Stale legacy automation renders are cancelled and replaced by Remotion jobs.
- Terminal automation events refresh render/work-item state in the UI.
- Added focused mapping/contract tests.

## Verification
- TypeScript typecheck passed.
- Production Electron build passed.
- 103 targeted automation/Remotion tests passed; 4 existing tests were skipped.
- Independent automation review found no orchestration defects.
- Full-suite-only environment limitations: Node 20 lacks a Node 22 Set API used by one baseline test, and container FFmpeg lacks NVENC for the hardware benchmark.

## Prioritized backlog
### P0
- Run one real Windows batch and one failed-render retry with the connected worker to confirm machine-specific GPU/FFmpeg behavior and output paths.

### P1
- Add a durable integration fixture that uses a lightweight Remotion test adapter to exercise restart/resume and Ready to Upload synchronization end-to-end.
- Surface a concise automation log entry for every applied production choice.

### P2
- Add automation history filters for renderer, retry reason, and output readiness.
- Add per-item elapsed-time telemetry for Apply style and Render videos.

## Next tasks
1. Validate a real Windows worker render from batch creation through Ready to Upload.
2. Validate retrying an older stuck legacy item migrates it to Remotion and finishes once.
3. Add the restart/resume integration fixture after live validation confirms machine-specific assumptions.