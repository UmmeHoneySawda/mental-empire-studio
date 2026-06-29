# Workflow Redesign — Channel Workspace, Master Library, Niche B-roll, Profiles

Status: IMPLEMENTED (P0-P5 additive rollout merged; see "Implementation status" below)
Author: engineering
Scope: rework the day-to-day workflow so the app becomes a **resumable, channel-centric
workspace** with an organized on-disk library, niche-based reusable B-roll, a single
B-roll control, and a clearer replacement for "Profiles". Grounded in the current code
(`shared/types.ts`, `electron/db/index.ts`, `electron/services/broll.ts`,
`electron/ipc/compose.ts`, `electron/services/downloader.ts`) and informed by the older
Python app `UmmeHoneySawda/oldytauto`, which already nailed several of these ideas.

---

## Implementation status (2026-06-29)

The P0-P5 workflow redesign has landed as an additive implementation on
`build/mental-empire-studio`:

- **P0 storage foundation:** `electron/services/storage.ts`,
  `electron/services/storage-migrate.ts`, and `electron/ipc/library.ts` route new items
  through the master library layout and provide an opt-in reorganize action for existing
  files.
- **P1 work-item read model:** `work_item_state` plus `getRepos().workItems()` surfaces
  per-video stage chips and manual uploaded/archive state without moving old data.
- **P2 Channel Workspace:** `src/screens/Workspace.tsx`, `src/lib/workitems.ts`, sidebar
  navigation, and persisted last workspace channel implement the resumable board.
- **P3 niche B-roll pools:** `Niche` types, niche DB methods, `electron/ipc/niche.ts`,
  `electron/services/niche.ts`, and `src/screens/Niches.tsx` add named reusable pools
  and channel assignment.
- **P4 pool refresh/usage:** `electron/services/pool-refresh.ts`, scheduler wiring, and
  B-roll usage stamping keep warmed pools fresh and protect recently used clips.
- **P5 automation cleanup:** the old Profiles surface is presented as **Channel
  automations** with clearer copy, pipeline chips, and defaults; the destructive
  Profiles-to-channel migration remains deferred for a later version.

Runtime note: Electron/stock-provider/GPU/scheduler behavior still needs real-hardware
smoke testing. The current in-repo proof is typecheck, production build, unit tests, and
the non-network smoke seams.

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
| `uploaded`   | NEW — user-toggled "uploaded" flag                 |

Most of this is **already derivable** from existing tables — we surface it instead of
re-deriving it ad hoc. The only genuinely new field is `uploaded` (a manual checkbox).


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
  uploaded INTEGER DEFAULT 0,  -- manual flag
  archived INTEGER DEFAULT 0,  -- hide from "to do" without deleting
  createdAt TEXT, updatedAt TEXT
);
```

Stage booleans are **computed** on read (join the FK rows) so they can never drift from
reality; only `uploaded`/`archived` are stored. A migration backfills `work_items` from
existing `downloaded_videos` + `projects` + `render_jobs` on first launch.

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

### 3.4 Migration
On upgrade: detect old locations, and either (a) move existing files into the new tree
and rewrite the stored absolute paths in SQLite, or (b) leave old items where they are
(paths are absolute in the DB, so they keep working) and only apply the new layout to
*new* items. Recommend (b) for safety + an optional "Reorganize library" maintenance
action that performs (a) with a dry-run report.

---

## 4. B-roll: reusable **niche pools** (not per-keyword, not per-render)

### 4.1 What already exists (good news)
`broll.ts` already has a **library** concept: `warmBrollLibraryFromTitles()` scrapes
source titles → themes → downloads reusable clips into
`userData/broll-library/<sourceKey>.json`, and `libraryCandidates()` prefers those local
clips before hitting providers. So "download ahead, reuse" is **partly built** — but it's
keyed by an ad-hoc `sourceKey` (derived from the top 4 themes) and matched per transcript
keyword, which is why multi-niche gets muddy.


### 4.2 The change: first-class **Niche Pools**
Introduce an explicit `Niche` (a.k.a. theme pool) as a named, persistent entity:

```
Niche { id, name ("Motivational"|"Tech"|…), keywords[], orientation, targetClips, updatedAt }
```

- Each **channel** is assigned a niche (1:1 is enough; allow N:1 — many channels share a
  pool). New videos inherit their channel's niche.
- A niche owns a folder `_pools/<niche>/` with its cached clips + a `pool.json` index
  (reuse the existing `BrollLibraryIndex` shape, just re-keyed from `sourceKey` → `niche`).
- **Selection by niche + theme, not exact keyword:** when rendering, pick clips from the
  video's niche pool, *ranked* by soft overlap with the transcript themes (the existing
  `rankCandidates`/`libraryCandidates` scoring already does fuzzy token overlap — we just
  scope the candidate set to the niche pool first, and only fall back to live providers if
  the pool is thin). This means a motivational video pulls from the motivational pool even
  when a stray word ("server") would otherwise drag in tech clips.

### 4.3 Multi-niche handling (the user's explicit question)
- Two niches → two pools under `_pools/`. A video uses **only its channel's niche pool**.
- A clip can be tagged into multiple niches (deduped by provider:id with a hard link /
  copy), so shared "city at night" footage isn't downloaded twice.
- If a channel is genuinely mixed, allow a niche to list **multiple keyword groups**; the
  current `keywordThemesFromTitles()` already buckets titles into theme groups, so we keep
  that but store the result under the niche instead of an anonymous sourceKey.

### 4.4 Periodic refresh
- A scheduler tick (the app already has `scheduler.ts` + auto-scrape cadence) tops up each
  niche pool: re-scrape the assigned channels' recent titles, derive any new themes, and
  fetch up to `targetClips`, skipping ids already present. Prune clips unused for N days
  (track last-used in `pool.json`).
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


## 6. Profiles: what they are, and the recommended rework

### 6.1 What a Profile is today (from the code)
A `Profile` (see `shared/types.ts`) is a **saved automation recipe**: a source channel +
scrape order/count + image mode + caption style + aspect + output folder + beta options +
a thumbnail template + an auto-watch cursor (`lastSeenVideoId`). Running it
(`automation.runProfile`) does: scrape the source → download new videos → build projects →
caption → (optionally) auto-queue render. With `autoWatch`, the scheduler re-runs it when
new uploads appear. So a Profile = "an unattended channel pipeline."

### 6.2 Why it's confusing
- It overlaps heavily with **My Channels** (both hold a source link + cadence + style),
  so users maintain the same info twice.
- The card labels (`rule`, `images`, `thumb`, `cap`, `out`) are opaque display strings.
- It duplicates per-video settings (image mode, captions, b-roll) that also live on the
  project, with no clear precedence story.

### 6.3 Recommendation: fold Profiles into the Channel
Replace the standalone "Profiles" screen with **Channel Automation Settings** living on
each channel in the new Workspace:

- A channel gains an **Automation** tab: source link, cadence (off / on new upload /
  every N hours), default style (caption preset/font/aspect, image mode, niche + b-roll),
  thumbnail template, and `autoQueueRender`. These are exactly today's `Profile` fields,
  re-homed where the user already thinks about them.
- "Run profile" becomes **"Run channel automation now"**; auto-watch becomes the channel's
  cadence setting. The scheduler logic is unchanged underneath — it just iterates channels
  with automation enabled instead of separate Profile rows.
- **Precedence is explicit:** channel automation supplies *defaults*; a per-video project
  can override; the project value always wins at render time.

Migration: convert each existing `Profile` into automation settings on its
`linkedSourceId` channel (or create a channel from `sourceUrl` if unlinked). Keep the
`profiles` table for one version as a read source for the migration, then retire it.

### 6.4 If you'd rather keep them separate
Minimum viable cleanup without the merge: rename "Profiles" → **"Automations"**, replace
the opaque card labels with the real settings, add a plain-language "What this does" line
("Watches @X, makes 1080p videos with Hormozi captions, auto-renders"), and a **Run /
Pause / Run once** trio. Still remove the duplicated b-roll/image controls in favor of a
single source of truth. (The fold-in §6.3 is preferred; this is the fallback.)

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
  pickable in Settings. New items only (no forced migration). Write `project.json` per item.
- Risk: low. Old absolute paths in the DB keep working.

**P1 — Work-item read model + status chips.**
- Add `work_items` table + backfill migration. Surface a per-channel checklist in
  `MyChannels`/`Library` with deep-links. Add the manual `uploaded` flag.
- Risk: low (additive; computed stages).

**P2 — Channel Workspace board + Resume.**
- The To-do / In-progress / Done board, last-open-channel persistence, "Resume" action.
- Risk: medium (UI surface), but data is already there from P1.

**P3 — Niche pools.**
- Add `Niche` table; re-key the existing B-roll library from `sourceKey` → `niche`; scope
  render selection to the niche pool first; assign niche per channel; pool health UI.
- Risk: medium; reuses existing library/ranking code.

**P4 — Periodic pool refresh + asset usage tracking.**
- Scheduler tops up/prunes niche pools; borrow `record_usage` to avoid repeating clips.
- Risk: low–medium.

**P5 — Profiles → Channel Automation.**
- Move Profile fields onto channels; migrate rows; retire the Profiles screen; collapse
  the duplicate B-roll controls to one per scope.
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
  computation from fixture rows, niche selection/ranking (scope-to-pool then fuzzy rank),
  pool prune-by-last-used, Profile→Channel migration mapping.
- Integration (where the sandbox allows): backfill migration on a seeded DB; library
  reorganize dry-run produces the expected move list.
- No network in tests — reuse the existing `ME_BROLL_FIXTURE` / `ME_BROLL_LOCAL` seams.

## 11. Effort (rough, engineering-days)
P0 ≈ 2–3 · P1 ≈ 2 · P2 ≈ 3–4 · P3 ≈ 3 · P4 ≈ 2 · P5 ≈ 3–4 (incl. migration). Phases are
shippable on their own; P0+P1+P2 already deliver the "resumable channel workspace" the
request centers on.

## 12. Open questions for you
1. Library default: `<Documents>/MentalEmpireStudio` OK, or somewhere else?
2. Niche assignment: auto-detect from channel titles, or always pick manually?
3. Profiles: do the full fold-into-Channel (§6.3) or the lighter rename/cleanup (§6.4)?
4. Should "uploaded" be manual-only, or attempt detection via the My-Channels upload scrape?
5. Library reorg of existing files: offer the one-click move, or new-items-only forever?
