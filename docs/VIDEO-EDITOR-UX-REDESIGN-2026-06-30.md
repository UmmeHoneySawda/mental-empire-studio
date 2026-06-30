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

## 14. Decisions (resolved 2026-06-30) — see Part II for the detail

All five are resolved; the *how*, with code-level research, is in **Part II** below.

| # | Question | Decision |
|---|---|---|
| 1 | Quick vs Pro | **Quick mode is the default and must be gorgeous out of the box**; "Customize everything" is one click deeper. This is an **automation tool a beginner drives**, not a pro NLE. (§II-A) |
| 2 | Per-segment looks | **One global look per video is fine** — but it must be *previewable* and dialable. Per-segment look is optional/advanced, not v1. (§II-C) |
| 3 | Motion | **"Simple but gorgeous, creative" — designer's call.** Proposing **Smart Motion / "Living Stills"** (eased alternating push-pull + emphasis punch), auto by default, customizable. (§II-D) |
| 4 | B-roll preview | **Poster still confirmed.** (§II-E) |
| 5 | Submagic caption style | **Yes — add it** (highly popular), grounded in how open-source editors implement it in code. (§II-F) |

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


---

# PART II — Refinements: automation-first, with code-level research (2026-06-30 update)

This part incorporates the user's direction: **this is an automation tool a beginner can
drive — not a video/photo editor.** Quick mode is the default and must look great with zero
decisions, while *everything* remains customizable one layer deeper. It also answers the
explicit ask: **research how other (popular, open-source) editors implement these things in
their code**, and ground the proposals in those implementations. Web content below was
paraphrased for compliance; sources are linked inline and collected in §II-I.

## II-A. The guiding principle: "gorgeous defaults, optional infinite depth"

Reframe the editor's *purpose*. The pipeline already auto-produces a finished video; the
editor is an **optional override/tweak surface**, not a place you must visit. So the design
law is:

> **A complete beginner should get a beautiful result by changing nothing. Anyone who wants
> control should find it one click away — never required, never hidden forever.**

Concretely:
- **Quick mode is the entire default experience.** It is the live preview (Part I §4) plus a
  short, friendly control stack — nothing else on screen:
  - **Look** (a row of preview thumbnails of *your own frame* + an intensity slider)
  - **Captions** (a row of style thumbnails, incl. *Submagic*)
  - **Motion** (Off / Subtle / Cinematic)
  - **B-roll** (Off / Auto)
  - **Aspect** (16:9 / 1:1 / 9:16)
  Each control has a great default already chosen by the automation.
- **"Customize" reveals the Inspector + Timeline** (Part I §3, §5) for per-segment and
  per-parameter control. This is the only thing the "Pro" mode adds. Beginners never see it
  unless they ask.
- **No jargon in Quick mode.** "Look" not "grade/LUT"; "Motion" not "Ken Burns"; "Captions"
  not "caption preset/animation." The technical names live in Customize with one-line
  explanations.

This mirrors how consumer tools win beginners while keeping pros: Canva applies a filter on
click and *then* offers an intensity slider ([Canva video filters](https://www.canva.com/features/video-filters/));
Resolve separates a fast surface (Cut) from a deep one (Edit)
([Resolve pages](https://pixflow.net/blog/davinci-resolve-beginners-guide)).

## II-B. The previewable Look system (filters) — what creators use + how pros do it in code

**Decision:** keep looks **global** (per-video), but (1) make every look **previewable** on
the user's own frame and (2) give it an **intensity** slider. No more invisible baked-in
filter.

### II-B.1 The looks to ship (what popular creators actually use)
From surveying creator-facing LUT/filter packs and tools, the looks that dominate short-form
and "faceless" content cluster into a small, recognizable set (names are descriptive, not
brands):

| Look | What it does | Where it's popular |
|---|---|---|
| **Teal & Orange** | warm skin/highlights vs teal shadows — the "blockbuster cinematic" look | the single most common creator LUT ([Filmora teal & orange](https://filmora.wondershare.com/video-creative-tips/teal-and-orange-cinematic-lut-filter-pack.html)) |
| **Warm Film / Vintage** | warm cast, lifted/faded blacks, gentle grain | retro/storytelling ([vintage film LUTs](https://flourishpresets.com/blogs/flourish-presets-lightroom-presets-luts/enhance-your-videos-with-video-luts-a-comprehensive-guide)) |
| **Clean & Bright** | neutral, slightly lifted, punchy — "lifestyle/UGC" | talking-head, product |
| **Moody Cinematic** | crushed contrast, desaturated, cool | motivation/dark themes (fits "Mental Empire") |
| **Golden Hour** | warm dreamy glow | inspirational ([Elgato "orange glow"](https://marketplace.elgato.com/video/luts)) |
| **Cold / Blue** | cool, clinical, tech | tech/news |
| **Noir / B&W** | monochrome, high contrast | dramatic quotes |

Ship ~6–8 of these as the Look gallery, each with a sensible **default intensity** (~60–80%,
because full-strength LUTs read as "overcooked").

### II-B.2 How pro/most editors apply filters *in code* (and what we should do)
The universal technique across DaVinci/Premiere/CapCut/games is a **3D LUT (`.cube`) sampled
in a fragment shader, blended by a strength value**:
- A `.cube` file is a 3D table mapping input RGB → output RGB. In a shader you treat it as a
  texture, look up the pixel's colour, and read back the graded colour; intensity is just
  `mix(original, graded, strength)`. This is exactly the approach walked through in
  [frost.kiwi "WebGL LUTs made simple"](https://blog.frost.kiwi/WebGL-LUTS-made-simple/) and
  packaged by libraries like [web-luts](https://www.mintlify.com/hsrambo07/grader-extension/quickstart)
  (presets + per-image strength) and engine examples like
  [keijiro/CubeLutTest](https://github.com/keijiro/CubeLutTest) (Unity Shader Graph applying a
  `.cube`). Parsers to mirror: [pycubelut](https://github.com/yoonsikp/pycubelut),
  [3dLUT2js](https://github.com/walter-arrighetti/3dLUT2js).
- CapCut/KineMaster expose this to users as a **filter + intensity slider (0–100%)**
  ([KineMaster](http://kinemaster.com/features/color-grading)) and, for finer control,
  shadow/midtone/highlight wheels ([CapCut colour grading](https://www.capcut.com/resource/capcut-color-grading)).

**Recommendation for this app (small, code-level):** the compositor already does per-pixel
colour work in a fragment shader, so add a LUT stage on top of the existing parametric grade:
1. **LUT loader:** parse `.cube` → a tiled 2D texture (the standard "sliced cube" / Hald image
   layout used by the references above). Bundle the 6–8 looks as `.cube` assets.
2. **Shader:** add a `lutTexture` sampler + `lutStrength` uniform; after the current grade,
   sample the LUT (trilinear via two texture taps) and `mix()` by `lutStrength`.
3. **Spec:** add `grade.lut: { id, strength }` to `GpuRenderSpec.grade` (alongside the existing
   brightness/contrast/etc., which become the "Adjust" advanced layer beneath the look).
4. **Preview:** render each look as a thumbnail of the user's **own first frame** via the live
   still preview (Part I §4) — so the gallery shows real before/after, the
   [Canva](https://www.canva.com/features/video-filters/)/ImagineRokas
   ([before/after LUT packs](https://imaginerokas.gumroad.com/l/cinematicluts)) pattern.

This keeps "functionality already there" true — it's one extra shader stage and a texture,
reusing the existing fragment pipeline.

## II-C. Global vs per-segment looks
Per the decision, **v1 = one look for the whole video** (simplest mental model for a
beginner). The architecture (a `grade.lut` on the spec) trivially extends to a per-segment
override later (CapCut's adjustment-layer-over-a-range idea,
[adjustment layers](https://umatechnology.org/how-to-add-an-adjustment-layer-in-capcut/)),
but it stays out of Quick mode.

## II-D. Motion — "Smart Motion / Living Stills" (the creative call)

Goal: **simple but gorgeous, creative, and automatic.** Most slideshow tools either sit
static (cheap) or zoom linearly (jerky/seasick). The design:

- **Living Stills (default).** Every image gets a slow, **eased** move (ease-in-out, never
  linear — linear is what makes CSS Ken Burns look jittery on long pans, which is why people
  move it to canvas: [GSAP fluid canvas Ken Burns](https://github.com/Bannerboy/gsap-fluid-ken-burns),
  [smooth Ken Burns via transform](https://stackoverflow.com/questions/76477751/how-to-create-a-smooth-ken-burns-style-animation-using-transform-instead-of)).
  We're on WebGL already, so we get smoothness for free.
- **It breathes.** Direction **alternates** per image — push-in, then pull-back, then push-in
  with a slight pan — so a sequence feels intentional, not repetitive. The pattern is
  **deterministic from the project seed** (re-rollable, consistent across renders), not random.
- **It reacts to the words.** On an emphasized caption word, a subtle, fast **punch** (≈1–3%
  quick zoom, eased) snapped to that word's timestamp — energy exactly where the narration
  lands. (The engine already has `motion.punchAtSec[]`; we sync it to the active caption
  token times from §II-F.)
- **B-roll** gets a slow drift only (it already moves).

**Controls:**
- Quick: **Motion = Off / Subtle / Cinematic** (one choice; Cinematic = bigger moves + punch).
- Customize: per-image direction (in/out/left/right + focal point) and amount; toggle the
  emphasis punch.

**Code-level:** generalize the compositor's `scaleAt()` into a small motion function taking
`{ from, to, easing, focal }` per image (today it's a fixed +12% linear-ish zoom); add an
`easeInOutCubic`; assign per-image direction from the seeded alternating pattern. This is a
contained change to one shader-driving function. Reference patterns: the canvas/transform Ken
Burns implementations above (for the easing/smoothness lessons).

## II-E. B-roll preview — poster still (confirmed)
Decode **one representative frame** per B-roll segment (first keyframe via the existing
ffmpeg/decoder path), cache it as an `ImageBitmap`, and show it in the preview/timeline with
the look + caption composited on top and a small "▶ video" badge. No live video decode in the
editor — exactly the simplification requested, and the creative call (look/captions/timing)
is still accurate.

## II-F. Submagic-style captions — add it, grounded in open-source code

**What "Submagic style" means concretely:** big, bold, centered captions revealed **word by
word (1–3 words on screen)**, with the **active word highlighted by a coloured box/background**
(not just coloured text) and a small **pop/bounce**. ([Submagic word highlighting](https://care.submagic.co/en/article/how-to-apply-highlighting-colors-to-your-words-16ttppq/),
which offers a few highlight colours.)

**How open-source editors do it in code (the model to copy):** the cleanest reference is
**Remotion's `@remotion/captions` + the open-source `template-tiktok`**
([template-tiktok repo](https://github.com/remotion-dev/template-tiktok),
[createTikTokStyleCaptions docs](https://www.remotion.dev/docs/captions/create-tiktok-style-captions)).
The data model is:
- A flat list of `Caption { text, startMs, endMs, timestampMs }` (which this app already has
  from its Whisper transcription).
- `createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds })` groups them into
  **pages**, each with `tokens: { text, fromMs, toMs }`. A **high** combine value puts many
  words on a page; a **low** value gives true word-by-word. (Content rephrased.)
- At render time `t`, the **active token** is the one where `fromMs ≤ t < toMs`. That token
  gets the highlight treatment; the rest of the page is shown dimmer/plain.

**How it maps onto THIS app's existing caption renderer (`src/render-worker/captions.ts`) —
i.e. why it's mostly already there:** the renderer already (a) draws word-by-word, (b) paints
the active/emphasized word in `highlightColor`, and (c) does a pop scale. The *additions* to
reach true Submagic style are small and specific:
1. **A rounded-rect highlight box behind the active word** — measure the active token's text
   box (`ctx.measureText`), draw a rounded rect fill, then the text on top. (New, ~a few lines
   in the caption canvas layer.)
2. **A `boxColor` control** (+ keep `highlightColor` for the text) — so the box colour is
   customizable, which the user explicitly wanted. Add `boxColor` to `CaptionFrameModel`.
3. **Words-per-page** = generalize the existing `mode: word | phrase` into a
   `combineWithinMs`/`maxWordsPerPage` value, exactly the Remotion `combineTokensWithinMilliseconds`
   knob.
4. **Pop/bounce on the active word** — already present; expose its amount.

**Presentation:** add **"Submagic"** as a named entry in the previewable caption gallery
(Part I §7.1), rendered live on the user's own frame. In Customize, expose: highlight text
colour, **box colour**, words-per-page, font, size, position. Defaults chosen to look like the
popular style with zero edits.

> This is also the answer to "research how other editors do it in their code": we are
> deliberately adopting the **Remotion token/page model** (open source, MIT) for grouping and
> active-word selection, and the **rounded-box-behind-active-word** rendering pattern that the
> TikTok/Submagic family uses — implemented inside the caption canvas layer that already
> exists here.

## II-G. Quick-mode default layout (beginner-first)

```
┌───────────────────────────────────────────────┐
│            LIVE PREVIEW (still @ playhead)      │
│         ⏮ ◀ ▶ ⏭   00:14/03:02      [Customize ▸]│
├───────────────────────────────────────────────┤
│ Look      [▦][▦][▦][▦][▦]   intensity ●───── 70%│   (thumbnails of your own frame)
│ Captions  [Aa][Aa][Aa]  ‹Submagic selected›     │
│ Motion    ( Off · Subtle · ●Cinematic )         │
│ B-roll    ( Off · ●Auto )                       │
│ Aspect    ( 16:9 · 1:1 · ●9:16 )                │
├───────────────────────────────────────────────┤
│              → Send to render                   │
└───────────────────────────────────────────────┘
```
Five rows, all pre-set by automation, all previewed live. "Customize ▸" swaps in the
inspector + timeline from Part I for anyone who wants more. Nothing else competes for
attention.

## II-H. Updated rollout (reflecting these decisions)

- **E1 — Live still preview + transport** (unchanged; still the keystone).
- **E2 — Look system (LUT-based + intensity + live thumbnails)** — ship the 6–8 creator looks
  as `.cube` + the shader stage; this *is* the "previewable global filter" the user asked for.
- **E2.5 — Smart Motion / Living Stills** — eased alternating moves + emphasis punch; Quick
  toggle Off/Subtle/Cinematic.
- **E3 — Inspector + selection** (Customize surface).
- **E4 — Timeline** (per-segment, advanced).
- **E5 — Caption gallery + Submagic style** (rounded active-word box + box colour +
  words-per-page; transcript navigation).
- **E6 — Quick-mode polish, coachmarks, plain language, remove beta gating.**

E1 + E2 + E5(Submagic) are the visible wins a beginner feels immediately; E3/E4 serve the
"customize everything" promise without ever being mandatory.

## II-I. Additional sources (code-level research)

Paraphrased/summarized for compliance; short factual phrases only.
- WebGL LUT technique: [frost.kiwi — WebGL LUTs made simple](https://blog.frost.kiwi/WebGL-LUTS-made-simple/);
  libraries/parsers: [web-luts](https://www.mintlify.com/hsrambo07/grader-extension/quickstart),
  [keijiro/CubeLutTest](https://github.com/keijiro/CubeLutTest),
  [pycubelut](https://github.com/yoonsikp/pycubelut),
  [3dLUT2js](https://github.com/walter-arrighetti/3dLUT2js).
- Creator looks: [Filmora teal & orange](https://filmora.wondershare.com/video-creative-tips/teal-and-orange-cinematic-lut-filter-pack.html),
  [Flourish vintage/LUT guide](https://flourishpresets.com/blogs/flourish-presets-lightroom-presets-luts/enhance-your-videos-with-video-luts-a-comprehensive-guide),
  [Elgato LUTs](https://marketplace.elgato.com/video/luts),
  [Canva video filters + intensity](https://www.canva.com/features/video-filters/).
- TikTok/Submagic captions in code: [Remotion template-tiktok](https://github.com/remotion-dev/template-tiktok),
  [createTikTokStyleCaptions](https://www.remotion.dev/docs/captions/create-tiktok-style-captions),
  [Submagic word-highlight colours](https://care.submagic.co/en/article/how-to-apply-highlighting-colors-to-your-words-16ttppq/).
- Smooth motion: [GSAP canvas Ken Burns](https://github.com/Bannerboy/gsap-fluid-ken-burns),
  [smooth Ken Burns via transform](https://stackoverflow.com/questions/76477751/how-to-create-a-smooth-ken-burns-style-animation-using-transform-instead-of).


---

# PART III — Implementation plan (dev integration guide, verified 2026-06-30)

This is the file-by-file integration guide. It was checked against the code; two findings make
the plan *easier* than written:

- **`GradeParams.lut?: string` already exists** in `shared/renderSpec.ts` ("optional baked 3D
  LUT (.cube) asset id; when absent the shader uses the math below"). So the Look system (§II-B)
  is **already anticipated by the data model** — the compositor just doesn't sample a LUT yet.
- **The active-word/active-image logic already exists as pure helpers** in `renderSpec.ts`:
  `activeCaptionGroup()`, `activeWordInGroup()`, `activeImageIndex()`, `totalFrames()`. The
  Submagic active-word box (§II-F) and the live preview (§4) reuse these — no new timing math.

Also confirmed: `CaptionFrameModel{groups,preset,font,animation,mode:'word'|'phrase',position,
lines:1|2|3,highlightColor,hook}`, `MotionSpec{kenBurns,punchAtSec}`, `RenderImageSpec
{path,startSec,endSec}`, `audio.{voicePath,sfxPath?}`, `GpuBrollSegment`; the compositor
(`src/render-worker/compositor.ts`) is WebGL2 with uniforms incl. `u_colorBalance/u_vignette/
u_grain/u_sharpen`, a `drawFrame(timeSec)` method, `setImages`, and `scaleAt()` doing the fixed
`1 + 0.12*p` Ken Burns; the 0.4s crossfade is hardcoded in `src/render-worker/encoder.ts`.

## III-0. The one real integration decision: where the preview compositor runs

Today `Compositor` runs in the render-worker for the *full* render. For the live still preview
it must run in the **main window**. Two pieces are needed:

1. **A spec to draw.** `buildGpuRenderSpec()` lives in `electron/services/engine/gpu/spec.ts`
   (Node side, imports services). **Do not import it into the renderer.** Instead add an IPC
   **`compose:previewSpec(projectId, draftOverrides) → GpuRenderSpec`** that builds the spec in
   main and returns it (the spec is serializable + DOM-free by design). `draftOverrides` carries
   the not-yet-saved Look/Caption/Motion/aspect choices so the preview reflects live edits.
2. **Pixels for the textures.** The compositor needs decoded images. In the renderer, load each
   `RenderImageSpec.path` via the app's file access (`createImageBitmap(await (await fetch(<file
   url>)).blob())`) and `compositor.setImages(...)`; cache by path. Reuse whatever file-URL/
   protocol the worker already uses to read assets (confirm in the worker's image loader).

This keeps the Node-only spec building in main and the GL work in the window. If WebGL2 is
unavailable, fall back to the existing backend `compose.preview` render for a single frame.

## III-1. E1 — Live still preview + transport

New: `src/features/video-editor/PreviewCanvas.tsx` + `usePreviewCompositor.ts`.
- Export the `Compositor` class (or a thin `PreviewCompositor` wrapper) from the render-worker
  module so it can be imported by the window; create a WebGL2 context on a `<canvas>` sized to
  the aspect (e.g. 640×360 / 360×640).
- State: `playheadSec` (zustand or local). On playhead change or any control change, call
  `compositor.drawFrame(t)` inside `requestAnimationFrame`; debounce slider input to one rAF.
- Fetch the spec via `compose:previewSpec(projectId, draft)`; rebuild only when structural
  things change (image list, durations), not on every slider tick (for pure grade/caption
  tweaks, mutate the spec in place and redraw).
- Transport bar: ⏮◀▶⏭, a scrubber bound to `playheadSec`, time readout. "▶" can step the still a
  few fps for a timing sanity check (no audio).
- **B-roll poster (§II-E):** add IPC **`compose:posterFrame(path) → dataURL`** (one ffmpeg
  thumbnail at t=0; cache on disk). For a b-roll segment window, bind its poster as the image
  texture so look+captions still composite exactly.
- DoD: changing any existing control updates the centre frame within one frame; scrubbing
  redraws; b-roll segments show a poster + "▶ video" badge.

## III-2. E2 — Look system (LUT + intensity), reusing `GradeParams.lut`

**Shader (`compositor.ts`):**
- Add uniforms `u_lut` (sampler2D), `u_lutSize` (float, e.g. 33), `u_lutStrength` (float) to the
  uniform list + lookups.
- After the existing grade math, sample the LUT (tiled "sliced-cube" 2D layout; trilinear via
  two taps) and `gl_FragColor.rgb = mix(graded, lutColor, u_lutStrength)`.
**Loader:** new `src/render-worker/lut.ts` — parse a `.cube` file → `Uint8Array` tiled texture +
size (pure, unit-testable). Bundle assets under `resources/luts/*.cube` and a manifest
`shared/looks.ts` = `[{id,name,defaultStrength}]` for the 6–8 looks in §II-B.1.
**Spec/model:** add `grade.lutStrength?: number` (0..1) to `GradeParams` (`lut` already exists).
`gradeParams(style)` in `electron/services/engine/grade.ts` may set a default `lut`; the spec
builder overlays the project's saved look.
**Persistence:** `ensureColumn(d,'projects','lookLut','TEXT')`, `lookStrength` (REAL),
`lookAdjust` (TEXT/JSON for the parametric overrides). IPC `compose:updateLook(projectId,{lut,
strength,adjust})`.
**UI:** `LookGallery.tsx` — a row of thumbnails rendered by the **preview compositor** on the
user's own first frame at each LUT's default strength; an **intensity slider** → `lutStrength`;
an **Adjust (advanced)** disclosure binding sliders directly to the existing `GradeParams`
fields (`brightness/contrast/saturation/colorBalance/vignette/sharpen/grain`) each with reset.
- DoD: picking a look + dragging intensity updates the preview live; "Off" = raw image; values
  persist and the final render matches the preview for image segments.

## III-3. E2.5 — Smart Motion / "Living Stills"

- **Compositor:** replace the fixed `1 + 0.12*p` in `scaleAt()` with a per-image motion
  function `{zoomFrom, zoomTo, panX, panY, ease}` and add `easeInOutCubic`.
- **Spec:** extend `RenderImageSpec` with optional `motion?: {zoomFrom;zoomTo;panX;panY;ease}`.
  In the spec builder, assign **alternating** push/pull + slight pan per image from the project
  **seed** (deterministic, re-rollable). Populate `MotionSpec.punchAtSec` from the timestamps of
  **emphasized caption words** (use `activeWordInGroup`/word `emphasis`).
- **UI:** Quick "Motion = Off / Subtle / Cinematic" → preset amounts + punch on/off; persist
  `projects.motionPreset`. Customize: per-image direction/amount.
- DoD: stills move with eased, alternating motion; emphasized words get a punch; Off is static.

## III-4. E5 — Caption gallery + Submagic style (rounded active-word box)

- **Model (`renderSpec.ts CaptionFrameModel`):** add
  `highlightBox?: {enabled:boolean; boxColor:string; textColor:string; radius:number;
  padding:number}` and a `wordsPerPage?: number` (generalizes `mode:'word'|'phrase'`). Add a
  `'submagic'` preset id.
- **Renderer (`src/render-worker/captions.ts`):** when `highlightBox.enabled`, measure the
  **active word** (already found via `activeWordInGroup`) and draw a rounded rect (`boxColor`,
  `radius`, `padding`) behind it, then the glyph in `textColor`; keep `highlightColor` for the
  no-box case and the existing pop/scale.
- **Grouping:** `groupWords()` in `electron/services/captions.ts` already controls words per
  group — drive it from `wordsPerPage` (1–3 for Submagic) in the spec builder.
- **Persistence:** `ensureColumn(d,'projects', 'captionBoxColor'|'captionHighlightColor'|
  'captionWordsPerPage', …)`; thread through the spec builder.
- **UI:** `CaptionGallery.tsx` renders each preset live (preview at a t where a caption is on
  screen); inspector exposes highlight text colour, **box colour**, words-per-page, font, size,
  position.
- DoD: "Submagic" shows word-by-word with a coloured rounded box on the active word; box colour
  is editable and renders identically in the final export.

## III-5. E3/E4/E6 — Inspector, Timeline, Quick shell

- **Compose shell (`src/screens/Compose.tsx`):** replace the 4 tabs with `QuickPanel.tsx` (the
  5 rows from §II-G) + a **Customize** toggle that mounts `Inspector.tsx` (contextual to
  selection) and `Timeline.tsx`. Re-bind the *existing* control logic into these components
  (no logic rewrite — they already produce the same project fields).
- **Selection model:** a `selection` state (`'project' | {kind,id}`); the inspector switches on
  it (Resolve pattern). Timeline tracks: Visual (image/b-roll blocks), Captions (groups), Look
  span, Audio waveform; clicking a block sets `selection` and seeks the preview.
- Remove the `beta` gating for the now-core controls; keep API-key fields for stock B-roll.
- Coachmarks + plain-language labels per §11; first-open gated by an `app_meta` marker.

## III-6. New IPC surface (add in `electron/ipc/compose.ts` + `register.ts` + preload + `useData`)

```
compose:previewSpec(projectId, draftOverrides) -> GpuRenderSpec
compose:posterFrame(path)                      -> dataURL
compose:updateLook(projectId, {lut,strength,adjust})
compose:updateMotion(projectId, {preset, perImage?})
compose:updateCaptions(projectId, {preset,boxColor,highlightColor,wordsPerPage,...})
looks:list()                                   -> [{id,name,defaultStrength}]
```
All persisted fields are additive `ensureColumn`s on `projects`; the final render already reads
the project, so honouring them in `buildGpuRenderSpec()` makes preview == export.

## III-7. Risk / performance
- One shader pass per frame at preview size is sub-millisecond; debounce to rAF.
- Preview == export holds **for image segments**; b-roll uses a poster still by design (§II-E).
- WebGL2 fallback: if context creation fails, hide the live canvas and use the existing backend
  `compose.preview` single-frame render.
- Ship behind `features.videoEditorV2`; the LUT stage is a no-op when `grade.lut` is unset, so
  the existing look is unchanged until a user picks one.
