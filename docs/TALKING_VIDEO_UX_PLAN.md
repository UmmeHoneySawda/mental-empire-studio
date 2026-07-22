# Talking Video — UX Findings & Redesign Plan (beginner-first)

> **Planning only — no code.** Renderer/UI rewrite; **backend/provider untouched**
> except the one small, clearly-flagged change (make character image optional, G19).
> Grounded in the validated captures (`docs/trace-mining/LIVE-SESSION-REPORT.md`),
> the current screen `src/screens/TalkingVideo.tsx`, our tokens
> `src/theme/tokens.css`, kit `src/components/ui/kit.tsx`, the UX database, and the
> Web Interface Guidelines (WIG).

---

## 0. Executive summary

The screen works, but it's built as a **control panel that exposes the provider's
mental model** — TTS, motion, "60-/300-second segments", provider-vs-local captions,
concurrent-job quotas, aspect ratios as `16:9`. A first-time user meets ~15 controls
at once, in engineer language, with **no sense of order, no live preview, and no
real progress feedback**. It reads like a developer form, not a place to make a video.

**The fix:** turn one dense form into a **short guided flow that asks one plain
question at a time** ("What should they say?" → "Who's the presenter?" → "Where will
you post it?"), with a **persistent live preview** that makes the abstract concrete, a
**first-class "making your video" progress+result experience**, and a **visual Library**
that looks like a media app. Keep every power control, tucked behind "More options" so
nothing is lost. Stay 100% inside our existing identity (near-black + amber, Space
Grotesk) and in-house component kit.

---

## 1. Findings — heuristic audit of the current screen

Severity: 🔴 blocks/《confuses a new user》 · 🟠 friction · 🟡 polish. Each maps to the
current code and the rule it breaks (WIG / UX DB / Nielsen heuristic).

### 1.1 Language & concepts (the "nerdy" problem)
- 🔴 **Jargon as labels.** `Write a script (TTS)`, `Motion`, `Aspect ratio`,
  `Style: High Quality (60-second segments) / Normal (300-second segments)`,
  `Provider` vs `Local captions`, `Character prompt`, `Character negative prompt`,
  `Concurrent jobs`, `Downloaded Mental Empire audio`. None of these mean anything to a
  new user. *(WIG Copy: "specific, second person, plain"; Nielsen "match the real world".)*
- 🔴 **"Segments" leaks the internal pipeline.** Style is explained by how the backend
  chunks audio, not by what the user gets. Meaningless to a person.
- 🟠 **Quota exposed as raw internals.** `Concurrent jobs 0/2`, `Videos today 1/10`,
  `Max duration 60s` — provider accounting, not user language.
- 🟠 **"Character" everywhere** where a person thinks "presenter / avatar / person".

### 1.2 Structure & flow
- 🔴 **Everything on one screen at once.** Source + Character + Output + Summary +
  Account limits + CTA. No narrative, no "do this first". High cognitive load. *(UX DB:
  progressive disclosure; Nielsen "aesthetic & minimalist".)*
- 🔴 **Mode decision forced up front.** The `Upload audio ↔ Write a script (TTS)`
  segmented toggle is the very first control — the user must choose between two things
  they don't understand yet.
- 🟠 **Image-required presenter contradicts the product.** The Character step *requires*
  an uploaded image, yet the reference (and our own backend) can **generate the
  presenter from a text prompt** (validated: `characterDrivingMediaId:0`). The prompt is
  treated as secondary metadata; it should be the primary path.
- 🟡 **Advanced controls (gender/age/style/beard) hidden in a collapsed "Advanced
  appearance"** even though they meaningfully change the presenter a beginner is making.

### 1.3 Feedback & progress (the #1 complaint)
- 🔴 **No progress bar.** A running job shows a status pill + tiny text `operation ·
  step X of Y`. No %, no ETA, no visual motion. The user can't tell it's working — the
  data exists (`job.progress`, `remoteStep/remoteStepsTotal`, WS `estimated_time`,
  `host_name`, live `onProviderJob` push) but is thrown away. *(WIG Feedback; UX DB
  "Progress Indicators / Loading States", severity High.)*
- 🔴 **No result payoff.** A finished video offers only "Open folder". No inline
  playback, no poster — nothing that feels like "here's your video".
- 🟠 **Weak submit feedback.** On Create it sets a small success banner and switches
  tab; no clear "we're making your video now" moment. *(WIG "loading → success/error".)*
- 🟠 **"Why can't I click Create" is a whisper.** The blocking reason is a 10.5px dim
  line under the button.

### 1.4 My Videos (the list)
- 🔴 **Reads like a log, not a gallery.** `JobRow` shows `Project 12345`, `operation ·
  step`, raw UUIDs, a status pill, and text buttons. No thumbnail, no preview — despite
  every project carrying `previewMedia.smallThumb` + a video poster. *(UX DB visual
  hierarchy; content-first.)*
- 🟠 **No search / filter / pagination** even though the list grows fast (parts, merges,
  captions, resizes) and the API supports all three.
- 🟠 **Internal segments leak.** "part X of Y" child jobs aren't rolled up.
- 🟡 **No retention cue.** Users don't know videos expire in 60 days.

### 1.5 Accessibility & platform (WIG)
- 🟢 **Already good:** combobox with `aria-activedescendant`, `role=alert` errors,
  on-blur validation, `:focus-visible`, `prefers-reduced-motion`, container queries.
  *Keep these.*
- 🟠 **Icon-only job buttons** rely on `title` only in places; ensure `aria-label`.
- 🟠 **No destructive-action confirm** pattern yet (Delete needs a modal + focus trap).
- 🟠 **State not deep-linked** (tab/step not in URL). *(WIG Navigation.)*
- 🟡 **Native `<select>`** for gender/age/style/beard needs explicit dark
  `background-color`/`color` (WIG dark mode) — or replace with chips.

---

## 2. Design principles (make it warm, not nerdy — inside our identity)

Keep the identity (do **not** re-skin): `--bg-page #070809`, `--bg-card #12151b`,
`--accent #f5b323` (amber), Space Grotesk display. "Friendly" comes from **structure,
language, space, and preview**, not new colors:

1. **One question per view.** Guided steps; each view has a single job.
2. **Show, don't spec.** A persistent live preview (presenter in the chosen frame) turns
   settings into a picture. This is the signature element.
3. **Plain, second-person copy.** "Describe your presenter", not "Character prompt".
4. **Smart defaults → 2-click path.** Accept defaults and reach Create fast; power lives
   under "More options".
5. **Big, calm surfaces.** Generous padding, ≥44px targets, larger headings, fewer
   simultaneous controls. Fewer borders, more breathing room.
6. **Progress is a feature, not a footnote.** A dedicated making→ready experience.
7. **Restraint in motion.** transform/opacity only, `prefers-reduced-motion` honored.

---

## 3. New information architecture

Replace the two flat tabs (`Create` / `My videos`) with three clear surfaces:

```
Talking Video
├─ Create            → guided 3-step flow + live preview  (default when Library empty)
├─ Library           → visual gallery of your videos       (default when you have videos)
└─ [account chip ▾]  → Connected · name · Refresh · Disconnect
```

- Steps are **non-linear** (rail lets you jump; Back/Skip allowed — WIG/UX "user
  freedom") and remember choices.
- State (`?tab=create&step=presenter`) reflected in the hash/URL for deep-linking.
- A **"Switch to all-in-one view"** toggle collapses the wizard into a single
  power-user page (today's density, but cleaned up) for pros.

---

## 4. The Create flow — every step, field, input, control & copy

Layout: **left = step rail**, **center = the current step**, **right = sticky live
preview + primary CTA**. Container query collapses to single column < 900px.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Create a talking video                              ● Connected · Nazmul ▾  │
├──────────────┬───────────────────────────────────────┬───────────────────────┤
│ 1 Script   ✓ │  STEP 2 · Who's the presenter?         │   ┌─────────────┐     │
│ 2 Presenter ●│  Describe the person on screen.        │   │  9:16 frame │     │
│ 3 Format     │  ┌───────────────────────────────────┐ │   │  ┌───────┐  │     │
│              │  │ A friendly young woman, business… │ │   │  │presenter│ │     │
│ [More options│  └───────────────────────────────────┘ │   │  └───────┘  │     │
│  ⌄]          │  Try: [Studio host] [Suit] [Creator]   │   │  “demo”     │     │
│              │  Look:  Woman│Man   Young│Adult│Senior │   │  ~35s·Reels │     │
│              │         Realistic│Anime│Cartoon        │   │  Captions ✓ │     │
│              │  [ ✨ Generate presenter ]  or upload…  │   └─────────────┘     │
│              │                                         │   [ Create video ]   │
└──────────────┴───────────────────────────────────────┴───────────────────────┘
```

### Step 1 — "What should they say?"  (content / audio source)
- **Two choice cards** (not a jargon toggle), big and iconographic:
  - **① Write a script** — *"Type what to say and we'll turn it into a natural voice."* (default)
  - **② Use my own audio** — *"Upload a voice recording you already have."*
- **If "Write a script":**
  - `Title` — text input, label "Name this video", placeholder "e.g. Weekly update".
  - `Script` — large textarea, placeholder "What should your presenter say?…";
    helper shows a **plain length hint**: "~35 sec · 480 / 5,000 characters" (map the
    char limit to seconds so it's human). Warn tone near limit, error over.
  - **Voice** — a friendly **default is preselected** ("English · Nancy — warm").
    "Change voice ⌄" reveals: Language (searchable), Voice (searchable, with a small
    ▶ sample if available), and **Mood** as a chip row (Neutral / Excited / Serious /
    Friendly …) → maps `voiceStyle`/`ttsEmotion`. Under **More**: Speed & Pitch
    **sliders on a 0–100 scale** (50 = normal, per validated `ttsSpeed/ttsPitch`).
- **If "Use my own audio":**
  - Drag-drop / browse (existing `FileDropField`), plus "From your library"
    (the current downloaded-audio combobox, relabeled). Show filename + duration.
  - Note: *"Long audio is split and stitched automatically."* (No trim UI for
    beginners; offer optional Trim start/end under **More**.)

### Step 2 — "Who's the presenter?"  (prompt-first character; fixes 1.2)
- **`Describe your presenter`** — the primary field (maps `characterPrompt`), with
  **example chips** to click ("Studio host", "In a suit", "Home-office creator").
- **Look** as **chip groups** (replace the 4 nested `<select>`s): Gender (Woman/Man),
  Age (Young/Adult/Senior), Style (Realistic/Anime/Cartoon), Beard (only when Man).
- **Primary: `✨ Generate presenter`** → runs `create_image_from_prompt`
  (`imageDrivingMediaId:0`) and shows the **generated image with live WS progress**
  (see §6). Then **[Use this] / [Regenerate]**.
- **Secondary: "Upload a photo instead"** — optional driving image (existing dropzone),
  for users who want their own face/brand. *(Requires G19 to make the image optional in
  our IPC; until then, keep upload as the required path and label generation "coming".)*
- Under **More**: "Things to avoid" (`characterNegativePrompt`), Ethnicity.

### Step 3 — "Format & finish"
- **`Where will you post it?`** — three visual cards → `aspectRatio`:
  - **YouTube & landscape** (16:9) · **Shorts, Reels & TikTok** (9:16) · **Square** (1:1).
- **`Look & quality`** — visual cards → `style` (now 3 values, validated): **Close-up**
  (*"tight talking-head"*), **Standard** (*"more movement & motion styles"*), **High
  quality** (*"best detail, shorter clips"* — Recommended badge). Plain one-liners; the
  word "segments" never appears.
- **`Movement style`** — shown **only for Standard**; a **visual motion picker**
  (hover-to-play `videoUrl` thumbnails, Premium tag, duration) → `motionId`. A sensible
  default is preselected so a beginner can skip it. Keep a searchable combobox as the
  a11y fallback.
- **`Add captions`** — a single **toggle** (on/off). When on, the app **auto-picks the
  best engine** (provider captions when the account supports it, else local) and
  defaults the caption language to the voice language — the provider/local distinction
  is hidden. Under **More**: caption language + "burn style".
- Sticky **`Create video`** CTA (right panel). If blocked, show the reason as a clear
  sentence beside the button (not a whisper), and focus the first incomplete step.

### The persistent live preview (right panel — the signature element)
- The **generated presenter** framed inside the chosen **aspect-ratio box**, with the
  title overlaid and a ▶ affordance; below it a plain summary: **"~35 sec · Reels
  (9:16) · With captions · English (Nancy)"**. Updates as choices change. Before a
  presenter exists, show a friendly placeholder with the aspect frame.

---

## 5. "You can make N more today" — quotas, humanised

Replace the `Concurrent jobs 0/2 · Videos today 1/10 · Max duration 60s` meters with a
single calm line near the CTA: **"You can make 9 more videos today."** Keep the meters,
but only under **More options / Account**. Map `maxDuration` into the script length hint
("up to ~60 sec") instead of a raw number.

---

## 6. Presenter generation & the "making your video" experience (fixes 1.3)

Two live, progress-driven moments share one component, **`LiveJob`** (drives off the
already-subscribed `onProviderJob` push + WS fields):

**A. Generating the presenter (Step 2)** — inline in the preview frame:
- Shimmer poster → determinate/indeterminate bar → resolved image on WS `code:200`.
- Copy: "Creating your presenter… about 20s". Then [Use this] / [Regenerate].

**B. Making the video (after Create)** — a full **Result card** at the top of Library
(and the flow transitions here):
```
┌────────────────────────────────────────────┐
│  ▓▓ presenter poster (dimmed, shimmer) ▓▓    │
│  Making your video…                          │
│  ████████████████░░░░░  78%                  │
│  Rendering video · about 40 seconds left     │
└────────────────────────────────────────────┘
        ↓ on complete
┌────────────────────────────────────────────┐
│  ▶  inline playable video (poster→<video>)   │
│  demo-tts-1 · 0:35 · Ready ✓                 │
│  [ Download ]  [ Make another ]   ⋯          │
└────────────────────────────────────────────┘
```
- **Plain step words** map the remote steps: `Generating presenter…` → `Rendering
  video…` → `Almost done…` (from `remoteStep/remoteStepsTotal` + `log_message`).
- **ETA** from `estimated_time` → "about 40 seconds left"; **host** only under advanced.
- Bar animates width (transform/opacity); `aria-live="polite"` announces status; on
  fail → plain message + **Try again**. Requires persisting `progress/eta/thumbnail` on
  the job (small main-side add, plan P1) — until then, derive % from step/steps and show
  an indeterminate sweep.

---

## 7. Library (My Videos) → a media gallery (fixes 1.4)

```
┌ Your videos ─────────────────────────  [ search…]  [All ▾]  [＋ Create] ┐
│ We keep your videos for 60 days — download the ones you want to keep.    │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌─────────┐┌─────────┐┌─────────┐┌─────────┐                             │
│ │▶ poster ││░ making ││▶ poster ││▶ poster │   responsive grid;          │
│ │AI Video ││███░ 72% ││Captioned││ Merged  │   rows on wide screens      │
│ │demo·0:35││rendering││ recap   ││ weekly  │                             │
│ │2m ago   ││~40s left││1h ago   ││1d ago   │                             │
│ │⤓ ⧉ ⋯    ││         ││⤓ ⧉ ⋯    ││⤓ ⧉ ⋯    │                             │
│ └─────────┘└─────────┘└─────────┘└─────────┘        ‹ 1 2 3 ›            │
└──────────────────────────────────────────────────────────────────────────┘
```
- **Card**: thumbnail (`smallThumb`/poster) with ▶ overlay → hover/tap plays inline
  muted preview; **friendly type badge** (AI Video / Merged / Captioned / Resized);
  title with `· part X/Y` rolled up; **plain relative time** (exact on hover);
  status or mini progress bar.
- **Primary actions**: ▶ Play · ⤓ Download · ⧉ Duplicate (prefill the flow) · **⋯**
  (Add captions · Merge with… · Open folder · **Delete**).
- **Delete**: confirm **modal** — *"Delete 'demo-tts-1'? This can't be undone."* →
  Delete / Cancel (maps `DELETE /project/{id}`; focus-trapped, Esc to cancel).
- **Merge**: a **"Select"** mode → pick 2+ → **"Merge selected"** (order = pick order),
  optional "replace audio" (maps `merge_videos {itemsIds,title,audioMediaId}`).
- **Filter**: All / Ready / Making / Failed. **Search** over title. **Pagination**.
- **Empty state**: friendly illustration + "No videos yet — let's make your first one"
  + Create button.
- **Unify** local `jobs` + remote `projects()` by `remoteProjectId` (fills the dead
  `remoteProjects`), so web-made videos appear too.

---

## 8. Connection & account (humanised)
- Header chip: **● Connected · Nazmul** (name/role color from `GET /account`);
  connecting = pulsing dot; expired = **"Reconnect to keep creating"** banner (not
  `reauth_required`).
- Chip **▾ menu** (Radix dropdown): Refresh (was "Sync") · Open TalkingPhotos ·
  Disconnect. Disconnected/off state = a single friendly connect card.

---

## 9. Component inventory & recommended libraries/style

**Keep the in-house design system.** Do **not** add a visual UI kit (shadcn/MUI/Chakra)
— it would fracture the established amber/near-black identity and break "reuse existing
code". Extend `kit.tsx` + `tokens.css` + the `.tp-*` CSS block instead.

**Recommended additive libraries** (headless / a11y only — style with our tokens):

| Need | Recommendation | Why |
|---|---|---|
| Modal (Delete confirm), Dropdown (⋯, account), Tooltip (exact date/host), Popover (voice/motion pickers), Tabs | **Radix UI primitives** (`@radix-ui/react-{dialog,dropdown-menu,tooltip,popover,tabs}`) | Unstyled + correct focus-trap/ARIA/keyboard for free; we skin with tokens. Avoids hand-rolling focus management (the current combobox already shows how much that costs). |
| Icons (play/download/duplicate/trash/sparkle/…) | **lucide-react** | Consistent, tree-shakeable; replaces ~dozens of hand-drawn SVGs. |
| Video preview | **native `<video>`** (muted, playsInline, preload=metadata) | No player lib; restrict src to local files / `isAllowedProviderMediaUrl`. |
| Motion | **CSS + Web Animations API** (existing keyframes) | No GSAP/Framer; transform/opacity only; respects reduced-motion. |
| Forms / validation | **existing controlled state + pure `logic.ts`** | Small surface; keep validation testable in node (no form lib). |
| State | **existing zustand stores** | `useTalkingPhotos` + `useData`; add `loadProjects`, prefill helper. |

Alternative (if avoiding any new dep): hand-roll Dialog/Menu/Tooltip as the combobox is
today — more code, same result. **Recommended: adopt Radix primitives + lucide-react**
(additive, renderer-only, zero backend impact).

**New/extended components:**
`WizardRail`, `ChoiceCard`, `ChipGroup`, `PresenterStudio` (prompt + generate + preview),
`LivePreviewPanel`, `LiveJob` (progress+ETA+result), `VideoCard`, `LibraryToolbar`
(search/filter), `Pagination`, `ConfirmDialog`, `AccountMenu`, `MotionPicker`,
`VoicePicker`, `CaptionToggle`. Reuse existing `Btn`, `Seg`, `Field`, `Combobox`,
`SliderRow`, `Switch`, `Banner`, `EmptyState`, `StatusPill`, `Meter`.

---

## 10. Color & token map (exact usage — no new palette)

| Role | Token | Where |
|---|---|---|
| Primary / CTA / progress bar / active step | `--accent #f5b323` | Create button, progress fill, selected chip/card ring, step dot |
| Success / Ready / completed | `--ok-2` (green) | Ready badge, ✓, "Use this" |
| In-progress / Making / queued | `--warn` | making badge, shimmer tint |
| Error / Failed / destructive | `--err` | failed badge, Delete confirm button, invalid field |
| Surfaces | `--bg-card` / `--bg-inset` | cards, preview frame, inputs |
| Text | `--text-strong/bright/muted/dim/faint` | headings → helper text |
| Borders | `--border/-2/-3` | hairlines, dropzone, dividers |

**Type-badge tints** (subtle pills, low-alpha fills): AI Video = accent; Merged = a
muted violet (reuse the purple accent theme var); Captioned = `--ok-2`; Resized = a
muted blue. All at ~12–16% alpha bg + solid text, so they stay quiet.

Display headings: **Space Grotesk** (`--font-display`), larger and warmer than today
(e.g. step titles 20–24px, `text-wrap: balance`). Numbers (counts, %, durations):
`font-variant-numeric: tabular-nums`.

---

## 11. Motion spec
- Step enter: `meRise` (existing), 0.35s, `cubic-bezier(.2,.7,.2,1)`.
- Progress bar: width transition + `meShimmer` sweep on the "making" poster.
- Library cards: one-time entrance stagger via CSS `animation-delay` (no JS/GSAP);
  hover lift via existing `.me-card`.
- Presenter reveal: cross-fade poster→image on `code:200`.
- All gated by `@media (prefers-reduced-motion: reduce)` (pattern already in `global.css`):
  disable stagger, hover autoplay, shimmer; keep instant state changes.

---

## 12. Accessibility & quality checklist (WIG-derived — design to this)
- Every icon-only control has `aria-label`; decorative icons `aria-hidden`.
- Visible `:focus-visible` ring on all interactive elements (keep current pattern).
- `<button>` for actions, `<a>`/hash-links for navigation (step rail = buttons; nav = links).
- Inputs: real `<label htmlFor>`, correct `type`/`inputmode`, `autocomplete="off"` on
  non-auth fields; placeholders end with `…`; errors inline + focus first error.
- Destructive (Delete) → confirm modal, focus-trapped, Esc closes, focus returns.
- `aria-live="polite"` on the progress/status line.
- Native `<select>` (if kept) → explicit dark `background-color`/`color`; prefer chips.
- Images/thumbnails: explicit `width`/`height` (no CLS), `loading="lazy"` below fold.
- Targets ≥ 44px; `touch-action: manipulation`.
- Copy: second person, active voice, Title Case buttons, numerals, errors state the fix,
  real ellipsis `…` and curly quotes.
- Library list > 50 items → virtualize; deep-link tab/step/filters in the URL.

---

## 13. Copy guide (jargon → plain, the anti-nerd table)

| Today | New |
|---|---|
| Write a script (TTS) | Write a script *(we'll voice it)* |
| Upload / pick audio | Use my own audio |
| Character / Character prompt | Presenter / Describe your presenter |
| Character negative prompt | Things to avoid (optional) |
| Motion | Movement style |
| Aspect ratio · 16:9 / 9:16 / 1:1 | Where will you post it? · YouTube / Shorts & Reels / Square |
| Style: High Quality (60-second segments) / Normal (300-second segments) | Look & quality: Close-up / Standard / High quality (plain one-liners) |
| Provider subtitles / Local captions | Add captions (engine auto-picked) |
| Concurrent jobs 0/2 · Videos today 1/10 · Max duration 60s | You can make 9 more videos today · up to ~60 sec |
| Sync | Refresh |
| operation · step 2 of 3 · remoteProjectId | Making your video… Rendering (about 40s left) |
| Downloaded Mental Empire audio | From your library |
| reauth_required | Reconnect to keep creating |

---

## 14. Phasing, tests & guardrails

**Phasing** (renderer-first; ties to `TALKING_VIDEO_REDESIGN.md`):
- **P0 (no backend):** Library gallery + `LiveJob` progress (from existing step/%) +
  inline preview + the guided flow shell with **plain copy & smart defaults** +
  humanised quota line + confirm-dialog scaffolding. Biggest perceived-quality jump.
- **P1:** unify `projects()`, search/filter/pagination, part-X/Y rollup, account chip +
  disconnect; persist `thumbnail/eta/host` on the job for real ETA + posters.
- **P2:** voice mood/speed/pitch (0–100), `close_up` style, visual motion picker,
  duplicate, captions language, TTS recovery.
- **P3 (needs small backend):** **prompt-only presenter (G19)** + generated-preview
  event; user-facing **Merge** (+replace audio); **Delete** IPC.

**Tests (vitest `node`, no DOM):** all view logic in pure `src/screens/talking-video/
logic.ts` — `validateCreate` (behaviour-locked), `filter/paginate/unify`,
`describeProgress` (step/%/eta → label), `humanizeQuota`, `formatLength(chars→sec)`,
`buildDuplicatePrefill`, `relativeTime/exact`. Plus store tests (mock `window.api`) for
`loadProjects`, delete, merge. Baseline first: `npx vitest run test/unit/talkingphotos-*`
(71 green), re-run each phase + `typecheck` + `build`.

**Guardrails:** renderer/store only except the flagged G19/merge/delete backend adds
(additive, never touching the HAR-verified `POST /project` builder); keep the
`talkingPhotos.enabled` gate; `validateCreate` locked by test; inline `<video>` restricted
to local/allowlisted URLs; identity (amber/near-black/Space Grotesk) unchanged.

## 15. Open items
- G19 (make character image optional) is the one backend dependency for the prompt-first
  Step 2; until it lands, Step 2 keeps image-upload as the path and labels generation
  "coming".
- Confirm the exact `style` enum values beyond `normal/high_quality/close_up` if more
  exist (only these three observed).
