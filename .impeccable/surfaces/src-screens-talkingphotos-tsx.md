---
version: 1
slug: "src-screens-talkingphotos-tsx"
primary_target: "src/screens/TalkingPhotos.tsx"
related_targets: ["src/screens/Settings.tsx","shared/talkingphotos.ts","electron/services/talkingphotos/pipeline.ts"]
---

# Surface brief — TalkingPhotos long-form

## Scope and mode

**Mode: Operate.** One screen, `src/screens/TalkingPhotos.tsx`, plus a Settings section for the
account connection. The creator commits to a plan that spends real quota and about an hour of
wall-clock, then supervises it. Expression may never obscure task, state, or affordance.

## Audience and job

A faceless-YouTube creator who already has source channels in Studio. Their job: turn one source
video's audio into finished ~30-minute talking-head videos on app.talkingphotos.ai, which has no
30-minute render — only 1–5 minute renders plus a 1800-second merge. So one job is *N* renders and
*M* merges, and the creator's real questions are:

1. Before starting: **what will this cost me?** (renders out of 100/day, chunks, wall-clock)
2. After starting: **is it stuck, or is it fine?** — asked repeatedly, from a glance, for an hour.

## The design problem

The surface has two lives that pull in opposite directions: five dense minutes of configuration,
then an hour of low-attention monitoring. A single wizard serves the first and fails the second;
a job table serves the second and buries the cost decision that matters most.

## Chosen direction

**Twinned columns around a fixed centre rail** (surface concept seed key `3f5f589c`, assigned
candidate 4, fused with `rw-centre-rail-reference-setting` for grammar and
`vernacular-ephemera-jet-age-ticket-wallet` for state vocabulary).

- **Left column — PLAN.** What was committed: source, feature, chunk length, the derived split.
  Editable before start, frozen and authoritative after.
- **Centre rail — the chunk keys.** One detent per chunk, in order, shared by both columns. Output
  boundaries are cut into the rail where the flow changes footing. This is the single moving part.
- **Right column — LIVE.** What actually happened, row-aligned to the same keys.

Divergence between the two columns is therefore the first thing the eye catches, which is exactly
the monitoring question. Row alignment means "chunk 7 is the problem" needs no reading.

**State as printed marks, never as vanishing.** A chunk is hairline at rest, filled while active,
struck when spent, and *voided in place* when it fails — it keeps its key and its row so a retry has
somewhere to land. Nothing disappears; it cancels.

## Memorable moment

The **cost line** resolves live while the chunk-length control moves: one drag re-derives chunk
count, output count, render count, and remaining daily quota together, in mono, with the 1800-second
merge cap drawn as a hard rule the plan cannot cross. The creator sees the price before the commit,
not after.

## Constraints

- Committed identity is fixed: Creator Control Room graphite, one signal accent, Space Grotesk /
  Hanken Grotesk / JetBrains Mono, existing radius and spacing scales. The seed authorizes no new
  palette, type system, or unfamiliar control behavior.
- Production minimum 1100×720 with no document-level horizontal overflow. At 30 chunks the rail must
  stay readable, so it scrolls within the pane rather than compressing to illegibility.
- The account permits only 3 simultaneous logins and 100 renders/day; both limits must be legible in
  the UI, not discovered through failure.
- Terminal remote state is authoritative. The screen never infers success from absence of error.

## Unresolved

- Whether the plan column should stay editable for *queued* chunks after start. Currently frozen at
  start; revisit if retry-with-different-length proves to be a real need.
