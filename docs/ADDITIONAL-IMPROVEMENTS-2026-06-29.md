# Additional Improvements Plan — 2026-06-29

A second, deeper pass over the codebase beyond the user-reported priority issues (those are in
`PRIORITY-FIXES-2026-06-29.md`). These are bugs, correctness gaps, performance wins, robustness,
UX, and tech-debt items found while tracing the scrape → download → compose → render pipelines.

> Same status legend. File references are against `build/mental-empire-studio`.

---

## A. Correctness bugs

### A1. Download & Library cards never show the real thumbnail (easy win)
`runOne()` in `electron/ipc/download.ts` hardcodes:
```ts
thumb: 'linear-gradient(135deg,#23262e,#15171d)'
```
So every downloaded row shows a grey gradient even though the deterministic YouTube thumbnail URL
is available from the video id. The scraper already uses `youtubeThumbUrl` for source lists.
**Fix:** set `thumb: youtubeThumbUrl(video.id, 'hq')` (and on `resume`, derive the id from the
`dl-` prefix). Render it as an `<img>` with a gradient fallback on error.

### A2. "Popular" ordering does nothing in flat-playlist mode
`scrapeSourceVideos` → `scrapeChannel` runs **flat** by default; flat dumps usually omit
`view_count`, so `toScrapedVideo` stores `views: 0`. `orderVideos(..., 'Popular')` then sorts by
all-zero views — a no-op. The user picks "Popular" and gets latest order.
**Fix:** when `order === 'Popular'`, fetch with `{ flat: false, limit: count*N }` so real view
counts are present, or clearly label that Popular needs the slower extraction.

### A3. Output filename collisions overwrite renders/thumbnails
`formatOutputName` (`electron/services/audio.ts`) produces `{channel} - {title}`. Two videos with
the same channel+title (or the same title across sources) write to the **same** `.mp4`/`.ass`, and
thumbnails use `safeName(project.title).png` in `electron/ipc/thumbnails.ts` /
`electron/services/queue.ts`. The render-queue `hasThumb`/`jobsView` check is also title-based.
**Fix:** include a short unique suffix (download/video id or date) in the output base and the
thumbnail filename; key the "has thumbnail" check off `project.thumbPath`, not a recomputed path.

### A4. `filterDevice` is always reported as `cpu` (cosmetic but misleading)
In `queue.ts` `runJob`, `filterDevice` is initialised to `'cpu'` and never updated even when the
B-roll branch enables CUDA scaling (`filterDetail` is updated, `filterDevice` isn't).
**Fix:** set `filterDevice = 'gpu'` when `canUseCudaFinalFilters` is active.

### A5. Duration rounded to whole seconds can drift A/V on long files
`probeDuration` returns `Math.round(seconds)`. For a 19-minute file the ±0.5 s rounding plus the
`-t durationSec` clamp can leave a small audio tail cut or a trailing freeze.
**Fix:** carry sub-second precision (one or two decimals) through the project duration.


---

## B. Performance & rendering

### B1. Parallel GPU encodes can exceed NVENC session limits
`runAll` (`queue.ts`) launches `settings.concurrency` (default 2) jobs at once. Consumer NVIDIA
cards cap concurrent NVENC sessions (2–3 on many GeForce cards/drivers); two parallel hardware
encodes can fail or thrash. On CPU, two parallel `libx264` runs just halve each other's throughput.
**Fix:** when a GPU encoder is selected, cap effective concurrency for the *encode* stage (e.g. 1–2)
independently of the B-roll fetch/normalise stages; document the trade-off in Settings.

### B2. B-roll normalises every segment to its own mp4 before the final encode
`buildBrollManifest` encodes each segment to disk, then the final render decodes+re-encodes them
again — two full encode passes for B-roll videos. That's a large part of "b-roll renders take
forever."
**Fix:** prefer the single-pass `brollSegments` graph (already implemented in `buildRenderArgs`) for
the common case, reserving the normalize-to-manifest path for when segment codecs/timebases are
genuinely incompatible. Cache normalised segments across renders.

### B3. Thumbnail editor image cache never evicts (minor leak)
`imgCacheRef` in `ThumbCanvas.tsx` keeps every decoded image for the session. Swapping many
backgrounds/subjects grows it unbounded.
**Fix:** evict entries whose `src` is no longer referenced by any layer after each rebuild.

### B4. `loadDownloads()` / `loadRenderJobs()` fire on every progress event
In `useData.init`, each `onDownloadProgress` and `onRenderProgress` triggers a full DB reload.
During an active download/encode these events arrive many times per second → redundant IPC.
**Fix:** throttle/debounce the reloads (250–500 ms), or update the single affected row from the
event payload instead of reloading the whole list.

---

## C. Robustness & error handling

### C1. Groq chunk offsets assume exact segment lengths
`chunkAudio` uses ffmpeg `segment_time=600 -reset_timestamps 1`, then `transcribeAudio` adds
`i * CHUNK_SECONDS` as the offset. Segment boundaries snap to keyframes, so real chunk starts can
drift from the assumed 600 s multiples, nudging word timings on multi-chunk (10 min+) files.
**Fix:** probe each chunk's actual duration and accumulate true offsets.

### C2. No React error boundary
A thrown error in any screen component takes down the whole renderer with a blank window.
**Fix:** wrap the screen router in an error boundary that shows a recoverable error panel + "reload"
and a link to open logs.

### C3. Provider/network failures in B-roll are swallowed silently
`runJob` degrades gracefully when stock providers fail, but the only signal is an activity-log line.
**Fix:** surface a per-job badge ("B-roll unavailable — used images") on the Render Queue row.

### C4. `resume()` rebuilds a `ScrapedVideo` with empty metadata
`download.ts#resume` reconstructs the video with `durationSec: 0, thumb: ''`. If the original
download never probed duration, the resumed row may still lack it.
**Fix:** re-probe on resume completion and backfill the thumbnail URL from the id.


---

## D. UX / product

### D1. Hardcoded fake stats in Settings (trust issue)
`Settings.tsx` shows literal `Storage used 14.2 GB` and `Jobs this week 23` — invented numbers.
**Fix:** compute real values (sum output-folder size; count render jobs done in the last 7 days)
or remove the rows entirely.

### D2. Compose has no per-project B-roll / effects switch (cross-ref P4)
Only a warning banner. Add an explicit toggle where the user manages media.

### D3. Render Queue should show an effects summary + encoder used (cross-ref P3/P4)
So a slow/odd render is self-explanatory.

### D4. Many interactive controls are `div`/`span` with `onClick` (a11y/keyboard)
Toggles, chips, cards, and tabs across `Compose`, `Thumbnails`, `Profiles`, `Settings` are clickable
`div`s without roles, `tabIndex`, or keyboard handlers.
**Fix:** convert to `<button>` or add `role`/`tabIndex`/`onKeyDown` for keyboard + screen-reader use.

### D5. Profiles end-to-end clarity (cross-ref P8)
Auto-apply thumbnail template; optional auto-queue render; clearer auto-watch promise.

---

## E. Security & privacy

### E1. API keys stored in plaintext (expected for desktop, document it)
Groq/Pexels/Pixabay/Coverr keys live unencrypted in the electron-store JSON. Acceptable for a local
desktop app, but consider OS keychain (`safeStorage`) and document where keys are stored.

### E2. No Content-Security-Policy on the renderer
The window loads from `file://` with `contextIsolation: true`/`nodeIntegration: false` (good), but
there's no CSP meta/header. Remote `<img>` loads (YouTube thumbnails, stock previews) are allowed
broadly.
**Fix:** add a restrictive CSP (allow `https://i*.ytimg.com`, provider hosts, `data:`, `file:` as
needed) to reduce exposure.

### E3. URL redaction is good — keep it consistent
`broll.ts` redacts API keys in logs; `transcribe.ts` redacts `Bearer`. Ensure any new network code
follows the same pattern.

---

## F. Code quality & tech debt

### F1. Repeated `safeName` definition
`safeName` is duplicated in `queue.ts`, `thumbnails.ts`, `render.ts`/`compose.ts`. Extract to one
shared util to avoid divergent rules (it already underpins the A3 collision bug).

### F2. `rowToProject`/`rowToProfile` use `as unknown as` casts then patch
DB row → typed object conversions spread the raw row then override a few fields. New columns
silently pass through untyped. Consider explicit field mapping or a schema validator (e.g. zod).

### F3. Magic numbers in the render graph
FPS, CRF ladders, `LONG_FORM_FAST_SEC`, density slot lengths, etc. are scattered literals.
Centralise in a render-config module for tuning.

### F4. `mock.ts` / `mockApi.ts` shipped in renderer bundle
Verify these are dev-only and tree-shaken from production builds.

---

## G. Testing

### G1. Add a caption-flicker regression assertion (ties to P2)
The headless smoke can assert that word mode emits **one Dialogue per group** (or that per-word
events don't each carry `\fad`). Lock the fix so it can't regress.

### G2. Assert encoder selection persists regardless of caps (ties to P3a)
Unit-test `chooseEncoder` behaviour: selecting `nvenc` always updates settings; capability state
only changes the displayed warning.

### G3. Render-arg snapshot for the GPU still-image path (ties to P3b)
`buildRenderArgs` is pure and already unit-friendly; add a snapshot asserting CUDA scale filters
appear when `caps.ffmpegHasCuda && encoder==='nvenc'`.

---

## Suggested order
1. Quick correctness wins: **A1** (real download thumbnails), **D1** (remove fake stats), **A4**
   (filterDevice label).
2. Performance: **B1** (GPU concurrency), **B2** (B-roll double-encode), **B4** (event throttling).
3. Robustness: **C2** (error boundary), **C1** (chunk offsets), **A3** (filename collisions).
4. Polish/debt: **D4** (a11y), **F1**/**F2** (shared utils + typed DB boundary), **E2** (CSP), then
   the **G** tests to lock everything in.
