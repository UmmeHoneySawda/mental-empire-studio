# Scope and mode

- Surface: active Video Studio editing workspace.
- Mode: Operate.
- Audience: independent faceless-YouTube creators working repeatedly at a desktop workstation.
- Job: find media, judge the current frame, adjust the selected production treatment, make timeline edits, preview, and render without losing project state.
- Primary action: Render. Secondary exit: save and choose another video.
- Constraints: preserve all ten inspector panels, media import/cycle actions, transport and loop controls, timeline editing, undo/redo, fast preview, render progress, project/runtime/save status, and responsive access.

# Chosen direction

- Approved comp: `.impeccable/mocks/video-studio-focus-deck.png`.
- Approval: delegated by the user's explicit autonomous-choice instruction.
- Direction: Focus Deck — one compact command bar, a narrow media shelf, an authoritative central stage, a contextual inspector with a vertical mode index, and a full-width inlaid timeline.
- Memorable moment: a restrained amber edit spine links active inspector mode, current stage edge, selected clip, and playhead without becoming decoration.

# Composition contract

- Command bar: 52–58px, project identity and format left/center, save and edit actions right.
- Work area: 190–220px media shelf, fluid stage, 300–330px inspector; rails collapse before the stage at constrained widths.
- Inspector: a compact vertical mode rail containing all ten existing panels, plus one scrollable contextual panel.
- Timeline: 32–38% of editor height, fixed track labels, clear edit/zoom tool grouping, stronger ruler and selected-clip hierarchy.
- Responsive: at narrow editor widths, media hides first; inspector tabs reduce before any capability disappears; action groups wrap without horizontal overflow.

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
| Media shown inside generated comp | North-star demonstration only; actual project media remains authoritative | Existing player/assets; do not ship generated imagery |
| Timeline thumbnail strips in comp | Do not add decoding work; retain lightweight tone-coded clips and existing labels | Accepted fidelity translation for performance |

# Component grammar

- Corners: 4–8px for editor controls and media, never oversized capsules.
- Lines: 1px quiet graphite dividers; amber edges only for current focus/selection.
- Elevation: tonal planes first, one restrained stage shadow, no glass or glow fields.
- Type: Space Grotesk for the one screen name/project emphasis, Hanken Grotesk for controls, JetBrains Mono for timecode/specs.
- Motion: only short hover/focus/state transitions; reduced motion remains honored.

# Unresolved decisions

None. Keep generated media imagery out of production and preserve current feature behavior exactly.
