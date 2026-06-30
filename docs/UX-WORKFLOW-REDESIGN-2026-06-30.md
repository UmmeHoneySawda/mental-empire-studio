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

## 15. Open questions for you

1. **Sources vs Download naming** — call the screen **Sources**, or keep "Download" as the
   verb and add a saved "Sources" sub-section?
2. **Auto-detect uploads** — run it silently in the background always, or behind a setting?
3. **Linking** — should each Source be explicitly linked to the My Channel(s) it feeds, or
   inferred from upload detection?
4. **Automations fold** — do the full migration into Sources/Channels now (P5), or keep the
   lighter reframe and defer the migration?
5. **Dedup strictness** — block re-download of already-uploaded items by default, or always
   allow with a soft confirm?
