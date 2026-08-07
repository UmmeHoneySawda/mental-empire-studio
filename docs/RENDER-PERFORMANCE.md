# Render performance

Baseline, tuning rationale and measurement protocol for the export pipeline. The rendering
performance phase is **complete** — see [Phase status](#phase-status) before changing anything here.

## Reference machine

Every number in this document and in the perf comments in `electron/services/engine/grade.ts` and
`electron/services/video-engine/render/postprocess/ffmpeg-grade.ts` was measured on:

| | |
|---|---|
| CPU | Intel i5-6500, 4 cores / 4 threads @ 3.2 GHz |
| RAM | 15.9 GB |
| GPU | GeForce GTX 1660 Ti, 6 GB, driver 610.62 |
| ffmpeg | N-122467-gc3d3377fe1 (NVENC / NVDEC available) |
| Remotion | 4.0.502 |

Four threads with no SMT is the important detail: it makes single-threaded ffmpeg filters
disproportionately expensive, and it caps useful render concurrency at 2. Conclusions about
concurrency and about filter threading will not transfer to a machine with more cores.

## Baseline

`npm run bench:render` on the deterministic fixture — 5400 frames @ 30fps (3 min, 1080p), 27
scenes, 23 transitions, 450 caption words, Cinematic grade on:

```
total    473.9s
  render   409.4s   13.19 fps    86.4%
  grade     60.3s                12.7%
  bundle     2.0s                 0.4%
gpu      mean 20% util, peak 1969 MiB VRAM, peak NVENC sessions 1
```

The shape matters more than the totals: **the Remotion render stage is ~86% of export.** Any future
optimisation that is not in that stage is working on the remaining 14%.

Peak NVENC sessions of 1 confirms encoding stays in a single ffmpeg process even at concurrency 2,
so `hardwareAcceleration: 'required'` is not silently degraded by parallel rendering. GPU mean
utilisation of 20% is expected and is not headroom: the render is bound by Chromium rasterisation
and JPEG encode on 4 CPU threads, not by the GPU.

## Benchmark variance

**This machine has a ±10% run-to-run spread on full-project renders, and worse across sessions.**
The same concurrency-2 configuration has measured 364.9s, 443.5s and 531.8s in different sessions —
a 46% spread with no code change between them. Grade-only runs of an identical filter chain have
measured 63.9s and 74.3s.

Consequences for anyone measuring here:

- **Never compare a number to one from a previous session.** Thermal state, background load and
  Windows scheduling dominate differences under ~15%.
- **Interleave arms, do not block them.** Run A, B, A, B so drift hits both. Blocked runs
  attributed a thermal ramp to the second arm more than once during this work.
- **Anything under ~15% on a full render is unmeasurable here.** Move the change to a short slice
  where variance is ±2% (300 frames reproduced the GL result at ±2%), or to a direct ffmpeg probe on
  a fixed master, and take a median of 3.
- **Prefer minimum over mean** for wall-clock comparisons. The minimum is the least contaminated
  sample; the mean mostly measures background noise.
- Two "wins" were retracted during this work purely because they were variance. Both looked like
  8-17% improvements on unpaired runs and measured neutral-to-worse when paired.

`npm run bench:render` prints a Remotion `ProtocolError (Page.bringToFront): Target closed` on
teardown after a successful run. It is benign browser-teardown noise; trust `BENCH_RENDER_OK` and
the reported totals.

## Completed optimisations

All shipped, all measured paired. Do not redo these.

| Change | Effect | Where |
|---|---|---|
| `concurrency` derived from core count instead of hardcoded 1 | -13.2% render | `concurrencyForMachine`, `video-engine/remotion/adapter.ts:134` |
| Exposure baked into a `lutyuv` LUT | removed an RGB round trip | `ffmpeg-grade.ts` |
| `colorbalance` → native `yuv420p` `lutyuv` | removed the chain's last RGB round trip | `ffmpeg-grade.ts` |
| `colorbalance` dropped from Heartfelt | RGB-only stage removed from the preset | `engine/grade.ts` |
| `vignette=…:eval=init` | mask computed once, not per frame | both grade builders |
| Zeroed look-adjust sliders no longer emit filters | avoided a whole rgb24 round trip for a no-op | `engine/grade.ts` |
| **`vignette` dithering dropped when grain is in the chain** | **-20.3% grade pass** (74.3s → 60.3s full length) | both grade builders |

### Why concurrency is 2 and not higher

```
sweep A (loaded)   concurrency 1 -> 510.9s (10.57 fps)   <- the old hardcoded value
                   concurrency 2 -> 443.5s (12.17 fps)   <- -13.2% vs 1
sweep B (idle)     concurrency 2 -> 364.9s (14.80 fps)
                   concurrency 4 -> 427.0s (12.65 fps)   <- +17.0% vs 2, past the peak
```

`cores / 2`, capped at 4. Remotion refuses values above the core count, so 6 and 8 are unmeasurable
here. Override with `MES_REMOTION_CONCURRENCY` when profiling. Rows from different sweeps are not
comparable to each other — only the within-sweep pairs are.

### Why vignette dithering is gated on grain

`vignette` is ~57% of the grade pass (11.20s of 12.45s on 900 frames, against a 4.65s decode+encode
floor) and it is **not slice-threaded** — `-filter_threads 1` measures 9.84s against the default's
9.86s — so it holds one core of four while the rest idle. Its dithering is most of that cost.

Dithering hides quantisation banding in the vignette's own gradient, so it is only safe to drop when
something else already decorrelates that error. Grain does. Widest run of identical luma along the
centre row of a flat mid-grey field, the worst case for banding:

```
grain then vignette (classic Cinematic order):  dither=1  4px   dither=0  4px
vignette then grain (video-engine order):       dither=1  6px   dither=0  5px
no grain at all:                                dither=1 13px   dither=0 19px
```

Indistinguishable with grain on either side; half again worse without it. The two vignettes differ by
51.1 dB on that field, where the grain the chain already applies perturbs the same frame by 45.3 dB —
the dither sits well under the noise floor of the look containing it. Hence the gate rather than an
unconditional `dither=0`: Cinematic is the only preset carrying grain, so Intense and Heartfelt keep
dithering unless a look adjust adds grain of its own.

## Measured and rejected

Recorded so these are not attempted again. Each was implemented far enough to measure.

**`format=yuv420p` inserted after RGB-only stages** — +4.4% (worse), bit-identical output (inf dB
PSNR). An earlier unpaired run suggested 47.6s → 39.4s; that was variance. The idea was to stop
downstream filters running at 4:4:4, but the added conversion costs more than the wider processing it
avoids, and it hurt Intense worst (19.65s → 23.86s) because only `unsharp` and `vignette` follow it.

**NVDEC (`-hwaccel cuda`) on the grade pass** — 12.45s → 12.73s. Decode is only ~2.2s of the pass,
and because the grade filters are CPU filters, reading frames back over PCIe costs more than NVDEC
saves. The NVIDIA hardware-acceleration guide's decode advice does not cover this case; it assumes a
GPU filter chain or a straight transcode. NVDEC would only pay off if the whole chain moved to
`_cuda`/`_npp` filters, which none of these looks have equivalents for.

**Baking Cinematic's `curves` + `colorbalance` into one `lut3d`** — genuinely fast (-36.6%, or -41.6%
combined with the dither gate) but **lossy at 51.6 dB**, so it was not shipped. Note for anyone
revisiting: a 1D LUT cannot substitute here. `colorbalance` derives its shadow/mid/high weights from
pixel *lightness*, which depends on all three channels, so the composition is not per-channel
separable despite `curves` being so. A 3D LUT is the correct tool and costs measurable accuracy.
Worth reconsidering only if the quality constraint is relaxed; `None` is the default style, so this
chain is opt-in and rarely on the critical path.

**Chromium GL backend** — already correct, and verified rather than assumed. `gl: 'angle'` against
forced-software `swangle` on a 300-frame slice, interleaved:

```
angle    20.6s  14.56 fps
swangle  64.6s   4.64 fps   (+213.6%)
```

GPU rasterisation is live and carrying 3.1x. This was worth testing because no other setting proves
Chromium did not silently fall back to SwiftShader.

**Composition feature isolation** — no hotspot. Removing captions, the hook overlay or transitions
each measured *slower* than the baseline (55.7s baseline vs 56.0s / 58.9s / 61.5s), i.e. entirely
inside the noise. The render cost is uniform per-frame raster and encode, not any one feature.

**Remaining Remotion knobs** — `jpegQuality` and `scale` both trade visual quality and were excluded.
`offthreadVideoCacheSizeInBytes` is inert because the composition uses `@remotion/media`, not
`<OffthreadVideo>`. `mediaCacheSizeInBytes` already defaults to half of system memory.

## Phase status

**Complete.** The render stage is correctly configured for this hardware and the grade pass is down
to a decode/encode floor plus one unavoidable single-threaded filter. Everything left either trades
visual quality or measures inside the noise.

Do not open further performance work here speculatively. Revisit only if a future feature introduces
a **measured** regression, and when that happens:

1. Reproduce with `npm run bench:render` and compare against a baseline captured **in the same
   session**, not against the table above.
2. Attribute the regression to a stage before changing anything — render, grade and bundle are
   reported separately for this reason.
3. Use `--grade-only` to iterate on filter chains without paying the 409s render.
4. Respect the variance rules above; most apparent regressions under 15% are not real.
