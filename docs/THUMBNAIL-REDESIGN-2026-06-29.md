# Thumbnail page — structural redesign plan (2026-06-29)

Structure-only plan. No CSS, no new features. All existing functionality (Konva canvas,
layer operations, effects, batch generate, original reference) is preserved.

---

## What exists today

```
PageHeader (step label + title + hint)
Toolbar (flat row: Add text | Add shape | Add badge | Auto-arrange | Save | Save template)
3-column workspace grid:
  [TemplateRail 120px] | [Canvas + OriginalRef + hint text] | [LayersPanel + TextLayerEditor]
BatchGenerate section
```

## Problems

1. **Toolbar is ungrouped.** Six actions in a flat row with no visual hierarchy — add-layer
   actions, canvas actions, and save actions all look the same.
2. **TemplateRail is 120px wide** — templates preview at ≈ 100px, too small to be useful.
   The "PROFILE TEMPLATES" label and the "+Save current" button are cramped.
3. **The right panel mixes two things:** `LayersPanel` (which layer is selected) and
   `TextLayerEditor` (editing that layer's content and styling) are both stacked in one
   `border-radius:14px` card. Scrolling through 6+ CollapseSection items is tedious.
4. **Inspector is not context-aware.** It always shows `TextLayerEditor` regardless of
   what layer type is selected. Subject and Background controls are buried under
   `CollapseSection` items inside the text editor — not where users look for them.
5. **OriginalThumbnailReference is an afterthought** — appended below the canvas as a
   plain card with no spatial relationship to the canvas above it.
6. **BatchGenerate** is a wide section at the bottom with a 6-column micro grid for
   results. Visually disconnected from the rest of the studio workflow.
7. **No clear save affordance.** "Save thumbnail" is in the Toolbar top bar. After
   spending time editing, users have to scroll up to find it.

---

## Proposed structure

```
┌────────────────────────────────────────────────────────────────────────┐
│  PAGE HEADER                                                           │
│  Thumbnail Studio  ·  [Gaslighting Explained]       [💾 Save]  [⋯]   │
│  Subject & style auto-saves into your profile template.               │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────┬──────────────────────────────┬────────────────────┐
│  LEFT PANEL        │  CANVAS                       │  RIGHT INSPECTOR   │
│  (240px)           │  (flex 1, min-width:0)        │  (300px)           │
│                    │                               │                    │
│  ┌──────────────┐  │  ┌────────────────────────┐  │  ┌──────────────┐  │
│  │ [Layers][Tmpl]│  │  │                        │  │  │ SELECTED     │  │
│  ├──────────────┤  │  │   Konva Canvas          │  │  │ Headline     │  │
│  │ ▒ Background│  │  │   (16:9, full width)    │  │  ├──────────────┤  │
│  │ ▦ Subject   │  │  │                        │  │  │              │  │
│  │ T Headline  │◄─┤  │                        │  │  │  Context-    │  │
│  │ ◯ Badge     │  │  └────────────────────────┘  │  │  aware       │  │
│  ├──────────────┤  │                               │  │  controls    │  │
│  │ + Text       │  │  COMPARE BAR                  │  │  (see below) │  │
│  │ + Shape      │  │  ┌────────────┬────────────┐  │  │              │  │
│  │ + Badge      │  │  │ ◎ Canvas  │ 📺 Original│  │  │              │  │
│  └──────────────┘  │  │ (preview)  │ (YouTube)  │  │  │              │  │
│                    │  └────────────┴────────────┘  │  └──────────────┘  │
│  [Auto-arrange ★]  │                               │                    │
└────────────────────┴──────────────────────────────┴────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│  BATCH EXPORT  (collapsible, closed by default)                        │
│  [▶ Batch export · same template · one title per line]                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Panel-by-panel breakdown

### Page header

```
Thumbnail Studio  ·  Gaslighting Explained (project context)
Subject & style save into your profile template.
                          [Auto-arrange ✦]   [💾 Save thumbnail]   [⋯ More]
```

- Show the active project title so the user knows which video's thumbnail they're making.
- Move "Save thumbnail" here (from the toolbar) — it's the primary CTA and should
  be the most visible element after the canvas.
- "More" (⋯) dropdown holds: Save as profile template, Reset canvas, Export PNG.

### Left panel — Layers & Templates (240px, tab-switched)

Two tabs: **Layers** and **Templates**.

**Layers tab:**
```
LAYERS                                           [+]
──────────────────────────────────────────────────
▒  Background                              👁  ⧉
▦  Subject                                 👁  ⧉
T  Headline ← (bold, selected)             👁  ⧉
◯  Badge                                   👁  ⧉
──────────────────────────────────────────────────
[+ Text]  [+ Shape]  [+ Badge]
```

- Layer rows: glyph + name + visibility toggle + duplicate (no delete clutter here —
  move delete to the inspector so it requires intent, not a mis-click).
- "+" button per row type at the bottom of the panel, always visible.
- "Auto-arrange type" button moves here (was in the Toolbar). It acts on layers, so it
  belongs near the layers panel.
- Selected layer highlighted with accent border.

**Templates tab:**
```
PROFILE TEMPLATES
──────────────────────────────────────────────────
┌─────────┐  ┌─────────┐
│ [preview│  │ [preview│
│  16:9]  │  │  16:9]  │
│ Name    │  │ Name    │
└─────────┘  └─────────┘
──────────────────────────────────────────────────
[＋ Save current as template]
```

- 2-column grid with proper preview size (~110px wide thumbnails) instead of the
  narrow 120px single-column rail.
- Each template card has an ×-delete in the top-right corner.
- "Save current" button at the bottom of this tab — no scrolling required.

### Canvas center (flex 1)

The canvas itself is unchanged. What changes is what lives **below** it.

**Compare bar** — replaces the current "OriginalThumbnailReference" afterthought:
```
┌─────────────────────────────────────────────────────────────┐
│  [◎ Your design]  [📺 Original]                   quality ▾ │
│  ──────────────────────────────────────────────────────────  │
│  [Left: canvas preview 16:9] | [Right: original 16:9]        │
└─────────────────────────────────────────────────────────────┘
```

Two tabs: "Your design" (rasterized preview of current layers) and "Original" (the
YouTube source thumbnail, same `OriginalThumbnailReference` component). The side-by-side
comparison makes it trivial to judge whether the new thumbnail is better than the original.

**Canvas hint** stays as a small text below the compare bar.

### Right inspector — context-aware (300px)

The inspector header shows what is selected. Its content changes based on selection type.

**Nothing selected / Background layer selected:**
```
CANVAS
─────────────────────────────────────────────
Tip: click a layer on the canvas or in the
panel to start editing.
Background quick-swatches: ■ ■ ■ ■
[⇪ Upload image background]
Gradient scrim: [toggle]  size · opacity
```

**Text layer selected:**
```
SELECTED · HEADLINE
─────────────────────────────────────────────
[Text content textarea — prominent, 3 rows]

▸ Typography
  Per-line size sliders · Line height

▸ Highlighted words
  Word chips (click to toggle) + custom input
  Square bg toggle · Color swatches

▸ Effects  [CAPS]  [Reset]
  Drop shadow (FxControl)
  Stroke (FxControl)
  Glow (FxControl)

[🗑 Delete layer]  (at the bottom)
```

**Subject layer selected:**
```
SELECTED · SUBJECT
─────────────────────────────────────────────
[⇪ Replace subject · PNG — prominent button]

▸ Effects
  Outline (FxControl)
  Drop shadow (FxControl)
  Glow (FxControl)

[🗑 Delete layer]
```

**Shape layer selected:**
```
SELECTED · BADGE/SHAPE
─────────────────────────────────────────────
Fill color · swatches + custom
Opacity slider

[🗑 Delete layer]
```

This eliminates the current problem of Background and Subject controls being buried
inside the TextLayerEditor — every layer type shows only what's relevant to it.

### Batch Export (collapsible section below workspace)

```
▶ Batch export  ·  same template · one title per line   [Closed by default]
```

When expanded:
```
┌────────────────────────────────────────────────────────────────┐
│  [Titles textarea]              [Batch generate from titles →] │
│                                                                │
│  Results grid (4 columns, larger — ~160px wide thumbnails)     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │ [16:9]   │ │ [16:9]   │ │ [16:9]   │ │ [16:9]   │         │
│  │ Title    │ │ Title    │ │ Title    │ │ Title    │         │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘         │
└────────────────────────────────────────────────────────────────┘
```

Closed by default — most sessions don't use batch export. Collapsed state shows the
section header as a clickable row. Results grid switches from 6 to 4 columns so each
preview is actually usable (currently 6 columns produces ~130px thumbnails on a
1440px-wide content area — too small to judge quality).

---

## Summary of structural changes

| Element | Current | Proposed |
|---|---|---|
| Template rail | 120px single column on the left | Tab in the left panel, 2-col grid |
| Toolbar | Flat row of 6 actions | Removed; actions distributed contextually |
| "Add layer" buttons | In the Toolbar at the top | Bottom of the Layers tab |
| "Auto-arrange" | In the Toolbar | Bottom of the Layers tab |
| "Save thumbnail" | In the Toolbar | Page header (primary CTA) |
| "Save template" | In the Toolbar | Bottom of the Templates tab |
| Layer inspector | Always TextLayerEditor | Context-aware by layer kind |
| Background controls | Inside TextLayerEditor > CollapseSection | Background inspector (shown when background is selected) |
| Subject controls | Inside TextLayerEditor > CollapseSection | Subject inspector (shown when subject is selected) |
| Original thumbnail | Below canvas, standalone card | Compare bar tab, side by side with design preview |
| Batch generate | Wide full-width section, 6-col micro grid | Collapsible section, 4-col grid |
| Delete layer | In the LayersPanel rows | Bottom of each inspector panel |
