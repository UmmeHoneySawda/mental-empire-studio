# Compose page — structure port from the new UI/UX prototype (2026-06-29)

Goal: make the Compose screen **follow the structure** used in the new prototype
(`mental-empire-studio-uixUpdate/compose.html`), **without changing any current design or
CSS**, and **without adding features**. Reuse the existing components/styles verbatim;
only rearrange them into the prototype's structure.

## What the prototype uses (structure)

The prototype's Compose page uses a **4-tab bar**:

```
Audio + Image | Captions | Style | Advanced
```

Its **Captions** tab (the only one with content in the export) contains, in order:
PRESET grid · Font · Animation · Aspect · Lines · Position · Pace · Keywords · Punch ·
PREVIEW pane (with Render preview) · TRANSCRIPT (word-level) · WORD TIMELINE.

## What the app has today

The app's Compose has only **2 tabs** (`Audio + Image`, `Captions`). The Captions tab's
left column also contains a **`BetaPanel`** ("CUSTOMIZE · BETA") that bundles two distinct
groups:
- **Style** controls: Hook, Auto-highlight, Background overlay, Auto-zoom, Auto B-roll,
  and the "Style (transitions & text effects)" grid.
- **Advanced** control: the "Effect plan (advanced override)" (master-prompt / Groq / JSON).

The app's Captions tab already matches the prototype's Captions structure (preset, font,
animation, aspect, lines, position, pace, keywords, punch, preview, transcript, timeline).

## The only structural delta → the fix

Split the existing `BetaPanel` into the prototype's two extra tabs, so the tab bar becomes
the prototype's 4 tabs. **No styling changes** — the exact same markup/style objects move
into the new tab panels.

1. **`src/store/useStore.ts`** — widen the tab union:
   `type ComposeTab = 'media' | 'captions' | 'style' | 'advanced'`.
2. **`src/screens/Compose.tsx`**
   - Widen the `Tab` component's `id` prop to the new union; add **Style** and **Advanced**
     tab buttons to the existing tab bar (same `Tab` component, same styles, simple inline
     SVG icons in the existing style).
   - Remove `<BetaPanel />` from the **Captions** tab's left column (so Captions matches the
     prototype: PRESET card + settings card + preview + transcript only).
   - Replace `BetaPanel` with two panels built from its **existing** JSX/styles:
     - **`StyleTab`** = Hook · Auto-highlight · Background overlay · Auto-zoom · Auto B-roll ·
       Style grid (everything except the Effect plan section).
     - **`AdvancedTab`** = the Effect plan (advanced override) section.
     - Both keep the existing `CUSTOMIZE · BETA` header and the same `betaOn` gating
       (opacity/pointer-events + "Enable in Settings → Beta").
   - Update the render switch in `Compose()` to map all four tabs.
   - Lift the small `Row` helper out of `BetaPanel` to module scope so both panels reuse it.
   - Wrap each new tab's panel in a width-constrained container so the (originally
     narrow-column) controls keep their intended proportions — a layout wrapper only, no
     change to any component's own CSS.

## Explicitly NOT changed (per steering)

- No palette/token/CSS edits anywhere (`tokens.css`, `global.css`, `primitives.tsx`
  untouched). Colors, borders, fonts, spacing of existing components stay exactly as-is.
- No new features, no logic/data-flow changes — the same controls, handlers, and store
  actions; only their tab placement changes.
- MediaTab, CaptionPreview, transcript/timeline, preview render — unchanged.

## Validation
- `npm run typecheck`, `npm run build`, `npm test` must stay green.
- Manual: all four tabs switch; Style/Advanced show the same controls as the old beta panel
  and remain gated by Settings → Beta; Captions tab no longer shows the beta panel.
