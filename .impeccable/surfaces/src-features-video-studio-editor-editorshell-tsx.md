---
version: 1
slug: "src-features-video-studio-editor-editorshell-tsx"
primary_target: "src/features/video-studio/editor/EditorShell.tsx"
related_targets: ["src/screens/Compose.tsx","src/features/video-studio/editor/editor.css","src/features/video-studio/editor/PreviewStage.tsx","src/features/video-studio/editor/Timeline.tsx"]
---

# Scope and mode

- Surface: active Video Studio editing workspace.
- Mode: Operate.
- Audience: independent faceless-YouTube creators working repeatedly at a desktop workstation.
- Job: find media, judge the current frame, adjust the selected production treatment, make timeline edits, preview, and render without losing project state.
- Primary action: Render. Secondary exit: save and choose another video.
- Constraints: preserve all ten inspector panels, media import/cycle actions, transport and loop controls, timeline editing, undo/redo, fast preview, render progress, project/runtime/save status, and responsive access.

# Chosen direction

- Approved comp: `.impeccable/mocks/video-studio-focus-deck.png`.
- Seed: `509e3e94`.
- Final reviewer disposition: **PASS**.
- Direction: Focus Deck — one compact command bar, a narrow media shelf, an authoritative central stage, a contextual inspector with a vertical mode index, and a full-width inlaid timeline.
- Memorable moment: a restrained amber edit spine links active inspector mode, current stage edge, selected clip, and playhead without becoming decoration.

# Composition contract

- Command bar: 56px, project identity and format left/center, save and edit actions right.
- Work area: 190–220px media shelf, fluid stage, 300–330px inspector; rails collapse before the stage at constrained widths.
- Inspector: a compact vertical mode rail containing all ten existing panels, plus one scrollable contextual panel; the current mode remains explicit.
- Timeline: a full-width inlaid lower deck occupying 32–38% of editor height, with fixed track labels, clear edit/zoom tool grouping, and stronger ruler and selected-clip hierarchy.
- Responsive: at narrow editor widths, the media shelf collapses first; inspector tabs reduce before any capability disappears; action groups wrap without horizontal overflow.

# Implementation fidelity inventory

| Ingredient | Commitment | Medium |
| --- | --- | --- |
| Video Studio/project command bar | One semantic heading, project name, format/fps/duration, runtime status, save state, choose-video, undo/redo, preview and render | Existing React state + semantic HTML/CSS |
| Media shelf | Existing import, filter, image-cycle controls, asset list and remove/place actions; denser one-column visual list | Existing `MediaBin` + CSS |
| Preview stage | Largest upper-region surface, quiet neutral surround, exact existing Remotion output and transport | Existing `PreviewStage`/Player + CSS; no raster replacement |
| Inspector mode rail | All ten existing tabs, vertical index, current mode emphasized with one amber edge | Existing tab state + semantic tablist/CSS |
| Inspector content | Clear panel title, scrollable controls, durable project/progress footer | Existing `Inspector` + CSS |
| Timeline | Existing split/duplicate/delete/snap/zoom/add-track controls and all track/clip operations; visually inlaid and precise | Existing `Timeline` markup + CSS |
| Edit spine | Small functional current-edit notch plus active-mode/selected-clip/playhead alignment | CSS pseudo-elements and existing selection state |
| Media imagery | Real project media remains authoritative in the stage and shelf; generated demo imagery is not shipped | Existing player/assets |
| Timeline clip imagery | Retain lightweight tone-coded clips and existing labels instead of generated thumbnail strips or added decoding work | Accepted fidelity translation for performance |

# Component grammar

- Corners: 4–8px for editor controls and media, never oversized capsules.
- Lines: 1px quiet graphite dividers; amber edges only for current focus/selection.
- Elevation: tonal planes first, one restrained stage shadow, no glass or glow fields.
- Type: Space Grotesk for the one screen name/project emphasis, Hanken Grotesk for controls, JetBrains Mono for timecode/specs.
- Motion: only short hover/focus/state transitions; reduced motion remains honored.

# Unresolved decisions

None. The Focus Deck implementation passed final review with all existing editor functionality preserved. These composition decisions are specific to the Video Studio surface and do not amend the global visual system in `DESIGN.md`.
