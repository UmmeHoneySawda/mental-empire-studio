# Thumbnail Editor UX Redesign — Concrete, Code-Grounded Plan

Status: PROPOSAL (for review)
Date: 2026-06-30
Author: product/UX
Scope: **only the thumbnail editor** (`src/screens/Thumbnails.tsx`,
`src/features/thumbnail-editor/*`, the `ThumbnailLayer`/`TextLayer` model, and the
thumbnail store slice in `src/store/useStore.ts`). This is the third plan, following the
workflow redesign (PR #17) and the video-editor redesign (PR #18).

> Same premise the user set for the whole app: **this is an automation tool a beginner can
> drive — gorgeous defaults, with everything customizable one layer deeper. The functionality
> mostly exists; UX is the problem.** Verified in code below. And the same instruction:
> **research how other editors do it in their code.** Because this editor is already built on
> **Konva** (`ThumbCanvas.tsx`, `render.ts`), every gap the user hit — multi-select, inline
> line breaks, resize-on-canvas, a real highlight box — is a *well-trodden Konva pattern*, not
> new technology. Section 7 maps each fix to the exact code touchpoint.

---

## 0. TL;DR — the user's four complaints, and how each is fixed

| The user said | Root cause in code | The fix (and it's small) |
|---|---|---|
| "I can't select multiple layers" | `selectedLayerId: string` — a single id; Konva click sets one | `selectedLayerIds: string[]` + shift/ctrl-click + rubber-band; `Konva.Transformer` natively takes **multiple nodes** (§3.1) |
| "I can't use a line break on a text layer" | The `lines[]` model *is* multi-line, but you edit it in a **side textarea** labelled "one line per row" — not on the canvas | Inline on-canvas editing via a DOM textarea overlay (the canonical Konva pattern); **Enter = new line** (§3.2) |
| "make a line bigger / line-gap slider / word highlighter… it's too dumb, make it easier" | Text has **no resize handles** (drag-only); sizing is per-line sliders + a "1.12×" line-height; highlighting is word-chips | **Resize text by dragging a handle**; one friendly size + "Line spacing" control; **select text → Highlight** like Canva; plus a floating selection toolbar (§3.3) |
| "for the text square highlight I can't change the box color" | In `drawText`, the box is painted with `l.highlightColor` and the text on it is **hardcoded `#111111`** — no independent box colour exists | Model a proper **text highlight/background** (Canva-style): separate **box colour**, **text-on-box colour**, **roundness**, **padding**, **opacity** (§3.4) |

Plus the things that make any editor *feel* premium and which are currently missing:
**undo/redo**, **drag-to-reorder layers**, **snapping/alignment guides**, **real template
previews** (today they're fake gradients), and **arrow-key nudge/align**. (§4)

---

## 1. The current editor (verified in code)

A solid 3-panel skeleton already exists in `Thumbnails.tsx`:
- **Left:** tabs for **Layers** (add Text/Shape/Badge, visibility, duplicate, delete,
  Auto-arrange) and **Templates**.
- **Centre:** the **Konva** `ThumbCanvas` (1280×720, scaled to fit) + a **CompareBar** that
  shows *your design* vs the *original YouTube thumbnail* — a genuinely good feature.
- **Right:** a context-aware **`LayerInspector`** (different controls for text / subject /
  shape / background) with good effect controls (shadow/stroke/glow with size/opacity/colour,
  background scrim).

The data model (`shared/types.ts`) is reasonable: `TextLayer` with `lines:{text,size}[]`,
`highlightWords[]`, `highlightColor`, `highlightSquare`, `effects{shadow,stroke,glow,caps}`,
`lineHeight`; `SubjectLayer` (PNG + outline/shadow/glow); `ShapeLayer`; `BackgroundLayer`
(+scrim). The renderer (`render.ts`) draws everything in Konva and rasterizes to PNG, shared
between the live editor and batch export.

So the **bones are good** — the problems are interaction-level and a couple of concrete model
gaps.

## 1.1 The precise gaps (so the fixes are unambiguous)
- **Single selection only.** `useStore` holds `selectedLayerId: string`. `ThumbCanvas` adds a
  `Konva.Transformer` to *one* node, and only for `subject`/`shape` (text is excluded).
- **Text isn't resizable on the canvas.** Comment in `ThumbCanvas`: text is "drag-only to
  avoid reflow loss." So the only way to size text is the side sliders.
- **Line breaks are hidden.** `LayerInspector` text editing is a side `<textarea>` whose value
  is `lines.map(l=>l.text).join('\n')` with the label "Text (one line per row)." Double-click
  on canvas just *focuses that side textarea* (`requestFocusTextEditor`) instead of editing in
  place. Users don't discover that Enter makes a line.
- **Highlight box colour is not independent.** In `render.ts > drawText`:
  `fill = isHi && highlightSquare ? '#111111' : isHi ? highlightColor : color`, and the box
  rect is `fill: l.highlightColor`. So the **box uses the highlight colour** and the **text on
  the box is hardcoded dark `#111111`** — there is literally no field for a separate box
  colour. This is the user's complaint, exactly.
- **No undo/redo, no layer reordering, no snapping, no align/distribute, no keyboard nudge.**
- **Template thumbnails are fake.** `TemplatesTab` renders a placeholder gradient + a bar, not
  a real preview — so picking a template is blind (same "opaque preset" problem as the video
  styles).
- **Highlighting is whole-word, all-instances.** `highlightWordsFor` normalizes words into a
  Set, so you can't highlight one occurrence or a partial phrase.

---

## 2. How world-class design editors do this (in their code)

Researched against the tools whose model fits a layer-based thumbnail canvas. Content was
paraphrased for compliance; sources linked inline and in §8.

- **Konva itself already supports everything the user is missing.** The official demos show
  click-to-select, **Shift/Ctrl to add/remove from a selection**, and **rubber-band area
  select**, with a `Transformer` that resizes/rotates ([Konva select & transform demo](https://www.konvajs.org/docs/select_and_transform/Basic_demo.html));
  a `Konva.Transformer` can be attached to **multiple nodes at once** and transforms them as a
  group ([transform multiple shapes](https://codepen.io/lavrton/embed/dwGPBz?)). For text,
  Konva's recommended approach is **inline editing via a DOM `<textarea>` overlaid at the
  text's position**, where Enter inserts a newline and blur/Enter commits
  ([Konva editable text](https://konvajs.org/docs/sandbox/Editable_Text.html)). **So
  multi-select, group transform, and inline line-breaks are first-party Konva patterns — the
  app simply hasn't wired them.**

- **Polotno — a Konva-based Canva-style editor — is the direct architectural reference.**
  It's an opinionated React component set for building canvas editors, **built on top of
  Konva.js**, with toolbar, side panels, templates, multi-select and a rich text element
  ([Polotno overview](https://polotno.com/docs/overview),
  [built on Konva](https://polotno.com/blog/modern-canvas-editor-upgrade)). Open-source
  siblings to mine for patterns: [OpenPolotno](https://github.com/therutvikp/OpenPolotno) and
  a Konva/fabric [canva-clone](https://github.com/Davronov-Alimardon/canva-clone) (template
  customization, text/shape manipulation, even AI background removal). The lesson: our 3-panel
  layout is right; we just need to bring the *interactions* up to this bar.

- **Canva's text highlight is the exact model for the box-colour fix.** Canva exposes a text
  **Background** effect with its **own colour swatch plus roundness, spread, and transparency
  sliders** ([Canva highlight: roundness/spread/transparency + colour](https://www.storylane.io/tutorials/how-to-highlight-words-in-canva)).
  That's precisely the structure to adopt: a highlight/background that owns its colour,
  corner-radius, padding, and opacity, independent of the text colour.

- **Floating selection toolbar (Canva/Figma).** Both put the most-used controls (size, colour,
  highlight, alignment, duplicate) in a small toolbar that appears **next to the selection**,
  so common edits don't require a trip to a side panel. We adopt this for the "make it easier"
  ask.

**Synthesis:** keep the existing Konva/3-panel foundation; adopt Konva's own multi-select +
inline-text patterns, Canva's text-background model, and a Canva/Figma floating toolbar — and
add the table-stakes editor affordances (undo, reorder, snapping) that make it feel finished.

---

## 3. The fixes for the four complaints (concrete)

### 3.1 Multi-select + group operations
**Model:** replace `selectedLayerId: string` with `selectedLayerIds: string[]` in `useStore`
(keep a `selectedLayerId` getter = `ids[0]` for back-compat with the inspector).
**Canvas (`ThumbCanvas`):**
- Click = select one; **Shift/Ctrl-click** = add/remove; click empty = clear — the Konva demo
  behaviour.
- **Rubber-band**: drag on empty canvas draws a selection `Rect`; on mouseup, select every
  layer whose bounds intersect it (Konva `haveIntersection`).
- Attach **one `Konva.Transformer` to all selected nodes** → move/scale/rotate as a group.
- Now **include text layers** in the transformer (see §3.3).
**Operations unlocked:** group drag, group delete/duplicate, and a new **Align/Distribute**
row (left/center/right/top/middle/bottom, distribute h/v) — trivial geometry once you have
N selected frames. Also **group/lock** selection.
**Layers panel:** show multi-selection state; Shift-click ranges.

### 3.2 Inline line breaks (edit text on the canvas)
Adopt Konva's editable-text pattern: **double-click a text layer → overlay a styled DOM
`<textarea>` exactly over it** (same font, size, colour, position via the stage transform);
typing updates live; **Enter inserts a real line break**, Esc cancels, blur/⌘Enter commits
back into `lines[]` (split on `\n`). This makes line breaks obvious and direct, and removes
the confusing "one line per row" side textarea (keep it in the inspector as a secondary/large
edit, but it's no longer the only way). The multi-line `lines[]` model already supports this —
we're only changing *where* you type.

### 3.3 "Make it easier": resize on canvas + simpler text controls + select-to-highlight
- **Resize text by dragging.** Include text in the Transformer; dragging a corner scales the
  layer's font size(s) proportionally (map `scaleX` → multiply each `lines[i].size`, then reset
  scale to 1 — the same commit pattern already used for subject/shape in `ThumbCanvas`). This
  is how every design tool sizes text; "make a line bigger" becomes "drag the handle."
- **Demote the fiddly controls.** In the inspector, lead with **one Size control for the whole
  block** + a friendly **"Line spacing"** slider (label in plain words, not "1.12×"); move
  per-line size to an "Advanced / per-line" disclosure for the rare case. Auto-arrange stays as
  a one-click "tidy up."
- **Select-to-highlight (Canva-style).** While editing text inline, **select a word/phrase and
  hit Highlight** (in the floating toolbar) → adds it to `highlightWords` (or a richer range;
  see §3.4). Keep the word-chip toggles as a secondary path. This kills the "too dumb" feeling
  of hunting through chips.
- **Floating selection toolbar.** On any selection, show a small toolbar near it: Size,
  Colour, **Highlight**, B/CAPS, Align, Duplicate, Delete — the Canva/Figma convention — so the
  common 80% never needs the side panel.

### 3.4 Independent highlight box colour (the exact bug)
Model a real text highlight, mirroring Canva's Background effect. Extend `TextLayer`:
```ts
highlight?: {
  enabled: boolean        // replaces/extends highlightSquare
  boxColor: string        // the box fill — INDEPENDENT (the missing control)
  textColor: string       // text on the box — replaces hardcoded '#111111'
  radius: number          // corner roundness  (Canva "roundness")
  padding: number         // box spread around the glyph (Canva "spread")
  opacity: number         // box transparency (Canva "transparency")
}
```
Keep `highlightColor` (no-box coloured text) and `highlightWords` as-is; `highlightSquare`
maps to `highlight.enabled` for legacy templates (the existing `normalizeThumbnailLayer`
coercion is the right place to migrate it). **Render change in `render.ts > drawText`:** when a
word is highlighted *and* `highlight.enabled`, draw a `Konva.Rect` with `fill: highlight.boxColor`,
`cornerRadius: highlight.radius`, padding from `highlight.padding`, `opacity: highlight.opacity`,
and set the glyph `fill: highlight.textColor` (instead of `highlightColor` for the box and
`#111111` for the text). Inspector: a **Highlight** section with **box colour**, **text colour**,
roundness, padding, opacity — the Canva control set. Small, additive, fully backward-compatible.

---

## 4. The "feels finished" layer (what makes it premium, currently absent)

These aren't in the four complaints but are *why* it "feels dumb," and are cheap on Konva:
- **Undo/redo.** Add a history stack in the thumbnail store (push a snapshot of `layers` on each
  committed mutation; ⌘Z/⌘⇧Z). Essential for confidence; nothing exists today.
- **Drag-to-reorder layers** in the Layers panel (z-order = array order today, but unreorderable).
- **Snapping + smart guides** when dragging/resizing (snap to canvas center, edges, title-safe
  inset, and other layers) — Konva has a standard guideline-snapping approach; pairs with the
  existing dashed title-safe overlay.
- **Keyboard:** arrow-nudge (Shift = 10px), ⌘D duplicate, Del delete, ⌘A select-all,
  Esc deselect.
- **Real template previews.** Render each template via `rasterizeLayers` into a thumbnail (and
  cache) so the Templates tab is WYSIWYG instead of a fake gradient — same fix as the video
  style gallery.
- **Easy subject handling.** Don't lock the subject by default so it can be moved/replaced
  without friction; (optional, *new* functionality) an "auto cut-out / remove background" action
  like the canva-clone reference — flagged as enhancement, not core.

---

## 5. Automation-first framing (a beginner never has to open this)

Consistent with the rest of the app: the thumbnail is **produced automatically** for each video
from the channel's locked template — the headline auto-fills from the video title (the batch
path's `withHeadline()` already does title→balanced lines) and the subject/background come from
the template. So:
- **Quick path (default):** the produced thumbnail just appears in the pipeline. If the user
  opens the studio, they land on a **real template gallery** (WYSIWYG previews) + the live
  preview + the CompareBar against the original — pick a template, maybe swap the subject PNG,
  done.
- **Customize:** the full layer editor (multi-select, inline text, highlight, effects, align).
  Never required.
- **Great defaults:** ship several strong templates (full-bleed, subject-left/right, centered)
  with sensible highlight/eff defaults so "change nothing" already looks good.

This keeps the promise: noob-friendly by default, infinitely customizable underneath.

## 6. Quick-mode layout (beginner-first)

```
┌──────────────────────────────────────────────────────────────┐
│ STEP 03 — THUMBNAIL · <video title>          [ Save thumbnail ]│
├───────────────┬───────────────────────────────┬───────────────┤
│ TEMPLATES      │  CANVAS (Konva, drag/resize)  │  INSPECTOR     │
│ (real previews)│  + floating selection toolbar │  (contextual;  │
│  ▦ ▦ ▦ ▦       │                               │   leads with   │
│                │  ◎ Your design | 📺 Original  │   the few most │
│ + Layers tab   │  (CompareBar — keep)          │   used controls)│
│   (drag-reorder)│                              │                │
└───────────────┴───────────────────────────────┴───────────────┘
  ⌘Z undo · ⌘⇧Z redo · arrows nudge · shift/ctrl-click multi-select · double-click text to edit
```

---

## 7. Control → code touchpoint map (proof it's mostly small + additive)

| Fix | Where it changes | New tech? |
|---|---|---|
| Multi-select | `useStore.selectedLayerId` → `selectedLayerIds[]`; `ThumbCanvas` shift/ctrl + rubber-band; Transformer `nodes:[...]` | No — Konva built-in |
| Group move/align/distribute | new align ops over selected `frame`s; group drag via Transformer | No |
| Inline line breaks | `ThumbCanvas` dblclick → textarea overlay; commit split on `\n` into `lines[]` | No — Konva pattern |
| Resize text on canvas | include text node in Transformer; map scale→`lines[i].size` (same commit as subject/shape) | No |
| Simpler size/spacing | `LayerInspector` text section reorg; plain-language labels + Advanced disclosure | No |
| Select-to-highlight | inline selection → `highlightWords`; floating toolbar | No |
| **Highlight box colour** | add `TextLayer.highlight{boxColor,textColor,radius,padding,opacity}`; update `drawText`; inspector section; migrate `highlightSquare` in `normalizeThumbnailLayer` | tiny model + render change |
| Undo/redo | history stack in thumbnail store | small |
| Drag-reorder layers | `LayersTab` DnD → reorder `layers[]` | small |
| Snapping/guides | `ThumbCanvas` dragmove guideline calc | small (standard Konva) |
| Real template previews | `TemplatesTab` uses `rasterizeLayers` (already exists) + cache | trivial |

No engine rewrite anywhere — the renderer (`render.ts`) and the Konva foundation stay; we wire
interactions the library already supports and make two additive model fields.

---

## 8. Phased rollout (each ships independently)

- **T1 — Highlight box colour + inline line breaks.** The two most concrete complaints; both
  small. Add `TextLayer.highlight{…}` + `drawText` change + inspector; add the inline textarea
  overlay. *Immediate, visible wins.*
- **T2 — Multi-select + group ops.** `selectedLayerIds[]`, shift/ctrl + rubber-band,
  multi-node Transformer, align/distribute, group delete/duplicate.
- **T3 — Resize text on canvas + simpler text controls + floating toolbar.** The "make it
  easier" ask.
- **T4 — Undo/redo + drag-reorder + snapping/guides + keyboard nudge.** The "feels finished"
  layer.
- **T5 — Real template previews + automation polish + great default templates** (and optional
  subject auto-cutout).

Rough effort: T1 ≈ 1–2d · T2 ≈ 2–3d · T3 ≈ 2–3d · T4 ≈ 3d · T5 ≈ 2–3d. T1+T2+T3 resolve all
four stated complaints; T4 is what makes it feel premium.

## 9. Open questions

1. **Highlight scope** — keep "highlight matches whole words (all instances)" as the default,
   or move to true **selection-range** highlighting (one occurrence/partial phrase)? (Range is
   more powerful but a bigger model change — `highlightWords[]` → highlighted character ranges.)
2. **Subject auto-cutout** — want AI background removal added (new functionality), or keep
   "supply a transparent PNG"?
3. **Per-line sizing** — happy to demote it to Advanced (lead with one block size), or do you
   actively use different sizes per line as the primary control?
4. **Template set** — how many built-in templates, and any specific looks you want shipped?

## 10. Sources

Paraphrased/summarized for compliance; short factual phrases only.
- Konva interactions: [select & transform demo](https://www.konvajs.org/docs/select_and_transform/Basic_demo.html),
  [transform multiple shapes](https://codepen.io/lavrton/embed/dwGPBz?),
  [editable text](https://konvajs.org/docs/sandbox/Editable_Text.html).
- Konva-based editor architecture: [Polotno overview](https://polotno.com/docs/overview),
  [Polotno built on Konva](https://polotno.com/blog/modern-canvas-editor-upgrade),
  [OpenPolotno](https://github.com/therutvikp/OpenPolotno),
  [canva-clone](https://github.com/Davronov-Alimardon/canva-clone).
- Canva text highlight/background model: [roundness/spread/transparency + colour](https://www.storylane.io/tutorials/how-to-highlight-words-in-canva),
  [Effects → Background](https://adventureswithart.com/how-to-highlight-text-in-canva/).
