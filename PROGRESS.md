# Current Objective

Bring the Compose → **Remotion** timeline editor (`src/features/video-studio/editor/`) up to the
requirements in `temp2.md`, then fix the hook, timeline and layout bugs. **All four milestones done.**

# Requirement checklist (temp2.md)

| # | Requirement | Before | Now |
|---|---|---|---|
| R1 | 30 s hook intro motion graphics, premade template | **PART** — two registered, but placing one drew an empty frame and blocked every render | **DONE** — Hook tab → "Add this hook" builds a real 900 f / 5-beat plan and it animates |
| R2 | Caption templates | **DONE** — 6 styles, each really implemented | unchanged |
| R3a | Spoken-word (karaoke) highlight | **DONE** | unchanged |
| R3b | Important-word emphasis in the model | **DONE** — `CaptionWord.importance` | unchanged |
| R3c | **Copy-prompt button** for important words | **PART** — engine round trip existed, no UI in this editor | **DONE** — Captions tab, with purpose + ratio controls |
| R4 | Transitions | **PART** — `zoom` / `blur` / `dip-to-black` never rendered | **DONE** — all 6 animated types form a `TransitionSeries` chain |
| R5 | Cinematic colour grading | **PART** — real ffmpeg pass, invisible in the preview | **DONE** — labelled CSS approximation in the player |
| R6 | B-roll fetcher (optional) | **PART** — search + place reachable; batch/orientation/attribution are not | unchanged (deliberate, see below) |
| R7 | Hook via copy-prompt → external AI → paste (optional) | **PART** — pipeline existed, unreachable here | **DONE** — Hook tab, `PromptExchange` |
| R8 | `remotion-bits`, `onda-engine`, TikTokTextBox, hyperframes packs | — | **Not installed.** Every capability they were listed for is already implemented natively and CSP-safe; adding them would duplicate working code. Flagged for the user to overrule. |

# Verified Completed

- `npm run typecheck` — clean.
- `npm run build` — exit 0.
- `npx vitest run` — **637 passed, 24 skipped, 0 failed** (65 files), including two new suites:
  `test/unit/video-engine/editor-operations.test.ts` (27) and `remotion-transition-chains.test.ts` (10).
- Milestone smokes `ME_SMOKE=1|m3|m4|m5|m6|m7` — all six print `SMOKE*_OK`.
- `npm run e2e:studio` (HyperFrames) and `--engine remotion` — both `E2E OK`, no renderer console errors.
- Live over CDP (`scripts/studio-live.mjs` + playwright-cli), before → after:
  - dragged clip renders **300 px = its 90-frame duration** (was 95 px against an untouched 90 frames);
  - a drag interrupted by window blur no longer commits on the next click anywhere (clip stayed at
    frame 180; before, clicking the *Media tab* moved it to 140);
  - premade hook compiles a 900 f / 5-beat plan, paints `01 / 05` in the player, **preflight clean**
    (was `error:hook-plan.invalid`, which blocked the render permanently);
  - a grade preset applies `contrast(1.14) saturate(1.15)` + tint/vignette layers to the stage.
- **User data intact**: `%APPDATA%\Mental Empire Studio\mental-empire.db` is SHA-256 identical to the
  pre-work snapshot `…- CLAUDE-BACKUP-20260801-113008`.

# Root causes fixed

**Hook** — `scene.tsx` routed on the template *id* before testing for a plan, so a hook placed from
the templates panel (which attaches no plan) hit `HookTemplate`, which returns `null` without one.
`adapter.ts` then raised a blocking `hook-plan.invalid`. The working AI-hook pipeline had no caller in
this editor at all. Also: the two hook paths used different tracks so neither replaced the other;
`rescaleHookPlan` was never called, so an fps change bricked an existing hook; `coerceToBudget` could
emit a plan its own schema rejects; the prompt's `visual` example taught a shape `strictObject` refuses.

**Timeline — "shortens but the duration is unchanged"** — the gesture wrote `style.width` straight to
the DOM and `onUp` cleared it. `width` is React-owned, and React only writes a style property when its
own previous value differs from its next one; a gesture that ends without changing the duration leaves
those equal, so React never wrote it back and the clip stayed collapsed at its label's width.

**Timeline — "dragging creates a duplicate"** — three compounding causes: the collapse above turned one
clip into a narrow stub beside its full-size neighbour; `moveClip` permits overlap (correctly — a
transition *is* an overlap) but two stacked clips were drawn indistinguishably; and snap candidates
offered a lane-mate's *start* to a dragged *start*, which is a perfect-stack attractor. Separately, a
drag interrupted by lost focus stayed armed and committed on the user's next click anywhere.

# Files changed

`electron/services/video-engine/{hook-compiler,hook-generator,studio}.ts` ·
`shared/video-engine/hook-plan.ts` · `video-engine/remotion/{adapter.ts,scene.tsx,timeline.ts}` ·
`src/features/video-studio/editor/{EditorShell,Inspector,PreviewStage,Timeline}.tsx`,
`{constants,operations,useEditor}.ts`, `editor.css`, **new** `gradePreview.ts`, `hookPlan.ts` ·
**new tests** `test/unit/video-engine/{editor-operations,remotion-transition-chains}.test.ts`

# Do Not Modify

- The old studio (`src/features/video-studio/panels/`, `VideoStudio.tsx`) and the Classic /
  HyperFrames engines — untouched and still green.
- `electron/services/smokeSafety.ts` and the userdata guards.

# Open, deliberately not done

- **The hook overlays the opening rather than pushing the video back.** `compileHookPlan` is shared
  with HyperFrames, so changing it to prepend would change that engine too. The panel now says what it
  does. If an intro that offsets the timeline is wanted, add it as a local `operations.ts` edit.
- **B-roll (R6)** is search-and-place only in this editor; the keyword-batch prompt, orientation filter
  and attribution surface still live only in the old studio's panel.
- `rescaleHookPlan` leaves a plan untouched when the new rate cannot express it (a 30 s plan scaled
  past the schema's 30 s ceiling); preflight still reports it rather than the hook being deleted.
- 10 inspector tabs need 3 grid rows at a ~290 px inspector. Rows are aligned and no label is clipped;
  going to 2 rows would require truncating "Transitions".

# Verification

```bash
npm run typecheck && npm run build && npx vitest run && npm run e2e:studio
```
Live: `node scripts/studio-live.mjs --port 9222`, then
`playwright-cli -s=mes attach --cdp=http://localhost:9222` **from PowerShell**.
