# Handoff Spec — Talking Video (redesigned flow)

Developer handoff for the redesigned Talking Video screen. Built from the clickable
mockup and the app's real design system. **Stack:** Electron + React + TypeScript,
**custom CSS design tokens** (`src/theme/tokens.css` + `src/theme/global.css`) and an
in-house component kit (`src/components/ui/kit.tsx`) — **no Tailwind, no CSS-in-JS**.
Reference **tokens, not raw hex**, throughout.

> Planning artifact — implement per the phase plan; nothing here changes backend.
> The screen is **fixed dark, single-theme** (production has no light theme) — do not
> add a light variant.

---

## 0. Where everything lives (source of truth)

| Artifact | Location |
|---|---|
| **Clickable mockup (this design)** | Artifact URL: `https://claude.ai/code/artifact/bd6bad76-ee08-43c6-b111-03267c7fdcab` |
| **Mockup source (in repo)** | `docs/design/talking-video-mockup.html` (standalone HTML; open in browser; fonts fall back to system-ui — production uses `@fontsource/*`) |
| **This handoff** | `docs/TALKING_VIDEO_HANDOFF.md` |
| **UX findings + design plan** | `docs/TALKING_VIDEO_UX_PLAN.md` |
| **Phased redesign / gap plan** | `docs/TALKING_VIDEO_REDESIGN.md` |
| Passive-capture mining report | `docs/trace-mining/EXPRESS-SESSION-AGENT-REPORT.md` |
| Live-session validation report | `docs/trace-mining/LIVE-SESSION-REPORT.md` |
| Real API request/response bodies (16) | `docs/trace-mining/api-bodies-live/s1-*.json` |
| Trace Viewer evidence screenshots | `docs/trace-mining/evidence/tv-*.jpeg` |
| HAR integration contract | `docs/TALKINGPHOTOS-HAR-CONTRACT.md` |
| Trace extraction scripts | `scripts/extract-playwright-trace.mjs`, `scripts/_api-schemas.mjs`, `scripts/_inspect-network.mjs`, `scripts/_scan-pii.mjs` |
| Current screen being replaced | `src/screens/TalkingVideo.tsx` |
| Renderer store | `src/store/useTalkingPhotos.ts` |
| Domain types + pure helpers | `shared/talkingphotos.ts` |
| IPC surface / NativeApi | `electron/ipc/talkingphotos.ts`, `shared/types.ts` |
| Cross-session memory pointer | `~/.claude/projects/D--Work-mental-empire-studio/memory/talking-video-redesign-plan.md` |
| Branch | `build/mental-empire-studio` |

---

## 1. Overview

The screen lets a user create an AI "talking video" (a generated presenter speaking a
script or uploaded audio) and manage the videos they've made. The redesign replaces a
dense single-page form with a **3-step guided Create flow + a live preview**, a
**first-class progress/result experience**, and a **visual Library gallery**. Audience
skews **non-technical creators**, so copy is plain and jargon is removed (see the copy
table in `TALKING_VIDEO_UX_PLAN.md` §13).

Two top-level views behind a segmented control: **Create** (default when the Library is
empty) and **Library** (default when videos exist). Everything gates behind
`settings.integrations.talkingPhotos.enabled` and a `connected` connection status.

---

## 2. Layout & grid

Container-query driven (the screen sits in a resizable Electron pane — use
`container-type: inline-size` on the shell, **not** viewport media queries).

| Region | Spec |
|---|---|
| Shell | `flex column`; top bar (fixed) + scrollable body |
| Top bar | `flex`, `align-items:center`, `gap 16px`, padding `14px 22px`, `border-bottom 1px --border` |
| View padding | `26px 28px 34px` |
| **Create grid** | `grid-template-columns: 200px minmax(0,1fr) 300px; gap 22px; align-items:start` — rail / step / preview |
| Rail & preview | `position: sticky; top: 0` |
| **Library gallery** | `grid; repeat(auto-fill, minmax(230px, 1fr)); gap 16px` |

**Breakpoints (container width):**
| Width | Change |
|---|---|
| `> 900px` | full 3-column Create layout |
| `≤ 900px` | Create collapses to single column (rail → horizontal step chips on top; preview moves below the step or into a collapsible "Preview" drawer) |
| `≤ 560px` | choice-card rows go single-column; chip groups wrap |

There is **no spacing/radius token scale** in the app today — match the existing `.tp-*`
block conventions in `global.css` (cards `border-radius 14px`, inputs `8px`, section
padding `18px`). Optionally introduce `--radius`/`--radius-sm` + a spacing scale as a
small refactor; if so, do it in `tokens.css` and use everywhere.

---

## 3. Design tokens used (from `src/theme/tokens.css` — do not hardcode)

| Token | Value | Usage in this screen |
|---|---|---|
| `--bg-page` | `#070809` | screen ground |
| `--bg-window` | `#0d0f14` | top bar |
| `--bg-card` | `#12151b` | cards, choice cards, preview, modal |
| `--bg-inset` | `#0e1116` | inputs, thumbnails, frame, icon buttons |
| `--border` | `#1d2129` | hairlines, dividers |
| `--border-2` | `#23272f` | input/card borders (default) |
| `--border-3` | `#262b34` | hover borders, dashed dropzones |
| `--text-strong` | `#f4f6f9` | headings, values |
| `--text-bright` | `#eef0f3` | button/label text |
| `--text-muted` | `#8a909c` | body/help text |
| `--text-dim` | `#6a7180` | secondary/meta |
| `--text-faint` | `#5b616f` | timestamps, placeholders |
| `--accent` | `#f5b323` | primary CTA, progress fill, selected state, active step, AI-Video badge |
| `--accent-deep` | `#b9780a` | progress gradient start |
| `--accent-soft` | `rgba(245,179,35,.13)` | selected chip bg, current-step bg, focus glow |
| `--accent-ink` | `#15120a` | text on amber buttons |
| `--ok-2` | `#4fd6a0` | Ready/success, captions-on, done step, Captioned badge |
| `--err` | `#ff5a6e` | Delete, failed, invalid field |
| `--font-display` | Space Grotesk | view/step titles, card titles, modal titles |
| `--font-body` | Hanken Grotesk | everything else |
| `--font-mono` | JetBrains Mono | numbers, %, ETA, timestamps, step numerals |

**Semantic ≠ accent:** status colors (`--ok-2` good, `--accent`/`--warn` in-progress,
`--err` failed) are separate from the amber accent. **Badge tints** are low-alpha pills:
AI Video = accent 18%, Merged = borrow the app's Violet accent `#8b7cff` @14%, Captioned
= `--ok-2` @15%. Text solid, bg faint, so they stay quiet.

---

## 4. Typography scale

| Role | Family | Size / weight | Notes |
|---|---|---|---|
| View title ("Your videos") | display | 20px / 600 | `letter-spacing:-.3px`, `text-wrap:balance` |
| Step title ("Who's the presenter?") | display | 20px / 600 | `text-wrap:balance` |
| Card / make title | display | 13–13.5px / 600 | truncate 1 line |
| Eyebrow ("CREATE", "LIVE PREVIEW") | body | 10.5px / 600 | uppercase, `letter-spacing .07–.09em`, `--accent` or `--text-faint` |
| Body / help | body | 12.5px / 400 | `--text-muted`, line-height 1.55, max width ~52ch |
| Label | body | 11.5px / 500 | `--text-muted` |
| Input text | body | 13px / 400 | `--text-strong` |
| Numbers (%, ETA, count, time) | mono | 10.5–12px | `font-variant-numeric: tabular-nums` |

---

## 5. Components

Reuse the in-house kit; add the new components below. **Recommended additive libs
(headless/a11y only, skinned with tokens):** `@radix-ui/react-{dialog,dropdown-menu,
tooltip,popover,tabs}` and `lucide-react` for icons. Native `<video>` for playback. No
visual UI kit (shadcn/MUI) — it would fracture the identity.

| Component | New / reuse | Library | Notes |
|---|---|---|---|
| `TopBar` + view tabs | new + reuse `Seg` pattern | Radix Tabs (optional) | segmented Create/Library; account chip on right |
| `AccountChip` + menu | new | Radix DropdownMenu | ● dot + name; menu: Refresh / Open TalkingPhotos / Disconnect |
| `WizardRail` | new | — | vertical stepper; items are `<button>`; states current/done/todo |
| `ChoiceCard` | new | — | big option (source mode, aspect, style); `.selected` ring |
| `ChipGroup` / `Chip` | reuse/extend `Chip` | — | single-select look chips (gender/age/style/mood) |
| `Field` + `TextInput`/`Textarea` | reuse `Field`, `ed-input` | — | label + control + hint/error |
| `MorePanel` (disclosure) | reuse `Section` | — | "More options" collapse |
| `VoicePicker` | new | Radix Popover | language + voice search + mood chips + sample ▶ |
| `SliderRow` (speed/pitch) | reuse `SliderRow` | — | 0–100 scale, 50 = normal |
| `PresenterStudio` | new | — | prompt + look chips + Generate + inline preview/progress |
| `Dropzone` | reuse `FileDropField` | — | optional photo / audio upload |
| `MotionPicker` | new | — | horizontal scroll strip, hover-to-play `videoUrl`; combobox fallback |
| `Switch` (captions) | reuse `Switch` | — | role="switch" |
| `LivePreviewPanel` | new | — | aspect frame + summary + quota + CTA |
| `LiveJob` (make card) | new | — | progress bar + %+ETA + status → resolves to player |
| `VideoCard` | new | — | thumb + badge + title + time + actions |
| `LibraryToolbar` | new | Radix DropdownMenu (filter) | search + filter + Create |
| `Pagination` | new | — | numbered pager |
| `ConfirmDialog` | new | **Radix Dialog** | delete confirm (focus trap) |
| `Toast` | new | — | transient confirmation |
| `Btn`, `StatusPill`, `EmptyState`, `Banner`, `Meter`, `Combobox` | reuse | — | existing kit |

---

## 6. Create flow — field-level spec

### Step 1 — "What should they say?"
| Element | Spec / copy | Validation |
|---|---|---|
| Source `ChoiceCard`s | ① **Write a script** *(we'll voice it)* — default. ② **Use my own audio** *(upload a recording)*. | one required |
| `Name this video` | TextInput, placeholder `e.g. Weekly update…` | required, non-empty, trim |
| `Script` (script mode) | Textarea, min-height 88px, placeholder `What should your presenter say?…` | required; **char limit from `capabilities` mapped to seconds**; hint `~12 sec · 171 / 5,000 characters`; warn tone at >85%, error over limit |
| Voice summary + `Change ⌄` | shows default (`English (US) · Nancy — warm`); opens `VoicePicker` | — |
| From your library / upload (audio mode) | `Combobox` (downloaded audio) + `FileDropField`; show filename + duration | required (one) |
| **More options** | Mood `ChipGroup` (Neutral/Excited/Serious/Friendly/Unfriendly → `voiceStyle`/`ttsEmotion`); Speed + Pitch `SliderRow` 0–100 (50 normal) | — |

### Step 2 — "Who's the presenter?" (prompt-first)
| Element | Spec / copy | Validation |
|---|---|---|
| `Describe your presenter` | Textarea (64px), example chips: `Studio host` / `In a suit` / `Home-office creator` | required (unless a photo is uploaded) |
| Look `ChipGroup`s | Gender (Woman/Man) · Age (Young/Adult/Senior) · Style (Realistic/Anime/Cartoon) · Beard (only when Man) | defaults preselected |
| `✨ Generate` | primary; runs `create_image_from_prompt` → live progress → image | at least one generate before continue *(soft)* |
| **More options** | "Upload a photo instead" `FileDropField` (optional driving image); "Things to avoid" (`characterNegativePrompt`); Ethnicity | — |

> **Backend dep (G19):** prompt-only presenter needs `characterImagePath` made optional
> in `reqCreateInput`. Until then, Step 2 keeps upload as the required path and labels
> Generate "coming soon".

### Step 3 — "Format & finish"
| Element | Spec / copy | Maps to |
|---|---|---|
| Where will you post it? | 3 `ChoiceCard`s w/ frame glyph: **YouTube & landscape** (16:9) · **Shorts, Reels & TikTok** (9:16, default) · **Square** (1:1) | `aspectRatio` |
| Look & quality | 3 `ChoiceCard`s: **Close-up** *(tight talking-head)* · **Standard** *(more movement)* · **High quality** *(best detail, shorter clips — Recommended)* | `style` (`close_up`/`normal`/`high_quality`) |
| Movement style | `MotionPicker` — **only shown when Standard**; default preselected | `motionId` |
| Add captions | `Switch` on/off; engine auto-picked, language = voice language | `subtitleMode` |
| Create video | primary CTA (also sticky in preview panel) | submit |

### Live preview panel (right, sticky)
Aspect frame (transitions `aspect-ratio` .25s) showing the generated presenter (or a
friendly placeholder); summary lines (Script / Voice / Format / Captions);
`You can make N more videos today`; primary **Create video**. If blocked, replace the
quota line with the specific reason and focus the first incomplete step on click.

---

## 7. States & interactions

| Element | State | Behavior |
|---|---|---|
| `ChoiceCard` | default | `border --border-2`, `bg --bg-card` |
| | hover | `border --border-3`, `translateY(-1px)` |
| | selected | `border --accent`, amber-tint gradient bg, icon → accent |
| `Chip` | selected | `bg --accent-soft`, `border --accent`, text `--accent` |
| `Btn.primary` | default/hover/active | amber; hover `brightness(1.06)`; active `scale(.97)` |
| | disabled | `opacity .5`, no filter, `cursor not-allowed` |
| Any input | focus | `outline 2px --accent, offset 1px`, `border --accent` |
| Field | invalid | `border --err` + `box-shadow 0 0 0 3px rgba(255,90,110,.12)`; error text w/ alert icon below (`role="alert"`) |
| `✨ Generate` | busy | thumb shimmer, label "Creating your presenter… ~20s", button "Generating…" disabled |
| | done | image cross-fades in, button → "↻ Regenerate", preview frame fills |
| `LiveJob` make card | queued | subtle pulse, "Queued…" |
| | running | amber bar (width transition 1s linear), %+ETA, status text maps steps: `Generating presenter…` <40% → `Rendering video…` <85% → `Almost done…` |
| | completed | bar→check, poster→inline `<video>`, actions Download / Make another |
| | failed | plain message + Try again |
| `VideoCard` | hover | `translateY(-3px)`, play overlay fades in over thumb |
| `IconBtn` | hover | text→`--text-bright`, border→`--border-3`; delete variant hover → `--err` |
| Account dot | connected/connecting/expired | green / pulsing amber / err + "Reconnect to keep creating" banner |
| Submit | on click | toast "Video queued — tracking progress below" + switch to Library, new job highlighted |

---

## 8. Content & edge cases

- **Empty Library:** dashed panel, `No videos yet — let's make your first one` + Create button. (Create becomes the default view.)
- **Long titles:** truncate 1 line (`text-overflow: ellipsis`, parent `min-width:0`).
- **Script over limit:** char counter goes `--err`; Create blocked with reason "Script is N characters over the 5,000 limit."
- **No presenter generated yet:** preview shows placeholder; Create allowed only once required fields satisfied.
- **Very long list (>50):** virtualize the gallery; keep pagination as the primary control.
- **Segments:** roll up `internalSegment` children under a parent titled `· part X/Y`; don't render each child as a top-level card.
- **Loading catalogs/jobs (>300ms):** skeleton cards / shimmer, never a blank panel.
- **Offline / reauth:** replace the create body with a single friendly connect/reconnect card; never dead-end.
- **Thumbnail missing:** fall back to the aspect-ratio glyph placeholder (reserve the box to avoid CLS).
- **International / long strings:** buttons and chips wrap; summary lines clamp.

---

## 9. Motion

All transforms/opacity only; **honor `prefers-reduced-motion: reduce`** (disable
entrance, stagger, shimmer, hover-autoplay; keep instant state changes).

| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| View / step | mount | rise + fade (`translateY 8px→0`) | 380ms | `cubic-bezier(.2,.7,.2,1)` |
| Library card | mount | fade + rise + scale, staggered via `animation-delay` (0.04s step) | 400ms | `cubic-bezier(.2,.7,.2,1)` |
| Card | hover | `translateY(-3px)` | 220ms | `cubic-bezier(.2,.7,.2,1)` |
| Progress fill | value change | width | 1000ms | linear |
| Making poster / generating thumb | while busy | shimmer sweep (`background-position`) | 1.3–1.6s | linear (loop) |
| Presenter reveal | on resolve | cross-fade poster→image | 250ms | ease |
| Preview frame | aspect change | `aspect-ratio` transition | 250ms | ease |
| Toast | show/hide | opacity + `translateY(20px→0)` | 250ms | ease |
| Modal | open | backdrop fade + card | 180ms | ease |
| Btn | active | `scale(.97)` | 150ms | — |

---

## 10. Accessibility (WIG-derived — build to this)

- **Focus order (Create):** tab → view tabs → account chip → rail steps → step fields in
  DOM order → More toggle → step actions → preview CTA.
- **ARIA/roles:** view tabs `role=tab`/`tablist`/`aria-selected` + panels `role=tabpanel`;
  rail steps are `<button>`; captions `role="switch" aria-checked`; delete dialog
  `role="alertdialog" aria-modal`; progress status line wrapped in `aria-live="polite"`.
- **Icon-only buttons:** every one has `aria-label` (Play/Download/Duplicate/Delete);
  decorative SVGs `aria-hidden="true"`.
- **Keyboard:** all interactive via keyboard; `:focus-visible` ring on everything
  (`2px --accent`); modal is focus-trapped, Esc closes, focus returns to the trigger;
  Enter/Space activate rail steps and chips.
- **Labels:** real `<label htmlFor>`; placeholders end with `…` and never replace labels;
  `autocomplete="off"` on non-auth fields.
- **Images:** thumbnails have `alt` (title) and explicit dimensions / reserved aspect box.
- **Targets:** ≥ 32px desktop (icon buttons 30px is borderline — bump to 32); `touch-action: manipulation`.
- **Native `<select>`** (if any kept): explicit dark `background-color`/`color`; prefer chips.
- **Copy:** second person, active voice, Title Case buttons, numerals, errors state the fix.

---

## 11. Data mapping (UI → API/IPC/store) — bridge for implementers

Full detail in `docs/trace-mining/LIVE-SESSION-REPORT.md` §8 + `api-bodies-live/`.

| UI control | Field / call |
|---|---|
| Source = script | `audioSource:"tts"` → `create_audio_vc` → WS resolve → `audioMediaId` |
| Source = audio | upload `library/categories/upload` → optional `trim_media` → `audioSource:"library"` |
| Name | `title` |
| Script | `ttsText` (+ `create_audio_vc.text`) |
| Voice / language | `ttsVoice` / `ttsLanguage` |
| Mood | `voiceStyle` (create_audio_vc) / `ttsEmotion` (project) |
| Speed / Pitch | `ttsSpeed` / `ttsPitch` (0–100) |
| Describe presenter | `characterPrompt` → `create_image_from_prompt` → `characterResultUuid` |
| Look chips | `characterGender/Age/Style/Beard` |
| Upload photo | `imageDrivingMediaId` (else `0` = prompt-only) |
| Things to avoid | `characterNegativePrompt` |
| Where post | `aspectRatio` (16:9/9:16/1:1) |
| Look & quality | `style` (close_up/normal/high_quality) |
| Movement | `motionId` (Standard only) |
| Captions | `subtitleMode` → `project/subtitles/create` |
| Create | `POST /project` (`talkingPhotos.createScript` / `createUploadedAudio`) |
| Progress | `onProviderJob` push + `progress`/`remoteStep`/`remoteStepsTotal`; WS `estimated_time`/`host_name` |
| Card thumb | `previewMedia.smallThumb` / `media.data.preview` *(persist on job — P1)* |
| Play / Download | `localOutputPath` / `remoteMediaUrl`; `downloadOutput` |
| Duplicate | `create*` + fresh `creationIntentId` |
| Delete | `DELETE /project/{id}` *(new IPC — P3)* |
| Merge (select mode) | `POST /project/merge_videos {itemsIds,title,audioMediaId}` *(new IPC — P3)* |
| Account chip | `GET /account` (`fullName`, `roleColor`) via `connection` |
| Library unify | `talkingPhotos.projects()` → populate dead `remoteProjects` |

---

## 12. Build phasing, tests, guardrails (summary — full plan in `TALKING_VIDEO_REDESIGN.md`)

- **P0 (renderer only, biggest win):** Library gallery + `LiveJob` progress + inline
  preview + guided-flow shell w/ plain copy & smart defaults + humanised quota +
  `ConfirmDialog` scaffold.
- **P1:** unify `projects()`, search/filter/pagination, part-X/Y rollup, account chip +
  disconnect; persist `thumbnail/eta/host` on the job.
- **P2:** voice mood/speed/pitch, `close_up` style, `MotionPicker`, duplicate, caption
  language, TTS recovery.
- **P3 (small backend):** prompt-only presenter (G19), user Merge, Delete IPC.
- **Tests (vitest `node`, no DOM):** all view logic in pure `src/screens/talking-video/
  logic.ts` (`validateCreate` behaviour-locked, `filter/paginate/unify`,
  `describeProgress`, `formatLength`, `humanizeQuota`, `relativeTime`, `buildDuplicatePrefill`)
  + store tests mocking `window.api`. Baseline `npx vitest run test/unit/talkingphotos-*`
  (71 green) before/after each phase, plus `typecheck` + `build`.
- **Guardrails:** renderer/store only except the flagged P3 backend adds (additive, never
  touching the HAR-verified `POST /project` builder); keep the `enabled` gate;
  `validateCreate` locked by test; inline `<video>` restricted to local/allowlisted URLs;
  identity (amber/near-black/Space Grotesk) unchanged; single dark theme.

---

## 13. Target file map (proposed — implementer scaffold)

Do **not** invent a parallel design system. Split the monolithic screen into a thin
shell + pure logic + small presentational pieces. CSS stays in `global.css` under a
namespaced block (`.tv-*` matches the mockup; existing `.tp-*` can stay until migrated).

```
src/screens/
  TalkingVideo.tsx                    ← thin shell: gates, tab routing, layout
  talking-video/
    logic.ts                          ← pure, vitest-target (see §14)
    types.ts                          ← view-only types (CreateDraft, LibraryItem, …)
    CreateFlow.tsx                    ← 3-step wizard shell
    LibraryView.tsx                   ← gallery + toolbar + pager
    components/
      TopBar.tsx                      ← Seg Create|Library + AccountChip
      AccountChip.tsx
      WizardRail.tsx
      ChoiceCard.tsx
      ChipGroup.tsx                   ← may extend kit Chip
      VoicePicker.tsx
      PresenterStudio.tsx
      MotionPicker.tsx
      LivePreviewPanel.tsx
      LiveJob.tsx                     ← making / ready / failed card
      VideoCard.tsx
      LibraryToolbar.tsx
      Pagination.tsx
      ConfirmDialog.tsx               ← Radix Dialog alertdialog
      Toast.tsx                       ← or shared if one already exists
src/theme/
  tokens.css                          ← optional: --radius / spacing scale only
  global.css                          ← .tv-* block (from mockup CSS)
src/store/
  useTalkingPhotos.ts                 ← loadProjects, prefill, delete/merge (by phase)
test/unit/
  talkingphotos-view-logic.test.ts    ← pure logic
  talkingphotos-*.test.ts             ← keep existing 71 green
```

**CSS class map (from mockup → production):** keep the `tv-` prefix so the mockup
remains a visual reference. Key classes:

| Class | Role |
|---|---|
| `.tv-mock` | screen shell; `container-type: inline-size` |
| `.tv-topbar` / `.tv-tabs` / `.tv-tab` | top bar + segmented view tabs |
| `.tv-chip` / `.tv-dot` | account chip + status dot |
| `.tv-create-grid` | 200 / 1fr / 300 create layout |
| `.tv-rail` / `.tv-rail-item` / `.tv-rail-num` | step rail (`done` / `current`) |
| `.tv-step` / `.tv-step-head` / `.tv-step-actions` | step body |
| `.tv-choices` / `.tv-choice` / `.tv-choice-icon` / `.tv-choice-frame` | choice cards (`.selected`) |
| `.tv-field` / `.tv-input` / `.tv-textarea` / `.tv-hint` | form fields |
| `.tv-chipgroup` / `.tv-chip-opt` / `.tv-example-chip` | look/mood chips |
| `.tv-more-toggle` / `.tv-more-panel` | disclosure |
| `.tv-gen-card` / `.tv-gen-thumb` / `.tv-gen-body` | presenter generate row |
| `.tv-preview` / `.tv-preview-card` / `.tv-frame` / `.tv-summary` / `.tv-quota` | live preview |
| `.tv-lib-head` / `.tv-search` / `.tv-filter` / `.tv-gallery` | library chrome |
| `.tv-card` / `.tv-thumb` / `.tv-thumb-badge` / `.tv-badge` / `.tv-play-overlay` | video cards |
| `.tv-make-card` / `.tv-progress-track` / `.tv-progress-fill` | LiveJob progress |
| `.tv-badge-video` / `.tv-badge-merge` / `.tv-badge-caption` | type badge tints |
| `.tv-modal` / `.tv-modal-backdrop` / `.tv-toast` | dialog + toast |
| `.tv-btn` / `.primary` / `.ghost` / `.danger` / `.block` | buttons |
| `.tv-pager` / `.tv-empty` / `.tv-retention` | pager / empty / notice |

Reuse kit equivalents where they already match (`Btn`, `Field`, `Switch`, `SliderRow`,
`Combobox`, `Banner`, `EmptyState`, `StatusPill`, `Meter`) and only keep `.tv-*` for
layout + new components.

---

## 14. Pure `logic.ts` API (vitest `node` — lock these signatures)

All functions are pure (no DOM, no Electron). Inject `now` for time helpers.

```ts
// --- create draft validation (behavior-locked from today's errors memo) ---
export type CreateDraft = {
  sourceMode: 'script' | 'audio';
  title: string;
  scriptText: string;
  audioPath?: string | null;
  libraryAudioId?: string | null;
  characterPrompt: string;
  characterImagePath?: string | null; // required until G19
  aspectRatio: '16:9' | '9:16' | '1:1';
  style: 'close_up' | 'normal' | 'high_quality';
  motionId?: string | null;
  captionsOn: boolean;
  // voice
  ttsLanguage?: string;
  ttsVoice?: string;
  voiceStyle?: string;       // mood → voiceStyle / ttsEmotion
  ttsSpeed?: number;         // 0–100, 50 default
  ttsPitch?: number;         // 0–100, 50 default
  characterGender?: string;
  characterAge?: string;
  characterStyle?: string;
  characterBeard?: string;
  characterNegativePrompt?: string;
};

export type FieldErrors = Partial<Record<keyof CreateDraft | 'form', string>>;

export function validateCreate(
  draft: CreateDraft,
  caps: { maxScriptChars?: number; maxDurationSec?: number; characterImageRequired?: boolean },
): FieldErrors;
// Must match pre-redesign rules for shared fields; new fields only add soft warnings.

export function scriptLengthHint(chars: number, maxChars: number): {
  approxSec: number;
  label: string;           // "~12 sec · 171 / 5,000 characters"
  tone: 'ok' | 'warn' | 'err'; // warn >85%, err over
};

export function humanizeQuota(usage: {
  videosToday: number;
  videosTodayLimit: number;
  concurrent: number;
  concurrentLimit: number;
}): string; // "You can make 9 more videos today."

// --- library ---
export type LibraryItem = {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  kind: 'ai_video' | 'merged' | 'captioned' | 'resized';
  createdAt: number;
  thumbnailUrl?: string | null;
  localOutputPath?: string | null;
  remoteMediaUrl?: string | null;
  remoteProjectId?: string | null;
  progress?: number | null;          // 0–100
  remoteStep?: number | null;
  remoteStepsTotal?: number | null;
  etaSeconds?: number | null;
  hostName?: string | null;
  segmentOrdinal?: number | null;
  segmentTotal?: number | null;
  parentId?: string | null;
  internalSegment?: boolean;
};

export function unifyJobsAndProjects(
  jobs: LibraryItem[],
  projects: LibraryItem[],
): LibraryItem[]; // merge by remoteProjectId; jobs win for in-flight

export function rollupSegments(items: LibraryItem[]): LibraryItem[];
// hide internalSegment children; parent title gets " · part X/Y"

export function filterLibrary(
  items: LibraryItem[],
  opts: { query?: string; filter?: 'all' | 'ready' | 'making' | 'failed' },
): LibraryItem[];

export function paginate<T>(items: T[], page: number, pageSize: number): {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: T[];
};

// --- progress / time ---
export function describeProgress(item: Pick<
  LibraryItem,
  'status' | 'progress' | 'remoteStep' | 'remoteStepsTotal' | 'etaSeconds'
>): {
  barPct: number;                 // 0–100 (derive from step/steps if progress null)
  label: string;                  // "Generating presenter…" | "Rendering video…" | "Almost done…" | "Queued…" | "Ready"
  tone: 'idle' | 'active' | 'ok' | 'err';
  etaLabel?: string;              // "about 40 seconds left"
};

export function formatRelativeTime(ts: number, now: number): string; // "3 min ago"
export function formatExactTime(ts: number): string;                 // "07/22/2026 13:42"
export function retentionRemaining(createdAt: number, now: number, days?: number): {
  daysLeft: number;
  label: string; // "We keep your videos for 60 days…"
};

// --- duplicate ---
export function buildDuplicatePrefill(item: LibraryItem, sourceDraft?: Partial<CreateDraft>): Partial<CreateDraft>;
// fresh creationIntentId is assigned by the store on submit, not here.
```

**Progress copy mapping (for `describeProgress`):**

| Condition | Label |
|---|---|
| `queued` | `Queued…` |
| `running` && pct &lt; 40 | `Generating presenter…` |
| `running` && pct &lt; 85 | `Rendering video…` |
| `running` else | `Almost done…` |
| `completed` | `Ready` |
| `failed` | plain error message from job (fallback: `Something went wrong`) |

---

## 15. Smart defaults (2-click path)

A beginner should reach **Create video** with almost no choices:

| Field | Default |
|---|---|
| Source | Write a script |
| Voice | First recommended English voice (e.g. Nancy — warm) |
| Mood | Neutral |
| Speed / Pitch | 50 / 50 |
| Gender / Age / Style | Woman / Adult / Realistic |
| Aspect | **9:16** (Shorts, Reels & TikTok) |
| Look & quality | Standard (or High quality if product prefers — mockup uses Standard selected, High quality marked Recommended; **ship with High quality selected** if default duration limits make it safer, else Standard) |
| Movement | first non-premium Standard motion |
| Captions | **on** |
| Title | empty (required) |
| Script / Presenter prompt | empty (required) |

**Recommended default decision (lock at implement):** High quality selected when
`maxDuration` ≤ 60s account tier, else Standard. Document the choice in the PR.

---

## 16. Confirm dialog, toast, and empty-state copy

| Surface | Copy |
|---|---|
| Delete title | `Delete this video?` |
| Delete body | `Delete "{title}"? This can't be undone.` |
| Delete confirm | `Delete` (danger) · `Cancel` (ghost) |
| Create toast | `Video queued — tracking progress below` |
| Empty library | `No videos yet — let's make your first one` + `Create video` |
| Retention | `We keep your videos for 60 days — download the ones you want to keep.` |
| Reauth banner | `Reconnect to keep creating` |
| Presenter busy | `Creating your presenter… about 20s` |
| Presenter done | `Generated from your description` · button `↻ Regenerate` |
| Blocked Create | specific reason sentence (not a whisper), e.g. `Add a name for this video.` |

---

## 17. Phase acceptance criteria (definition of done)

### P0 — Liveliness (renderer only)
- [ ] Create is a 3-step guided flow with rail + sticky live preview (container queries).
- [ ] Plain copy from §13 of UX plan; jargon removed from labels.
- [ ] Library is a thumbnail gallery (cards), not a log list.
- [ ] Running jobs show `LiveJob` bar + % (or step-derived %) + plain status.
- [ ] Completed jobs play inline via restricted `<video>` (or open-folder fallback if no local path yet).
- [ ] Submit → toast + switch to Library with new job highlighted.
- [ ] `ConfirmDialog` scaffold exists (even if Delete IPC is stubbed).
- [ ] Quota line humanised near CTA.
- [ ] `logic.ts` extracted; `validateCreate` tests prove parity with pre-refactor rules.
- [ ] `npx vitest run test/unit/talkingphotos-*` green; `typecheck` + `build` green.
- [ ] Visual match to `docs/design/talking-video-mockup.html` at ≥ desktop width.

### P1 — Parity
- [ ] `loadProjects()` populates previously-dead `remoteProjects`; library unifies jobs+projects.
- [ ] Search, filter (All/Ready/Making/Failed), pagination work client-side.
- [ ] Part X/Y segment rollup; retention notice visible.
- [ ] Account chip + menu: Refresh / Open TalkingPhotos / Disconnect.
- [ ] Job persists `thumbnailUrl` / `etaSeconds` / `hostName` (small main-side add).

### P2 — Depth
- [ ] Mood chips + speed/pitch sliders (0–100) wired to create payload.
- [ ] `close_up` in style enum + UI.
- [ ] `MotionPicker` with hover-to-play + combobox fallback (Standard only).
- [ ] Duplicate prefill; caption language under More; TTS recovery entry point.

### P3 — Backend adds
- [ ] G19: `characterImagePath` optional; prompt-only path with `imageDrivingMediaId:0`.
- [ ] Delete IPC → `DELETE /project/{id}` + confirm modal wired.
- [ ] User Merge IPC → `POST /project/merge_videos` select mode.
- [ ] Cancel remains **out of scope** until endpoint is captured.

---

## 18. Implementation order inside a phase (suggested PR slices)

1. **Extract `logic.ts` + tests** (no UI change) — safest first commit.
2. **CSS + shell layout** (tabs, rail, empty states) behind existing feature gate.
3. **Library gallery + LiveJob** (biggest perceived win; can ship without full Create rewrite).
4. **Create steps 1→3 + LivePreviewPanel** (replace dense form).
5. **Polish:** motion, a11y pass, toast, confirm dialog, reduced-motion audit.

Keep each slice green on the TalkingPhotos vitest suite.

---

## 19. Out of scope / do not do

- Do **not** re-skin to light theme or adopt Express teal/white.
- Do **not** add Tailwind / shadcn / MUI.
- Do **not** change `electron/providers/talkingphotos/*` payload builders for
  `POST /project` (HAR-verified).
- Do **not** invent Cancel endpoint.
- Do **not** commit raw Playwright zips (`traces/*.zip`, `.playwright-cli/traces/*`)
  or skill installs (`.claude/skills/playwright-*`).
- Do **not** log secrets/cookies; keep Sentry instrumentation patterns from
  `docs/SENTRY_LOGGING.md` for any new pipeline touch (P1/P3 only).

---

## 20. How to review the design before coding

1. Open `docs/design/talking-video-mockup.html` in a browser (or the Claude Artifact URL).
2. Click through Create steps, Generate presenter, Create video → Library, Delete modal.
3. Read copy table in `docs/TALKING_VIDEO_UX_PLAN.md` §13.
4. Confirm API field mapping in §11 here against `docs/trace-mining/LIVE-SESSION-REPORT.md` §8.
5. Approve phase order (P0 first) then start implementation.

**Design status:** complete and ready for implementation. No further design docs required
unless product feedback changes step order, defaults, or which controls live under
"More options".
