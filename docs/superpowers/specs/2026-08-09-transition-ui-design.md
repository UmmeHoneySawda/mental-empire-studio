# Transition UI Redesign

## Goal Description
Redesign the Transitions panel in the Video Studio editor (`Inspector.tsx`) to offer a "CapCut-style" tactile experience without altering the underlying timeline architecture. The new design shifts from a text-heavy vertical list of presets to a dedicated "Active Transition" control surface featuring a duration slider and a visual grid of selectable presets.

## Architecture & Components

### 1. The "Active Transition" Section
- **Location:** Top of the `TransitionsPanel`.
- **Purpose:** Display the currently applied transition for the selected join.
- **UI Elements:**
  - A highlighted card showing the transition's icon and name.
  - A real-time **Duration Slider** mapped to the transition's `durationFrames` property (e.g., from 0.1s up to the maximum allowable overlap, likely bounded by the clips' actual lengths or a reasonable maximum like 3.0s).
  - The duration slider sends `applyTransition` commands to the `videoEngine` when adjusted, updating the length dynamically.

### 2. Transition Presets Grid
- **Location:** Below the Active Transition section.
- **Purpose:** Allow users to swap the transition type.
- **UI Elements:**
  - A 2-column or 3-column dense grid of preset cards.
  - Each card contains an SVG icon representing the transition type (e.g., scissors for Cut, overlapping squares for Crossfade, arrows for Slide).
  - Clicking a preset applies it to the active join(s) using its default duration, which can then be adjusted using the slider above.

### 3. State Management
- `project.transitions` remains the source of truth.
- `TransitionsPanel` will compute the "active transition" based on the currently selected clip(s) and their joins (`targetPairs`).
- If multiple joins are selected and they have different transition types/lengths, the UI will handle it gracefully (e.g., showing a "Mixed" state or applying changes to all selected joins).

## Data Flow & Integration
- The redesign only changes the rendering in `Inspector.tsx` and adds some CSS to `editor.css`.
- It relies entirely on the existing `window.api.videoEngine.applyTransition` method to persist changes to the project state.
- No changes to `better-sqlite3` models, `Timeline.tsx` rendering, or `shared/types.ts` are strictly required, though adding an icon field to `TRANSITION_PRESETS` in `shared/video-engine/transition-presets.ts` may be considered if it helps keep the UI clean.

## Error Handling & Constraints
- The maximum duration on the slider must not exceed the shortest clip involved in the join (or half the shortest clip, depending on engine constraints), to prevent invalid states.
- If no transition is applied (i.e., a Cut), the duration slider is disabled and set to 0.

## Scope
This spec strictly covers the right-hand Inspector panel UI for transitions. It intentionally avoids making transitions selectable entities on the actual timeline.
