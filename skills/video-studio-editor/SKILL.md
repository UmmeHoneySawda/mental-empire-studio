---
name: video-studio-editor
description: Drive, extend, or debug the Compose tab's Remotion timeline editor in Mental Empire Studio. Use when adding a panel, preset, timeline operation, or clip kind; when the preview is blank, laggy, or shows a composition error; or when an external agent needs to make edits programmatically. Covers the renderer-owned state model, the live Player contract, and the playwright-cli CDP loop that is the only test harness for this feature.
---

# Video Studio editor

The timeline editor behind Compose → **Remotion**. Lives in
`src/features/video-studio/editor/`. Classic and HyperFrames still use the older
`src/features/video-studio/` studio; do not change their behaviour when working here.

## The one rule

**The renderer owns the project.** An edit is a synchronous, local transformation of
`project` (a `VideoProject`); `<Player>` reads that same object, so the picture changes on
the same tick. Persistence is a debounced whole-document save afterwards.

The editor this replaced did the opposite — every edit was an `await
ipcRenderer.invoke(...)` whose response replaced the project and invalidated a separately
staged preview. That is why one dragged clip cost a dozen writes and nothing appeared until
a rebuild finished. Do not reintroduce a "build preview" step.

Corollary: **never `await` an IPC call on the edit path.** If an operation genuinely needs
the engine (transcription, b-roll download, template instantiation, canvas retime, render),
it is a `runEngine` call whose result replaces local state via `adopt()`, and it must
`await flush()` first so a pending debounced save cannot overwrite the engine's version.

## Module map

| File | Owns |
|---|---|
| `constants.ts` | Timeline geometry, zoom steps, `framesToPx`/`pxToFrames`, `timecode`. Frames are the only stored unit; pixels are derived per render. |
| `operations.ts` | Pure `VideoProject → VideoProject` edits: move, trim, split, remove, duplicate, add, ripple, track ops, snapping, `placementFrame`, `trackAcceptsScene`. No React, no IPC. |
| `useEditor.ts` | Zustand store. `edit(fn)` is the only local-edit funnel; `runEngine` wraps every IPC call; `flush()` forces a pending save. Undo/redo are whole-document snapshots, capped at 60. |
| `assetUrl.ts` | Renderer mirror of the main process's `projectForPreview`. Rewrites `file:` → `mestudio://`. |
| `EditorPlayer.tsx` | The `<Player>`. Renders the production `RemotionVideo` composition from live state. |
| `PreviewStage.tsx` | Fitted canvas + transport + save indicator. |
| `Timeline.tsx` | Ruler, lanes, clips, playhead, drag/trim gestures. |
| `MediaBin.tsx` | Asset rail; click to place, drag-and-drop to import. |
| `Inspector.tsx` | All nine panels. |
| `presets.ts` | Preset tables (transitions, grades, palettes, gradients, text styles, canvas sizes). Data only. |
| `editor.css` | Scoped to `.ve`. kimu's structure and dark scale, Studio's amber accent. |

## Adding things

**A preset** — add a row to the table in `presets.ts`. Nothing else. Presets are data so a
new one costs one line, not a component.

**A timeline operation** — a pure function in `operations.ts`, then a thin action in
`useEditor.ts` that calls `edit()`. Respect the engine's invariants (clips inside the
canvas, `durationFrames` positive, no transition longer than either neighbour, no dangling
transition after a delete) or the debounced save will be rejected by the zod schema.

**A panel** — a component in `Inspector.tsx`, an id in `PanelTab`, a row in `TABS` in
`EditorShell.tsx`.

**A clip kind** — extend `SceneKindSchema` in `shared/video-engine/model.ts`, handle it in
`SceneContent` (`video-engine/remotion/scene.tsx`), give it a tone in `clipTone` and a
colour in `editor.css`, and teach `trackAcceptsScene` which lanes may hold it.

**A template** — register it in `electron/services/video-engine/templates/builtins.ts`.
Preflight refuses any scene whose template is not installed, and an invalid project blanks
the whole preview, so an unregistered id is not a soft failure.

## Traps that have already cost time

- **`TransitionSeries` validates children by type identity.** Every child must literally be
  `TransitionSeries.Sequence` / `.Transition` / `.Overlay`. A `<Fragment>` wrapper, or a
  custom component that merely *renders* a `TransitionSeries.Transition`, throws and blanks
  the composition — in the Player and in a headless render. This is why
  `remotionTransition(transition, key)` is a factory you **call**, never JSX you nest.
- **`backgroundThrottling: false` is required** on the window (`electron/main.ts`). Chromium
  backgrounds a window it thinks is occluded: `document.visibilityState` becomes `hidden`
  and `requestAnimationFrame` stops firing, so a Player that drives playback off rAF goes
  black while the OS window looks perfectly visible.
- **`img-src` in the CSP does not include `file:`** (`index.html`), though `media-src` does.
  Every asset must go through `mestudio://` — that is what `assetUrl.ts` is for.
- **Adding clips at the playhead stacks them.** Use `placementFrame`, or clicking three
  stills gives three clips at frame 0, perfectly overlapping and individually unclickable.
- **Hold the DOM node in the gesture ref, don't re-query it.** Looking a clip up by
  `[data-clip=…]` mid-drag can apply an inline width to the wrong element and leave it there.
- **Drag commits once, on release.** Mid-gesture the transform is written straight to the
  element. Routing 60 pointermoves a second through the store re-renders the whole editor.

## Testing: playwright-cli over CDP only

No unit tests and no smoke harness for this feature — it is driven live, by hand, against
the real app. Wiring bugs (a dead preload method, a panel that throws on mount, a
composition that renders nothing) are invisible to a green build and to unit tests.

```bash
npm run build
node scripts/studio-live.mjs --port 9222
playwright-cli -s=mes attach --cdp=http://localhost:9222
```

`studio-live.mjs` uses a throwaway `ME_USERDATA_DIR` and seeds one clip, so the real
library in `%APPDATA%\Mental Empire Studio` is never touched.

Three things that will waste your time otherwise:

- The launcher passes `--disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding --disable-background-timer-throttling`. Without them
  every click fails on *"waiting for element to be visible, enabled and **stable**"*.
- A scratch profile is a first run, so the FIRST RUN modal swallows clicks until dismissed
  with `Skip`.
- **Run playwright-cli from PowerShell.** Git Bash rewrites `/regex/i` arguments into
  `C:/Program Files/Git/regex/i`, so `find --regex` silently matches nothing.

Prefer `getByRole('button', { name: … })` over snapshot refs — refs go stale on re-render.
Sidebar nav items are `div[role=button]`.

Useful probes:

```js
// Does the composition actually paint?
document.querySelectorAll('.__remotion-player img, .__remotion-player video').length
// Did the composition throw? (the fallback shows the real message)
document.querySelector('.ve-player-error')?.innerText
// What is on disk right now?
await window.api.videoEngine.project('remotion-<downloadId>')
```

## Driving the editor from an external agent

Deferred by request — no server is implemented. When it is wanted, the seam already exists
and needs no new editor code:

- `operations.ts` is pure and headless: an agent can transform a `VideoProject` with no
  browser at all.
- `window.api.videoEngine.saveProject(projectId, project)` commits a whole document, with
  `id` / `rendererId` / `revision` / `createdAt` taken from disk so a stale copy cannot
  rewind the file.
- The editor reloads a project with `useEditor.getState().reload()`.

The cheapest real implementation is a localhost HTTP server in the **main** process
(alongside `electron/ipc/`) exposing `GET /project/:id`, `POST /project/:id` (validated by
`VideoProjectSchema`), and `GET /templates`, then a `reload()` push over the existing event
bridge so an external edit appears in the open editor. Keep it bound to `127.0.0.1`, keep
the zod validation at the boundary, and do not accept a `revision` from the client.
