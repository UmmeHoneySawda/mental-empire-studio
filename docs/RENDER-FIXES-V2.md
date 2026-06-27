# Render Fixes V2 — Bug Audit (with code proof) + Logging + B-roll Redesign

> **Context.** The V1 blueprint (`docs/RENDER-QUALITY-BLUEPRINT.md`) was partially
> implemented (new `electron/services/engine/*`, duration probe, stage progress, encoder
> selection, caption v2). Real testing then exposed a new set of concrete bugs (frozen
> B-roll, CPU-pegged despite "GPU-NVENC", insane ETA, boxy gradient) plus three feature
> requests: **(1) full logging of everything, (2) a download-first B-roll engine with
> restore + rate-limit handling, (3) caption repositioning.**
>
> This document is **evidence-based**: every bug cites the exact file/lines and the root
> cause, then the concrete fix. It is self-contained — any engineer/AI can execute it.
> Repo state when written: remote head `bd8378b` ("Fix long B-roll render path").

---

## A. Baseline — what is in the code right now

- `electron/services/engine/encoder.ts` — `selectEncoder()` returns NVENC/QSV/AMF/CPU args.
  NVENC = `h264_nvenc -preset p5 -tune hq -rc vbr -cq 21 -b:v 0`.
- `electron/services/engine/caps.ts` — real capability probe (lists encoders, 1-frame
  NVENC self-test, `nvidia-smi`).
- `electron/services/engine/progress.ts` — ffmpeg `-progress` parser + `etaSec`.
- `electron/services/engine/grade.ts` — LUT/curve grade chain (good).
- `electron/services/engine/audio-master.ts` — loudnorm (good).
- `electron/services/queue.ts` — staged pipeline: preparing → captioning → fetching-broll
  → assembling → encoding → finalizing, with a per-job `*.render.log`.
- `electron/services/broll.ts` — `fetchPool → downloadPool → planCoverage →
  assembleBed`/`buildBrollSegments`.
- `electron/services/render.ts` — `buildRenderArgs` with three paths: single-pass
  B-roll segments, video-bed fallback, image track. Caption v2 in `captions.ts` (Anton,
  BGR yellow `#FFD93D`, karaoke, margin-based position).

The architecture is right; the **B-roll assembly and progress math are broken**, the GPU
path doesn't decode/filter on GPU, the gradient is boxy, and there is no real logging.

---

## B. Confirmed bugs (code proof) + concrete fixes

### B1 — B-roll footage freezes ~46s while audio/length are full 🔴
**Proof / root cause.** B-roll coverage is assembled as **one giant ffmpeg filtergraph
with N looped inputs** then `concat`/`xfade`:
- `broll.ts:305-326` (`assembleBed`) builds `-stream_loop -1 -ss .. -t .. -i clip` for
  *every* segment and chains them with `concat`/`xfade`.
- `render.ts:159-211` (single-pass) does the same inline.
This is fragile: with many looped inputs, `concat`'s expectation that each segment yields
its declared duration breaks down (looping + `-t` per input + `setsar/fps` mismatches),
so the visible footage ends early (~the real pool length, e.g. 46s) while the container is
forced to full length by `-t project.durationSec` (`render.ts:208,232`) — leaving a
**frozen tail**. The screenshots labeled "B-roll **fallback**" confirm the **pre-encoded
bed path** (`render.ts:213-235`) ran, i.e. the worst case.

**Fix (redesign — see §C).** Stop building one mega-filtergraph. Instead:
1. Download each clip to a stable cached file.
2. **Normalize each clip individually** to an exact-length segment (`scale/crop/fps/trim`,
   loop a short clip with `-stream_loop` on a *single* input — reliable).
3. **Concatenate with the `concat` demuxer** (a text list of segment files). The demuxer
   plays each segment fully and the total is deterministic — **no frozen tail**.
4. If total < audio, explicitly pad the last segment (loop the list or hold an image) on
   purpose, not by accident.

**Acceptance.** ffprobe of the output: the B-roll visually updates for the full duration
(no static tail); `nb_read_frames` consistent with duration; E2E asserts bed length ==
audio length ±0.5s.

---

### B2 — CPU at 100% while the badge says "GPU-NVENC" (looks like it's lying) 🔴
**Proof / root cause.** The badge is **truthful about the encoder** (`encoder.ts:24-31`
returns `h264_nvenc`, label `GPU-NVENC`), but **nothing else runs on the GPU**:
- There is **no `-hwaccel cuda -hwaccel_output_format cuda`** decode and **no
  `scale_cuda`** anywhere in `render.ts`/`broll.ts`.
- So decoding 32 looped clips + `scale` + `concat`/`xfade` + `drawbox` gradient +
  `subtitles` burn + `zoompan` all run on **CPU**; NVENC only does the final compress.
- Net: CPU is the bottleneck (100%), GPU encode sits near-idle (the screenshots show
  GPU 0–7%). During the **bed pre-encode** it's even worse (a whole extra CPU pass).

**Fix.**
1. **Honest labeling first** (cheap, do immediately): show device as
   `NVENC encode · CPU filtering` (or split chips: "Encode: GPU" / "Filtering: CPU"), so
   the UI never appears to lie.
2. **Actually use the GPU** where it helps most — decoding + scaling stock clips:
   per-clip normalize (§C) with `-hwaccel cuda -hwaccel_output_format cuda` then
   `scale_cuda=w:h` and `h264_nvenc` for the segment encode. Keep CPU only for the
   subtitle burn (`hwdownload,format=nv12,subtitles=…,hwupload_cuda`) on the final pass.
3. **Cut filter cost dramatically** by normalizing clips one-at-a-time + concat demuxer
   (one decoder at a time, not 32) — this alone slashes CPU even on the libx264 path.

**Acceptance.** On an NVENC box, GPU "Video Encode/Decode" engines show activity and CPU
no longer pegs at 100% during assembly; the UI label matches reality.

---

### B3 — Insane "time left" (e.g. 94 minutes, jumping 0.2× ↔ 12.6×) 🔴
**Proof / root cause.** `progress.ts:35-37`:
```
etaSec = (durationSec - outTimeSec) / speed
```
- `speed` is ffmpeg's instantaneous multiplier; in a heavy multi-input filtergraph it
  swings wildly (0.2× during decode-heavy spans, 12.6× during cheap spans). Dividing by it
  with **no smoothing** makes ETA lurch from 8s to 94 min.
- Worse, ETA is computed **per ffmpeg invocation against the full duration**, but when the
  **bed pre-encode** runs there are **two** full-length encodes — the displayed ETA never
  accounts for the second pass, so it's both jumpy and wrong.

**Fix.**
1. **Smooth `speed`** with an exponential moving average (e.g. `s = 0.2*new + 0.8*prev`)
   before computing ETA.
2. **Clamp + format** ETA (cap absurd values; show "estimating…" until the EMA stabilizes
   over ~3 samples).
3. **Single-pass** (§C) removes the two-encode accounting problem; if a pre-pass is ever
   needed, compute ETA over **combined** remaining work (normalize + encode), not one pass.
4. Drive the global % off **stage weights** (already in `queue.ts:35-51`) and keep
   per-stage ETA only for the encode stage.

**Acceptance.** ETA changes smoothly, never shows >2× the realistic time, and reads
"estimating…" before it's confident.

---

### B4 — Background-overlay gradient is "boxy" (hard bands) 🟠
**Proof / root cause.** `render.ts:81-98` `overlayGradient()` draws **3 stacked
`drawbox` rectangles** with fixed alphas:
```
drawbox=...:color=black@0.22:t=fill , black@0.34 , black@0.5
```
Hard rectangle edges → the visible horizontal **bands** in the screenshot (top+bottom on).

**Fix.** Replace with a **real smooth gradient**:
- Best: generate a one-time **PNG alpha gradient** per aspect (transparent→black) and
  `overlay` it (smooth, cheap, cache it).
- Or pure-filter: a vertical `geq`/`gradients` alpha ramp, or a large-sigma feathered
  vignette/`drawbox` with blur. (PNG overlay is simplest + smoothest.)

**Acceptance.** No visible banding; the darkening fades smoothly from edge to center.

---

### B5 — Two-pass "bed" still runs (double encode) 🟠
**Proof.** `queue.ts:194-211` falls back to `buildBrollBed` (a full-length pre-encode)
when `segments.length > 45`, and the screenshots show that path ("Encoding B-roll
fallback %"). With the §C redesign the bed pre-encode is replaced by per-clip normalize +
concat-demuxer, so there is **one** final encode. Remove/retire `assembleBed` + the
`videoBedPath` path once §C lands.

---

### B6 — Captions can't be repositioned (feature request) 🟠
**Proof.** Position is a single computed `marginV` (`captions.ts:116`) with fixed
`Alignment=2` (bottom-center, `styleLine` at `captions.ts:106`). No user control.

**Fix.** Add `CaptionStyle.position` (`top | middle | lower-third | bottom | custom`) →
ASS `Alignment` (8/5/2) + `MarginV`. Surface a control in Compose (and the live preview).
Persist on the project (`captionPosition`/`captionStyle`).

**Acceptance.** Changing position in Compose moves the burned captions accordingly.

---

### B7 — Karaoke highlights *partial* words (polish) 🟡
**Proof.** Caption v2 uses a `\kf` color **sweep** (`captions.ts`), so a screenshot
mid-word shows half-yellow ("**GO**NE"). The CapCut/Hormozi look usually flips the **whole
active word** to yellow, not a left-to-right wipe.

**Fix.** Offer a "whole-word highlight" mode (active word fully `primary`, others
`secondary`) in addition to the sweep; make it the default for Hormozi/Bold/Word presets.

---

## C. B-roll engine redesign (the user's architecture) — download-first, cache, restore, rate-limit aware

A new module `electron/services/broll/` replacing the monolithic assembly:

### C1 — Download first, remember names, cache
- `fetchCandidates(themes, settings)` → ranked candidates (existing logic, but **logged**).
- `downloadAll(candidates)` → download **every** chosen clip up front to
  `me-broll-cache/<provider>-<id>.mp4`, **cache by name** (skip if present). Record a
  **manifest** (`manifest.json`: id, provider, path, duration, theme, bytes, status).
- This makes the pipeline **restartable**: if a later step fails, re-run reads the manifest
  and reuses already-downloaded clips ("restore from there").

### C2 — Normalize each clip to a segment (one at a time)
- For each planned slot, `normalizeClip(clip, w, h, fps, slotLen)` →
  `seg-<n>.mp4` (exact length; loop short clips with `-stream_loop` on a **single** input;
  GPU-accelerated when NVENC/cuda available). Cache segments too.

### C3 — Concat via the concat demuxer (deterministic, no frozen tail)
- Write `concat.txt` (`file 'seg-0.mp4'\nfile 'seg-1.mp4' …`) and
  `ffmpeg -f concat -safe 0 -i concat.txt -c copy bed.mp4` (or feed segments straight into
  the final graph). The demuxer guarantees full, gap-free coverage. If total < audio,
  append a deliberate pad (loop list / hold last / image).

### C4 — Rate-limit & failure handling (explicit)
- Each provider call is wrapped: on **HTTP 429 / quota** → mark that provider
  rate-limited and **fall through to the next source** (Pexels → Pixabay → Coverr).
- If **all** providers are rate-limited/unavailable → **do not silently produce a bad
  video**. Surface a clear status: *"Stock B-roll unavailable right now (rate limited).
  Rendering in image mode instead."* and **fall back to picture/image mode** (the existing
  image-track path) automatically, or pause for the user per a setting.
- All of this is **logged** (which provider, which query, status code, retry, fallback).

### C5 — Retire the old paths
- Remove `assembleBed` mega-filtergraph + `videoBedPath` once C1–C3 are in. Keep
  `planCoverage` (pure) but feed it into per-clip normalize, not one graph.

**Acceptance.** Pull a real render: B-roll covers the whole video; a forced 429 falls
back to the next provider; forcing all-429 renders image mode with a clear message; a
killed-mid-run render resumes from the manifest without re-downloading.

---

## D. Logging system — "log everything"

A real structured logger so problems are diagnosable from logs alone, even without the
visual render UI.

### D1 — Central logger (`electron/services/logger.ts`)
- Levels `debug|info|warn|error`; structured fields `{ ts, level, scope, msg, data }`.
- **Sinks:** (a) a rolling app log file under `app.getPath('logs')/mental-empire.log`
  (already partially via `installGlobalLogging`); (b) the per-job `*.render.log`
  (already exists — expand it); (c) console in dev.
- A renderer hook so the **renderer** can also write through the same logger over IPC
  (so UI actions are logged too).

### D2 — Log every action (scopes)
- `scrape` — every yt-dlp invocation (url, args, exit code, stderr tail).
- `download` — every mp3/clip download (url, bytes, ms, cache hit/miss, errors).
- `broll` — themes chosen; each provider request (**full URL, status code, count
  returned, rate-limit**); each clip downloaded (id, path, duration); normalize + concat
  commands; fallbacks.
- `render` — the **exact ffmpeg command line**, the chosen encoder + caps, each stage
  start/end with timing, ffmpeg stderr on failure, output path + final probe.
- `net` — a thin wrapper around `fetch`/provider calls logging method, url (redacted
  keys), status, latency, error.
- `ipc`/`ui` — notable user actions (render started, cancelled, settings changed).

### D3 — Redaction & safety
- Never log API keys/tokens (redact `key=…`, `Authorization`). Cap log size (rotate).
- A "Open logs folder" button already exists in Settings — point it at the new log.

**Acceptance.** After a render, the log shows: themes → every provider request + status →
every clip downloaded (names) → normalize/concat commands → the full final ffmpeg command
→ per-stage timings → result. A rate-limit shows clearly. No secrets appear.

---

## E. Verification (do all)

- `npm run typecheck && npm run build` green; `ME_SMOKE` matrix green.
- **B-roll**: new `ME_SMOKE=broll2` with `ME_BROLL_LOCAL` (real local clips) →
  download-manifest written, per-clip segments normalized, concat-demuxer bed == audio
  length (ffprobe), no frozen tail (sample frames near the end differ).
- **Rate-limit**: stub a 429 → asserts provider fallback; stub all-429 → asserts image-mode
  fallback + the user-facing message.
- **ETA**: unit test the EMA smoothing (jittery speeds → monotone-ish ETA, clamped).
- **Gradient**: golden-frame compares smooth vs the old banded output.
- **Captions**: position control moves the burned line (golden frames top/mid/bottom).
- **Logging**: assert the render log contains the ffmpeg command, provider statuses, and
  clip names, and that no API key string appears.
- Real-box manual: confirm GPU engines active + CPU not pegged; captions repositioned;
  gradient smooth; full-length B-roll.

---

## F. Concrete reference recipes

**Concat demuxer (deterministic bed):**
```
# concat.txt
file 'seg-0.mp4'
file 'seg-1.mp4'
...
ffmpeg -f concat -safe 0 -i concat.txt -c copy bed.mp4
# if total < audio: append a padded last segment or loop the list to cover the remainder
```

**Per-clip normalize (GPU when available; loop short clip safely):**
```
# CPU:
ffmpeg -stream_loop -1 -t <slot> -i clip.mp4 \
  -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30" \
  -an -c:v libx264 -preset veryfast -crf 21 -pix_fmt yuv420p seg-N.mp4
# NVENC + CUDA decode/scale:
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -stream_loop -1 -t <slot> -i clip.mp4 \
  -vf "scale_cuda=1920:1080" -an -c:v h264_nvenc -preset p5 -cq 21 seg-N.mp4
```

**Smooth darkening gradient (PNG overlay — no banding):**
```
# one-time: make a transparent→black vertical ramp PNG per aspect (cached), then:
-i frame -i gradient_bottom.png -filter_complex "[0][1]overlay=0:0[v]"
# pure-filter alternative: a large-sigma feathered alpha ramp via geq/gradients.
```

**Honest device label (queue/UI):**
```
device line = `${enc.label} encode · ${cudaUsed ? 'GPU' : 'CPU'} filtering`
```

**ETA smoothing (progress.ts):**
```
emaSpeed = prev == null ? speed : 0.2*speed + 0.8*prev
etaSec   = emaSpeed > 0.05 ? (duration - outTime) / emaSpeed : undefined  // else "estimating…"
clamp etaSec to a sane max; require ≥3 samples before showing a number
```

**Caption position (captions.ts):**
```
position → Alignment (top=8, middle=5, bottom=2) + MarginV
lower-third ≈ MarginV = round(h * 0.26); custom = user value
```

---

## G. Suggested order

1. **Honest device label + ETA smoothing + boxy-gradient fix** (small, high-trust wins).
2. **Logging system** (so the next steps are debuggable).
3. **B-roll redesign** (download-first + manifest + normalize + concat-demuxer + rate-limit
   fallback) — fixes the frozen 46s, the double-encode, and most of the CPU load.
4. **GPU decode/scale (CUDA)** on the normalize step.
5. **Caption reposition + whole-word highlight.**

> Companion docs: `docs/RENDER-QUALITY-BLUEPRINT.md` (full engine blueprint),
> `docs/MASTER-PLAN.md` (plain-English overview).
