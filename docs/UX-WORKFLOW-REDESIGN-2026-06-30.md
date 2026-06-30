# Workflow & UX Redesign — Making Mental Empire Studio Feel Premium

Status: PROPOSAL (for review)
Date: 2026-06-30
Author: product/UX
Scope: the **end-to-end workflow and experience** — information architecture, the mental
model, source-channel persistence, duplicate/upload awareness, and the dashboard/workspace
consolidation. **Out of scope (next plan):** the video compositor and thumbnail editor
internals (filters, caption styles, video styles, multi-layer selection, line breaks,
highlight box color, etc.). Those get their own dedicated document.

This is grounded in the current code: `src/screens/*` (Library, Workspace, MyChannels,
Download, Compose, Profiles, RenderQueue, Niches), `src/store/useData.ts`,
`src/lib/workitems.ts`, `electron/services/mapping.ts`, `electron/services/uploads-detect.ts`,
and the prior `docs/WORKFLOW-REDESIGN-PLAN.md` (P0–P5, already shipped).

---

## 0. TL;DR — what's actually wrong and the five moves that fix it

The app is **feature-complete but conceptually overloaded**. Every capability the user
asked for already exists somewhere — but the app is organized around *tools* (Download,
Compose, Thumbnails, Render) instead of around the user's *job* (turn another channel's
content into a finished, uploaded video on my channel). The result: ten sidebar
destinations, three different places that show "pipeline progress," two different places
that define a source channel, and no single object that says *"here's where you are, here's
what's next."* That is why it feels un-premium and why "anyone would get lost."

The five structural moves:

1. **Make the Source Channel a first-class, persistent object.** Stop forcing the user to
   re-paste a URL and re-fetch every day. A source you pull from is saved, remembers its
   videos, and tracks per-video state.
2. **Collapse the two dashboards into one.** `Library` and `Workspace` both render a
   pipeline board. Merge them into a single, channel-filterable **Home** that is the one
   place to answer "what needs me right now."
3. **Surface "already done / already uploaded" everywhere it matters** — especially *while
   browsing a source channel's videos* — instead of hiding it behind a manual "Detect
   uploads" text link. Run detection automatically.
4. **Give every object a single, obvious "next step."** One primary action per video, per
   channel, per screen. Direction, not a menu.
5. **Reframe Automations as "a source channel running hands-free,"** so there is one place
   to think about a source — not two.

Everything below expands these, with the concrete UI, the data the app already has, and a
phased rollout.

---

## 1. Diagnosis — why it feels un-premium (UX, not CSS)

The visual design is already strong (Linear/Descript-tier dark theme, good typography,
real data). The friction is **structural**. Five root causes:

### 1.1 The app is organized by tool, not by job
The sidebar is a list of *features* grouped "PRODUCE / OUTPUT":

```
PRODUCE: Library · Workspace · My Channels · Download · Compose · Thumbnails
OUTPUT:  Render Queue · B-roll Pools · Automations · Settings
```

A new user has no idea what order to use these in, or which ones are "screens I live in"
vs "tools I dip into." The actual job is a single pipeline:

```
pick a source → download audio → add images/b-roll → captions → thumbnail → render → upload
```

…but the nav doesn't express that pipeline, doesn't show where you are in it, and lets you
land on `Compose` with no project, or `Thumbnails` with nothing loaded, etc. The user is
asked to be the orchestrator. **Premium tools orchestrate for you.**

### 1.2 Three places show "progress," so none of them is *the* place
- `Library` has a **Pipeline** section (per-video stage chips, grouped by source channel).
- `Workspace` is a **To do / In progress / Done** board (the same work items, different
  layout) with a "Resume" button.
- `Render Queue` shows asset-readiness chips per job.

These overlap heavily (`Library`'s `PipelineSection` and `Workspace` read the same
`workItems` and even share helper logic in `src/lib/workitems.ts`). The user literally
asked: *"what is the point of the dashboard and workflow page."* Correct instinct — there
are two answers to one question.

### 1.3 Source channels are stateless and unremembered
This is the sharpest pain. In `Download.tsx` the source channel is a transient text field:
you paste a URL, hit Fetch, `fetchSource()` scrapes live, and **nothing is persisted as a
managed entity.** Tomorrow you paste it again and re-fetch. The app *does* have the pieces —
`Profile.sourceUrl`, `Profile.lastSeenVideoId`, the `source_channels` table referenced in
`useData` (`a.db.sourceChannels()`), niche assignment — but the **Download screen is not
wired to any of them.** So the saved source list (in Automations) and the place you
actually download from (Download) are disconnected. The user experiences this as "why do I
have to enter the channel URL and refetch everything the next day."

### 1.4 Dedup / "is this already uploaded?" exists but is invisible and manual
The user says: *"how do I make sure that same video isn't uploaded again? The app does
nothing about it."* In fact:
- `electron/services/mapping.ts` does Sørensen–Dice token-set title matching at a `0.85`
  threshold.
- `electron/services/uploads-detect.ts` (`runUploadDetection()`) matches every work item's
  title against scraped uploads of *my* channels and persists `uploaded` + `uploadedTo`.
- The Workspace/Library show an `↑ uploaded · N channels` chip.

But this only runs when the user clicks a tiny `Detect uploads` text link, and — critically
— **it is not surfaced at the one moment it matters: when you are choosing which source
videos to download.** In `Download.tsx`, the source grid (`sourceVideos`) shows title,
duration, views, and a selection checkbox — but *no* "already downloaded," "already
rendered," or "already uploaded" badge. So the user re-selects and re-downloads videos they
have already published. The intelligence exists; it's just not where the decision is made.

### 1.5 No directional guidance — too many equal-weight choices
Most screens present a flat field of equally-weighted controls and no "do this next." The
empty states are decent (`Library` zero-state banner, `Download` "Fetch a channel" prompt)
but once there's data, the app stops guiding. There's a "Resume" button on Workspace, but
it's one button on one of two dashboards. Compose throws four tabs (Audio+Image, Captions,
Style, Advanced) at you with no recommended path. Premium apps reduce the number of
decisions visible at any moment and make the next one obvious.

---

## 2. The new mental model (objects & relationships)

Before the UI, fix the nouns. The app has exactly two kinds of channel and one unit of
work. Name them clearly and make them persistent:

| Object | What it is | Today | Target |
|---|---|---|---|
| **My Channel** | a channel I publish *to* (output) | `my_channels` ✓ persistent | unchanged |
| **Source** | a channel I pull *from* (input) | scattered: `Download` URL field + `Profile.sourceUrl` + `source_channels` | **first-class, persistent, managed** |
| **Video** (work item) | one source video moving through the pipeline | `work_items` ✓ | the spine of the whole UI |
| **Automation** | a Source set to run hands-free | `profiles` table / "Automations" screen | a *mode* of a Source, not a separate object |
| **Niche / B-roll pool** | reusable themed footage assigned to Sources | `niches` ✓ | unchanged (works well) |

The single most important relationship to make visible:

```
Source ──(produces)──▶ Video ──(rendered & published to)──▶ My Channel
                                   ▲
                                   └── dedup: "this Video is already uploaded to @X"
```

Once **Source** and **Video** are the two things the user manages, every confusing screen
collapses into a view of one of them.

---

## 3. Information architecture — fewer, clearer destinations

### 3.1 Proposed navigation

```
HOME
  ▸ Home              (was: Library + Workspace, merged — the command center)

CHANNELS
  ▸ Sources           (was: Download — now a saved list of source channels)
  ▸ My Channels       (publish destinations + upload tracking)

CREATE  (contextual — you enter these from a Video, not cold)
  ▸ Compose           (opens with a Video loaded; never empty)
  ▸ Thumbnails        (opens with a Video loaded; never empty)

DELIVER
  ▸ Render Queue
  ▸ Automations       (Sources running hands-free)
  ▸ B-roll Pools
  ▸ Settings
```

Net change: still the same surfaces, but **re-grouped around the mental model** (Channels →
Create → Deliver) and the two redundant dashboards become one. "Download" is renamed
**Sources** because it stops being a one-shot action and becomes a managed place.

### 3.2 What merges, what stays

- **Library + Workspace → Home.** One board. (Section 6.)
- **Download → Sources.** A persistent list of source channels; clicking one opens its
  video browser with full per-video state. (Section 4.)
- **Compose / Thumbnails** stay as deep tools but are *only ever reached from a Video* (via
  Home or Sources), so they are never empty/confusing. Their internal redesign is the next
  plan.
- **Automations** stays as a screen but is reframed and cross-linked with Sources. (Section
  7.)
- **Render Queue, B-roll Pools, Settings** unchanged.

---

## 4. Source channels as first-class objects (kills "re-enter URL & refetch daily")

This is the highest-leverage change. Today `Download.tsx` treats a source as a throwaway
string. Target: a **Source** is saved, browsable, and stateful — exactly like My Channels.

### 4.1 The Sources list (new home for "Download")
Replace the bare URL field with a saved grid of source cards (mirror `MyChannels.tsx`
layout so it feels consistent):

- **Add a source once** (paste URL → scrape name/avatar/stats, persist). After that it
  lives in the list; you never re-paste.
- Each card shows: avatar, name, handle, **assigned niche**, **assigned My Channel(s)** it
  feeds, and a freshness line: *"42 videos · 6 new since last visit · checked 2h ago."*
- Primary action per card: **Open** (browse its videos). Secondary: **Check for new**
  (re-scrape just this source), **Automate** (turn on hands-free), **Edit/Remove**.
- A small `+ Add source` field stays at the top for the first/N-th add.

### 4.2 The source video browser (where downloading happens)
Clicking a source opens its video grid — the current `Download` grid, upgraded so **state
is visible on every card**. Each video tile carries a status badge derived from existing
data (`work_items` + `mapping`/`uploads-detect`):

| Badge | Meaning | Source of truth |
|---|---|---|
| `NEW` | not seen before | not in `work_items` / after `lastSeenVideoId` |
| `Downloaded` | audio pulled | `downloaded_videos.filePath` |
| `In progress` | has project/captions/thumb | `work_items` computed stages |
| `Rendered` | mp4 exists | `render_jobs.done` |
| `Uploaded → @MyChannel` | already published | `uploads-detect` match |

This single addition answers *"how do I make sure I don't download/upload the same video
twice"* — the answer is now **visible at the moment of choosing**, not buried behind a
manual link. Add a filter row: **New · Not downloaded · Not uploaded · All**, defaulting to
**New** so the user sees only fresh work first.

### 4.3 Persistence & freshness (no more daily re-fetch)
- Cache each source's scraped video list in the DB (extend `source_videos` with a
  `sourceChannelId` FK + `scrapedAt`). On open, **show the cached list instantly** and
  refresh in the background ("checking for new…"), appending anything new with a `NEW` dot.
- Track `lastSeenVideoId` / `lastVisitedAt` per source (the field already exists on
  `Profile`; promote it to the source row) so "6 new since last visit" is real.
- Result: open the app tomorrow → click a saved source → instantly see its videos with
  new ones flagged and already-handled ones greyed. Zero re-typing, zero blind re-fetch.

### 4.4 Smarter dedup than title-only
Today `mapping.ts` matches titles via Dice coefficient at `0.85`. Titles are weak for
faceless re-uploads (users rewrite titles). Strengthen dedup with a layered signal, in
priority order:
1. **Source video id** — the strongest key. Persist, per Video, the originating
   `sourceVideoId`; if the user has downloaded it before, it's a hard "already downloaded,"
   no fuzziness. (The old Python app used a `download_history.json` id-set for exactly
   this; we have the id already.)
2. **Audio fingerprint / duration+size heuristic** — two clips with identical duration and
   near-identical file size from the same source are almost certainly the same. Cheap to
   compute; catches re-encodes.
3. **Title similarity (existing Dice)** — keep as the fallback for cross-channel "did I
   already publish this idea somewhere," with the score shown so the user can judge.

Surface the result as the badges in §4.2 and as a soft confirm when selecting an already-
downloaded/uploaded item: *"You've already uploaded this to @MyChannel on Jun 12 — download
again anyway?"*

---

## 5. Upload tracking — closing the loop with My Channels

The user's core anxiety is *"did I already post this?"* The app already scrapes their own
channels' uploads (for stats) and already has `uploads-detect`. Make it a first-class,
automatic loop:

- **Run detection automatically** after every My-Channels scrape and after every render
  completes — not only on a manual link click. (`runUploadDetection()` is idempotent and
  uses data already in the DB; wire it into the existing scheduler/scrape completion path.)
- On each **My Channel** card, add an **"Uploaded from sources"** count and a list: which
  produced videos have been detected live on that channel, with match confidence. This is
  the mirror image of the Source badge and gives the user a trustworthy "published" ledger.
- Keep the **manual `✓ Uploaded` toggle** (already in Workspace/Library) for the cases
  detection misses (heavily rewritten titles), but make auto-detection the default so the
  user rarely needs it.
- When confidence is medium (say Dice 0.6–0.85), show a **"Looks like you uploaded this —
  confirm?"** chip rather than asserting it, so the ledger stays trustworthy.

Net: the app now *does* something about duplicates — proactively, and at both ends (before
download, after upload).

---

## 6. Home — one command center (merging Library + Workspace)

Replace the two dashboards with a single **Home** that is unambiguously *the* place to
answer "what should I do now." It has three stacked zones:

### 6.1 Top: "Needs you" (the action rail)
A short, prioritized list of the few things that actually need a human, e.g.:
- *"3 videos rendered — ready to upload"* → opens the list, links to file/folder.
- *"2 sources have new videos"* → jump to Sources.
- *"1 render failed: missing thumbnail"* → deep-link to fix (this already exists in
  RenderQueue's missing-asset banner; surface it here too).
- *"@MyChannel is behind its weekly goal (2/5)"* → from the existing goals data.

This replaces the vague "Good morning — N channels" header with **decisions**, which is
what a premium tool leads with.

### 6.2 Middle: the Pipeline board (the merged Workspace)
One board, channel-filterable (the chip row already exists in Workspace). Keep the
**To do / In progress / Done** columns — they map cleanly to the user's mental model — and
keep the single **Resume** affordance (`resumeCandidate()` already computes the most-
advanced unfinished item). Each card:
- title, source, the stage chips (`Audio · Images · Captions · Thumb · Render · Upload`),
- **one primary button** = the next step (`nextStepFor()` already returns this),
- secondary: uploaded toggle, archive.

Delete the duplicate `PipelineSection` from Library and the standalone Workspace screen;
this board is the one truth.

### 6.3 Right rail: live activity + auto-status
Keep the existing **Activity** feed and the **Auto-watch/Auto-scrape** status card from
Library (they're genuinely useful and low-noise). Keep the mini render-progress strip
that's already in the sidebar.

### 6.4 Why this is mostly free
Both screens already read the same `workItems` store and share `src/lib/workitems.ts`. This
is a **consolidation + reprioritization**, not new data: merge two components, add the
"Needs you" rail (computed from data already loaded), retire one nav entry.

---

## 7. Automations — "a Source running hands-free" (not a separate concept)

`Profiles`/"Automations" is powerful but reads as a parallel universe to Sources (it even
re-asks for the source URL and re-specifies caption/image/b-roll defaults that also live on
the project). The prior workflow doc (§6.3) already recommended folding profiles into the
channel; this plan endorses the lighter, lower-risk version and stages the full fold:

### 7.1 Immediate reframe (low risk)
- On each **Source** card, an **Automate** switch. Turning it on reveals the cadence
  (off / on new upload / every N hours) and a one-line plain-English summary:
  *"Watches @PowerWithin, makes 1080p Hormozi-caption videos from the Motivational pool,
  auto-renders."* (The "Automations" screen already builds a `pipelineChips` summary — reuse
  it, but in English.)
- The standalone **Automations** screen becomes a **read-only roll-up** ("3 automations
  running, last activity 10m ago") plus the run log, rather than a second place to *define*
  sources. Defining/automating happens on the Source.

### 7.2 Eventual fold (later phase, migration-guarded)
Migrate each `Profile` onto its linked Source/My-Channel as automation settings, with
explicit precedence (**Source automation = defaults; per-video project overrides win at
render time**). Keep the `profiles` table readable for one version for migration, then
retire it. This is exactly the path in `WORKFLOW-REDESIGN-PLAN.md` §6.3 — we just sequence
it after the Sources work so there's one obvious home for it.

### 7.3 Kill the duplicate B-roll control (still outstanding)
The B-roll toggle still appears in multiple spots bound to the same
`betaOpts.broll.enabled`. Keep **one** authoritative control (in Compose's panel, with
density + niche) and make the others **read-only status indicators** that deep-link to it.
(Carry-over from the prior plan §5; reaffirmed here because it directly causes "which
toggle is real?" confusion.)

---

## 8. Direction & guidance — making "what's next" unmissable

Cluelessness is cured by **one obvious next action per object** and gentle wayfinding:

1. **A persistent pipeline ribbon** at the top of Compose/Thumbnails/Render showing the 6
   stages with the current one lit and the next one as the primary button — so even deep in
   a tool you know where you are and where you're going. (The data is the same stage chips
   already computed.)
2. **Never land on an empty tool.** Compose/Thumbnails are only reachable from a Video.
   If somehow opened empty, show a "Pick a video to work on" chooser, not blank controls.
   (`Compose` already auto-opens when there's a single download — generalize this.)
3. **One primary CTA per screen,** visually dominant; everything else demoted to secondary.
   Today several screens have multiple equally-loud buttons (e.g. Download's "Download mp3"
   vs "→ Compose"). Pick the recommended one (→ Compose) as primary, demote the other.
4. **Plain-language labels over jargon.** "Random pool / Sequence," "seed," "Ken Burns,"
   "pace," "phrase" need either renaming or an inline one-liner. (The 2026-06-26 review
   flagged many of these; resolve them as part of wayfinding, not as compositor work.)
5. **Progressive disclosure.** Collapse advanced controls (Advanced effect-plan JSON, seed,
   crossfade math) behind an "Advanced" affordance so the default surface is calm.

---

## 9. First-run onboarding (currently absent)

A premium app earns trust in the first 90 seconds. Add a 3-step, skippable first-run:

1. **Add your first My Channel** (where you publish) — explains "no API key, just stats."
2. **Add your first Source** (where you pull from) — and optionally link it to the My
   Channel it feeds + pick/skip a niche.
3. **One-click "Make my first video"** — pre-selects the newest source video, walks the
   pipeline with the ribbon, ending at a rendered file. This single guided pass teaches the
   whole model better than any tooltip.

After onboarding, Home's "Needs you" rail takes over as the daily driver.

---

## 10. Empty states, feedback & trust details

Small things that make it feel finished:
- **Optimistic, explained loading** everywhere a scrape/download/transcribe runs (the
  add-channel spinner exists; extend the pattern to Sources refresh and detection).
- **Confirm destructive/duplicate actions** with context (re-download already-uploaded;
  delete a source with produced videos).
- **Consistent "done ✓" confirmations** after save actions (the thumbnail "is it saved?"
  confusion from the review is the canonical example).
- **Freshness timestamps** on every scraped surface ("checked 2h ago"), so the user trusts
  what they're seeing without forcing a manual refresh.

---

## 11. Data model deltas (mostly additive, grounded in existing tables)

Nothing here is a rewrite — it's promotion + linking of data that already exists:

- **`source_channels`** (already referenced via `a.db.sourceChannels()`): make it the
  backing store for the **Sources** screen. Add `lastVisitedAt`, `lastSeenVideoId`
  (promote from `profiles`), `linkedMyChannelId(s)`, `nicheId` (already assignable).
- **`source_videos`**: add `sourceChannelId` FK + `scrapedAt` so lists are cached and
  per-source (kills daily re-fetch; enables "N new").
- **`work_items`**: add `sourceVideoId` (for hard id-based dedup) if not already stored;
  everything else (stage booleans, `uploaded`, `uploadedTo`, `uploadMatchScore`) already
  exists.
- **No change** to `mapping.ts` logic except adding the id-first / duration-size dedup layer
  ahead of the title Dice match, and lowering surfacing threshold to a "confirm" band.
- **Scheduler**: call `runUploadDetection()` after My-Channels scrape and render completion
  (wiring only; the function exists and is idempotent).

---

## 12. Phased rollout (each phase ships independently and is reversible)

**P1 — Source-video state badges + auto-detection (highest value, lowest risk).**
Add the `NEW / Downloaded / Rendered / Uploaded` badges + filter to the existing Download
grid; run `runUploadDetection()` automatically; soft-confirm re-downloading uploaded items.
*Delivers the dedup answer immediately, no IA change.*

**P2 — Sources as a persistent list.**
Promote `source_channels` to a managed grid; cache `source_videos` per source with
freshness; "check for new." *Kills the re-paste/re-fetch pain.*

**P3 — Home consolidation.**
Merge Library + Workspace into one command center with the "Needs you" rail; retire the
duplicate pipeline section and the standalone Workspace nav entry.

**P4 — Direction & onboarding.**
Pipeline ribbon in tools, one-primary-CTA pass, plain-language labels, first-run flow,
empty-state polish.

**P5 — Automations reframe (then fold).**
Move automate-on/cadence onto the Source; make Automations a roll-up; later migrate
`profiles` → source/channel settings with precedence rules; collapse the duplicate B-roll
control.

Rough effort (engineering-days): P1 ≈ 2 · P2 ≈ 3–4 · P3 ≈ 3 · P4 ≈ 3–4 · P5 ≈ 3–4
(incl. migration). P1+P2 alone resolve the two sharpest complaints (dedup + re-fetch).

---

## 13. How this maps to exactly what you said

| Your words | The fix | Section |
|---|---|---|
| "workflow doesn't make sense … anyone would get lost … no clear direction" | Job-based IA + one-next-step + pipeline ribbon | 1, 3, 8 |
| "what is the point of the dashboard and workflow page" | Merge Library + Workspace into one Home | 6 |
| "why enter channel URL and refetch everything the next day" | Sources as persistent, cached, stateful objects | 4 |
| "how do I make sure that same video isn't uploaded again … the app does nothing" | State badges at point of choice + auto upload-detection + layered dedup | 4.2, 4.4, 5 |
| "it at least can tell if that video is uploaded" | Auto-run detection + My-Channel "uploaded from sources" ledger | 5 |

---

## 14. Explicitly out of scope (the next plan)

Per your direction, we are **not** touching the compositor/thumbnail editor internals here.
The following are logged for the *next* plan and intentionally deferred:
- Image/B-roll **filters/overlays** — turning them off / customizing them.
- What each **caption style** and **video style** actually does (clarity + control).
- Thumbnail editor: **multi-layer selection**, **line breaks** on text layers, the
  bigger-line / line-gap / word-highlight controls, and **highlight box color**.
- The per-video Compose tab layout/labels (some quick-win label fixes may ride along in P4,
  but the editor redesign is its own document).

---

## 15. Decisions (resolved 2026-06-30)

The five open questions are now resolved. Where the user deferred to product judgment, the
decision below follows what a world-class app does; rationale is included so the call can be
revisited if needed.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Sources vs "Download" naming | **Rename the destination to `Sources`. "Download" becomes an action button inside it.** | Nav items in premium tools are *nouns you manage* (Library, Sources, Channels), not *verbs you perform once*. You manage a list of sources; downloading is something you do to a video within one. Descript/Opus/CapCut never have a "Download" nav item. |
| 2 | Auto-detect uploads: silent vs setting | **Silent + automatic by default, with confidence bands, plus a Settings toggle to disable.** It already runs after every My-Channels scrape (`persistScrape` → `runUploadDetection`); we extend it to run after renders and downloads too. | "Whatever's best" = the user shouldn't have to think about it. Automatic is the premium default; the setting exists only for power users who want manual control. |
| 3 | Linking: explicit vs inferred | **Hybrid: inferred by fuzzy title match (already tolerant of a word or two), *strengthened* by an optional explicit Source→My-Channel link.** The link scopes and boosts confidence; detection still works without it. | The user said they "could change a word or two" in titles — exactly what `shared/match.ts` already handles (Levenshtein-1 per token + plural/prefix tolerance, threshold `0.82`). The explicit link (already present as `my_channels.linkedSourceId`) narrows the candidate set so a reworded title matches more reliably and with fewer false positives. |
| 4 | Automations fold: full vs deferred | **Full plan written now (see §17.5), staged after Sources so there's one home to fold into.** | Requested: "make the full plan… not just what, but how." §17.5 is a complete migration runbook. |
| 5 | Dedup strictness | **Block re-download of already-uploaded videos by default; provide a hidden override.** Hidden override = `Alt/Option-click` the blocked tile → "Re-download anyway" confirm, backed by a `dedup.allowReupload` Settings flag (default off). | The user said "block, but add a hidden way I can do it." The Alt-click + settings escape hatch keeps the default safe while leaving a deliberate, discoverable-by-power-users bypass. |

These decisions are now baked into the implementation guide below.

---

# PART II — Implementation guide (the *how*)

This part is grounded in the actual code read on 2026-06-30. Key facts the plan relies on:

- **`source_channels`** already has columns `id, url, handle, name, nicheId, lastScrapedAt`
  and repo methods `sourceChannels()`, `sourceChannelByUrl()`, `upsertSourceChannel()`,
  `setSourceChannelNiche()` (`electron/db/index.ts`).
- **`source_videos`** already has `id, sourceId, title, durationSec, views, uploadDate,
  thumb, scrapedAt` with `getSourceVideos(sourceId)` / `replaceSourceVideos(sourceId, rows)`.
  **The cache layer the plan needs largely already exists** — `scrape:sourceVideos`
  (`electron/ipc/scrape.ts`) already upserts a `source_channels` row and calls
  `replaceSourceVideos`. It just isn't surfaced as a managed list, and the renderer re-scrapes
  by URL instead of reading the cache.
- **`workItems()`** is a computed read model joining `downloaded_videos` + `projects` +
  `render_jobs` + `work_item_state`. `WorkItem.videoId` = the download id with the `dl-`
  prefix stripped = **the YouTube video id**, which equals `ScrapedVideo.id` from a source
  scrape. That id is the join key for badges.
- **`work_item_state`** holds `uploadedTo` (JSON channel-id array), `uploadMatchScore`,
  `manualUploaded`, `archived`. `setDetectedUploads()` / `setWorkItemUploaded()` already exist.
- **`runUploadDetection()`** (`electron/services/uploads-detect.ts`) calls
  `matchUploads(items, uploads)` from `shared/match.ts` at `DEFAULT_UPLOAD_MATCH_THRESHOLD = 0.82`.
- **`my_channels.linkedSourceId`** already links an output channel to a source; `persistScrape`
  uses it to map downloads→uploads via `mapping.ts` (`matchDownloadsToUploads`, Dice `0.85`).
- IPC is registered in `electron/ipc/register.ts` and exposed to the renderer through the
  typed preload bridge as `window.api.*`; the renderer reads/writes via `src/store/useData.ts`.

> Convention note for every phase: a new repo method needs (a) a method on the `Repositories`
> interface + implementation in `buildRepositories` (`electron/db/index.ts`), (b) an
> `ipcMain.handle` in the relevant `electron/ipc/*.ts`, (c) a matching entry in the preload
> bridge (`electron/preload.ts`) and its type, and (d) a `useData` action. New columns are
> added idempotently via `ensureColumn(d, table, col, type)` inside `migrate()` — never edit
> the `SCHEMA` string for existing installs.

---

## 16. Phase-by-phase implementation

### P1 — Source-video state badges + dedup blocking + always-on detection

**Outcome:** every video tile in the source browser shows its real state, already-uploaded
videos are blocked from re-download (with a hidden override), and detection runs without a
manual click. No IA change yet — lowest risk, highest immediate value.

**1.1 Make detection always-on (main process).**
- It already fires in `persistScrape` (`electron/ipc/scrape.ts`). Add two more call sites:
  - In `electron/ipc/download.ts` `runOne()`, after a successful download
    (`stage: 'Downloaded only'`), call `runUploadDetection()` (import from
    `../services/uploads-detect`). Cheap and idempotent.
  - In the render-completion path (`electron/ipc/render.ts`, where `setRenderStatus(..,
    {status:'done'})` is written), call it again.
- Add a Settings flag `detection.auto` (default `true`) in `electron/store/settings.ts`
  defaults and gate the calls on it. Add `detection.confirmBand: [number, number]` default
  `[0.6, 0.82]` (see 1.4).

**1.2 Add a confidence band to detection (so the ledger stays trustworthy).**
- In `shared/match.ts`, `matchUploads` currently returns only matches `>= threshold (0.82)`.
  Add an optional second threshold so callers can get a "pending/confirm" tier:
  - Extend `UploadMatch` with `confidence: 'high' | 'pending'`.
  - Pass `confirmFloor` (default `0.6`); score in `[confirmFloor, threshold)` → `pending`;
    `>= threshold` → `high`.
- `setDetectedUploads` already persists `uploadedTo` + `uploadMatchScore`. Add a
  `confidence` column to `work_item_state` via `ensureColumn(d, 'work_item_state',
  'uploadConfidence', 'TEXT')` and persist it. `workItems()` already reads `work_item_state`;
  surface `uploadConfidence` on the `WorkItem` type.
- UI treats `high` as "Uploaded" (asserted) and `pending` as "Looks uploaded — confirm?"
  with a one-tap confirm that calls `workItems:setUploaded(videoId, true)` (existing handler).

**1.3 Surface state on every source video tile (renderer).**
- In `src/screens/Download.tsx` (soon `Sources` browser): the store already exposes
  `workItems` (used by Library/Workspace). Build `const byVideo = new Map(workItems.map(w =>
  [w.videoId, w]))`. For each scraped `video.id`, look up `byVideo.get(video.id)`.
- Derive the badge with a small pure helper in `src/lib/workitems.ts`, e.g.
  `sourceVideoBadge(wi?: WorkItem)`:
  - no `wi` → `NEW`
  - `wi.uploaded` (or `uploadedTo.length`) → `Uploaded → @name` (resolve names from
    `myChannels`), with score shown on hover; `pending` → amber "confirm?" variant
  - `wi.rendered` → `Rendered`
  - `wi.captioned || wi.hasImages || wi.hasThumbnail` → `In progress`
  - `wi.downloaded` → `Downloaded`
- Add filter chips **New · Not downloaded · Not uploaded · All**, default **New**. Filter the
  grid by the derived state. (Mirror the existing chip-row pattern from `Workspace`.)

**1.4 Block re-download of already-uploaded (with hidden override).**
- In the source grid, if a tile's `wi.uploaded === true` (high confidence) **and**
  `settings.dedup.allowReupload !== true`: disable the selection checkbox / Download button,
  show a small lock + "Already uploaded to @X."
- Hidden override: `onClick` with `e.altKey` (Option on macOS) on a blocked tile opens a
  confirm dialog ("You already uploaded this to @X on <date>. Re-download anyway?"); on
  confirm, proceed with the normal `download:start`. Also honor a global
  `Settings → Advanced → Allow re-downloading uploaded videos` (`dedup.allowReupload`,
  default off) which removes the block entirely.
- Add `dedup.allowReupload` to settings defaults; expose in Settings under an "Advanced"
  disclosure so it's deliberately out of the way.

**1.5 Files touched (P1).**
`electron/services/uploads-detect.ts`, `shared/match.ts`, `electron/db/index.ts`
(`work_item_state.uploadConfidence` column + `WorkItem` field), `electron/ipc/download.ts`,
`electron/ipc/render.ts`, `electron/store/settings.ts`, `src/lib/workitems.ts`,
`src/screens/Download.tsx`, Settings screen. ~2 eng-days.

---

### P2 — Sources as a persistent, managed list

**Outcome:** "Download" becomes **Sources** — a saved grid of source channels you never
re-paste, each with cached videos and a real "N new since last visit" count.

**2.1 Schema (idempotent migrations in `migrate()`):**
```
ensureColumn(d, 'source_channels', 'avatar', 'TEXT')
ensureColumn(d, 'source_channels', 'lastVisitedAt', 'TEXT')
ensureColumn(d, 'source_channels', 'lastSeenVideoId', 'TEXT')   // promote from profiles
ensureColumn(d, 'source_channels', 'linkedMyChannelId', 'TEXT') // optional explicit link
ensureColumn(d, 'source_channels', 'videoCount', 'INTEGER')
```
`source_videos.sourceId` + `scrapedAt` already exist — the per-source cache is in place.

**2.2 Repo methods (`Repositories` + `buildRepositories`):**
- Extend `sourceChannels()` SELECT to return the new columns; extend `SourceChannel` type in
  `shared/types.ts`.
- `upsertSourceChannel` — extend the INSERT/UPSERT column list with the new fields.
- Add `setSourceCursor(id, { lastSeenVideoId, lastVisitedAt })` (mirror `setProfileCursor`).
- Add `deleteSourceChannel(id)` (transactional: delete the row + its `source_videos`).
- Add `newVideoCountForSource(id)`: read `getSourceVideos(id)`, count entries before the
  stored `lastSeenVideoId` (reuse `newVideos()` logic from `electron/ipc/automation.ts` —
  yt-dlp is newest-first, so "new" = entries before the cursor).

**2.3 IPC (`electron/ipc/scrape.ts` + `register.ts`):**
- Add `sources:list` → `getRepos().sourceChannels()` enriched with cached
  `getSourceVideos(id)` length + new count.
- Add `sources:add(url)` → scrape once (reuse `scrapeChannel`), `upsertSourceChannel`,
  `replaceSourceVideos`, return the row. (Factor the existing `sourceVideos()` body so add +
  refresh share it.)
- Add `sources:refresh(id)` → re-scrape that one source by its stored URL, `replaceSourceVideos`,
  update `lastScrapedAt`/`videoCount`.
- Add `sources:videos(id)` → return cached `getSourceVideos(id)` **immediately** (no network).
- Add `sources:markVisited(id)` → set `lastVisitedAt = now`, `lastSeenVideoId =
  videos[0]?.id` after the user opens/leaves the browser.
- Add `sources:remove(id)`, `sources:setLinkedMyChannel(id, myChannelId|null)`.

**2.4 Renderer (`src/store/useData.ts` + new screen):**
- Add `sources` to the store with actions `loadSources`, `addSource`, `refreshSource`,
  `removeSource`, `openSource(id)` (loads cached videos, fires `markVisited`).
- Rename `src/screens/Download.tsx` → `src/screens/Sources.tsx` and split into two views:
  1. **Sources list** — card grid modeled on `MyChannels.tsx` (avatar, name, handle, niche
     chip, linked-channel chip, "42 videos · 6 new · checked 2h ago"). Primary **Open**;
     secondary **Check for new** (`refreshSource`), **Automate** (P5), **Remove**. A
     persistent `+ Add source` field at top.
  2. **Source detail / video browser** — the P1 badge grid, now fed from cached
     `sources:videos(id)` first, with a background `sources:refresh(id)` that appends new
     items flagged `NEW`. The download action lives here.
- Update `src/components/Sidebar.tsx` + `src/app.tsx` route table: `download` → `sources`
  under a new "CHANNELS" group with My Channels.

**2.5 Freshness UX.** On open: render cached list instantly; show a subtle "checking for
new…" pill; when `refresh` resolves, diff by id and badge additions `NEW`. Never block the
grid on the network. ~3–4 eng-days.

---

### P3 — Home consolidation (merge Library + Workspace)

**Outcome:** one command center; one pipeline board; one "what's next" surface.

**3.1** Create `src/screens/Home.tsx` from `Workspace.tsx` as the base (it already has the
To-do/In-progress/Done board, the channel-filter chip row, `resumeCandidate()` and
`nextStepFor()` from `src/lib/workitems.ts`).

**3.2 "Needs you" rail** (new component, computed from already-loaded store data):
- *N rendered, ready to upload* = `workItems.filter(w => w.rendered && !w.uploaded)`.
- *N sources have new videos* = sum of `newVideoCountForSource` (from P2).
- *Render failures* = `renderJobs.filter(j => j.status==='error')` (+ missing-asset reason
  already computed in `RenderQueue`).
- *Channels behind goal* = `myChannels.filter(c => c.weekDone < c.weekGoal)`.
Each row is a one-line statement + a deep-link action. Sort by urgency (failures → ready →
new → goals).

**3.3 Retire duplicates.** Remove `PipelineSection` from `Library.tsx`; fold its useful
header bits (Activity feed, Auto-watch status card) into Home's right rail. Delete the
`workspace` route + `library` route, point both old paths at `home` (keep a redirect for one
version). Update Sidebar to a single **Home** entry. ~3 eng-days.

---

### P4 — Direction, wayfinding & onboarding

**Outcome:** the app always says "do this next"; no empty tools; calmer surfaces.

- **Pipeline ribbon** — a shared `<PipelineRibbon stage=…/>` component rendered atop Compose,
  Thumbnails, and the render view. Stages: `Audio · Images · Captions · Thumb · Render ·
  Upload`, current lit, next stage as the screen's single primary CTA. Stage state comes from
  the same `WorkItem` booleans (`downloaded/hasImages/captioned/hasThumbnail/rendered/uploaded`).
- **Never-empty tools** — in `src/app.tsx`, guard the `compose`/`thumbnails` routes: if no
  active video/project, render a "Pick a video to work on" chooser (a mini Home board)
  instead of blank controls. Generalize the existing "auto-open Compose when a single
  download exists" behavior.
- **One primary CTA pass** — audit `Download`/`Compose`/`MyChannels` for competing equal-weight
  buttons; demote secondaries to text/ghost buttons. Make `→ Compose` the primary on a
  downloaded video (download itself becomes secondary once the file exists).
- **Plain-language labels** — replace/annotate jargon flagged in `docs/USER-REVIEW-2026-06-26.md`
  ("seed", "Ken Burns", "pace", "phrase", "Random pool/Sequence"). Inline one-liners, not
  tooltips-only. (Editor *internals* stay out of scope; this is label copy only.)
- **Progressive disclosure** — wrap advanced controls (effect-plan JSON, seed, crossfade) in
  an "Advanced" `<details>`-style disclosure so the default surface is calm.
- **First-run onboarding** — a 3-step modal flow (gated by an `app_meta` `onboarded` marker,
  same pattern as the `seeded` marker): add My Channel → add Source → "Make my first video"
  (pre-selects newest source video and walks the ribbon). ~3–4 eng-days.

---

### P5 — Automations fold (full migration runbook)

**Outcome:** automation stops being a parallel "Profiles" universe. A Source can run
hands-free; its settings live on the Source/My-Channel; the `profiles` table is migrated and
then retired. This is the full how, staged in three safe sub-steps.

**Today's reality (confirmed in code):** `profiles` is a wide table that *duplicates* most of
a project's config (`sourceUrl, sourceOrder, sourceCount, imageMode, poolSize, kenBurns,
captionPreset/Font/Anim/Aspect/Lines/Position/Pace, betaOpts, outputFolder, autoWatch,
autoQueueRender, lastSeenVideoId, lastRunAt, thumbnailTemplateId, linkedSourceId`).
`scheduler.tick()` iterates `repos.profiles()` where `autoWatch && sourceUrl` and calls
`runProfile(id, true)`; `runProfile` (`electron/ipc/automation.ts`) does scrape → download →
createProject (applying the profile's caption/image/beta config) → optional transcribe →
optional `sendToRender`.

#### P5.0 — Reframe in the UI first (no schema change, fully reversible)
- Add an **Automate** switch to each **Source** card (from P2). It reads/writes the *existing*
  profile linked to that source (match by `profile.linkedSourceId === source.id`, or
  `profile.sourceUrl === source.url`). Turning it on creates/updates that profile with
  `autoWatch = true`; off sets `autoWatch = false`.
- Render the cadence + a **plain-English summary** built from the profile fields (reuse the
  `pipelineChips` logic already in `Profiles.tsx`, but as a sentence).
- Convert the **Automations** screen to a **read-only roll-up**: list running automations,
  last run (`lastRunAt`), last activity, with an "Edit on Source" link. Stop using it as a
  second place to *define* a source. This step alone removes the "two places define a source"
  confusion and is shippable on its own.

#### P5.1 — Introduce the new home for automation settings (additive schema)
- Add automation columns to `source_channels` via `ensureColumn` (booleans as INTEGER):
  ```
  autoWatch, autoQueueRender, sourceOrder, sourceCount,
  imageMode, poolSize, kenBurns,
  captionPreset, captionFont, captionAnim, captionAspect, captionLines, captionPosition, captionPace,
  betaOpts (TEXT/JSON), outputFolder, thumbnailTemplateId, lastSeenVideoId, lastRunAt
  ```
  (These mirror `PROFILE_COLS`; reuse the same `rowToProfile`/`profileToRow` coercion helpers,
  generalized into `rowToAutomation`.)
- Define a shared `AutomationConfig` type in `shared/types.ts` and a defaults builder, so a
  Source with `autoWatch=false` still has valid render defaults for one-click manual runs.

#### P5.2 — One-time data migration (guarded, idempotent)
- In `migrate()`, after the `ensureColumn`s, run a `migrateProfilesToSources()` guarded by an
  `app_meta` marker (`profiles_folded_v1`), same pattern as `purgeLegacyDemoSeed`:
  ```
  for each profile p:
    sid = p.linkedSourceId
        ?? sourceChannelByUrl(channelUrl(p.sourceUrl))?.id
        ?? upsert a new source_channels row from p.sourceUrl/name
    copy p's automation+render columns onto that source_channels row
       (only if the source's column is null — never clobber newer source data)
    if p.autoWatch -> set source.autoWatch = 1
  set app_meta['profiles_folded_v1'] = '1'
  ```
- Keep the `profiles` table **readable** (do not drop it) for one release so a rollback is a
  config flip, not a data-loss event.

#### P5.3 — Repoint the runtime at Sources
- **Scheduler** (`electron/services/scheduler.ts`): change `tick()` to iterate
  `repos.sourceChannels().filter(s => s.autoWatch && s.url)` and call a new
  `runSource(sourceId, true)`.
- **Runner** (`electron/ipc/automation.ts`): generalize `runProfile` into `runSource(sourceId,
  headless)` that reads the `AutomationConfig` off the source row instead of a profile. The
  body is otherwise unchanged (scrape → download → createProject(apply config) → transcribe →
  sendToRender). Update `setProfileCursor` calls to `setSourceCursor`.
- **Precedence rule (explicit):** the Source's `AutomationConfig` provides *defaults* at
  project-creation time; once a project exists, **per-project edits win** and are never
  overwritten by a later automated run. (Automated runs only set config on `createProject`,
  exactly as `runProfile` does today — so this already holds; document and test it.)
- Update IPC names (`automation:runProfile` → `automation:runSource`, etc.) and the preload
  bridge + `useData` actions; keep thin back-compat shims for one version.

#### P5.4 — Retire profiles
- After one release with no rollback needed, delete the `profiles` table from `DATA_TABLES`,
  remove `PROFILE_COLS`/`rowToProfile`/`profileToRow`, delete `Profiles.tsx`, and remove the
  shims. Track this as a separate cleanup PR.

#### P5.5 — Collapse the duplicate B-roll control (carry-over)
- Keep one authoritative B-roll control (Compose panel: enable + density + niche, bound to
  `betaOpts.broll`). Everywhere else that currently toggles `betaOpts.broll.enabled` becomes a
  **read-only status chip** that deep-links to that control. Removes the "which toggle is
  real?" ambiguity. ~3–4 eng-days incl. migration.

---

## 17. Testing & rollback notes

- **Migrations** are all `ensureColumn`/`app_meta`-guarded and additive → forward-safe; a
  downgrade simply ignores the extra columns. The P5 fold keeps `profiles` readable until
  P5.4, so every step before final cleanup is reversible.
- **Detection** changes are pure where it matters (`shared/match.ts` is dependency-free and
  unit-testable) — add cases for the new `confirm` band and for "title changed by one/two
  words still matches."
- **Dedup blocking** — test the Alt-click override and the `dedup.allowReupload` flag both
  unblock; test that the block keys off **high-confidence** uploads only (a `pending` match
  must not block, only warn).
- **Sources cache** — test that opening a source renders cached `source_videos` with zero
  network, and that a background refresh appends `NEW` items and advances `lastSeenVideoId`
  only on explicit visit.
- Smoke harness (`seedDemoData`) already seeds source channels, downloads, and profiles —
  extend it to assert badge derivation and the profiles→sources migration.

---

## 18. Suggested build order (so each PR is shippable)

1. **P1** (badges + block + always-on detection) — no IA change, immediate payoff.
2. **P2** (Sources list + cache) — kills the re-fetch pain.
3. **P5.0** (Automate switch on Source + Automations becomes read-only) — cheap, removes the
   "two places" confusion, no migration.
4. **P3** (Home consolidation).
5. **P4** (ribbon, never-empty tools, labels, onboarding).
6. **P5.1–P5.4** (the full profiles→sources migration) — last, because it's the highest-risk
   and benefits from Sources + Home already being in place.

P1 + P2 + P5.0 together resolve every complaint in the original message except the
editor-internals ones, which are the explicitly-deferred next plan.
