# Mental Empire Studio — Manual Test Guide (v0.1.3)

A tester (human or computer-use AI) should go through each item **on the real Windows app**,
click exactly what's described, and mark **PASS / FAIL** with a short note. Don't worry about *why*
it fails — just record **what** happened (and the exact text of any error/toast).

## How to record results
For every checkbox write one of:
- `PASS` — did what "Expected" says.
- `FAIL — <what actually happened>` (e.g. "FAIL — nothing happened", "FAIL — app froze", "FAIL — toast said 'ffmpeg not found'").
- `SKIP — <reason>` (e.g. needs a key you don't have).

## 0. Setup / prerequisites (do first)
- [ ] App launches and shows the **Library** screen. Expected: window opens, sidebar visible, version shows `studio v0.1.3`.
- [ ] Open **Settings**. Expected: Settings screen loads with cards: Appearance, Output, Render, Auto-scrape, Transcription, Background, **Beta features**, Danger zone.
- [ ] In **Settings → Transcription**, paste a free **Groq** API key (console.groq.com). Expected: field accepts it.
- [ ] In **Settings → Beta features**, toggle **Enable beta features ON**. Expected: three key fields appear (Pexels / Pixabay / Coverr). Paste keys if you have them (optional; needed only for B-roll).

---

## 1. Settings
- [ ] **Accent** — click Amber / Violet / Emerald / Crimson. Expected: whole app recolors instantly.
- [ ] **Ambient glow** toggle. Expected: background glow turns on/off.
- [ ] **Show activity rail** toggle. Expected: Library right-side activity rail shows/hides.
- [ ] **Quality** — pick 720p / 1080p / 1440p. Expected: selection highlights and sticks.
- [ ] **Parallel renders** — type a number (e.g. 3). Expected: value saves.
- [ ] **Auto-scrape** — change Frequency, Request delay, Retries, Proxy, Cookies file. Expected: each field edits + keeps its value.
- [ ] **Persistence** — change accent + quality, fully close the app, reopen. Expected: your changes are still there.
- [ ] **Beta toggle persistence** — turn Beta on, restart app. Expected: still on; keys still present.
- [ ] **Danger zone → Reset everything** → confirm. Expected: a confirm dialog appears; after confirming, the app reloads and ALL channels/profiles/projects/queue are gone and settings are back to defaults (no demo data reappears).

## 2. My Channels
- [ ] **Add a channel** — paste one of YOUR channel URLs, confirm. Expected: card appears with views / subscribers / uploads pulled (no API key).
- [ ] **Link a source** to a channel. Expected: the ↔ chip shows `done/total` of how many downloaded source videos you've published.
- [ ] **Set a weekly/monthly goal + reminder date**. Expected: progress bars + reminder save and persist after restart.
- [ ] **Re-scrape** a channel. Expected: stats refresh; an activity-log entry appears.
- [ ] **Behind-pace reminder** — set a goal you're behind on. Expected: a Windows desktop notification fires (if notifications are on).

## 3. Download  ← (known problem area)
- [ ] **Fetch** — paste a source channel (e.g. `youtube.com/@PowerWithinOfficial`), click Fetch. Expected: "N videos found", grid of video cards with **title, duration, thumbnail, and view count**.
  - KNOWN ISSUE to confirm: cards may show **no thumbnail** and **"0 views"** — record if true.
- [ ] **Order tabs** — Popular / Latest / Oldest. Expected: list reorders.
- [ ] **QTY + bitrate** dropdowns. Expected: change the fetch amount / mp3 quality.
- [ ] **Select videos** — click 2 cards. Expected: "2 videos selected · ~size".
- [ ] **Download mp3 only** — click it. Expected: each selected video starts downloading; a row appears under "Already downloaded" with a **progress bar** that advances, then stage becomes "Downloaded only".
  - KNOWN ISSUE to confirm: clicking may give **no response**, or a row shows stage **"Failed"**. Record exactly what happens (any error text? does the .mp3 appear in the output folder?).
- [ ] **Add to queue** — click it. Expected: downloads + pushes the videos toward Compose/Render.
- [ ] **Resume** — on a "Failed"/unfinished row click Resume. Expected: it retries / continues, doesn't re-download a finished file.
- [ ] **Open folder** on a finished download. Expected: Windows Explorer opens the output folder.
- [ ] Confirm where files land: open **Settings → Output** folder location and check the .mp3 is actually there.

## 4. Compose — Media tab
- [ ] Open **Compose**, pick a downloaded item. Expected: project loads.
- [ ] **Sequence vs Random pool** toggle. Expected: switches mode.
- [ ] **Add image(s)** — drop/select 1 image. Expected: single image = full length.
- [ ] Add 3 images. Expected: timeline auto-splits into even ranges; you can override a range.
- [ ] **Ken Burns / Re-roll / seed** (random pool). Expected: preview reshuffles; seed locks the order.

## 5. Compose — Captions tab
- [ ] **Preset grid** — pick Pop / Bold / Hormozi / Word / Neon / Minimal. Expected: selection highlights, preview updates.
- [ ] **Font / Animation** controls. Expected: change values.
- [ ] **Keywords (Auto-highlight)** + **Punch (Zoom on hit)** toggles. Expected: ON/OFF flips.
- [ ] **Transcribe** — click to transcribe (needs Groq key + internet). Expected: word-level transcript appears; you can click a word to ★ emphasize it.
- [ ] **Re-transcribe**. Expected: regenerates.
- [ ] **Save & send to render**. Expected: project moves to Render Queue.

## 6. Compose — Customize (BETA) panel  ← only active when Beta is ON
- [ ] Panel is **greyed out** when Beta is OFF, **interactive** when ON. Expected: matches the toggle.
- [ ] **Hook** toggle + text field. Expected: toggles; text box appears.
- [ ] **Auto-highlight keywords** toggle. Expected: flips.
- [ ] **Background overlay** — Bottom / Top / Left / Right chips. Expected: each toggles independently.
- [ ] **Automatically zoom in** — At start / At key phrases. Expected: each toggles.
- [ ] **Auto B-roll** toggle + density (full / sparse / keywords). Expected: toggles; density picks.
- [ ] **Style** — None / Cinematic / Intense / Heartfelt / Clean. Expected: selection highlights.
- [ ] **Copy master prompt**. Expected: a status line says it copied; paste into Notepad to confirm it's a full prompt with the transcript.
- [ ] **Auto-generate (Groq)** (needs Groq key). Expected: status shows "Generating…", then JSON fills the textarea, and a summary line "(N transitions · M text effects)" appears.
- [ ] **Paste a JSON** by hand. Expected: the summary line validates/updates.

## 7. Thumbnails  ← (known problem area)
- [ ] Editor loads with the demo "EVERYTHING WAS FAKE". Expected: canvas + layers list + inspector.
- [ ] **Right inspector panel** — scroll/inspect the LAYERS + per-line-size sliders + color swatches. Expected: ALL controls fully visible.
  - KNOWN ISSUE to confirm: the inspector may be **clipped off the right edge** of the window (controls cut). Record if true + your screen resolution.
- [ ] **Add text / Add shape / Add badge**. Expected: a new layer appears on the canvas inside the frame (not off-screen).
- [ ] **Select a layer** → drag it on the canvas. Expected: it moves; subject/shape shows resize handles.
- [ ] **Editing while typing** — change the headline text. Expected: canvas updates and does **NOT flash black** on each keystroke.
- [ ] **Per-line size** sliders. Expected: each line resizes.
- [ ] **Highlighted word** + **Square background** + color. Expected: that word gets the box/color.
- [ ] **Subject (PNG)** — Replace subject → pick a PNG. Expected: image appears; Border/Glow/Shadow controls (size/opacity/distance) change it; outline follows the PNG shape, not a square.
- [ ] **Background** — solid swatch / Use image background. Expected: background changes.
- [ ] **Auto-arrange type**. Expected: headline re-lays-out opposite the subject, inside the dashed title-safe box.
- [ ] **Save as profile template** / **Save current** → creates "Template N". Expected: a template thumbnail appears under PROFILE TEMPLATES.
- [ ] **Apply a saved template** — click it. Expected: canvas loads that template.
- [ ] **Delete a saved template**. Expected: there is a way to remove a template.
  - KNOWN ISSUE to confirm: there may be **no delete option** for templates. Record if true.
- [ ] **Batch generate** — paste a few titles → Generate all. Expected: a PNG per title is written to the output folder; grid preview shows them.

## 8. Render Queue
- [ ] Queue lists projects sent from Compose. Expected: one row per project.
- [ ] Each row checklist: **MP3 / Images / Thumb / Captions** ticks. Expected: ticks reflect what's set.
- [ ] **Output folder** Browse + **Format** + header "x of n processing · k parallel". Expected: editable / live.
- [ ] **Render all** (needs ffmpeg — bundled). Expected: progress bars advance; on finish each row says done and an `.mp4` is in the output folder.
- [ ] **Open the finished .mp4** in a player. Expected: image(s) over the audio, burned captions, correct length (matches the audio).
- [ ] If Beta was on for a project: confirm hook card / overlay gradient / zoom / transitions + subtle SFX are present in the .mp4.

## 9. Profiles
- [ ] Profiles list loads. Expected: cards with rule / images / caption / output.
- [ ] **New profile** + **Edit** (source url/order/count, image mode, caption preset/aspect, thumbnail template, output folder, auto-watch, beta defaults). Expected: fields edit + save.
- [ ] **Run** a profile. Expected: it fetches + downloads per the rule, builds projects, and (interactive) opens the first in Compose for quick-edit; queue accumulates.
- [ ] **Auto-watch** toggle → WATCHING badge. Expected: badge reflects state.
- [ ] **Delete a profile**. Expected: it's removed.

## 10. Library
- [ ] Greeting + 4 KPI cards (Total views / Subscribers / Uploaded / In queue). Expected: numbers shown.
- [ ] Channel grid + sparklines. Expected: renders.
- [ ] "Recent uploads" table with status badges. Expected: rows shown.
- [ ] Activity rail + "Next auto-run / Run now". Expected: Run now triggers a scrape tick.

## 11. Background / system (OS-level)
- [ ] **Close to tray** (Settings → Background → tray ON) — click the window close button. Expected: app hides to the system tray, doesn't quit.
- [ ] **Tray menu** — right-click the tray icon. Expected: Open Studio / Auto-scrape pause / Render queue / Quit.
- [ ] **Start on Windows sign-in** toggle. Expected: registers in Windows startup (Task Manager → Startup, or it opens after reboot).
- [ ] **Desktop notifications** — trigger one (behind-pace goal or a finished render). Expected: a Windows notification appears.
- [ ] **Webhook** — put a test URL (e.g. webhook.site) and trigger an event. Expected: a POST arrives.
- [ ] **Auto-watch** — enable on a profile; when the source posts (or on a manual tick) it runs hands-free to the queue.

---

## Priority bugs already reported (please confirm + add exact details)
1. **Download** — selecting videos + clicking Download mp3 only / Add to queue → **no response**, some rows show **"Failed"**. (Need: exact error text, and whether any .mp3 lands in the output folder.)
2. **Source video cards** — **no thumbnail** and **"0 views"** on every card.
3. **Thumbnail inspector panel** — **clipped at the right edge** (controls cut off). (Need: screen resolution + window size.)
4. **Templates** — **no way to delete** a saved template.

## Requested feature (not a bug)
On the Download source list, show whether each video is **already on my channel**, by fuzzy-matching
the title (tolerant of a changed word or two) against my own channel's scraped uploads.
