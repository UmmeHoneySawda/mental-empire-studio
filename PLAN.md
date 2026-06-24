# Mental Empire Studio — Build Plan

Implementation plan for turning the `Mental Empire Studio.dc.html` design into a real
desktop app. Target: **Electron + React + TypeScript**. Sequencing: **UI-first**
(pixel-perfect React shell with mock data) → then wire the native backend screen by screen.

---

## 0. North star (from the transcript)

> "A creator-grade automation studio you trust to run your entire channel pipeline unattended."

User is a faceless-channel operator running multiple channels, batch-producing daily,
often leaving renders going unattended. The #1 non-functional requirement is **credibility**
— it must feel like Descript / CapCut / Linear, not a sketch. The look is already nailed in
the design; the job is to reproduce it exactly and make it real.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** | System tray, start-on-sign-in, background jobs, local files, native yt-dlp/ffmpeg child processes. |
| Renderer | **React 18 + TypeScript + Vite** | Design already compiles to React; 1:1 port. |
| Routing | **React Router** (hash history) | Maps the 8 sidebar screens; works under `file://`. |
| State | **Zustand** | Light global store for nav, theme/accent, jobs, channels. Matches the prototype's single-component state model without ceremony. |
| Styling | **CSS variables + CSS Modules** (or vanilla-extract) | The design is token-driven (`--accent`, `--accent-deep`, `--accent-soft`, `--accent-glow`, `--accent-ink`). Keep that exact mechanism. |
| Canvas editor | **Konva.js + react-konva** | Layer model, drag, transform, z-order, duplicate, serialize-to-JSON — required for the thumbnail studio. |
| DB | **better-sqlite3** (main process) | Channels, links, download history, jobs, templates, profiles. Synchronous, embedded, no server. |
| Config/secrets | **electron-store** | Settings, proxy string, output folder, accent, toggles. |
| IPC | **contextBridge preload** (typed) | No `nodeIntegration` in renderer; all native work behind a typed `window.api`. |

### Bundled native binaries (sidecars)
- **yt-dlp** — mp3 download + channel/video scraping (no API). Shipped per-platform.
- **ffmpeg / ffprobe** (via `fluent-ffmpeg`) — render image-over-audio, Ken Burns, crossfades, burn captions.
- **whisper.cpp** (or `faster-whisper`) — word-level transcription for the CapCut-style captions.
- **@imgly/background-removal** (in-renderer ONNX) or **rembg** sidecar — subject cutout for thumbnails.

---

## 2. Architecture

```
┌───────────────────────────── Electron Main (Node) ─────────────────────────────┐
│  Tray + auto-launch        Scheduler (auto-scrape)      Job runner (queue)       │
│  ScraperService (yt-dlp)   RenderService (ffmpeg)       TranscribeService        │
│  ThumbnailRasterizer       DB (better-sqlite3)          Store (electron-store)   │
└───────────────▲───────────────────────────────────────────────▲────────────────┘
                │  typed IPC (contextBridge: window.api.*)        │ events/progress
┌───────────────┴───────────────── Renderer (React) ─────────────┴────────────────┐
│  Sidebar shell + 8 screens   Zustand store   Konva thumbnail editor   Theming    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Repo structure
```
/electron
  main.ts              app lifecycle, window (1352×868), tray, auto-launch
  preload.ts           contextBridge → typed window.api
  ipc/                 channel handlers (scrape, download, render, transcribe, fs, settings)
  services/
    scraper.ts         yt-dlp wrappers (channel list, video meta, my-channel uploads)
    downloader.ts      mp3 download w/ rate limit, retries, proxy
    render.ts          ffmpeg pipeline (audio+image(s)+captions → mp4)
    transcribe.ts      whisper → word timings
    thumbnail.ts       headless rasterize template JSON → PNG (batch)
    scheduler.ts       auto-scrape cron + retry/backoff
    notify.ts          desktop notifications + webhook POST
  db/                  schema, migrations, repositories
/src (renderer)
  app.tsx, router.tsx, store/
  theme/tokens.css     all design tokens + 4 accent palettes
  components/          Sidebar, TitleBar, Card, Toggle, ProgressBar, StatusBadge, Sparkline…
  screens/
    Library/  MyChannels/  Download/  Compose/  Thumbnails/  RenderQueue/  Profiles/  Settings/
  features/thumbnail-editor/   Konva canvas, layers panel, inspector
/shared/types.ts       IPC + domain types shared by main & renderer
```

---

## 3. Design system (extracted from the .dc.html — reproduce exactly)

**Fonts** (Google Fonts, bundle locally for offline):
- `Space Grotesk` — display/headings
- `Hanken Grotesk` — body
- `JetBrains Mono` — labels, data, timestamps
- `Anton` — thumbnail & caption display type

**Core tokens**
```
--bg-page:#070809   --bg-window:#0d0f14   --bg-sidebar:#0a0c10
--bg-card:#12151b   --bg-inset:#0e1116    --bg-card-grad:linear-gradient(165deg,#14171e,#0f1217)
--border:#1d2129    --border-2:#23272f    --border-3:#262b34
--text:#e9ebef      --text-strong:#f4f6f9 --text-muted:#8a909c
--text-dim:#6a7180  --text-faint:#5b616f
--ok:#36c98e/--ok-2:#4fd6a0   --warn:#f5b323   --err:#ff5a6e/--err-2:#ff8a96
```

**Accent palettes** (driven by a `data-accent` attr on root; verbatim from the design):
| Accent | hex | deep | soft | glow | ink |
|---|---|---|---|---|---|
| Amber | #f5b323 | #b9780a | rgba(245,179,35,.13) | rgba(245,179,35,.45) | #15120a |
| Violet | #8b7cff | #5b4fd6 | rgba(139,124,255,.16) | rgba(139,124,255,.5) | #ffffff |
| Emerald | #36c98e | #1f9c6b | rgba(54,201,142,.15) | rgba(54,201,142,.5) | #06140e |
| Crimson | #ff5a6e | #d23146 | rgba(255,90,110,.16) | rgba(255,90,110,.5) | #ffffff |

**App-level tweaks** (were DC props; become Settings/Appearance state): `accent`,
`ambientGlow` (radial accent glow on page + main), `showActivityRail`, `defaultScreen`,
active `profile`.

**Window chrome**: 1352×868 frameless window, 16px radius, custom title bar
(traffic-light dots are decorative; real controls via `-webkit-app-region: drag` + custom min/max/close),
mono breadcrumb `studio / {screen}`, ⌘K search, "Render all" CTA, avatar.

**Reusable components to build first**: `TitleBar`, `Sidebar` (+ `NavItem` with active bar/glow),
`Card` (hover lift), `Button` (primary gradient / ghost), `Toggle`, `SegmentedControl`,
`ProgressBar`, `StatusBadge`, `Sparkline` (bar mini-chart), `Chip`, `Table`, `EmptyState`.

---

## 4. The eight screens

Each is a route + screen component fed by the Zustand store (mock data first, real later).

1. **Library** — greeting w/ date, 4 KPI cards (Total views / Subscribers / Uploaded / In queue),
   "Your channels" card grid w/ sparklines, "Recent uploads" table w/ status badges,
   right rail (live Activity + "Next auto-run" w/ Run-now). Toggle rail via `showActivityRail`.
2. **My Channels** — **requirement #1** (see §5.1).
3. **Download** — channel URL → Fetch; source header (Popular/Latest/Oldest + qty + mp3 bitrate);
   video grid w/ multi-select; selection summary; **"Already downloaded" history table**
   (Unfinished/All filter, stage, progress, Resume/Open).
4. **Compose** — tabbed workspace: **Audio + Image** (Sequence vs Random pool, canvas preview w/
   Ken Burns + re-roll + seed, image list w/ even auto-split ranges, audio/image timeline) and
   **Captions** (preset grid, font, animation, keywords/punch toggles, 16:9/1:1/9:16 preview,
   word-level transcript + word timeline w/ ★ emphasis). "Save & send to render."
5. **Thumbnails** — **requirement #4** (see §5.4).
6. **Render Queue** — per-video checklist table (MP3/Images/Thumb/Captions ✓), progress + status,
   output folder picker, format, "Render all". Assembles everything from Compose + Thumbnail.
7. **Profiles** — **requirement #2** (see §5.2).
8. **Settings** — output naming template + preview, render concurrency/quality/encoder,
   **Auto-scrape + Background/tray** (requirement #3, see §5.3), activity log + storage/jobs/version.

---

## 5. The four must-have capabilities (explicit coverage)

### 5.1 Source ↔ my-channel linking + upload mapping  *(req #1)*

**Goal:** add a *source* channel I pull from, link it to one of *my* channels, and have the app
scrape my channel to map which downloaded videos I've already published vs. still pending.

- **Data model**
  ```ts
  MyChannel    { id, url, handle, name, avatar, subs, views, uploadCount, linkedSourceId, weeklyGoal, monthlyGoal, reminderDate }
  SourceChannel{ id, url, handle, name }
  DownloadedVideo { id, sourceId, sourceVideoId, title, durationSec, filePath, stage }
  Upload       { id, myChannelId, title, youtubeVideoId, publishedAt, views, matchedDownloadId? }
  ```
- **Linking UI**: the ↔ chip on each My Channels card (`@PowerWithinOfficial · 12/18 uploaded`).
  "Add channel" → paste URL → scrape stats. "Link source" picker attaches a `SourceChannel`.
- **Mapping logic** (`scraper.scrapeMyUploads` + matcher): scrape my channel's uploads list via
  yt-dlp (`--flat-playlist --dump-json`), then fuzzy-match each downloaded video title against my
  uploaded titles (normalized Levenshtein / token-set ratio, threshold ~0.85; manual override link).
  `mapDone = matched count`, `mapTotal = downloaded count`, drives the chip + pending count.
- **Goals & reminders**: weekly/monthly progress bars from `uploadCount` deltas; per-channel
  reminder date fires a **desktop notification** when behind pace (per user: native notifications;
  they wire Pushover/calendar themselves via the webhook field). Per-channel row is enough — no calendar view.
- Explicit in copy: *my* channels are scraped too (views/subs/uploads), entirely separate from source channels.

### 5.2 Per-profile quick flow  *(req #2)*

**Goal:** pick a channel/profile, quickly edit 1–2 videos + thumbnails, push to render queue,
then repeat for the next profile.

- **Profile entity** bundles the whole pipeline:
  ```ts
  Profile { id, name, myChannelId, sourceRule:{order:'popular|latest|oldest', count},
            imageMode:{type:'single|pool', poolSize, kenBurns, seedLock},
            thumbnailTemplateId, captionPreset, captionAspect, outputFolder, autoWatch }
  ```
- **Flow**: Profiles page → **Run** → app fetches per `sourceRule`, downloads mp3s, applies the
  profile's image/caption/thumbnail defaults → drops 1–2 into a **quick-edit** step (Compose +
  Thumbnail prefilled from the template) → **"Push to render queue"** → return to Profiles, pick the
  next one. Render Queue accumulates across profiles.
- **Auto-watch**: when enabled, scheduler re-runs the profile hands-free when the linked source posts
  (the "Auto-watch active" sidebar widget + "WATCHING" badge reflect this state).

### 5.3 Auto-scrape settings + background/tray  *(req #3)*

**Goal:** automatic scraping with frequency, request delay, retry count, optional proxy; run in the
background in the Windows system tray and start on sign-in.

- **Settings → Auto-scrape card**: enable toggle, frequency (`Every 6h…` enum → cron),
  request delay (e.g. `1.5s` between yt-dlp calls), **retries on fail** (`3×` w/ exponential backoff),
  **proxy** (`http://user:pass@host:port` → yt-dlp `--proxy`), imported sign-in cookies for age-gated.
- **Scheduler** (`scheduler.ts`): cron-like timer in main; on tick, iterate watched profiles,
  throttle requests by the configured delay, retry w/ backoff, write results to DB, emit activity-log
  events, fire notifications on new uploads / errors.
- **Background + tray** (`main.ts`): `Tray` with menu (Open / Pause auto-scrape / Quit);
  close-to-tray (hide window, keep running); **`app.setLoginItemSettings({ openAtLogin, openAsHidden })`**
  for start-on-Windows-sign-in; desktop **Notifications**; optional **webhook POST** (Pushover/calendar)
  from the "Webhook" field. All four toggles in the Background card map to these.

### 5.4 Thumbnail studio  *(req #4)*

**Goal (verbatim breakdown):** choose a subject *or* an image that already contains the subject →
styled text → highlight one word with optional **square background** + chosen **highlight color** →
**per-line** bigger/smaller typography in a text layer → **auto-arrange** button for the best
multi-line layout → **multiple text layers**, **duplicate layer**, **shapes** → subject **glow/shadow**
→ **solid color or image background** → **save per-profile template (.psd-like)** to reuse later.

- **Editor**: **Konva** stage at 16:9 (1280×720 logical). Layer types:
  `Background` (solid swatch or image), `Subject` (cutout or full image-with-subject),
  `Text` (multi-line, per-line size), `Shape` (rect/circle/arrow/badge).
- **Layers panel**: list w/ select, **duplicate (⧉)**, visibility (👁), lock (🔒), reorder. Add via toolbar.
- **Subject**: two modes — **Cutout** (run background removal → PNG w/ alpha, then Outline/Shadow/**Glow**
  via Konva filters/shadow) or **Image w/ subject** (use as-is). Replace via .PSD/PNG import.
- **Text inspector**: text content; **per-line size** sliders (Line 1 / Line 2 …); **highlight word**
  chips → toggle **Square background** + **color** picker (white/yellow/red/cyan + custom);
  effects (Shadow / Stroke / Glow / Caps).
- **Auto-arrange type**: one-click heuristic (no off-the-shelf plugin — confirmed in transcript).
  Algorithm: balance line lengths, scale the highlighted word up, place the block in the largest empty
  region given subject position (title-safe inset), pick weight/case for contrast. Implement as a
  scoring function over a few candidate layouts; can later swap in Satori-based measurement.
- **Background**: solid color swatches **or** "Use image background".
- **Templates (.psd-like)**: serialize the full layer tree to JSON (`ThumbnailTemplate`), saved
  **per profile**. "Save as profile template" + the template rail ("+ Save current"). Subject/background/
  style are *locked*; only headline text changes per video.
- **Batch generate**: paste N titles → `thumbnail.ts` rasterizes the locked template per title
  (auto-fit + highlight) into a PNG grid, headless via the same Konva scene on an offscreen canvas
  (or node-canvas in main for true batch). Feeds Render Queue's THUMB column.

---

## 6. Render pipeline (Compose + Queue → mp4)

`render.ts` via fluent-ffmpeg, per queued video:
1. Inputs: mp3 (audio length = master duration), 1..N images, thumbnail PNG, caption track.
2. **Single image** → full-length still; **multiple** → even auto-split across audio length
   (manual override) with optional **Ken Burns** (zoom/pan) + **crossfade**; **Random pool** mode
   shuffles order + motion per render with a lockable **seed**.
3. **Captions**: from whisper word timings → render CapCut-style preset (Pop/Bold/Hormozi/Word/Neon/Minimal)
   with karaoke highlight, keyword auto-emphasis, punch-zoom; burn in via ffmpeg (ASS subtitles or
   pre-rendered PNG overlay sequence for exotic effects). Aspect 16:9 / 1:1 / 9:16.
4. Output named by Settings template (`{channel} - {title}` / `{date}_{title}`), to the chosen folder,
   at chosen quality/encoder (H.264 GPU). **Parallel renders** = concurrency setting; progress streamed
   to the Queue rows.

---

## 7. Data & persistence (better-sqlite3)

Tables: `my_channels`, `source_channels`, `downloaded_videos`, `uploads`, `profiles`,
`thumbnail_templates`, `render_jobs`, `activity_log`, plus `electron-store` for settings/secrets.
Scraped stats cached with timestamps; "Re-scrape" forces refresh.

---

## 8. Milestones

| # | Milestone | Output |
|---|---|---|
| **M0** | Scaffold | Electron+Vite+TS, frameless 1352×868 window, hash router, theme tokens + 4 accents, base components. |
| **M1** | UI shell (all 8 screens, mock data) | Pixel-perfect port of the design, full nav, accent/glow/rail tweaks, Compose tabs, Konva thumbnail editor interactive (local state). **This is the design-faithful deliverable.** |
| **M2** | Persistence + IPC plumbing | SQLite schema, electron-store, typed preload, settings actually save. |
| **M3** | Scraping (req #1 + #3 data) | yt-dlp channel/video/my-uploads scrape, proxy/delay/retries, upload mapping + goals/reminders. |
| **M4** | Download + Compose backend | mp3 download w/ resume/history; whisper transcription; image list + ranges. |
| **M5** | Thumbnail engine (req #4) | Background removal, template save/load, auto-arrange heuristic, batch rasterize. |
| **M6** | Render pipeline | ffmpeg image+audio+captions, Ken Burns, presets, concurrency, output naming. |
| **M7** | Automation (req #2 + #3) | Profiles run → quick-edit → queue; scheduler/auto-watch; **tray + start-on-sign-in + notifications + webhook**. |
| **M8** | Packaging | electron-builder installers (Win primary, then Mac), bundled yt-dlp/ffmpeg/whisper sidecars, auto-update. |

---

## 9. Risks / open notes

- **Scraping fragility**: YouTube HTML/yt-dlp changes — isolate in `scraper.ts`, pin/auto-update yt-dlp,
  honor request delay + retries to stay polite (user's own channels + chosen sources).
- **Auto-arrange typography**: bespoke heuristic, not a third-party plugin (confirmed). Ship a good v1,
  iterate.
- **Subject cutout** quality: `@imgly/background-removal` is fully local (no upload); rembg is heavier
  but higher quality — offer both.
- **Binary size / signing**: bundling ffmpeg+whisper is large; code-sign Windows build to avoid the very
  "scam/virus" perception the user called out.
- **Legal/ToS**: tool is for the user's own channels + chosen sources; downloads/scrapes are user-driven.

---

## 10. First action on approval

Start **M0 + M1**: scaffold the Electron/React/TS app and port all eight screens pixel-perfect with mock
data — reproducing the exact tokens, fonts, accent system, and layout from `Mental Empire Studio.dc.html`
— so the look is locked before any backend work begins.
