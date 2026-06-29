# UI/UX Structure Plan — All Pages (2026-06-29)

Full structural redesign plan for every screen in Mental Empire Studio, plus the global
navigation shell. Structure-only — no CSS, no new features. All existing functionality
is preserved; only layout, grouping, and information hierarchy change.

> Already covered separately:
> - Compose page: `docs/COMPOSE-UI-STRUCTURE-2026-06-29.md`
> - Thumbnail page: `docs/THUMBNAIL-REDESIGN-2026-06-29.md`

---

## 0. Global shell (Sidebar + TitleBar)

### What exists
The Sidebar has two groups (PRODUCE / AUTOMATE) with 8 nav items, a logo/brand header,
and a status widget at the bottom. The content area is a simple full-height scroll region.
Page headers repeat a "STEP 0N" eyebrow label suggesting a fixed linear workflow.

### Problems
1. The sidebar is 196–236 px wide just to show 8 text nav items — wasted real estate on
   every page, including the spacious canvas-heavy Thumbnails editor.
2. The STEP numbers on page headers conflict with navigation freedom — users jump between
   screens non-linearly, but the headers say "STEP 01" suggesting they must go in order.
3. The status widget is always visible but only meaningful when a profile is auto-watching.
4. There is no persistent way to see what is actively rendering or downloading without
   leaving the current screen.
5. No empty-state or onboarding path for new users — the sidebar already shows 8 options
   and there's no indication where to start.

### Proposed structure

**Sidebar (unchanged width; refined sections)**
```
┌─────────────────────┐
│  ME  Mental Empire  │  ← keep
│       v 0.1.5       │
├─────────────────────┤
│  PRODUCE            │
│  □ Library          │  ← add last-scrape "· 2m ago" sub-label
│  □ My Channels      │
│  □ Download         │
│  □ Compose     [2]  │  ← badge = projects in-progress
│  □ Thumbnails       │
├─────────────────────┤
│  OUTPUT             │  ← rename AUTOMATE → OUTPUT (clearer)
│  □ Render Queue [3] │  ← badge = jobs queued/rendering
│  □ Profiles         │
│  □ Settings         │
├─────────────────────┤
│  ┌──────────────┐   │  ← persistent mini-status strip
│  │ ▶ Rendering  │   │    shows top active job title + %
│  │  My Video... │   │    only visible when a job is active
│  │ [■] 42%      │   │    clicking navigates to Render Queue
│  └──────────────┘   │
│                     │
│  ● Auto-watch: 3    │  ← keep (collapse when no profiles watching)
└─────────────────────┘
```

**Page headers — drop the STEP numbers, use context labels instead**

Before: `STEP 02 — COMPOSE · Build the video`
After:  `Compose · Gaslighting Explained` ← show the active project title

The step numbers implied a workflow. Real users jump between pages freely.
Replace the eyebrow with a context string that's actually useful
(active project, channel name, "X jobs queued", etc.).

---

## 1. Library (home / dashboard)

### What exists
Greeting header + Re-scrape button → 4 KPI cards → two-column layout:
left (channel cards 3-col grid + recent uploads table) | right (Activity + Auto-scrape cards,
hidden unless `showRail` is on).

### Problems
1. No onboarding / zero state. A brand-new user sees empty KPI cards saying
   "0 views · 0 subscribers · 0 uploaded · 0 in queue" with no direction.
2. Fake sparklines on channel cards (bars generated from the channel handle string,
   not real upload data) — looks alive but misleads.
3. Activity rail is conditional (`showRail` toggle) so most users never see it.
4. Re-scrape button is floating top-right with no indication of when the last scrape ran.
5. The "View all →" link on Recent uploads goes nowhere.
6. The two-column layout collapses awkwardly on narrower windows when the content
   area is split by the sidebar.

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  Good afternoon — 2 channels · last scraped 3 min ago [↻]     │
│  [+ Add channel]  [Download]                                   │
├────────────────────────────────────────────────────────────────┤
│  ZERO-STATE BANNER (shown only when channels = 0)             │
│  ┌───────────────────────────────────────────────────────┐    │
│  │  Add your first channel to get started →              │    │
│  │  [+ Add channel]  [Watch a quick start ↗]             │    │
│  └───────────────────────────────────────────────────────┘    │
├──────────────────────────────┬─────────────────────────────── │
│  CHANNELS (3-col cards)      │  ACTIVITY RAIL (always visible)│
│  ┌──────┐ ┌──────┐ ┌──────┐ │  Live event feed               │
│  │ card │ │ card │ │  +  │  │  ● Scraping…                   │
│  └──────┘ └──────┘ └──────┘ │  ✓ Downloaded "My Video"       │
│                              │  ▶ Render queued               │
│  STATS (3 KPI chips, inline) │                                │
│  Views 12.4K · Subs 3.2K ·  │  AUTO-SCRAPE CARD              │
│  Queued ③                    │  Next run in 14 min [Run now]  │
│                              │                                │
│  RECENT UPLOADS table        │                                │
│  (last 10, with status chips)│                                │
└──────────────────────────────┴────────────────────────────────┘
```

**Key changes:**
- Zero-state banner appears when `channels.length === 0` with clear CTAs.
- KPI stats move to an inline chip row below the channel grid header — 3 items max,
  not 4 cards (remove the redundant "In Queue" card; it's already in the sidebar badge).
- Channel cards remove the fake sparklines. Show real data only: name, handle, views,
  subs, uploaded count, and a "last scraped" timestamp.
- Activity rail is always visible in a fixed-width right column — remove the toggle.
- Re-scrape button moves next to the last-scraped timestamp in the header so the
  relation between the action and the timestamp is obvious.
- Recent uploads "View all" → navigates to a filtered Download/Library list.

---

## 2. My Channels

### What exists
Title + long description paragraph → URL form (input + button) → stacked full-width
channel cards (avatar, goals, reminder, delete) → edit modal overlay.

### Problems
1. The description text is 4 long sentences above the form — most users skip it.
   Clicking "Add channel" and seeing it fail is a better teacher.
2. There are two "Add channel" affordances: the `PrimaryButton` at the top-right of
   the title row AND the inline form below. Confusing duplication.
3. Channel cards are full-width horizontal rows trying to show everything in one line
   (avatar → name + source map → weekly goal → monthly goal → reminder → delete).
   On narrower windows this overflows badly.
4. The edit modal is a `position:fixed` overlay — jarring, loses context of which
   channel is being edited.
5. The source-channel "map" display (`c.mapDone / c.mapTotal uploaded`) is buried at
   the bottom of the name section and easy to miss.

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  My Channels  ← publishing destinations, not sources          │
│  [youtube.com/@your-channel ____________________] [Connect]   │
│  Sub-text: "Paste your own channel. Studio scrapes stats        │
│  and tracks which downloads you've already uploaded."          │
├────────────────────────────────────────────────────────────────┤
│  CHANNEL CARDS (2-col grid when ≥ 2 channels)                  │
│  ┌─────────────────────────────────────┐                       │
│  │  [Avatar]  Name · @handle           │                       │
│  │            Views · Subs · Uploaded  │                       │
│  │                                     │                       │
│  │  GOALS ─────────────────────────── │                       │
│  │  Week  [████░░] 3 / 5   [edit ✎]  │                       │
│  │  Month [██░░░░] 8 / 20              │                       │
│  │                                     │                       │
│  │  SOURCE CHANNEL MAP                 │                       │
│  │  ⇄ @PowerWithin  14 / 27 uploaded  │                       │
│  │                                     │                       │
│  │  ◷ Next reminder: On track · 3d   │                       │
│  │                                   × │ ← delete (top-right) │
│  └─────────────────────────────────────┘                       │
├────────────────────────────────────────────────────────────────┤
│  INLINE EDIT EXPANSION (not a modal)                           │
│  When "edit ✎" is clicked, the card expands vertically to     │
│  show the editable fields — no modal, no overlay.             │
└────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- Remove the duplicate "Add channel" PrimaryButton from the title row.
  The URL form IS the add-channel affordance; no redundancy needed.
- Shorten / remove the description paragraph. Put a single concise tagline
  below the section header, and move the full explanation to a `?` tooltip.
- Channel cards → 2-column grid, not full-width rows.
  Each card section is clearly delineated: identity | goals | source map | reminder.
- Goals section shows both bars stacked vertically (each gets its own row).
- Inline expansion replaces the modal. The "Edit goals & reminder" button expands
  the card in-place. No overlay, no context loss.

---

## 3. Download

### What exists
Step label → URL input + Fetch button → channel info bar (avatar, title, video count,
sort, qty, bitrate all in one row) → 4-column video grid (selectable) → selection footer
(count, size, two action buttons) → "Already downloaded" table.

### Problems
1. The channel info bar packs 7 different things (avatar, channel name, video count,
   3 sort options, qty input, bitrate label) into a single `display:flex` row.
   It's impossible to scan and collapses badly at normal sizes.
2. The video grid uses a 4-column layout with 92px-tall thumbnails — too small to
   identify videos visually; the title truncates at one line.
3. The "Download mp3 only" vs "Add to queue" distinction is not clear to new users.
   Both buttons are in a footer that's easy to miss while scrolling through videos.
4. The selection state relies on a small 22×22 checkbox in the top-left of each
   card — not visually obvious that cards are selectable.
5. "Already downloaded" section is a dense table with no quick navigation back to
   the compose workflow for those files.
6. No progress indicator when Fetch is running (the button just says "Fetching…").

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  Download audio from a channel                                 │
├────────────────────────────────────────────────────────────────┤
│  FETCH BAR (row 1: URL + Fetch button)                         │
│  [🔗 youtube.com/@channel __________________] [Fetch ▶]       │
│                                                                │
│  FILTER BAR (row 2: only shown after videos load)             │
│  Sort: [Popular] [Latest] [Oldest]  ·  Qty: [10]  mp3·192k   │
│  2 of 10 selected · ~14 MB                                    │
├────────────────────────────────────────────────────────────────┤
│  VIDEO GRID (3 columns, taller cards ~130px thumb)             │
│  ┌───────────────────┐ ┌───────────────────┐                  │
│  │ [───────────────] │ │ [───────────────] │                  │  ← thumbnail
│  │ ✓ (selection)     │ │                   │                  │  ← checkmark overlay
│  │ Title of video    │ │ Title             │                  │
│  │ 2:14 · 12.4K views│ │                   │                  │
│  └───────────────────┘ └───────────────────┘                  │
│                                                                │
│  STICKY SELECTION FOOTER (appears when > 0 selected)          │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 3 selected · ~21 MB               [Download] [→ Compose] │ │
│  └──────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────┤
│  ALREADY DOWNLOADED (collapsible section)                      │
│  Table rows with: thumb | title | stage | progress | actions   │
│  Each row has a [→ Compose] quick-action when stage = Done     │
└────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- Split the channel info bar into two clearly-separated rows: the fetch bar
  (URL + button) and the filter bar (sort + qty + format), shown only after videos load.
- 3-column grid instead of 4 — larger thumbnails (130px) make video recognition
  much easier. On wide screens can expand to 4.
- Selection is a full-card highlight (amber border + dimmed overlay) rather than a
  tiny checkbox overlay — obvious at a glance.
- The selection footer is sticky — always visible as you scroll through the grid.
- "Add to queue" is renamed "→ Compose" to clearly communicate the intent
  (download and open in Compose workflow).
- "Already downloaded" is a collapsible section — it defaults collapsed when there
  are source videos to focus on, expanded when the channel URL is empty.
- Each downloaded row gets a [→ Compose] button when stage = "Downloaded only".

---

## 4. Compose *(see separate plan)*

`docs/COMPOSE-UI-STRUCTURE-2026-06-29.md` — the 4-tab split
(Audio + Image | Captions | Style | Advanced) is already documented there.

One structural addition worth noting here: the Compose page header should show the
active project title and a "Back to Library" or "Pick different video" breadcrumb,
so the user always knows which video they're working on.

---

## 5. Thumbnails *(see separate plan)*

`docs/THUMBNAIL-REDESIGN-2026-06-29.md` — covers the full thumbnail editor redesign
(3-panel: layers+templates | canvas+reference | context-aware inspector).

---

## 6. Render Queue

### What exists
Step label → processing status chip → full-width table (VIDEO, MP3, IMAGES, THUMB,
CAPTIONS, STATUS, ACTIONS columns) → footer with OUTPUT FOLDER, FORMAT, Render buttons.

### Problems
1. The table has 7 columns crammed into a single row per job — tiny check marks/x
   for assets (MP3/IMAGES/THUMB/CAPTIONS), a combined progress+stage+encoder area,
   and a cramped ACTIONS column. Almost nothing is scannable at a glance.
2. During rendering, one row expands to show a stage stepper, encoder chip, filter chip,
   and ETA — a lot of information inside a table row that wasn't designed for it.
3. The "Render all" primary CTA is at the bottom of the page — often below the fold.
4. The OUTPUT FOLDER and FORMAT settings are also at the bottom — hidden from new
   users who wonder where the files go.
5. The missing-asset error note is a single line at the very bottom; it's easily missed.
6. Blocked rows show underlined item names that navigate to the fix — this behavior
   exists but isn't discoverable.

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER + ACTION BAR (sticky)                                  │
│  Render Queue  ·  3 of 5 ready  ·  1 rendering                │
│  Output: ~/MentalEmpire_out  [Browse]  ·  mp4 · 1080p ▾       │
│  [Render ready (3) ▶]  [Render all (5) ▶]                     │
├────────────────────────────────────────────────────────────────┤
│  JOB CARDS (each job = a card, not a table row)                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [thumb]  Gaslighting Explained · Mental Empire           │  │
│  │                                                          │  │
│  │  Assets: ✓ MP3  ✓ 4 images  ✓ thumbnail  ✓ captions    │  │
│  │                                                          │  │
│  │  ████████████████████░░░░░  74%  Encoding               │  │
│  │  GPU-NVENC encode · CUDA scale · ~1m 20s left            │  │
│  │  [Preparing ●] [Captions ●] [B-roll] [Assembling ●] …  │  │
│  │                                                [Cancel]  │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [thumb]  Stop Being Nice · Self Help Channel             │  │
│  │  ⚠ Missing: thumbnail  captions → [Fix →]               │  │
│  │  Assets: ✓ MP3  ✓ 6 images  ✗ thumbnail  ✗ captions    │  │
│  │                                           [↻] [×]        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- Convert table rows to cards. Each job gets its own card with breathing room.
- Sticky header bar with the "Render ready / Render all" CTAs AND output settings
  prominently placed — no more hunting for the render button.
- Assets checklist becomes a horizontal chip strip (✓ MP3 · ✓ 4 images · ✗ thumbnail)
  — scannable in one glance instead of individual column cells.
- Blocked jobs show a clear `⚠ Missing: thumbnail  captions` banner with a `[Fix →]`
  button that navigates to the right screen — no more looking for underlined words.
- Rendering jobs expand to show the stage stepper and encoder details — more natural
  in a card than in a table row.
- OUTPUT FOLDER and FORMAT move to the sticky header bar — visible on page load.

---

## 7. Profiles

### What exists
Title + description → 3-column profile card grid → inline ProfileEditor (replaces card
in the grid) → "New profile" dashed button at the bottom.

### Problems
1. The ProfileEditor opens inline, replacing the card in the grid — a jarring layout
   shift that collapses the surrounding cards and loses spatial context.
2. Profile cards have a dense key-value table (SOURCE / IMAGES / THUMB / CAPTIONS /
   OUTPUT as raw strings like "Latest · 5 videos", "Pool of 10 · shuffle") — hard
   to read and doesn't visually communicate the pipeline.
3. The pipeline summary (config string like "Latest 5 → MP3 download → auto captions
   → no B-roll → render manual") is in a small grey box at the bottom of the card —
   the most important diagnostic info is the least prominent element.
4. Profile cards show too much detail (5 ROWS + summary + stepper + message + 2 buttons)
   making the card extremely tall, especially when a run is in progress.
5. The "New profile" dashed button at the bottom is easy to miss.

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  Channel profiles   "One profile = the full pipeline."        │
│  [+ New profile]  (top-right button, always visible)          │
├────────────────────────────────────────────────────────────────┤
│  PROFILE CARDS (3-col grid)                                    │
│  ┌─────────────────────────┐                                   │
│  │ [Av] Profile Name       │  ← name + avatar                 │
│  │      @source-channel    │  ← source (most important fact)  │
│  │      ● WATCHING         │  ← status badge (watching/idle)  │
│  │                         │                                   │
│  │  PIPELINE CHIPS         │  ← visual pipeline, not text     │
│  │  [Latest 5] → [MP3] →  │     chips for: source, captions,  │
│  │  [auto captions] →      │     thumb, render mode           │
│  │  [Hormozi 16:9] →       │                                   │
│  │  [auto-render]          │                                   │
│  │                         │                                   │
│  │  Last run: 2h ago ·     │                                   │
│  │  5 videos processed     │                                   │
│  │                         │                                   │
│  │  [▶ Run]  [⚙ Edit]     │                                   │
│  └─────────────────────────┘                                   │
│                                                                │
│  ┌─────────────────────────┐  ← "New profile" is a card too   │
│  │   +  New profile        │     same size, dashed border      │
│  └─────────────────────────┘                                   │
├────────────────────────────────────────────────────────────────┤
│  PROFILE EDITOR (slide-out drawer or full-width panel)         │
│  Opens to the RIGHT of the grid (or as a modal drawer)         │
│  when "⚙ Edit" is clicked — the card grid stays visible.      │
│  ┌──────────────────────────────────────────┐                  │
│  │  Editing: My Profile Name          [×]  │                  │
│  │  Source URL: _____________________       │                  │
│  │  Source: Latest · 5 videos               │                  │
│  │  Captions: Hormozi · 16:9 · 2L           │                  │
│  │  Effects: None  B-roll: Off              │                  │
│  │  Auto-watch: [on]  Auto-render: [off]    │                  │
│  │  [Save]  [Delete]  [Cancel]              │                  │
│  └──────────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────┘
```

**Key changes:**
- Profile cards show only the key facts: name, source channel, status (watching/idle),
  and a pipeline chip row. Remove the verbose ROWS table from cards — it's in the editor.
- Pipeline shown as horizontal chips (like a Kanban flow) instead of raw config strings.
- ProfileEditor moves to a slide-out drawer / right panel that appears alongside the
  card grid. The grid doesn't shift — context is maintained.
- "New profile" is a card in the same grid (dashed border), not a lonely button at
  the bottom — it's always discoverable.
- Run stepper/event message only appears on the card when a run is actively in progress.
- The title-row "New profile" button is retained as a redundant top-level CTA.

---

## 8. Settings

### What exists
Title → two-column: left (8 stacked Card sections: APPEARANCE, OUTPUT, RENDER,
AUTO-SCRAPE, TRANSCRIPTION, BACKGROUND, BETA FEATURES, DANGER ZONE) | right
(Activity Log, 300px fixed width).

### Problems
1. 8 stacked cards in a single scrollable column makes this page extremely tall.
   Users can't jump to a specific setting section without scrolling the whole page.
2. BETA FEATURES is buried at the bottom — near the DANGER ZONE, which makes it
   feel risky even though enabling it is harmless.
3. The Activity Log in the right column is 300px always — useful but it already
   lives on Library too. On Settings it's mostly a distraction.
4. RENDER and AUTO-SCRAPE are two separate cards even though they're closely related
   — both control how the background pipeline operates.
5. The APPEARANCE section is at the top but only has 3 settings (accent, glow, rail).
   It doesn't justify being a full card.
6. There's no visual affordance for "settings are auto-saved." Users naturally look
   for a Save button and wonder if changes are persisting.

### Proposed structure

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER                                                        │
│  Settings                                                      │
│  ·Auto-saved·  (small "saved" chip that briefly appears        │
│                 when a change is made)                         │
├────────────┬───────────────────────────────────────────────────┤
│  SECTION   │  CONTENT AREA                                     │
│  NAV       │                                                   │
│  (left     │  Selected section content renders here            │
│   column,  │                                                   │
│   ~160px)  │                                                   │
│            │                                                   │
│  ● Looks   │                                                   │
│  ○ Output  │                                                   │
│  ○ Scrape  │                                                   │
│  ○ Integr. │                                                   │
│  ○ Beta    │                                                   │
│  ─────── │                                                   │
│  ○ Danger  │                                                   │
│            │                                                   │
│  ─────── │                                                   │
│  Version   │                                                   │
│  0.1.0     │                                                   │
│  [Logs]    │                                                   │
└────────────┴───────────────────────────────────────────────────┘
```

**Settings sections (by nav item):**
- **Looks** — Accent color swatches · ambient glow toggle · activity rail toggle
- **Output & Quality** — File naming template · output folder · quality · concurrency
  · encoder selector with GPU capability status
- **Scraping** — Auto-scrape toggle · frequency · delay · retries · cookies · proxy
- **Integrations** — Groq API key (Whisper captions) · Pexels/Pixabay/Coverr keys
  for B-roll · webhook URL · desktop notifications · tray/startup
- **Beta** — Enable toggle · B-roll API keys (moved here from Integrations if preferred)
- **Danger** — Reset data · Reset everything (separated section, visually distinct)

**Key changes:**
- Section nav (left ~160px) replaces the single tall scroll. Clicking a section
  smoothly scrolls (or swaps) the main content — no more page-length scrolling.
- BETA FEATURES is a first-class nav item, not buried. It's clearly labeled "Beta
  features" without being visually near Danger Zone.
- TRANSCRIPTION (Groq key) and BETA (stock-footage keys) merge into a single
  "Integrations" section — all API keys in one place.
- "Auto-saved" feedback: a small ghost chip near the header briefly shows "Saved ✓"
  on any settings change (300ms debounce) so users know changes persist.
- Activity Log leaves this page. It already lives on Library and doesn't belong
  in Settings.
- Jobs-this-week and version info move to the bottom of the section nav.

---

## Summary: key structural patterns across all pages

| Pattern | Current | Proposed |
|---|---|---|
| **Page headers** | STEP 0N eyebrow (implies linear flow) | Context string (project/channel name, count) |
| **Empty states** | Silent empty sections | Dedicated zero-state banners with CTAs |
| **Tables vs cards** | Full-width tables (Download history, Render Queue) | Cards with breathing room |
| **Settings layout** | Long single column | Section nav + content panel |
| **Modal editors** | Fixed-overlay modals (MyChannels edit) | Inline expansion or slide-out drawer |
| **Inline grid editors** | ProfileEditor replaces card (layout shift) | Drawer alongside the grid |
| **Sticky CTAs** | Primary actions below the fold | Sticky header bars |
| **Progress indicators** | Inside table cells (cramped) | Dedicated card space |
| **Sidebar** | Static nav, step numbers on pages | Mini render-status strip, context-aware headers |
