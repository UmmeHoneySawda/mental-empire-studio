# Handoff — Cinematic Hooks and Captions wired into the Compose tab

**Date:** 2026-08-22
**Repo:** `D:\Work\mental-empire-studio`
**Branch:** `build/mental-empire-studio` — worked in place, tree was clean at start
**Base commit:** `e15dc55` (`feat(automation): wire TalkingPhoto casting into VisualTemplate preset`)
**State on handoff:** all work is in the **working tree, unstaged and uncommitted**. `AGENTS.md` forbids
commits unless asked, and the user did not ask. `git diff --cached --name-only` is empty; `HEAD` is
still `e15dc55`.
**User-data backup taken before anything ran:** `CLAUDE-BACKUP-20260821-164231`
(restore with `npm run userdata:restore`, list with `npm run userdata:list`).

---

## 1. The requirement, as given

> `"D:\Cinematic hooks and captions.zip"` this contains all new 5 video hook template and 5
> subtitle/caption templates. Your job is to wire them into our app. You just work on the compose tab
> for now. Test with 5-10 second footages so its fast and dont have to wait that long. Dont change any
> existing code. You just add them. They will be under a new accordion called New Templates. Test each
> hook and caption live. Your job is to just wire them dont change anything already existing. No need
> to ask me any question brainstorm then write a plan then execute using subagents.

Decomposed into hard constraints:

| # | Constraint | How it was honoured |
|---|---|---|
| 1 | Wire in 5 hooks + 5 captions from the zip | Ten new Remotion components, ten registered manifests |
| 2 | Compose tab only | Primary UI is `src/features/video-studio/editor/*`. The registry spread also reaches `src/screens/Profiles.tsx` (caption template list) and `electron/services/video-engine/service.ts` (caption cue grouping), so both were filtered/hardened to keep existing behaviour — see §6/§8 |
| 3 | Test with 5–10s footage | `test/fixtures/broll/local/clip1.mp4`, 6.000s confirmed by ffprobe |
| 4 | **Don't change existing code** | Additive only. Thirteen existing files touched, each an appended line, an appended block, or one new branch. `builtins.ts` byte-identical to HEAD |
| 5 | Under a new accordion called **New Templates** | One `<details class="ve-newtpl">`, collapsed by default, in the Hook panel and the Captions panel |
| 6 | Test each hook and caption **live** | Real Electron + Playwright harness; all ten applied, seeked, screenshotted; every screenshot reviewed by eye |
| 7 | No questions; brainstorm → plan → execute with subagents | Brainstormed to a spec, wrote a plan, executed with subagents until they became unusable (see §7) |

---

## 2. What the delivered zip actually contained

Extracted working copy (gitignored): **`scratch/cinematic-hooks-and-captions/`**
Original archive: `D:\Cinematic hooks and captions.zip` (79,693 bytes, 27 files)

```
cinematic-hooks-and-captions/
  README.md            the ten, type/colour rules
  HANDOFF.md           the design rules — READ THIS if you touch the look
  preview/             browsable animated catalog (source of truth for the LOOK)
  remotion/src/        the ten as Remotion components (source of truth for USE)
    theme.tsx  film.tsx  useT.ts  Root.tsx  entry.ts  fonts.ts
    templates/Hook01TitleCard.tsx … Caption05Held.tsx
```

Ten pure-function-of-time components at 1920×1080 / 30fps, in a film idiom: type on black, 35mm grain
and vignette above everything, **no boxes**, no rounded cards, one accent per frame.

Fixed type roles: **Cinzel** = statement, **Oswald** = impact, **Courier Prime** = apparatus.
Palette: black `#0b0a08`, bone `#ECE5D8`, dim bone 42%, accent ember `#C9553C`.

| Delivered | Length | Behind the text |
|---|---|---|
| Hook01 Title Card | 4.0s | black |
| Hook02 Reel Burn | 5.0s | footage |
| Hook03 Hard Light | 3.5s | black + blinds |
| Hook04 Trailer Drop | 6.0s | black |
| Hook05 Margin Note | 5.5s | footage, right 66% |
| Caption01 Word Pop | 6.0s | black |
| Caption02 Keyword Stack | 4.5s | black |
| Caption03 Scrim Roll | 6.0s | footage |
| Caption04 Line Build | 6.5s | black |
| Caption05 Held | 4.0s | black |

The delivered `HANDOFF.md` explicitly asks that Caption 01 and Caption 04 be **retimed from real
word onsets** instead of their fixed `step`. That was done.

---

## 3. How the app already worked (the reconnaissance that shaped the design)

- **Compose tab** = `src/screens/Compose.tsx` → `EditorShell` → `Inspector`. `Inspector` switches on
  `state.tab`; `tab === 'hook'` renders its local `HookPanel`, `tab === 'captions'` its
  `CaptionsPanel`. The panels under `src/features/video-studio/panels/` belong to an older shell and
  are **not** in this path.
- **Manifest registry.** `electron/services/video-engine/templates/builtins.ts` exports
  `BUILTIN_VIDEO_TEMPLATES`; `VideoTemplateRegistry` wraps it and is constructed with no arguments at
  `electron/services/video-engine/service.ts:218`.
- **Hooks** are a `kind: 'template'` scene on the `video-engine-hook` overlay lane whose
  `template.props.hookPlan` is a validated `HookPlan`. `compileHookPlan` requires the manifest and runs
  `resolveTemplateProps`, which **throws on any prop key not declared as a manifest parameter**.
- **Critically:** `video-engine/remotion/scene.tsx` sent *every* template scene with a valid plan to one
  generic `HookTemplate`, where the template id only picked a style preset. There was **no
  per-template component dispatch**. That is why the new set needed one.
- **Captions** are project-wide: a `CaptionDocument` of word-timed `CaptionWord`s plus one
  `kind: 'caption'` scene (`video-engine-captions`) spanning the canvas. `CaptionLayer` resolves a
  style via `resolveCaptionStyle`, which **falls back to `highlight` for any unknown id** — so an
  unregistered style silently renders as an existing one.
- **Preview and render share one component.** `RemotionPreview` mounts `RemotionVideo` from
  `video-engine/remotion/composition.tsx` in `@remotion/player`; the render bundles the same component
  through `video-engine/remotion/entry.tsx`. One dispatch change fixes both.
- **Fonts are self-hosted.** The renderer CSP forbids a font CDN. Renderer fonts come from
  `@fontsource/*` in `src/main.tsx`; the render bundle imports its own set in
  `video-engine/remotion/entry.tsx`.

---

## 4. Design decisions, and the two alternatives rejected

Spec: **`docs/superpowers/specs/2026-08-21-cinematic-hooks-and-captions-design.md`** (350 lines)
Plan: **`docs/superpowers/plans/2026-08-21-cinematic-hooks-and-captions.md`** (3,652 lines, 8 tasks)

**Chosen:** a self-contained layer beside the existing one, joined at three dispatch points.

**Rejected — extend `CAPTION_STYLE_IDS` / `CaptionStyleDefinition`.** That type fixes `fontFamily` to
four grotesk/mono faces, so Cinzel, Oswald and Courier Prime cannot be expressed. It also routes the
new captions through `CaptionLayer`, whose plates, pills and boxes are the exact idiom these templates
forbid.

**Rejected — express the new hooks as `HookStyleProps` presets.** `HookStylePropsSchema` is a closed
vocabulary of five animation presets and five backgrounds. None of the five new hooks (light-leak wipe,
raking shaft through blinds, trailer flare, documentary column with running timecode) is reachable
from it.

**Why register through `VideoTemplateRegistry` and not `BUILTIN_VIDEO_TEMPLATES`:** three existing test
suites assert exact counts and exact id sets against that array (`renderers.test.ts` 7 hooks / 10
captions, `hook-templates.test.ts` 7 equal to `REMOTION_HOOK_TEMPLATE_IDS`, `caption-styles.test.ts`
captions equal to `CAPTION_STYLE_IDS.length`). Registering through the registry keeps all three green
untouched, while still reaching `videoEngine.templates()`, preflight, `compileHookPlan` and
`setCaptionTemplate`. **This choice had a hole — see §8, Critical 1.**

### The ten ids (verbatim; nothing may drift from these)

```
remotion-hook-cine-title-card      remotion-caption-cine-word-pop
remotion-hook-cine-reel-burn       remotion-caption-cine-keyword-stack
remotion-hook-cine-hard-light      remotion-caption-cine-scrim-roll
remotion-hook-cine-trailer-drop    remotion-caption-cine-line-build
remotion-hook-cine-margin-note     remotion-caption-cine-held
```

No new caption id ends with an existing `CaptionStyleId`, which matters because
`captionStyleIdFromTemplateId` matches by `-<styleId>` suffix. Pinned by test.

### Display names use U+00B7

`Cine · Title Card` etc. The middle dot is **U+00B7**. The unit test asserts it by codepoint using a
`\u00B7` escape, so the guard survives an encoding accident in the test file itself. The Playwright
harness matches on the same literal. If you see `Â·` anywhere, a UTF-8 → CP1252 round trip has happened.

### Hex is canonicalised UPPERCASE

`NEW_TEMPLATE_ACCENT = '#C9553C'`, `NEW_TEMPLATE_BONE = '#ECE5D8'`, and `resolveNewCaptionStyle`
uppercases on both its fallback and override branches. The original draft had lowercase constants and
uppercased overrides, so one colour had two string forms — which defeats the "one table so nothing can
drift" rationale. Lowercase hex is permitted only inside a comment's prose.

---

## 5. Architecture as built

```
shared/video-engine/new-templates.ts          ← THE single definition of the set
        │  ids · guards · display names · defaults · caption paging · resolveNewCaptionStyle
        │  zero React, sibling-modules-and-zod only, imported by all three layers
        ├──────────────────────────┬────────────────────────────┐
        ▼                          ▼                            ▼
electron/.../templates/     video-engine/remotion/       src/features/video-studio/
  new-templates.ts            new-templates/               editor/
  ten TemplateManifests         kit.tsx    theme+film        newTemplates.ts
        │                       hooks.tsx  5 hooks          NewTemplatesAccordion.tsx
        ▼                       captions.tsx 5 captions            │
  registry.ts                   index.ts   barrel                  ▼
  +NEW_VIDEO_TEMPLATES               │                       Inspector.tsx
                                     ▼                       mounts the accordion
                         scene.tsx  +1 new-hook branch
                         composition.tsx  caption conditional
```

### Hook content model

Each hook compiles a **single-beat** `HookPlan` and goes out through the *existing* `importHookPlan` —
the same validated, zod-checked entry point the premade and AI hooks use. No new IPC, no second
compiler. The primary line is written to **both** the beat headline and the matching prop, so the
existing Beats list edits the same line the accordion does.

| Template | `beats[0].headline` | `beats[0].body` | props only |
|---|---|---|---|
| Title Card | `line` | — | `kicker` |
| Reel Burn | `lineA` | `lineB` | — |
| Hard Light | `lineA` | `lineB` | — |
| Trailer Drop | `drop` | — | `beatA`, `beatB` |
| Margin Note | `line` | — | `reel`, `startTimecodeSeconds` |

`visual: { kind: 'none' }` on every beat — footage comes from the timeline under the hook lane.

**Declared manifest parameters** (a component reading anything else gets `undefined`; writing anything
else throws `Unknown template property`):

- title-card: `line`, `kicker`, `grain`, `accentColor`
- reel-burn: `lineA`, `lineB`, `grain`, `accentColor`
- hard-light: `lineA`, `lineB`, `grain` — **no accentColor, by design**
- trailer-drop: `beatA`, `beatB`, `drop`, `grain`, `accentColor`
- margin-note: `line`, `reel`, `startTimecodeSeconds`, `grain`, `accentColor`
- all five captions: `textColor`, `accentColor`, `grain`, `maxWordsPerCue`, `maxCharactersPerLine`

Wrap a word in `*asterisks*` to accent it (`lineB`, `drop`).

### Two porting rules applied everywhere in `hooks.tsx`

1. **`T()` retiming.** Every delivered time is multiplied by `k = dur / defaultSeconds`, including the
   exit's start and duration. At the delivered length `k === 1`, so the choreography is byte-identical;
   at any other length it keeps its proportions instead of clipping mid-beat. Flare and flash
   half-widths divide by `k`. **`t` itself is never scaled** — Margin Note's timecode must advance in
   real seconds.
2. **`px()` / `tp()` sizing.** Delivered pixels are authored at 1920 wide. Geometry × `scale`, type ×
   `typeScale`, which is `1.38 × scale` on portrait and square canvases — the 0.78× the delivered
   handoff prescribes for 9:16. Margin Note has an explicit **stacked** layout when the canvas is
   taller than it is wide, because the handoff says the two-column split does not port to vertical.

### Caption model

All five are driven by the project's real caption document. Every onset is a `CaptionWord.startFrame`;
paging comes from the same `groupCaptionCues` the existing styles use, with per-template limits from
the shared table.

Grain and the Scrim Roll scrim live on the **layer**, not the cue — the caption scene spans the whole
canvas, so anything drawn per cue would blink at every cue boundary. **No vignette and no gate weave on
the caption layer**: a caption style has no business moving the user's footage. `grain: 0` turns the
film texture off.

### The four dispatch points

```tsx
// video-engine/remotion/scene.tsx — one branch BEFORE the existing hook path
if (isNewHookTemplateId(scene.template?.id)) return <NewHookScene scene={scene} />
if (hasValidHookPlan(scene)) { …existing… }

// video-engine/remotion/composition.tsx — substituted for the single <CaptionLayer/> line,
// so exactly one caption layer ever draws
{cinematicCaptions ? <NewCaptionLayer project={project} /> : <CaptionLayer project={project} />}

// electron/services/video-engine/templates/registry.ts
new TemplateRegistry([...BUILTIN_VIDEO_TEMPLATES, ...NEW_VIDEO_TEMPLATES, ...additional])

// electron/services/video-engine/service.ts — caption cue grouping mirrors the render dispatch,
// so the editor's cue list groups with the same per-template limits the render draws
const newStyle = resolveNewCaptionStyle(templateId, props)
if (newStyle) return groupCaptionCues(document, captionGroupingOptionsForNewTemplate(newStyle, fps))
```

`video-engine/remotion/constants.ts` was considered as a fourth registry seam (preflight `HOOK_TEMPLATE_IDS`) but **reverted** — its only consumer is a `hook-plan.missing` warning whose copy ("renders as a plain title card… in the Hook panel") is false for these five hooks, which render their full animation with default text. Silence is less wrong than a wrong warning.`

---

## 6. Every file touched

### New (10 source + 1 test + 1 harness)

| File | Lines | Responsibility |
|---|---|---|
| `shared/video-engine/new-templates.ts` | 361 | Ids, guards, the ten definition rows, `resolveNewCaptionStyle`, `captionGroupingOptionsForNewTemplate` |
| `electron/services/video-engine/templates/new-templates.ts` | 154 | `NEW_VIDEO_TEMPLATES` — ten manifests built from the table |
| `video-engine/remotion/new-templates/kit.tsx` | 224 | Ported theme + film: fonts, palette, `Ease`, `MOTION`, `Mark`, `Grain`, `Dust`, `Vignette`, `Weave`, `FilmFrame`, prop readers |
| `video-engine/remotion/new-templates/hooks.tsx` | 624 | The five hooks + `NewHookScene` dispatcher |
| `video-engine/remotion/new-templates/captions.tsx` | 601 | The five caption bodies + `NewCaptionLayer` + `usesNewCaptionTemplate` |
| `video-engine/remotion/new-templates/index.ts` | 3 | Barrel |
| `src/features/video-studio/editor/newTemplates.ts` | 228 | `newHookPlan`, `newHookDraft`, `newHookDraftFromProps`, `newCaptionDraft`, `newCaptionDraftFromProps`, `newCaptionProps` |
| `src/features/video-studio/editor/NewTemplatesAccordion.tsx` | 437 | The accordion, hook and caption modes (now with generation-token race fix and hook re-seed) |
| `test/unit/video-engine/new-templates.test.ts` | ~950 | **51 tests** (44 original + 7 for `newHookDraftFromProps`) |
| `scripts/e2e-new-templates.mjs` | ~620 | Live Electron verification of all ten (now with file-size + headline/caption-text draw assertions) |

### Modified — every one additive

| File | Δ | What |
|---|---|---|
| `package.json` | +4/-0 | `@fontsource/cinzel`, `@fontsource/oswald`, `@fontsource/courier-prime` (5.3.0 exact) + `e2e:new-templates` script |
| `src/main.tsx` | +10/-0 | Seven font stylesheet imports for the live `<Player>` |
| `video-engine/remotion/entry.tsx` | +11/-0 | The same seven for the render bundle |
| `shared/video-engine/index.ts` | +1/-0 | `export * from './new-templates'`, in its alphabetical slot |
| `electron/.../templates/registry.ts` | +6/-1 | Spread `NEW_VIDEO_TEMPLATES` into the registry |
| `video-engine/remotion/scene.tsx` | +6/-0 | One new-hook branch |
| `video-engine/remotion/composition.tsx` | +15/-1 | Memoised caption-layer conditional + isolation + scrim/grain span fade |
| `src/features/video-studio/editor/Inspector.tsx` | +22/-2 | Mounts the accordion in both panels; filters the new ids out of the two pre-existing lists |
| `src/features/video-studio/editor/editor.css` | +45/-0 | Appended `.ve-newtpl` block at EOF + `:focus-visible` for `<summary>` |
| `test/unit/video-engine/service.test.ts` | +3/-1 | Registry hook count now `7 + NEW_HOOK_TEMPLATE_IDS.length` (additive, see §8) |
| `electron/services/video-engine/service.ts` | +19/-4 | Caption cue grouping mirrors `composition.tsx` dispatch so editor cues match render |
| `src/screens/Profiles.tsx` | +25/-4 | Filters `isNewCaptionTemplateId` from Visual System picker + validates `captionStyleIdOf` (was unchecked `as`) — `CAPTION_STYLE_TO_PRESET` is total over `CaptionStyleId` |
| `.github/workflows/ci.yml` | +2/-0 | Adds `New Templates e2e` step (`xvfb-run -a node scripts/e2e-new-templates.mjs`) |
| `shared/video-engine/new-templates.ts` | +~8/-2 | `fontScale` 0.082→0.089 (Word Pop 96px) / 0.072→0.078 (Line Build 84px), clamp comment 0.032→0.037, 86_399 comment |
| `video-engine/remotion/new-templates/*` | — | `captions.tsx` portrait paging (0.62× on <0.9 ratio), `kit.tsx` Dust guard, `hooks.tsx` margin-note budget 1.7→2.4 + dur rationale fix, `captions.tsx` isolation + re-anchored insets |
| `src/features/video-studio/editor/newTemplates.ts` | +1/-1 | `HEX` now allows `#RRGGBBAA` (was 6-digit only, manifest accepts 8-digit) |
| `src/features/video-studio/editor/NewTemplatesAccordion.tsx` | +~30/-5 | Generation-token race fix, hook re-seed `useEffect`, `aria-pressed`, number-field placeholder |
| `package-lock.json` | — | `npm install` byproduct |

`video-engine/remotion/constants.ts` was modified to add `NEW_HOOK_TEMPLATE_IDS` to `HOOK_TEMPLATE_IDS` and then **reverted** (see §5) — HEAD is byte-identical.`

**`electron/services/video-engine/templates/builtins.ts` is byte-identical to HEAD.**

### Not mine, and left alone

`.gitignore`, `CLAUDE.md`, untracked `.claude/skills/` are dirty. They changed during the session from
tooling outside this work — CLAUDE.md's benchmark / e2e / build-trap sections were moved into
`.claude/skills/*/SKILL.md`, and `.gitignore` was updated to track them. All three verified present and
non-empty; nothing was lost. Left in place per AGENTS.md ("do not overwrite unrelated work in a dirty
tree") and excluded from every review package.

---

## 7. How it was executed, and where the process broke

Followed superpowers: **brainstorming → writing-plans → subagent-driven-development**.
SDD workspace (gitignored): **`.superpowers/sdd/2026-08-21-cinematic-hooks-and-captions/`**
— `progress.md` (270-line ledger, every ruling and deviation), `task-{1..8}-brief.md`,
`task-{1,2,3}-report.md`, review packages.

| Task | How |
|---|---|
| 1 fonts + userdata backup | subagent + reviewer subagent + fix round |
| 2 shared table | subagent + reviewer subagent + fix round (reviewer ran 12 mutation probes) |
| 3 manifests + registry | subagent **interrupted mid-task**; two reviewer dispatches killed → controller verified by execution |
| 4–8 | controller direct, verification by execution |

**Two process problems, both recorded in the ledger rather than hidden:**

1. **Subagent dispatches became unusable.** One implementer was killed mid-task (after its file work
   landed, before its report) and three reviewer dispatches were killed outright. From Task 4 the
   controller implemented directly and substituted **execution for review**: a throwaway `tsx` probe
   introspecting the real manifests, and DOM reads against the real running app. That is a stronger
   check than a reviewer reading a diff — and it is what caught both live defects in §8.
2. **Task briefs were mojibake-corrupted.** PowerShell 5.1's `Get-Content` read the BOM-less UTF-8 plan
   as CP1252, turning `·` into `Â·` and `—` into `â€"`. Caught by the Task 2 subagent, which decoded
   rather than copied. All briefs were regenerated with `[System.IO.File]::ReadAllText(path, UTF8Encoding($false))`.
   **If you regenerate briefs, use the .NET APIs, not `Get-Content`.**

---

## 8. Defects found, and how

### Two live defects — both "code ran, no error, silently drew nothing"

Neither was catchable by a unit test, a typecheck, or a green harness run. Both were found by **opening
the screenshots and looking**.

1. **Keyword Stack drew no accent word and no swipe rule for most of every cue.** The keyword was chosen
   from the *whole* cue and preferred whichever word was being spoken, so it usually landed on the setup
   line, where no swipe is rendered — and when it did land on the payoff it hopped word to word, which
   is a second karaoke, not a keyword. Caption 01 already does karaoke.
   **Fix:** first AI-marked payoff word, else the longest payoff word, stable for the cue's life, sweep
   timed to that word's own onset. Verified at the DOM: swipe present in every drawn frame, one accent
   word, `scaleX` 0.281 at frame 114 → 1.0 at frame 137 (0.7s later) on the same word `"blocked"`.
2. **Held Statement never accented anything on an ordinary transcript.** It only accented an
   AI/manually marked word, yet computed a fallback *onset* while leaving the target `undefined` — so
   the glow was timed for a word that never lit.
   **Fix:** same longest-word fallback. `"SCREAMING"` now carries the ember accent and glow.

Both DOM reads that found these became **permanent assertions** in the harness.

### The Critical the final review caught, which I had missed

**Plan defect, mine.** Registering through `VideoTemplateRegistry` puts all ten manifests into
`videoEngine.templates()` — and the **pre-existing** Inspector sections filter that list by `kind`
alone. So:

- "Hook template" silently went 7 → 12 cards. Worse: their "Add this hook" runs `defaultHookPlan`,
  whose `seedsFor` matches none of the new ids (`cine` ≠ `cinematic`) and falls through to the **5-beat
  KINETIC** seed, while the new components read only `beats[0]`. **Two clicks to a hook drawing the
  project name over the placeholder body "The promise, in one line."**
- "Caption style" went 10 → 15, offering the Cinematic styles with none of their controls.

The registry choice defended the *tests* that pin `BUILTIN_VIDEO_TEMPLATES` and **not the UI that reads
the registry**. Fixed by filtering with `isNewHookTemplateId` / `isNewCaptionTemplateId` at
`Inspector.tsx:617` and `:884`, pinned by unit test and by two live harness assertions.

### Other Importants fixed in the same wave

- **Line Build's between-cue hold was unbounded.** The caption scene spans
  `project.canvas.durationFrames`, so the stack stayed burnt on screen for the rest of the video after
  the last word. Now bounded to two `maxGapSeconds` past the cue's end.
- **The accordion discarded saved caption settings.** It seeded from the table, never the saved scene
  props, so reopening a customised project showed defaults — and the first touch of any control wrote
  them back. Added `newCaptionDraftFromProps`.
- **Hook manifests claimed `audio` and `broll` capabilities nothing implements.** These components
  render no `beat.visual` and no audio, so a pasted or AI plan carrying an `assetId` resolved to a blank
  frame with no error. Now `['dynamic-duration', 'transitions']`.
- **The caption sliders wrote on every mouse-up and blur,** burning a project revision for an identical
  document. `apply` now compares against the saved props first.
- Minors: a dead `clamp()` around an already-bounded helper; `timecodeStamp` never rolled hours
  (rendered `00:1439:59:xx` near its bound); `usesNewCaptionTemplate` re-walked `project.scenes` on
  every painted frame, now memoised.

### Three harness bugs fixed on the way

Each has a comment beside the fix, because each cost a full run to find:

1. Screenshots captured the preview *region* while the flyout panel occluded the left third of every
   frame — Hard Light read `"U'VE BEEN BRACED"`. Now closes the panel and captures `.ve-stage-frame`.
2. Clicking a `<summary>` **toggles**; the accordion closed itself between templates. Now
   `ensureAccordionOpen` checks the attribute.
3. Evenly spaced sample frames landed in the gaps between cues, where a caption layer correctly draws
   nothing. Now samples from **word onsets**, which are inside a cue under any paging.

### Deferred, with the reasoning

| Item | Call |
|---|---|
| `Object.freeze` is shallow — nested objects and `textFields` stay runtime-mutable | can stand; nothing mutates them, `readonly` covers authored code |
| Caption stagger 0.18s vs delivered 0.42s; setup→payoff 0.12s vs 0.35s | **not drift.** The delivered values are tuned for a standalone 6s composition; over a real 2.4s cue a 0.42s-per-line stagger lands the last line after the cue ends |
| Insets derived from `metrics.safeInset` rather than the delivered fixed 190/240px | **not drift.** Holds on 9:16 and 1:1 as well as 16:9, which the delivered handoff asks for and a fixed pixel cannot do |
| Grain and the Reel Burn leak use `mixBlendMode` under `isolation: 'isolate'`, so they composite flat rather than blending with footage | can stand; matches the existing `CaptionLayer` idiom exactly. Changing it would alter existing behaviour, which this work may not do |
| Line-ending drift: `entry.tsx` all-LF, `src/main.tsx` mixed | can stand; `core.autocrlf=true` renormalises on commit |
| No unit tests for the Remotion components | accepted and documented. Rendering them under jsdom proves far less than driving the real Player, which is what caught both defects. Coverage lives in the harness |

---

## 9. Verification — commands and results

```bash
npm run userdata:backup          # ran FIRST → CLAUDE-BACKUP-20260821-164231
npm run typecheck                # clean, all three tsconfigs
npm run build                    # clean
npm test                         # 4 failed | 845 passed | 17 skipped
node scripts/e2e-new-templates.mjs   # PASS
```

- **`npm test`: 845 passing.** Baseline before this work was 827. The **4 failures and 11
  collect-failures are pre-existing** and byte-identical to baseline — see §10.
- **`new-templates.test.ts`: 44 tests.** Manifest validity; additivity against
  `BUILTIN_VIDEO_TEMPLATES` (7/10, asserted with literals); the ten literal ids; the `Cine ·` name
  shape by codepoint; mojibake absence; exact parameter sets per template with Hard Light's absent
  `accentColor` pinned by hand; two-sided clamps; the `fps` guard; plan validity + `compileHookPlan`
  acceptance at 24/30/60fps; empty and 5000-char field extremes; the 30-second ceiling; the
  manifest-bound ↔ resolver-clamp round trip; the panel-filter predicate; the `defaultHookPlan` seed
  mismatch that made the filter necessary; saved-draft read-back.
- **The harness** launches real Electron with a throwaway `ME_USERDATA_DIR`, seeds a clip, imports the
  6.000s fixture onto `main-video`, imports captions from a generated SRT (no Groq key needed), then for
  each of the ten: opens the accordion, clicks the card, applies, seeks to four points, screenshots.
  It also asserts preflight is clean, exactly one caption layer per frame, no renderer console errors,
  the two pre-existing lists are untouched, the Keyword Stack swipe/accent behaviour, the Held accent,
  and userData isolation — plus a **regression pass on the existing Impact Pop style**.
- **All 11 screenshots reviewed by eye**, in `browser-test-out/new-templates/`. Every hook and caption
  reads as the delivered design; Reel Burn, Margin Note and Scrim Roll show the 6s clip behind the
  text, proving the transparent-background footage path.

> The fixture clip is a synthetic mandelbrot test pattern. That is the fixture, not a rendering bug.

---

## 10. Pre-existing problems you should know about — not caused by this work

1. **Eleven vitest files fail to COLLECT** under jsdom:
   `Invariant violation: "new TextEncoder().encode("") instanceof Uint8Array" is incorrectly false`
   from `esbuild/lib/main.js:201`, reached through `@hyperframes/*` and `@remotion/bundler`.
   **Two of the dead files are `test/unit/video-engine/renderers.test.ts` and `caption-styles.test.ts`
   — the suites that pin your existing manifest counts.** They are not a safety net right now; the
   additivity guard was therefore re-asserted inside `new-templates.test.ts`. Worth its own ticket.
2. **Four pre-existing test failures:** `video-engine-data-root.test.ts` ×3 and
   `video-engine-migration.test.ts` ×1, all about C:/D: env precedence.
3. **An order-sensitive flake:** one `npm test` run reported 5 failures where the next two reported 4,
   with no code change. The extra one is `download-client-fallback.test.ts` (a `node:child_process`
   default-export mock), inside the pre-existing set.

---

## 11. Open items for whoever picks this up

1. **Nothing is committed.** Review the working tree and commit when you want to. Suggested split:
   fonts + shared table + manifests, then the Remotion components + dispatch, then the UI + harness.
2. **The final MP4 render path is unproven.** `npm run build` runs electron-vite and does **not** bundle
   `video-engine/remotion/entry.tsx`. In the render bundle the font registration and both dispatch
   points are backed only by typecheck plus line-for-line parity with the verified `src/main.tsx`
   imports. **One real render of a project using a new hook and a new caption would close this** —
   everything visual in §9 comes from the live `<Player>`.
3. **`scripts/e2e-new-templates.mjs` now has both a `package.json` script (`e2e:new-templates`) and CI wiring (`New Templates e2e` step in `.github/workflows/ci.yml`).** It remains the only guard for all ten components — the harness now also asserts file-size + headline/caption-text draw, not just `check(true)`. Keep it wired.
4. **Vertical (9:16) was only reasoned about, not rendered.** The type uplift and Margin Note's stacked
   layout are implemented and typechecked; no 1080×1920 frame was captured.
5. **`scratch/cinematic-hooks-and-captions/`** is the delivered source, gitignored. Keep it while anyone
   is still comparing fidelity; the original zip is at `D:\Cinematic hooks and captions.zip`.

## 12. If you change the look

Read **`scratch/cinematic-hooks-and-captions/HANDOFF.md`** first. Its rules are load-bearing here:

- Three motion helpers only — `MOTION.rise`, `MOTION.sweep`, `MOTION.pop`. **Do not add a fourth easing.**
- Everything is a pure function of `t`. No `useEffect`, no `requestAnimationFrame`, no CSS
  `animation`/`transition`, no `Math.random`, no `Date.now`. A non-deterministic frame makes the render
  flicker and the scrubber lie.
- One accent per frame. Never two accent hits at once.
- Type roles are fixed. Do not swap Cinzel / Oswald / Courier Prime for variety.
- **No boxes.** Separation comes from a scrim gradient or a vignette, never a filled rectangle or a
  left-border accent bar.
- Grain and vignette belong to `FilmFrame`. Do not add per-template grain.
- Minimum type size is 40px at 1920×1080. Slates and timecode are the only small things, and they are
  apparatus, not content.

And two rules specific to this port:

- Any new prop a component reads **must** be declared as a manifest parameter in
  `electron/services/video-engine/templates/new-templates.ts`, or `resolveTemplateProps` throws
  `Unknown template property` in the UI. The exact-set test will catch an extra one; a missing one
  throws at runtime.
- `dur` comes from `scene.durationFrames` so the choreography is anchored to the authored scene
  length and cannot be shortened by the composition-end clamp Remotion applies to
  `useVideoConfig().durationInFrames` inside a `Sequence` (the old doc said the latter was the
  whole composition length — that is false in Remotion 4.0.502; it is overridden from `SequenceContext`).

## 13. Automation follow-up (2026-08-25) — this branch

The set now also reaches the **Automations screen** (`src/screens/Profiles.tsx`). That commit intentionally
left it out (see §2 row 2 and the `isNew*` filter at `Profiles.tsx:234`). The follow-up:

- The pure builders move from `src/features/video-studio/editor/newTemplates.ts` into
  `shared/video-engine/new-templates-draft.ts` so the Electron main process can build the same
  single-beat plan an unattended batch needs (main cannot import from `src/`).
- `VisualTemplate` gains five optional fields (`hookTemplateId`, `hookProps`, `hookSeconds`,
  `captionTemplateId`, `captionProps`) persisted as JSON in the existing `visual_templates.data`
  column — **no DB migration**, same precedent the `talkingPhoto` slab set. `AutomationStyleConfig`
  mirrors them as **required** fields with `''`/`{}`/`0` sentinels so the `normalizeAutomationStyle`
  whitelist cannot drop them.
- `shared/automationRemotion.ts` gains `automationCaptionChoice` (pure) and a Cinematic branch in
  `automationRemotionHookPlan`; `electron/services/automation-remotion.ts` supplies manifests from
  the registry and calls `setCaptionTemplate` / `importHookPlan`. Headline precedence for a Cinematic
  batch hook: stored headline prop → preset `hookText` → that video's transcript first 8 words → project name.
  An empty headline therefore stays per-video, which is what `hookLine` already promised.
- The preset editor groups captions into **Classic / Cinematic** and shows Cinematic colours + paging
  only when a Cinematic caption is selected, and adds a **Hook template** picker
  (Automatic / Classic / Cinematic) with per-template secondary fields and an honest description card
  in place of the live canvas preview. The old CSS canvas is kept for Automatic/classic hooks.
- `scripts/e2e-automation.mjs` selectors repaired (`Create template`, `Next: Hook`) and the
  "no hook-template picker" assertion inverted. Existing presets render byte-identically (hook defaults
  to Automatic, caption defaults to `captionTemplateId || remotion-caption-<captionStyle>`).
