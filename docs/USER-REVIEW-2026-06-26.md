# User Review — 2026-06-26

Source: screen-recording + transcript (`app_review2.mp4` / `app_review.txt`).
Reviewer walked through the full producer flow: My Channels → Download → Compose → Thumbnails → Render Queue.

---

## Issue List

### #1 — My Channels: Wrong avatar / logo shown
**Timestamp:** 0:00
**Quote:** "the logo is not my channel"
**What happened:** The avatar displayed on a channel card doesn't match the real channel's logo.
**Root cause:** `MyChannel.avatar` is a colour swatch (mono initials) generated at add-time; we never
fetch or display the actual YouTube channel thumbnail/avatar from the scraped JSON.
**Fix:** When `scrapeChannel` runs, persist the `thumbnail` field from yt-dlp JSON to `my_channels.avatar`;
render it as an `<img>` in the channel card (fallback to mono-initials when null/offline).

---

### #2 — My Channels: "Add channel" button unreliable / sometimes does nothing
**Timestamp:** 0:00–0:32
**Quote:** "when i click on this it doesn't sometimes work especially when i like add a new channel"
**What happened:** Pressing the connect/add button had no visible effect (no spinner, no error, no new card).
**Root cause:** `addChannel` in `useData` swallows the error silently if scraping fails; the button has no
loading/error state, so the user sees nothing.
**Fix:** Show a spinner on the button while `addChannel` is in flight; surface the error message
(e.g. "Could not reach YouTube — check your connection") inline below the input.

---

### #3 — Download: Source video cards show no view counts (empty)
**Timestamp:** 0:01:27
**Quote:** "you can see these cards that um there is no views like it's empty here"
**What happened:** The video list fetched from the source channel shows blank/missing view counts.
**Root cause:** The yt-dlp `--flat-playlist` JSON doesn't always include `view_count` for every entry;
the scraper stores `null`; the card renders nothing instead of "—".
**Fix:** Fallback render: show "—" when `views` is null/0. Also consider using
`--output-na-placeholder ""` in yt-dlp args and gracefully handle the missing field.

---

### #4 — Download: "Resume" button shown while download is actively in progress / after it finishes
**Timestamp:** 0:01:51–0:02:44
**Quote:** "i don't know why there is a resume button while it's downloading … progress bar is fully
finished what the hell is this … if i click on resume again you can see that it's now says open"
**What happened:** The download row showed Stage = "Downloading" + progress 100% + a "Resume" button
simultaneously. After clicking Resume a second time it changed to "Open".
**Root cause:** The stage state machine in `Download.tsx` renders the "Resume" button for any row
where `stage !== 'Done'`, but `stage` wasn't being updated atomically when the download finished —
it flipped `pct` to 100 before `stage` to `'Done'`. Also: even a row in `Downloading` state should
show a "Cancel" or progress indicator, never "Resume".
**Fix:**
- Only show "Resume" when `stage === 'Failed'` or `stage === 'Paused'`
- Show a progress bar + "Downloading…" label when `stage === 'Downloading'` 
- Show "Open" only when `stage === 'Done'`
- Make the download IPC set `stage = 'Done'` atomically with `pct = 100`

---

### #5 — Download: Auto-navigates to Compose even when download failed / not complete
**Timestamp:** 0:02:18–0:02:44
**Quote:** "it took me to the compose tab automatically i don't know like one of them downloaded one of
them didn't download"
**What happened:** Clicking "Add to queue" navigated immediately to Compose before both downloads
finished; one video hadn't completed yet.
**Root cause:** The codex fix (`await startDownload → find usable row → openProject`) only checks the
first usable row. If two are selected and one fails, it still navigates on the first success.
**Fix:** Only navigate to Compose after ALL selected downloads complete (or explicitly let the user
pick which one to open). Show a summary: "2 downloaded, 0 failed — Open in Compose?" rather than
auto-navigating.

---

### #6 — Compose / Captions: Word-click emphasis UX is confusing
**Timestamp:** 0:03:08–0:03:20
**Quote:** "i don't know what do you mean by like clicking on each word like this long transcript
what do you mean i will manually click on words"
**What happened:** The transcript panel shows every word as a clickable token to mark as emphasis,
but this was not explained anywhere and feels like tedious manual work.
**Fix:** Add a small instruction label above the transcript: "Click a word to mark it for emphasis
(auto-highlight during karaoke)." Add an "Auto-detect emphasis" button that uses the existing keyword
list to pre-mark key words. The ★ click should feel like a one-tap toggle, not a chore.

---

### #7 — Compose / Captions: Word timeline only shows first line of transcript
**Timestamp:** 0:03:20–0:03:49
**Quote:** "in the words timeline i don't know what they are but they are like the only the first line
of this transcript … why it's there"
**What happened:** The horizontal word-timeline strip at the bottom of the Captions tab renders only
the first ~10 words and then stops — the rest of the transcript isn't shown.
**Root cause:** The word timeline renders a fixed-width slice of `transcript` without scrolling, so
most words fall off the right edge invisibly.
**Fix:** Make the word timeline horizontally scrollable (`overflow-x: auto`) and ensure all words
render as proportional time-positioned chips.

---

### #8 — Compose / Captions: Large empty space, disorganised layout
**Timestamp:** 0:03:49
**Quote:** "there is massive empty space here when this vertical thing i have to scroll and i don't
know it looks very unorganised"
**What happened:** The Captions tab has a big blank region and the controls are laid out vertically
requiring scroll to reach everything.
**Fix:** Compact the layout — two-column grid for preset + style options; put the transcript and
caption preview side-by-side on wide screens; eliminate dead vertical space.

---

### #9 — Compose / Captions: Font picker does nothing
**Timestamp:** 0:03:49–0:04:18
**Quote:** "when I click on fonts it's not working"
**What happened:** Clicking the font selector in the Captions tab had no effect — no dropdown, no change.
**Root cause:** The font picker UI element exists but either the `onChange` isn't wired to `setCaptions`
or the `captionFont` field isn't being applied to the rendered ASS subtitle.
**Fix:** Wire the font dropdown to `setCaptions({ captionFont })` and confirm the value flows through
to `captions.ts` buildAss styles.

---

### #10 — Compose / Captions: B-roll options (Full/Sparse/Keywords) have no explanation
**Timestamp:** 0:04:18
**Quote:** "I don't know what full is, parses or keywords are … you haven't explained … no tooltip"
**Fix:** Add inline tooltips (`title` attribute or a small `?` icon popover) for each density option:
- **Full** — b-roll covers the entire video
- **Sparse** — b-roll clips placed every ~30 s
- **Keywords** — b-roll cut in on auto-detected topic words

---

### #11 — Compose: B-roll enabled but "Save & send to render" says "Missing images"
**Timestamp:** 0:04:46
**Quote:** "why would i use images i am using b-rolls okay fine let's add some images"
**What happened:** User enabled b-roll but the render preflight still required images to be set.
**Root cause:** The `compose:sendToRender` / `queue.ts` preflight checks `images.length === 0` as a
blocker unconditionally, even when `project.broll.enabled = true`.
**Fix:** When `project.broll.enabled`, images are optional — bypass the `missing images` block in
both `sendToRender` and `queue.ts` preflight. The render service already handles the no-images +
b-roll case via the lavfi/b-roll bed path.

---

### #12 — Compose / Media: "IMG1 IMG2 IMG3" labels in audio timeline unexplained
**Timestamp:** 0:05:15
**Quote:** "what is this below line mean it says IMG1 IMG2 IMG3 like why are they there and what what
do they even mean"
**What happened:** The audio/image timeline shows "IMG1", "IMG2" etc. as range labels but no context.
**Fix:** Replace "IMG1/2/3" with actual image thumbnails (small preview) or at minimum "0:00–0:45",
"0:45–1:30" duration range labels so the user understands each represents a time slot.

---

### #13 — Compose / Media: "Crossfade" field is blank/empty
**Timestamp:** 0:05:15
**Quote:** "why is that crossfade is blanked"
**What happened:** The crossfade control (transition duration between images) appears with no value.
**Root cause:** `project.crossfade` defaults to `undefined` / `null`; the input renders as empty.
**Fix:** Set a sensible default (e.g. `0.8` seconds) in `defaultProject()` and display it in the input.

---

### #14 — Compose / Media: "Random Pool" and "Sequence" modes unexplained
**Timestamp:** 0:05:15
**Quote:** "when i select random pool what does that even mean and what is sequence like i don't know"
**Fix:** Add brief labels/tooltips:
- **Sequence** — images play in the order you set them
- **Random pool** — images are shuffled randomly each render (with optional seed lock for consistency)

---

### #15 — Thumbnails: Double-clicking canvas element doesn't work
**Timestamp:** 0:05:45
**Quote:** "double clicking it doesn't work"
**What happened:** User tried to double-click a layer on the Konva canvas (likely to edit text inline)
and nothing happened.
**Root cause:** There is no `dblclick` handler wired on the Konva stage/text nodes.
**Fix:** Add a double-click handler on Text nodes that focuses the text input in the inspector so the
user can immediately edit the content.

---

### #16 — Thumbnails: Second text line ("below text") visually broken
**Timestamp:** 0:06:15
**Quote:** "the below text is like not uh like not you can see i can see it but okay whatever"
**What happened:** When a text layer has two lines, the second line renders oddly (partially off-canvas
or overlapping).
**Root cause:** Per-line `y` positioning in the Konva Text nodes isn't accounting for the first line's
height correctly when `lines[1]` has a different `size` than `lines[0]`.
**Fix:** Calculate cumulative `y` offset per line based on actual `fontSize` + `lineHeight`.

---

### #17 — Thumbnails: No "Reset to defaults" button for text effects
**Timestamp:** 0:06:41
**Quote:** "it would be good if there was a like here or like a reset to default button … if i do it
and now i want to reset to the default one how should i do that right"
**Fix:** Add a small "Reset" link/button in the text inspector that sets effects back to the layer's
initial defaults (`shadow: false, stroke: false, glow: false, caps: false`).

---

### #18 — Thumbnails: Inspector panel too long, requires scrolling
**Timestamp:** 0:07:07
**Quote:** "you see this long vertical menu i have to scroll like can i just not like rearrange this menu"
**Fix:** Group the inspector into collapsible sections (Text Content, Per-line Sizes, Highlight,
Effects) so each section is compact by default and expands on click.

---

### #19 — Thumbnails: No visible "Save" confirmation / unclear how to save
**Timestamp:** 0:07:37–0:08:08
**Quote:** "i don't know what to do where is the save pattern … How should I know it's saved?"
**What happened:** User made a thumbnail but couldn't find a "Save" button and didn't know whether
their work was persisted.
**Root cause:** Auto-save is silent — the thumbnail only actually writes a PNG when the user clicks
"Save as template" or via batch generate. There is no "Save thumbnail for this project" button that
also writes the PNG to the output folder so it appears as checked in Render Queue.
**Fix:**
- Add a prominent **"Save thumbnail"** button (or make "Save as template" also write the PNG)
- Show a brief "Saved ✓" confirmation after saving
- The saved PNG path must be stored on the project so Render Queue sees it as ready

---

### #20 — Thumbnails: "Generate all" / batch generate is confusing
**Timestamp:** 0:08:08
**Quote:** "I clicked on general. It generated. I don't know what they even do … there is one word …
what does this math generator even mean"
**What happened:** User clicked "Generate all" and got a result they couldn't interpret. The output
was a single word or placeholder rather than an actual thumbnail.
**Root cause:** "Generate all" is for batch-title mode (paste N titles → generate N PNGs). This is
the wrong tool for the user's current intent (they just wanted to save the single current thumbnail).
**Fix:** Rename "Generate all" to "Batch generate from titles" to make it clear this is a bulk
operation. Separate it visually from the per-project "Save thumbnail" action.

---

### #21 — Render Queue: "Missing thumbnail" after creating one in Thumbnails
**Timestamp:** 0:08:08–0:08:36
**Quote:** "Now let's go to the compost tab once again. Now let's click on save and send to render.
Missing thumbnail. What do you mean missing thumbnail?"
**What happened:** User made a thumbnail in the Thumbnails screen, then went back to Compose →
"Save & send to render" still reported "missing thumbnail".
**Root cause:** The thumbnail PNG written by `thumbnails:writePng` is stored at
`<outputDir>/thumbnails/<title>.png`. The render preflight checks for that path, but the path
construction uses `safeName(project.title)` — if the title contains characters that get sanitised
differently in the write vs. the check, the file isn't found.  
Also: the user likely used "Save as template" (which saves the layer JSON) rather than writing the
PNG, so no PNG file ever existed.
**Fix:**
- Consolidate to a single "Save thumbnail" action that always writes the PNG
- Store the written PNG path on the project row (`projects.thumbPath`) and use THAT in the preflight
  check rather than reconstructing the path by title-sanitisation (avoids any name-mismatch bug)

---

### #22 — Render Queue: "Render all" button does nothing
**Timestamp:** 0:09:09
**Quote:** "there is render all button at the top let's uh do it oh look it doesn't even work"
**What happened:** Clicking "Render all" had no visible effect.
**Root cause:** `canRender` in `RenderQueue.tsx` is `rows.length > 0 && rows.every(r => r.isReady)`.
Since rows had "missing thumbnail" / "missing images", `isReady` was false → button was disabled
(visually looks the same as enabled, so user couldn't tell).
**Fix:**
- Make the "Render all" button visually distinct when disabled (greyed out, cursor: not-allowed,
  tooltip "X items not ready yet")
- When not all items are ready, show a "Render ready items (N)" option that runs only the ready ones

---

## Summary by screen

| Screen | Issues | Severity |
|---|---|---|
| My Channels | #1 (wrong avatar), #2 (add button unreliable) | Medium |
| Download | #3 (no views), #4 (resume/state machine), #5 (premature auto-nav) | High |
| Compose / Media | #11 (b-roll bypass), #12 (IMG1/2/3), #13 (crossfade empty), #14 (mode labels) | High |
| Compose / Captions | #6 (emphasis UX), #7 (word timeline), #8 (layout), #9 (font picker), #10 (tooltips) | High |
| Thumbnails | #15 (dblclick), #16 (line 2 layout), #17 (reset), #18 (scroll), #19 (save UX), #20 (generate confusion) | High |
| Render Queue | #21 (missing thumb), #22 (render button disabled-but-looks-enabled) | Critical |

---

## Priority order for fixing

**Critical (blocks the user from completing any render):**
- #19/#21: "Save thumbnail" writes PNG + stores path on project
- #11: B-roll bypass for image requirement
- #22: Render all visually disabled + "render ready items" fallback

**High (broken core flow):**
- #4: Download stage state machine (Resume/Done confusion)
- #9: Font picker wiring
- #5: Auto-nav only after all downloads done

**Medium (confusing UX):**
- #7: Word timeline scrollable
- #10/#14: Tooltips for b-roll density + image modes
- #13: Crossfade default value
- #12: IMG1/2/3 → range labels
- #6: Emphasis auto-detect + instruction label
- #2: Add-channel loading/error state

**Low (polish):**
- #1: Real channel avatar
- #3: Views fallback "—"
- #8: Captions tab layout compaction
- #15: Double-click to edit text
- #16: Second-line y-offset fix
- #17: Reset effects button
- #18: Collapsible inspector sections
- #20: Rename "Generate all" → "Batch generate from titles"
