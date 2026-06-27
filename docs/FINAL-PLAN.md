# Mental Empire Studio — FINAL Plan (Whole-App Usability Audit + Consolidated Fixes)

> This is the **single authoritative plan**. It is the result of reading the *entire*
> current codebase (post-GPT implementation, remote head `bd8378b`) from the **user's
> point of view and real use case**, plus every problem reported across all test rounds.
> It supersedes the scattered notes and folds in the earlier Tasks 1–5.
> Companion detail docs: `RENDER-FIXES-V2.md` (B-roll redesign + logging),
> `RENDER-QUALITY-BLUEPRINT.md` (engine recipes), `MASTER-PLAN.md` (plain-English).

---

## 0. Honest verdict — is it usable?

**The machinery works** end-to-end: you *can* add a channel → fetch → download audio →
compose (images / B-roll / captions) → queue → render a real MP4 (NVENC included). GPT
implemented a lot correctly (duration probe, encoder/caps selection, stage stepper,
caption v2 with Anton + yellow active word, transcription chunking + retries + a logger).

**But it is not yet trustworthy or pleasant**, which is what separates "works in a demo"
from "million-dollar software." Three categories hold it back:
1. **Output correctness bugs** — B-roll freezes ~46s, the overlay gradient is boxy, and
   the B-roll path double-encodes.
2. **It misleads the user** — ETA jumps from 8s to 94 min, the badge says "GPU" while CPU
   is pegged, and several failures are **silent** (you can't tell what went wrong).
3. **Missing table-stakes UX** — no real preview before a long render, no way to open the
   finished file, no caption reposition / aspect switch on a one-off, no stop-while-render.

So: **functional, not yet shippable.** The phased plan in §3 gets it to shippable.

---

## 1. The producer journey — screen by screen (what works / what blocks)

| Step | Screen | Works | Blocks / gaps (from your POV) |
|---|---|---|---|
| Add channel | My Channels | scrape stats, delete, goals, avatar | total-views can show **0** instead of hidden (D9 partial); add-failure messaging thin |
| Fetch source | Download | flat fetch is **fast again** (regression fixed) | **fetch errors are silent** (yt-dlp/network fail → nothing shown); views "—" by design |
| Download audio | Download | real mp3, resume, history, delete | status text clip (minor); failures rely on a message string |
| Compose | Compose | images, ranges, random pool, transcript, caption v2 preview, beta panel | **no real video preview**; **can't change caption aspect** (16:9/1:1/9:16) here; **can't reposition captions**; B-roll has no preview |
| Captions | Compose | word-level, emphasis, auto-detect, presets, live mock | karaoke highlights **partial words**; reposition missing |
| Send to render | Compose | queues; only audio required | OK |
| Render | Render Queue | stage stepper, device chip, progress, retry/delete | **ETA insane**; **CPU pegged despite NVENC**; **B-roll freezes ~46s**; **boxy gradient**; **no "open finished file/folder"**; **no stop/cancel while rendering** (× deletes) |
| Profiles | Profiles | full config, run, auto-watch, edit | **run failures are silent** (no error surfaced); no per-step run progress |
| Automation | scheduler/tray | scheduler starts, tray, login-item, webhook | fine; relies on logs which are incomplete |
| Settings | Settings | encoder selector, quality, auto-scrape, keys, resets | stock-footage (B-roll) keys exist but the **dependency isn't explained** (B-roll silently no-ops without keys) |

---

## 2. Consolidated problem register (every issue, with proof + fix + severity)

Severity: 🔴 blocker · 🟠 major · 🟡 polish. "State" = already done by GPT / open.

### A. Render correctness
- **A1 🔴 B-roll freezes ~46s** while audio+length are full. *Proof:* one mega-filtergraph
  with looped inputs + concat/xfade (`broll.ts:305-326`, `render.ts:159-211`); the
  "fallback" pre-encoded bed path ran (`render.ts:213-235`). *Fix:* download-first →
  per-clip normalize → **concat demuxer** (deterministic, no frozen tail) — see §RENDER-FIXES-V2 §C. *State: open.*
- **A2 🟠 Boxy overlay gradient.** *Proof:* `render.ts:81-98` `overlayGradient()` = 3 hard
  `drawbox` rectangles → the gray bands. *Fix:* smooth PNG-alpha overlay or feathered
  ramp. *State: open.*
- **A3 🟠 Double-encode.** *Proof:* `queue.ts:194-211` falls back to `buildBrollBed`
  (full pre-encode) + the final encode. *Fix:* single-pass via the normalize+concat
  demuxer; retire `assembleBed`/`videoBedPath`. *State: open.*
- **A4 ✅ 47s duration bug** — *fixed:* `queue.ts:115-127` probes true duration and pins
  `-t`. Keep the `-shortest`/`apad` audit (ensure short SFX can't truncate). *State: mostly done; verify.*

### B. Performance / GPU
- **B1 🔴 CPU 100% despite "GPU-NVENC".** *Proof:* `encoder.ts:24-31` returns nvenc
  (badge truthful), but **no `-hwaccel cuda` / `scale_cuda`** anywhere → all decode +
  scale + concat + xfade + drawbox + subtitles run on CPU; NVENC only compresses. *Fix:*
  (1) honest label ("NVENC encode · CPU filtering"); (2) GPU decode/scale on the per-clip
  normalize; (3) drastically cut filter cost via normalize+concat (one decoder at a time). *State: open.*

### C. Feedback / observability
- **C1 🔴 Insane ETA (8s ↔ 94 min).** *Proof:* `progress.ts:35-37` `eta=(dur-out)/speed`
  with **no smoothing**, and the speed swings wildly; the double-encode makes it worse.
  *Fix:* EMA-smooth speed, "estimating…" until stable, clamp, single-pass. *State: open.*
- **C2 🟠 B-roll not logged at all.** *Proof:* `broll.ts` does **not** import the logger;
  no record of which clips download, provider requests, rate-limits, or errors. *Fix:* the
  logging system in §RENDER-FIXES-V2 §D — log every provider request (url, status, count,
  rate-limit), every clip (id, path, bytes), normalize/concat commands, the final ffmpeg
  command, per-stage timings; redact keys. *State: open (a logger exists; extend it to
  broll/render/net).*
- **C3 🟡 No global action log.** A logger exists (`logger.ts`, used by downloader/
  transcribe/ytdlp). Extend to a per-job + global action log incl. renderer actions. *State: partial.*

### D. Usability gaps (found in this audit — not yet reported)
- **D1 🔴 No real video preview.** You commit to a multi-minute render blind; you only see
  a static caption mock + a Ken-Burns placeholder (`Compose.tsx` MediaTab/CaptionPreview).
  *Fix:* a short **preview render** (first ~6–10s, fast/low-res) or a live canvas preview
  of image + caption + grade. *State: open.* **(Biggest UX gap.)**
- **D2 🟠 Can't open the finished render.** *Proof:* `shell.showItemInFolder` is wired for
  downloads (`download.ts:110`) and logs, **not** for render outputs. *Fix:* Open file /
  Open folder / Play buttons on `done` rows (+ `render:reveal` IPC). *State: open.*
- **D3 🟠 Caption aspect not changeable in Compose.** Only Profiles sets 16:9/1:1/9:16; a
  one-off can't switch to vertical/Shorts. *Fix:* an aspect selector in Compose. *State: open.*
- **D4 🟠 Caption reposition missing.** Position is a fixed lower-third `marginV`
  (`captions.ts:106,116`, `Alignment=2`). *Fix:* position control (top/middle/lower/custom)
  → ASS Alignment+MarginV + persist. *State: open.*
- **D5 🟠 Silent failures.** `fetchSource`/`runProfile` (`useData.ts:183-193,334-347`) don't
  surface errors; `Download.fetchVids` and `Profiles.run` don't catch. A failed fetch or
  profile run shows **nothing**. *Fix:* propagate + toast/inline error everywhere. *State: open.*
- **D6 🟡 No stop/cancel while rendering.** Only ↻ (on error/blocked) and × (delete). *Fix:*
  an explicit Cancel on a rendering row (kills ffmpeg, returns to queued — `cancelRender`
  already exists). *State: open.*
- **D7 🟡 B-roll silently no-ops without stock keys.** If no Pexels/Pixabay/Coverr key, B-roll
  produces nothing and the render falls back to stills with no message. *Fix:* detect "no
  keys" up front; tell the user + offer image mode. (Ties to the rate-limit fallback.) *State: open.*

### E. Captions quality
- **E1 🟡 Partial-word highlight.** `\kf` color **sweep** shows half-yellow words
  ("**GO**NE"). *Fix:* whole-word active highlight mode (default for Hormozi/Bold/Word). *State: open.*
- **E2** Reposition = D4. Aspect = D3.

### F. B-roll architecture (your proposed design — adopt it)
- **F1 🔴 Download-first + cache + manifest** → restartable; **normalize per-clip** →
  **concat demuxer** (fixes A1/A3); **rate-limit → next provider → if all limited, message
  + image mode** (fixes D7); GPU decode/scale (fixes B1). Full spec: `RENDER-FIXES-V2.md §C`. *State: open.*

### G. Earlier Tasks 1–5 + prior review items — current state
- **T1 GPU/B-roll** → see B1/A3 (encoder done; pipeline open).
- **T2 hide-empty views** → scrape now returns '' for missing (`scrape.ts:55,68,113`);
  **verify the UI actually hides** (Library/My Channels) instead of showing 0/"unavailable". *State: partial.*
- **T3 render feedback** → stepper/stages **done**; ETA broken (C1). *State: partial.*
- **T4 fetch speed** → **fixed** (`scrape.ts:159` flat:true). *State: done.*
- **T5 B-roll speed** → A3/B1/F1. *State: open.*
- Prior review rounds (22 + 14 + 8 issues) → **all previously fixed/pushed.**

---

## 3. The final phased plan (do in order; each phase is shippable)

### Phase 0 — Stop misleading the user (fast, high-trust) 🔴
- **C1** ETA smoothing + "estimating…" + clamp.
- **B1(label)** honest device label ("NVENC encode · CPU filtering").
- **A2** smooth gradient (PNG-alpha overlay).
- **D5** surface fetch/profile-run errors (toasts/inline).
- **D2** open finished render (file/folder/play).
- *Gate:* nothing on screen lies; failures are visible; you can open results.

### Phase 1 — Logging everywhere (so the rest is debuggable) 🟠
- **C2/C3** extend the logger to B-roll (provider requests, statuses, rate-limits, clip
  names, bytes), the network layer, the exact ffmpeg command, per-stage timings, and
  renderer actions; per-job `*.render.log` + rolling app log; redact keys. ("Open logs
  folder" already in Settings.)
- *Gate:* a single render's log explains the whole run end-to-end.

### Phase 2 — B-roll engine redesign (fixes the frozen 46s, double-encode, most CPU) 🔴
- **F1/A1/A3** download-first + cache + manifest (restartable) → per-clip normalize →
  concat demuxer → rate-limit → provider fallback → all-limited → message + image mode.
- **B1(real)** GPU decode/scale (`-hwaccel cuda`, `scale_cuda`) on the normalize step.
- *Gate:* B-roll covers the whole video (no frozen tail); one encode; GPU active, CPU not pegged; a killed render resumes from the manifest; rate-limit falls back cleanly.

### Phase 3 — Compose UX: preview + caption control 🔴/🟠
- **D1** real preview (short fast preview render or live canvas with image+caption+grade).
- **D3** caption aspect selector in Compose.
- **D4** caption position control (+ persist) → ASS Alignment/MarginV.
- **E1** whole-word highlight option (default for Hormozi/Bold/Word).
- **D6** stop/cancel while rendering.
- *Gate:* you can preview, reposition, switch aspect, and stop a render — before/while it runs.

### Phase 4 — Polish to "premium" 🟡
- Cinematic styles as real recipes (grade/grain/vignette/motion — blueprint WS-5), audio
  mastering (loudnorm), design-system cleanup, golden-frame visual tests, T2 verify.
- *Gate:* a sample render reads as CapCut/Submagic-tier; quality can't silently regress.

---

## 4. Decisions I need from you

1. **Preview style (D1):** a quick **6–10s preview render** (accurate, ~10–20s wait) vs a
   **live canvas mock** (instant, approximate). *Recommend: quick preview render.*
2. **Captions engine** (from the blueprint): **upgrade ASS** (fast, offline — recommended)
   vs **Remotion** (premium, heavier). Still relevant for Phase 4 polish.
3. **Do you want me to start executing Phase 0 now**, or keep planning? (Say "go P0" etc.)

---

## 5. Acceptance for "shippable" (definition of done)

- A real 10–20 min source renders: **full-length B-roll (no freeze)**, **smooth gradient**,
  **GPU active / CPU not pegged**, **sane ETA**, captions positioned where chosen.
- Every failure (no keys, rate-limit, network, ffmpeg error) shows a **clear message** and
  the **log explains it**.
- You can **preview** before rendering and **open** the result after.
- `npm run typecheck && build` green; `ME_SMOKE` matrix green incl. new B-roll/logging tests.
