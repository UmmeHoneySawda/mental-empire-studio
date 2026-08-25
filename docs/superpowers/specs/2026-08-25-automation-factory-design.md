# Automation Factory — Design Spec

Date: 2026-08-25
Status: approved for implementation
Scope: `src/screens/Profiles.tsx` (Automations tab), `shared/types.ts` VisualTemplate/AutomationStyleConfig, `electron/db`, `electron/services/automation*`, `src/features/automation/*`, `shared/video-engine` template delegation.
Mode: Operate (factory floor + mission control, per DESIGN.md Control Room world)

---

## 1. Goal

Turn the Automations tab from three disconnected forms (`Batches → Templates → Run history` inside a single 1809-line `Profiles.tsx`) into a **factory floor**: templates are machines with readable animated blueprints, the feed is a single control bar that drafts the next lot, and the conveyor is a live lot tracker where you see `queued → transcribing → b-roll → rendering → done` with per-video recovery.

Requirements driving it:
- UI feels messy / broken: template cards are vague (`at-card-art at-grade-*` + aspect ratio `Profiles.tsx:925`), hook picker is a flat `PresetRow` list `Profiles.tsx:77` with no preview, run history cards are heavy (`automation-job-card` `Profiles.tsx:1032` + `JobDetails` `Profiles.tsx:86`), image pool (`AssetLibraryModal` + file picker `Profiles.tsx:1132`) doesn't match `MediaBin` polish.
- No previews for captions/transitions — and they must be **100% accurate animated thumbnails** (not static), rendered through the same Remotion layers Compose uses.
- Parity gap: Compose's Video Studio exposes 7 tool families (`EditorChrome` destinations + `EditorToolPanel:47-673` → Text & Motion, Transitions, Effects, Filters, Adjustments, Captions, Hooks, Media/B-roll) but `VisualTemplate` (`shared/types.ts:1298`) only carries `mode, imageDurationSec, density, order, motion, transition, grade, captionStyle, aspectRatio, hookLine, zoomAtStart, talkingPhoto, hookTemplateId/props, captionTemplateId/props`. Text overlays, Effects, Filters beyond 6 swatches, and Adjustments are absent; transition duration/join targeting is unmodelled.
- Vibe: A+B — factory conveyor that also auto-watches sources (manual batch + `SourceChannel.autoWatch` only for v1; no cron yet — per user pick).

Non-goal: no new visual world. This is **refinement** inside `DESIGN.md`'s Control Room (control-room-black, window-graphite, panel-charcoal, quiet-divider, signal-amber lamp, Space Grotesk / Hanken Grotesk / JetBrains Mono). No HyperFrames/Remotion render perf work — that phase is closed (`docs/RENDER-PERFORMANCE.md`).

Working truth: `src/features/video-studio/editor/EditorShell.tsx:31` + `EditorToolPanel.tsx` + `useEditor.ts:416 edit()` + `shared/video-engine/*` + `electron/services/video-engine/templates/*` own the Compose semantics. Automation never forks them.

---

## 2. Approach chosen

**Approach 2 — Factory Conveyor (recommended)**, over:
- *1 Polish in place* (fast but stays a form, doesn't fix vibe)
- *3 Unified project pipeline* (couples per-video `VideoProject` lifetime to per-lot `VisualTemplate`; risks `edit()` history/save chain).

Approach 2 keeps `VisualTemplate` as a **declarative style sheet** that maps 1:1 to `AutomationStyleConfig` (`shared/types.ts:451`) via `visualTemplateToStyleConfig` (`electron/services/automation/config.ts`). Every template mutation delegates to the same engine Compose calls — `videoEngine.templates`, `newCaptionDraftFromProps`, `newHookDraftFromProps`, `resolveTransitionPreset`, `GRADE_PRESETS`, `TRANSITION_PRESETS`.

---

## 3. Architecture

### 3.1 File topology

```
src/screens/Profiles.tsx                — thin orchestrator (tabs/anchors + data wiring only, <300 lines after split)
src/features/automation/
  MachineDeck.tsx                         — template gallery (replaces at-template-grid)
  MachineCard.tsx                         — blueprint card with animated thumbs + chips
  AnimatedThumb/
    CaptionThumb.tsx                      — 160×90 caption typing micro-loop
    TransitionThumb.tsx                   — 1.2s join scrub loop
    GradeThumb.tsx                        — LUT wash swatch (accurate)
    HookThumb.tsx                         — 2.5-3s hook loop
    index.tsx                             — shared canned media + Remotion layer mount helpers
  FeedBar.tsx                              — single sticky control bar (channel + sources + quantity + dry-run)
  Conveyor.tsx                             — live lot track (lanes + per-video chip + drawer)
  TemplateSheet.tsx                        — docked side sheet that imports Compose panels directly
  useAutomationDraft.ts                    — draft VisualTemplate state + validation (extracted from Profiles.tsx:521-562)
electron/services/automation/
  config.ts                               — visualTemplateToStyleConfig extended (new fields, compat fallbacks)
shared/types.ts                           — VisualTemplate extended (additive, optional)
shared/video-engine/
  new-templates.ts / template adapters    — reused verbatim; thumbs call same draft builders
```

### 3.2 Split rationale

`Profiles.tsx` currently owns channel selection, batch math (`drawCount` `Profiles.tsx:443`), template CRUD, 2-step wizard, animated preview-less pickers, and history — all in one component with 20+ `useState`/`useMemo`. Splitting along the three factory decks gives each unit one purpose, one props contract, and one test surface. `useAutomationDraft` owns the unsaved draft + its `wizardStep`/`templateError`/`templateSaving` lifecycle (`Profiles.tsx:158-162`, `499-562`) so the sheet is presentational.

### 3.3 Delegation contract (no drift)

```
VisualTemplate (UI) → AutomationStyleConfig (canonical, whitelist-normalized) → VideoProject patch
        │                         │                                    │
        └─ shared/video-engine ───┘                                    └─ useEditor.edit(ops.*) / engine IPC
```

- `hookTemplateId`/`hookProps`/`hookSeconds` and `captionTemplateId`/`captionProps` already flow through `newHookDraftFromProps` / `newCaptionDraftFromProps` (`Profiles.tsx:255`). Animated thumbs call the same builders with canned headline/cue strings.
- Grade / transition / motion use `GRADE_PRESETS`, `TRANSITION_PRESETS`, `resolveTransitionPreset` imported directly — not copied constants.
- New fields (see §4) are carried through `normalizeAutomationStyle`'s whitelist explicitly; an omitted key fails loudly rather than falling back silently — the same discipline that justified making `hookText/hookEnabled/hookTemplateId/hookProps/hookSeconds/captionTemplateId/captionProps` required-with-sentinel in `AutomationStyleConfig` (`shared/types.ts:472-500`).

### 3.4 Data & IPC

- Reads: `window.api.videoEngine.templates({rendererId:'remotion'})` (`Profiles.tsx:329`), `window.api.sources.*`, `window.api.visualTemplates.list()`, `window.api.automation.jobs`.
- Writes: `window.api.visualTemplates.save(template)` / `delete(id)`, `window.api.batch.launch(input)` (`shared/types.ts:1360`), `window.api.assets.import` + `list` for image pool, `window.api.automation.job(id)` for drawer.
- DB: `electron/db/index.ts` — additive migration with `ensureColumn` for each new JSON field on `visual_templates.data` and `visual_templates` column additions where queryable. Legacy rows coerce via `asBetaOpts`-style defaults; new fields optional with safe fallbacks so old cards still render.

---

## 4. Data model — VisualTemplate expansion (additive, optional)

Existing `VisualTemplate` (`shared/types.ts:1298`) keeps all current fields. Additions — all optional, ignored if absent — so batches launched from legacy presets still render via today's defaults:

```ts
VisualTemplate {
  // existing: id, name, mode, imagePaths, imageDurationSec, density, order, motion,
  //           transition, grade, captionStyle, aspectRatio, hookLine, zoomAtStart,
  //           hookTemplateId, hookProps, hookSeconds, captionTemplateId, captionProps, talkingPhoto

  // NEW — filters/adjust pass-through (filters = grade preset id, adjust = parametric overrides)
  filterPresetId?: string          // e.g. 'neutral' | 'punch' | 'teal-orange' | ... (GRADE_PRESETS ids)
  adjust?: VideoGrading            // exposure/contrast/saturation/temperature/tint/vignette/grain (same shape EditorToolPanel uses)

  // NEW — effects/scrim
  effectsPresetIds?: string[]     // e.g. ['vignette-boost','grain-heavy'] subset — applied additively on grade
  scrim?: { enabled: boolean; direction: 'bottom'|'top'|'left'|'right'; size: number; opacity: number }
                                   // mirrors BackgroundLayer.scrim DEFAULT_SCRIM shape

  // NEW — transition cadence (refines the existing `transition` id)
  transitionDurationFrames?: number // 3..90, default from TRANSITION_PRESETS entry; replaces hidden assumption

  // NEW — text overlays (Compose-only before; now template-able, still rendered engine-side as text scenes)
  textOverlays?: Array<{ id: string; text: string; preset: string; animation?: string; at: 'hook'|'persistent' }>

  // NEW — image/B-roll refinements that Compose already models
  imageShuffleLocked?: boolean      // explicit for per-batch determinism; default from order==='Shuffle'
}
```

Mapping to `AutomationStyleConfig`:
- `filterPresetId` / `adjust` → `styleConfig` grade branch (`VideoGrading`) — the batch's `edit` step writes `project.grading = buildGrading(...)` via `operations.setGrading`, same path `AdjustToolPanel` uses.
- `effectsPresetIds` → additive `patch` merges on `VideoGrading` before `setGrading`.
- `scrim` → `BetaVideoOpts.overlay` mapping (`overlay.bottom/top/left/right + intensity`), already honored by render.
- `transitionDurationFrames` → `AutomationStyleConfig.crossfadeSec` / transition `durationFrames` (deduped source).
- `textOverlays` → extra `template` scenes inserted at `importHookPlan` / `instantiateTemplate` time, using same `TEXT_PRESETS` + `TEXT_ANIMATIONS`.

Validation: `handleSaveTemplate` (`Profiles.tsx:522`) gains per-field guards mirroring existing ones (e.g. adjust ranges, text length, duration bounds). The doc enforces: no field is added to `VisualTemplate` before `visualTemplateToStyleConfig` + Supervisor `automation-remotion.ts` can honour it — prevents the diagnosed F4 "13 opaque JSON fields no consumer read" regression.

---

## 5. UI — the three decks (Operate)

All decks use existing tokens/components: `ScreenPad`, `SectionLabel`, `Btn`, `Banner`, `Chip`, `Banner`, `ConfirmDialog`, `EmptyState`, `StatusPill`, `Progress`, `Card`, plus `MediaBin` and the Compose tool panels. No raw hex, no new radius.

### 5.1 Deck 1 — Machines (replaces Templates tab grid `Profiles.tsx:922-980`)

- Grid: `repeat(auto-fill, minmax(280px, 1fr))` inside `ScreenPad` outer padding (32px → 16px at 1100w). Cards use `panel-charcoal` / `quiet-divider` / `rounded.lg` / `shadow-card` (DESIGN.md).
- Each `MachineCard`:
  - Header: 16:9 art well (`panel → inset` depth) showing **three animated thumbs in a triptych**: left `GradeThumb` (LUT wash), center `CaptionThumb` micro-loop (typed cue), right `TransitionThumb` (join scrub). Shared heading keeps card scannable without opening it.
  - Body: `h3` name (Hanken title 600), one-line meta (`mono` `density · order · motion · transition label · aspectRatio · grade`) — replaces `at-card-meta` string soup `Profiles.tsx:938`. Chips: `captionStyle`, `hookTemplateId` (short label), `filterPresetId` when present.
  - Footer: `Edit · Duplicate · Delete` ghost row (identical affordance to today `Profiles.tsx:958`, but consistently left-aligned).
  - "Create a production template" remains a card with dashed quiet border + `+` mark (operational, not marketing).
- Empty: teaches — "Production templates define format, captions, motion, hook and visual treatment for every batch. Filter/Adjust/Effects/Text included — Compose owns the rendering." with `Create template` CTA.

### 5.2 Feed bar (replaces Batches' two-panel `at-screen-grid` + `at-flow-panel` stack `Profiles.tsx:663-904`)

- Single sticky bar (`position: sticky; top: 0; z-index: 2; background: window-graphite; border-bottom: 1px solid quiet-divider; shadow-pop when stuck`). Inside: two rows at `>=820px`, stacked at narrow.
- Row 1: **Publishing channel pills** (radio group) — `avatar + name + handle`, selected uses `signal-amber-soft` fill + `soft` border — same as `NavItem` active state. To the right: **linked sources** as toggle chips with `✓` and `cachedVideoCount` count; `linkedSources.length===0` shows inline guidance + `Link a source` (routes to `channels` via `setActive('channels')` — preserves existing `setupBlocker` copy `Profiles.tsx:446-478`).
- Row 2: **Quantity** — stepper (`−` / `N` / `+` `at-quantity` `Profiles.tsx:759`) + quick `1 · 3 · 5 · 10` chips (`at-scale-btns`) + `of N available` (`unpublishedAvailable` from `sources.unpublishedCount` `Profiles.tsx:425`). To the right: **dry-run preview** — first 4 of the `drawCount` titles ("Next unpublished video …" `Profiles.tsx:788`) with count overflow `+N more`; `canLaunch` gate unchanged (`drawCount>0 && activeSourceIds.length && selectedChannelId && selectedTemplate` `Profiles.tsx:445`). CTA `Start N-video batch` (`at-launch-btn` `Profiles.tsx:891`) + summary chips (`Publishing channel · Videos · Template · Output · Captions`).
- No second column, no "setupBlocker stage 2/3" full-panel block — blockers are inline `Banner kind=info` inside the bar, so the bar is always visible and the fallback route remains navigable.

### 5.3 Conveyor (replaces Run history card stack `Profiles.tsx:986-1067`)

- A vertical stack of **lot lanes**, each lane a compact row (not a heavy card): left rail holds the printed mark (`tp-mark` `rest|queued|submitted|active|done|void` per DESIGN.md), center holds lane name + lane progress (2px `Progress` in `quiet-divider` track, accent fill for active / emerald for completed / crimson for failed), right holds `mono` ETA (`jobEta` `Profiles.tsx:35`) + counts (`completedCount/totalItems` + `warningCount`/`failedCount`) + actions.
- Actions: `View details` toggles an inline drawer (existing `JobDetails` `Profiles.tsx:86` content: `automation-job-metrics` + `automation-checkpoint-grid` + `automation-item-row` per-item strip + `Understandable log` tail), `Pause/Resume/Retry/Cancel/Delete` via `runJobAction` (`Profiles.tsx:370`) with pending opacity `0.7`. `JobStatus` pill (`Profiles.tsx:58`) retained for status, but hue is reinforcement — position/strike of `tp-mark` carries meaning (Shape-First State Rule).
- Live strip (`automation-live-strip` `Profiles.tsx:1012`) promoted to a lane-top summary: `LIVE · currentStep · ETA` with amber pulse (honors `prefers-reduced-motion`).
- Empty: existing copy preserved (`EmptyState` title "No automation runs yet" `Profiles.tsx:1019`) with `Create a batch` → focus Feed bar.

### 5.4 Template sheet (replaces 2-step modal `Profiles.tsx:1074-1767`)

- A right-docked **sheet** (`role=dialog` when open, focus trap, Escape → restore opener, backdrop click → close via `onMouseDown===currentTarget` `Profiles.tsx:1076`) that is **not** a tall modal over content — it overlays 40-50% of width at desktop, full-width sheet at <820px (sidebar becomes rail per DESIGN.md).
- Sheet body **imports Compose panels directly** — not re-implementations:
  - `TransitionsToolPanel` (grid + duration + `Apply to all` boolean) via extracted variant that accepts `value: string` / `onChange(id)` plus optional `durationFrames` prop from `transitionDurationFrames`.
  - `FiltersToolPanel` + `AdjustToolPanel` for `filterPresetId` + `adjust`.
  - `EffectsToolPanel` for `effectsPresetIds`/`scrim`.
  - Caption/Cinematic pickers — retains `classicCaptionTemplates`/`cinematicCaptionTemplates` split `Profiles.tsx:240-246` but each `PresetRow` now has an `AnimatedThumb` + `active` accent edge + accented/ grain metadata badge.
  - Hook picker — same `classicHookTemplates`/`cinematicHookTemplates` split `Profiles.tsx:262-273` + `Automatic` sentinel row `Profiles.tsx:1552`, each with animated `HookThumb` (headline fallthrough copy: `hookLine || 'FIRST LINE OF THE TRANSCRIPT'` `Profiles.tsx:1721`) and per-template field disclosures only when a cinematic hook is active (`cinematicHookDefinition` `Profiles.tsx:276`).
  - Image pool — **embeds `MediaBin`** directly (same filter/import/cycle controls Compose shows), not the bolted-on file input `Profiles.tsx:1148` + `AssetLibraryModal` divergent flow. `AssetLibrary` fetch still serves `AssetLibraryModal` when needed, but `MediaBin` is canonical.
  - TalkingPhoto casting slab (`Profiles.tsx:1304`) retained verbatim as an inset card (`border: quiet-divider` / `panel` over `inset`), reusing its `tpCatalog/tpCharacters/tpMotions` reads and `planSplit` cost shape hint `Profiles.tsx:1394`.
- Sheet footer: `Cancel` (ghost), `Save template` (primary, `templateSaving` `Profiles.tsx:161` busy) — discard of `wizardStep` 0/1 rail. Validation reuses `handleSaveTemplate` guards (`Profiles.tsx:522-562`) extended for new fields; errors render in a `Banner kind=error` at sheet top (`templateError` `Profiles.tsx:1745`).
- Sheet is scrollable (`ed-scroll` pattern), inspector-body style (consistent with `Inspector` `EditorShell.tsx:263` `key={inspectorTab}` remount).

### 5.5 Animated thumbs — fidelity contract

- Each thumb component mounts the **same** Remotion layer key Compose uses: `NewCaptionLayer`, `NewHookScene`, `Transition` preset component, `GRADE_PRESETS` LUT overlay. Props come through the canonical draft builders (`newCaptionDraftFromProps`, `newHookDraftFromProps`) with bounded, sensible defaults (e.g. caption sample cue "still paying *rent* in your head", hook sample "FIRST LINE OF THE TRANSCRIPT", footage-backed hooks fed by a data-URI still of `1×1` when no real asset). Loops are `requestAnimationFrame` or short Remotion compositions at `8-12fps` with `prefers-reduced-motion` freeze on first frame.
- Sizing: `160×90` box, `rounded.sm` (8px), `quiet-divider` border, `inset-charcoal` surround. Hover pauses loop (invert for reduced-motion: pause by default, scrub on focus).
- Failure modes: if registry empty (`classic+cinematic ===0` `Profiles.tsx:1424`), picker shows existing `at-preset-empty` banner, thumbs not mounted.

---

## 6. Behaviour & state

- Channel selection: unchanged — `selectedChannelId` `Profiles.tsx:209` defaults to first `myChannels`, updates on mount via `useEffect` `Profiles.tsx:394`, persisted implicitly by being draft state of the feed. `linkedSources` memoized via `s.linkedMyChannelId || s.id===ch.linkedSourceId` `Profiles.tsx:404`. `activeSourceIds` toggles aria-pressed chip `Profiles.tsx:726`. Count clamped via `sources.unpublishedCount` + `drawCount = min(batchCount, unpublishedAvailable)` `Profiles.tsx:443`.
- Template selection: `selectedTemplateId` `Profiles.tsx:212` defaults to `tpl-dark-stoic` then first-available; picker in Feed bar is a compact grid of `MachineCard` miniatures (same triptych, smaller) — selection is the same state.
- Launch: `canLaunch` `Profiles.tsx:445` + `handleSendToRender` `Profiles.tsx:591` verbatim — `window.api.batch.launch({channelId, sourceIds, count: drawCount, templateId})`, toast via `showToast` `Profiles.tsx:216` (3000ms timer), switch to Conveyor tab/anchor and reload jobs. Preflight blocker joins stay verbatim (`diag-automation F3` note `Profiles.tsx:605`).
- Jobs polling: same `loadAutomationJobs` + `expanded` detail refresh `Profiles.tsx:338-347`, same `runJobAction` guarded pending map `Profiles.tsx:370`. Only presentation changes (lanes vs cards); the data contract (`AutomationJob/AutomationJobDetail/AutomationWorkflowStep/AutomationJobItem/AutomationJobLog` `shared/types.ts:540-636`) is untouched — so the Supervisor path stays trivially compatible.
- Image pick: `handlePickTemplateImages` channel-contexted asset import `Profiles.tsx:171` retained but promoted to delegate to `MediaBin` flow; canonical-path dedup `Array.from(new Set([...existing, ...canonicals]))` preserved.
- TalkingPhotos hook: same `useTalkingPhotos` catalog/motions `Profiles.tsx:144-150` re-read, `planSplit` 10-min sample `Profiles.tsx:488`.

---

## 7. Error, empty, and edge handling (Operate completeness)

- Every interactive component spells all seven states: default / hover / focus / active / disabled / loading / error — per `reference/operate.md` Components. `Banner` (inline, live-region) is the only error surface; no native `alert/confirm`. `ConfirmDialog` is sole destructive pattern (`templateToDelete` `Profiles.tsx:157`, `jobToDelete` `Profiles.tsx:229`) with Cancel-first focus, Escape/backdrop close.
- Empty lanes each teach: Machines ("Create a production template"), Feed ("Add a publishing channel" → `channels`, "Link a source" → `channels`, "No unpublished videos" → `sources` — same copy `Profiles.tsx:446-478`), Conveyor ("No runs yet" `Profiles.tsx:1019`).
- Loading: `automationJobs` / `visualTemplates` skeletons (list shimmer, not central spinner), `brollSearching` style shimmer reused for thumb init. `toastMessage` `Profiles.tsx:158` single-slot, `aria-live=polite` `Profiles.tsx:1805`.
- Failures: render/b-roll errors surface in `JobStatus` + per-item `error/warning` strip (`Profiles.tsx:116`), never suppressed; `retry` dispatches `retryAutomationJob` `Profiles.tsx:137`. Disk/space preflight uses `AutomationPreflight` blockers/warnings `shared/types.ts:638` near the batch CTA.
- A11y: one `h1` Automations (heading rule), `role=tablist` only if anchors kept, `aria-pressed` on channel/source/template chips already present `Profiles.tsx:728`, `aria-valuenow` on lane progress bars `Profiles.tsx:1046`, focus visible, keyboard-only path for all toggles.

---

## 8. Visual craft floor (impeccable)

- **Palette:** no new hues. Surfaces: `control-room-black → window-graphite → panel-charcoal → inset-charcoal` tonal ladder + `quiet-divider` borders. Accent: user-selected `signal-amber` (or violet/emerald/crimson) only on primary CTA, selected chips (`chip-active`), `tp-mark` active pulse, lane progress fill. Status hues (emerald/crimson/amber/blue) are fixed but never sole signal — `tp-mark` shape + strike carries it.
- **Type:** Space Grotesk only for `h1`/`h2` deck titles; Hanken for body/labels/controls; JetBrains Mono for counts/ETAs/ids/percentages. No Anton/Montserrat/Cinzel in chrome — those belong to rendered media.
- **Spacing:** 4-48px scale, page pad 32px (16px at narrow), card pad 16px, grid gaps 12px, rail gaps 8px.
- **Shape/radius:** `sm 8px / input 9px / md 10px / lg 14px / pill 999px` only. Lanes and cards `rounded.lg`, chips/ETAs `rounded.pill`, controls `rounded.md`.
- **Elevation:** tonal first. Cards `shadow-card`, sticky feed bar + template sheet + toasts `shadow-pop` when elevated, `shadow-glow` only on the one focused/primary element.
- **Motion:** state-revealing only — drawer slide + progress fill at 180-220ms, thumb loops at low FPS, all honour `prefers-reduced-motion` (loops freeze, lane pulse stops).
- **Density:** Operate-dense, not marketing-breaths. Tables/lanes at compact 12px body, 11px labels — readable at arm's length for a video operator.

---

## 9. Files — new vs modified

New:
1. `src/features/automation/MachineDeck.tsx`
2. `src/features/automation/MachineCard.tsx`
3. `src/features/automation/AnimatedThumb/*` (4 loop components + index)
4. `src/features/automation/FeedBar.tsx`
5. `src/features/automation/Conveyor.tsx`
6. `src/features/automation/TemplateSheet.tsx`
7. `src/features/automation/useAutomationDraft.ts`
8. `src/features/automation/tokens.css` (if needed — appended to screen CSS, not a new world)

Modified, minimally and additively:
1. `src/screens/Profiles.tsx` — orchestrator split, same data wiring, no store shape change
2. `shared/types.ts` — `VisualTemplate` additions (optional, additive), `AutomationStyleConfig` propagation docs
3. `electron/services/automation/config.ts` — extend `visualTemplateToStyleConfig` for new fields (additive, legacy-safe)
4. `electron/db/index.ts` — `ensureColumn` migrations for new template fields
5. `src/features/video-studio/editor/EditorToolPanel.tsx` — extract filter/adjust/transition sub-panels to be prop-driven (no copy-paste) so the sheet can import them
6. CSS — append `profiles-factory.css` or extend existing `profiles.css` tokens for decks/lanes/sheet (no token drift)

---

## 10. Verification

- **Type:** `npm run typecheck` — `VisualTemplate` optionality preserves all call sites; `visualTemplateToStyleConfig` whitelist updated.
- **Build:** `npm run build` — Electron + Vite both compile; no `electron-vite` shim regression (see `electron-vite-build-trap` skill).
- **Unit:** extend existing `test/unit/video-engine/new-templates.test.ts` + `test/unit/automation/*` preflight mirrors for new fields (e.g. capped `imageDurationSec`, grade/adjust fallback). New test: `visualTemplateToStyleConfig` maps each new field and ignores unknown keys.
- **Smokes (throwaway userData only):** `ME_SMOKE_USERDATA_DIR=$(mktemp -d) ME_SMOKE=1` / `m6` etc with `ME_SMOKE_USERDATA_DIR` enforced by `electron/services/smokeSafety.ts`. Validate Machines deck renders, template sheet saves/round-trips legacy row, Feed bar clamps `drawCount`, Conveyor lanes poll and retry.
- **Read-only safety:** `npm run userdata:backup` before any launch that migrates DB.
- **Render perf:** no change to `docs/RENDER-PERFORMANCE.md` baseline; `video-engine/remotion` dispatch paths untouched except via already-approved style knobs.

---

## 11. Out of scope

Cron/scheduled frequency picker, template versioning/history, cross-project effect graph, HyperFrames renderer, any perf tuning beyond parity. TalkingPhotos remains an unnumbered sibling in nav, not a 6th factory stage.

---

## 12. Implementation order

1. Extract `useAutomationDraft` + split `Profiles.tsx` scaffolding (no visual change, typecheck-clean).
2. Extend `VisualTemplate` + `visualTemplateToStyleConfig` + DB migration (legacy-safe).
3. Build `AnimatedThumb` components (call `shared/video-engine` draft builders, canned media, low-FPS loops).
4. Replace Templates grid → `MachineDeck/MachineCard` (animated triptych).
5. Replace wizard modal → `TemplateSheet` importing Compose panels prop-direct.
6. Collapse Batches panels → `FeedBar` sticky control bar + dry-run.
7. Replace history cards → `Conveyor` lanes + drawer (same `JobDetails` content).
8. Image pool → embed `MediaBin` (file picker path kept as fallback).
9. Unit + smoke coverage, `npm run typecheck && npm run build`, userData backup discipline.
