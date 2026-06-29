# Workflow Redesign — Channel Workspace, Master Library, Niche B-roll, Profiles

Status: PLAN (nothing implemented yet — this is the design + phased rollout)
Author: engineering
Scope: rework the day-to-day workflow so the app becomes a **resumable, channel-centric
workspace** with an organized on-disk library, niche-based reusable B-roll, a single
B-roll control, and a clearer replacement for "Profiles". Grounded in the current code
(`shared/types.ts`, `electron/db/index.ts`, `electron/services/broll.ts`,
`electron/ipc/compose.ts`, `electron/services/downloader.ts`) and informed by the older
Python app `UmmeHoneySawda/oldytauto`, which already nailed several of these ideas.

> **Decisions locked (from review, 2026-06-29).** These replace the old §12 open
> questions and drive the sections below:
> 1. **Library default** `<Documents>/MentalEmpireStudio` — approved.
> 2. **Niches are a global, user-curated list you select from** (no per-channel
>    auto-detect API calls). Each niche is wired to its own B-roll pool. (§4)
> 3. **Profiles are removed**, per the original request ("just remove it… add something
>    new"); the useful automation folds into the Channel, and the freed slot becomes the
>    new **Niches / B-roll Pools** manager. (§6)
> 4. **"Uploaded" is detected by scraping**, not a manual checkbox: match each source
>    video title against your own channels' uploaded titles with a **fuzzy score** (a
>    video may be live on more than one of your channels). Manual override stays. (§2.2)
> 5. **Existing files are reorganized** into the new library (not new-items-only) — the
>    whole point is to de-clutter — done as a safe, transactional move with a dry-run
>    preview + undo log. (§3.4)

---

## 1. The problems (in the user's words → what they mean technically)

1. **No resumable session.** "I open it, download some, make some, then redo the same
   thing tomorrow." → There is no per-channel *to-do / done* state. The app shows global
   lists (Download history, Render queue) but never "for channel X: these 5 are done,
   these 3 still need thumbnails."
2. **Files are scattered + in temp.** Downloads land in `<Downloads>/MentalEmpire_out`,
   project images in `userData/projects/<id>`, B-roll cache in `temp/me-broll-cache`,
   SFX in `temp/me-sfx`, the B-roll library in `userData/broll-library`. Nothing is
   grouped per video, and temp can be wiped by the OS. → Want a **chosen master library
   folder** with **per-video subfolders** (audio / images / b-roll / captions / output).
3. **B-roll re-downloads every time + can't handle multiple niches.** Want a **reusable
   pool fetched ahead of time** from source-channel titles, refreshed periodically, and
   organized **by niche/theme** (motivational vs tech) instead of by exact transcript
   keyword.
4. **"Profiles" are confusing.** What do they do, what happens on run, why duplicate
   B-roll/image settings? → Either make them meaningful or replace them.
5. **B-roll toggle appears in 2 places.** Redundant; should be one control.

---

## 2. Centerpiece: the Channel Workspace (resumable, status-tracked)

### 2.1 Concept
Make a **Channel** the home object. Each owned/source channel gets a workspace screen:
click the channel icon → see every video it has produced or could produce, each with a
**pipeline checklist** so you always know "what's done, what's next."

### 2.2 Per-video pipeline status (the key new state)
Track, per video item, the stages it has passed — mirroring `oldytauto`'s
`item_status.json` (`{channels:{<channel>:{items:{<id>:{downloaded,rendered,uploaded,…}}}}}`):

| Stage        | Source of truth today                              |
|--------------|----------------------------------------------------|
| `discovered` | scraped into `source_videos`                       |
| `downloaded` | `downloaded_videos.filePath` set + `durationSec>0` |
| `images`     | `project_images` rows exist for the project        |
| `captioned`  | `transcript_words` rows exist                       |
| `thumbnail`  | `projects.thumbPath` set (or computed PNG exists)  |
| `rendered`   | a `render_jobs` row is `done` with `outputPath`    |
| `uploaded`   | NEW — **auto-detected by fuzzy title match** (§2.2a), manual override |

Most of this is **already derivable** from existing tables — we surface it instead of
re-deriving it ad hoc.

### 2.2a Upload detection by fuzzy title match (decision #4)
Instead of asking you to tick "uploaded," detect it automatically — and cheaply, with no
extra API beyond the scraping you already do:
- **My Channels already scrapes your own channels' uploads.** When we ingest a source
  video (or refresh a my-channel), compare the source title against your channels'
  uploaded titles using a **normalized fuzzy score** — lowercase, strip emoji/punctuation,
  token-set overlap with a small edit-distance tolerance so a missing word or two still
  matches. (Pure, unit-testable: `titleMatchScore(a, b) → 0..1`.)
- A match ≥ threshold (e.g. 0.82, tunable) marks the item **uploaded**, and because the
  same content can be posted to several of your channels, we store **`uploadedTo: string[]`**
  (the matched channel ids) plus the best score — not a single boolean.
- Edge cases: show "likely uploaded (0.86 → @ChannelA, @ChannelB)" so you can confirm or
  clear; a manual flag always wins over the detector. Re-runs are idempotent (keyed by
  source video id × my-channel id).


### 2.3 New DB: a `work_items` view/table
Add one table that ties a source video → its project → its render job, so the workspace
query is a single join rather than five lookups:

```sql
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,           -- = source video id (stable, dedupes re-scrapes)
  channelId TEXT,                -- owning channel (source or my-channel)
  title TEXT,
  sourceVideoId TEXT,
  downloadId TEXT,              -- FK → downloaded_videos
  projectId TEXT,              -- FK → projects
  renderJobId TEXT,            -- FK → render_jobs
  uploadedTo TEXT,             -- JSON string[] of my-channel ids matched (§2.2a); null = not detected
  uploadMatchScore REAL,       -- best fuzzy score, for display/confidence
  uploadedManual INTEGER DEFAULT 0, -- 1 = user override forcing uploaded state
  archived INTEGER DEFAULT 0,  -- hide from "to do" without deleting
  createdAt TEXT, updatedAt TEXT
);
```

Stage booleans are **computed** on read (join the FK rows) so they can never drift from
reality; `uploaded` is `uploadedManual OR uploadedTo IS NOT NULL`. A migration backfills
`work_items` from existing `downloaded_videos` + `projects` + `render_jobs` on first launch.

### 2.4 Workspace UI (no new heavy screens — extend `MyChannels` + `Library`)
- **Channel card → "Open workspace"** opens a per-channel board with three columns:
  **To do** (discovered/downloaded but not rendered), **In progress** (has project,
  missing captions/thumb), **Done** (rendered ± uploaded).
- Each row is a checklist chip set: `⬇ audio · 🖼 images · 💬 captions · 🖼️ thumb · 🎬 render · ⬆ upload`.
  Click a chip to jump straight to that step for that item (deep-link into Compose /
  Thumbnails / Render).
- A **"Resume"** button on the channel surfaces the single most-advanced unfinished item.
- Persist `defaultScreen` + last-open channel so reopening the app lands you where you left.

### 2.5 Why this is mostly free
The data already exists; this is largely a **read-model + UI** change plus one table and
one boolean. It directly answers "come back next day, click the channel, see what's left."

---

## 3. Master Library folder + organized per-video storage

### 3.1 One configurable root
`AppSettings.outputFolder` already exists but is only used for renders/thumbnails.
Promote it to the **single library root** (default `<Documents>/MentalEmpireStudio`,
user-pickable via the existing `chooseFolder()`), and route **everything** through it.


### 3.2 Deterministic, per-video folder layout
Replace the scattered temp/userData/Downloads paths with one tree keyed by a stable id
(the source video id — same key the workspace uses):

```
<LibraryRoot>/
  <Channel Name>/
    <videoId>__<slug>/
      audio/        narration.mp3  (+ mastered.m4a)
      images/       00_*.jpg …      (currently userData/projects/<id>)
      captions/     captions.ass, transcript.json
      broll/        bed.mp4, seg-*.mp4   (currently temp/me-broll-cache/<job>)
      thumb/        thumbnail.png
      output/       <final>.mp4, <final>.render.log
      project.json  (denormalized snapshot for portability / external editing)
  _pools/           niche B-roll pools (see §4)
  _cache/           transient scratch (safe to delete; SFX, probes)
```

### 3.3 A single `storage` service (new)
Introduce `electron/services/storage.ts` as the **one** place that computes paths:
`libraryRoot()`, `channelDir(name)`, `itemDir(channelName, videoId, slug)`, and typed
sub-path helpers (`audioPath`, `imagesDir`, `brollDir`, `captionsPath`, `thumbDir`,
`outputDir`). Today these literals are duplicated across `download.ts`, `compose.ts`,
`queue.ts`, `thumbnails.ts`, `broll.ts`, `sfx.ts` — consolidating removes drift and makes
the reorg a one-file change plus call-site updates.

- Keep **truly transient** scratch (ffmpeg probes, SFX renders) under `_cache/` so it can
  be cleared without touching real assets.
- `project.json` per item makes the library portable and human-browsable (and is how
  `oldytauto` let users "browse downloaded channel content").

### 3.4 Migration (decision #5 — reorganize existing, safely)
De-cluttering is the whole point, so we **do move existing files** into the new tree
rather than leaving them scattered. To keep it safe:
- **Transactional + reversible.** Build the full move list first (old absolute path → new
  path), show a **dry-run preview** ("142 files → MentalEmpireStudio/…, ~3.1 GB"), then
  execute. Copy-then-verify-then-remove (not a bare move) so an interruption can't lose
  data; write an **undo log** (`_cache/reorg-<ts>.json`) mapping new→old to roll back.
- **DB stays consistent.** Rewrite the stored absolute paths (`downloaded_videos.filePath`,
  `project_images.path`, `projects.thumbPath`, `render_jobs.outputPath`, etc.) inside one
  SQLite transaction keyed off the same move list; if any file step fails, the DB write is
  not committed.
- **Triggered, not silent.** Runs from a Settings → "Organize library now" action (and is
  offered once on first launch after upgrade), never automatically on every boot. Items
  whose source files are missing are skipped + reported, not failed.
- Cross-device safety: if the chosen library root is on a different drive than the old
  files, fall back to copy+verify+delete (handled by the same code path).

---

## 4. B-roll: reusable **niche pools** (not per-keyword, not per-render)

### 4.1 What already exists (good news)
`broll.ts` already has a **library** concept: `warmBrollLibraryFromTitles()` scrapes
source titles → themes → downloads reusable clips into
`userData/broll-library/<sourceKey>.json`, and `libraryCandidates()` prefers those local
clips before hitting providers. So "download ahead, reuse" is **partly built** — but it's
keyed by an ad-hoc `sourceKey` (derived from the top 4 themes) and matched per transcript
keyword, which is why multi-niche gets muddy.


### 4.2 The change: a **global, user-curated Niche list** you select from (decision #2)
Niches are **global, persistent entities you manage yourself** — not auto-detected per
channel (no extra title-analysis API calls). You create/edit them in a new **Niches /
B-roll Pools** manager (the screen slot freed by removing Profiles, §6):

```
Niche { id, name ("Motivational"|"Tech"|…), keywordGroups[][], orientation, targetClips, updatedAt }
```

- You **assign a channel to a niche by picking from the global list** (a simple dropdown
  on the channel). Many channels can share one niche (N:1). New videos inherit their
  channel's niche. No assignment = fall back to today's per-render behavior.
- Each niche **is** its B-roll pool: it owns `_pools/<niche>/` with cached clips + a
  `pool.json` index (reuse the existing `BrollLibraryIndex` shape, re-keyed
  `sourceKey` → `nicheId`). Editing a niche's keywords feeds straight into what its pool
  fetches — that's the "connects to the b-roll pool" you asked for.
- **Optional, free suggestion (no API):** when you create a niche we *can* pre-fill
  keyword suggestions from titles already scraped locally (`keywordThemesFromTitles()`),
  but you always confirm/edit — selection stays manual.
- **Selection by niche + theme, not exact keyword:** at render time, candidates are scoped
  to the video's niche pool first, then *ranked* by soft overlap with the transcript
  themes (the existing `rankCandidates`/`libraryCandidates` fuzzy scoring), only falling
  back to live providers if the pool is thin. So a motivational video pulls from the
  motivational pool even when a stray word ("server") would otherwise drag in tech clips.

### 4.3 Multi-niche handling (your explicit question)
- Two niches → two pools under `_pools/`. A video uses **only its channel's niche pool**.
- A clip can be tagged into multiple niches (deduped by provider:id with a hard link /
  copy), so shared "city at night" footage isn't downloaded twice.
- A single niche can hold **multiple keyword groups** for genuinely mixed channels; the
  current `keywordThemesFromTitles()` buckets titles into theme groups, so we keep that but
  store the result under the niche you selected instead of an anonymous sourceKey.

### 4.4 Periodic refresh
- A scheduler tick (the app already has `scheduler.ts` + auto-scrape cadence) tops up each
  niche pool from **its own keyword groups** (and, if any assigned channels exist, their
  recent titles), fetching up to `targetClips` and skipping ids already present. Prune
  clips unused for N days (track last-used in `pool.json`).
- Surface pool health in Settings/Workspace: "Motivational — 58 clips, refreshed 2h ago."

### 4.5 Net effect
Renders stop re-downloading; niches stay separated; the pool grows + self-maintains. This
is an evolution of the existing library code, not a rewrite — mostly re-keying + a small
`Niche` table + wiring the scheduler.

---

## 5. One B-roll control (kill the duplication)

Today the toggle exists in **three** UI spots, all bound to the same
`betaOpts.broll.enabled` (so they're state-synced but visually redundant):
- `Compose.tsx` header quick-toggle (line ~99)
- `Compose.tsx` beta panel `BetaRow` (two layout branches, ~292 and ~463)
- `Profiles.tsx` profile beta options

Plan:
- Keep **one** authoritative control in the Compose beta panel (with density + niche
  picker), and make the header a **read-only status indicator** ("Auto B-roll: ON ·
  Motivational pool") that deep-links to the panel rather than a second toggle.
- Remove the duplicate `BetaRow`/`Row` branch in Compose (collapse the two layouts into
  one shared component).
- After the Profiles rework (§6), the profile-level copy moves to the channel's
  automation settings, so there's exactly one place per scope (per-video vs per-channel).


## 6. Profiles: REMOVED, automation folded into the Channel (decision #3)

Your original request was blunt: *"what are even profiles?… just remove it. I think
instead of this add something new."* So that's the plan — **remove the Profiles screen**,
keep only the genuinely useful part (unattended watch + auto-render), and re-home it on
the Channel. The freed navigation slot becomes the **new** thing: the Niches / B-roll
Pools manager (§4.2).

### 6.1 What a Profile is today (so nothing useful is lost)
A `Profile` (`shared/types.ts`) is a **saved automation recipe**: source channel + scrape
order/count + image mode + caption style + aspect + output folder + beta options + a
thumbnail template + an auto-watch cursor (`lastSeenVideoId`). Running it
(`automation.runProfile`) scrapes the source → downloads new videos → builds projects →
captions → optionally auto-queues render; `autoWatch` re-runs it on new uploads. In short:
"an unattended channel pipeline" — which is really a **property of a channel**, not a
separate object.

### 6.2 Why it has to go
- It **overlaps My Channels** (both hold a source link + cadence + style) → you maintain
  the same info twice.
- Opaque card labels (`rule`, `images`, `thumb`, `cap`, `out`).
- It **duplicates per-video settings** (image mode, captions, b-roll) with no precedence
  story — the exact "b-roll toggle in two places" confusion (§5).

### 6.3 The replacement: Channel Automation + the new Niches manager
- **Remove** the Profiles screen and the `profiles` concept from the UI.
- Each Channel gains an **Automation** section in its Workspace (§2): source link, cadence
  (off / on new upload / every N hours), default style (caption preset/font/aspect, image
  mode, **assigned niche** + b-roll on/off), thumbnail template, `autoQueueRender`. These
  are exactly today's `Profile` fields, re-homed where you already think about them.
- "Run profile" → **"Run channel automation now"**; auto-watch → the channel's cadence.
  The scheduler logic is unchanged underneath — it iterates channels with automation
  enabled instead of separate Profile rows.
- **Precedence is explicit:** channel automation supplies *defaults*; a per-video project
  can override; the project value wins at render time. (This is what removes the "b-roll /
  new images in a profile?" ambiguity — there are exactly two scopes: channel default and
  per-video override.)
- The **"something new"** that takes Profiles' place in the nav: the **Niches / B-roll
  Pools** manager from §4 — create niches, edit their keyword groups, see pool health, and
  it's what channels point at.

### 6.4 Migration (one-time, then retire)
Convert each existing `Profile` into automation settings on its `linkedSourceId` channel
(or create a channel from `sourceUrl` if unlinked); map its theme keywords into a niche
(reuse or create). Keep the `profiles` table readable for **one** version purely as the
migration source, then drop it. No user data is lost — it's relocated.

### 6.5 (rejected) Keep-them-separate option
<keep-for-reference>
The lighter "rename Profiles → Automations + clean up labels" option was considered and
**rejected** in favor of removal per decision #3, since keeping a separate screen
preserves the My-Channels overlap that caused the confusion in the first place. Recorded
here only so the tradeoff is on the record.
</keep-for-reference>

---

## 7. How the old Python app (`oldytauto`) informs this
It already implemented several target ideas, validating the direction:
- `OUTPUT_DIR/<safe_channel>/` — **per-channel folders** holding audio/video/thumb (§3).
- `item_status.json` → per-item `{downloaded, rendered, uploaded, created_at, updated_at}`
  keyed by channel → the **resumable status board** (§2).
- `download_history.json` — a set of downloaded video ids for **dedupe** (we already have
  `lastSeenVideoId`; a per-channel downloaded-id set is stronger).
- `image_gallery` with `record_usage` / `get_usage_history` / `get_channel_images` — an
  **asset library with usage tracking** (worth adding so the same stills/clips aren't
  reused back-to-back). Its weakness was no DB (JSON files + locks) and a monolithic
  `app.py`; we keep our SQLite + service split, but borrow the per-channel + status model.


## 8. Phased rollout (each phase ships independently + is reversible)

**P0 — Storage service + master library (foundation).**
- Add `electron/services/storage.ts`; route downloads/images/captions/broll/thumb/output
  through `libraryRoot()`/`itemDir()`. Default root `<Documents>/MentalEmpireStudio`,
  pickable in Settings. Write `project.json` per item. Ship the **reorganize-existing**
  migration (decision #5) as a guarded Settings action with dry-run + undo log.
- Risk: low–medium (the move step; mitigated by copy-verify-delete + transactional DB).

**P1 — Work-item read model + status chips.**
- Add `work_items` table + backfill migration. Surface a per-channel checklist in
  `MyChannels`/`Library` with deep-links. Include the **fuzzy upload detector** (§2.2a):
  `titleMatchScore()` + the scrape-time matcher writing `uploadedTo[]`.
- Risk: low (additive; computed stages).

**P2 — Channel Workspace board + Resume.**
- The To-do / In-progress / Done board, last-open-channel persistence, "Resume" action.
- Risk: medium (UI surface), but data is already there from P1.

**P3 — Niche pools + global Niches manager.**
- Add `Niche` table; build the **Niches / B-roll Pools** manager screen (the slot freed by
  removing Profiles); re-key the existing B-roll library `sourceKey` → `nicheId`; add the
  per-channel niche dropdown; scope render selection to the niche pool first; pool health UI.
- Risk: medium; reuses existing library/ranking code.

**P4 — Periodic pool refresh + asset usage tracking.**
- Scheduler tops up/prunes niche pools from their keyword groups; borrow `record_usage` to
  avoid repeating clips.
- Risk: low–medium.

**P5 — Remove Profiles → Channel Automation.**
- Move Profile fields onto channels; migrate rows (map theme keywords → niche); retire the
  Profiles screen; collapse the duplicate B-roll controls to one per scope (§5).
- Risk: medium (migration); guarded by keeping `profiles` readable for one version.

## 9. Risks & mitigations
- **Path migration breaking existing renders** → keep absolute DB paths valid; opt-in
  "Reorganize library" with dry-run; never move on startup automatically.
- **Library on a slow/removable drive** → validate the chosen root is writable at save
  time; fall back to default with a clear warning.
- **Pool disk growth** → per-niche `targetClips` cap + prune-by-last-used; show pool sizes.
- **Double source of truth (channel vs project settings)** → documented precedence
  (project overrides channel defaults; resolved at render time).
- **Multi-niche channel** → niche can hold multiple keyword groups; clips dedupe across
  niches via provider:id.

## 10. Testing strategy (matches the repo's existing vitest unit approach)
- Pure units: `storage` path builders (golden paths per OS sep), `work_items` stage
  computation from fixture rows, **`titleMatchScore()` upload matcher** (missing-word /
  emoji / casing cases, multi-channel hits, below-threshold non-matches), niche
  selection/ranking (scope-to-pool then fuzzy rank), pool prune-by-last-used, Profile→
  Channel/niche migration mapping.
- Integration (where the sandbox allows): backfill migration on a seeded DB; library
  **reorganize dry-run** produces the expected move list + undo log; reorg rollback
  restores original paths.
- No network in tests — reuse the existing `ME_BROLL_FIXTURE` / `ME_BROLL_LOCAL` seams.

## 11. Effort (rough, engineering-days)
P0 ≈ 2–3 · P1 ≈ 2 · P2 ≈ 3–4 · P3 ≈ 3 · P4 ≈ 2 · P5 ≈ 3–4 (incl. migration). Phases are
shippable on their own; P0+P1+P2 already deliver the "resumable channel workspace" the
request centers on.

## 12. Resolved decisions (was: open questions)
1. **Library default** `<Documents>/MentalEmpireStudio` — approved (§3.1).
2. **Niches = global, user-curated list you select from**, each wired to its B-roll pool;
   optional no-API keyword suggestions on create, but assignment is manual (§4.2).
3. **Profiles removed**; automation folds into the Channel; the nav slot becomes the
   Niches / B-roll Pools manager (§6).
4. **"Uploaded" auto-detected** by fuzzy-matching source titles against your own channels'
   uploads, scored, multi-channel (`uploadedTo[]`), with manual override (§2.2a).
5. **Existing files are reorganized** into the library via a safe, transactional,
   previewable + undoable migration (§3.4).
