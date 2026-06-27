# Mental Empire Studio — Render & Styling Engine Blueprint (v1)

> **Purpose.** A self-contained, enterprise-grade execution plan to take the video
> render/styling subsystem from "2007-era output" to a "million-dollar software" look
> (CapCut / Submagic / Opus-Clip tier). It is written so **any engineer or AI agent can
> execute it without further context** — every workstream states the problem, the
> research basis (real tools/specs), the target values, the concrete implementation,
> the files touched, and the acceptance tests.
>
> **Scope.** Render engine (ffmpeg), caption engine, cinematic finish, audio mastering,
> B-roll engine, GPU pipeline, render feedback/observability, the data/scraping polish
> items, the UI/UX design system for Compose + Render, and the quality/test
> infrastructure. The previously-agreed **Tasks 1–5** are folded in (see §3 mapping).
>
> **Status of repo at time of writing:** branch `build/mental-empire-studio`, head
> `e090c0f`. Render path: `electron/services/{render,queue,broll,captions,sfx,audio}.ts`
> + `electron/ipc/{render,compose}.ts` + `src/screens/{RenderQueue,Compose}.tsx` +
> `src/store/useData.ts` + `shared/types.ts` + `shared/effectPlan.ts`.

---

## 0. How to use this document

1. Read §1 (current state) and §2 (target architecture) for orientation.
2. Execute workstreams in §3 in the **phase order** given in §6. Each workstream is
   independently shippable behind its acceptance gate.
3. Use §9 (Appendix: reference recipes) as copy-paste-grade source-of-truth for the
   exact ffmpeg/ASS strings — these are derived from the research in §10, not invented.
4. Every change must keep `npm run typecheck && npm run build` green and the
   `ME_SMOKE` matrix green (§7).

---

## 1. Current-state assessment — every reported defect → root cause

| # | Symptom (user words) | Root cause | Location |
|---|---|---|---|
| D1 | "captions are very bad / one looks bigger" | Single static ASS line; emphasized words get a per-word `\fscx` that changes their size mid-line → inconsistent sizing. No word-by-word system, no active-word highlight. | `electron/services/captions.ts` |
| D2 | "2007–2008 editing app / not professional" | Generic centered subtitle; wrong font/size/position; no karaoke color sweep, no pop animation, no keyword box. | `captions.ts` |
| D3 | "cinematic effects I wanted… not there" | "Cinematic" style only swaps an `xfade` type + a caption "lead". No color grade, grain, vignette, or zoom cadence. | `shared/effectPlan.ts`, `render.ts` |
| D4 | "why is it 47 seconds" (19-min audio) | **Correctness bug.** Duration mis-probe (music-metadata misreads VBR mp3) and/or `-shortest` truncation by a shorter input (SFX/bed). | `audio.ts`, `render.ts`, `queue.ts` |
| D5 | "GPU 0%, ffmpeg CPU 100%" | Final render defaults to `libx264`; **B-roll bed is hardcoded `libx264 -preset veryfast`** and ignores the encoder setting; everything is CPU. | `broll.ts:assembleBed`, `render.ts:videoCodecArgs` |
| D6 | "render takes forever" | B-roll = a full-length **pre-encode** (bed) **then** a second full encode; bed uses **87 chained `xfade`** filters (pathological). Two passes, CPU-bound. | `broll.ts`, `queue.ts` |
| D7 | "stuck at 0%, show me the stage / CPU or GPU" | `queue.ts` emits no progress during B-roll fetch + bed assembly; only `stage:'rendering'` once the final ffmpeg starts. No ETA, no device, no stage. | `queue.ts`, `render.ts`, `shared/types.ts` |
| D8 | "fetching now takes 60s (was fast)" | Regression: Download picker switched to **non-flat** yt-dlp to get views. Non-flat is slow. | `electron/ipc/scrape.ts`, `electron/services/scraper.ts` |
| D9 | "views unavailable / age column empty / 0 views" | My-channel scrape uses `--flat-playlist` → no per-video `view_count`/`upload_date` → channel total = 0, rows blank. | `scraper.ts`, `electron/ipc/scrape.ts`, `src/screens/Library.tsx` |
| D10 | "downloading text line-break/clip" | Download history row lets the status text wrap instead of ellipsizing. | `src/screens/Download.tsx` |

---

## 2. Target architecture — the "million-dollar" structure

### 2.1 Layered architecture (unchanged shell, hardened core)

```
┌───────────────────────────────────────────────────────────────────┐
│ Renderer (React) — Design System + Screens                         │
│   Compose Studio · Render Queue (stage stepper) · Style Gallery     │
│   state: useStore (UI) · useData (live IPC/DB)                      │
└───────────────▲───────────────────────────────────────────────────┘
                │ typed window.api (preload, contextIsolation)
┌───────────────┴───────────────────────────────────────────────────┐
│ Main · IPC handlers (electron/ipc/*) — thin, validate + delegate    │
├────────────────────────────────────────────────────────────────────┤
│ RENDER ENGINE (new, staged DAG) — electron/services/engine/*         │
│   Stage pipeline · Capability probe · Progress bus · Cache           │
│   ├ stages: prepare→transcribe→broll→assemble→grade→caption→encode   │
│   ├ FfmpegGraph builder (pure, testable) → arg arrays                │
│   ├ Encoder abstraction (cpu/nvenc/qsv/amf) + fallback               │
│   └ Audio master (loudnorm 2-pass) + SFX/duck                        │
├────────────────────────────────────────────────────────────────────┤
│ Domain services: scraper · downloader · captions · broll · audio     │
│ Persistence: better-sqlite3 (migrate + repos) · electron-store       │
└────────────────────────────────────────────────────────────────────┘
```

**Key principle:** the render becomes a **typed, staged pipeline (a DAG)** — mirroring
how production tools (Remotion server render, Revideo, MoneyPrinterTurbo's
`task.py` stage chain) structure work: each stage is *idempotent*, *cacheable*,
*cancellable*, and *emits structured progress*. This is the backbone for D6/D7 and for
everything in §3.

### 2.2 The Render Engine (`electron/services/engine/`)

- `pipeline.ts` — orchestrates ordered `RenderStage[]`; each stage:
  `{ id, label, weight, run(ctx, onProgress) }`. The pipeline computes a **global %**
  from per-stage weights, emits `RenderProgress` (stage, detail, pct, etaSec, device,
  encoder), supports **cancel** (kills the active child — already partly built via
  `cancelRender`), and writes a per-job **render log**.
- `graph.ts` — **pure** ffmpeg filtergraph + arg builder (no spawning). Everything here
  is unit-asserted (string asserts), exactly like today's `buildRenderArgs`. This is the
  single source of truth for the command line.
- `encoder.ts` — `Encoder` abstraction: `selectEncoder(settings, caps)` →
  `{ codecArgs(crfOrCq), hwFilterIn?, hwFilterOut?, decodeArgs? }` for cpu/nvenc/qsv/amf,
  with **automatic fallback to libx264** if a hardware encode fails (try/catch + retry).
- `caps.ts` — **capability probe** run once at startup (and cached): parse
  `ffmpeg -encoders`/`-hwaccels`, test a 1-frame NVENC encode, detect GPU vendor. Stored
  in app state and surfaced in Settings ("GPU: NVIDIA detected — NVENC available").
- `progress.ts` — ffmpeg `-progress pipe:1` parser → `{ outTimeSec, fps, speed, bitrate }`
  → ETA = `(totalSec - outTimeSec) / max(speed, 0.01)`.

### 2.3 Capability detection (fixes the root of D5)

At boot, probe and persist:
- `hasNvenc`, `hasQsv`, `hasAmf`, `gpuVendor`, `ffmpegHasLibass`, `ffmpegHasCuda`.
Render engine and Settings both read this. The encoder dropdown only offers what the
machine supports; "NVIDIA GPU (NVENC)" is disabled with a tooltip when absent instead
of failing at render time.

### 2.4 Observability

- A structured `render.log` per job (stage timings, the exact ffmpeg args, stderr tail).
- `RenderProgress` carries `{ jobId, stage, stageDetail, pct, etaSec, speed, device,
  encoder, done, error }`. The Render Queue UI renders a **stage stepper + ETA + device
  chip** (§4). Optional webhook/telemetry event on completion (reuse M7 webhook).

---

## 3. Workstreams (execution specs)

> Each workstream: **Problem → Research basis → Target spec → Implementation → Files →
> Acceptance.** Tasks **1–5** from the prior agreement map as: T1→WS2, T2→WS8, T3→WS1,
> T4→WS8, T5→WS2/WS7. Plus **T6 (47s bug)→WS3**.

### WS-1 — Render feedback & observability  *(was Task 3; the deep version)*

**Problem:** D7 — frozen "0% / Rendering", no stage, no device, no ETA.

**Research basis:** ffmpeg `-progress pipe:1` emits `out_time_us`, `fps`, `speed`,
`bitrate`, `progress=continue|end` (one block per stat interval). ETA from `speed`
is the standard approach. Multi-stage progress is how Remotion/Revideo/MoneyPrinter
report ("bundling → rendering frames → stitching").

**Target spec:** a visible pipeline:
`Preparing → Transcribing → Fetching B-roll (n/N) → Assembling → Grading → Captioning →
Encoding (CPU|GPU) → Finalizing → Done`, each with its own % and a global %, plus a
live **ETA** ("~14 min left · 0.4×") and the **encoder/device** in use.

**Implementation:**
1. Extend `RenderProgress` (shared/types.ts) with `stage`, `stageDetail`, `pct`,
   `etaSec`, `speed`, `device`, `encoder`.
2. `engine/progress.ts` parser; `engine/pipeline.ts` emits per stage with weights
   (suggested weights: transcribe 5, broll-fetch 15, assemble 15, grade 10, encode 50,
   finalize 5).
3. `broll.ts` emits download progress (clips done/total) and assemble progress
   (ffmpeg -progress on the bed).
4. UI: Render Queue row → a horizontal **stepper** with the active stage pulsing, an
   ETA string, and a device chip (`CPU` / `GPU·NVENC`).

**Files:** `shared/types.ts`, `electron/services/engine/{pipeline,progress}.ts`,
`electron/services/{queue,broll,render}.ts`, `electron/preload.ts` (already streams
`render:progress`), `src/store/useData.ts`, `src/screens/RenderQueue.tsx`.

**Acceptance:** dry-run smoke asserts every stage fires in order with monotonic global
% and a non-null `etaSec` during encode; `device`/`encoder` reflect the chosen encoder.

---

### WS-2 — GPU / encoder pipeline  *(Tasks 1 & 5: B-roll GPU + speed)*

**Problem:** D5/D6 — CPU-only; B-roll bed hardcoded `libx264`; double encode.

**Research basis (concrete):**
- A *full* GPU pipeline keeps frames in VRAM: `-hwaccel cuda -hwaccel_output_format cuda`
  for decode, `scale_cuda`/`overlay_cuda` on-GPU, `h264_nvenc`/`hevc_nvenc` encode. Any
  **CPU-only filter (e.g. `subtitles=`/`ass=`) forces a `hwdownload,format=nv12` to system
  RAM and a `hwupload_cuda` back** — the PCIe round-trip — so the subtitle burn must be
  bracketed by `hwdownload … subtitles=… hwupload_cuda`. (NVIDIA FFmpeg guide; RenderIO.)
- NVENC quality: presets `p1`(fastest)…`p7`(best); `-rc vbr -cq <N>` constant-quality
  (lower = better, ~19–23 sweet spot); `-tune hq`. HEVC option `hevc_nvenc` for smaller
  files. (NVIDIA Video Codec SDK 10 preset model.)

**Target spec:**
- `encoder.ts` returns, per device:
  - **cpu:** `-c:v libx264 -preset medium -crf <19–23> -pix_fmt yuv420p`
  - **nvenc:** `-c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq <19–23> -b:v 0 -pix_fmt yuv420p`
    (optional `-c:v hevc_nvenc` "smaller files" mode)
- **B-roll bed uses the same encoder abstraction** (kills D5's hardcode).
- **Eliminate the double encode for the common path:** composite B-roll directly in the
  *final* graph (one pass) when feasible; only fall back to a pre-rendered bed when the
  graph would exceed input limits.
- When NVENC is active and captions must burn, bracket with `hwdownload,format=nv12,
  subtitles=…,hwupload_cuda` so we keep GPU encode.

**Implementation:** add `engine/encoder.ts` + `engine/caps.ts`; route both `render.ts`
and `broll.ts` through it; thread `settings.encoder` + caps into `graph.ts`; add the
NVENC fallback wrapper around the spawn (`catch → re-run with cpu`).

**Files:** `electron/services/engine/{encoder,caps,graph}.ts`,
`electron/services/{render,broll}.ts`, `shared/types.ts` (encoder enum already added:
`'cpu'|'nvenc'`; extend to `'qsv'|'amf'` later), `src/screens/Settings.tsx`.

**Acceptance:** `graph.ts` asserts NVENC args appear when device=nvenc and the subtitle
burn is bracketed by hwdownload/hwupload; B-roll bed args use the selected codec; a
forced-NVENC-failure test falls back to libx264 and still completes (dry-run).

---

### WS-3 — Correctness: the 47-second bug + sizing  *(Task 6)*

**Problem:** D4 (47s output) and the D1 sizing inconsistency.

**Research basis:** `music-metadata` derives duration from headers and **misreports VBR
MP3s without a Xing/Info frame**; `ffprobe -show_entries format=duration` decodes the
container and is authoritative. `-shortest` ends output at the **shortest** input, so a
short SFX/bed truncates everything.

**Target spec & implementation:**
1. **Duration source of truth:** probe with `ffprobe format=duration` in `audio.ts`;
   keep `music-metadata` only as a fast hint. If they disagree by >2%, trust ffprobe.
   Persist the true `durationSec` on the project; re-probe on render.
2. **`-shortest` audit:** never let SFX/bed/music be shorter than the voice track —
   either `-t <trueDuration>` on every branch (already partly done) **and** `apad` the
   audio or loop short visual beds to cover full length; drop `-shortest` where `-t` is
   pinned.
3. **Uniform caption sizing:** every active/emphasized word uses the **same** target
   scale (e.g. `\fscx112\fscy112` settle), so no word is randomly bigger (D1).

**Files:** `electron/services/audio.ts`, `electron/services/{render,queue,broll}.ts`,
`electron/services/captions.ts`.

**Acceptance:** render a 19-min fixture → output duration within ±1s of audio (ffprobe
asserted); a project with a 5s SFX still yields full-length video; caption smoke asserts
all emphasized words share one scale.

---

### WS-4 — Caption Engine v2 (the headline visual)  *(addresses D1, D2)*

**Problem:** captions look amateur.

**Research basis (exact specs from real tools):**
- **CapCut/Hormozi spec:** heavy condensed sans — **Montserrat Black / Anton / Bebas
  Neue**, **ALL-CAPS**; size ≈ **10–15% of frame height** (~80–120px on 1080×1920);
  **1–4 words on screen**; **thick black stroke**; **bright-yellow active/keyword**
  `#FFD93D`–`#FFEE33`; word-by-word; block at **60–70% screen height**. (Submagic, Ascynd.)
- **Remotion TikTok engine:** `createTikTokStyleCaptions({ combineTokensWithinMilliseconds })`
  — **low ms ⇒ word-by-word**; active word colored (`#FFD700`) + **glow** via layered
  `textShadow`; **spring pop** `spring({ damping: 10, mass: 0.5 })` ("snappy not bouncy").
- **ASS karaoke recipe:** per-word `\k`/`\kf` (**centiseconds**) for the color sweep;
  per-word pop via `\t(0,120,\fscx112\fscy112)` (**milliseconds**); `\fad(40,40)`; ASS
  colors are **BGR** → yellow `#FFD93D` = `&H003DD9FF`, white `&H00FFFFFF`, black outline
  `&H00000000`. (JosiahSiegel ffmpeg-karaoke skill; VidNo.)

**Target spec (our 16:9-first app, aspect-aware):**
- Font: **Anton** (already bundled) or **Montserrat Black**, ALL-CAPS.
- Size: `fontPx = round(0.085 * frameHeight)` for 16:9 (≈92px @1080), `0.11*H` for 9:16,
  clamped; line ≤ ~2 words for 16:9 lower-third, ≤ 4 for shorts.
- Grouping: **active-word karaoke** — show a short phrase window (1–4 words), the
  spoken word in **yellow `&H003DD9FF`** (or a filled rounded box behind it, CapCut
  style), the rest white; **uniform pop** `\t(0,120,\fscx112\fscy112)` then settle.
- Outline 3–4px black + soft shadow; position `Alignment=2`, `MarginV` ≈ 22–30% from
  bottom (lower third / 60–70% height).
- Keyword auto-emphasis stays, but renders as the **same** highlight treatment (color/
  box), never a different font size.

**Two routes (decision required — see §8):**
- **Route 1 — ASS v2 (recommended first):** rewrite `buildAss` to emit the spec above
  (phrase windows, `\k` sweep, uniform `\t` pop, BGR colors, aspect-aware size). Pure,
  offline, no new deps, burns via libass. Ships ~90% of the perceived improvement.
- **Route 2 — Remotion caption layer (premium, optional):** render captions with
  `@remotion/captions` + `createTikTokStyleCaptions` in a headless Chromium pass →
  transparent overlay (PNG sequence or WebM with alpha) → composite in ffmpeg. True
  spring physics, glow, emoji, gradients. Adds a Node/Chromium render path + build size.

**Files:** `electron/services/captions.ts` (Route 1), `shared/effectPlan.ts` (presets),
`src/screens/Compose.tsx` (live preview), optional `electron/services/engine/captions-remotion/*`.

**Acceptance:** golden-frame test (§7) at a fixed timestamp matches the reference
(Anton, lower-third, one yellow active word, uniform size); ASS `\k` tags present;
emphasized words share one scale.

---

### WS-5 — Cinematic finish (grade + grain + motion + transitions)  *(D3)*

**Problem:** "cinematic" is just a transition name.

**Research basis (concrete ffmpeg):**
- **Color grade:** `lut3d=file=<look>.cube` (ship 2–3 `.cube` LUTs: teal-orange, moody,
  warm), or built-in `curves=…`/`colorbalance`; apply at ~60–70% strength (blend).
- **Film grain:** `noise=alls=8:allf=t` (subtle, luma-ish, temporal).
- **Vignette:** `vignette=PI/5`.
- **Letterbox** (cinematic preset): pad to 2.39:1 bars.
- **Motion cadence:** slow consistent `zoompan` (Ken Burns) + **few, slow** dissolves —
  not the current 87-xfade firehose.
- **Transitions:** `xfade` has 40+ types but is **linear/abrupt**; **`xfade-easing`**
  (scriptituk) provides GLSL-ported transitions **as custom expressions — no ffmpeg
  rebuild**, with easing envelopes. (For full GL transitions, `ffmpeg-gl-transition`
  needs a source build — avoid for now.)

**Target spec — Style presets become real recipes:**
- **Cinematic:** teal-orange LUT @65% + slow 1.05× zoom + 0.5s eased dissolves + grain
  + vignette + optional 2.39 letterbox; caption pop subdued.
- **Intense:** punchy contrast grade + fast hard cuts + larger caption pop + slight
  shake on emphasis.
- **Clean:** no grade, minimal motion, crisp captions.
- **Heartfelt:** warm LUT, soft cross-dissolves, gentle zoom.

**Implementation:** a `grade.ts` filter-fragment builder keyed by preset (returns the
LUT/curves/noise/vignette chain inserted before the subtitle burn); a `transitions.ts`
that emits `xfade-easing` expressions; presets defined once in `shared/effectPlan.ts`
and consumed by `graph.ts`. Ship LUT `.cube` files under `resources/luts/` (fetched by
`fetch:bin` or bundled).

**Files:** `electron/services/engine/{grade,transitions,graph}.ts`,
`shared/effectPlan.ts`, `resources/luts/*`, `src/screens/Compose.tsx` (preset gallery).

**Acceptance:** `graph.ts` asserts the grade chain (`lut3d`/`curves` + `noise` +
`vignette`) appears for Cinematic and is absent for Clean; a real ffmpeg render under
E2E produces a graded mp4 (histogram shift asserted vs ungraded).

---

### WS-6 — Audio mastering

**Problem:** inconsistent loudness; voice/SFX/music balance is ad-hoc.

**Research basis:** **two-pass `loudnorm` (EBU R128)** is the correct method — pass 1
`loudnorm=I=-14:TP=-1:LRA=11:print_format=json` measures; pass 2 feeds the measured
values back with `linear=true` for one consistent gain (preserves dynamics). **-14 LUFS**
is YouTube/streaming target, **TP=-1** true-peak ceiling. Music under voice should
**duck** via `sidechaincompress`.

**Target spec:** master the final mix to **I=-14, TP=-1, LRA=11**; if background music
is added, **sidechain-duck** it under the voice; keep SFX low-gain (already in `sfx.ts`).

**Implementation:** `engine/audio-master.ts` runs the two-pass loudnorm on the final
mixed track (or applies measured values inline in the final encode's audio filter
chain); wire into the assemble stage.

**Files:** `electron/services/engine/audio-master.ts`, `electron/services/{audio,queue}.ts`.

**Acceptance:** output integrated loudness measured by `ffmpeg … loudnorm print_format=json`
(or `ebur128`) within ±1 LU of -14; true-peak ≤ -1 dBTP.

---

### WS-7 — B-roll engine v2  *(Task 5 perf; D6)*

**Problem:** double-encode + 87-xfade bed = slow, CPU-bound.

**Target spec:**
- **Single pass when possible:** composite B-roll segments in the final graph using
  **`concat`** (hard cuts) or a small, bounded number of **eased dissolves** — never one
  giant 87-xfade chain. Cap transitions (e.g. ≤ 1 per 5s, eased).
- **GPU-aware:** scale/format on GPU when NVENC active; download only for the subtitle
  burn (WS-2 pattern).
- **Coverage planning** stays pure (`planCoverage`) but is tuned for **fewer, longer**
  slots (calmer, more pro) and clip **relevance** (theme ranking already exists).
- Bound bed length to **exactly** the audio duration (ties to WS-3).

**Files:** `electron/services/broll.ts`, `electron/services/engine/{graph,transitions}.ts`.

**Acceptance:** for a 19-min project the assemble step uses ≤ K transitions (asserted)
and a single encode; wall-clock on the E2E box drops materially vs current; output
duration == audio duration.

---

### WS-8 — Data/scraping polish  *(Tasks 2 & 4 + views)*

**Problem:** D8 (slow fetch regression), D9 (0 views / blank age), D10 (text clip).

**Decisions already made by product owner:** *Fast, hide empty views.*

**Target spec & implementation:**
1. **Revert the picker to flat fetch** (fast). Views best-effort.
2. **Hide empty columns cleanly:** when `views`/`age` are unavailable, **omit** the
   column value (no "unavailable"/"0 views") on Library recent uploads + My Channels.
3. **Channel total views:** show subs (works) and **hide** total-views when unknown
   rather than showing 0; optionally fetch the channel *About* page total later (flagged).
4. **Download row clip (D10):** `white-space:nowrap; overflow:hidden; text-overflow:
   ellipsis` on the status/progress text.

**Files:** `electron/ipc/scrape.ts`, `electron/services/scraper.ts`,
`src/screens/{Library,MyChannels,Download}.tsx`.

**Acceptance:** fetch returns in ~the old fast time; no "unavailable"/0 noise; the
download status never wraps.

---

### WS-9 — UI/UX design system (the "designing structure")

**Goal:** make the Compose + Render experience read like Descript/CapCut-tier software.

**Design tokens (already partly in `theme/`):** formalize a token file —
color (bg/surface/border/text/accent ramps), space scale (4-pt), radius, typography
scale (display/body/mono/poster), elevation/shadow, motion (durations + easings). One
source consumed by all components.

**Component library (extract from inline styles):** `Button`, `IconButton`, `Card`,
`Segmented`, `Toggle`, `Slider`, `Select`, `Chip`, `Stepper`, `ProgressBar`,
`Tooltip`, `Modal`, `Tabs`, `EmptyState`, `Toast`. Replace ad-hoc inline `style={{…}}`
with these over time (incremental).

**Compose Studio redesign:**
- **Live caption preview** that renders the *actual* WS-4 style (font/size/position/
  active-word color/pop) over the first image/B-roll frame — WYSIWYG, not a fake mock.
- **Style gallery:** preset cards (Cinematic/Intense/Clean/Heartfelt) each with a tiny
  looping preview thumbnail + one-line description.
- **Caption inspector:** font, size %, position, highlight color, words-per-line,
  animation — all bound and reflected live.

**Render Queue redesign:**
- Per-row **stage stepper** + **ETA** + **device chip** (WS-1).
- Output actions: Open file, Open folder, Re-render, Duplicate, Delete (kill-safe).
- A "what's happening" line ("Assembling B-roll 7/18 · GPU·NVENC · ~12 min").

**Files:** `src/theme/tokens.ts(.css)`, `src/components/*`, `src/screens/{Compose,RenderQueue}.tsx`.

**Acceptance:** `ME_SHOOT` screenshots of Compose (live preview) + Render Queue (stepper)
match the design references; visual parity review.

---

### WS-10 — Quality infrastructure

- **Golden-frame visual tests:** render 1 frame at a fixed timestamp for each caption
  preset/aspect; compare to a checked-in PNG within a tolerance (catches D1/D2/D4
  regressions). Run headless via the existing `ME_SHOOT`/E2E harness.
- **Render smoke matrix:** `ME_SMOKE=render` over {cpu, nvenc-fallback} × {image, b-roll,
  lavfi} × {16:9, 9:16} asserting duration, streams (ffprobe), ASS present, grade present.
- **Perf budget:** record wall-clock + speed× per stage to `render.log`; flag regressions.
- **Capability matrix doc:** what runs on machines without NVENC/libass.

**Files:** `electron/main.ts` (smoke), `test/golden/*`, `docs/CAPABILITY-MATRIX.md`.

---

## 4. Design system / UX detail (reference)

**Caption preview component contract:** given `{ style, aspect, words[], t }`, render the
exact ASS-equivalent in the DOM (CSS `-webkit-text-stroke`, `text-shadow`, transform
scale spring) so the preview == the render. Drives WYSIWYG confidence.

**Render Queue row states:** `queued | preparing | transcribing | fetching-broll |
assembling | grading | captioning | encoding | finalizing | done | error | cancelled`,
each mapped to a stepper icon + color; ETA shown for time-bearing stages.

**Motion language:** 120–180ms ease-out for UI; caption pop 120ms; respect
`prefers-reduced-motion`.

---

## 5. Data model & API additions

**`shared/types.ts`:**
- `RenderProgress` += `stage: RenderStage`, `stageDetail?: string`, `etaSec?: number`,
  `speed?: number`, `device?: 'cpu'|'gpu'`, `encoder?: string`.
- `RenderStage` enum (the states in §4).
- `AppSettings.encoder` extend to `'cpu'|'nvenc'|'qsv'|'amf'` (caps-gated).
- `CaptionStyle` type: `{ font, sizePct, allCaps, wordsPerLine, activeColor,
  highlightMode:'color'|'box', stroke, position, animation }`.
- `Project` += `captionStyle?: CaptionStyle`, `gradePreset?: string`, `grain?:bool`,
  `vignette?:bool`, `letterbox?:bool`.

**Capabilities:** new `caps:get` IPC → `{ hasNvenc, hasQsv, hasAmf, gpuVendor,
ffmpegHasLibass }`.

**Migrations:** `ensureColumn` for the new project columns; defaults preserve legacy rows.

---

## 6. Phasing, sequencing & gates

**Phase 0 — Correctness & trust (ship first):**
- WS-3 (47s + sizing) · WS-8 (fetch revert, hide-empty, clip) · WS-1 (feedback).
- *Gate:* renders are full-length; UI never lies; fetch fast again.

**Phase 1 — Performance & GPU:**
- WS-2 (encoder/NVENC + caps) · WS-7 (B-roll single-pass).
- *Gate:* GPU used when present; one encode; render time materially lower.

**Phase 2 — The look:**
- WS-4 (captions v2, Route 1) · WS-5 (grade/grain/motion/transitions) · WS-6 (audio).
- *Gate:* golden-frame references match; a sample render is visibly CapCut-tier.

**Phase 3 — Polish & scale:**
- WS-9 (design system, live preview, style gallery) · WS-10 (golden tests, smoke matrix)
  · WS-4 Route 2 (Remotion captions, optional premium).

Dependencies: WS-2 before WS-7; WS-3 before WS-5/WS-7 (duration); WS-1 spans all.

---

## 7. Testing & verification

- Keep `npm run typecheck && npm run build` green; `ME_SMOKE` matrix green after each WS.
- **Pure asserts** in `graph.ts`/`captions.ts`/`grade.ts` (string/structure).
- **ffprobe asserts** in E2E: duration, stream count, resolution, codec.
- **Golden-frame** PNG compares (WS-10).
- **Loudness assert** (WS-6) via `ebur128`/`loudnorm json`.
- Sandbox note: NVENC can't be exercised in CI (no GPU) — assert the *args/fallback*
  with dry-run; real NVENC verified on the user's box (documented manual test).

---

## 8. Risks & decisions (must be answered before Phase 2/3)

1. **Captions Route 1 (ASS) vs Route 2 (Remotion).** Recommend **Route 1 first**
   (fast, offline, no deps), Route 2 as an optional premium mode. *Decision needed.*
2. **Transitions:** `xfade-easing` expressions (no rebuild — recommended) vs building a
   custom ffmpeg with `gl-transition` (heavier, nicer). *Recommend xfade-easing.*
3. **NVENC availability:** must fall back to libx264 gracefully; never hard-fail.
4. **LUT licensing/size:** ship a few CC0/own LUTs under `resources/luts/`.
5. **Build-ffmpeg-from-source** only if GL transitions are required; otherwise keep the
   vendored static build (must be `--enable-libass`, ideally `--enable-cuda-nvcc`).
6. **HEVC vs H.264:** default H.264 (compatibility); offer HEVC/NVENC as "smaller files".

---

## 9. Appendix — copy-paste reference recipes (source-of-truth)

> Validate with short renders (`-ss`/`-t`) before full length. ASS colors are **BGR**.

**A. NVENC encode (final), captions burned, GPU-aware:**
```
# CPU path
-c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p
# NVENC path (decode+scale on GPU; download only to burn ASS, then re-upload)
-hwaccel cuda -hwaccel_output_format cuda  ... \
-filter_complex "[v]hwdownload,format=nv12,ass='captions.ass',hwupload_cuda[vo]" \
-c:v h264_nvenc -preset p5 -tune hq -rc vbr -cq 21 -b:v 0 -pix_fmt yuv420p
```

**B. Hormozi/CapCut ASS style (16:9 @1080; size ≈0.085·H ≈ 92):**
```
Style: Cap,Anton,92,&H00FFFFFF,&H003DD9FF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,1.5,2,40,40,300,1
# Primary=white, Secondary=yellow(#FFD93D→&H003DD9FF), Outline=black, Bold, Outline=4, Shadow=1.5, Align=2 (bottom-center), MarginV≈300
# Active-word karaoke + uniform pop:
Dialogue: 0,0:00:01.00,0:00:02.20,Cap,,0,0,0,,{\k0\t(0,120,\fscx112\fscy112)}YOU {\k60}ARE {\k60}NOT {\kf80}CRAZY
# Emphasized/keyword word: same scale, yellow fill (never a different font size)
```

**C. Cinematic grade chain (insert before caption burn, CPU branch):**
```
lut3d=file=resources/luts/teal_orange.cube, \
curves=preset=medium_contrast, \
noise=alls=8:allf=t, \
vignette=PI/5
# (Cinematic preset only; Clean omits this whole chain.)
```

**D. Eased dissolve (xfade-easing expression form) — bounded count:**
```
# Prefer xfade-easing custom expressions over raw linear xfade; ≤1 transition / 5s.
xfade=transition=fade:duration=0.5:offset=<t>   # baseline; swap for eased expr
```

**E. Two-pass loudnorm (audio master to -14 LUFS / -1 TP):**
```
# Pass 1 (measure):
-af loudnorm=I=-14:TP=-1:LRA=11:print_format=json   # read measured_* from stderr JSON
# Pass 2 (apply, linear):
-af loudnorm=I=-14:TP=-1:LRA=11:measured_I=<>:measured_TP=<>:measured_LRA=<>:measured_thresh=<>:offset=<>:linear=true
# Music under voice: sidechaincompress (duck) keyed by the voice track.
```

**F. Authoritative duration (fixes 47s):**
```
ffprobe -v error -show_entries format=duration -of csv=p=0 audio.mp3
# trust this over music-metadata; pin final -t to it; apad/loop shorter inputs.
```

**G. Capability probe (startup):**
```
ffmpeg -hide_banner -encoders | grep -E 'nvenc|qsv|amf'
ffmpeg -hide_banner -hwaccels
# 1-frame NVENC self-test: -f lavfi -i color=...:d=0.1 -c:v h264_nvenc -f null -
```

---

## 10. Sources (research basis)

**Captions / style:**
- Remotion — createTikTokStyleCaptions: https://www.remotion.dev/docs/captions/create-tiktok-style-captions
- Remotion TikTok template (Whisper word-level): https://github.com/remotion-dev/template-tiktok
- Submagic — Alex Hormozi captions: https://www.submagic.co/blog/how-to-make-alex-hormozi-captions
- Ascynd — Hormozi style guide: https://ascynd.io/en/blog/hormozi-captions
- Captions.ai — highlight keywords: https://captions.ai/help/guides/engagement/highlight-keywords
- ffmpeg karaoke/animated-text skill (ASS \k + \t recipe): https://github.com/JosiahSiegel/claude-plugin-marketplace/blob/main/plugins/ffmpeg-effects/skills/ffmpeg-karaoke-animated-text/SKILL.md
- VidNo — karaoke word-highlight captions: https://vidno.ai/blog/karaoke-style-word-highlight-captions

**GPU / encoding:**
- NVIDIA — FFmpeg with NVIDIA GPU: https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html
- RenderIO — FFmpeg CUDA/NVENC guide: https://renderio.dev/blogs/ffmpeg-cuda-nvenc-gpu-acceleration/
- NVIDIA — Video Codec SDK 10 presets (p1–p7): https://developer.nvidia.com/blog/introducing-video-codec-sdk-10-presets/

**Cinematic / transitions:**
- Vintage/cinematic ffmpeg filters (grain/vignette/LUT): https://zayne.io/articles/vintage-camera-filters-with-ffmpeg
- LUT/hald-clut color grading: https://gabor.heja.hu/blog/2024/12/10/using-ffmpeg-to-color-correct-color-grade-a-video-lut-hald-clut/
- xfade-easing (GLSL ports + easing, no rebuild): https://github.com/scriptituk/xfade-easing
- ffmpeg-gl-transition (source build): https://github.com/transitive-bullshit/ffmpeg-gl-transition

**Audio:**
- Two-pass loudnorm done right: https://dev.to/masonwritescode/two-pass-loudness-normalization-with-ffmpeg-loudnorm-the-right-way-1nm3
- ffmpeg-normalize (EBU R128 wrapper): https://github.com/slhck/ffmpeg-normalize

**Architecture references (pipeline staging):**
- Remotion (React/Chromium frame model): https://github.com/remotion-dev/remotion
- Remotion vs Motion Canvas vs Revideo: https://www.pkgpulse.com/blog/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026
- SamurAI AI-Youtube-Shorts-Generator (OSS Opus/Submagic alt): https://github.com/SamurAIGPT/AI-Youtube-Shorts-Generator
- MoneyPrinterTurbo / faceless-video-generator topic: https://github.com/topics/faceless-video-generator
```
