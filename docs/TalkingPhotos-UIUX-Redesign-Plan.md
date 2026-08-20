# TalkingPhotos — UI/UX Redesign Plan
## Fix vertical mode + relocate Presenter + repair ledger tables
> No backend changes. CSS + layout only. Missing data is shown as placeholder and listed in §8.

**Scope:** `src/screens/TalkingPhotos.tsx:740-1130` (step scaffold), `src/screens/talkingphotos/talkingphotos.css:18-33` (page grid), `src/screens/talkingphotos/talkingphotos.css:44-270` (ledger), `src/screens/TalkingPhotos.tsx:1488-1534` (PlanPreviewTable), character picker `src/screens/TalkingPhotos.tsx:922-1130`

---

### 1 — What the screenshots prove

**Screenshot 1 — "put the presenter block somewhere else" `TalkingPhotos.tsx:922-928`:**
- The ledger is cropped to its bottom 4 rows. Header (`Plan | Chunk | Live`) is off-screen. The 5:00-per-render band is cut. Cause: left column `.tp-steps` contains Step 04 Presenter expanded (≈850px tall with toolbar + 320px grid + generate form `TalkingPhotos.tsx:1012-1130`). In the two-column `grid-template-columns: 340px 1fr` the left column dictates page height. The right column (ledger + jobs) is pushed below the fold and then clipped by `max-height: 460px` internal scroll.
- Presenter tiles clipped on the left edge (`NewNewVua` label truncated). `.tp-chars` `repeat(auto-fill, minmax(88px, 1fr))` inside a 340px card with 16px padding → only 3.2 tiles per row. Grid gutter + `scrollbar-gutter: stable` steals the last 12px, causing the first column to overflow the card border.

**Screenshot 2 — "ui ux bug" `talkingphotos.css:84-92` + `talkingphotos.css:824-872`:**
- Left chip row wraps twice (All 7 / Generated / Uploaded / 9:16 / 16:9). Filters + secondary sort (`Recent | A-Z`) compete in 300px.
- At `max-width: 720px` the ledger collapses to `grid-template-columns: 1fr` for the header but `56px 1fr` for the body. Headers and rows no longer share tracks → Plan times and Live state drift. `is-live` header is `display:none` so Live column has no header.
- The `@container tp (max-width: 1000px)` breakpoint forces `.tp-page` to single column too early. Between 1000–1180px (the production minimum 1100×720 reads as ~940px pane after sidebar) the steps already stack, so the dense config phase and the monitoring phase collapse into one long scroll.

**Root causes (no backend):**
1. Presenter is the heaviest interactive region on the page, but is nested as the last accordion step in the same scroll as the ledger.
2. Ledger body is internally scrollable (`max-height:460px` + `overflow-y:auto`) while the page also scrolls → nested scroll + sticky header mis-alignment.
3. Container breakpoints treat 1000px as "narrow" and 720px as "collapsed rail" — both trigger well above the actual hardship width. Subgrid is broken at collapse.

---

### 2 — Design principle for the fix

Keep the surface brief's **twinned columns around a fixed centre rail** (Operate mode, `DESIGN.md: ledger` + `.impeccable/surfaces/src-screens-talkingphotos-tsx.md:32-44`). Do not invent a new palette or type system. Change the **information architecture**, not the visual language.

**Rule:** Steps 01–03 are *the commit*. Presenter is *the cast*. They are different decisions with different pacing. Commit belongs beside the cost line; cast belongs where it can breathe.

---

### 3 — New information architecture (recommended)

```
┌─ PageHeader (TalkingPhotos + subtitle) ──────────────────────────────┐
│ Connection strip (Connected · na···@gmail · 12/100 · 0/5 slots)       │
├──────────────────────────────────────────────────────────────────────┤
│                        BEFORE START (config mode)                    │
│ ┌─ 01 Source ───────┐  ┌─ THE PLAN (ledger) ──────────────────────┐  │
│ │ pick download     │  │ Plan | Chunk | Not started yet           │  │
│ ├─ 02 Render style ─┤  │ Video 01  0:00–28:59  28:59  6 chunks    │  │
│ │ Human/Cartoon/.. │  │ 0:00–5:00  5:00  01 □  Not started        │  │
│ ├─ 03 Chunk length ─┤  │ ...                                       │  │
│ │ ◯───●─── 5:00     │  │ ─────────────────────────────────────     │  │
│ │ cost line: 6/100  │  │ Cap bar: longest video vs 30:00 limit    │  │
│ │ [Render 1 video]  │  └──────────────────────────────────────────┘  │
│ │                   │   Jobs list (Running · Finished)              │
│ └───────────────────┘                                                │
│ ┌─ CASTING — Presenter (full-width, NOT a step) ──────────────────┐  │
│ │ [Search ⌕  ]  [All 7] [Generated] [Uploaded]  9:16 16:9  Recent  │  │
│ │ Showing 7 of 7  ·  Compact □                                      │  │
│ │ [tile][tile][tile][tile][tile][tile][tile]  ← horizontal, wraps │  │
│ │ Generate | Upload tabs (collapsed by default)                      │  │
│ └──────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│                        WHILE WATCHING (running job)                  │
│ Ledger takes full width (`.tp-page.is-watching` already does).       │
│ Steps + Casting collapse to a summary bar:                           │
│ [Source: … · Style: Human 9:16 · Chunk:5:00 · Face: NewNewVua] +    │
│ [Change plan → Plan another]  (re-opens config without stopping job) │
└──────────────────────────────────────────────────────────────────────┘
```

**Alternative that also satisfies the brief (offer as variant):**
Presenter as a **modal drawer** triggered by the former Step 04 header.
- Desktop: slide-over from right, 520px, same grid but 5 columns.
- Mobile/720px: bottom sheet, 70vh.
- Benefit: zero vertical competition. Cost line and Start button stay in viewport even with 30 presenters.
- Trade-off: extra click to change face after initial pick. Acceptable because face changes are rare per job.

Recommendation: ship the **full-width Casting belt** first (CSS-only, lowest risk), keep the drawer as a one-line variant if user testing shows the belt still pushes jobs too far on 720p laptops.

---

### 4 — Why this fixes vertical mode without a new breakpoint

- Steps 01–03 total height at 340px wide ≈ 420px (feature list + chunk slider + cost line). Fits above the fold with the ledger beside it. The ledger, not the presenter, is now the tall element.
- Casting as a full-width card uses `grid-column: 1 / -1` under the two-column grid. In narrow panes it naturally becomes the second row, full width, with a 5–6-column tile grid instead of 3. No 1000px early-stack needed.
- Table no longer competes for height: ledger body loses its fixed `max-height` internal scroll; it grows with content up to ~30 rows then scrolls *with the page*, not inside a box.

Breakpoint simplification:
- Remove `@container tp (max-width: 1000px)` that forces premature single-column. Keep two columns down to `820px` (the shell's rail breakpoint in `DESIGN.md: Layout`).
- At `≤820px`: steps stack (source/style/chunk as accordions), ledger stays three-column but shrinks rail to 64px. Casting tiles go 4 per row.
- At `≤560px`: only then collapse ledger to stacked rows (rail as left gutter). See §5 for the repaired collapse.

---

### 5 — Ledger / table repair (CSS-only, no data shape change)

**Keep the grammar `talkingphotos.css:44-92`:**
```css
.tp-ledger { grid-template-columns: 240px var(--tp-rail) minmax(200px, 1fr); }
.tp-body   { grid-column: 1 / -1; display:grid; grid-template-columns: subgrid; }
```
Do not break the `1 / -1` span. The bug at 720px removed it for the header.

**Fixes:**
1. **Single scroll surface.** Remove `talkingphotos.css:88-92` (`max-height:460px; overflow-y:auto; scrollbar-gutter`). Ledger scrolls with the page. Add `max-height:none` when `is-watching` is false; keep internal scroll only when a running job has >18 chunks (opt-in class `.is-long`).
2. **Sticky header that works.** Move `.tp-colhead/.tp-railhead` out of the scroll container or keep one sticky container. Currently sticky is inside `.tp-ledger` which is not scrollable — correct, so just ensure `.tp-ledger` is not the scroller.
3. **Output band responsive without wrapping chaos.** Change `talkingphotos.css:247-253` from `grid-template-columns: auto auto auto 1fr auto auto` to:
   ```css
   grid-template-columns: 1fr auto; grid-template-areas: "title meta" "note note";
   ```
   On narrow, times (`0:00–28:59`) wrap to second line with `font-variant-numeric: tabular-nums` retained. No horizontal overflow at 1100×720.
4. **Live cell never clips.** `TalkingPhotos.tsx:262-273` already emits `liveText(part)` + error. Add `min-width:0` + `text-overflow:ellipsis` already present (`talkingphotos.css:128-129`) — keep it.
5. **PlanPreviewTable parity.** `TalkingPhotos.tsx:1492-1532` uses `.is-nested` which strips border/background (`talkingphotos.css:885-895`). Restore a 1px `var(--border)` so the preview is legible when the Casting belt below has the same background. Or wrap it in `Card` pad=0.
6. **Empty states.** When `plan` is null, keep the existing `EmptyState` but place it *inside* the ledger card with a dashed border so the table's position is reserved (prevents jobs list jumping when a source is picked).

**Visual spec (ledger row):**
- Plan cell: `tpDuration` (mono, faint) + `Meas` length, `9px 16px` padding, `1px var(--border-soft)` row rule.
- Rail: 72px (down to 56px at ≤560px), mark 9px square, no radius, shape-first encoding preserved.
- Live cell: state text (ellipsis) + optional `Meas` duration + Retry button (only on `void`).

---

### 6 — Relocated Presenter — component spec (no new backend)

**Former location:** `TalkingPhotos.tsx:922-1130` as `<Step index={4}>…</Step>` inside `.tp-steps`.

**New location:** New file `src/screens/talkingphotos/CastingSection.tsx` (or inline section in `TalkingPhotos.tsx` after `</div> {/* tp-page */}`) rendered as:

```tsx
<section className="tp-casting" aria-labelledby="casting-title">
  <div className="tp-casting-head">
    <h2 id="casting-title">Casting — Presenter</h2>
    <span className="tp-casting-meta">One face for the whole job · {filtered.length} available</span>
    <Btn size="sm" variant="soft">Compact</Btn>
  </div>
  <div className="tp-casting-toolbar">…search… chips … Recent/A-Z …</div>
  <div className="tp-chars is-casting">…tiles…</div>
  <details className="tp-casting-generate">
    <summary>Generate or upload a presenter</summary>
    …existing formTalkingPhotos.tsx:1012-1130, two tabs…
  </details>
</section>
```

**Style deltas (all tokens existing):**
- `.tp-casting` : `Card` surface (`var(--bg-card)`, `var(--border)`, `var(--radius-lg)`, `var(--shadow-card)`) full width.
- `.tp-casting-head` : `display:flex; align-items:baseline; gap:12px; flex-wrap:wrap` ; title `Space Grotesk 16/600`, meta `Hanken 11/600 0.02em` muted.
- `.tp-chars.is-casting` : `grid-template-columns: repeat(auto-fill, minmax(108px, 1fr))` on desktop (6–7 per row at 1100px), `repeat(auto-fill, minmax(88px, 1fr))` at 820px, `repeat(auto-fill, minmax(76px, 1fr))` at 560px. Remove `max-height:320px` internal scroll; let it wrap naturally (max 2 rows, then "Show all 7 →" expander). Eliminates double scroll.
- Toolbar: single row on desktop (`search flex:1` + chips `flex-wrap`), two rows on mobile (search full width, chips below). Chips keep `Btn size="sm"` as before.
- Generate form: collapsed `<details>` by default — only ~40px tall when shut. Previously always visible. Saves ~260px.
- Attached character: keep `TalkingPhotos.tsx:1075-1083` but render as `tp-attached` at the top of Casting when `selectedCharacter` exists, with checkmark.

**Interaction:**
- Click tile → selects (`setCharacterId`) + shows check + scrolls Cost Line's blocker off. No lightbox hijack on first click (lightbox moves to double-click / "Inspect" icon). Preserves `lightbox` for detail but avoids the click→lightbox→close dance that hid selection.
- Search / filter / sort: identical state (`q`, `kindChip`, `aspectChip`, `sort`) — no data change.
- Select bulk (`selectOn`): keep current bulk bar but anchor it to Casting's bottom, not Steps.

**A11y:**
- Casting has its own `h2`. The former single-`h1` rule (`DESIGN.md: Typography — One Heading Rule`) stays intact — `TalkingPhotos` `h1` remains the page title.
- Tile grid keeps `role="grid"` / `gridcell`, `aria-selected`.

---

### 7 — Responsive wireframes (pane widths, not viewport)

**1100×720 (production floor, sidebar expanded ≈940px pane):**
- Two columns: 340px steps | ledger fills remainder (~600px). Casting full-width below occupies ~180px (one tile row + toolbar). Ledger shows 6 rows + 2 output bands without internal scroll. Jobs list visible without scroll.

**820px pane (sidebar as icon rail):**
- Pane stacks? No. Keeps two columns but steps narrow to 280px, rail 64px. Ledger still 3-col. Casting tiles 4 per row.

**560px pane (headless test pressure):**
- Single column: Steps (accordion) → Ledger (collapsed rail: rail becomes left gutter per `talkingphotos.css:834-872` but now with corrected `grid-column: 1 / -1` for headers) → Casting → Jobs. No horizontal overflow. Checked at `body { zoom: 150% }` per `DESIGN.md: Production-Minimum Rule`.

---

### 8 — Placeholder / sample data (backend does not yet provide)

Render these with muted or dashed styling + tooltip "Placeholder — no vendor field yet". Do not block Start on them.

| UI element | Placeholder copy | Source today | Needed backend later |
|---|---|---|---|
| Presenter tile badge | `Used in 3 jobs · Last used 2d ago` | Static sample from `jobs.filter(j=>j.characterId)` count (already available) but no timestamp | `character.lastUsedAt`, `character.useCount` |
| Presenter favorite | star icon `☆/★` | Local only, stored in `settings` or `localStorage` | `character.isFavorite` persisted |
| Presenter tags | `#formal #studio` | Hard-coded from `character.characterStyle + gender` | `character.tags[]` |
| Motion preview | 2s loop / hover scrub | `motion.thumbUrl` only | `motion.previewUrl` |
| Chunk ETA | `~18 min` per chunk | Already derived as `waves*20` in `CostLine.tsx:318` — keep estimate muted | Real vendor ETA per part |
| Queue position | `Position 2 of 6 in vendor queue` | Placeholder "Queued at TalkingPhotos" already exists | `part.queuePosition` |
| Cost forecast | `— renders left today: unknown` | Already shows `quotaKnown` branch `CostLine.tsx:329` | Always-known quota |
| Job duration total | `Wall-clock ~42 min` | Existing `waves*20` | Real `job.estimatedMinutes` |
| Output thumbnail | Poster frame from source audio | Grey inset with `tpDuration` | `output.thumbnailPath` |

List these explicitly in the empty state footnote: "Placeholders shown as muted text are not yet vendor-backed."

---

### 9 — What changes and what does not

**Changes (CSS + TSX move only):**
- Move Step 04 block out of `.tp-steps`. No new IPC, no new `NativeApi` entry.
- Replace `talkingphotos.css:29-33` `@container (max-width:1000px)` with `820px`.
- Remove `talkingphotos.css:88-92` internal scroll on `.tp-body`.
- Fix `talkingphotos.css:834-872` narrow collapse to keep header/body subgrid sync.
- Wrap `PlanPreviewTable` ledger in `Card` or remove `.is-nested` border stripping.
- Collapse generate form into `<details>`.

**Does not change:**
- Token set (`DESIGN.md: colors/typography/spacing`) — signal amber stays the one accent.
- Ledger state vocabulary (`tp-mark` hairline/queued/submitted/active/done/void) — shape-first rule preserved.
- Data contracts (`shared/talkingphotos.ts` — `planSplit`, `TP_MERGE_CAP_SECONDS`, `TpCharacter`, `TpPart`).
- IPC / preload / DB / pipeline — not touched.

---

### 10 — Implementation checklist (CSS-only, estimated)

1. Create `src/screens/talkingphotos/CastingSection.tsx` (extract `TalkingPhotos.tsx:930-1011` toolbar+grid + `1012-1130` form).
2. In `TalkingPhotos.tsx:740-1183` remove Step 04 from `.tp-steps`, render `<CastingSection>` as sibling of `.tp-page` with `grid-column: 1 / -1` inside `.tp-shell`.
3. Patch `talkingphotos.css:18-33` breakpoints + `44-92` ledger scroll + `468-514` `.tp-chars.is-casting` widths.
4. Fix `talkingphotos.css:834-872` collapse (keep `grid-column:1/-1` for `.tp-body`, change `.tp-row` to `subgrid` consistently).
5. Replace always-open generate form with `<details>` + two tabs (`Generate | Upload`).
6. Verify 1100×720 no horizontal scroll, 640px zoom pressure, `prefers-reduced-motion` disables `tpPulse` only.
7. Update `.impeccable/surfaces/src-screens-talkingphotos-tsx.md` brief — add "Casting belt replaces Step 04" and keep twinned-columns statement.

**Acceptance:**
- Presenter no longer pushes ledger below fold on 720p.
- Ledger header and rows aligned at every pane width; no clipped table at 1000px.
- Tile grid shows 6 tiles per row on desktop, 3 before on narrow, without clipping.
- No new colors, fonts, or radii.

---

### 11 — Risks & open question

- **Risk:** Full-width belt still tall if user has 40+ presenters. Mitigate with "Show 8 / Show all" collapse (default 8).
- **Risk:** Moving generate form into `<details>` hides it. Mitigate with CTA "Need a new face? Generate" when filter returns 0.
- **Open:** Brief's unresolved "editable queued chunks after start" — not addressed here; stays frozen per current `is-watching` rule.

