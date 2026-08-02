# Caption Style Specification

Status: approved implementation contract for Milestone 4  
Research and license check: 2026-08-01

## Scope

Repair caption timing, paging, names, styling, and renderer consistency without changing
Auto B-roll or the older Compose caption system. Keep the current typed video-engine
caption document and use one shared page model for the editor, Remotion, and HyperFrames.
No reference application, font, logo, emoji pack, graphic, or CapCut asset will be copied.

## Current architecture

- `shared/video-engine/captions.ts` owns `CaptionDocument`, frame-timed words, stable
  transcript hashes, important-word weights, and deterministic cue grouping.
- `electron/services/video-engine/captions/import.ts` uses `@remotion/captions` to parse
  SRT and estimates word boundaries inside phrase-timed cues. Groq word timings enter via
  `captionWordsFromTranscript()` in `electron/services/video-engine/studio.ts`.
- `electron/services/video-engine/templates/builtins.ts` advertises caption manifests;
  `service.ts` resolves their properties into one project-wide caption scene.
- `video-engine/remotion/captions.tsx` groups words, derives active state from the current
  frame, and is mounted by `RemotionVideo`. The live Player and exported render both use
  this exact component and project document.
- `video-engine/hyperframes/compiler.ts` groups the same typed words and emits one
  seekable operation at each word boundary. Its generated composition is the source for
  both HyperFrames preview and export.
- `src/features/video-studio/editor/Inspector.tsx` selects a manifest and edits important
  words. `useEditor.ts` loads the cue list used for the editor summary.

## Observed defects

1. All six manifests resolve the same `Hanken Grotesk` font, yellow active color, red
   important color, six-word page size, and other defaults. In Remotion these resolved
   properties override preset fallbacks, so recipes intended to use Anton or different
   palettes render much more alike than their names imply.
2. HyperFrames reads only `maxWordsPerCue`; it ignores the advertised font and three
   color properties and instead uses global hard-coded caption variables. The editor can
   therefore persist a setting that HyperFrames does not render.
3. `Emoji Pop` contains no emoji model or emoji rendering. `Particle Burst` has no burst
   in Remotion and only a box-shadow approximation in HyperFrames. Their labels overclaim
   the implemented result.
4. The editor summary groups with the shared five-word default, while resolved renderer
   props normally group six words. Style changes do not refresh the summary. Paging shown
   in the editor can therefore differ from the rendered page.
5. Grouping has hard word/character/duration/gap limits, but no sentence preference,
   punctuation-orphan rule, explicit line plan, or style-specific defaults. Browser flex
   wrapping can consequently differ between renderers and aspect ratios.
6. Transcript conversion assigns `previousEnd = startFrame`, so overlapping provider
   timestamps are not actually normalized. Non-finite or missing runtime timestamps have
   no defined recovery path.
7. Fixed percentage positioning does not distinguish portrait, square, and landscape;
   long unbroken words have no shared fitting rule. Centered legacy styles can cover the
   subject, and bottom styles can sit inside platform UI.

## Existing style compatibility and repairs

Existing template IDs remain valid so saved projects reload unchanged. Their displayed
names and recipes become truthful:

| Existing ID suffix | Display name | Repair |
| --- | --- | --- |
| `emoji-pop` | Impact Pop | Remove the emoji claim; use Anton, compact uppercase pages, and a deterministic active-word punch. |
| `clip-wipe` | Active Pill Sweep | Sweep the active pill from the word's real start frame; keep the page itself restrained. |
| `highlight` | Focus Highlight | Preserve the readable baseline and make spoken versus AI-important emphasis unambiguous. |
| `neon-accent` | Neon Signal | Keep the neon treatment, reduce glow enough to preserve glyph edges, and use exact active timing. |
| `particle-burst` | Accent Burst | Remove the particle claim; use small deterministic geometric accents only on the active word. |
| `weight-shift` | Quiet Emphasis | Preserve sentence case and communicate activity primarily through weight and a small color shift. |

## Approved new styles

All fonts are already self-hosted by the application.

| ID suffix | Purpose and typography | Active word and motion | Default page |
| --- | --- | --- | --- |
| `motivation-bold` | Motivational claims; Anton uppercase, white with warm gold/coral emphasis. | Short frame-derived scale-and-rise punch; no random rotation. | 2–4 words, at most 2 lines. |
| `mindset-pill` | Psychological and mindset advice; Hanken Grotesk sentence case on a quiet violet scrim. | Violet rounded pill grows from left to right over the true word interval; page enters with a soft rise. | 3–5 words, at most 2 lines. |
| `progress-underline` | Habits and self-improvement; Space Grotesk with calm cyan accents. | Weight increases and an underline sweeps across only the active word. | 3–5 words, at most 2 lines. |
| `coach-clean` | Educational and serious talking-head content; Hanken Grotesk sentence case with a soft shadow. | Color/weight change only; a six-frame-equivalent page fade, expressed in seconds and converted by FPS. | 4–6 words, at most 2 lines. |

## Shared timing and page-generation contract

- Keep `CaptionWord.startFrame` / `endFrame` as the canonical timing model. Do not create
  a second preview-only token clock. `@remotion/captions` remains the SRT parser.
- Add a shared, finite caption-style registry. Each style supplies its real font, palette,
  page limits, placement, active treatment, and entrance preset. Manifest defaults,
  editor cue summaries, Remotion, and HyperFrames resolve from this registry.
- Evolve shared cue grouping into the page generator used everywhere. A page starts at
  its first word and ends at its last word. Active state is the half-open interval
  `startFrame <= frame < endFrame`; an interior silence keeps the page but highlights no
  word. A gap over the configured threshold starts a new page.
- Break first on hard word, line-character, line-count, duration, or silence limits.
  Prefer a sentence-ending break when a page is already readable. Closing punctuation
  stays attached to the preceding word and must never begin a page or line.
- Generate explicit line word-ID groups. Use at most two lines. Greedy wrapping occurs at
  word boundaries; a single overlong token receives its own line and is fitted instead
  of being clipped.
- Preserve source punctuation and Unicode text. Render spacing from token boundaries;
  closing punctuation receives no inserted leading space.
- Spoken-word styling and AI-important styling remain separate. The active treatment wins
  while a word is spoken; its persistent important treatment returns afterward.

## Incomplete and approximate timestamps

- True word timestamps are preferred. Normalize them to integer frames, ordered and
  non-overlapping. A missing start uses the previous valid end; a missing/invalid end uses
  the next valid start when available, otherwise a bounded deterministic reading-time
  fallback. Clamp to the project and drop only entries that still cannot occupy one frame.
- Phrase-timed SRT cues remain deterministic estimates: distribute the cue by Unicode
  token length, preserve the exact cue start/end, and guarantee positive ordered word
  intervals. A malformed cue time range is rejected atomically without changing project
  state.
- Rounding must never create two simultaneously active words, zero-duration words, a word
  beyond the project, or a page whose end precedes its start.

## Wrapping, fitting, safe areas, and aspect ratios

- Resolve layout from canvas width and height, not a 1080x1920 constant. Portrait/4:5
  uses a larger bottom reserve for platform controls; square uses a moderate reserve;
  landscape uses a smaller bottom reserve and narrower text measure.
- Default maximum text width is 84% in portrait/square and 78% in landscape. Side padding
  is at least 7% of the shorter canvas edge. Bottom captions sit approximately 18% above
  portrait/4:5, 12% above square, and 9% above landscape.
- Impact-centered styles remain inside the same horizontal/top/bottom safety envelope.
  Serious talking-head styles stay in the lower safe zone and do not enter the hook's top
  region.
- Font size derives from the shorter canvas dimension, style scale, line length, and the
  longest token, with bounded minimum/maximum values. Renderers use the same calculation.
  CSS also enables `overflow-wrap:anywhere` as the final guard.

## Animation and seek behavior

- Every page and word value is a pure function of the requested frame, FPS, and word/page
  boundaries. Remotion uses `spring()` / `interpolate()` with frame input; HyperFrames
  receives equivalent absolute timeline operations.
- No CSS transitions, keyframe playback state, timers, random values, or effect state may
  determine a caption frame. Forward and backward seeking must produce the same result.
- Active pill/underline progress derives from progress through the active word, not an
  equal subdivision of the containing sentence.

## References, skills, and licensing

No secondary repository was needed; the four primary sources answered timing, paging,
layout, and style questions.

- [Content Machine](https://github.com/45ck/content-machine): configuration/preset/page
  separation, word-boundary pagination, gap and readability limits, punctuation-aware
  breaking, safe zones, and active pill/color concepts. Its relevant
  `skills/short-form-captions/SKILL.md` and root `AGENTS.md` were read. MIT license was
  verified from its current `LICENSE`.
- [Official Remotion TikTok template](https://github.com/remotion-dev/template-tiktok):
  shared caption pages, page-relative token activity, frame-derived spring entrances,
  and text fitting. One targeted instruction search found no repository-local relevant
  skill. The template points to the [Remotion license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md),
  whose free-use conditions are not a blanket MIT grant; therefore only public concepts
  are recreated and no source is copied.
- [Video Wizard](https://github.com/el-frontend/video-wizard): one timing selector with
  visual template dispatch; its Highlight and Minimal treatments informed the serious
  variants. Root `AGENTS.md` was read and one targeted search found no caption skill.
  MIT license was verified from its current `LICENSE`.
- [Claude Shorts](https://github.com/AgriciDaniel/claude-shorts): compact shared-page hook,
  bold versus clean tone separation, and theme organization. Its root `SKILL.md` caption
  guidance was read. MIT license was verified from its current `LICENSE`.
- Local guidance read and applied:
  `.agents/skills/remotion-captions/SKILL.md`,
  `.agents/skills/remotion-captions/display-captions.md`,
  `.agents/skills/remotion-best-practices/SKILL.md`,
  `.agents/skills/remotion-markup/REFERENCE.md`, and
  `.agents/skills/remotion-interactivity/REFERENCE.md`.

Recreated concepts: style registry separation, punctuation-aware pages, explicit lines,
active pills/underlines, bold/clean tone variants, safe-zone scaling, and frame-derived
entrances. No reference implementation code or assets are imported.

## Expected application files

Add:

- `shared/video-engine/caption-style.ts`
- `test/unit/video-engine/caption-styles.test.ts`

Change only as required:

- `shared/video-engine/captions.ts`, `shared/video-engine/index.ts`
- `electron/services/video-engine/captions/import.ts`
- `electron/services/video-engine/studio.ts`
- `electron/services/video-engine/templates/builtins.ts`
- `electron/ipc/video-engine.ts`
- `video-engine/remotion/captions.tsx`, `video-engine/remotion/constants.ts`
- `video-engine/hyperframes/templates.ts`, `video-engine/hyperframes/compiler.ts`
- `video-engine/hyperframes/adapter.ts` (direct caption blocker: copy the approved
  self-hosted Hanken Grotesk and JetBrains Mono files used by shared recipes)
- `src/features/video-studio/editor/useEditor.ts`, `Inspector.tsx`
- `test/unit/video-engine/shared-core.test.ts`, `renderers.test.ts`, `service.test.ts`
- `scripts/e2e-studio.mjs`, `PROGRESS.md`

Do not modify Auto B-roll implementation, legacy Compose captions, preload/IPC contracts,
or database schemas. The HyperFrames adapter font-copy list is the only renderer-adapter
exception because static inspection proved the approved local caption fonts were absent
from exported workspaces.

## Focused verification

1. Pure tests: exact active intervals, deterministic pages at varied FPS, sentence and
   gap breaks, punctuation, explicit lines, long tokens, missing boundaries, overlap
   normalization, SRT estimates, and style-specific layout for 16:9, 9:16, 1:1, 4:5.
2. Manifest/service tests: ten truthful styles per renderer, legacy IDs preserved,
   distinct resolved defaults, property persistence, atomic rejection, and editor cue
   grouping matching the selected style.
3. Renderer tests: every Remotion ID resolves a distinct recipe; every HyperFrames ID
   compiles locally and lint-clean with the same page boundaries, line plan, colors, font,
   and active-word operation times.
4. Real scratch-profile editor E2E: import captions, switch a repaired and a new style,
   set emphasis, save/reload, seek forward/backward over word and page boundaries, compare
   the live preview project with disk, and pass export preflight.
5. Milestone checks: focused Vitest, typecheck, build, Remotion editor E2E, and protected
   Auto B-roll regression. Final goal checks additionally run lint, the broader suite,
   production build, and all applicable smoke fixtures.
