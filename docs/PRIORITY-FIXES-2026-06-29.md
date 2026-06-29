# Priority Fix Plan — 2026-06-29

Scope: the **immediate, user-reported problems** from the latest review. Each entry has the
exact symptom, the verified root cause (with file + function references against the current
code on `build/mental-empire-studio`), and a concrete, step-by-step fix.

> Status legend: 🔴 broken · 🟡 partially done / needs completion · 🟢 already implemented (verify only)

A quick note on history: an earlier `BUGFIX_PLAN.md` already landed several of these fixes
(direct YouTube thumbnail URLs, the "original thumbnail" reference, click-to-highlight words,
strict-GPU rendering). This document reflects the **current** state of the code and only
describes what is still wrong or incomplete, so we don't redo finished work.

---

## P1 — Render preview destroys images + captions (🔴 critical)

**Symptom:** "I clicked render preview after fetching captions, it just removed images and
everything — I had to refetch the captions again."

**Root cause:** `renderPreview()` in `src/screens/Compose.tsx` (the `CaptionsTab` component) does:

```ts
const p = await window.api.compose.preview(project.id)
await openProjectById(project.id)   // <-- the destructive / unnecessary step
setPreviewPath(p)
```

`openProjectById` (in `src/store/useData.ts`) **replaces the entire in-memory project state**
(`activeProject`, `projectImages`, `transcript`) by re-reading the DB:

```ts
const [projectImages, transcript] = await Promise.all([a.compose.images(projectId), a.transcribe.get(projectId)])
set({ activeProject: project, projectImages, transcript, transcribeError: '', transcribeMessage: '' })
```

The preview render itself (`previewProject` in `electron/ipc/compose.ts`) is **read-only** — it
never writes images or transcript — so the reload is pointless. Worse, it is the *only* thing in
the preview flow that mutates the renderer store, so any timing/empty-read or partial state makes
the user's images and transcript visibly disappear and forces a re-transcribe. The reload was
likely added to pick up a duration change, but every edit on this screen is already persisted
immediately (`setMedia` / `setCaptions` / `setProjectImages` all write to the DB and update the
store), so there is nothing to "refresh".

**Fix (file: `src/screens/Compose.tsx`):**

1. Delete the `await openProjectById(project.id)` call from `renderPreview`. The function should
   only set the preview path + state:
   ```ts
   const renderPreview = async (): Promise<void> => {
     if (!project || previewing) return
     setPreviewState('rendering'); setPreviewError('')
     try {
       const p = await window.api.compose.preview(project.id)
       setPreviewPath(p)
       setPreviewState('ready')
     } catch (e) {
       setPreviewError((e as Error).message); setPreviewState('error')
     }
   }
   ```
2. Keep the live `CaptionPreview` visible at all times; show the rendered `<video>` **below/beside**
   it instead of swapping it out, so the user never loses the editing context.
3. If we ever genuinely need the probed duration back in the UI, return it from
   `compose:preview` and patch only `activeProject.durationSec` (a shallow merge), never a full
   reload that can clobber `projectImages` / `transcript`.

**Acceptance:** Clicking "Render preview" leaves the image list and transcript exactly as they
were; only the preview video appears.

---

## P2 — Captions flicker on the render-preview video (🔴)

**Symptom:** "The captions keep flickering on the render preview video."

**Root cause:** `buildAss()` in `electron/services/captions.ts`, in **word mode**, emits **one
`Dialogue` event per word**. Each event re-draws the *whole* caption line and carries a fade lead:

```ts
`...${opts.styleLead ?? ''}${animationLineLead(opts.animation, ...)}${text}`
```

`animationLineLead` returns `{\fad(20,20)}` (and a `\move` for Slide). Because consecutive
per-word events each fade-in/out the entire line, libass tears the line down and rebuilds it on
every word boundary → visible flicker. It is worst in the preview because the preview path
(`previewProject` in `electron/ipc/compose.ts`) calls `buildAss` **without `mode`**, so it
defaults to `'word'`, and the first ~5 s contains many tightly-spaced words.

**Fix (file: `electron/services/captions.ts`):**

1. Render each caption **group as a single `Dialogue`** spanning the group's whole time range, and
   use ASS karaoke timing (`\kf<centiseconds>`) per word to sweep the active/emphasised colour —
   instead of one event per word. This is the standard CapCut-style approach and eliminates the
   per-word teardown. The code comments already claim "Word-level karaoke (\kf sweep)" but the
   implementation builds discrete per-word events; finish the karaoke implementation.
2. If we keep the per-word approach as a fallback, **only apply `\fad` on the first and last event
   of a group**, not every event, and drop the `\move` lead for non-first events.
3. Make the **preview pass explicit**: in `previewProject` pass `mode: 'phrase'` (or the new
   single-event karaoke) so the preview matches the calmer final render.

**Acceptance:** Preview and final renders show a stable caption line with only the active word
animating/colour-sweeping; no whole-line flicker.

---

## P3 — Render speed + "why CPU when I selected GPU?" (🔴, highest priority)

**Symptom:** "Simple image rendering taking an hour? Why CPU? Never use CPU when I choose GPU in
Settings. This is sooo slow."

There are **three** distinct root causes here; all need addressing.

### 3a. Settings silently ignores a GPU selection
`chooseEncoder()` in `src/screens/Settings.tsx`:

```ts
const chooseEncoder = (enc): void => {
  if (!enc.enabled && enc.value !== 'cpu') { void refreshCaps(true); return } // <- swallows the click
  updateSettings({ encoder: enc.value })
}
```

An encoder button is only `enabled` when the ffmpeg capability probe (`probeRenderCapabilities`
in `electron/services/engine/caps.ts`) either lists it or its self-test passed. If the probe
returns `null` (ffmpeg cap-list failed, slow first run, etc.) **every GPU option is disabled and
the click does nothing** — the setting stays on the default `'cpu'`. The user believes they picked
GPU; the renderer keeps using `libx264`.

**Fix:**
- Always persist the user's encoder choice (`updateSettings({ encoder: enc.value })`) regardless of
  probe state. Surface capability problems as a **warning under the selector** ("NVENC selected but
  ffmpeg's self-test failed — renders will try NVENC and fail visibly"), never as a silent no-op.
- Because `electron/services/render.ts` is already **strict-GPU** (it throws instead of falling back
  to CPU when `encoder !== 'cpu'`), honouring the user's choice is safe: if the GPU truly can't
  encode, the render fails loudly with a clear message rather than quietly burning CPU.

### 3b. GPU encode still does all filtering on CPU
Even when NVENC is correctly selected, the **still-image render path** in
`buildRenderArgs` (`electron/services/render.ts`) always runs `scale`, `crop`, `zoompan`,
`xfade`, the grade chain, and the `subtitles` burn on the **CPU**. `canUseCudaFinalFilters()`
exists but is only wired into the **B-roll manifest** branch, not the normal image branch. So a
GPU user pays the full CPU filtergraph cost — the dominant cost for long videos — and sees a slow
render with "GPU encode · CPU filters".

**Fix (file: `electron/services/render.ts`):**
- In the image branch, when `canUseCudaFinalFilters(settings, caps)` is true, use CUDA scaling
  (`-hwaccel cuda -hwaccel_output_format cuda` + `scale_cuda` → `hwdownload`/`format=nv12` for the
  libass burn, then `format=nv12,hwupload_cuda` before the NVENC output), mirroring what the
  manifest branch already does via `pushFinishedVideo(..., afterSubtitles: ',format=nv12,hwupload_cuda')`.
- Keep the libass `subtitles=` burn on CPU (libass has no GPU path), but everything around it
  (scale/crop/overlay) should be GPU when available.

### 3c. Ken Burns forces a full-video CPU zoompan on short clips
`stillMotionFilter`/`punchZoomFilter` add a `zoompan` pass only when
`allowCpuMotion = (settings.encoder ?? 'cpu') === 'cpu'`. With the **default `kenBurns: true`**
(`defaultProject` in `electron/ipc/compose.ts`) and a CPU encoder, every still gets a full-video
`zoompan` — extremely expensive at 1080p. It's already disabled for long-form (≥ 600 s via
`longFormFastPath`), but short/medium videos on CPU get hammered.

**Fix:**
- Replace the per-frame `zoompan` Ken Burns with a cheaper `scale`+`crop`+`zoompan d=1` or a
  pre-scaled `zoom` expression, or gate Ken Burns behind an explicit opt-in (default **off**).
- Add **render telemetry to the UI**: the per-job `*.render.log` already records `encoder=…` and
  `[stage] … speed=… eta=…`. Surface the **actual encoder used** and per-stage timing on the Render
  Queue row so "why is this slow / is it really using my GPU?" is answerable without opening logs.

**Acceptance:** Selecting NVENC/QSV/AMF in Settings always sticks; renders use the GPU for encode
**and** scaling when CUDA is available; a short single-image render completes in seconds-to-minutes,
not an hour; the Render Queue shows which encoder actually ran.

---

## P4 — B-roll ran even though it wasn't selected (🔴)

**Symptom:** "Although I didn't select b-roll mode it still used b-roll."

**Root cause:** B-roll is gated correctly in `runJob` (`electron/services/queue.ts`):
`settings.beta.enabled && asBetaOpts(project.betaOpts).broll.enabled`. The trap is **silent
inheritance of beta options**:

- `newProfile()` in `src/screens/Profiles.tsx` ships aggressive defaults — `style: 'Cinematic'`,
  `autoHighlight: true`, `overlay.bottom: true`, `autoZoom.atStart/atKeyPhrases: true` (b-roll
  itself defaults off, but the heavy cinematic effects do not).
- `runProfile` (`electron/ipc/automation.ts`) copies `profile.betaOpts` onto every project it
  creates. So once Beta is enabled in Settings, every profile-produced video silently renders with
  Cinematic transitions, full-video auto-zoom, and an overlay the user never consciously chose —
  and if b-roll was ever toggled on, it stays on across the batch.
- The Compose screen only shows a **warning banner** ("Auto B-roll on…") in `MediaTab`; there is
  **no off-switch** there, so a user can't easily disable it where they'd expect to.

**Fix:**
1. Make `newProfile()` default to **minimal effects**: `style: 'None'`, `autoHighlight: false`,
   `overlay` all false, `autoZoom` both false, `broll.enabled: false`. Cinematic etc. become an
   explicit opt-in.
2. Add an explicit, always-visible **B-roll / effects toggle** on the Compose `MediaTab` (not just a
   warning), so the active project's `betaOpts.broll.enabled` and the main effects can be turned off
   right where the images live.
3. Add an **effects summary** to each Render Queue row (e.g. "Cinematic · auto-zoom · B-roll
   sparse") so nothing renders with effects the user didn't intend. Bonus: a one-click "render plain"
   that clears beta effects for that job.

**Acceptance:** A freshly created profile renders plain (images + captions only) unless the user
explicitly enables effects/B-roll; the Compose screen lets the user turn B-roll off; the queue shows
exactly which effects will be applied.

---

## P5 — Preview should be fast: low-res image + default low-q B-roll (🟡)

**Symptom:** "Maybe just scale the image I selected to low quality for render preview; if I selected
B-roll just use a default low-quality B-roll so it doesn't take that long."

**Current state:** `previewProject` (`electron/ipc/compose.ts`) is already partly optimised — it
forces `quality: '720p'`, caps duration to ≤ 5 s, uses only the first image, disables Ken Burns /
punch-zoom, and **disables B-roll** for preview. So previews don't fetch stock footage, but they
also never *show* what B-roll would look like, and 720p is heavier than needed for a thumbnail-sized
preview.

**Fix:**
1. Add a dedicated, even-lighter preview quality (e.g. 480p or 360p) — extend
   `AppSettings['quality']` handling in `dimensions()` (`electron/services/render.ts`) or pass an
   explicit preview width — and use `-preset ultrafast` for the CPU path.
2. Pre-downscale the chosen image to the preview resolution before ffmpeg (smaller scale cost), or
   pass `-vf scale` to a small size directly.
3. Ship a tiny **bundled default B-roll clip** (a few seconds, low-res, in `resources/`). When the
   project has B-roll enabled, the preview composes captions over this default clip instead of
   fetching/normalising real stock footage — so the user sees the B-roll *layout* instantly.
4. Skip `masterAudioTwoPass` for previews (it's a second ffmpeg pass that adds latency and is
   irrelevant to a 5 s preview).

**Acceptance:** Preview returns in a couple of seconds; enabling B-roll shows a stand-in clip with
burned captions without any network fetch.

---

## P6 — Thumbnail editor: multi-line line-height looks uneven (🔴)

**Symptom:** "There are multiple lines, some big and some small. The line height is odd and weird —
big text has big gaps, small text small gaps. I had to make 2 type layers to adjust."

**Root cause:** In `drawText()` (`src/features/thumbnail-editor/render.ts`) the vertical cursor
advances by **each line's own font size plus a single shared gap**:

```ts
const avgSize = ... // average of all line sizes
const lineGap = l.lineGap > 0 ? l.lineGap : Math.max(8, avgSize * 0.12)
...
cy += fontSize + lineGap   // fontSize is the *per-line* size
```

So a 130 px line followed by a 60 px line produces wildly different baseline spacing, and the
auto gap is derived from the *average* size, not the actual neighbouring lines. `autoArrangeText()`
(`shared/thumbnail.ts`) compounds this by scaling the highlighted line to `1.25×`, guaranteeing
mismatched line sizes. That's why stacked lines look lopsided and the user resorted to two layers.

**Fix:**
1. Introduce a **uniform line-box model**: advance `cy` by `lineHeight = maxLineSize × factor`
   (factor ≈ 1.1) for every line, instead of `perLineSize + gap`. This makes inter-line spacing
   visually even regardless of per-line size differences. Vertically centre each glyph within its
   line box.
2. Expose a single **"Line height"** slider (multiplier, default 1.1) in `TextLayerEditor`
   (`src/screens/Thumbnails.tsx`) that maps to this factor, replacing the raw px `lineGap` (keep
   `lineGap` honoured for legacy templates).
3. In `autoArrangeText`, keep the highlight emphasis as a **colour/box** treatment by default rather
   than a size bump, or apply the size bump only to the highlighted *word*, not the whole line, so
   line sizes stay consistent unless the user deliberately changes them.

**Acceptance:** A two-line headline with mixed sizes stacks with even, predictable spacing; a single
"Line height" control adjusts all gaps uniformly; no need for separate type layers.

---

## P7 — Thumbnail: gradient effect too strong, want a slider (🟡)

**Symptom:** "The gradient effect is too much — maybe a slider so I can make it more/less effective.
Default in the middle. Effectiveness by size and opacity."

**Current state:**
- For **captions/video**, the background-overlay gradient already has an **intensity slider** (0–100,
  default 50 = "middle") in the Compose `BetaPanel` and the `Profiles` editor, mapped to size +
  alpha in `overlayGradientPath` (`electron/services/render.ts`). This matches the request — verify
  it reads as expected.
- For the **thumbnail editor** there is currently **no gradient scrim** overlay at all (backgrounds
  are solid/gradient/image fills only). This is the gap.

**Fix (thumbnail side):**
1. Add an optional **gradient scrim layer/effect** to the thumbnail model (e.g. a `ShapeLayer`
   variant or a background property) with direction (bottom/top/left/right) plus **two sliders —
   size (extent) and opacity** — defaulting to the middle (~50 %). Render it in `render.ts`
   (`drawBackground`/a new `drawScrim`) as a Konva linear-gradient rect, painted above the
   background and below text/subject for legibility.
2. Wire the sliders into `TextLayerEditor`/a new background section in `src/screens/Thumbnails.tsx`,
   reusing the existing `FxSlider` component.

**Acceptance:** A thumbnail gradient scrim can be dialled from subtle to strong via size + opacity
sliders that sit at the middle by default; the existing caption-overlay slider behaves the same way.

---

## P8 — "I don't understand how profiles help" (🟡 UX/clarity)

**Symptom:** "I added a source channel, clicked start and it downloaded their videos. Is that it?
Why is it not more helpful?"

**Root cause:** Interactive profile runs (`runProfile` in `electron/ipc/automation.ts`, non-headless)
stop after **scrape → download → create project → (optional) transcribe**, then drop the user into
Compose for manual editing. The thumbnail isn't auto-generated, the render isn't queued, and the
profile card doesn't communicate the end-to-end value (auto-watch, applied caption/thumbnail
template, batching). So a one-off interactive run feels like "it just downloaded videos."

**Fix:**
1. **Communicate the pipeline:** the profile card already shows a `pipelineSummary`; make the run
   stepper and result explicit ("Scraped 5 → downloaded 5 → captioned 5 → ready to edit / queued").
2. **Apply the locked thumbnail template automatically** when a profile has `thumbnailTemplateId`,
   so profile-produced projects come out with a thumbnail (currently the template is only stored, not
   auto-rasterised per video).
3. **Offer an end-to-end mode**: a per-profile "auto-queue render after compose" option so an
   interactive run can go all the way to rendered files, not just staged projects (headless/auto-watch
   already does `sendToRender`; expose the same for interactive).
4. Clarify **auto-watch** value in the UI: a profile with auto-watch on will run hands-free whenever
   the source posts (driven by `scheduler.ts`). Make that promise visible on the card with the next
   check time / last run.

**Acceptance:** Running a profile clearly shows the full pipeline and (optionally) produces a
thumbnail + queued/rendered video; the UI explains what auto-watch will do on its own.

---

## Already-implemented items (🟢 — verify, don't rebuild)

These were in the original report but already exist in the current code; confirm they work for the
user (they may have tested an older build):

- **Direct YouTube thumbnail URLs (no yt-dlp fetch):** `shared/youtube.ts#youtubeThumbUrl` builds
  `https://i3.ytimg.com/vi/{id}/maxresdefault.jpg` (and `sd/hq/mq/default`). *Follow-up:* extend this
  to the Download / Library / source-video lists, which still display the yt-dlp-scraped `thumb`
  string — replace those with the deterministic URL so we stop depending on yt-dlp for thumbnails
  everywhere.
- **See the original thumbnail while editing:** `OriginalThumbnailReference` in
  `src/screens/Thumbnails.tsx` renders the original below the canvas with `max → hq → mq → default`
  fallback. Verify it appears (depends on `youtubeIdFromDownloadId`, which strips the `dl-` prefix
  that `download.ts` adds — confirmed consistent).
- **Click words to highlight (multiple):** the "Highlighted words" section in `TextLayerEditor`
  renders clickable word chips backed by `highlightWords[]`, plus a custom-word input. This already
  satisfies "click multiple words instead of typing."

---

## Suggested implementation order

1. **P1** (preview state loss) and **P2** (caption flicker) — small, high-impact correctness fixes.
2. **P3** (GPU selection + GPU scaling + Ken Burns cost) and **P4** (b-roll/effects opt-in) — the
   biggest pain ("an hour", "why CPU", "used b-roll"). These share the render/settings surface.
3. **P6** (line-height) and **P7** (thumbnail gradient slider) — thumbnail-editor polish.
4. **P5** (faster preview) and **P8** (profiles clarity) — UX/perf refinements.
