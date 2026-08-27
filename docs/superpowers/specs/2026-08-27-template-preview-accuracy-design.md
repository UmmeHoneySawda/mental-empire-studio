# Template Preview Accuracy — Design Spec

Date: 2026-08-27
Status: approved for implementation
Scope: `src/features/automation/AnimatedThumb/*`, `src/features/automation/MachineCard.tsx`, `src/features/automation/TemplateSheet.tsx`, `shared/video-engine/grading.ts`, `electron/services/video-engine/studio.ts`
Mode: Fix (accuracy) — no render pipeline change, no DB migration, no new IPC

---

## 1. Goal

Make the Automations → Templates previews show what will actually render. Today the four thumbnail components are hand-drawn CSS guesses that ignore the real grading pipeline and never show real media. The user asked for a light, honest preview with the image loaded when available and a sensible fallback for Auto B-roll — not a time-consuming new preview system.

Success: opening or creating a template shows a preview that uses the same grade resolver and caption/hook definitions the render uses, with the first pool image as backdrop when present.

Non-goal: new B-roll fetching, new IPC for B-roll listing, changing what Noir/Gold render, changing aspect-ratio behavior, or touching `docs/RENDER-PERFORMANCE.md`.

---

## 2. Root cause

Verified by reading source (not guessing):

1. `GradeThumb.tsx:3-19` keeps a private `GRADE_WASH` gradient table keyed only on `template.grade`. It ignores `filterPresetId`, `adjust`, and `effectsPresetIds`, which are where most of the look comes from. The real look is `automationRemotionGrade()` (`shared/automationRemotion.ts:41-79`, called at `electron/services/automation-remotion.ts:149`) → `gradeFilter()/gradeTintLayer()/gradeVignetteLayer()` (`src/features/video-studio/editor/gradePreview.ts:40-84`).

2. Grade chips lie. `GRADE_TO_VIDEO_STYLE` (`shared/automationTemplate.ts:27-34`) maps `Noir→Cinematic` and `Gold→Heartfelt`. So Noir shows near-black but renders teal-orange; Gold shows gold wash but renders warm-doc. `Clean` maps to `off` (no grading) yet shows a bright blue gradient. The comment at `automationTemplate.ts:25` says both chips were slated for removal.

3. `CaptionThumb.tsx:22,44` switches on `templateId.includes('cine')` and hardcodes fonts. It never reads `CAPTION_STYLE_DEFINITIONS` (`shared/video-engine/caption-style.ts:38-57`) which carries real `fontFamily/fontWeight/uppercase/textColor/activeColor/activeTreatment/placement/fontScale`. All 10 caption styles look near-identical in preview but render very differently. `NEW_CAPTION_DEFINITIONS` (`shared/video-engine/new-templates.ts:195-212`) has no `fontFamily` — fonts are hardcoded in `video-engine/remotion/new-templates/kit.tsx:33-35` and `captions.tsx` per template (Cinzel/Oswald/Courier Prime with distinct placements).

4. No real media ever. `Image slideshow` mode has real local files in `template.imagePaths` already previewable via `previewUrlForPath()` (`src/features/video-studio/editor/assetUrl.ts:28-30`, CSP allows `mestudio:`), proven by `TemplateImagePool.tsx:150-159`. Thumbs never use them.

5. Composition variety is high: five cinematic caption layouts with distinct placements and treatments (`video-engine/remotion/new-templates/captions.tsx:219-233`, `244-270`), and seven classic hooks sharing one component (`hook.tsx:259-460`) with heavy fixed chrome (eyebrow, 112×10 accent pill, body, beat counter) and a `variant`-driven palette override (`hook-style.ts:78-112`, `automationRemotion.ts:150` forces `urgent` vs `cinematic`). Hand-mirroring all of that is not a small job and would drift.

Authoritative preview layer already exists and is reused by real Video Studio preview: `gradeFilter/tint/vignette` in `gradePreview.ts` (same numbers as FFmpeg chain) and `PreviewStage.tsx:70-72,84-105` layering pattern.

---

## 3. Approach chosen

**Hybrid — Real Remotion Player in sheet + cheap static frame on cards (recommended)**

Over:
- *Keep 4 DOM tiles, feed real data* — keeps abstract layout, still requires mirroring all caption/hook chrome, drifts.
- *Single DOM frame with mirrored caption/hook* — less code than 4 tiles but still a lookalike with drift risk.
- *Real Player everywhere* — perfect fidelity but heavy: each card would run its own Remotion reconciler/timeline.

Hybrid gives perfect, drift-proof fidelity exactly where tuning happens (sheet), and a cheap honest frame where lists must stay fast (cards). It reuses production components, so it cannot diverge.

---

## 4. Architecture

### 4.1 Presets move to shared

`VIDEO_GRADING_PRESETS` (`electron/services/video-engine/studio.ts:994-1046`, `Object.freeze` array of 6: `off, teal-orange, bleach-noir, warm-doc, cold-clinical, retro-film`) moves to `shared/video-engine/grading.ts` beside `DEFAULT_VIDEO_GRADING:38` it already depends on. `studio.ts` re-exports it. Zero main-process dependencies; type `VideoGradingPreset` already in `shared/video-engine/ipc.ts:286`. Allows synchronous import in renderer without async IPC.

### 4.2 Pure resolver

`src/features/automation/templatePreviewModel.ts` — pure function `resolveTemplatePreview(template: VisualTemplate)` returning `{ grading, caption, hook, aspect, backdrop, caveat }`. Uses `visualTemplateToStyleConfig()` (`shared/automationTemplate.ts:63`) → `automationRemotionGrade()` → `CAPTION_STYLE_DEFINITIONS` / `NEW_CAPTION_DEFINITIONS` lookup. No JSX, unit-testable. `caveat` is `gradePreviewCaveat(grading)` (`gradePreview.ts:30-37`) for grain/LUT notices.

### 4.3 Card frame (cheap)

`src/features/automation/TemplatePreviewFrame.tsx` — static 16:9 outer box with true-aspect inner frame centered (letterboxed on `var(--bg-inset)` with thin border). Backdrop is first `imagePaths[0]` via `previewUrlForPath` with `onError` hide fallback, or neutral graded plate labelled "B-roll chosen at render time" / "No images in pool" for Auto B-roll / empty pool. Filter/tint/vignette layered per `PreviewStage:84-105` pattern. No Remotion, no animation.

### 4.4 Sheet Player (real)

`src/features/automation/TemplatePreviewPlayer.tsx` — builds a synthetic one-scene `VideoProject` (`shared/video-engine/model.ts:232-249`, `createEmptyVideoProject:391-422` pattern) with canvas from `aspectRatio` (9:16→1080×1920, 1:1→1080×1080, 16:9→1920×1080, fps 30, duration 90), one image asset/scene if pool has image, canned caption words via `createCaptionDocument` (`captions.ts:133-147`), `automationCaptionChoice` + `automationRemotionHookPlan` for hook/caption wiring, `grading: automationRemotionGrade(...)`. Rewrites `file:` URIs via `projectForPlayer()` (`assetUrl.ts:51-61`). Lazy-loads `RemotionVideo` (`video-engine/remotion/composition.tsx:76`) inside `@remotion/player` `Player` (`RemotionPreview.tsx:62-74` pattern), wrapped with same grade CSS. Loads manifests via existing `window.api.videoEngine.templates()` IPC. Has error boundary falling to neutral plate + caveat. Respects `prefers-reduced-motion` (paused by default).

### 4.5 Deletions

Delete `src/features/automation/AnimatedThumb/` (GradeThumb, CaptionThumb, HookThumb, TransitionThumb, index.tsx). Transition drops to text everywhere it matters: `MachineCard` already prints `preset.label` (`MachineCard.tsx:74`), sheet has labelled buttons + duration slider (`TemplateSheet.tsx:274-311`).

---

## 5. UI decisions

- Noir/Gold: preview tells truth — Noir renders as Cinematic, Gold as Heartfelt, so their previews are identical. No pipeline change; exposes existing mapping honestly.
- Aspect: sheet true aspect (capped), cards fixed 16:9 letterbox — honest without reflowing `MachineDeck.tsx:38` grid.
- Motion: caption words cycle (gated by `useReducedMotion`), hook static, transition not visualized beyond label. Player in sheet loops naturally; cards static.
- Auto B-roll: honest neutral plate, not faked footage. Exhaustive check found no sync local image, no bundled placeholder, no projectId-free B-roll IPC.

---

## 6. Data & IPC

- No new IPC. Reuses `window.api.videoEngine.templates()` and `window.api.videoEngine.gradingPresets()` patterns already in `useVideoStudio.ts:408` / `useEditor.ts:533`. Presets move to shared so no async load needed for grade; templates still need one async load for hook manifests (cached).
- No DB migration. No `VisualTemplate` change. No `NativeApi`/`preload` change.

---

## 7. Verification

- `npm run typecheck` + `npm run build`
- Unit tests on pure resolver: 6 chips (Noir≡Cinematic, Gold≡Heartfelt lock), caption per style, auto-hook variant palette, `VideoProjectSchema.safeParse` validity
- `automation-render-every-preset.test.ts` already covers `automationRemotionGrade` correctness
- Manual: `npm run userdata:backup` then `ME_SMOKE_USERDATA_DIR=$(mktemp -d) ME_SMOKE=m6 ... xvfb-run` per `AGENTS.md`

---

## 8. Risks

- Synthetic project must pass `VideoProjectSchema` superRefine (unique IDs, track/scene linkage, duration bounds). Mitigated by reusing `VideoProjectSchema.parse` and mirroring `automation-remotion.ts` shape.
- `hasValidHookPlan(scene)` gate (`scene.tsx:252-260`) could fall to `TrustedTemplateFallback` if plan malformed — verified by testing hook plan validity and having error boundary.
- Letterboxed portrait on cards may look sparse; cheap upgrade is blurred backdrop fill (not built speculatively).

---

## 9. Out of scope

B-roll fetching/listing, cron, template versioning, HyperFrames, render perf tuning, changing Noir/Gold pipeline mapping, new fonts (all 7 families already self-hosted in `src/main.tsx:4-26` and `video-engine/remotion/entry.tsx:1-18`).
