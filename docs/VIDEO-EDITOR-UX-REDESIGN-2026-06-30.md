# Video Editor UX Redesign — Turning the "Compose" Form into a Real Editor

Status: PROPOSAL (for review)
Date: 2026-06-30
Author: product/UX
Scope: **only the video editor** (the `Compose` screen + how it drives the render engine).
**Out of scope (separate, next plan):** the thumbnail editor (multi-layer selection, text
line-breaks, line-size/line-gap/word-highlight controls, highlight-box colour). Those are a
distinct surface (`src/features/thumbnail-editor`, `ThumbnailTemplate`/`TextLayer` model) and
get their own document.

> Premise from the user, which this plan takes literally: **the functionality already
> exists — UX is what's missing.** This is verified in code. The render engine
> (`src/render-worker/compositor.ts`, a WebGL2 fragment-shader compositor) already applies,
> per frame: base image + crossfade, Ken Burns / punch-zoom, a full colour grade
> (saturation, contrast, brightness, colour-balance, vignette, sharpen), film grain, a
> darkening overlay, and a word-by-word caption layer. Almost none of that is controllable —
> or even *visible* — in the UI. **So this is overwhelmingly a surfacing-and-interaction
> problem, not an engine problem.** Section 9 maps every proposed control to the engine field
> that already exists.

---

## 0. TL;DR — the one big idea and five moves

The current editor is a **four-tab settings form** (`Audio + Image · Captions · Style ·
Advanced`) with **no live preview of the actual video**. You change a "Style" and you cannot
see what it did; you can't tell what a caption preset looks like; and the colour "filter" the
app bakes onto every frame has **no on/off switch and no controls at all**. That is the whole
reason it feels "hardcoded" and un-premium.

The fix is to stop shipping a *form* and ship an **editor**: a live preview at the centre, a
timeline along the bottom, and a contextual inspector on the right — the layout every
world-class tool converges on. Five moves:

1. **Add a live, always-on preview** that renders the *real* composited frame at the playhead
   — reusing the compositor that already exists. (Per the user's hint, this is a **still
   frame**, not video playback — which is both easier and enough.)
2. **Replace the 4 tabs with one editor surface**: Preview (centre) · Timeline (bottom) ·
   Inspector (right) · Transcript + Media (left).
3. **Expose "the filter" (the colour grade) as a real Look panel** with an off switch, an
   intensity slider, and per-parameter controls + reset — global *and* per-segment.
4. **Make presets transparent, previewable starting points, not black boxes** — caption
   styles render a live sample; video styles show exactly what they change and remain fully
   editable afterward.
5. **Make editing granular**: per-image duration / motion, per-caption styling, B-roll
   placement — by selecting things on the timeline and editing them in the inspector.

Everything below is grounded in (a) the current code and (b) how DaVinci Resolve, CapCut,
Descript, Submagic/Opus, and the open-source editor Kdenlive actually operate.

---

## 1. Diagnosis — why the editor feels hardcoded (verified against the code)

### 1.1 There is no real preview of the video being made
The only "previews" today are fakes or detached renders:
- The `MediaTab` "hero" preview is a **hardcoded CSS mock** — a fixed dark gradient, a fake
  35%-filled progress bar, and a fake silhouette. It shows image[0] with none of the grade,
  motion, overlay, or captions that will actually render.
- The `CaptionsTab` preview is a **CSS approximation** with four placeholder words
  ("you / are / not / crazy"), not your transcript and not the real renderer's typography.
- The only *true* output is the **"Render preview" button**, which kicks off a full backend
  render and plays an mp4 — slow, and disconnected from the control you just changed.

So the core feedback loop of any editor — *change something → see it* — **does not exist.**
This single gap is why styles/filters feel like guesswork.

### 1.2 The colour grade ("the filter") is invisible and uncontrollable
Selecting a **Style** (`Cinematic / Intense / Heartfelt / Clean`) silently sets a full grade
via `gradeParams()` in `electron/services/engine/grade.ts` — e.g. *Cinematic* applies
saturation 1.12, contrast 1.06, a warm-shadow/cool-highlight colour balance, a strong
vignette, and temporal film grain. The compositor faithfully renders all of it. But the UI
offers **no way to see these values, dial them back, or turn them off** — your only "off" is
choosing the `None` style, which also throws away the transitions and text effects. This is
exactly the user's complaint: *"it puts a filter over the image/b-roll — how do I turn it off
or customise it?"* Right now: you can't.

### 1.3 Everything is global; nothing is per-segment
Images are **auto-split evenly** across the audio ("IMAGES · EVEN AUTO-SPLIT"). You can drag
to reorder, but you **cannot** set one image's duration, give one image a different Ken Burns
direction, pin an image to a specific moment, or give one segment a different look. Captions
are one global preset for the whole video. There is no timeline to select a moment and edit
just that moment. That is the literal definition of "feels hardcoded."

### 1.4 Presets are opaque
Caption presets (`Hormozi / Pop / Bold / Word / Neon / Minimal`) are six tiny text buttons
with **no visual** — the only hint is a caption that reads "uniform pop (Hormozi)." Video
styles have one-line tooltips but you can't see them. The user asks, reasonably: *"what does
each caption style do? what do the video styles do?"* The UI never answers.

### 1.5 Power is fragmented behind a "beta" flag across two tabs
Overlay, auto-zoom, B-roll, style, and the effect-plan live in `Style` + `Advanced`, gated by
`settings.beta.enabled` that "turns on when changed." Real capabilities are hidden, split
across tabs, and labelled experimental. The Auto-B-roll control is duplicated (a status chip
in `MediaTab`, the real toggle in `StyleTab`) — already a known source of "which switch is
real?" confusion.

### 1.6 The mental model is "configure a job," not "edit a video"
The screen is titled "STEP 02 — COMPOSE" and reads as a wizard step. Combined with 1.1, the
user is asked to **configure a render blind** and only discovers the result after it renders.
World-class editors invert this: you *edit against a preview*, and rendering is just export.

---

## 2. How world-class editors actually operate (the patterns we borrow)

I studied the tools most relevant to this app's job — an audio-driven, caption-heavy,
image/B-roll "faceless" video. Sources are cited; content was rephrased for compliance with
licensing restrictions and verbatim limits.

- **The universal NLE layout.** CapCut's desktop interface is, in its own docs, a left panel
  for media/assets, a centre preview window, and a timeline along the bottom — the same
  three-zone shape Premiere, Resolve and Kdenlive share
  ([CapCut PC interface overview](https://www.capeditcut.com/capcut-pc-tutorial-guide/)).
  This is the layout users already expect from "a real editor."

- **The contextual Inspector (DaVinci Resolve).** Resolve's Inspector shows the parameters of
  the *currently selected* clip and edits only that clip; panels that don't apply are greyed
  out, and with nothing selected it can show timeline-level settings
  ([Resolve manual — Using the Inspector](https://steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part936.htm),
  [Inspector Effects Controls](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1159.htm)).
  Resolve also organizes the whole app into task-focused "pages" (Cut, Edit, Color, Deliver…)
  rather than one cluttered surface ([Resolve beginners' guide](https://pixflow.net/blog/davinci-resolve-beginners-guide)).
  We adopt the inspector idea directly: select an image / caption / the project → edit just
  that, in one contextual panel.

- **Transcript-as-timeline (Descript).** Descript pairs a **script editor** (you edit the
  transcript like a doc) with a **scene editor** (visual preview), and treats images,
  captions, music and SFX as **layers** adjusted independently of the script; a text layer's
  Properties panel exposes font, size, alignment, colours, borders, background and position
  ([Descript — the editor interface](https://help.descript.com/hc/en-us/articles/37585546799757),
  [stock/captions/effects layers](https://help.descript.com/hc/en-us/articles/12878417264653-Stock-media-captions-and-effects),
  [text & captions properties](https://help.descript.com/hc/en-us/articles/10256391944333-Text-and-captions)).
  This app *already* has a word-level transcript — so the transcript is the natural way to
  navigate and place things, exactly like Descript.

- **Caption styles as a previewable gallery with word-highlight colour (Submagic/Opus).**
  Short-form tools run a pipeline of transcribe → choose moments → draw word-by-word captions
  → render, and expose caption **styling** as the main creative surface — including letting
  you highlight specific words in chosen colours
  ([AI editing tool pipeline overview](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/opus-clip-descript-submagic-captions-ai-video-editor-tools-2026),
  [Submagic — word highlight colours](https://care.submagic.co/en/article/how-to-apply-highlighting-colors-to-your-words-16ttppq/)).
  The lesson: caption presets must be **seen**, and word-highlight colour must be a
  first-class control.

- **Non-destructive looks with an intensity slider, and adjustment layers (CapCut/KineMaster).**
  CapCut's adjustment layer is described as a non-destructive overlay that grades the whole
  video or just a section without changing the original
  ([CapCut adjustment layers](https://umatechnology.org/how-to-add-an-adjustment-layer-in-capcut/)),
  and filter strength is a 0–100% intensity slider in KineMaster
  ([KineMaster colour grading & filters](http://kinemaster.com/features/color-grading)).
  The lesson: a "look" should be toggleable, dialable (0–100%), and applyable globally or to a
  range — never silently baked in.

- **Effect stacks you can enable/disable (Kdenlive, open-source).** In Kdenlive you drag an
  effect onto a clip and an **effect-stack** panel shows what's applied so you can adjust it,
  and built-in effects can be globally disabled
  ([Kdenlive — effects & filters](https://docs.kdenlive.org/en/effects_and_filters.html),
  [applying effects](https://wikisandbox.kde.org/Kdenlive/Manual/Effects/en)). The lesson:
  effects should be a visible, editable, toggleable list — not an implicit consequence of a
  preset name.

- **Keyframes as the model for "change over time" (CapCut).** CapCut keyframes mark a value at
  a moment and interpolate between them, for position/scale/rotation/opacity/colour/volume
  ([CapCut keyframes guide](https://www.positioniseverything.net/how-to-use-keyframes-in-capcut-pc-full-guide/)).
  We don't need full keyframing day one, but it's the right north star for per-segment motion
  (and the compositor already does time-based zoom, so it's within reach).

**Synthesis for *this* app:** a transcript-and-audio-driven editor wants **Descript's
transcript navigation + layers**, wrapped in the **universal preview/timeline/inspector
shell**, with **Submagic-grade caption previews** and **CapCut/KineMaster-style
non-destructive looks**. That's the target.

---

## 3. The redesigned editor — anatomy

Replace the four tabs with a single editor surface:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Topbar: ‹project picker›   16:9│1:1│9:16   [ Quick ▾ | Pro ]   ⤓ Preview render   → Send to render │
├───────────────┬──────────────────────────────────────┬─────────────────────┤
│ LEFT RAIL      │            PREVIEW (centre)           │  INSPECTOR (right)   │
│                │                                       │  contextual to the   │
│ ◯ Transcript   │   ┌─────────────────────────────┐    │  current selection:  │
│   (clickable   │   │  live composited STILL frame │    │                      │
│    words →     │   │  at the playhead — real grade│    │  • Nothing selected →│
│    seek+edit)  │   │  + overlay + caption + motion│    │    Project look /    │
│                │   │                              │    │    defaults          │
│ ◯ Media        │   └─────────────────────────────┘    │  • Image segment →   │
│   images +     │   ⏮  ◀  ▶  ⏭   00:14 / 03:02   ⟳      │    duration, motion, │
│   b-roll pool  │                                       │    look override     │
│                │                                       │  • Caption group →   │
│                │                                       │    style, highlight, │
│                │                                       │    colour, line break│
├───────────────┴──────────────────────────────────────┴─────────────────────┤
│ TIMELINE (bottom) — playhead scrubs the preview                             │
│  VISUAL   [ img1 ][ img2 ][  b-roll  ][ img3 ]      ← click a block to edit  │
│  CAPTIONS [you][are][NOT][crazy] …                  ← click a word/group     │
│  LOOK     [▱ Cinematic 70% ───────────────]         ← a look "span"          │
│  AUDIO    ▁▂▃▅▇▅▃▂▁▂▃▅▇  (waveform)                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Why this shape: it matches what users expect from a real editor (CapCut/Resolve/Kdenlive),
and it makes the missing feedback loop the *centre of gravity* of the screen.

### 3.1 Quick vs Pro (progressive disclosure)
Not everyone wants a timeline. Offer a **Quick** mode (preview + a short stack of the most-
used controls: style, caption preset, look intensity, B-roll on/off) and a **Pro** mode (the
full timeline + inspector). Default new users to Quick; remember the choice. This mirrors
Resolve's Cut-vs-Edit philosophy of a fast surface and a deep one
([Resolve pages overview](https://pixflow.net/blog/davinci-resolve-beginners-guide)).

---

## 4. The live preview (the heart of the redesign) — using a still frame

Per the user's hint, **the preview is a still frame, not video playback** — which is both
much simpler and entirely sufficient for this app, because the creative decisions (look,
caption style, framing, motion amount) are all judgeable from a representative frame.

**How it works (and why it's cheap):** the WebGL compositor (`Compositor.drawFrame(timeSec)`)
is already built to draw exactly one composited frame at any time `t` — base image +
crossfade + Ken Burns/punch + grade + vignette + grain + overlay + caption. We instantiate
that **same compositor** on a small `OffscreenCanvas` in the renderer and call `drawFrame(t)`
whenever (a) the playhead moves or (b) any control changes. No encoder, no muxer, no audio —
just the one shader pass that already exists.

**Three preview tiers:**
1. **Live still (default, instant).** The composited frame at the playhead. Updates in real
   time as you drag any slider — this is the feedback loop that's missing today. For **image**
   segments it's pixel-exact to the final render.
2. **Scrub.** Dragging the playhead re-renders the still at that `t` (a "flipbook" of the
   whole video). Optionally, a low-rate "play" that steps the still a few times per second to
   sanity-check caption timing — still cheaper than decoding video.
3. **B-roll honesty.** For **B-roll** segments, show a representative **poster still** (first
   decoded frame, cached) rather than decoding video live — exactly the simplification the
   user suggested. The look + caption overlaid on it are still exact, so the creative call is
   still trustworthy. A small "▶ video segment" badge sets the expectation.
4. **Preview render (kept).** The existing `compose.preview` full render stays as the final
   "see it move with audio" confirmation, now relabelled "Preview render" and reachable from
   the topbar.

**Result:** for the first time, changing a Style, dragging look intensity, or switching a
caption preset *immediately shows the actual result*. This alone removes ~80% of the
"hardcoded / can't tell what it does" feeling.

---

## 5. The Inspector — where "customisable" lives (DaVinci pattern)

One contextual panel on the right whose contents depend on what's selected (greyed/empty when
nothing applies, like Resolve). This is where the app stops being "hardcoded."

### 5.1 Nothing selected → Project look & defaults
The global defaults for the whole video:
- **Look / Grade** (see §6) — the headline fix.
- **Default caption style** (see §7).
- **Default motion** — Ken Burns on/off + amount; punch-zoom on emphasized words.
- **Overlay** — the edge-darkening gradient (already exists) with intensity.
- **Aspect** — 16:9 / 1:1 / 9:16.

### 5.2 An image segment selected → that image only
- **Duration / range** (replaces "even auto-split" as a *default*, not a cage): drag the
  block on the timeline or type a value.
- **Motion override**: Ken Burns direction + amount for *this* image (engine already computes
  a per-image zoom window; we expose direction/amount).
- **Look override**: start from project look; optionally tweak just this segment (CapCut
  "adjustment over a section" idea).
- **Crossfade** into the next segment.

### 5.3 A caption group / word selected → captions (see §7)
Style for this group, emphasis, highlight colour, line breaks, position nudge.

### 5.4 The audio / a B-roll block selected
Audio: volume, optional SFX bed (engine supports `audio.sfxPath`). B-roll: which pool/niche,
density, and whether it's full-frame or overlay (`broll.mode` already exists).

> Interaction rule (Resolve): edits in the inspector affect **only the selection**; with
> nothing selected you're editing the **project defaults**. This one rule makes "global vs
> per-clip" obvious without explanation.

---

## 6. Solving "the filter" — a real Look panel (off · intensity · params · reset)

This directly answers *"it puts a filter over my video; how do I turn it off or customise
it?"* Today the grade is an invisible side effect of the Style. We make it an explicit,
non-destructive Look:

**Look panel (in the inspector):**
- **On/Off** — a master toggle. Off = the raw image, no grade, no grain, no vignette. (Today
  the only "off" is the `None` style, which also kills transitions; we separate the two.)
- **Intensity 0–100%** — one slider that scales the whole grade, the
  [KineMaster](http://kinemaster.com/features/color-grading) pattern. 100% = the preset's full
  look; 40% = a subtle version; 0% = none. This is the single most-requested kind of control
  and it's a one-line `mix(neutral, grade, intensity)` in the shader.
- **Look presets** — the current styles' grades, shown as **thumbnails of your own first
  frame** with the look applied (so you see the difference), not just names.
- **Fine controls (Pro)** — the exact parameters the engine already has: Brightness,
  Contrast, Saturation, Warm↔Cool (colour balance), Vignette, Sharpen, Grain. Each with a
  **reset** to neutral. (CapCut exposes precisely these — exposure/contrast/saturation/
  shadows/highlights — as standard grading controls;
  [CapCut colour grading](https://www.capcut.com/resource/capcut-color-grading).)
- **Scope** — Apply to *whole video* (default) or *this segment* (per §5.2), echoing CapCut's
  adjustment-layer model ([adjustment layers](https://umatechnology.org/how-to-add-an-adjustment-layer-in-capcut/)).

Crucially, the **Style** preset and the **Look** become independent: a Style can still set a
nice default grade, but the user can now see it, dial it, or switch it off without losing the
style's transitions/text effects. Non-destructive, reversible, visible.

---

## 7. Solving "what do caption styles do?" — a previewable gallery + caption inspector

Captions are this app's signature surface, so treat them like Submagic does.

### 7.1 A live caption gallery (not six tiny text buttons)
Render each preset (`Hormozi / Pop / Bold / Word / Neon / Minimal`) onto a **live sample
frame from your own video**, using the real caption renderer (`render-worker/captions.ts`),
so the gallery shows the actual typography, stroke, highlight and animation. A one-line plain
description under each ("big bold caps, one word at a time, yellow active word"). This is how
Submagic/CapCut present caption templates — as things you *see*, then customise
([CapCut animated caption templates](https://www.capcut.com/create/animated-text-maker)).

### 7.2 Caption inspector (full control, all already in the model)
Select a caption group/word on the timeline → edit:
- **Font, size, position, lines, pace, animation** — the controls that exist today, but now
  applied against the live preview.
- **Active-word highlight colour** — a colour picker bound to the existing
  `CaptionFrameModel.highlightColor` (engine already paints the active/emphasized word in this
  colour). Multiple highlight colours are a known short-form pattern
  ([Submagic word-highlight colours](https://care.submagic.co/en/article/how-to-apply-highlighting-colors-to-your-words-16ttppq/)).
- **Emphasis** — keep the transcript click-to-emphasize, but reflect it live in the preview.
- **Line breaks** — let the user force a break within a caption group (the renderer already
  splits a group into `lines`; expose an explicit break so wording reads the way they want).
- **Per-group override** (Pro) — restyle one caption (e.g. the hook line) differently from the
  rest, the Descript "layers adjusted independently" idea
  ([Descript layers](https://help.descript.com/hc/en-us/articles/12878417264653-Stock-media-captions-and-effects)).

> Note: the **square/box highlight behind a word** and its box colour that the user mentioned
> are part of the *thumbnail* text model (`TextLayer.highlightSquare`/`highlightColor`) and
> are covered in the thumbnail plan. For *video captions*, the equivalent (a highlighter box
> behind the active word) is a natural future caption style; flagged in §11, not assumed here.

### 7.3 Transcript-driven editing (Descript)
Make the left-rail transcript the navigation spine: click a word → the playhead seeks there
and the preview shows that frame; the transcript doubles as the caption editor (emphasis,
breaks). This leverages data the app already has and is the most intuitive way to move through
an audio-driven video ([Descript editor interface](https://help.descript.com/hc/en-us/articles/37585546799757)).

---

## 8. Solving "what do video styles do?" — transparent, editable starting points

Reframe **Style** from an opaque mode into a **named starting point that is fully visible and
editable**:
- When you pick a style, show a plain breakdown of *what it set*: e.g. *Cinematic = warm
  cinematic grade (55% vignette, light grain) + slow zoom + fade transitions*. (These values
  come straight from `gradeParams()` + the effect plan — we're just surfacing them.)
- Immediately reflect it in the live preview.
- Every individual thing it set (grade, vignette, motion, transitions, text effects) is then
  **independently editable** and resettable in the inspector — the Kdenlive "effect stack you
  can see and adjust" model ([Kdenlive effects](https://docs.kdenlive.org/en/effects_and_filters.html)).
- Keep the **Advanced effect-plan JSON / Groq generate** as a genuine power-user escape hatch
  inside a Pro "Effects" disclosure — but it's no longer the *only* way to deviate from a
  preset.

Net: styles become helpful presets that teach by example, not cages.

---

## 9. Proof it's "functionality already there" — control → engine field map

Every proposed control already has a backing field in the render spec/engine. The work is
UI + live preview wiring, not new rendering.

| Proposed UI control | Existing engine field (source of truth) |
|---|---|
| Look On/Off, Intensity | `GpuRenderSpec.grade` (`gradeParams()` in `grade.ts`) — scale toward neutral |
| Brightness / Contrast / Saturation | `grade.brightness` / `grade.contrast` / `grade.saturation` |
| Warm↔Cool | `grade.colorBalance.{r,g,b}` |
| Vignette / Sharpen | `grade.vignette` / `grade.sharpen` |
| Grain | `grain.strength` / `grain.temporal` |
| Per-image duration | `RenderImageSpec.startSec/endSec` (currently auto-split) |
| Ken Burns on/off + amount | `motion.kenBurns` (compositor `scaleAt()` already ramps zoom) |
| Punch-zoom on emphasis | `motion.punchAtSec[]` |
| Crossfade | compositor crossfade window (currently fixed 0.4s) |
| Overlay edges + intensity | existing `overlayPath` + `BetaVideoOpts.overlay` |
| Caption preset/font/lines/position/pace/anim | `CaptionFrameModel.{preset,font,lines,position,mode,animation}` |
| Active-word highlight colour | `CaptionFrameModel.highlightColor` |
| Hook card | `CaptionFrameModel.hook` |
| B-roll density / full vs overlay | `BetaVideoOpts.broll.{density,mode}` / `GpuBrollSegment[]` |
| Aspect | `width/height` (project `captionAspect`) |
| SFX bed | `GpuRenderSpec.audio.sfxPath` |

The only genuinely *new* engine ask is making the **crossfade duration** and **Ken Burns
direction/amount** parameterized per segment (today crossfade is a fixed 0.4s and Ken Burns is
a fixed +12% zoom-in). Both are tiny shader/spec tweaks; everything else is pure UI + preview.

---

## 10. Consolidation & cleanup (remove confusion)

- **Retire the four tabs**; fold their controls into the inspector (contextual) + a Quick
  stack. "Captions," "Style," "Advanced" become inspector sections, not destinations.
- **Drop the "beta" gating** for the now-core controls (overlay, zoom, B-roll, style, look).
  Keep the API-key-dependent bits (stock-footage keys for B-roll) behind their key fields, but
  the *controls* are first-class, not experimental.
- **One B-roll control** (kill the duplicate): the inspector B-roll section is authoritative;
  any status shown elsewhere is read-only and deep-links to it.
- **Rename "STEP 02 — COMPOSE"** to **"Edit"** — it's an editor, not a wizard step.

---

## 11. In-editor guidance (so no one is lost)

- **First-open coachmarks** (once): "This is your live preview — drag the playhead.", "Select
  any block to edit just that part.", "Looks are non-destructive — dial them down or off."
- **Empty/again-empty states**: never show the editor with no project — show a "pick a clip"
  chooser (generalize the current auto-open-when-one-download behavior).
- **Plain language**: replace jargon flagged in `docs/USER-REVIEW-2026-06-26.md` — "seed" →
  "shuffle lock", "Ken Burns" → "slow zoom (Ken Burns)", "pace → word/steady" with a one-liner,
  "pool/sequence" → "shuffle/in order."
- **Reset everywhere**: every look/motion/caption control has a reset-to-default; the project
  has "Reset look to style default."

---

## 12. Preview feasibility & performance notes (for engineering)

- Reuse `Compositor` in the renderer on a ~640×360 (or aspect-matched) `OffscreenCanvas`.
  Drawing one frame is a single shader pass — sub-millisecond on any GPU; trivial even on a
  software GL fallback at preview size.
- Upload image textures once per project (the compositor already supports `setImages`);
  caption texture re-uploads only when the caption text/active word changes (the caption layer
  already returns a "changed?" boolean from `draw()`).
- For B-roll posters, decode one frame per segment on selection and cache the `ImageBitmap`.
- Debounce slider→redraw to animation frames; scrubbing redraws on `requestAnimationFrame`.
- The full-motion confirmation stays the existing backend `compose.preview` render — unchanged.
- **No new heavy dependency**: this is the *existing* render path, run for one frame, in the
  window instead of the worker.

---

## 13. Phased rollout (UX-first; each phase is shippable and visible)

**E1 — Live still preview + transport.** Stand up the central preview using the existing
compositor; wire it to the current controls; add playhead/scrub. *This alone transforms the
feel* and de-risks everything after it. (No engine changes.)

**E2 — The Look panel.** Expose grade as On/Off + Intensity + preset thumbnails, decoupled
from Style; add per-parameter fine controls + reset. Directly answers the "filter" complaint.

**E3 — Inspector + selection model.** Introduce the contextual inspector and "select to edit"
for project-vs-segment; move caption/style/overlay/motion controls into it.

**E4 — Timeline.** Add the multi-track timeline (visual / captions / look / audio) with
per-image duration + reorder + B-roll placement; selection drives the inspector.

**E5 — Caption gallery + transcript navigation.** Live-rendered caption preset gallery;
click-word-to-seek transcript; highlight-colour picker; line breaks.

**E6 — Polish & consolidation.** Quick/Pro modes, remove beta gating, coachmarks, plain-language
labels, the small engine tweaks (parameterized crossfade + Ken Burns direction/amount).

Rough effort: E1 ≈ 3–4d · E2 ≈ 2–3d · E3 ≈ 3–4d · E4 ≈ 5–6d · E5 ≈ 3–4d · E6 ≈ 3–4d.
E1 + E2 are the highest-impact and lowest-risk; they can ship before the structural E3/E4.

---

## 14. Open questions for you

1. **Quick vs Pro** — do you want a deliberately simple default mode, or always the full
   timeline/inspector?
2. **Per-segment looks** — important to you (different grade on different images), or is one
   global look per video enough for v1?
3. **Motion ambition** — is "Ken Burns direction + amount per image" enough, or do you
   eventually want full CapCut-style keyframes (position/scale over time)?
4. **B-roll preview** — is the poster-still approach acceptable, or do you want a couple of
   sampled frames per B-roll segment so it reads more like motion?
5. **Caption highlighter box** — do you want a Submagic-style coloured box behind the active
   *caption* word (with box colour) added as a new caption style, since you raised it for
   text generally?

---

## 15. Explicitly out of scope (the thumbnail plan, next)

Not touched here, by your instruction: the thumbnail editor — multi-layer selection, text
line-breaks, the line-size / line-gap / word-highlight controls, and the highlight-box colour
(`ThumbnailTemplate` / `TextLayer` / `src/features/thumbnail-editor`). Those are a separate
canvas and a separate document, which we'll do after this.

---

## 16. Sources

Content from the following was paraphrased/summarized for compliance with licensing
restrictions (no verbatim passages beyond short factual phrases):

- DaVinci Resolve Inspector & pages: [Using the Inspector](https://steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part936.htm),
  [Inspector Effects Controls](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1159.htm),
  [Transform/Inspector guide](https://cromostudio.it/cromo-tips/a-comprehensive-guide-to-the-inspector-tab-in-davinci-resolve),
  [pages overview](https://pixflow.net/blog/davinci-resolve-beginners-guide).
- CapCut layout, keyframes, grading, adjustment layers, caption templates:
  [interface](https://www.capeditcut.com/capcut-pc-tutorial-guide/),
  [keyframes](https://www.positioniseverything.net/how-to-use-keyframes-in-capcut-pc-full-guide/),
  [colour grading](https://www.capcut.com/resource/capcut-color-grading),
  [adjustment layers](https://umatechnology.org/how-to-add-an-adjustment-layer-in-capcut/),
  [animated text](https://www.capcut.com/create/animated-text-maker).
- KineMaster filter intensity: [colour grading & filters](http://kinemaster.com/features/color-grading).
- Descript text-based editing, scenes, layers, text properties:
  [editor interface](https://help.descript.com/hc/en-us/articles/37585546799757),
  [layers](https://help.descript.com/hc/en-us/articles/12878417264653-Stock-media-captions-and-effects),
  [text & captions](https://help.descript.com/hc/en-us/articles/10256391944333-Text-and-captions).
- Submagic/Opus caption pipeline & word highlights:
  [pipeline](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/opus-clip-descript-submagic-captions-ai-video-editor-tools-2026),
  [word highlight colours](https://care.submagic.co/en/article/how-to-apply-highlighting-colors-to-your-words-16ttppq/).
- Kdenlive (open source) effect stack: [effects & filters](https://docs.kdenlive.org/en/effects_and_filters.html),
  [applying effects](https://wikisandbox.kde.org/Kdenlive/Manual/Effects/en).
