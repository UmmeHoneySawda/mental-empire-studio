# GPU Render Engine (Tier A) — WebGL compositor + WebCodecs encoder

Status: PLAN (not yet implemented)
Author: engineering
Scope: a second, GPU-native rendering path for Mental Empire Studio that composes
frames with WebGL and encodes with hardware H.264 via WebCodecs — keeping ffmpeg only
for audio decode + final mux. Runs **inside the existing Electron/Chromium app**, no
extra runtime to ship.

---

## 1. Why this exists

Today every video is built by ffmpeg's CPU filtergraph: per-frame `curves`,
`colorbalance`, `eq`, `noise`, `vignette`, `overlay`, and `subtitles` (libass). For a
~23-minute slideshow that is ~33,000 frames × 7 CPU filters, and libass text rendering is
the single biggest unavoidable cost. nvenc only does the final compression — a small slice
of total time. Result: renders are CPU-bound and slow, and caption/effect quality is
limited by what ffmpeg filters can express.

**Goal:** move compositing (color, grain, vignette, overlays, **and text/captions**) onto
the GPU with WebGL/Canvas, encode the frames with the browser's hardware H.264 encoder
(`VideoEncoder` → NVENC / Media Foundation / VideoToolbox), and let ffmpeg only:
- decode/normalize the narration + SFX audio, and
- mux the encoded H.264 video + AAC audio into the final mp4.

**Non-goals:** replacing ffmpeg for downloads, transcription, probing, or audio mastering;
removing the existing ffmpeg render path (it stays as the fallback).

---

## 2. High-level architecture

```
 ┌─────────────────────────── Electron main (Node) ───────────────────────────┐
 │ queue.runJob()                                                              │
 │   ├─ decide engine: 'gpu' (WebCodecs) | 'ffmpeg' (existing)                 │
 │   ├─ build a RenderJobSpec (images, durations, caption plan, grade, audio)  │
 │   ├─ if gpu: open/!reuse a hidden offscreen BrowserWindow ("render worker") │
 │   │     └─ IPC: render:gpu:run(spec) → progress events → {h264Path}         │
 │   ├─ ffmpeg: master + mux h264 + audio → final mp4                          │
 │   └─ fallback to ffmpeg engine on any GPU error                             │
 └─────────────────────────────────────────────────────────────────────────────┘
                              │ IPC (spec / frames-done / progress)
                              ▼
 ┌──────────────── Hidden render-worker window (Chromium renderer) ───────────┐
 │ GpuRenderer                                                                 │
 │   1. WebGL2 compositor: bg image → grade shader → vignette → grain →        │
 │      overlay → caption layer (canvas text drawn to a texture)               │
 │   2. For each output frame t: update uniforms (zoom, caption state),        │
 │      draw to an OffscreenCanvas                                             │
 │   3. new VideoFrame(canvas, {timestamp}) → VideoEncoder.encode()            │
 │   4. EncodedVideoChunk → mp4-muxer (H.264 elementary/fragments) → ArrayBuf  │
 │   5. write buffer to a temp .h264/.mp4 via IPC, report progress             │
 └─────────────────────────────────────────────────────────────────────────────┘
```

Two processes, one new module each:
- **`electron/services/engine/gpu/host.ts`** (main): worker-window lifecycle + IPC + spec
  building + ffmpeg mux. 
- **`src/render-worker/`** (renderer): the WebGL compositor + WebCodecs encoder, loaded in a
  hidden `BrowserWindow`.


---

## 3. The shared job spec

A single serializable spec drives both engines so they stay output-compatible. Define in
`shared/renderSpec.ts`:

```ts
export interface GpuRenderSpec {
  jobId: string
  width: number; height: number; fps: number       // e.g. 1920x1080@24
  durationSec: number
  images: Array<{ path: string; startSec: number; endSec: number }>  // slideshow timing
  motion: { kenBurns: boolean; punchAtSec: number[] }                 // optional zoom
  grade: GradeParams        // curves/colorbalance/eq/vignette as numeric params (see §6)
  grain: { strength: number; temporal: boolean }
  overlayPath?: string      // the existing PNG/PAM overlay, as a texture
  captions: CaptionFrameModel   // word/phrase timings + style (see §7)
  audio: { voicePath: string; sfxPath?: string }
  encoder: { codec: 'avc'; bitrateMbps: number; keyIntervalSec: number }
  out: { h264Path: string; finalPath: string }
}
```

The existing `EffectPlan` (transitions/text effects) and `gradeChain()` are converted into
this **numeric** spec rather than ffmpeg filter strings — so the GPU path reads parameters,
not CLI filters. `gradeChain()` stays the source of truth for the *values*; we add a
`gradeParams(style)` sibling that returns numbers instead of an ffmpeg string.

---

## 4. Engine selection & fallback (main process)

In `electron/services/engine/render-config.ts` add:
```ts
export type RenderEngine = 'ffmpeg' | 'gpu'
```
Selection order in `queue.runJob()`:
1. `settings.renderEngine` (new setting; default `'ffmpeg'` until GA).
2. GPU requires: WebCodecs `VideoEncoder.isConfigSupported({codec:'avc1.640028',hardwareAcceleration:'prefer-hardware'})` returns supported (probed once at startup in the worker, cached).
3. **Any** error in the GPU path → log, emit a `engine=ffmpeg (fallback)` note, and re-run
   the job through the existing ffmpeg path. The user always gets a video.

This makes the GPU engine strictly additive and safe to ship behind a setting.

---

## 5. The hidden render-worker window (main side, `gpu/host.ts`)

- Create one reusable `BrowserWindow({ show:false, webPreferences:{ offscreen:false,
  backgroundThrottling:false, preload } })` that loads `render-worker.html`.
  - `offscreen:false` is deliberate: we want real GPU compositing, not the CPU OSR path.
  - `backgroundThrottling:false` so a hidden window keeps full raf/timer speed.
- Lifecycle: lazily created on first GPU job, kept warm, destroyed on idle timeout / app quit.
- IPC contract (typed, via preload):
  - main → worker: `gpu:run(spec)` 
  - worker → main: `gpu:progress({jobId, framesDone, totalFrames, fps})`,
    `gpu:chunk({jobId, bytes})` (streamed) or `gpu:done({jobId, h264Path})`, `gpu:error`.
- Frame data never crosses IPC as pixels. The worker muxes in-renderer and only sends the
  finished byte buffer (or writes via a small `gpu:writeChunk` IPC to avoid a 2GB string).


---

## 6. The WebGL compositor (renderer, `src/render-worker/compositor.ts`)

WebGL2, one full-screen quad, one fragment shader that does the whole look in a single GPU
pass per frame (no readback between effects):

1. **Base image** sampled from a texture (the current slideshow still). Cross-fade between
   two stills near cut boundaries with a `mix()` on two samplers.
2. **Ken Burns / punch zoom**: a per-frame scale/translate uniform on the UV coords (free on GPU).
3. **Color grade** as math in the shader (replaces curves/colorbalance/eq):
   - contrast/brightness/saturation are trivial GLSL.
   - "curves=medium_contrast" → bake to a **1D LUT texture** (256×1) sampled per channel, or
     a 3D LUT texture (`.cube` → `sampler3D`) for exact parity with the ffmpeg look.
4. **Vignette**: radial falloff from UV center (a few GLSL lines).
5. **Grain**: hash-noise in the shader; `temporal` adds a per-frame seed uniform. Far cheaper
   than ffmpeg `noise` and fully controllable.
6. **Overlay**: sample the existing overlay texture, `mix` by its alpha.
7. **Captions**: composite the caption texture (see §7) on top, by alpha.

Output: draw to an `OffscreenCanvas` sized to the video. Because the canvas is GPU-backed,
the subsequent `new VideoFrame(canvas)` stays on the GPU where the platform allows.

**Color-accuracy strategy:** to guarantee the GPU output matches the current ffmpeg look,
generate a `.cube` 3D LUT from the existing grade chain once (offline, via ffmpeg
`lut3d`/`haldclut` capture) per style and ship those LUTs as assets. The shader applies the
LUT; vignette/grain are parameterized to match.

---

## 7. Captions on the GPU (the real quality win)

This replaces libass entirely.

- **Model:** reuse the transcript word timings already produced for `.ass`. Build a
  `CaptionFrameModel` = ordered word groups with `{start,end,text,emphasis}` + a style
  (preset/font/size/position/animation), shared with the ffmpeg path so both look the same.
- **Rendering:** a dedicated 2D canvas ("caption layer") the size of the video. Per frame we
  redraw only when the active group/word changes (not every frame). Use the **same fonts**
  already bundled (`@fontsource/*`) so typography matches the editor.
  - Word-by-word highlight, pop/slide/bounce animations = canvas transforms + easing — these
    are the "animated captions" ffmpeg can't do well.
  - The caption canvas is uploaded as a texture and composited in the WebGL pass (§6.7).
- **Determinism:** drive everything by frame index `t = frame/fps`, never `requestAnimationFrame`
  wall-clock, so output is reproducible and not real-time-bound.

---

## 8. Encoding with WebCodecs (`src/render-worker/encoder.ts`)

```ts
const encoder = new VideoEncoder({
  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
  error: (e) => reportError(e),
})
encoder.configure({
  codec: 'avc1.640028',           // H.264 High@L4
  width, height,
  bitrate: bitrateMbps * 1_000_000,
  framerate: fps,
  hardwareAcceleration: 'prefer-hardware',
  latencyMode: 'quality',
})
```

Per frame loop (pull, not real-time):
```ts
for (let f = 0; f < totalFrames; f++) {
  compositor.drawFrame(f)                          // GPU compose
  const frame = new VideoFrame(offscreenCanvas, { timestamp: Math.round(f / fps * 1e6) })
  const keyFrame = f % (fps * keyIntervalSec) === 0
  encoder.encode(frame, { keyFrame })
  frame.close()                                    // critical: avoid VRAM leak
  if (encoder.encodeQueueSize > 8) await waitForDrain(encoder)  // backpressure
  if (f % fps === 0) reportProgress(f, totalFrames)
}
await encoder.flush()
```

Key correctness points: **always `frame.close()`**, throttle on `encodeQueueSize`
(backpressure so we don't OOM VRAM), force keyframes on an interval, and use `latencyMode:
'quality'`.


---

## 9. Muxing + audio (`src/render-worker/mux.ts` + ffmpeg)

WebCodecs emits an H.264 **elementary stream**, not a container. Options:

- **Preferred:** mux video in-renderer with [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer)
  (pure JS, no native dep) into a video-only fragmented mp4 buffer. Then in main, ffmpeg
  muxes that video with the mastered AAC audio:
  `ffmpeg -i video.mp4 -i audio.m4a -c copy -movflags +faststart final.mp4` (no re-encode,
  near-instant).
- **Audio path stays ffmpeg:** decode the narration + SFX, run the existing two-pass
  loudness master, output AAC. This reuses `audio-master.ts` unchanged.
- WebCodecs `AudioEncoder` could do AAC too, but ffmpeg already does mastering well — keep it.

So ffmpeg's remaining role = audio master + one stream-copy mux. Both are tiny vs the old
per-frame filtergraph.

---

## 10. Integration points (what changes in the existing code)

| File | Change |
|---|---|
| `shared/renderSpec.ts` | NEW — `GpuRenderSpec`, `CaptionFrameModel`, `GradeParams` |
| `shared/types.ts` | add `renderEngine?: 'ffmpeg' \| 'gpu'` to `AppSettings` |
| `electron/services/engine/grade.ts` | add `gradeParams(style)` returning numbers (LUT id + vignette/grain) |
| `electron/services/engine/gpu/host.ts` | NEW — worker window + IPC + spec build + mux |
| `electron/services/queue.ts` | branch on engine; build spec; fallback to ffmpeg on error |
| `electron/ipc/render.ts` + `preload.ts` | typed `gpu:*` channels for the worker window |
| `electron/main.ts` | register worker preload; destroy worker on quit |
| `src/render-worker/*` | NEW — `index.html`, compositor, caption layer, encoder, mux |
| `electron.vite.config.ts` | add the worker HTML as a second renderer entry |
| `src/screens/Settings.tsx` | "Render engine: Auto / ffmpeg / GPU (beta)" under Output |
| `assets/luts/*.cube` | NEW — baked grade LUTs per style |

The Konva thumbnail rasterizer already proves the canvas→image pattern in this app; this is
the same idea extended to a frame stream + hardware encoder.

---

## 11. Phased rollout

- **P0 — Spike (1–2 days):** standalone worker page that encodes 100 solid-colour frames with
  `VideoEncoder` + `mp4-muxer`, muxed with a dummy audio track. Proves WebCodecs HW encode +
  mux + ffmpeg copy on the three target OSes. Gate everything behind capability probe.
- **P1 — Static slideshow parity:** images + Ken Burns + grade LUT + vignette + overlay, no
  captions. Compare output to the ffmpeg path (PSNR/SSIM + eyeball). Wire `renderEngine`
  setting + fallback.
- **P2 — Captions:** port caption model to the canvas renderer; match the existing presets;
  add the animated-caption styles ffmpeg couldn't do.
- **P3 — Audio + mux integration** through `queue.runJob()` end-to-end; progress + cancel.
- **P4 — Polish/GA:** B-roll video layers (decode clips via `VideoDecoder` → texture),
  benchmarks, default `renderEngine:'auto'` when HW encode is present.


---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| HW H.264 unsupported on a machine | Capability probe → auto-fallback to ffmpeg; never block a render |
| WebCodecs encoder quality knobs coarser than nvenc CLI | Tune bitrate/keyint; keep ffmpeg path for users who want CRF control |
| Colour mismatch vs current look | Bake per-style `.cube` LUTs from the ffmpeg grade; SSIM-gate in P1 |
| VRAM leak / OOM on long videos | `frame.close()` every frame + `encodeQueueSize` backpressure + idle worker teardown |
| Hidden window throttled when minimized | `backgroundThrottling:false`; drive by frame index, not rAF |
| B-roll (video) inputs | Deferred to P4 via `VideoDecoder`; until then, GPU engine only for image projects, ffmpeg for B-roll jobs |
| Determinism / reproducibility | Frame-index clock, fixed seeds for grain, golden-file tests |
| Packaging | No new runtime — WebCodecs + WebGL ship with Electron; only add `mp4-muxer` (pure JS) + LUT assets |

---

## 13. Testing

- **Unit (vitest, today's harness):** `gradeParams()` mapping; spec builder from `EffectPlan`;
  caption-frame model timing (which group/word is active at frame t); muxer byte-header sanity.
- **Worker integration (headless):** encode N synthetic frames, assert a valid mp4 (moov/ftyp,
  frame count, duration) parses back.
- **Parity:** render the same `GpuRenderSpec` via both engines on a fixture project; assert
  SSIM ≥ threshold per style and identical duration/framecount.
- **Fallback:** force `VideoEncoder.configure` to reject → assert the job still completes via
  ffmpeg and the queue reports `engine=ffmpeg (fallback)`.
- CI keeps `npm test`; worker/HW-encode tests run where a GPU is available, skipped otherwise.

---

## 14. Effort estimate

P0 spike ~2d · P1 slideshow parity ~3–4d · P2 captions ~3–5d · P3 integration ~2–3d ·
P4 polish/B-roll ~1wk. Total ≈ **3–4 focused weeks** for GA, but P0–P1 alone (≈1 week) already
delivers GPU-composited, hardware-encoded static-image videos with automatic ffmpeg fallback.

## 15. Definition of done (GA)

- `renderEngine: 'auto'` uses GPU when HW H.264 is present, ffmpeg otherwise, with seamless
  fallback on any error.
- Image projects render with GPU compositing + hardware encode; captions are GPU-drawn and
  support animated styles.
- Output matches the ffmpeg look within the SSIM gate; audio mastering unchanged.
- ffmpeg's role reduced to audio master + stream-copy mux.
