# Video Editor UI Wholesale Port Design

## Objective

Replace the open-project Video Studio interface with the completed UI from
`D:\Work\video-editor` while preserving Mental Empire Studio's existing editor behavior and
all Remotion project, timeline, automation, preview, and render semantics.

The repository remains based on commit
`29c6db59d9188366fb0e46c4399720ddbf2a5259`. Commit
`d27ac816dd2a6b9eade255b8f34e9ea4fa12da84` is outside the working state and must not be
introduced.

## Chosen Approach

Port the reference mockup wholesale as the visual implementation. Its final React markup,
CSS geometry, Archivo typography, icons, media presentation, responsive breakpoints, and
interaction styling are the visual source of truth.

The mockup's simulated application state is not a source of truth. Demo timers, hard-coded
project data, fake notifications, and sample-only mutations will be replaced at the same UI
boundaries by the existing `useEditor`, `useData`, and `useVideoStudio` state and actions.
The result should look like the reference application but behave like the current editor.

## Scope Boundary

This is a renderer UI migration only.

- Do not change IPC contracts, database repositories, provider services, render workers,
  Remotion compositions, render flags, effects implementations, caption presets, hook
  presets, B-roll selection, or project persistence semantics.
- Do not add cloud dependencies or new API requirements.
- Existing keyboard shortcuts, debounced saving, undo/redo history, job progress, preview
  path handling, and timeline stacking behavior must remain intact.
- The normal application shell and project picker remain visible when no project is open.
- While a Video Studio project is open, the editor becomes an immersive content workspace;
  the global sidebar is not shown. Returning to the picker restores the normal shell.

## Visual Source of Truth

The following reference artifacts are authoritative:

- `D:\Work\video-editor\src\App.tsx`
- `D:\Work\video-editor\src\styles.css`
- `D:\Work\video-editor\src\data.ts`
- `D:\Work\video-editor\public\assets\`
- `D:\Work\video-editor\DESIGN.md`

The port retains the reference's 52px application bar, top destination controls, compact
left contextual rail, optional 250px flyout, preview-centered stage, 270px right inspector,
39px editing strip, 166px timeline gutter, low-radius controls, graphite surface hierarchy,
and restrained cobalt selection/action language.

Archivo remains self-hosted using `@fontsource-variable/archivo`. No CDN font is permitted.
Reference styles must be namespace-scoped to the Video Studio workspace so they cannot
override unrelated application screens.

## Host Composition

### Project Gate

`src/screens/Compose.tsx` continues to own project selection, project opening, safe close,
renderer status probing, and the choose-another-video flow. Its empty, loading, and error
states remain within the normal application shell.

### Immersive Editor Root

When a project is open, Compose renders a full-available-area editor root using the
reference `desktop-app` structure:

1. Top application bar.
2. Stage row containing the contextual tools, real preview, and real inspector.
3. Editing action strip.
4. Real project timeline.
5. Floating export surface and transient status feedback when needed.

The reference DOM structure and class geometry should be retained wherever it does not
conflict with accessibility or the existing state boundaries.

### Top Application Bar

- Project title comes from the active Remotion project.
- Project switching invokes the existing flush-before-close flow.
- Undo and redo use the existing editor history.
- Export opens the reference popover, with real Fast Preview and Render actions.
- Render/preview progress and disabled states reflect existing jobs and busy state.
- Top destinations route to existing panels: Media, Text, Transitions, Effects, and
  Filters/Adjust (the existing Grade panel).
- Sparkle opens the automation surface for B-roll, captions, and hooks.

### Contextual Left Surface

- Media displays the existing imported project assets and import action through `MediaBin`.
- Transcript is derived from the current project's caption/transcript data and seeks or
  selects existing timed material; it does not create a separate transcript model.
- Text, Transitions, Effects, Grade/Adjust, Captions, B-roll, Hook, and Templates reuse the
  existing inspector panel implementations behind the new shell.
- Sparkle provides entry points to existing Auto B-roll, active caption, and hook-generation
  workflows.
- Image Cycling remains visually present but disabled with a concise explanation unless a
  direct existing editor action is confirmed during implementation.

### Preview and Inspector

The reference preview frame and transport chrome wrap the existing `PreviewStage` /
`EditorPlayer`. Playback, frame seeking, fit behavior, aspect ratio, current time, and
duration come from the existing editor state.

The right inspector uses existing project and selection properties. The new layout must not
invent transform persistence or patch project data outside existing editor operations.
Controls without an existing safe action remain disabled and explain why through a tooltip
or adjacent status text.

### Editing Strip

Existing Select, Split, Delete, Duplicate, Snap/zoom, and timeline-fit behavior are connected
where equivalents exist. Link, Group, Trim mode, or Keyframe controls that lack an existing
operation remain in the reference geometry but are disabled. Disabled controls retain clear
labels and keyboard-inaccessible semantics rather than silently doing nothing.

### Timeline

The existing `Timeline` remains the behavioral implementation for real tracks, clips,
selection, playhead seeking, zoom, drag, trim, reorder, mute, stacking, and scene mutations.
Its visual markup and CSS are reshaped to match the reference timeline: 166px track gutter,
dense ruler, semantic clip colors, thumbnails, waveform treatment, visible trim handles,
cobalt playhead, and grouped disclosure for large track counts.

No reference sample track, fake clip, or simulated generated draft may enter real project
state.

## Unsupported UI Policy

For every reference control, implementation must first search for an existing editor action.

- If an action exists, wire it to the current state/action path.
- If the feature is a small, renderer-local UI behavior with no persistence or backend
  impact, it may be implemented with focused tests.
- If the feature requires new project semantics, backend logic, render behavior, effect
  logic, or a new persistence contract, keep the control visible but disabled.
- Disabled controls use the reference styling at reduced opacity and provide the message
  `Not available in this editor version` or a more specific explanation.

## Responsive and Accessibility Behavior

- At widths above 1260px, preserve the full reference proportions.
- From 1024px through 1260px, use the reference's tighter rail, inspector, and icon-only edit
  controls without hiding existing functionality.
- Below 1024px, replace the production editor with the reference desktop-width requirement;
  do not squeeze the timeline into a mobile layout.
- Prevent horizontal document overflow at all supported widths; timeline lanes may scroll
  within their designated region.
- Preserve visible keyboard focus, correct tab/tabpanel semantics, accessible names for icon
  buttons, status live regions, and reduced-motion behavior.
- Correct any garbled placeholder punctuation and keep all interface copy in consistent
  sentence case.

## Error and Progress Handling

Existing `Banner` semantics remain the authority for blocking errors and success notices.
Long-running Fast Preview, Auto B-roll, transcription, hook generation, and render jobs use
their real progress state. The port must not use simulated timeouts to suggest completion.

When project saving fails, navigation away from the editor remains blocked as it is today.
Disabled or unavailable actions must never fail silently.

## Testing Strategy

Implementation follows focused red-green tests for newly extracted UI adapters and behavior
mappings. Existing project operations are not rewritten merely to make the new shell easier
to test.

Verification layers:

1. Focused unit/component tests for destination mapping, disabled unsupported actions,
   export action mapping, immersive-shell selection, and timeline/preview state adapters.
2. Existing editor operation, caption, B-roll, hook, preview-path, and timeline tests.
3. Renderer typecheck and production build.
4. Browser visual verification against the reference at 1600px, 1260px, 1100px, and the
   1023px desktop-required boundary.
5. Interaction verification for project selection, undo/redo, playback, seeking, clip
   selection, split/delete/duplicate, track reordering, panel destinations, automation entry
   points, Fast Preview, Render, and return-to-picker behavior.
6. Before launching Electron, run `npm run userdata:backup`; any smoke or screenshot launch
   must use a throwaway `ME_SMOKE_USERDATA_DIR`.
7. Final Remotion best-practices review of the real preview and timeline integration. This
   review may identify UI integration defects but must not modify the render pipeline absent
   a measured regression and explicit scope expansion.

## Acceptance Criteria

- The open-project editor is visually faithful to the final `D:\Work\video-editor` mockup.
- The project picker and other application screens keep their existing shell and styling.
- Every enabled control performs a real existing editor action.
- Unsupported complicated controls are visibly and accessibly disabled.
- No fake project data or mock automation completion remains in production UI.
- Existing editor functionality and keyboard shortcuts continue to work.
- No backend, render engine, effect, preset, or provider logic changes.
- Typecheck, build, relevant tests, responsive visual inspection, interaction checks, and the
  final Remotion review pass with fresh evidence.
