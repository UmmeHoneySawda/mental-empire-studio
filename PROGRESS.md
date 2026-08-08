# Current Objective

Run the full Impeccable UI/UX workflow in the user's specified sequence and turn Mental Empire Studio into one clearly directed, production-ready creator workflow without removing capabilities.

# Verified Completed

- Loaded Impeccable, Karpathy, and codebase-memory instructions; refreshed the knowledge graph as `D-Work-mental-empire-studio` (8,558 nodes / 25,252 edges).
- Ran Impeccable session context once and completed `init` by creating `PRODUCT.md` from repository evidence under the user's explicit no-questions instruction.
- Confirmed a clean starting worktree and identified the incumbent visual authority in `src/theme/tokens.css`, `src/components/Sidebar.tsx`, `src/components/ui/kit.tsx`, and representative screens.
- Completed `critique src` with a persisted 21/40 baseline at `.impeccable/critique/2026-08-08T17-58-33Z__src.md`; the detector's 13 warnings were triaged as progress-indicator, caption-output, or editor-state false positives.
- Applied the critique before advancing: the shell now exposes a five-stage production path, keeps labels at 1280×720, uses native navigation/window controls, and presents an honest state-aware render-queue action.
- Fixed Automations selecting an owned-channel id from the source list, sanitized invalid unpublished-count responses, removed contradictory placeholder-ready jobs, and gated configuration behind one actionable prerequisite.
- Completed `distill src`: Today now centers on blockers and the active pipeline, honors the existing activity-rail preference, consolidates three secondary rail cards into one, hides unnecessary filters for a single channel, and removes duplicate automation blockers while retaining every destination and action.
- Completed `layout src`: all ScreenPad surfaces use the spacing scale and a centered 1600px content frame; Home's supporting rail stacks below the pipeline at ≤1100px; labeled navigation remains through 821px; page-header actions reflow at narrow widths.
- Completed `onboard src`: first run now leads from publishing channel to source channel to a real source video, retains an explicit self-guided exit, focuses the current action, and exposes errors as live alerts.
- Restored the browser QA mock's missing visual-template API so renderer initialization reaches `ready` and the onboarding flow can be exercised without Electron or user data.
- Completed `clarify src`: established a product glossary and aligned navigation, primary screens, actions, empty states, automation templates, B-roll collections, and upload handoff around plain workflow terms; removed user-facing “Compose,” “visual system,” “niche,” “scrape,” “mapped,” and renderer jargon where it did not support a decision.
- Completed `typeset src`: retained the self-hosted Space Grotesk/Hanken Grotesk/JetBrains Mono/Anton roles, formalized a compact desktop type scale and 62ch prose measure, removed redundant page eyebrows, converted editor screen names to semantic headings, and limited mono/poster faces to data or rendered-output roles.
- Completed `adapt src`: treated 1100×720 as the production window and zoom/touch as secondary desktop contexts; fixed source-detail filter clipping, reflowed video grids and sticky actions, made onboarding compact and scroll-safe, stacked B-roll fields, added coarse-pointer targets and reduced-motion behavior, and made compact navigation explicitly named for assistive technology.
- Completed `harden src`: startup now tolerates partial loader failures and offers an in-context retry without hiding healthy data; the initial shell no longer flashes false empty states; source requests ignore stale responses; upload checks, source actions, onboarding, and production-template operations surface recoverable errors; destructive template deletion confirms intent; dialogs trap focus, close on Escape, and restore focus; B-roll/template fields validate and bound input before persistence.
- Completed browser fault injection for startup recovery: a simulated visual-template failure kept Today usable, displayed the warning and Retry action, then cleared after a successful retry. Added the missing B-roll progress subscription seam to the browser mock so browser QA initializes without an unhandled listener error.
- Completed `extract src`: enriched the existing 14-use `Banner` primitive with error/status semantics and extracted one pure `errorMessage` boundary for user-facing async failures across onboarding, channels, sources, publishing, automations, and the data store. Two dialog focus traps remain local because they have only two proven uses; no speculative component abstraction was added.
- Completed `audit src` with a persisted 14/20 report at `.impeccable/audit/2026-08-09T01-23-20+06-00__src.md`: no P0 defects, two P1 accessibility defects (low-contrast secondary text and pointer-only cards), five P2 system defects (landmarks/headings, native dialogs, global reduced-motion override, raw theme colors, and incomplete progress semantics), and one P3 image-loading opportunity. Browser inspection covered all 11 destinations at the production viewport with no overflow, unlabeled visible inputs, missing image alternatives, or runtime errors.
- Completed `polish src`: all audited P1/P2 findings are resolved with AA secondary text, keyboard-operable production choices, application landmarks/headings, one focus-safe confirmation dialog, semantic progress/status feedback, selective reduced-motion behavior, broader semantic token use, and lazy decoding for repeated template/render thumbnails. The post-polish score is 18/20.
- Completed `document`: added the portable root `DESIGN.md`, schema-v2 `.impeccable/design.json` with 21 color ramps and nine rendered components, and refreshed the repository-specific design-system implementation guide. The durable north star is “The Creator Control Room.”

# Current Problem

No remaining failure or blocker. All 13 Impeccable stages and the final verification are complete.

# Relevant Files

- `PRODUCT.md`
- `src/app.tsx`
- `src/components/Sidebar.tsx`
- `src/components/primitives.tsx`
- `src/components/ui/kit.tsx`
- `src/theme/tokens.css`
- `src/theme/global.css`
- `src/screens/`

# Do Not Modify

- Video render/filter performance settings covered by `docs/RENDER-PERFORMANCE.md`.
- Pipeline services, database schema, settings persistence, and IPC contracts unless a verified UI defect requires a minimal aligned change.
- Existing working video-editor stacking and external B-roll preview behavior documented below.

# Next Action

None. Do not commit or push unless the user authorizes it.

# Verification

- `PRODUCT.md` exists and follows `impeccable:product-schema 1`.
- First UI milestone: `npm run typecheck -- --pretty false` and `git diff --check` passed; browser verification measured a labeled 196px sidebar at 1280×720 and confirmed actionable Automations blockers.
- Distill milestone: typecheck and diff check passed; browser DOM confirms one automation blocker/action and a single consolidated Home activity rail.
- Layout milestone: clean pre/post layout detector scans, typecheck, and diff check; browser measurements showed no horizontal overflow at 800, 900, 1024, 1600, or 2200px and a centered 1600px wide-content cap.
- Onboarding milestone: browser mock renders “Start your first video,” autofocuses “Browse source videos,” closes on Escape, and persists the mock completion marker; typecheck and diff check passed.
- Clarify milestone: renderer typecheck and diff check passed; browser DOM verifies the Publishing Channels, Sources, B-roll Library, Ready to Upload, and Automations paths use the new vocabulary, including correct singular “1 channel” and an untruncated publishing-channel navigation label.
- Typeset milestone: renderer typecheck and diff check passed; computed styles verify loaded Space Grotesk 26/600 page titles, Hanken Grotesk 13/400 body copy at 19.5px leading, and JetBrains Mono metadata; a 640×360 stress viewport (equivalent to 200% layout pressure) remained free of horizontal overflow. The only detector warnings are two Montserrat `@font-face` assets used by rendered caption presets, not application chrome.
- Adapt milestone: renderer typecheck and diff check passed; all 11 destinations have no document/screen overflow at 1100×720, 900×720, or 640×720; active Video Studio and thumbnail workspaces fit at the production minimum; source filters and two-column cards no longer clip at 640px; onboarding fits 550×360 with its focused action visible; a 2200px viewport retains the centered 1600px content cap; emulated coarse pointers produce 44px controls and reduced motion collapses animations to one 0.01ms iteration.
- Harden milestone: renderer typecheck passed; browser validation confirmed production-template name validation, focus entry, Escape dismissal, partial-startup warning/retry/recovery, and continued screen availability during a simulated loader failure.
- Extract milestone: renderer typecheck passed after migrating the repeated unknown-error conversion pattern and centralizing live-region semantics in the shared Banner primitive.
- Audit milestone: the bundled detector reported only the 13 previously triaged progress/caption/editor-state matches; an independent DOM audit covered every destination, found no horizontal overflow or runtime errors, and persisted the scored report. The detector's URL mode could not run because Puppeteer is not installed, so the existing in-app browser harness supplied rendered evidence without launching Electron or touching user data.
- Polish milestone: typecheck and diff check passed; computed contrast on elevated surfaces is 4.71:1 or better for every secondary-text role; native dialogs and pointer-only template/source choices are gone; all 11 destinations retain one `main`, one `h1`, and zero horizontal overflow at both 640×720 and 1100×720; the runtime event buffer is empty. The single final detector pass reports only the 13 intentional progress-fill, editor-diagnostic, and rendered-caption-font matches already triaged above.
- Document milestone: `DESIGN.md` frontmatter parses with only the official token groups and all eight canonical sections in order; `.impeccable/design.json` parses as schema v2 with matching metadata for all 21 frontmatter colors and nine self-contained component examples.
- Final milestone: the final detector pass retained only 13 intentional warnings; `npm run typecheck -- --pretty false` passed; `npm run build` passed with the existing mixed-import chunk warnings; `npm test -- --reporter=dot` passed 84 files / 949 tests with 36 intentional skips; `git diff --check` passed with line-ending notices only. Browser QA covered all 11 destinations at 640×720, 1100×720, and the standard desktop viewport without overflow or runtime errors. The temporary browser tabs and Vite QA server were closed, and Electron/user data were never launched or modified.

# Protected Prior Work — Timeline Stacking

Make Remotion timeline tracks draggable in compositor order and make the caption layer honor
its track order, so opaque Auto B-roll cannot cover captions and the user can move captions
to the foreground.

# Verified Completed

- Loaded the requested feature-dev, Karpathy, and codebase-memory instructions; the graph is
  already indexed and responsive as `D-Work-mental-empire-studio`.
- Inspected both supplied screenshots. Captions appear only during a transparent fade while
  the caption lane sits below Auto B-roll, establishing a stacking-order failure.
- Traced the exact cause: ordinary Remotion scenes use `track.order * 100_000 + scene.zIndex`,
  but `CaptionLayer` hard-codes `1_000_000`. Auto B-roll order 10 therefore ties or exceeds
  the caption layer and opaque clips cover it.
- Confirmed the B-roll answer independently: Auto B-roll requests `localFirst`; local search
  matches relative path plus metadata title, description, and tags; remote providers are
  called only when local search returns no candidate.
- Sentry preflight is blocked because neither a Sentry connector nor `sentry-cli` is
  available in this task. No retries were made; direct renderer evidence is conclusive.
- Implemented foreground-first timeline ordering, a dedicated track drag grip, and one
  atomic `reorderTrack` transform through the existing undo/save funnel. Audio remains last
  in the timeline and is excluded from visual stacking edits.
- Replaced the caption layer's fixed z-index with the active caption scene's persisted
  track-derived z-index; caption-only legacy projects use a safe foreground fallback.
- Added focused regressions for the exact Auto B-roll/caption collision and for dragging a
  caption lane above Auto B-roll while preserving audio order.

# Current Problem

No remaining failure in scope. The implementation and verification are complete.

# Relevant Files

- `video-engine/remotion/captions.tsx`
- `src/features/video-studio/editor/operations.ts`
- `src/features/video-studio/editor/useEditor.ts`
- `src/features/video-studio/editor/Timeline.tsx`
- `src/features/video-studio/editor/editor.css`
- `test/unit/video-engine/editor-operations.test.ts`

# Do Not Modify

- Existing external B-roll preview-path repair in `electron/main.ts`,
  `electron/services/video-engine/studio.ts`, `src/features/video-studio/editor/assetUrl.ts`,
  `scripts/e2e-studio.mjs`, and `test/unit/video-engine/preview-path.test.ts`.
- B-roll search/download behavior, caption styling/timing, and generated output.

# Next Action

None. Do not commit or push unless the user authorizes it.

# Verification

- `npx vitest run test/unit/video-engine/editor-operations.test.ts --reporter=dot`: **53/53 passed**.
- Caption styles, renderers, and transition chains: **44/44 passed**.
- `npm run typecheck -- --pretty false`: passed.
- `npm run build`: passed (only existing Vite mixed static/dynamic import warnings).
- `git diff --check` on the six implementation/test files: passed (only expected
  LF-to-CRLF notices).

# Protected Prior Work — External B-roll Preview

# Prior Objective

Fix the Remotion Video Studio preview so persisted Auto B-roll clips visibly render at their
timeline positions instead of leaving the canvas black behind otherwise-correct captions.

# Verified Completed

- Read the requested `feature-dev`, `karpathy-guidelines`, `codebase-memory`, and
  `remotion-best-practices` skills in full, including the relevant feature patterns and
  Remotion Player/video-markup references.
- Inspected `Screenshot_20260802143456.png`: at frame 997, captions render and the Auto
  B-roll lane has clips across the timeline, but the visual canvas is black. This proves
  the Player/composition/caption path is alive and narrows the fault to visual-scene
  selection, asset resolution, or video decoding.
- Confirmed branch `build/mental-empire-studio` starts clean and codebase-memory is already
  indexed and responsive as `D-Work-mental-empire-studio`.
- Traced the preview path through `EditorPlayer` -> `projectForPlayer` -> `RemotionVideo` ->
  `SceneContent` -> `VisualAsset`; local `file:` assets are rewritten to the ranged
  `mestudio://asset/...` preview protocol before Remotion receives them.
- Read the exact persisted project from the screenshot without mutating it. At frame 997,
  the unmuted Auto B-roll scene starts at frame 900, lasts 240 frames, references an
  existing video, and should be visible. All 127 Auto B-roll assets exist, but all 127 live
  outside the video-engine data root in the durable B-roll library.
- Root cause reproduced: `projectForPlayer` rewrote those external `file:` URIs to
  `mestudio://asset/...`, while `resolvePreviewRequest` confined every asset request to
  `<userData>/video-engine`. The protocol returned 403 for the entire D-drive library;
  captions were unaffected because they do not load through that asset route.
- Fixed the resolver to admit only two approved local roots: the existing video-engine
  data root and the configured persistent B-roll library. Arbitrary local paths remain
  rejected with `PATH_OUTSIDE_WORKSPACE`; HyperFrames resolution is unchanged.
- Added a focused regression that failed against the old one-root resolver and now proves
  an external approved B-roll path resolves while a path outside both roots is rejected.
- Hardened the real Electron E2E so its disposable B-roll library is outside disposable
  userData, matching production, and so a generated clip must return ranged HTTP 206 from
  the custom protocol. The guarded Remotion run passed that assertion and every existing
  editor/caption/Auto B-roll check with no renderer console errors.
- Before launching Electron, the required backup copied the live database/settings to
  `Mental Empire Studio - CLAUDE-BACKUP-20260802-145625`. PowerShell again lacked
  `Get-FileHash`, so both source/copy pairs were independently SHA-256 verified with .NET;
  both match.
- Sentry preflight could not run because this task has no Sentry connector or CLI. Direct
  persisted-project and protocol evidence established the failure without relying on logs.

# Current Problem

No remaining failure in scope. The fix is implemented and executable verification passes.

# Relevant Files

- `src/features/video-studio/editor/assetUrl.ts`
- `electron/main.ts`
- `electron/services/video-engine/studio.ts`
- `scripts/e2e-studio.mjs`
- `test/unit/video-engine/preview-path.test.ts`

# Do Not Modify

- HyperFrames or Classic Video Studio behavior.
- Auto B-roll planning, provider, cache, job-resume, or placement semantics unless concrete
  evidence shows one of them creates the bad preview state.
- Caption styles, hooks, image cycling, unrelated timeline geometry, or generated output.

# Next Action

None. Do not commit or push unless the user authorizes it.

# Verification

- `npx vitest run test/unit/video-engine/preview-path.test.ts`: **2/2 passed** after failing
  **2/2** before the resolver patch.
- Preview-path, B-roll-library-path, and caption-style focused suites: **26/26 passed**.
- `npm run typecheck -- --pretty false`: passed.
- `npm run build`: passed.
- `node --check scripts/e2e-studio.mjs`: passed.
- `node scripts/e2e-studio.mjs --engine remotion`: **E2E OK**, including external-root
  ranged preview 206, four persisted muted B-roll clips, captions, preflight, and zero
  renderer console errors.
- `git diff --check`: passed (only expected LF-to-CRLF notices).

# Protected Prior Work — Auto B-roll Persistence and Library

# Prior Objective

Fix the 2026-08-02 Remotion Video Studio Auto B-roll regressions: bounded asset fields,
caption-template changes that preserve generated B-roll and caption visibility, a searchable
D-drive media library with useful metadata, and crash-safe persisted progress with automatic
resume after application restart.

# Prior Verified Completed

- Read the requested `feature-dev`, `karpathy-guidelines`, and `codebase-memory` skills,
  including the feature workflow's referenced `PATTERNS.md`.
- Read both supplied screenshots and the complete
  `REMOTION_EDITOR_TIMELINE_MAINTENANCE_GUIDE.md`; no external repository was cloned or
  reread.
- Confirmed the repository at `D:\Work\mental-empire-studio`, branch
  `build/mental-empire-studio`; codebase-memory is already indexed and responsive as
  `D-Work-mental-empire-studio`.
- Pre-change worktree is clean except for the user-owned, untracked
  `REMOTION_EDITOR_TIMELINE_MAINTENANCE_GUIDE.md`; preserve it.
- Screenshot 1 establishes the concrete completion failure: generated asset index 98 has a
  `name` longer than the schema's inclusive 512-character maximum.
- Screenshot 2 establishes a separate destructive state transition: applying a caption
  template leaves only the caption and voice-over tracks, removing the Auto B-roll lane.
- Sentry issue `ELECTRON-W` confirms the same production failure at `assets[98].name` in
  `saveProject`; B-roll cache logs show the downloads themselves completed successfully.
- **Milestone 1 verified:** provider titles are bounded before entering `VideoProject`,
  recovered placements are idempotent, caption documents/lanes/scenes survive Auto B-roll,
  and every engine-authoritative editor mutation now stops when the pending local save
  fails instead of adopting stale disk state. Regression result: 70/70 focused tests pass;
  `npm run typecheck` passes.
- **Milestone 2 verified:** Windows now prefers
  `D:\Mental Empire Studio\broll-library` (with `ME_BROLL_LIBRARY_DIR` override and a
  user-data fallback only when the drive is unavailable). Studio and classic downloads
  share that durable root; sidecars retain bounded title, description, tags, dimensions,
  duration, author, original source, and licence metadata. The local provider searches the
  metadata behind hash filenames, and Auto B-roll uses local-first/remote-fallback search.
  Regression result: 28/28 focused cache/path/service tests pass; `npm run typecheck` passes.
- **Milestone 3 verified:** Auto B-roll jobs are written atomically through
  queued/reading/searching/downloading/ready/applied stages; every completed placement is
  checkpointed before planning continues. Project open resumes the latest recoverable job,
  recovered placements apply idempotently, and the renderer acknowledges a ready job only
  after an immediate project save succeeds. Regression result: 149/149 combined focused
  tests pass; `npm run typecheck` and `npm run build` pass.
- Updated `AUTO_BROLL_MAINTENANCE_GUIDE.md` with the D-drive library, local-first search,
  durable job/resume/ack data flow, and a concise architecture change-log entry.
- Before launching Electron, `npm run userdata:backup` copied the live database/settings to
  `Mental Empire Studio - CLAUDE-BACKUP-20260802-140515`. Its final checksum command is not
  available in this PowerShell, so the copied database and settings were independently
  SHA-256 verified against their sources with .NET; both match.
- Guarded Remotion E2E passed in a scratch `ME_SMOKE_USERDATA_DIR`: resume/ack IPC wiring,
  caption style and seeking, one Auto B-roll run with four persisted muted clips, captions,
  live preview, and preflight all passed with no renderer console errors. The D-drive helper
  deliberately keeps smoke/E2E media inside the throwaway profile.

# Prior Outcome

- No remaining failure in this objective. The repository-wide suite retains one known,
  unrelated baseline failure in `test/unit/settings-secrets.test.ts` (clearing a readable
  transcription key); this repair does not modify the settings/secrets subsystem.

# Prior Relevant Files

- `shared/video-engine/auto-broll.ts`
- `electron/services/video-engine/broll/auto-plan.ts`
- `electron/services/video-engine/broll/service.ts`
- `electron/services/video-engine/broll/cache.ts`
- `electron/services/video-engine/broll/providers/local.ts`
- `electron/services/video-engine/broll/library-root.ts`
- `electron/services/video-engine/broll/job-store.ts`
- `electron/services/video-engine/service.ts`
- `src/features/video-studio/editor/operations.ts`
- `src/features/video-studio/editor/useEditor.ts`
- `src/features/video-studio/editor/Inspector.tsx`
- `electron/db/index.ts`
- `electron/ipc/video-engine.ts`
- `electron/services/broll.ts`
- `electron/services/video-engine/factory.ts`
- `electron/services/video-engine/studio.ts`
- `test/unit/video-engine/auto-broll.test.ts`
- `test/unit/video-engine/auto-broll-job-store.test.ts`
- `test/unit/video-engine/broll-library-path.test.ts`
- `test/unit/video-engine/editor-operations.test.ts`
- `AUTO_BROLL_MAINTENANCE_GUIDE.md`

# Prior Do Not Modify

- HyperFrames or Classic Video Studio behavior.
- Manual `placeBroll` / `fetchBrollBatch` semantics unless shared cache reuse requires a
  strictly compatible internal change.
- Unrelated caption styles, hooks, image cycling, rendering policy, timeline geometry, or
  generated output (`out/`, `dist/`).
- The user's untracked maintenance guide except for a verified Local Application Map or
  Change Log update required by this repair.

# Prior Next Action

None for this objective. Do not commit or push unless the user authorizes it.

# Prior Verification

- `npx vitest run` over the five changed Video Studio suites: **149/149 passed**.
- `npm run typecheck -- --pretty false`: passed.
- `npm run build`: passed after the final code changes.
- `node scripts/e2e-studio.mjs --engine remotion`: passed in a scratch profile, including
  Auto B-roll, captions, live preview, persistence, preflight, and resume/ack IPC wiring.
- `npm test`: **845 passed, 28 skipped, 1 unrelated known failure** in
  `test/unit/settings-secrets.test.ts`.
- `git diff --check`: passed (Git reported only expected LF-to-CRLF notices).

# Protected Prior Work — Caption, Hook, and Image-Cycle Repairs

# Prior Objective

Fix the ten verified post-milestone regressions in image-cycle layering, hook validation
and rendering, caption timing/grouping, and Remotion/HyperFrames caption presentation
without disturbing Auto B-roll or unrelated user work.

# Verified Completed

- **Post-review defect repair is implemented and focused verification passes.** Image-cycle
  tracks now stay on order 0 and repair stale order-5 lanes; custom-hook text/font-weight
  contracts align with manifests; hook beat variants are rendered again; overlapping cue
  lookup remains indexed and correct; distant punctuation cannot extend hard timing; and
  one-frame words reach their complete visible treatment.
- Remotion now derives readable pill foregrounds and replaces alpha on both 6/8-digit hex
  colors. HyperFrames no longer clips every Active Pill Sweep word, uses the same pill
  contrast decision, and sets one-frame caption state immediately. Focused result: 77/77
  editor/hook/caption tests pass and `npm run typecheck --silent` passes.
- The goal attachment and required `karpathy-guidelines` skill were read in full.
- Repository preflight is complete: branch `build/mental-empire-studio`; the codebase-memory
  graph is indexed and queryable as project `mental-empire-studio`.
- Existing user-owned work is identified: modified `PROGRESS.md` and untracked
  `CAPTION_REFERENCES.md`. Both must be preserved.
- Pre-change baseline: typecheck and production build pass; all 35 existing Text Motion
  tests pass. The full suite has one unrelated failure in
  `test/unit/settings-secrets.test.ts` (`lets the user genuinely clear a readable key`):
  the file is cleared but `getSettings().transcription.apiKey` retains the old key. This
  predates editor work and must not be fixed under this goal.
- **Milestone 1 — Text Motion: complete and verified.** The failure is reproducible from
  parent revision `232c7a3^`: the panel offered `typewriter`, `word-by-word`, and `stagger`,
  but `TextScene` implemented no case for them, so the `default` branch rendered the whole
  string with the `rise` curve. Current `HEAD` already contains the surgical repair from
  `232c7a3`: `TEXT_MOTION_IDS` is the shared typed list, split motions render per character
  or word, unknown ids become static, and every curve is a pure function of clip-local
  frame. No redundant renderer rewrite was made.
- The remaining integration gap is now covered in `scripts/e2e-studio.mjs`: on a real
  scratch Remotion project it adds `typewriter`, reconfigures to `stagger`, reloads the
  project from disk, checks the exact project handed to the live preview, preserves other
  typography, advances revisions, and passes export preflight. The same run verifies
  captions, media, transitions, and Auto B-roll remain functional.
- **Milestone 2 — full-timeline image cycling: complete and verified.** The planner now
  emits exact 3s/4s slots and one positive final remainder instead of redistributing the
  span approximately. Asset ids are deduplicated; the shuffle seed derives from stable
  project/selection/interval input rather than revision, so unrelated edits do not change
  the deck.
- The live Remotion media rail now selects two or more stills and creates the sequence on
  dedicated `image-cycle` order-5 lane (below protected order-10 Auto B-roll). One pure
  `applyImageCycle` transform replaces only its own prefixed scenes, preserves all other
  tracks/scenes/assets, uses deterministic scene ids, treats an identical request as a
  no-op, and enters the editor through one `edit()` call for one save and one undo entry.
- Milestone 3 discovery is complete. The hook registry exposes only two misleadingly named
  30-second templates even though the editor supports 1–30 seconds; every Remotion hook
  currently renders through the same layout and ignores the manifest's accent, background,
  and energy properties. The existing strict hook-plan importer safely validates beat data,
  but it has no bounded schema for user-selectable typography, alignment, position,
  background, or animation presets.
- **Milestone 3 — video-hook templates and safe custom hooks: complete and verified.**
  Remotion now registers seven truthful hooks: the two existing IDs plus Motivational
  Punch, Mind Shift, Progress Path, Lesson Board, and one declarative custom template.
  HyperFrames remains on its two implemented hooks. Each Remotion preset resolves a
  distinct combination of self-hosted typography, alignment/position, palette,
  background, and frame-derived animation.
- The new strict `CustomHookConfigSchema` accepts only bounded text, 1–30 second duration,
  named motion/background presets, approved local fonts and weights, hex colors,
  alignment, position, and energy. It rejects unknown or executable-shaped fields before
  opening/writing the project, then converts accepted data to an ordinary `HookPlan` and
  uses the existing compiler. No dynamic code, markup, CSS, package, or module is loaded.
- The live Hook panel exposes the four category presets and a documented JSON example.
  Its IPC/preload/`NativeApi` method is aligned, invalid input uses the existing error
  banner, and valid input persists through the same hook scene used by preview/export.
- Milestone 4 research and architecture tracing are complete, and the required contract is
  frozen in `CAPTION_STYLE_SPEC.md` before implementation. All four primary repositories
  were inspected; no secondary source was needed. Content Machine, Video Wizard, and
  Claude Shorts are MIT. The official TikTok template points to Remotion's conditional
  custom license, so its public timing concepts will be recreated without copying source.
- Caption root causes are concrete: common manifest defaults flatten Remotion recipes;
  HyperFrames ignores four advertised style properties; `Emoji Pop` and `Particle Burst`
  promise visuals they do not render; the editor and renderers use different page defaults;
  wrapping/safe areas are browser-dependent; and transcript overlap normalization assigns
  `previousEnd` from the word start instead of its end.
- **Milestone 4 — caption repair and expansion: complete and verified.** Six legacy IDs
  remain loadable with truthful names/recipes (Impact Pop, Active Pill Sweep, Focus
  Highlight, Neon Signal, Accent Burst, Quiet Emphasis), and both renderers add Motivation
  Bold, Mindset Pill, Progress Underline, and Coach Clean. One shared typed registry now
  drives manifest defaults, editor cue counts, explicit page/line generation, fonts,
  colors, timing limits, active treatment, and aspect-aware layout.
- Shared pages prefer sentence boundaries, keep closing punctuation attached, cap at two
  explicit lines, fit long tokens, and use half-open word intervals plus binary page lookup.
  Transcript imports deterministically repair missing/overlapping boundaries; SRT phrase
  estimates allocate non-overlapping positive frame ranges and reject impossible cues
  without saving. Remotion animation is frame-derived; HyperFrames emits equivalent
  absolute word operations and now copies every approved self-hosted caption font.
- The real Remotion caption panel imported a 90-word SRT, exposed repaired/new styles,
  applied both Impact Pop and Mindset Pill, persisted manual emphasis and style properties,
  reloaded the same document into live preview, sought forward/backward without renderer
  errors, passed export preflight, and then completed the protected Auto B-roll run.

# Current Problem

None in scope. The ten reviewed defects are repaired and final verification is complete.
The unrelated settings-secret test retains its recorded baseline failure and no settings
file was changed.

# Relevant Files

- `PROGRESS.md`
- `video-engine/remotion/textMotion.ts`, `video-engine/remotion/scene.tsx`
- `src/features/video-studio/editor/Inspector.tsx`, `presets.ts`, `EditorPlayer.tsx`
- `test/unit/video-engine/text-motion.test.ts`
- `scripts/e2e-studio.mjs`
- `shared/video-engine/fill.ts`, `electron/ipc/video-engine.ts`
- `src/features/video-studio/editor/operations.ts`, `useEditor.ts`, `MediaBin.tsx`,
  `editor.css`
- `test/unit/video-engine/media-fill.test.ts`, `editor-operations.test.ts`
- `electron/services/video-engine/templates/builtins.ts`, `hook-compiler.ts`
- `shared/video-engine/hook-plan.ts`, `templates.ts`, `custom-hook.ts`
- `src/features/video-studio/editor/hookPlan.ts`, `Inspector.tsx`, `useEditor.ts`
- `video-engine/remotion/hook.tsx`, `constants.ts`
- `shared/types.ts`, `electron/preload.ts`, `electron/ipc/video-engine.ts`
- `test/unit/video-engine/shared-core.test.ts`, `service.test.ts`, `renderers.test.ts`
- `shared/video-engine/custom-hook.ts`, `hook-style.ts`
- `shared/video-engine/common.ts`
- `video-engine/remotion/hook-motion.ts`
- `test/unit/video-engine/hook-templates.test.ts`
- `CAPTION_REFERENCES.md`, `CAPTION_STYLE_SPEC.md`
- `shared/video-engine/captions.ts`, `caption-style.ts`
- `electron/services/video-engine/captions/import.ts`, `studio.ts`
- `video-engine/remotion/captions.tsx`
- `video-engine/hyperframes/templates.ts`, `compiler.ts`

# Do Not Modify

- Auto B-roll implementation, architecture, provider ranking, model ladder, or manual
  B-roll paths except for narrowly scoped regression verification.
- User-owned `CAPTION_REFERENCES.md`; read it for Milestone 4 but do not rewrite it.
- Verified Text Motion renderer/control behavior except for regression-only changes.
- Verified image-cycle planner, dedicated lane, and editor action except for regression-only
  changes.
- Verified hook schemas, preset library, renderer, compiler, and editor flow except for
  regression-only changes.
- Existing user changes unrelated to the active milestone.

# Next Action

Nothing required. The work remains intentionally uncommitted because commit/push authority
was not granted.

# Verification

- `npm run typecheck --silent` → pass.
- Focused editor/hook/caption regression suite → 77/77 pass.
- `npx vitest run test/unit/video-engine --reporter=dot` → 327 pass, 4 live tests skipped.
- `npm test -- --reporter=dot` → 821 pass, 28 skip, and only the unchanged pre-existing
  `settings-secrets` failure.
- `npm run build` → pass for main, preload, and renderer bundles.
- HyperFrames renderer lint/parity tests pass for all caption templates; appended-alpha
  source audit found no remaining expressions; `git diff --check` found no errors.
- `git status --short` → `M PROGRESS.md`, `?? CAPTION_REFERENCES.md` before this checkpoint.
- Codebase-memory `search_graph(project="mental-empire-studio")` returned indexed results.
- `npm run typecheck --silent` → pass.
- `npx vitest run --reporter=dot` → 768 passed, 28 skipped, 1 unrelated pre-existing
  failure in `settings-secrets.test.ts`; `text-motion.test.ts` → 35 passed.
- `npm run build --silent` → pass with existing Vite dynamic/static import warnings.
- `npm run userdata:backup --silent` copied the live database/settings, then exited 1 only
  because this PowerShell lacks `Get-FileHash`; independent SHA-256 validation confirmed
  both files exactly match backup `CLAUDE-BACKUP-20260801-235301`.
- `npx vitest run test/unit/video-engine/text-motion.test.ts --reporter=dot` → 35 passed.
- `node scripts/e2e-studio.mjs --engine remotion` → E2E OK, including Text Motion add,
  reconfigure, reload, live-preview revision, preflight, captions/media/transitions, and
  Auto B-roll. The harness used and removed a throwaway user-data directory.
- Post-milestone `npm run typecheck --silent` and `npm run build --silent` → pass.
- `npx vitest run test/unit/video-engine/media-fill.test.ts
  test/unit/video-engine/editor-operations.test.ts --reporter=dot` → 61 passed.
- Milestone 2 `npm run typecheck --silent` and `npm run build --silent` → pass.
- `node scripts/e2e-studio.mjs --engine remotion` → E2E OK. The real media-rail controls
  verified 3s sequential and 4s deterministic shuffle, exact partial ending, no gaps or
  overlaps, dedicated lane, unrelated-scene preservation, one-step undo/redo, no-op repeat,
  disk reload, identical preview order/timing, export preflight, and Auto B-roll.
- `git diff --check` on Milestone 1/2 files → clean (line-ending warnings only).
- `npx vitest run test/unit/video-engine/hook-templates.test.ts
  test/unit/video-engine/renderers.test.ts test/unit/video-engine/service.test.ts
  test/unit/video-engine/editor-operations.test.ts --reporter=dot` → 85 passed.
- Milestone 3 `npm run typecheck --silent` and `npm run build --silent` → pass; build has
  only the existing Vite dynamic/static import warnings.
- `node scripts/e2e-studio.mjs --engine remotion` → E2E OK. It drove all four new cards,
  persisted the motivational preset's distinct style, proved malicious custom JSON caused
  no revision or document change, persisted a valid custom config, sought frames
  0/47/121/179 without a renderer error, matched disk and live preview, passed export
  preflight, preserved image cycling, and completed the protected Auto B-roll regression.
- `git diff --check` through Milestone 3 → clean (line-ending warnings only).
- `npx vitest run test/unit/video-engine/caption-styles.test.ts
  test/unit/video-engine/shared-core.test.ts test/unit/video-engine/renderers.test.ts
  test/unit/video-engine/service.test.ts --reporter=dot` → 82 passed. This includes all
  ten lint-clean HyperFrames caption styles, exact active intervals, varied FPS, explicit
  lines, punctuation, long words, missing/overlapping timestamps, SRT estimates, and
  16:9/9:16/1:1/4:5 layout metrics.
- Milestone 4 `npm run typecheck --silent` and `npm run build --silent` → pass; build has
  only the existing Vite dynamic/static import warnings.
- `node scripts/e2e-studio.mjs --engine remotion` → E2E OK after rebuilding the current
  renderer bundle. Caption selection, persistence, manual emphasis, explicit page lines,
  punctuation, forward/backward seeks, live preview identity, export preflight, all prior
  milestones, and protected Auto B-roll passed in an isolated scratch profile.
- Final `npx vitest run --reporter=dot` → 814 passed, 28 skipped, with only the exact
  pre-existing `settings-secrets.test.ts` failure from baseline. All 64 Auto B-roll tests
  and all Milestone 1–4 regression tests passed.
- `npm run video-engine:templates:check --silent` → 0 errors; all templates and runtime
  checks passed. The 10 transition-overlap warnings and 2 informational notices predate
  this goal.
- Final `npm run typecheck --silent` and `npm run build --silent` → pass. The build emits
  only the baseline Vite dynamic/static import warnings.
- `npm run video-engine:smoke --silent` with an explicit workspace temp directory → both
  engines rendered valid 480×270 H.264 MP4s; the Remotion artifact also produced a valid
  cinematic-graded MP4. The generated smoke directory was moved to the Recycle Bin after
  validation.
- Final `node scripts/e2e-studio.mjs --engine remotion` → E2E OK, including live caption
  DOM rendering at an active frame, all four milestones, export preflight, and Auto B-roll.
- Final `node scripts/e2e-studio.mjs --engine hyperframes` → E2E OK, including image
  cycling, transition/preflight behavior, preview reloads, and Auto B-roll.
- Final `git diff --check` → clean. Changed-source audit found no added debug statements,
  wall-clock reads, timers, or random state in the render paths; no generated output is
  present in the Git worktree.

---

# Protected Prior Work — Auto B-roll

Ship **Auto B-roll** in the Compose → Remotion editor: one button reads the _whole_
timestamped transcript (22-minute videos included), asks Groq for timestamped visual
queries in bounded chunks, searches every enabled provider through the existing
`BrollService`, ranks and de-duplicates the results, and inserts the picks across the
entire timeline as one undoable local edit.

Status: **complete and verified — M1 through M5.** Verified live against a real 22-minute
clip and a real model, not only against fixtures; against the user's real
Pexels/Pixabay/Coverr keys, which closed the last gap and turned up three defects; and, as
of M5, with those defects fixed and the fix measured on the same live workload.

---

## Verified Completed

### M1 — pure analyzer core (no network, no UI)

- `shared/video-engine/auto-broll.ts` — zod schema for the model's answer
  (`AutoBrollMomentSchema`, `AutoBrollAnswerSchema`, `safeParseAutoBrollAnswer`) plus the
  `AutoBrollOptions` / `AutoBrollPlacement` / `AutoBrollSkip` / `AutoBrollResult` types and
  the `AUTO_BROLL_TRACK_*` constants. Re-exported from `shared/video-engine/index.ts`.
- `electron/services/video-engine/broll/auto.ts` — `transcriptLinesFromWords`,
  `chunkTranscript`, `buildAutoBrollPrompt`, `normalizeMoments`, `mergeMoments`,
  `targetMomentCount`, `scoreCandidate`, `candidateFitsSlot`, `selectPick`,
  `placementTiming`, and the query hygiene helpers (`normalizeQuery`, `isGenericQuery`,
  `queryFromText`). All pure; no Electron, no fetch.
- `test/unit/video-engine/auto-broll.test.ts` + `test/fixtures/broll/auto-transcript.json`
  (sentence bank the test expands into a 1319-second word list).

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **37 passed**;
`npx vitest run` → **709 passed / 24 skipped, no regressions**; `npm run typecheck` clean.

Decisions that must persist:

- **The model is never trusted with arithmetic.** It is asked for in-window timestamps and
  then clamped to the window regardless.
- **The last window always ends where the transcript does**, and every window's target is
  `max(1, …)`. That pair — not a prompt instruction — is what makes the final section get
  B-roll. Capping the run thins from the crowded middle (`thinToCap`), never off the ends.
- A window that is capped or widened never _drops_ a window: `maxChunks` grows
  `windowSeconds` instead.
- The answer schema is intentionally lenient (non-strict object, clock notation accepted,
  soft fields defaulted). A rejected answer is a hole in the coverage, unlike the hook plan
  where it is one retry.

### M2 — main-process orchestration behind IPC

- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll(input, deps)`.
  Chunks → model per window (2 in flight, one repair round) → merge/space → search per
  moment (3 in flight, one search per distinct query per run) → serial rank + global
  de-duplicate + download. Every outside effect arrives through `AutoBrollDeps`
  (`askModel` / `searchBroll` / `materialize` / `onProgress` / `signal`), which is what
  lets the whole thing be tested against fixtures instead of API quota.
- `electron/services/video-engine/broll/auto-groq.ts` (**renamed `auto-model.ts` in M5**, and
  `createAutoBrollModel` now takes a key object rather than one string) —
  `createAutoBrollModel(apiKey)`:
  the hook generator's exact call shape (endpoint, model, `json_object`, timeout,
  redaction) plus the 429-aware retry ladder mirrored from `services/transcribe.ts`.
  `hook-generator.ts` was **not** modified.
- `electron/services/video-engine/service.ts` — `brollAssetForProject` exported. No
  behaviour change.
- `electron/ipc/video-engine.ts` — `autoBroll(projectId, downloadId, options)` +
  `ipcMain.handle('videoEngine:autoBroll', …)`; reads `project.captions.words` and falls
  back to `getRepos().getTranscript('proj-'+downloadId)`; refuses with a readable message
  when there is no transcript; streams `videoEngine:autoBroll` progress events; wide
  Sentry events on start/complete/fail.
- `electron/preload.ts` + `shared/types.ts` — `videoEngine.autoBroll` and
  `onAutoBrollProgress`, with `AutoBrollProgress` added to `shared/video-engine/auto-broll.ts`.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **50 passed**
(4 consecutive runs, no flake); `npx vitest run` → **722 passed / 24 skipped**;
`npm run typecheck` and `npm run build` clean.

Two bugs found and fixed by these tests, both real:

- `mapWithConcurrency` used `Promise.all`, so cancelling a run left the second worker's
  rejection unhandled — an unhandled-rejection warning in main for an ordinary cancel. Now
  `allSettled` + rethrow the first failure.
- A moment whose provider pool was entirely already-used was reported as `no-results`,
  which reads as "your query matched nothing" when the real cause is a shallow pool. Now
  `duplicate` when every candidate is in the used set.

### M3 — renderer insertion + the button

- `src/features/video-studio/editor/operations.ts` — `applyAutoBroll(project, placements)`:
  creates/uses the `auto-broll` lane (`order: 10`, kind `video`), appends assets and scenes
  with `volume: 0`, `fit: 'cover'`, and a `sourceRange` clamped to the asset. Existing
  scenes, tracks and assets are only ever appended to.
- `src/features/video-studio/editor/useEditor.ts` — `autoBroll(options)`:
  `flush()` → `runEngine('Finding B-roll', …)` → **one** `edit()` → one notice summarising
  placements and skip reasons. `autoBrollResult` is kept for the panel.
- `src/features/video-studio/editor/Inspector.tsx` — `AutoBrollSection` in `BrollPanel`:
  density / shortest / longest / orientation, live progress on the button, a result
  breakdown, an explicit "no transcript yet" state, and a warning when only the local
  library is available. The manual search below it is untouched.
- `EditorShell.tsx` — subscribes to `onAutoBrollProgress` (one effect, alongside the
  existing transcription-progress one).

Verification — `npx vitest run test/unit/video-engine/editor-operations.test.ts` →
**35 passed** (8 new); full suite **730 passed**; typecheck + build clean.

### M4 — fixture-backed end to end, then live

- `ME_AUTO_BROLL_FIXTURE` in `auto-groq.ts` — a recorded model answer, the same seam
  `ME_YTDLP_FIXTURE` / `ME_WHISPER_FIXTURE` give the milestone smokes. Timestamps in the
  recording need not match the window; `normalizeMoments` clamps them.
- `test/fixtures/broll/auto-answer.json` — that recording.
- `scripts/e2e-studio.mjs` — a full Auto B-roll section: the handler is registered, a
  project with no transcript is refused with an actionable message, captions are seeded from
  SRT (no key needed), the scratch profile's warmed local library is seeded, the run
  downloads real files, and a project carrying the generated clips is accepted by
  `saveProject` and passes preflight.

Verification — `npm run e2e:studio` and `npm run e2e:studio -- --engine remotion` both
**E2E OK**; `npx vitest run` → **732 passed / 24 skipped**; typecheck + build clean.

### Live verification (a real 22-minute clip, the real model)

Driven through the real editor UI in a throwaway profile: a 1320s clip, a 3,680-word
timestamped transcript, and a real Groq key. The warmed local library stood in for the stock
providers — the scratch profile had no Pexels/Pixabay key, so provider relevance went
unexercised here. It is covered by the section below, which was run afterwards with the
user's real keys.

- 11 windows read, 20 moments planned, **18 clips placed from 10s to 1290s of 1320s** —
  first, middle and final third all covered.
- Lane is `auto-broll`, `order: 10`, every clip `volume: 0`, none overlapping, all inside
  the canvas. The two pre-existing clips were untouched.
- The Player paints the footage when scrubbed onto it, through `mestudio://`.
- **One `Ctrl+Z` removed all 18** and restored the timeline exactly.
- `preflight()` clean; no renderer console errors.
- Query quality is good and specific — "cast iron pan cooking", "flour dusting a surface",
  "dog waiting by door", "cityscape through train window". No generic filler survived.

**Bug this found, now fixed.** Groq's free tier limits _tokens_ per minute, and eleven
windows in one burst is most of a minute's budget — a second run inside the same minute lost
**five of eleven windows**, including the last two minutes of the video. The fixed 1.5s/3s
ladder expired long before a per-minute window rolls over. `auto-groq.ts` now honours
`Retry-After` (header, then the "try again in Xs" body text), caps a single wait at 35s,
allows four attempts, and reports the wait as progress. The same back-to-back run now loses
**one** window instead of five and recovers the rest. Rate-limited windows are also reported
as `rate-limited` rather than `model-invalid`, because the fix is to wait and press again,
not to rewrite anything.

### Live verification with the user's real provider keys (2026-08-01)

`test/unit/video-engine/broll-live.test.ts` — skipped unless `ME_LIVE_BROLL=1`, because it
spends real Groq and real stock quota. Real `createAutoBrollModel`, real
`BrollService.withRemoteProviders`, real `scoreCandidate`/`selectPick`; only the mp4
download is budgeted (`ME_LIVE_BROLL_DOWNLOAD`, default 3 of the picks, to prove the URLs
are live). Writes `run.json`, `per-provider.json`, `ranking.json` and every thumbnail to
`ME_LIVE_BROLL_OUT`, because "is the picture what the words said" cannot be asserted.

**Relevance itself is good, and it is carried almost entirely by Pexels.** Nine of the ten
placed clips are what the query asked for, judged frame by frame: "morning forest path" → a
misty tree-lined lane, "flour covered hands knead dough" → hands flattening dough on a
floured bench, "candle flame on wooden desk" → a tealight beside old books, "quiet morning
laundry folding" → a woman folding a shirt, "hands on paper map" → a folded road map. The
tenth ("city street rush hour", Coverr) is a correct subject shot badly out of focus.
Asked on its own, Pexels answers a 4-word literal query almost perfectly — "dog waiting by
door" returns a dog lying at a door; "flour dusting a surface" returns a chef dusting a
counter.

Two defects this exposed, both invisible to fixtures:

- **`scoreCandidate`'s index penalty reads the merged pool, not each provider's own rank.**
  `BrollService.search` concatenates providers in `listProviders()` order — sorted, so
  coverr, pexels, pixabay — and the penalty is 3 points per position. Pixabay's results
  therefore start at index 24 and its _best_ candidate for "dog waiting by door" scores
  **−31.25**, against 42.75 at its own rank (`ranking.json`). Over the 22-minute run
  Pixabay supplied **228 of 474 candidates (48%) and won 0 placements**, while Coverr
  supplied **8 (2%) and won 2** purely for sorting first. A provider's alphabetical name
  decides its weight.
- **Pexels earns the `tag-match` bonus for free.** `providers/pexels.ts` sets
  `title = query.query`, so every Pexels candidate matches every query token: +9, content
  irrelevant. Which is why the output above is good _by accident_ — the free +9 and the
  index advantage together keep Pexels on top. Do not "fix" the index penalty on its own:
  Pixabay at its own rank scores 42.75 on that query with an **airport departure lounge**
  (its tags OR-match, so `dog waiting by door` → airport, `sunlight through bedroom window`
  → a tree canopy), which would then beat Pexels' correct clip at 45 as soon as duration
  fit differs. Duration fit is worth 15 points; nothing in the ranker measures relevance.

**Coverr is close to useless for specific queries** — 0 results for 8 of the 10 queries the
model wrote, and 1 result each for two of the six recorded queries. It is not a failure
(the fan-out absorbs it) but it should not be carrying 20% of placements.

**The Groq key is at its tokens-per-day ceiling, not a per-minute one.** 6 of 11 windows
failed with `TPD` in the 429 body, leaving a hole from 440s to 1130s. The `Retry-After`
ladder then waited its 35s cap four times per window — twenty waits of 35s across the two
concurrent workers, which is essentially the whole 390s run spent waiting out a limit that
resets at midnight. `isTransient` should treat a TPD 429 as terminal.

### M5 — the ranking pair, and a second model (2026-08-01)

The three defects the live provider run exposed, fixed. The ranking two had to land
together: PROGRESS recorded that fixing either alone makes the output _worse_, and that is
still true — per-provider rank without a relevance term promotes Pixabay's OR-matched wrong
answers, and a relevance term without per-provider rank leaves Pixabay too far down the
concatenation to reach however well it matched.

- **Providers describe the clip, never the query.** `providers/pexels.ts` set
  `title = query.query`, so every Pexels candidate contained every query token and earned
  the match bonus on content it had never been compared against. Pexels' video endpoint
  returns no title and an empty `tags` array, but its page URL carries a real description as
  its slug (`/video/dog-in-front-of-the-door-5357497/`) — `describeFromUrl` reads it. The
  same query-echo fallback in `pixabay.ts` and `coverr.ts` is gone too. When nothing can be
  read the title is a content-free placeholder, so relevance reads as _unknown_ rather than
  perfect — falling back to the query would silently restore the free bonus.
- **`providerRanks` numbers each candidate inside its own provider's results**, computed in
  `selectPick` after the fit filter (so "third best" means third of the clips this moment
  could actually use). The penalty is now `8·log1p(rank)` rather than `3·index`: monotonic,
  decelerating, and with a total spread across a 24-result page of 25.4 — deliberately under
  `RELEVANCE_WEIGHT`, which is what stops position deciding a pick on its own.
- **`queryRelevance` is the relevance term the ranker never had.** Whole-token set coverage
  over a crude shared stemmer, worth up to 40 — more than duration fit (15) and resolution
  (15), because a well-shot irrelevant cutaway is the one failure a viewer notices. A miss
  costs −20; an undescribed clip scores +6 (`relevance-unknown`), so the local library and a
  slug-less Pexels response are not switched off by accident. Only whole alphabetic words
  count as a description, because `LocalBrollProvider` titles a clip with its filename and
  `clip001` is a name rather than a claim about the picture. Substring matching is gone with
  it: "cat" no longer matches "location".
- **A tokens-per-day 429 is terminal** (`isExhaustedQuota`), detected from the body's own
  words or from a `retry-after` past two minutes. A per-minute 429 still rides the ladder —
  moving providers for something that clears itself in thirty seconds would spend the
  fallback's budget on nothing.
- **`auto-groq.ts` is now `auto-model.ts`, and Groq is one of two backends.** Once TPD is
  terminal a Groq-only run ends with no footage, so `createAutoBrollModel({groqApiKey,
geminiApiKey})` steps to Gemini (`generateContent`, `responseMimeType: application/json`)
  when Groq's budget is spent, and runs on Gemini alone when that is the only key. A spent
  provider stays spent for the rest of the run — eleven windows share one budget, so
  re-testing it per window is eleven guaranteed failures. Key: `beta.geminiKey`
  (Settings → Integrations → _Auto B-roll · fallback model_) or `GEMINI_API_KEY` /
  `GOOGLE_API_KEY`.

**Measured on the same live workload** (`run.json`, real keys, real 22-minute transcript):

|              | before                              | after             |
| ------------ | ----------------------------------- | ----------------- |
| placements   | 10                                  | **22**            |
| Pixabay      | 48% of candidates, **0 placements** | **12 placements** |
| Coverr       | 2% of candidates, 2 placements      | 5                 |
| windows lost | 6 of 11 (TPD)                       | **0**             |
| elapsed      | 390s                                | **19s**           |

Mean relevance of what was placed: pexels 0.83, pixabay 0.74, coverr 1.0. `ranking.json` on
the documented "dog waiting by door" case: Pixabay's best is reachable at 49.08 (it scored
−31 before), and the airport-departure-lounge false positive PROGRESS predicted would win
once the index penalty was fixed alone now loses to Pexels' "dog in front of the door" at
62.67. That is the pair working as designed.

**Coverr deserves a correction.** It answers few queries (0 results for 4 of 6 recorded
ones) but what it returns is exact — mean relevance 1.0, and it won 5 placements on merit
rather than on sort order. "Close to useless" was the old ranker's verdict, not Coverr's.
Leave it enabled.

**The whole feature runs on Gemini alone**, verified live once Flash-Lite replaced
`gemini-flash-latest`: 11 of 11 windows read, none failed, 17 placements from 0s to 1270s of
1320s, in **32.7s** — against a 900s timeout on the model it replaced.

**The failover is verified live too**, by leading `ME_GEMINI_MODELS` with a model whose
daily budget was already spent: `gemini/flash-latest → gemini/flash-lite-latest`, then 11 of
11 windows read and 16 placements from 10s to 1270s in 67.6s, with the only skips being
`occupied` (spacing) rather than quota. That run also showed the handover being announced
twice — both windows in flight meet the same wall before either has marked it — now fixed
and regression-tested.

**A self-review after the live runs caught two more, both in this change's own code.** Once
every rung is spent the ladder loop has nothing to run, so it fell through to its throw with
no error collected and reported the literal string `undefined` as the reason for every
remaining window; it now says the budget is gone and costs no further requests. And that new
message reached `momentsForChunk`'s classifier, which recognised only `429`/`rate limit` and
so blamed a spent quota on an unusable query — sending the user to rewrite a transcript when
the fix is another key or tomorrow. The classifier now reads `quota` too.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **64 passed**;
`.../auto-broll-model.test.ts` → **25 passed**; `npx vitest run` → **769 passed / 28
skipped**; typecheck + build clean; `npm run e2e:studio` → **E2E OK**.

One caveat on the suite: a single run reported `Errors 1 error` alongside 766 passing tests,
with no failing test named. It did not recur in nine subsequent runs (four full, six of the
new file), and its text was not captured. Unexplained rather than dismissed.

**Running the same workload on Gemini alone found three more bugs, all in this change's own
code.** Each was invisible to Groq because Groq's quota errors read differently.

1. **The retry hint was never read.** Gemini answers a 429 with `"Please retry in
39.5877581s."` — wording `retryAfterFrom` did not match (it knew only Groq's "try again
   in"), buried past a wall of documentation links that `failureFor` truncated away at 400
   characters. With no hint the guessed ladder capped at 35s, undershot every time, and four
   of eleven windows died. Fixed: parse the full body before truncating, read both wordings,
   and honour a wait the server _named_ up to `LONGEST_WORTH_WAITING_MS` while holding only
   a _guessed_ backoff to the 35s cap.
2. **Each worker re-earned the same wait.** With the hint honoured, coverage got _worse_
   (last placement 580s, down from 935s) across eighteen separate waits. A rate limit
   belongs to the key, not the caller: the two windows in flight were each discovering the
   same closed minute and each spending their four attempts on it. `createAutoBrollModel`
   now keeps a per-backend `readyAt` gate — whoever meets the limit publishes the wait
   before sleeping, everyone else joins it, and waiting on the gate costs no attempt.
3. **A daily wall that only announces itself in CamelCase.** The run then hit the 900s test
   timeout, and the reason was the very defect this milestone set out to fix, in different
   clothing: `gemini-flash-latest` resolves to `gemini-3.6-flash`, whose free tier is
   **twenty requests per day**. Google's message promises a 31-second wait and only the
   machine-readable `quotaId` —
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — says the budget is gone until
   tomorrow. `DAILY_LIMIT_PATTERN` wanted `per\s+day` and so read a hard wall as a pause.
   Now `per[\s_-]?day`, regression-tested against the real body.

**One Gemini key is several rungs, because the free-tier budget is granted per MODEL** —
Google's own name for a spent budget is `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
so a model that has run out today says nothing about the next one. `backendsFor` therefore
expands one key into one backend per entry of `GEMINI_MODELS`, and `spent` is tracked per
rung. The default list is lite-first
(`gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest`),
each verified against the live API to answer 200 or a quota 429 rather than 404;
`ME_GEMINI_MODELS` overrides it. `gemini-flash-latest` is last precisely because it resolves
to the twenty-a-day `gemini-3.6-flash`.

A rung is also dropped for the rest of the run on 401/403/404, not only on a spent quota: a
model this key cannot reach does not start existing partway through a video, and leaving it
in the ladder costs one guaranteed failure per window.

---

## Retained findings (do not re-derive)

**Reference repositories carry no LICENSE** — `pandillabalaji/broll-assistant`,
`createkuntal-ship-it/broll-scout`, `Carlton-Li/broll-background-sourcer` are all
_all rights reserved_. GitHub ToS §D.5 grants view/fork on GitHub, not copying into this
product. **Copy nothing.** Techniques (timestamped moments, a duration sweet spot,
blocklisting unfilmable queries, one global used-clip set) are facts and were recreated
from scratch against this app's own types. No prompt strings, code or comments reproduced.

**Already exists — reuse, do not rebuild:**

| Component                     | Location                                                          | Gives us                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrollService.search`         | `broll/service.ts:44`                                             | Parallel fan-out to every registered provider, `allSettled` so one failure survives, dedupe on `provider:id`. This _is_ "search all enabled providers". |
| `BrollService.cacheCandidate` | `broll/service.ts:96`                                             | Download + sha256 + on-disk cache + licence record                                                                                                      |
| `matchesDimensions`           | `broll/http.ts:30`                                                | Orientation / resolution / duration filter, applied inside each provider                                                                                |
| `FixtureBrollProvider`        | `broll/providers/fixture.ts`                                      | Network-free candidates for tests                                                                                                                       |
| `askGroq` shape               | `hook-generator.ts:28`                                            | Timeout, redaction, `response_format: json_object`, one repair round quoting zod issues                                                                 |
| Groq API key                  | `getSettings().transcription.apiKey` → `process.env.GROQ_API_KEY` | Same key the hook generator uses (`ipc/video-engine.ts:654`)                                                                                            |
| Retry ladder                  | `services/transcribe.ts:125`                                      | The 429-aware pattern to mirror (`askGroq` itself has none)                                                                                             |
| Timestamped transcript        | `project.captions.words` (frames)                                 | DB fallback `getRepos().getTranscript('proj-'+downloadId)`                                                                                              |
| `brollAssetForProject`        | `video-engine/service.ts:126`                                     | Candidate + cached file → `VideoAsset` with stock licence metadata. Exported in M2.                                                                     |
| `edit()` funnel               | `useEditor.ts:332`                                                | One local synchronous transform = one undo entry + one debounced save                                                                                   |

**Two unrelated B-roll systems already exist and both stay working:** the editor's manual
one-clip-at-a-time `placeBroll`, and the copy-prompt `fetchBrollBatch` (whose transcript is
truncated at 12,000 chars — the concrete reason it cannot cover a 22-minute timeline).
Auto B-roll is additive to both.

---

## Current Problem

None blocking. The three defects listed here previously are fixed and measured (see M5);
what remains is one limit and one gap:

- **Gemini's free tier is rate-limited per minute _and_ capped per day**, and the caps are
  per model (`gemini-3.6-flash` allows twenty requests a day; Flash-Lite, which this now
  defaults to, is roomier). That is the right shape for a _fallback_ and the wrong one for a
  primary — Groq stays first in the ladder. Anyone running Gemini as their only key should
  expect a slow run, and on a small daily budget a partial one, which is now reported as
  `rate-limited` skips rather than retried into a timeout.
- **Coverr contributes unpredictably.** It answered 5 placements on Groq's queries and zero
  candidates on Gemini's, because whether its catalogue holds anything depends on the exact
  words a model invented that run. The live E2E therefore asserts that the fan-out reached
  more than one provider, not that all three answered; that every registered provider is
  reachable is asserted separately, provider by provider, where the answer is stable.

---

## Relevant Files

New:

- `shared/video-engine/auto-broll.ts` — schema, options, result and track constants
- `electron/services/video-engine/broll/auto.ts` — the pure analyzer
- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll` + `AutoBrollDeps`
- `electron/services/video-engine/broll/auto-model.ts` — the Groq **and Gemini** backends,
  the retry ladder and the quota-failover ladder (was `auto-groq.ts` through M4)
- `test/unit/video-engine/auto-broll.test.ts` (60 tests)
- `test/unit/video-engine/auto-broll-model.test.ts` (24 tests — quota walls, the model
  ladder, the shared rate-limit gate, redaction, and that no provider echoes the query back
  as a clip title)
- `test/unit/video-engine/broll-live.test.ts` (4 tests, skipped unless `ME_LIVE_BROLL=1`)
- `test/fixtures/broll/auto-transcript.json`, `test/fixtures/broll/auto-answer.json`

Modified:

- `shared/video-engine/index.ts`, `shared/types.ts` (+ `beta.geminiKey`), `electron/preload.ts`
- `electron/ipc/video-engine.ts` (`autoBroll` + handler), `.../video-engine/service.ts`
  (export `brollAssetForProject`)
- `electron/services/video-engine/broll/providers/{pexels,pixabay,coverr}.ts` — a candidate
  now describes itself, never the query
- `electron/store/settings.ts` (`geminiKey` is a secret), `src/screens/Settings.tsx`
  (the fallback-model key input)
- `src/features/video-studio/editor/{operations,useEditor,Inspector,EditorShell}.tsx?`
- `scripts/e2e-studio.mjs`, `test/unit/video-engine/editor-operations.test.ts`

---

## Do Not Modify

- Text Motion, captions, video hooks, image cycling, editor styling, unrelated timeline
  behaviour.
- The old studio (`src/features/video-studio/panels/`, `VideoStudio.tsx`) and the Classic /
  HyperFrames engines.
- `electron/services/broll.ts` and `shared/automationBroll.ts` (the automation pipeline).
- `electron/services/smokeSafety.ts` and the userdata guards.
- `placeBroll` / `fetchBrollBatch` — leave the manual paths working.
- The pre-existing `video-engine-broll` track's `order: 0` bug. The new `auto-broll` track
  uses `order: 10`; do not "fix" `placeBroll` in this change.

---

## Next Action

Nothing required — the feature is implemented, the three known defects are fixed, and the
fix is measured on the live workload. Not committed: the branch is
`build/mental-empire-studio` and no commit was authorised.

Worth doing when convenient:

1. A paragraph in `skills/video-studio-editor/SKILL.md` on the Auto B-roll panel and the
   model ladder, now that both have settled.
2. `GEMINI_MODELS` is a snapshot of Google's catalogue on 2026-08-01. When a rung starts
   answering 404 it is dropped for the run and costs nothing, but the list is worth
   refreshing occasionally — `GET /v1beta/models` names what a key can actually reach.

---

## Verification

```bash
npm run userdata:backup                      # REQUIRED before anything runs the app
npx vitest run test/unit/video-engine/auto-broll.test.ts        # 64 passed
npx vitest run test/unit/video-engine/auto-broll-model.test.ts  # 25 passed
npx vitest run test/unit/video-engine/editor-operations.test.ts # 35 passed
npm run typecheck && npm run build
npx vitest run                               # 769 passed / 28 skipped
npm run e2e:studio                           # E2E OK
npm run e2e:studio -- --engine remotion      # E2E OK
```

Provider relevance, live (PowerShell — real quota, real keys, ~7 minutes):

```powershell
$env:ME_LIVE_BROLL='1'; $env:ME_LIVE_BROLL_OUT='<scratch dir>'
$env:GROQ_API_KEY='…'; $env:GEMINI_API_KEY='…'
$env:PEXELS_KEY='…'; $env:PIXABAY_KEY='…'; $env:COVERR_KEY='…'
npx vitest run test/unit/video-engine/broll-live.test.ts
```

Clearing `GROQ_API_KEY` runs the whole feature on Gemini alone — the only way to exercise
that backend end to end without waiting for a real Groq TPD wall. To exercise the _failover_
without waiting for one either, lead `ME_GEMINI_MODELS` with a model whose daily budget is
already gone:

```powershell
$env:ME_GEMINI_MODELS='gemini-flash-latest,gemini-flash-lite-latest,gemini-3.5-flash-lite'
```

Do not run any of this concurrently with `e2e:studio`: the E2E's Compose-nav click has a 10s
timeout and loses it under that much load, which reads as a failure in code it never
touched.

Then look at `$ME_LIVE_BROLL_OUT/thumbs` — the placements are `p-<n>-<seconds>-<query>.jpg`,
and `q-<query>--<provider>-<rank>.jpg` is the same query asked of one provider alone. The
assertions cover coverage, no empty query, and no clip used twice; the pictures are the part
only a person can check.

User data confirmed intact afterwards: `%APPDATA%\Mental Empire Studio\mental-empire.db`
still 1,880,064 bytes, matching the pre-work snapshot `CLAUDE-BACKUP-20260801-161138`.

Live check (PowerShell): `node scripts/studio-live.mjs --port 9222`, then
`playwright-cli -s=mes attach --cdp=http://localhost:9222`. On a real 22-minute clip
assert: placements span the first and last minute (check earliest/latest `startFrame`, not
the count) · the clips sit on one new lane above `Visuals` · narration is still audible at
a placement (`volume: 0`) · one `Ctrl+Z` removes the whole run · `preflight()` clean and
the save indicator settles once · a deliberately wrong Pexels key still completes from the
other providers and reports the failure.

Then confirm the user's data survived: `npm run userdata:list`.

# Current Objective

Ship **Auto B-roll** in the Compose → Remotion editor: one button reads the _whole_
timestamped transcript (22-minute videos included), asks Groq for timestamped visual
queries in bounded chunks, searches every enabled provider through the existing
`BrollService`, ranks and de-duplicates the results, and inserts the picks across the
entire timeline as one undoable local edit.

Status: **complete and verified — M1 through M5.** Verified live against a real 22-minute
clip and a real model, not only against fixtures; against the user's real
Pexels/Pixabay/Coverr keys, which closed the last gap and turned up three defects; and, as
of M5, with those defects fixed and the fix measured on the same live workload.

---

## Verified Completed

### M1 — pure analyzer core (no network, no UI)

- `shared/video-engine/auto-broll.ts` — zod schema for the model's answer
  (`AutoBrollMomentSchema`, `AutoBrollAnswerSchema`, `safeParseAutoBrollAnswer`) plus the
  `AutoBrollOptions` / `AutoBrollPlacement` / `AutoBrollSkip` / `AutoBrollResult` types and
  the `AUTO_BROLL_TRACK_*` constants. Re-exported from `shared/video-engine/index.ts`.
- `electron/services/video-engine/broll/auto.ts` — `transcriptLinesFromWords`,
  `chunkTranscript`, `buildAutoBrollPrompt`, `normalizeMoments`, `mergeMoments`,
  `targetMomentCount`, `scoreCandidate`, `candidateFitsSlot`, `selectPick`,
  `placementTiming`, and the query hygiene helpers (`normalizeQuery`, `isGenericQuery`,
  `queryFromText`). All pure; no Electron, no fetch.
- `test/unit/video-engine/auto-broll.test.ts` + `test/fixtures/broll/auto-transcript.json`
  (sentence bank the test expands into a 1319-second word list).

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **37 passed**;
`npx vitest run` → **709 passed / 24 skipped, no regressions**; `npm run typecheck` clean.

Decisions that must persist:

- **The model is never trusted with arithmetic.** It is asked for in-window timestamps and
  then clamped to the window regardless.
- **The last window always ends where the transcript does**, and every window's target is
  `max(1, …)`. That pair — not a prompt instruction — is what makes the final section get
  B-roll. Capping the run thins from the crowded middle (`thinToCap`), never off the ends.
- A window that is capped or widened never _drops_ a window: `maxChunks` grows
  `windowSeconds` instead.
- The answer schema is intentionally lenient (non-strict object, clock notation accepted,
  soft fields defaulted). A rejected answer is a hole in the coverage, unlike the hook plan
  where it is one retry.

### M2 — main-process orchestration behind IPC

- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll(input, deps)`.
  Chunks → model per window (2 in flight, one repair round) → merge/space → search per
  moment (3 in flight, one search per distinct query per run) → serial rank + global
  de-duplicate + download. Every outside effect arrives through `AutoBrollDeps`
  (`askModel` / `searchBroll` / `materialize` / `onProgress` / `signal`), which is what
  lets the whole thing be tested against fixtures instead of API quota.
- `electron/services/video-engine/broll/auto-groq.ts` (**renamed `auto-model.ts` in M5**, and
  `createAutoBrollModel` now takes a key object rather than one string) —
  `createAutoBrollModel(apiKey)`:
  the hook generator's exact call shape (endpoint, model, `json_object`, timeout,
  redaction) plus the 429-aware retry ladder mirrored from `services/transcribe.ts`.
  `hook-generator.ts` was **not** modified.
- `electron/services/video-engine/service.ts` — `brollAssetForProject` exported. No
  behaviour change.
- `electron/ipc/video-engine.ts` — `autoBroll(projectId, downloadId, options)` +
  `ipcMain.handle('videoEngine:autoBroll', …)`; reads `project.captions.words` and falls
  back to `getRepos().getTranscript('proj-'+downloadId)`; refuses with a readable message
  when there is no transcript; streams `videoEngine:autoBroll` progress events; wide
  Sentry events on start/complete/fail.
- `electron/preload.ts` + `shared/types.ts` — `videoEngine.autoBroll` and
  `onAutoBrollProgress`, with `AutoBrollProgress` added to `shared/video-engine/auto-broll.ts`.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **50 passed**
(4 consecutive runs, no flake); `npx vitest run` → **722 passed / 24 skipped**;
`npm run typecheck` and `npm run build` clean.

Two bugs found and fixed by these tests, both real:

- `mapWithConcurrency` used `Promise.all`, so cancelling a run left the second worker's
  rejection unhandled — an unhandled-rejection warning in main for an ordinary cancel. Now
  `allSettled` + rethrow the first failure.
- A moment whose provider pool was entirely already-used was reported as `no-results`,
  which reads as "your query matched nothing" when the real cause is a shallow pool. Now
  `duplicate` when every candidate is in the used set.

### M3 — renderer insertion + the button

- `src/features/video-studio/editor/operations.ts` — `applyAutoBroll(project, placements)`:
  creates/uses the `auto-broll` lane (`order: 10`, kind `video`), appends assets and scenes
  with `volume: 0`, `fit: 'cover'`, and a `sourceRange` clamped to the asset. Existing
  scenes, tracks and assets are only ever appended to.
- `src/features/video-studio/editor/useEditor.ts` — `autoBroll(options)`:
  `flush()` → `runEngine('Finding B-roll', …)` → **one** `edit()` → one notice summarising
  placements and skip reasons. `autoBrollResult` is kept for the panel.
- `src/features/video-studio/editor/Inspector.tsx` — `AutoBrollSection` in `BrollPanel`:
  density / shortest / longest / orientation, live progress on the button, a result
  breakdown, an explicit "no transcript yet" state, and a warning when only the local
  library is available. The manual search below it is untouched.
- `EditorShell.tsx` — subscribes to `onAutoBrollProgress` (one effect, alongside the
  existing transcription-progress one).

Verification — `npx vitest run test/unit/video-engine/editor-operations.test.ts` →
**35 passed** (8 new); full suite **730 passed**; typecheck + build clean.

### M4 — fixture-backed end to end, then live

- `ME_AUTO_BROLL_FIXTURE` in `auto-groq.ts` — a recorded model answer, the same seam
  `ME_YTDLP_FIXTURE` / `ME_WHISPER_FIXTURE` give the milestone smokes. Timestamps in the
  recording need not match the window; `normalizeMoments` clamps them.
- `test/fixtures/broll/auto-answer.json` — that recording.
- `scripts/e2e-studio.mjs` — a full Auto B-roll section: the handler is registered, a
  project with no transcript is refused with an actionable message, captions are seeded from
  SRT (no key needed), the scratch profile's warmed local library is seeded, the run
  downloads real files, and a project carrying the generated clips is accepted by
  `saveProject` and passes preflight.

Verification — `npm run e2e:studio` and `npm run e2e:studio -- --engine remotion` both
**E2E OK**; `npx vitest run` → **732 passed / 24 skipped**; typecheck + build clean.

### Live verification (a real 22-minute clip, the real model)

Driven through the real editor UI in a throwaway profile: a 1320s clip, a 3,680-word
timestamped transcript, and a real Groq key. The warmed local library stood in for the stock
providers — the scratch profile had no Pexels/Pixabay key, so provider relevance went
unexercised here. It is covered by the section below, which was run afterwards with the
user's real keys.

- 11 windows read, 20 moments planned, **18 clips placed from 10s to 1290s of 1320s** —
  first, middle and final third all covered.
- Lane is `auto-broll`, `order: 10`, every clip `volume: 0`, none overlapping, all inside
  the canvas. The two pre-existing clips were untouched.
- The Player paints the footage when scrubbed onto it, through `mestudio://`.
- **One `Ctrl+Z` removed all 18** and restored the timeline exactly.
- `preflight()` clean; no renderer console errors.
- Query quality is good and specific — "cast iron pan cooking", "flour dusting a surface",
  "dog waiting by door", "cityscape through train window". No generic filler survived.

**Bug this found, now fixed.** Groq's free tier limits _tokens_ per minute, and eleven
windows in one burst is most of a minute's budget — a second run inside the same minute lost
**five of eleven windows**, including the last two minutes of the video. The fixed 1.5s/3s
ladder expired long before a per-minute window rolls over. `auto-groq.ts` now honours
`Retry-After` (header, then the "try again in Xs" body text), caps a single wait at 35s,
allows four attempts, and reports the wait as progress. The same back-to-back run now loses
**one** window instead of five and recovers the rest. Rate-limited windows are also reported
as `rate-limited` rather than `model-invalid`, because the fix is to wait and press again,
not to rewrite anything.

### Live verification with the user's real provider keys (2026-08-01)

`test/unit/video-engine/broll-live.test.ts` — skipped unless `ME_LIVE_BROLL=1`, because it
spends real Groq and real stock quota. Real `createAutoBrollModel`, real
`BrollService.withRemoteProviders`, real `scoreCandidate`/`selectPick`; only the mp4
download is budgeted (`ME_LIVE_BROLL_DOWNLOAD`, default 3 of the picks, to prove the URLs
are live). Writes `run.json`, `per-provider.json`, `ranking.json` and every thumbnail to
`ME_LIVE_BROLL_OUT`, because "is the picture what the words said" cannot be asserted.

**Relevance itself is good, and it is carried almost entirely by Pexels.** Nine of the ten
placed clips are what the query asked for, judged frame by frame: "morning forest path" → a
misty tree-lined lane, "flour covered hands knead dough" → hands flattening dough on a
floured bench, "candle flame on wooden desk" → a tealight beside old books, "quiet morning
laundry folding" → a woman folding a shirt, "hands on paper map" → a folded road map. The
tenth ("city street rush hour", Coverr) is a correct subject shot badly out of focus.
Asked on its own, Pexels answers a 4-word literal query almost perfectly — "dog waiting by
door" returns a dog lying at a door; "flour dusting a surface" returns a chef dusting a
counter.

Two defects this exposed, both invisible to fixtures:

- **`scoreCandidate`'s index penalty reads the merged pool, not each provider's own rank.**
  `BrollService.search` concatenates providers in `listProviders()` order — sorted, so
  coverr, pexels, pixabay — and the penalty is 3 points per position. Pixabay's results
  therefore start at index 24 and its _best_ candidate for "dog waiting by door" scores
  **−31.25**, against 42.75 at its own rank (`ranking.json`). Over the 22-minute run
  Pixabay supplied **228 of 474 candidates (48%) and won 0 placements**, while Coverr
  supplied **8 (2%) and won 2** purely for sorting first. A provider's alphabetical name
  decides its weight.
- **Pexels earns the `tag-match` bonus for free.** `providers/pexels.ts` sets
  `title = query.query`, so every Pexels candidate matches every query token: +9, content
  irrelevant. Which is why the output above is good _by accident_ — the free +9 and the
  index advantage together keep Pexels on top. Do not "fix" the index penalty on its own:
  Pixabay at its own rank scores 42.75 on that query with an **airport departure lounge**
  (its tags OR-match, so `dog waiting by door` → airport, `sunlight through bedroom window`
  → a tree canopy), which would then beat Pexels' correct clip at 45 as soon as duration
  fit differs. Duration fit is worth 15 points; nothing in the ranker measures relevance.

**Coverr is close to useless for specific queries** — 0 results for 8 of the 10 queries the
model wrote, and 1 result each for two of the six recorded queries. It is not a failure
(the fan-out absorbs it) but it should not be carrying 20% of placements.

**The Groq key is at its tokens-per-day ceiling, not a per-minute one.** 6 of 11 windows
failed with `TPD` in the 429 body, leaving a hole from 440s to 1130s. The `Retry-After`
ladder then waited its 35s cap four times per window — twenty waits of 35s across the two
concurrent workers, which is essentially the whole 390s run spent waiting out a limit that
resets at midnight. `isTransient` should treat a TPD 429 as terminal.

### M5 — the ranking pair, and a second model (2026-08-01)

The three defects the live provider run exposed, fixed. The ranking two had to land
together: PROGRESS recorded that fixing either alone makes the output _worse_, and that is
still true — per-provider rank without a relevance term promotes Pixabay's OR-matched wrong
answers, and a relevance term without per-provider rank leaves Pixabay too far down the
concatenation to reach however well it matched.

- **Providers describe the clip, never the query.** `providers/pexels.ts` set
  `title = query.query`, so every Pexels candidate contained every query token and earned
  the match bonus on content it had never been compared against. Pexels' video endpoint
  returns no title and an empty `tags` array, but its page URL carries a real description as
  its slug (`/video/dog-in-front-of-the-door-5357497/`) — `describeFromUrl` reads it. The
  same query-echo fallback in `pixabay.ts` and `coverr.ts` is gone too. When nothing can be
  read the title is a content-free placeholder, so relevance reads as _unknown_ rather than
  perfect — falling back to the query would silently restore the free bonus.
- **`providerRanks` numbers each candidate inside its own provider's results**, computed in
  `selectPick` after the fit filter (so "third best" means third of the clips this moment
  could actually use). The penalty is now `8·log1p(rank)` rather than `3·index`: monotonic,
  decelerating, and with a total spread across a 24-result page of 25.4 — deliberately under
  `RELEVANCE_WEIGHT`, which is what stops position deciding a pick on its own.
- **`queryRelevance` is the relevance term the ranker never had.** Whole-token set coverage
  over a crude shared stemmer, worth up to 40 — more than duration fit (15) and resolution
  (15), because a well-shot irrelevant cutaway is the one failure a viewer notices. A miss
  costs −20; an undescribed clip scores +6 (`relevance-unknown`), so the local library and a
  slug-less Pexels response are not switched off by accident. Only whole alphabetic words
  count as a description, because `LocalBrollProvider` titles a clip with its filename and
  `clip001` is a name rather than a claim about the picture. Substring matching is gone with
  it: "cat" no longer matches "location".
- **A tokens-per-day 429 is terminal** (`isExhaustedQuota`), detected from the body's own
  words or from a `retry-after` past two minutes. A per-minute 429 still rides the ladder —
  moving providers for something that clears itself in thirty seconds would spend the
  fallback's budget on nothing.
- **`auto-groq.ts` is now `auto-model.ts`, and Groq is one of two backends.** Once TPD is
  terminal a Groq-only run ends with no footage, so `createAutoBrollModel({groqApiKey,
geminiApiKey})` steps to Gemini (`generateContent`, `responseMimeType: application/json`)
  when Groq's budget is spent, and runs on Gemini alone when that is the only key. A spent
  provider stays spent for the rest of the run — eleven windows share one budget, so
  re-testing it per window is eleven guaranteed failures. Key: `beta.geminiKey`
  (Settings → Integrations → _Auto B-roll · fallback model_) or `GEMINI_API_KEY` /
  `GOOGLE_API_KEY`.

**Measured on the same live workload** (`run.json`, real keys, real 22-minute transcript):

|              | before                              | after             |
| ------------ | ----------------------------------- | ----------------- |
| placements   | 10                                  | **22**            |
| Pixabay      | 48% of candidates, **0 placements** | **12 placements** |
| Coverr       | 2% of candidates, 2 placements      | 5                 |
| windows lost | 6 of 11 (TPD)                       | **0**             |
| elapsed      | 390s                                | **19s**           |

Mean relevance of what was placed: pexels 0.83, pixabay 0.74, coverr 1.0. `ranking.json` on
the documented "dog waiting by door" case: Pixabay's best is reachable at 49.08 (it scored
−31 before), and the airport-departure-lounge false positive PROGRESS predicted would win
once the index penalty was fixed alone now loses to Pexels' "dog in front of the door" at
62.67. That is the pair working as designed.

**Coverr deserves a correction.** It answers few queries (0 results for 4 of 6 recorded
ones) but what it returns is exact — mean relevance 1.0, and it won 5 placements on merit
rather than on sort order. "Close to useless" was the old ranker's verdict, not Coverr's.
Leave it enabled.

**The whole feature runs on Gemini alone**, verified live once Flash-Lite replaced
`gemini-flash-latest`: 11 of 11 windows read, none failed, 17 placements from 0s to 1270s of
1320s, in **32.7s** — against a 900s timeout on the model it replaced.

**The failover is verified live too**, by leading `ME_GEMINI_MODELS` with a model whose
daily budget was already spent: `gemini/flash-latest → gemini/flash-lite-latest`, then 11 of
11 windows read and 16 placements from 10s to 1270s in 67.6s, with the only skips being
`occupied` (spacing) rather than quota. That run also showed the handover being announced
twice — both windows in flight meet the same wall before either has marked it — now fixed
and regression-tested.

**A self-review after the live runs caught two more, both in this change's own code.** Once
every rung is spent the ladder loop has nothing to run, so it fell through to its throw with
no error collected and reported the literal string `undefined` as the reason for every
remaining window; it now says the budget is gone and costs no further requests. And that new
message reached `momentsForChunk`'s classifier, which recognised only `429`/`rate limit` and
so blamed a spent quota on an unusable query — sending the user to rewrite a transcript when
the fix is another key or tomorrow. The classifier now reads `quota` too.

Verification — `npx vitest run test/unit/video-engine/auto-broll.test.ts` → **64 passed**;
`.../auto-broll-model.test.ts` → **25 passed**; `npx vitest run` → **769 passed / 28
skipped**; typecheck + build clean; `npm run e2e:studio` → **E2E OK**.

One caveat on the suite: a single run reported `Errors 1 error` alongside 766 passing tests,
with no failing test named. It did not recur in nine subsequent runs (four full, six of the
new file), and its text was not captured. Unexplained rather than dismissed.

**Running the same workload on Gemini alone found three more bugs, all in this change's own
code.** Each was invisible to Groq because Groq's quota errors read differently.

1. **The retry hint was never read.** Gemini answers a 429 with `"Please retry in
39.5877581s."` — wording `retryAfterFrom` did not match (it knew only Groq's "try again
   in"), buried past a wall of documentation links that `failureFor` truncated away at 400
   characters. With no hint the guessed ladder capped at 35s, undershot every time, and four
   of eleven windows died. Fixed: parse the full body before truncating, read both wordings,
   and honour a wait the server _named_ up to `LONGEST_WORTH_WAITING_MS` while holding only
   a _guessed_ backoff to the 35s cap.
2. **Each worker re-earned the same wait.** With the hint honoured, coverage got _worse_
   (last placement 580s, down from 935s) across eighteen separate waits. A rate limit
   belongs to the key, not the caller: the two windows in flight were each discovering the
   same closed minute and each spending their four attempts on it. `createAutoBrollModel`
   now keeps a per-backend `readyAt` gate — whoever meets the limit publishes the wait
   before sleeping, everyone else joins it, and waiting on the gate costs no attempt.
3. **A daily wall that only announces itself in CamelCase.** The run then hit the 900s test
   timeout, and the reason was the very defect this milestone set out to fix, in different
   clothing: `gemini-flash-latest` resolves to `gemini-3.6-flash`, whose free tier is
   **twenty requests per day**. Google's message promises a 31-second wait and only the
   machine-readable `quotaId` —
   `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — says the budget is gone until
   tomorrow. `DAILY_LIMIT_PATTERN` wanted `per\s+day` and so read a hard wall as a pause.
   Now `per[\s_-]?day`, regression-tested against the real body.

**One Gemini key is several rungs, because the free-tier budget is granted per MODEL** —
Google's own name for a spent budget is `GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
so a model that has run out today says nothing about the next one. `backendsFor` therefore
expands one key into one backend per entry of `GEMINI_MODELS`, and `spent` is tracked per
rung. The default list is lite-first
(`gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest`),
each verified against the live API to answer 200 or a quota 429 rather than 404;
`ME_GEMINI_MODELS` overrides it. `gemini-flash-latest` is last precisely because it resolves
to the twenty-a-day `gemini-3.6-flash`.

A rung is also dropped for the rest of the run on 401/403/404, not only on a spent quota: a
model this key cannot reach does not start existing partway through a video, and leaving it
in the ladder costs one guaranteed failure per window.

---

## Retained findings (do not re-derive)

**Reference repositories carry no LICENSE** — `pandillabalaji/broll-assistant`,
`createkuntal-ship-it/broll-scout`, `Carlton-Li/broll-background-sourcer` are all
_all rights reserved_. GitHub ToS §D.5 grants view/fork on GitHub, not copying into this
product. **Copy nothing.** Techniques (timestamped moments, a duration sweet spot,
blocklisting unfilmable queries, one global used-clip set) are facts and were recreated
from scratch against this app's own types. No prompt strings, code or comments reproduced.

**Already exists — reuse, do not rebuild:**

| Component                     | Location                                                          | Gives us                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrollService.search`         | `broll/service.ts:44`                                             | Parallel fan-out to every registered provider, `allSettled` so one failure survives, dedupe on `provider:id`. This _is_ "search all enabled providers". |
| `BrollService.cacheCandidate` | `broll/service.ts:96`                                             | Download + sha256 + on-disk cache + licence record                                                                                                      |
| `matchesDimensions`           | `broll/http.ts:30`                                                | Orientation / resolution / duration filter, applied inside each provider                                                                                |
| `FixtureBrollProvider`        | `broll/providers/fixture.ts`                                      | Network-free candidates for tests                                                                                                                       |
| `askGroq` shape               | `hook-generator.ts:28`                                            | Timeout, redaction, `response_format: json_object`, one repair round quoting zod issues                                                                 |
| Groq API key                  | `getSettings().transcription.apiKey` → `process.env.GROQ_API_KEY` | Same key the hook generator uses (`ipc/video-engine.ts:654`)                                                                                            |
| Retry ladder                  | `services/transcribe.ts:125`                                      | The 429-aware pattern to mirror (`askGroq` itself has none)                                                                                             |
| Timestamped transcript        | `project.captions.words` (frames)                                 | DB fallback `getRepos().getTranscript('proj-'+downloadId)`                                                                                              |
| `brollAssetForProject`        | `video-engine/service.ts:126`                                     | Candidate + cached file → `VideoAsset` with stock licence metadata. Exported in M2.                                                                     |
| `edit()` funnel               | `useEditor.ts:332`                                                | One local synchronous transform = one undo entry + one debounced save                                                                                   |

**Two unrelated B-roll systems already exist and both stay working:** the editor's manual
one-clip-at-a-time `placeBroll`, and the copy-prompt `fetchBrollBatch` (whose transcript is
truncated at 12,000 chars — the concrete reason it cannot cover a 22-minute timeline).
Auto B-roll is additive to both.

---

## Current Problem

None blocking. The three defects listed here previously are fixed and measured (see M5);
what remains is one limit and one gap:

- **Gemini's free tier is rate-limited per minute _and_ capped per day**, and the caps are
  per model (`gemini-3.6-flash` allows twenty requests a day; Flash-Lite, which this now
  defaults to, is roomier). That is the right shape for a _fallback_ and the wrong one for a
  primary — Groq stays first in the ladder. Anyone running Gemini as their only key should
  expect a slow run, and on a small daily budget a partial one, which is now reported as
  `rate-limited` skips rather than retried into a timeout.
- **Coverr contributes unpredictably.** It answered 5 placements on Groq's queries and zero
  candidates on Gemini's, because whether its catalogue holds anything depends on the exact
  words a model invented that run. The live E2E therefore asserts that the fan-out reached
  more than one provider, not that all three answered; that every registered provider is
  reachable is asserted separately, provider by provider, where the answer is stable.

---

## Relevant Files

New:

- `shared/video-engine/auto-broll.ts` — schema, options, result and track constants
- `electron/services/video-engine/broll/auto.ts` — the pure analyzer
- `electron/services/video-engine/broll/auto-plan.ts` — `planAutoBroll` + `AutoBrollDeps`
- `electron/services/video-engine/broll/auto-model.ts` — the Groq **and Gemini** backends,
  the retry ladder and the quota-failover ladder (was `auto-groq.ts` through M4)
- `test/unit/video-engine/auto-broll.test.ts` (60 tests)
- `test/unit/video-engine/auto-broll-model.test.ts` (24 tests — quota walls, the model
  ladder, the shared rate-limit gate, redaction, and that no provider echoes the query back
  as a clip title)
- `test/unit/video-engine/broll-live.test.ts` (4 tests, skipped unless `ME_LIVE_BROLL=1`)
- `test/fixtures/broll/auto-transcript.json`, `test/fixtures/broll/auto-answer.json`

Modified:

- `shared/video-engine/index.ts`, `shared/types.ts` (+ `beta.geminiKey`), `electron/preload.ts`
- `electron/ipc/video-engine.ts` (`autoBroll` + handler), `.../video-engine/service.ts`
  (export `brollAssetForProject`)
- `electron/services/video-engine/broll/providers/{pexels,pixabay,coverr}.ts` — a candidate
  now describes itself, never the query
- `electron/store/settings.ts` (`geminiKey` is a secret), `src/screens/Settings.tsx`
  (the fallback-model key input)
- `src/features/video-studio/editor/{operations,useEditor,Inspector,EditorShell}.tsx?`
- `scripts/e2e-studio.mjs`, `test/unit/video-engine/editor-operations.test.ts`

---

## Do Not Modify

- Text Motion, captions, video hooks, image cycling, editor styling, unrelated timeline
  behaviour.
- The old studio (`src/features/video-studio/panels/`, `VideoStudio.tsx`) and the Classic /
  HyperFrames engines.
- `electron/services/broll.ts` and `shared/automationBroll.ts` (the automation pipeline).
- `electron/services/smokeSafety.ts` and the userdata guards.
- `placeBroll` / `fetchBrollBatch` — leave the manual paths working.
- The pre-existing `video-engine-broll` track's `order: 0` bug. The new `auto-broll` track
  uses `order: 10`; do not "fix" `placeBroll` in this change.

---

## Next Action

Nothing required — the feature is implemented, the three known defects are fixed, and the
fix is measured on the live workload. Not committed: the branch is
`build/mental-empire-studio` and no commit was authorised.

Worth doing when convenient:

1. A paragraph in `skills/video-studio-editor/SKILL.md` on the Auto B-roll panel and the
   model ladder, now that both have settled.
2. `GEMINI_MODELS` is a snapshot of Google's catalogue on 2026-08-01. When a rung starts
   answering 404 it is dropped for the run and costs nothing, but the list is worth
   refreshing occasionally — `GET /v1beta/models` names what a key can actually reach.

---

## Verification

```bash
npm run userdata:backup                      # REQUIRED before anything runs the app
npx vitest run test/unit/video-engine/auto-broll.test.ts        # 64 passed
npx vitest run test/unit/video-engine/auto-broll-model.test.ts  # 25 passed
npx vitest run test/unit/video-engine/editor-operations.test.ts # 35 passed
npm run typecheck && npm run build
npx vitest run                               # 769 passed / 28 skipped
npm run e2e:studio                           # E2E OK
npm run e2e:studio -- --engine remotion      # E2E OK
```

Provider relevance, live (PowerShell — real quota, real keys, ~7 minutes):

```powershell
$env:ME_LIVE_BROLL='1'; $env:ME_LIVE_BROLL_OUT='<scratch dir>'
$env:GROQ_API_KEY='…'; $env:GEMINI_API_KEY='…'
$env:PEXELS_KEY='…'; $env:PIXABAY_KEY='…'; $env:COVERR_KEY='…'
npx vitest run test/unit/video-engine/broll-live.test.ts
```

Clearing `GROQ_API_KEY` runs the whole feature on Gemini alone — the only way to exercise
that backend end to end without waiting for a real Groq TPD wall. To exercise the _failover_
without waiting for one either, lead `ME_GEMINI_MODELS` with a model whose daily budget is
already gone:

```powershell
$env:ME_GEMINI_MODELS='gemini-flash-latest,gemini-flash-lite-latest,gemini-3.5-flash-lite'
```

Do not run any of this concurrently with `e2e:studio`: the E2E's Compose-nav click has a 10s
timeout and loses it under that much load, which reads as a failure in code it never
touched.

Then look at `$ME_LIVE_BROLL_OUT/thumbs` — the placements are `p-<n>-<seconds>-<query>.jpg`,
and `q-<query>--<provider>-<rank>.jpg` is the same query asked of one provider alone. The
assertions cover coverage, no empty query, and no clip used twice; the pictures are the part
only a person can check.

User data confirmed intact afterwards: `%APPDATA%\Mental Empire Studio\mental-empire.db`
still 1,880,064 bytes, matching the pre-work snapshot `CLAUDE-BACKUP-20260801-161138`.

Live check (PowerShell): `node scripts/studio-live.mjs --port 9222`, then
`playwright-cli -s=mes attach --cdp=http://localhost:9222`. On a real 22-minute clip
assert: placements span the first and last minute (check earliest/latest `startFrame`, not
the count) · the clips sit on one new lane above `Visuals` · narration is still audible at
a placement (`volume: 0`) · one `Ctrl+Z` removes the whole run · `preflight()` clean and
the save indicator settles once · a deliberately wrong Pexels key still completes from the
other providers and reports the failure.

Then confirm the user's data survived: `npm run userdata:list`.
