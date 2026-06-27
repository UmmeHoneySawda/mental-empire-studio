# Mental Empire Studio — The Whole Picture (Plain-English Master Plan)

> **Read this first.** This file explains, in plain language, what the app is, everything
> that's been built, every problem you ran into during testing, what got fixed, what's
> still broken, and the complete plan to make the videos look professional. No prior
> knowledge needed. A short glossary of technical words is at the bottom (Part 8).
>
> There is a second, more technical file — `docs/RENDER-QUALITY-BLUEPRINT.md` — that has
> the exact code-level instructions and ffmpeg commands. **This file is the human
> overview; that file is the engineering recipe.** You only need to read this one.

---

## Part 1 — What this app is (in one paragraph)

Mental Empire Studio is a desktop app for running **faceless YouTube channels** (channels
with no person on camera — just voice, images/footage, and captions). You paste a source
channel, it **downloads the audio**, you **add images or auto-fetch stock video (B‑roll)**,
it **auto-generates captions** from the speech, you pick a **style**, and it **renders a
finished MP4 video** you can upload. It also tracks your own channels (subscribers,
uploads, goals) and can run on a schedule in the background.

The app is built as a real installable desktop program (Windows/Mac). It is **not** a
website, even though it's made with web technology inside.

---

## Part 2 — What already works today

These parts are built and functioning:

- **Channels:** add a channel, see its stats, set weekly/monthly goals, get reminders.
- **Download:** paste a source channel, fetch its videos, download the audio as MP3.
- **Compose:** turn a download into a project — add images, choose "sequence" or
  "random pool", auto-transcribe the speech into word-by-word captions, pick a caption
  style and font, optionally turn on auto B‑roll (stock footage) and effects.
- **Thumbnails:** a real image editor for making clickable thumbnails.
- **Render Queue:** send projects to render, and it produces an MP4 file.
- **Profiles & automation:** save a whole setup as a "profile" and run it repeatedly, or
  let it watch a source channel and run automatically.
- **Settings:** output folder, quality, encoder, auto-scrape, background/tray, API keys.

So the **machinery** is all there. The problem isn't "does it work" — it's "does the
**final video look good**," plus a handful of specific bugs. That's what the rest of this
file is about.

---

## Part 3 — The journey so far (what you reported, what got fixed)

You tested the app several times and sent feedback each time. Here's the honest history:

### Round 1 — first big review
You reported a long list (~22 issues): things like reset not working, missing buttons,
confusing flows, etc. **All were fixed and pushed.**

### Round 2 — second review (14 issues)
More UX problems — render queue had no retry/delete buttons, no way to delete downloads,
no project switcher, encoder label wrong, no "reset data but keep API keys," etc.
**All 14 fixed and pushed.**

### Round 3 — third review (8 issues)
This is where deeper bugs showed up. Fixed and pushed:
1. **Encoder was stuck on CPU** — the encoder picker did nothing; now it's a real
   dropdown with a GPU option.
2. **"Reset data (keep API keys)" looked like it did nothing** — it actually wiped the
   data but the screen didn't refresh; now it refreshes.
3. **Channel logos didn't load** — a security setting was blocking YouTube's image
   server; fixed.
4. **Couldn't delete channels** — added a delete button.
5. **Removing a render didn't stop it** — the video-processing program kept running and
   maxing your CPU; now removing/cancelling actually stops it.
6. **Ctrl+R reloaded the whole app** like a webpage and lost your place; disabled.
7. **Source video views showed "—"** — started fetching real view counts.
8. **You were forced to add images + a thumbnail** even when you only wanted B‑roll;
   removed those forced requirements.

### Round 4 — fourth review (the render quality round — where we are now)
You rendered a real video and it came out **bad**. Your words: "captions are very bad,"
"one looks bigger," "2007–2008 editing app," "not professional," "the cinematic effects
I wanted aren't there," and the video used your **CPU instead of GPU** and was **slow**.
You also noticed it **didn't show you what stage it was in** ("stuck at 0%").

**Nothing in Round 4 is "fixed" yet** — you asked for a thorough plan first, not rushed
code. That plan is Part 5 below.

---

## Part 4 — What's still wrong, explained simply

Here is every open problem in plain words, why it happens, and what "good" looks like.

### 4.1 The video came out **47 seconds long** (your audio was 19 minutes) 🔴 critical
- **What's happening:** the app misreads how long the audio is, so it cuts the video
  short. (The tool it uses to measure MP3 length can guess wrong on certain files.)
- **Why it matters:** this alone makes every render broken, no matter how good the
  captions look. **This is the #1 thing to fix.**
- **Good looks like:** the video is exactly as long as the audio.

### 4.2 The captions look amateur ("2007 app," "one looks bigger")
- **What's happening:** right now captions are one plain line of text, and when a word is
  "emphasized" it gets bigger — so words look **inconsistent in size**. There's no modern
  "word pops as it's spoken, highlighted in yellow" effect that TikTok/Reels videos use.
- **Why it matters:** captions are 80% of how "professional" a faceless video feels.
- **Good looks like:** big bold ALL-CAPS captions (1–4 words at a time), the word being
  spoken **highlighted in yellow**, a small **pop** animation, thick black outline,
  sitting in the lower third. (This is the "Hormozi/CapCut" look — we researched the
  exact font, size, color, and animation values the popular tools use.)

### 4.3 "Cinematic" doesn't actually look cinematic
- **What's happening:** picking "Cinematic" only changes the transition between clips. It
  doesn't add real **color grading** (the film-like color look), **grain**, **vignette**
  (darkened edges), or a slow **zoom** — the things that make footage feel like a movie.
- **Good looks like:** each style ("Cinematic," "Intense," "Clean," "Heartfelt") is a real
  recipe: color look + motion + grain + the right caption energy.

### 4.4 It used your **CPU**, not your **GPU** — so it was slow and maxed your computer
- **What's happening (the part you asked about):** even when GPU is selected, the
  **B‑roll step is hard-coded to use the CPU**, and the way B‑roll is built is wasteful —
  it builds the entire background footage **twice** and stitches dozens of clips with a
  slow technique. So your GPU sat at 0% and your CPU sat at 100% for a long time.
- **Good looks like:** the GPU does the heavy lifting when available, B‑roll is built
  **once**, and renders are much faster.

### 4.5 It didn't tell you what was happening ("stuck at 0%")
- **What's happening:** during the long steps (fetching B‑roll, building footage), the app
  shows nothing — just a frozen 0%.
- **Good looks like:** a clear status — "Fetching B‑roll 7/18 → Building footage →
  Encoding (GPU) → ~12 minutes left" — and whether it's on CPU or GPU.

### 4.6 Smaller issues you flagged
- **Fetching got slow (~60 seconds)** — this was a side effect of the Round‑3 change to
  fetch real view counts. We'll make it fast again and just hide view numbers when they
  aren't quickly available (your chosen trade-off: speed over showing views).
- **Channel shows "0 views" / blank age column** — same cause (the fast way of reading a
  channel doesn't include per-video views/dates). We'll **hide** those cleanly instead of
  showing "0" or "unavailable."
- **Download status text wraps/clips** — we'll shorten it with "…".

---

## Part 5 — The plan to fix everything (in phases)

We'll do this in **four phases**, easiest-and-most-important first. Each phase produces a
visibly better app. (The exact code steps live in `docs/RENDER-QUALITY-BLUEPRINT.md`;
here's the human version.)

### Phase 0 — Make it trustworthy (do first)
- **Fix the 47-second bug** (4.1) so videos are full length.
- **Make fetching fast again** and hide empty views/age cleanly (4.6).
- **Add the "what stage am I in" status** with time-left and CPU/GPU (4.5).
- ✅ *After Phase 0:* renders are the correct length, the app feels responsive, and it
  never leaves you staring at a frozen screen.

### Phase 1 — Make it fast and use the GPU
- **Use the GPU** for encoding when your computer has one (4.4).
- **Rebuild the B‑roll step** so it's built once, not twice, and without the slow
  stitching (4.4).
- ✅ *After Phase 1:* renders are much faster and your GPU is actually used.

### Phase 2 — Make it look professional (the big one)
- **New captions** matching the TikTok/CapCut/Hormozi look (4.2) — exact font, size,
  yellow highlight, pop animation, position. (We have the precise values from researching
  how the popular tools do it.)
- **Real cinematic styles** — color grading, grain, vignette, slow zoom, smooth
  transitions (4.3).
- **Balanced audio** — consistent, professional loudness levels.
- ✅ *After Phase 2:* a sample render looks like it came out of CapCut/Submagic.

### Phase 3 — Polish and scale
- A cleaner **Compose screen** with a **live caption preview** (you see the real caption
  style before rendering) and a **style gallery** with little preview thumbnails.
- A nicer **Render Queue** with the stage-by-stage progress bar.
- Automated **visual tests** so the quality never silently breaks again.
- ✅ *After Phase 3:* the whole experience feels like premium software.

---

## Part 6 — One decision I need from you

For the new captions (Phase 2), there are two ways to build them:

- **Option A (recommended):** upgrade our current caption system. **Fast, works offline,
  no extra downloads.** Gets you ~90% of the professional look quickly.
- **Option B (premium):** use a Hollywood-grade caption engine (the same kind big tools
  use). **Best possible look** (true physics-based animations, glow, emoji), but it adds a
  heavier component and makes the app bigger.

My recommendation: **start with Option A**, and we can add Option B later as a "premium"
mode if you want even more polish. You can just tell me "A" or "B."

---

## Part 7 — What's done vs. what's next (quick scoreboard)

| Area | Status |
|---|---|
| Core app (channels, download, compose, thumbnails, render, automation) | ✅ Built |
| Round 1 (22 issues) | ✅ Fixed & pushed |
| Round 2 (14 issues) | ✅ Fixed & pushed |
| Round 3 (8 issues: encoder, resets, GPU option, delete, stop-render, etc.) | ✅ Fixed & pushed |
| 47-second render bug | ⏳ Planned (Phase 0) |
| "What stage am I in" feedback | ⏳ Planned (Phase 0) |
| Fast fetch + hide empty views | ⏳ Planned (Phase 0) |
| GPU actually used + faster B-roll | ⏳ Planned (Phase 1) |
| Professional captions | ⏳ Planned (Phase 2) |
| Real cinematic styles + audio | ⏳ Planned (Phase 2) |
| Live preview + design polish | ⏳ Planned (Phase 3) |

**Nothing in Phases 0–3 is coded yet** — I'm waiting for your go-ahead (and your A/B
choice for captions). When you say go, I'll start with Phase 0.

---

## Part 8 — Glossary (plain definitions)

- **Render:** the process of turning your audio + images/footage + captions into one
  finished MP4 video file.
- **ffmpeg:** the free engine the app uses under the hood to actually build the video.
- **Encoder / codec:** the part that compresses the video. **CPU encoding (libx264)** works
  everywhere but is slower; **GPU encoding (NVENC)** uses your NVIDIA graphics card and is
  much faster.
- **CPU vs GPU:** CPU is your computer's general brain; GPU is the graphics card. Video
  work is much faster on a GPU when the app is set up to use it.
- **B‑roll:** background stock video footage automatically fetched to play behind the
  audio (instead of, or in addition to, still images).
- **Captions / subtitles:** the on-screen words. The app makes them word-by-word from the
  speech. "ASS" is just the subtitle file format used to style them.
- **Color grading / LUT:** adjusting the colors to create a mood/film look. A "LUT" is a
  preset color recipe.
- **Grain / vignette:** film grain is a subtle texture; vignette is darkened corners —
  both add a cinematic feel.
- **Transition:** the visual effect between two clips (e.g. a dissolve).
- **Loudness (LUFS):** a measure of how loud audio feels. YouTube targets about **-14
  LUFS**; matching it makes your audio sound consistent and professional.
- **Scrape / fetch:** reading public info (channel stats, video list) without an API.
- **Pipeline / stages:** the render done as a sequence of clear steps (prepare →
  transcribe → fetch B‑roll → build → grade → captions → encode → finish) so progress can
  be shown for each.

---

*Companion technical file with exact code steps and ffmpeg commands:
`docs/RENDER-QUALITY-BLUEPRINT.md`.*
