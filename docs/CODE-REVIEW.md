# Mental Empire Studio — Full Code Review (line-level audit)

> A from-scratch read of the current codebase (remote head `bd8378b`) looking for **bugs,
> correctness gaps, robustness holes, performance issues, security, and maintainability** —
> not just the reported render problems. Every finding cites `file:line` and a concrete fix.
> Severity: 🔴 blocker · 🟠 major · 🟡 minor/polish · 💡 improvement. This complements
> `FINAL-PLAN.md` (the phased plan) and `RENDER-FIXES-V2.md` (B-roll/logging detail).

## Scorecard

| Area | Grade | One-line |
|---|---|---|
| Architecture | B+ | Clean layering (ipc/services/engine/db, typed preload). Good bones. |
| Correctness | C | Real bugs in render lifecycle, B-roll coverage, cancel, audio-master. |
| Robustness | C− | ~30 empty `catch {}` swallow errors; several silent failures. |
| Performance | C | 30-input filtergraph + double-encode + extra audio pass; no GPU decode. |
| UX | C | No preview, can't open output, silent profile runs, fake Settings log. |
| Maintainability | C− | 572 inline `style={{}}`; duplicated path resolvers; mock coupling. |
| Security | A− | spawn arg-arrays (no shell injection), CSP tight, keys redacted in logs. |

---

## 1. Correctness bugs

- **1.1 🔴 Cancelling a GPU render silently restarts it on CPU.** `render.ts:328-334`: the
  NVENC→CPU fallback `catch` retries on libx264 for *any* failure — including a
  `cancelRender()` SIGKILL. So pressing cancel/delete on an NVENC job kills the GPU encode,
  then **immediately starts a fresh CPU encode** (the queue's cancel-intent check in
  `queue.ts:233` never runs because `runRender` swallowed the rejection). *Fix:* in the
  catch, `if (intents.has(jobId)) throw e` (re-throw on intentional cancel/delete) before
  attempting the CPU fallback.
- **1.2 🟠 Audio-master failure marks a good render as "failed".** `render.ts:336`
  `await masterAudioTwoPass(outPath)` runs after the encode; if loudnorm pass-1 parse or
  pass-2 mux throws (`audio-master.ts:34,73`), `runRender` throws → the job shows **error**
  even though a valid MP4 exists. *Fix:* wrap in try/catch; on failure keep the un-mastered
  MP4 and log a warning (non-fatal).
- **1.3 🔴 B-roll freezes ~46s.** One mega-filtergraph with looped inputs + concat/xfade
  (`broll.ts:301-326`, `render.ts:159-211`); coverage breaks, the tail freezes while `-t`
  forces full length (`render.ts:208`). *Fix:* download-first + per-clip normalize + concat
  demuxer (`RENDER-FIXES-V2.md §C`).
- **1.4 🟠 Boxy overlay gradient.** `render.ts:81-98` = 3 hard `drawbox` rects → visible
  bands. *Fix:* smooth PNG-alpha overlay / feathered ramp.
- **1.5 🟠 Insane ETA.** `progress.ts:35-37` divides remaining by ffmpeg's jittery `speed`
  with no smoothing. *Fix:* EMA-smooth + "estimating…" + clamp + single-pass.
- **1.6 🟠 Settings "Activity log" is fake.** `Settings.tsx:3` imports `activity` from
  `data/mock` and renders it — the panel shows **hardcoded demo rows**, not real activity.
  *Fix:* read real `useData().activity` (already loaded) like the Library rail does.
- **1.7 🟠 Profile runs are invisible + errors vanish.** `automation.ts` emits rich
  `automation:event`s (scraping/downloading/composing/**error**), but the **renderer never
  subscribes** (`grep onAutomation` → only `mockApi.ts:486`). `useData.runProfile`/
  `Profiles.run` don't catch, so a failed run is a silent unhandled rejection with the card
  stuck on "Running…". *Fix:* subscribe to `onAutomation` in `useData.init`, show phase +
  errors on the Profiles card; wrap `runProfile` in try/catch.
- **1.8 🟠 B-roll failures are swallowed entirely.** `queue.ts:213` `} catch { /* render
  with image track */ }` — *any* B-roll error (rate-limit, network, bed ffmpeg failure)
  silently drops B-roll with **no log and no user message**. *Fix:* log it; surface "B-roll
  unavailable — rendering image mode" (ties to rate-limit handling).
- **1.9 🟡 Headless run aborts mid-loop on one bad item.** `automation.ts:49-62`: if
  `sendToRender` throws for one project (e.g. its download failed → no mp3), the loop
  throws and abandons the rest, leaving partial projects + an advanced cursor (`:65`) that
  can skip videos. *Fix:* per-item try/catch; advance cursor only over succeeded items.
- **1.10 🟡 Downloads can't be cancelled.** `downloader.ts` doesn't register the child in a
  kill map (unlike renders). A wrong/huge download can't be stopped. *Fix:* a child registry
  + cancel, like `render.ts`.

## 2. Robustness / error handling

- **2.1 🟠 ~30 empty `catch {}`** across services swallow errors silently
  (`queue.ts:213`, `broll.ts:159,212,268`, `ytdlp.ts:127`, `images.ts:16`, `db/index.ts:169`,
  …). Many are intentional fallbacks, but **none log**, so failures are invisible. *Fix:* at
  minimum `L.warn(...)` in each; keep the fallback.
- **2.2 🟠 Silent renderer failures.** `useData.fetchSource` (`useData.ts:183-193`) and
  `runProfile` (`:334-347`) don't surface errors; `Download.fetchVids`/`Profiles.run` don't
  catch → a failed fetch/run shows nothing. *Fix:* propagate + toast/inline error.
- **2.3 🟡 B-roll with no API keys no-ops.** `broll.ts:197-199` only adds providers that
  have keys; with none it returns `[]` and the render silently drops B-roll. *Fix:* detect
  "no keys" up front and tell the user (offer image mode).
- **2.4 🟡 No partial-transcript save.** `transcribe.ts:170` discards everything if any chunk
  fails after retries; a 60-min video that fails on chunk 6/6 loses 1–5. *Fix:* save partial
  + let the user resume/retry the tail.
- **2.5 💡 Webhook/notify swallow (`webhook.ts:24`, `notify.ts:22,56`)** — fine to be
  non-fatal but should `L.warn`.

## 3. Performance

- **3.1 🔴 30-input filtergraph + looped inputs** (`broll.ts`, `render.ts:159-211`) → 30
  simultaneous decoders on CPU = the 100% CPU + long renders. *Fix:* normalize one clip at a
  time, concat demuxer (one decoder at a time).
- **3.2 🔴 No GPU decode/scale.** No `-hwaccel cuda`/`scale_cuda` anywhere → NVENC only
  compresses; everything else is CPU. *Fix:* GPU decode/scale on normalize; `hwdownload`
  only for the subtitle burn.
- **3.3 🟠 Double-encode** (`queue.ts:194-211` bed pre-encode + final). *Fix:* single-pass.
- **3.4 🟠 Audio-master is a whole extra file pass** (`render.ts:336` → `audio-master.ts`
  re-muxes the entire MP4). For long videos this is a second full read/write. *Fix:* keep it
  (video is `-c:v copy`, cheap) but make it non-fatal (1.2); consider folding loudnorm into
  the encode when feasible.
- **3.5 💡 No caching of scrape/transcribe** beyond the resume-skip; re-opening a project
  re-reads fine, but re-transcribe always re-uploads. Acceptable.

## 4. UX gaps (see FINAL-PLAN §2 for the full list)

- No real **preview** before a multi-minute render (`Compose.tsx`). 🔴
- Can't **open the finished MP4** from the queue (`render` never calls
  `shell.showItemInFolder`; only downloads do — `download.ts:110`). 🟠
- **Caption aspect** (16:9/1:1/9:16) and **position** not settable in Compose. 🟠
- **Karaoke** highlights partial words (`captions.ts` `\kf` sweep). 🟡
- No **stop/cancel while rendering** (× deletes; and per 1.1 it mis-fires on NVENC). 🟠

## 5. Maintainability / code quality

- **5.1 🟠 572 inline `style={{}}`** across `src/screens/*` — no component/design system.
  Every screen is a giant inline-styled blob; colors/spacing/typography are copy-pasted
  hex/px. Hard to keep consistent, hard to restyle. *Fix:* extract a tokens file +
  primitives (`Button/Card/Select/Toggle/Chip/ProgressBar/Modal/Toast`) and migrate
  incrementally (blueprint WS-9).
- **5.2 🟠 Duplicated ffmpeg/ffprobe path resolution** in 5 files
  (`render.ts`, `downloader.ts`, `transcribe.ts`, `audio-master.ts`, `logger.ts`). *Fix:*
  one `bin.ts` util (`ffmpegPath()/ffprobePath()/ytdlpPath()`), imported everywhere.
- **5.3 🟠 Mock coupling still in production screens.** `Settings.tsx` (fake activity — see
  1.6), `Library.tsx` (`statusStyle`), `Compose.tsx` (`capPresets`) import `data/mock`.
  *Fix:* move shared constants out of `mock.ts`; remove mock data from real screens.
- **5.4 🟡 Magic numbers/strings scattered** — caption sizes/colors (`captions.ts`), stage
  weights (`queue.ts:35`), CRF ladders duplicated in `render.ts`+`broll.ts`, gradient alphas.
  *Fix:* centralize render constants.
- **5.5 🟡 45 `process.env[...]` test seams** scattered through services. *Fix:* one
  `testSeams.ts` reader so prod paths are obvious and seams are discoverable.
- **5.6 💡 `shared/types.ts` is large and mixes domain + IPC + settings.** Consider splitting
  (`domain.ts`, `ipc.ts`, `settings.ts`) for navigability.

## 6. Security (mostly good)

- ✅ All child processes use `spawn(bin, argsArray)` — **no shell string interpolation**, so
  filenames/titles can't inject commands. Filtergraph strings use numeric geometry; the ASS
  path is escaped (`render.ts:74 assForFilter`).
- ✅ CSP is tight; API keys are redacted in logs (`transcribe.ts:35`, `notify`/webhook).
- 🟡 **API keys stored plaintext** in electron-store (`settings.json`). Acceptable for v1;
  note **OS keychain** (`keytar`/`safeStorage`) as hardening.
- 🟡 **PAT/keys must never reach the repo** — fine today (kept in scratchpad), keep it that way.
- 💡 B-roll/Groq requests should log **redacted** URLs (strip `key=`/`Authorization`).

## 7. What's good (don't regress)

- Clean main/ipc/services/engine/db separation; typed `window.api` bridge.
- `caps.ts` does a *real* NVENC self-test (not just a string match) — good.
- `audio.ts` now trusts ffprobe over headers (the 47s fix) — correct.
- `transcribe.ts` is solid: chunking, retries, redaction, logging.
- `logger.ts` (electron-log) + startup diagnostics is genuinely useful for field bugs.
- Render children are tracked + killable (`render.ts running` map) — just needs the
  cancel-intent fix (1.1).

## 8. Prioritized fix list (maps into FINAL-PLAN phases)

**P0 (trust):** 1.1 cancel-on-CPU, 1.2 audio-master non-fatal, 1.5 ETA, 1.4 gradient,
1.6 fake Settings log, 1.7 profile events + 2.2 silent errors, D2 open-output.
**P1 (logging):** 2.1 log all catches, 1.8 B-roll logging, redacted net logs.
**P2 (B-roll engine):** 1.3/3.1/3.3 download-first+normalize+concat-demuxer, 3.2 GPU decode,
2.3 no-keys/rate-limit fallback, 1.9 per-item run safety, 1.10 cancelable downloads.
**P3 (compose UX):** preview, caption aspect+position, 1.x whole-word highlight, cancel-while-render.
**P4 (quality):** 5.1 design system, 5.2 bin util, 5.3 de-mock, 5.4/5.5 centralize, audio/grade polish.

> Net: the **architecture is sound**; the failures are concentrated in the **render
> lifecycle, B-roll assembly, and error-surfacing**. Fixing P0–P2 removes essentially every
> "it's broken / it lies / it's silent" complaint; P3–P4 make it feel premium.
