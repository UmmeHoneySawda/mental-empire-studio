# GPU Render — Dynamic Test & Fix Playbook (for a local AI with shell access)

Goal: get and keep Mental Empire Studio rendering on the **GPU** (WebGL compositor +
WebCodecs hardware H.264) across the **whole** pipeline — images, zoom, color grade,
gradient/overlay, vignette/grain, captions, transitions, **and B‑roll video stitching** —
instead of silently falling back to the CPU ffmpeg path.

This is **not** a one-bug checklist. It is a **repeatable methodology**: a diagnostic loop,
a failure-class taxonomy, a scenario test matrix, and permanent instrumentation, so that
*any* GPU render failure — today's or a future one — can be reproduced, localized, fixed,
and regression-guarded with the same process.

Run everything on the **local machine with a real GPU + ffmpeg + nvidia-smi**. The
sandbox/CI cannot run WebCodecs/WebGL/a real GPU, so behavior must be verified locally.

---

## AGENT RUNBOOK — execute in order (test → fix → stitch → ship)

You are an AI agent running on the user's local Windows machine with shell access. Work
through these steps in order. Steps 4–6 are a LOOP: repeat them for every failure you hit
(there will likely be more than one), using the Taxonomy (§2) and Diagnostic Loop (§1) to
handle whatever error appears — not only the known one. Commands are PowerShell-friendly;
adjust paths to the repo root.

**STEP 0 — Setup & sanity**
- `node -v`; `npm -v`; `npm install`
- `npx tsc --noEmit` (or the repo's typecheck script) and `npm test` → record a clean baseline.
- Confirm tooling: `nvidia-smi` (record GPU + driver); locate bundled ffmpeg via
  `electron/services/bin.ts`, then `ffmpeg -hwaccels` and `ffmpeg -encoders | findstr nvenc`.
- Launch the app: `npm run dev` (confirm script in `package.json`). It must open.

**STEP 1 — Turn on instrumentation (so every failure is self-explaining)**
- Implement §5 permanent instrumentation: forward worker console to the main log, log GPU
  env + spec dims/frames on each GPU job, and add the `ME_GPU_SELFTEST` + `ME_GPU_DEBUG`
  toggles. Rebuild. This makes every later failure one log line away.

**STEP 2 — Prove the GPU encode path in isolation (fast spike)**
- Run the worker self-test (`ME_GPU_SELFTEST`): probe `VideoEncoder.isConfigSupported` and
  encode ~100 solid frames → `mp4-muxer` → tiny mp4. 
- If this fails → you have an L3/L7 problem (T3/T4); fix it here before touching the pipeline.
- If it passes → hardware encode works; proceed.

**STEP 3 — Reproduce the real failure & capture signals**
- Settings → Render engine = **GPU**, encoder = **NVENC**. Render the smallest input that
  fails (start with the §3 minimum-gate cell: ~22min × 1080p × Cinematic × phrase captions ×
  overlay).
- OBSERVE (§1.1): open `<output>/<name>.render.log`; record `[engine:gpu-fallback] <REASON>`,
  the `[gpu] ... hardware=?` line, the last `encoding NN%`, the worker console, and
  `nvidia-smi` + memory during the run.

**STEP 4 — Triage with the taxonomy (LOOP)**
- Match the captured signal to a Taxonomy row (§2: T1–T18) → localize to a layer (§0: L1–L12).
- If nothing matches, add a temp boundary log to find the throwing layer, then add a NEW
  taxonomy row once understood.

**STEP 5 — Fix the smallest thing (LOOP)**
- Apply the fix family from the matched row. Change ONE thing. Keep the ffmpeg fallback intact.
- (Known current bug = Case A / T1: stream the muxer to disk — see §7 Case A for the exact fix.)
- Rebuild.

**STEP 6 — Verify, then guard (LOOP)**
- Re-run the reproducing case. It passes only if ALL §4 success criteria hold (log
  `hardware=true` + `encoding 100%`, no fallback; `nvidia-smi` enc active; flat memory;
  ffprobe-correct output; ffmpeg used only for `[gpu:mux]`).
- Add the regression guard (§6): a unit test and/or a headless worker smoke encoding enough
  frames to exceed any in-memory buffer; add the matrix cell to the manual pass list.
- **If another failure now appears, return to STEP 3** with the next-smallest reproducing
  case. Keep looping until the minimum-gate cell passes end to end.

**STEP 7 — Expand across all scenarios (matrix sweep)**
- Run the §3 Test Matrix, varying one axis at a time (duration, resolution, aspect, encoder,
  engine setting, style, captions, motion, overlay, inputs, concurrency, interrupts).
- For each cell: it must render on GPU to 100% with correct output, OR fall back cleanly with
  a logged reason — never hang, never silently CPU-encode while claiming GPU. Loop STEP 3–6
  on any cell that fails.

**STEP 8 — Add B‑roll on GPU (Track B), then stitch the whole pipeline**
- Implement Track B (§9): `VideoDecoder` → textures → existing compositor → stitched segments
  with transitions; route B‑roll jobs to GPU when healthy, ffmpeg fallback otherwise.
- STITCH end-to-end: run the full app flow on the local machine — download → transcribe →
  compose → **GPU render** (images, B‑roll, and mixed) → audio master + mux → final mp4.
- Validate the mixed images+B‑roll cell and the concurrency + cancel/quit cells (§3).

**STEP 9 — Final regression & report**
- `npm test` green; matrix manual pass list re-checked; ffmpeg fallback still works when the
  GPU path is force-failed.
- Report back per §11 (symptom → layer/row → fix → §4 evidence → guard) for each cycle.

When STEP 6 passes for the minimum-gate cell AND STEP 8's full pipeline produces a correct
mp4 on the GPU, the core goal is met; STEP 7 breadth and STEP 9 close it out.

---

## 0. System map (where things can break)

```
queue.runJob()  ── picks engine (ffmpeg | gpu | auto); ANY gpu error → ffmpeg fallback
  └─ gpu/host.ts ── hidden BrowserWindow lifecycle, capability probe, IPC, ffmpeg mux
       └─ src/render-worker/ (Chromium renderer)
            ├─ index.ts      ── loads inputs, drives run, reports done/error
            ├─ compositor.ts ── WebGL2 shader: image→zoom→grade→vignette→grain→overlay→caption
            ├─ captions.ts   ── 2D-canvas caption layer → texture
            ├─ encoder.ts    ── WebCodecs VideoEncoder loop + probeHardwareEncode
            └─ mux.ts        ── mp4-muxer → MP4 (video-only)
  shared/renderSpec.ts ── GpuRenderSpec, GPU_AVC_CODEC; gpu/spec.ts builds it
  shared/gpuIpc.ts + preload-worker.ts ── host↔worker IPC + fs bridge
```

The layers a failure can live in (use this to localize any error):
**L1 engine selection** (queue) · **L2 worker lifecycle/IPC** (host + preload) ·
**L3 capability/probe** (encoder.probeHardwareEncode) · **L4 input load** (readFile/bitmaps)
· **L5 compositor** (WebGL) · **L6 captions** (canvas) · **L7 encode** (VideoEncoder) ·
**L8 mux/IO** (mp4-muxer + disk) · **L9 host mux/audio** (ffmpeg copy + loudnorm) ·
**L10 parity/quality** (looks wrong but no crash) · **L11 performance** (works but slow) ·
**L12 B‑roll decode** (VideoDecoder, Track B).

Key files: `electron/services/queue.ts`, `electron/services/engine/gpu/host.ts`,
`electron/services/engine/gpu/spec.ts`, `electron/services/engine/grade.ts`,
`electron/services/engine/caps.ts`, `electron/preload-worker.ts`, `shared/renderSpec.ts`,
`shared/gpuIpc.ts`, `src/render-worker/*`, Settings → `settings.renderEngine`
(`ffmpeg | gpu | auto`).

---

## 1. The diagnostic loop (apply to EVERY failure)

Repeat this loop for any symptom. Never skip step 2 or step 7.

1. **OBSERVE** — collect signals: the per-render `<output>/<name>.render.log`
   (`[engine:gpu-fallback] <REASON>`, `[gpu] ... hardware=?`, last `[stage] encoding NN%`),
   the worker devtools console, app log, `nvidia-smi`, OS memory/CPU.
2. **REPRODUCE** — find the smallest input that triggers it (vary one axis at a time using
   the Test Matrix in §3). Note whether it is deterministic, threshold-based (e.g. only past
   N minutes), or intermittent.
3. **LOCALIZE** — map the symptom to a layer L1–L12 (§0) using the Taxonomy (§2). Add a temp
   log line at the suspected boundary to confirm which layer throws.
4. **HYPOTHESIZE** — state the suspected cause in one sentence and what evidence would
   confirm/deny it.
5. **FIX (smallest change)** — change one thing. Prefer a fix that also degrades gracefully
   (keeps the ffmpeg fallback intact).
6. **VERIFY** — re-run the reproducing case; confirm the symptom is gone AND the success
   criteria in §4 hold (truly GPU, output correct).
7. **REGRESS-GUARD** — add the reproducing case to the Test Matrix / a unit or smoke test so
   the same class of failure is caught automatically next time (§6).

A fix is "done" only when steps 6 and 7 both pass.

---

## 2. Failure-class taxonomy (symptom → layer → diagnostic → fix family)

Use this to turn any error string or behavior into a localized fix. It is meant to grow:
when a new failure is solved, add a row.

| # | Symptom / signal | Likely layer | Diagnostic to confirm | Fix family |
|---|---|---|---|---|
| T1 | `[engine:gpu-fallback] Array buffer allocation failed`, dies mid-encode at a % threshold; long videos only | L8 mux/IO | Watch worker memory climb; fails near same % each time; short clips pass | Stream output to disk (don't buffer whole MP4); flat memory. **Worked example: Case A.** |
| T2 | No `[gpu]` line at all; immediate fallback | L2/L3 lifecycle/probe | `probeGpuEngine` timeout (8s) or `ready.supported=false` | Fix worker window load / preload path; enable GPU features; handle probe timeout |
| T3 | `GPU engine unsupported` / `VideoEncoder missing` | L3 capability | `VideoEncoder.isConfigSupported(...)` returns false for hw and sw | Enable Chromium video features in `main.ts`; try lower profile; else accept ffmpeg for that box |
| T4 | `configure()/encode()/flush()` throws | L7 encode | Standalone 100-frame encode (§5 spike) reproduces it | Adjust `VideoEncoderConfig` (codec/profile/bitrate/latencyMode/pixfmt) |
| T5 | `WebGL2 unavailable in render worker` / `shader compile/link failed` | L5 compositor | Worker console shows GL error/log | Fix window GPU flags (`offscreen:false`, hw accel on); fix GLSL |
| T6 | `2D context unavailable` / captions wrong/missing | L6 captions | Toggle captions off → passes | Fix canvas init / font load / draw math |
| T7 | Invalid/empty/short MP4; ffprobe can't parse; wrong duration | L8 mux | Inspect intermediate `*.gpu.mp4` with ffprobe | Ensure muxer gets codec `description` (SPS/PPS) from first chunk meta; correct timestamps/fps |
| T8 | `readFile/writeFile`/bridge error; ArrayBuffer transfer fails | L2 bridge | Log in `preload-worker.ts`; check `preload-worker.cjs` loaded | Fix contextBridge transfer / path; chunk large writes |
| T9 | Works in dev, fails packaged (worker HTML/preload not found) | L2 packaging | Compare `workerHtmlPath()` to actual `out/renderer/...` path | Fix path resolution + electron-vite inputs |
| T10 | `done` reported but `no H.264 output found` | L8 IO/timing | Check file exists + size after worker `done` | Flush/await write before reporting done |
| T11 | Output looks wrong vs ffmpeg (color/zoom/caption), no crash | L10 parity | SSIM/eyeball GPU vs ffmpeg same spec | Tune `gradeParams`/shader/caption model to match |
| T12 | GPU used but slower than expected | L11 perf | `nvidia-smi dmon` enc%, CPU%, queue backpressure | Tune `encodeQueueSize` throttle, keyint, texture re-uploads |
| T13 | B‑roll job never uses GPU | L1/L12 | `queue.ts` forces ffmpeg when `brollManifestPath` set | Implement `VideoDecoder` layer (Track B) + route when healthy |
| T14 | B‑roll decode throws / wrong codec | L12 decode | Clip codec vs `VideoDecoder.isConfigSupported` | Probe per-clip; fallback to ffmpeg for unsupported clips |
| T15 | Crash/OOM only with concurrency > 1 | L2/L7 | Run 1 vs N concurrent jobs | Serialize worker (host `chain`); cap GPU sessions |
| T16 | Cancel/delete mid-GPU leaves orphan/looks like error | L2 lifecycle | Cancel during encode | Honor cancel intent; clean temp; don't mark error |
| T17 | Audio missing/desynced/quiet in final mp4 | L9 host mux | Inspect `[gpu:mux]` cmd + loudnorm | Fix map/`-shortest`/`amix`/two-pass loudnorm |
| T18 | Intermittent / machine-specific | any | Capture full env (GPU, driver, Electron, OS); retry | Add guard + graceful fallback; log env on failure |

If a symptom matches no row: localize via §0 layers, add temp boundary logging, then **add a
new row here** once solved.

---

## 3. Scenario test matrix (run to find AND prevent regressions)

Vary one axis at a time. Each cell should either render on GPU to 100% with correct output,
or fall back cleanly with a logged reason (never a hang, never a silent CPU pass that claims
GPU). Mark each PASS / FALLBACK(reason) / FAIL.

- **Duration:** 10s · 60s · 5min · ~22min · 45min+ (memory/threshold axis — catches T1)
- **Resolution/quality:** 720p · 1080p · 1440p
- **Aspect:** 16:9 · 9:16 · 1:1 (dimension/odd-size axis)
- **Encoder setting:** nvenc · qsv · amf · cpu (label/path axis)
- **Render engine setting:** ffmpeg · gpu · auto (selection + fallback axis)
- **Style/grade:** None · Clean · Cinematic (grain+vignette) · Intense (sharpen) · Heartfelt
- **Captions:** word mode · phrase mode · multi-line · position top/mid/bottom · hook on · none
- **Motion:** Ken Burns on/off · punch-zoom on/off · long-form (motion auto-off) 
- **Overlay:** none · bottom · all-sides · varying intensity
- **Inputs:** 1 image · many images · **B‑roll (any local clip)** · B‑roll fetched via API ·
  mixed images+B‑roll · missing image (solid-bg fallback)
- **Concurrency:** 1 job · N jobs (= settings.concurrency) — catches T15
- **Interrupts:** cancel mid-encode · delete mid-encode · app quit mid-encode — catches T16
- **Environment:** note GPU model, driver, Electron version, free RAM (for T18)

Minimum gate before declaring GPU rendering "working": the **22min × 1080p × Cinematic ×
phrase-captions × overlay** cell (today's failing case) plus one **B‑roll** cell pass.

---

## 4. Success criteria — "truly GPU and correct" (use after every fix)

A render counts as a real GPU success only if ALL hold:
1. Log shows `[gpu] engine=webcodecs hardware=true` and reaches `encoding 100%` with **no**
   `[engine:gpu-fallback]` line.
2. `nvidia-smi dmon -s u` shows the **enc** engine active during the run; CPU stays low
   relative to the ffmpeg baseline (Case B).
3. ffmpeg is invoked **only** for the `[gpu:mux]` stream-copy (`-c:v copy`) + audio loudnorm —
   never the per-frame encode.
4. Worker memory stays roughly flat for the whole encode (no climb toward OOM).
5. Output mp4: correct duration (ffprobe), audio present + synced, and visually matches the
   ffmpeg path within agreed tolerance (§ parity, T11).
6. The ffmpeg fallback still works when the GPU path is force-failed (graceful degradation).

---

## 5. Permanent instrumentation (so future errors are self-diagnosing)

Make these durable (not just temporary debugging) so the next failure is one log away:
- **Forward worker console to the main log** always (or behind a `ME_GPU_DEBUG` env):
  `worker.webContents.on('console-message', …)` in `gpu/host.ts`. Capture stack traces.
- **Log GPU env on every GPU job:** GPU model (nvidia-smi), driver, Electron/Chromium
  version, free RAM, spec dims/fps/frame-count (extend the existing `[gpu] engine=...` line).
- **Log the fallback reason where the user can see it** (already in `.render.log`; consider
  surfacing the short reason in the activity feed too).
- **A worker self-test mode** (`ME_GPU_SELFTEST`): probe `isConfigSupported`, encode ~100
  solid frames through `mp4-muxer`, write a tiny mp4, report pass/fail + timings. This is the
  fast spike for T2/T3/T4 and a permanent smoke check.
- **Debug toggle** to open the hidden worker (`show:true` + `openDevTools()`) via env, so a
  developer can watch any future failure live without code edits.

---

## 6. Regression guarding (close the loop)

For each solved failure:
- Add/extend a **unit test** for any pure logic touched (spec builder, grade params, caption
  timing, dimension math) in `test/unit/`.
- Add a **headless worker smoke** where possible: encode N synthetic frames via the streaming
  muxer and assert a valid, parseable mp4 (ftyp/moov, frame count, duration) — this would have
  caught the long-video OOM by encoding enough frames to exceed the old in-memory buffer.
- Add the reproducing **matrix cell** (§3) to a documented manual pass list with expected
  result, so it is re-checked on future GPU changes.
- Keep CI (`npm test`) green; gate HW-encode tests to run only where a GPU exists, skip
  otherwise.

---

## 7. Worked examples (evidence already gathered — keep as reference, not the whole plan)

### Case A — long-video OOM in the muxer (matches T1) — CURRENT PRIMARY BUG
Real log: `[gpu] ... hardware=true ... frames~31707` then at ~55%
`[engine:gpu-fallback] Array buffer allocation failed`, then a ~0.5x ffmpeg CPU fallback.
- **Cause:** `src/render-worker/mux.ts` uses `mp4-muxer` `ArrayBufferTarget` +
  `fastStart:'in-memory'` → the **entire** MP4 is buffered in one growing ArrayBuffer; for a
  ~22‑min 1080p video it grows toward ~1GB and V8/Chromium can't allocate the next block →
  OOM near 55%. (Code comment concedes: "whole video lives in RAM until finalize().")
- **Fix:** stream to disk. In `mux.ts` use `mp4-muxer` **`StreamTarget`** + **`fastStart:false`**
  (or `'fragmented'`); add an **append/`gpu:writeChunk`** bridge in `preload-worker.ts` +
  `shared/gpuIpc.ts`; have `index.ts`/`encoder.ts` write chunks incrementally instead of one
  `writeFile` at the end. Host `ffmpegMux` already adds `-movflags +faststart`, so moov-at-end
  is fine. Result: flat memory, completes on GPU.
- **Regression guard:** headless smoke encoding enough frames to exceed the old buffer.

### Case B — CPU baseline (the fallback ffmpeg command, for perf comparison)
Real fallback command: 6 stills `-loop 1 -t 220.19` → per-still
`scale=1920:1080:...,crop,setsar,fps=24,format=yuv420p,setpts,fps=24` → `concat=n=6` →
grade `curves,colorbalance,eq,noise=alls=8:allf=t,vignette=PI/5` → `overlay` →
`subtitles='...ass'` → `-c:v h264_nvenc -preset p4 -tune hq -rc vbr -cq 21 -t 1321.13`.
- ~31,700 frames × CPU filters (heaviest: temporal `noise` + libass burn-in); NVENC only does
  the final compress, so CPU is pegged. No CUDA filters (still-image path never uses them).
- Minor cleanup: `fps=24` appears twice per still — dedupe.
- Use this command's wall-clock as the **before** number to quantify the GPU win in §4.2.

---

## 8. Feature coverage TODAY (verify with §3, close gaps)

| Effect | GPU path status | Action |
|---|---|---|
| Slideshow images | implemented | verify |
| Ken Burns + punch zoom | implemented (off on long-form) | verify parity |
| Color grade (sat/contrast/brightness/balance) | implemented | verify parity per style |
| Vignette + film grain | implemented | verify parity |
| Gradient / darkening overlay | implemented | verify |
| Captions (word/phrase, highlight, hook) | PARTIAL (pop-scale only) | port full animations/presets |
| Crossfade between stills | PARTIAL (fixed 0.4s) | port `xfade` variety + EffectPlan transitions |
| Sharpen | MISSING (`u_sharpen` uniform unused) | implement shader pass or document N/A |
| **B‑roll video stitching** | **MISSING — forces ffmpeg/CPU** | Track B |
| Audio (voice + SFX) mux | implemented (ffmpeg stream-copy) | verify |

---

## 9. Track B — B‑roll video stitching on GPU (new capability)

Today `queue.ts` forces ffmpeg whenever `brollManifestPath` is set, so B‑roll never uses the
GPU. Test clips can be **any local video** or fetched via the app's stock API
(Pexels/Pixabay/Coverr key in Settings; see `electron/services/broll.ts`).
- Extend `GpuRenderSpec` with a B‑roll track `{ path, srcStartSec, startSec, endSec, transition }`.
- Add a `VideoDecoder` in the worker → decode segments to `VideoFrame`s → upload as textures
  into the existing compositor (same grade/overlay/caption passes).
- Stitch segments by time with transitions (reuse §8 crossfade/xfade work).
- Route B‑roll jobs to GPU **only when healthy**; keep ffmpeg fallback for unsupported clip
  codecs (T14). Handle variable fps/timebase, scaling, color range, short clips (loop/hold).
- Run the full pipeline end-to-end (download → transcribe → compose → GPU render → mux) and
  the mixed images+B‑roll matrix cell.

---

## 10. Out of scope but noted
- **Thumbnails screen crash** (React minified error #310 — a hooks-order bug) is unrelated to
  rendering; track separately.

## 11. Deliverables to report back (per fix cycle)
1. Symptom + the localized layer (L1–L12) and the taxonomy row (T#) it matched (or a new row).
2. The reproducing matrix cell(s) and whether it was deterministic/threshold/intermittent.
3. The smallest fix applied, with file + line references.
4. Success-criteria evidence (§4): log `hardware=true` + `100%` no-fallback, `nvidia-smi` enc
   active, flat memory, ffprobe of output, parity note.
5. The regression guard added (§6).
