# Video Editor UI Wholesale Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Port the completed `D:\Work\video-editor` interface wholesale into the open-project
Video Studio while retaining the current editor's real state, operations, persistence,
preview, automation, and render behavior.

**Architecture:** Preserve the reference editor's DOM hierarchy and stylesheet geometry in a
namespace-scoped workspace layer. Replace its mock state at component boundaries with small
typed adapters over `useEditor`, `useData`, and `useVideoStudio`; keep existing preview,
inspector, media, and timeline implementations as the behavioral cores. The normal app shell
continues to own project selection, while an open Compose project hides the global sidebar
and occupies the available desktop content area.

**Tech Stack:** Electron 32, React 18, TypeScript 5.6, Zustand 4, Remotion 4.0.502, Vitest 2,
Playwright 1.49, CSS, `lucide-react` 1.30.0, self-hosted Archivo Variable 5.3.0.

## Global Constraints

- Work from `29c6db59d9188366fb0e46c4399720ddbf2a5259`; do not introduce
  `d27ac816dd2a6b9eade255b8f34e9ea4fa12da84`.
- UI migration only: do not change IPC, database, services, providers, Remotion composition,
  render options, effects, presets, or project persistence semantics.
- `D:\Work\video-editor\src\App.tsx`, `src\styles.css`, `src\data.ts`, and `DESIGN.md` are the
  visual authority.
- Use real `useEditor`/`useData`/`useVideoStudio` state; no mock timers, fake projects, or fake
  job completion in production UI.
- Keep the title bar for native window controls. Hide only the global product sidebar while
  an open Compose project renders the immersive editor.
- Below 1024px show the desktop-width requirement; do not compress the production editor.
- Unsupported complicated actions remain visible, disabled, and explained.
- Preserve current keyboard shortcuts, undo history, flush-before-close, track stacking,
  B-roll preview paths, and live Remotion preview behavior.
- Do not commit, stage, push, or open a PR unless the user separately authorizes it.

---

### Task 1: Typed UI Mapping and Dependency Foundation

**Files:**

- Create: `src/features/video-studio/editor/editorUiModel.ts`
- Create: `test/unit/video-engine/editor-ui-model.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/main.tsx`

**Interfaces:**

- Produces: `EditorDestination`, `AutomationDestination`, `EditActionId`,
  `panelForDestination(destination)`, `panelForAutomation(destination)`,
  `editActionState(action, hasClip, snapEnabled)`, and
  `isImmersiveVideoStudio(screen, hasProject)`.
- Consumes: existing `PanelTab` from `useEditor.ts`.

- [ ] **Step 1: Write the failing mapping tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  editActionState,
  isImmersiveVideoStudio,
  panelForAutomation,
  panelForDestination
} from '../../../src/features/video-studio/editor/editorUiModel'

describe('video editor UI model', () => {
  it('maps reference destinations to existing editor panels', () => {
    expect(panelForDestination('media')).toBe('media')
    expect(panelForDestination('text')).toBe('text')
    expect(panelForDestination('transitions')).toBe('transitions')
    expect(panelForDestination('effects')).toBe('effects')
    expect(panelForDestination('filters')).toBe('grade')
    expect(panelForDestination('adjust')).toBe('grade')
    expect(panelForDestination('automation')).toBeNull()
  })

  it('maps every Sparkle item to a real existing workflow', () => {
    expect(panelForAutomation('broll')).toBe('broll')
    expect(panelForAutomation('images')).toBe('media')
    expect(panelForAutomation('captions')).toBe('captions')
    expect(panelForAutomation('hooks')).toBe('hook')
  })

  it('enables only actions backed by current editor operations', () => {
    expect(editActionState('split', true, true).enabled).toBe(true)
    expect(editActionState('delete', false, true).enabled).toBe(false)
    expect(editActionState('snap', false, true)).toMatchObject({ enabled: true, active: true })
    expect(editActionState('link', true, true).reason).toBe('Not available in this editor version')
    expect(editActionState('group', true, true).enabled).toBe(false)
    expect(editActionState('keyframe', true, true).enabled).toBe(false)
  })

  it('uses immersive layout only for an open Compose project', () => {
    expect(isImmersiveVideoStudio('compose', true)).toBe(true)
    expect(isImmersiveVideoStudio('compose', false)).toBe(false)
    expect(isImmersiveVideoStudio('home', true)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts --reporter=dot
```

Expected: FAIL because `editorUiModel.ts` does not exist.

- [ ] **Step 3: Implement the minimal typed model**

```ts
import type { PanelTab } from './useEditor'

export type EditorDestination =
  | 'media' | 'automation' | 'text' | 'transitions' | 'effects' | 'filters' | 'adjust'
export type AutomationDestination = 'broll' | 'images' | 'captions' | 'hooks'
export type EditActionId = 'select' | 'split' | 'trim' | 'delete' | 'link' | 'group' | 'snap' | 'keyframe'

const PANELS: Record<Exclude<EditorDestination, 'automation'>, PanelTab> = {
  media: 'media', text: 'text', transitions: 'transitions', effects: 'effects',
  filters: 'grade', adjust: 'grade'
}

export const panelForDestination = (destination: EditorDestination): PanelTab | null =>
  destination === 'automation' ? null : PANELS[destination]

export const panelForAutomation = (destination: AutomationDestination): PanelTab => ({
  broll: 'broll', images: 'media', captions: 'captions', hooks: 'hook'
})[destination]

export function editActionState(action: EditActionId, hasClip: boolean, snapEnabled: boolean) {
  if (action === 'snap') return { enabled: true, active: snapEnabled, reason: '' }
  if (action === 'select') return { enabled: true, active: true, reason: '' }
  if (action === 'split' || action === 'delete') {
    return { enabled: hasClip, active: false, reason: hasClip ? '' : 'Select a clip first' }
  }
  if (action === 'trim') {
    return { enabled: hasClip, active: false, reason: hasClip ? 'Drag either clip edge to trim' : 'Select a clip first' }
  }
  return { enabled: false, active: false, reason: 'Not available in this editor version' }
}

export const isImmersiveVideoStudio = (screen: string, hasProject: boolean): boolean =>
  screen === 'compose' && hasProject
```

- [ ] **Step 4: Add the reference-only UI dependencies and self-hosted font import**

Run:

```powershell
npm install --save-exact lucide-react@1.30.0 @fontsource-variable/archivo@5.3.0
```

Add to `src/main.tsx` before application styles:

```ts
import '@fontsource-variable/archivo'
```

- [ ] **Step 5: Verify GREEN and dependency integrity**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: 4 tests pass and typecheck exits 0.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check -- package.json package-lock.json src/main.tsx src/features/video-studio/editor/editorUiModel.ts test/unit/video-engine/editor-ui-model.test.ts`.

---

### Task 2: Immersive Compose Shell

**Files:**

- Modify: `src/app.tsx`
- Modify: `src/screens/Compose.tsx`
- Modify: `src/features/video-studio/editor/editor.css`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- Consumes: `isImmersiveVideoStudio(active, Boolean(activeProject))` from Task 1.
- Produces: `.is-video-studio-immersive` application layout and `.video-editor-screen`
  project-open root.

- [ ] **Step 1: Extend the failing layout test**

Add an exhaustive matrix assertion:

```ts
expect([
  ['compose', true, true],
  ['compose', false, false],
  ['sources', true, false],
  ['thumbnails', true, false]
].map(([screen, project]) => isImmersiveVideoStudio(String(screen), Boolean(project)))).toEqual([
  true, false, false, false
])
```

Temporarily change the helper to return `false`, run the focused test, and confirm this new
assertion fails; restore the correct helper before modifying the app shell.

- [ ] **Step 2: Wire App to real project state**

In `App`, subscribe to `activeProject`, compute `immersiveEditor`, keep `TitleBar`, conditionally
render `Sidebar`, and switch the main region to non-scrolling editor ownership:

```tsx
const activeProject = useData((state) => state.activeProject)
const immersiveEditor = isImmersiveVideoStudio(active, Boolean(activeProject))

<div className={immersiveEditor ? 'me-app is-video-studio-immersive' : 'me-app'}>
  <TitleBar />
  <div className="me-app-body">
    {!immersiveEditor && <Sidebar />}
    <main
      id="main-content"
      className={immersiveEditor ? 'me-main is-video-studio-immersive' : 'me-main'}
    >
      {/* existing ready/error boundary */}
    </main>
  </div>
</div>
```

Preserve the current startup banner, Suspense, ErrorBoundary, onboarding, and background
behavior exactly.

- [ ] **Step 3: Make Compose preserve the picker and yield open-project layout ownership**

Keep the existing picker branch. For the project branch, remove outer page padding/header
and let `EditorShell` fill the available area. Move Choose another video into the new project
switcher callback passed to `EditorShell`:

```tsx
return project ? (
  <div className="video-editor-screen">
    {error && <Banner kind="error">{error}</Banner>}
    <EditorShell downloadId={project.downloadId} onChooseProject={() => void backToLibrary()} />
  </div>
) : (
  <div className="me-screen">{/* existing picker UI unchanged */}</div>
)
```

- [ ] **Step 4: Add only the shell CSS needed for ownership and overflow**

```css
.me-app.is-video-studio-immersive .me-main {
  overflow: hidden;
}

.video-editor-screen {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 5: Verify focused test, typecheck, and picker preservation**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check -- src/app.tsx src/screens/Compose.tsx src/features/video-studio/editor/editor.css`.

---

### Task 3: Wholesale Reference Chrome, Tool Rail, and Export Surface

**Files:**

- Create: `src/features/video-studio/editor/EditorChrome.tsx`
- Create: `src/features/video-studio/editor/EditorToolPanel.tsx`
- Create: `src/features/video-studio/editor/EditorExportPopover.tsx`
- Create: `src/features/video-studio/editor/reference-editor.css`
- Modify: `src/features/video-studio/editor/EditorShell.tsx`
- Modify: `src/screens/Compose.tsx`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- `EditorChromeProps`: project title, active destination, undo/redo availability, export state,
  project-picker callback, destination callback, undo/redo callbacks, export callback.
- `EditorToolPanelProps`: active destination, active automation destination, close callback.
- `EditorExportPopoverProps`: busy/progress state, Fast Preview callback, Render callback,
  close callback.
- `EditorShellProps`: `downloadId` and `onChooseProject`.

- [ ] **Step 1: Add a failing completeness test for reference destinations**

Export `EDITOR_DESTINATIONS` and `AUTOMATION_DESTINATIONS` from `editorUiModel.ts`, then test:

```ts
expect(EDITOR_DESTINATIONS.map((item) => item.id)).toEqual([
  'media', 'automation', 'text', 'transitions', 'effects', 'filters', 'adjust'
])
expect(AUTOMATION_DESTINATIONS.map((item) => item.id)).toEqual([
  'broll', 'images', 'captions', 'hooks'
])
```

Run the focused test and confirm it fails because the exported lists do not yet exist.

- [ ] **Step 2: Implement the canonical destination metadata**

Define the exact reference labels and Lucide icon components in `EditorChrome.tsx`, while
keeping IDs in `editorUiModel.ts`. Use the reference markup from `TopBar`, `IconButton`, and
`CollapsedRail`; replace `VIDEO EDITOR`/demo project handlers with Mental Empire's real
project title and real callbacks.

- [ ] **Step 3: Port the contextual panel structure**

Copy the reference `left-panel`, `context-flyout`, panel tabs, automation list, and catalog
structure. Set `useEditor.getState().setTab(panel)` through `panelForDestination` and
`panelForAutomation`. Render the existing `MediaBin` or `Inspector` inside the appropriate
reference panel rather than copying mock content.

- [ ] **Step 4: Port and wire the export popover**

Use the reference popover markup and its Format/Resolution summary, but expose only the real
actions:

```tsx
<button onClick={onFastPreview} disabled={busy}>Fast preview</button>
<button className="primary-panel-action" onClick={onRender} disabled={busy}>Render video</button>
```

The callbacks remain the existing `exportFastPreview()` and `enqueueRender()` paths. Real
progress replaces mock notifications.

- [ ] **Step 5: Recompose EditorShell in the exact reference grid**

```tsx
<div className="ve-ui desktop-app" data-engine="remotion">
  <EditorChrome {...chromeProps} />
  <main className="editor-workspace">
    <div className="stage-grid">
      <CollapsedToolRail />
      {panelOpen && <EditorToolPanel />}
      <PreviewStage />
      <aside className="right-inspector"><PropertiesInspector /></aside>
    </div>
    <EditorEditStrip />
    <Timeline />
  </main>
  {exportOpen && <EditorExportPopover />}
  <EditorStatus />
</div>
<DesktopRequired />
```

Keep current editor effects that subscribe to jobs/transcription/B-roll progress and current
keyboard shortcuts unchanged.

- [ ] **Step 6: Port reference CSS with strict namespace scoping**

Copy `D:\Work\video-editor\src\styles.css` into `reference-editor.css`, then apply these
mechanical rules before use:

1. Replace `:root` tokens with `.ve-ui` tokens.
2. Prefix editor selectors with `.ve-ui` or `.video-editor-screen`.
3. Do not copy global `html`, `body`, `#root`, `button`, `input`, or `select` rules; express
   them as `.ve-ui button`, `.ve-ui input`, and `.ve-ui select`.
4. Preserve exact reference values for color, sizing, grid geometry, radius, shadows,
   breakpoints, focus, and reduced motion.
5. Import `reference-editor.css` after existing `editor.css` from `Compose.tsx`.

- [ ] **Step 7: Verify GREEN, typecheck, and CSS containment**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts --reporter=dot
npm run typecheck -- --pretty false
rg -n '^(:root|html|body|button|input|select|\.topbar|\.timeline)' src/features/video-studio/editor/reference-editor.css
```

Expected: tests/typecheck pass; the containment search returns no unscoped selectors.

- [ ] **Step 8: Checkpoint without committing**

Run `git diff --check` on the Task 3 files.

---

### Task 4: Real Media, Transcript, and Sparkle Workflows in the Reference Panels

**Files:**

- Modify: `src/features/video-studio/editor/MediaBin.tsx`
- Modify: `src/features/video-studio/editor/EditorToolPanel.tsx`
- Modify: `src/features/video-studio/editor/Inspector.tsx`
- Modify: `src/features/video-studio/editor/reference-editor.css`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- Produces: `transcriptRows(project)` pure projection with word text and frame boundaries.
- Reuses: `importAssets`, `removeAsset`, `cycleImages`, `setPlayhead`, `setTab`, existing
  Auto B-roll, caption, and hook panel actions.

- [ ] **Step 1: Add a failing transcript-projection test**

```ts
expect(transcriptRows({
  captions: { words: [
    { text: 'Cities', startFrame: 30, endFrame: 42 },
    { text: 'sleep', startFrame: 43, endFrame: 55 }
  ] }
} as never)).toEqual([
  { text: 'Cities', startFrame: 30, endFrame: 42 },
  { text: 'sleep', startFrame: 43, endFrame: 55 }
])
expect(transcriptRows({} as never)).toEqual([])
```

Run and confirm RED because `transcriptRows` is not implemented.

- [ ] **Step 2: Implement the pure transcript projection**

Return only valid non-empty words with finite, ordered frames. Do not mutate captions or
introduce a parallel transcript store.

- [ ] **Step 3: Reshape MediaBin into the reference Media/Transcript panel**

Preserve all existing import, drop, filter, asset placement, image-cycle selection, cycle
execution, and remove handlers. Replace only the outer markup/classes with the reference
panel tabs, import zone, media grid, and metadata treatment. Real asset thumbnails replace
reference sample images.

Transcript word buttons call `setPlayhead(word.startFrame)` and keep the Captions workflow
one click away. Empty captions show a directional empty state instead of sample text.

- [ ] **Step 4: Wire every Sparkle destination to its existing action surface**

- Auto B-roll -> existing `BrollPanel`.
- Image cycling -> existing `MediaBin` full-timeline cycle controls.
- Active captions -> existing `CaptionsPanel`.
- Hook generator -> existing `HookPanel`.

Use real busy/progress/error state; remove reference `setTimeout` analysis simulation.

- [ ] **Step 5: Verify RED/GREEN and existing operation regressions**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts --reporter=dot
npx vitest run test/unit/video-engine/editor-operations.test.ts test/unit/video-engine/auto-broll.test.ts test/unit/video-engine/caption-styles.test.ts test/unit/video-engine/hook-templates.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: all selected suites pass.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check` on the Task 4 files.

---

### Task 5: Reference Preview and Right Inspector Around Existing Behavior

**Files:**

- Modify: `src/features/video-studio/editor/PreviewStage.tsx`
- Modify: `src/features/video-studio/editor/Inspector.tsx`
- Modify: `src/features/video-studio/editor/EditorToolPanel.tsx`
- Modify: `src/features/video-studio/editor/reference-editor.css`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- `Inspector({ tabOverride?: PanelTab })` renders an existing feature panel for the left
  flyout without changing global tab state.
- `PropertiesInspector()` renders existing `ClipProperties` plus project/canvas controls for
  the persistent right inspector.
- `PreviewStage` retains all current store bindings and `EditorPlayer` props.

- [ ] **Step 1: Add a failing preview-options model test**

Add and test:

```ts
expect(previewAspectLabel({ width: 1920, height: 1080 })).toBe('16:9')
expect(previewAspectLabel({ width: 1080, height: 1920 })).toBe('9:16')
expect(previewAspectLabel({ width: 1080, height: 1080 })).toBe('1:1')
```

Run focused test and confirm RED because the helper does not exist.

- [ ] **Step 2: Implement exact aspect-label reduction**

Use integer greatest-common-divisor reduction and return `${width / gcd}:${height / gcd}` for
positive dimensions, otherwise `—`.

- [ ] **Step 3: Port the reference preview markup around EditorPlayer**

Retain `useFittedSize`, `EditorPlayer`, grade filter/tint/vignette preview, loop range, solo
selection, save state, and real playhead. Replace only chrome with the reference
`preview-region`, `preview-stage`, and `transport-bar` hierarchy. Previous/next frame buttons
call `setPlayhead(playheadFrame - 1/+1)` with existing bounds.

- [ ] **Step 4: Split Inspector presentation without changing panel behavior**

Export the existing property and panel renderers through two small public functions:

```tsx
export function Inspector({ tabOverride }: { tabOverride?: PanelTab } = {}): JSX.Element | null {
  const storeTab = useEditor((state) => state.tab)
  return panelForTab(tabOverride ?? storeTab)
}

export function PropertiesInspector(): JSX.Element {
  return <CanvasPanel />
}
```

Do not rewrite `ClipProperties`, Canvas, Templates, Hook, Text, Captions, Transitions, Grade,
Effects, B-roll, or Export business logic.

- [ ] **Step 5: Match the reference inspector tabs and control geometry**

Use `Video` for current clip/project controls and `Basic` for canvas/project details within
the same existing `CanvasPanel` content. If separating a subsection would duplicate state or
operations, keep the content in `Video` and make `Basic` a local visual tab over the remaining
project fields only.

- [ ] **Step 6: Verify preview-path and caption behavior**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts test/unit/video-engine/preview-path.test.ts test/unit/video-engine/caption-styles.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 7: Checkpoint without committing**

Run `git diff --check` on the Task 5 files.

---

### Task 6: Reference Editing Strip With Honest Availability

**Files:**

- Create: `src/features/video-studio/editor/EditorEditStrip.tsx`
- Modify: `src/features/video-studio/editor/EditorShell.tsx`
- Modify: `src/features/video-studio/editor/reference-editor.css`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- Consumes: current selection, `splitAtPlayhead`, `removeSelectedClips`, `toggleSnap`, `zoom`,
  and `setZoom`.
- Uses: `editActionState` from Task 1 for enabled/disabled/active status.

- [ ] **Step 1: Add failing assertions for every reference edit action**

```ts
expect(EDIT_ACTIONS.map((action) => action.id)).toEqual([
  'select', 'split', 'trim', 'delete', 'link', 'group', 'snap', 'keyframe'
])
```

Run and confirm RED because `EDIT_ACTIONS` is not yet exported.

- [ ] **Step 2: Implement the reference action strip**

Use the reference markup and Lucide icons. Wire:

- Select -> clear selection / return to selection mode.
- Split -> `splitAtPlayhead()`.
- Trim -> enabled only for a selected clip and sets the existing notice
  `Drag either edge of the selected clip to trim it.`
- Delete -> `removeSelectedClips()`.
- Snap -> `toggleSnap()` and active styling.
- Link, Group, Keyframe -> disabled with `Not available in this editor version`.

The existing Ctrl/Cmd+D duplicate shortcut remains active even though Duplicate is not part
of the reference strip.

- [ ] **Step 3: Wire zoom without adding timeline state**

Bind the reference range and +/- buttons to `zoom` and `setZoom`, clamped by the current
store. Do not add a second zoom state.

- [ ] **Step 4: Verify action model and existing operations**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts test/unit/video-engine/editor-operations.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: all tests/typecheck pass.

- [ ] **Step 5: Checkpoint without committing**

Run `git diff --check` on the Task 6 files.

---

### Task 7: Wholesale Timeline Visual Port Over Existing Timeline Operations

**Files:**

- Modify: `src/features/video-studio/editor/Timeline.tsx`
- Modify: `src/features/video-studio/editor/editor.css`
- Modify: `src/features/video-studio/editor/reference-editor.css`
- Test: `test/unit/video-engine/editor-operations.test.ts`
- Test: `test/unit/video-engine/editor-ui-model.test.ts`

**Interfaces:**

- Keeps: current `useEditor` state, pointer capture, multi-select, drag, trim, snap,
  track reordering, mute/lock, zoom, playhead seeking, overlap diagnostics, and operations.
- Produces: reference timeline DOM classes and exact 166px control gutter geometry.

- [ ] **Step 1: Add a failing semantic track-style test**

Add `timelineTrackTone(track, scene)` to `editorUiModel.ts`, then test real semantic mapping:

```ts
expect(timelineTrackTone({ kind: 'audio' } as never, undefined)).toBe('audio')
expect(timelineTrackTone({ kind: 'overlay', name: 'Captions' } as never, undefined)).toBe('caption')
expect(timelineTrackTone({ kind: 'video', name: 'Auto B-roll' } as never, undefined)).toBe('broll')
expect(timelineTrackTone({ kind: 'video', name: 'Main video' } as never, undefined)).toBe('main')
```

Run and confirm RED because the helper does not exist.

- [ ] **Step 2: Implement semantic presentation only**

Return a CSS tone identifier from track kind/name/scene kind. Do not alter track order,
scene z-index, or render data.

- [ ] **Step 3: Reshape Timeline markup to the reference hierarchy**

Retain all existing event handlers and geometry calculations. Change the rendered hierarchy
to reference ruler, row, controls, track lane, clip, handle, waveform, playhead, and hidden
track classes. Use real track names, real scene labels, real thumbnails, and real durations.

- [ ] **Step 4: Apply exact reference timeline geometry**

Port reference declarations for:

- 28px ruler.
- 166px fixed track gutter.
- dense track heights by content type.
- graphite lanes and dividers.
- purple captions, green audio, amber hooks, thumbnail visual clips.
- cobalt selection, trim handles, playhead, snap/active states.
- internal horizontal and vertical scrolling only.

Preserve pointer hit targets and the current `TRACK_LABEL_WIDTH`/pixel-frame calculations;
update the UI constant to 166 only if the current value differs, and rerun its tests.

- [ ] **Step 5: Verify exact protected behaviors**

Run:

```powershell
npx vitest run test/unit/video-engine/editor-operations.test.ts test/unit/video-engine/preview-path.test.ts test/unit/video-engine/remotion-media-mute.test.ts test/unit/video-engine/caption-styles.test.ts --reporter=dot
npm run typecheck -- --pretty false
```

Expected: track reordering, caption foreground behavior, external B-roll preview paths,
muting, and caption styling tests all pass.

- [ ] **Step 6: Checkpoint without committing**

Run `git diff --check` on the Task 7 files.

---

### Task 8: Responsive, Copy, and Accessibility Audit

**Files:**

- Modify: `src/features/video-studio/editor/reference-editor.css`
- Modify: UI files from Tasks 3–7 only where an audit finds a concrete issue.
- Test: `scripts/e2e-studio.mjs`

**Interfaces:**

- Produces: stable selectors `data-testid="video-editor-workspace"`,
  `data-testid="video-editor-preview"`, `data-testid="video-editor-timeline"`, and
  `data-testid="video-editor-export"` for verification only.

- [ ] **Step 1: Add E2E assertions before final polish**

Extend the existing Remotion studio E2E after project open:

```js
await page.getByTestId('video-editor-workspace').waitFor()
await page.getByTestId('video-editor-preview').waitFor()
await page.getByTestId('video-editor-timeline').waitFor()
await page.getByRole('button', { name: 'Undo' }).waitFor()
await page.getByRole('button', { name: 'Export' }).click()
await page.getByTestId('video-editor-export').waitFor()
```

Do not run Electron yet; the required user-data backup happens first in Task 9.

- [ ] **Step 2: Correct all reference placeholder copy and inconsistent labels**

Search only the ported UI files:

```powershell
rg -n '\?\?\?|Lorem|Project menu opened|Undid last edit|mock|sample' src/features/video-studio/editor src/screens/Compose.tsx
```

Expected: no production placeholder/demo copy.

- [ ] **Step 3: Audit interaction semantics**

Verify icon buttons have accessible names, destination buttons expose current state, panel
tabs use tab/tabpanel roles, progress uses status/live-region semantics, disabled controls
have explanations, and keyboard focus remains visible.

- [ ] **Step 4: Verify responsive CSS in the browser harness**

At 1600x1000, 1260x800, and 1100x720, verify the full editor has no document overflow and
the preview/timeline remain visible. At 1023x720 verify only the desktop-width requirement is
visible. Use Playwright screenshots under a temporary directory, not tracked output.

- [ ] **Step 5: Compare against the running reference at matching viewports**

Start `D:\Work\video-editor` and Mental Empire's browser renderer on separate local ports.
Capture the same viewport and compare topbar height, stage columns, inspector width, edit
strip height, timeline gutter, color tokens, type, and breakpoints. Fix only measurable
differences in the ported UI.

- [ ] **Step 6: Run cheap verification**

Run:

```powershell
npm run typecheck -- --pretty false
git diff --check
```

Expected: both exit 0.

- [ ] **Step 7: Checkpoint without committing**

Update `PROGRESS.md` with the visual comparison results and exact remaining verification.

---

### Task 9: Full Functional and Remotion Verification

**Files:**

- Modify: `PROGRESS.md`
- Modify: ported UI/test files only if verification exposes a reproducible defect.

**Interfaces:**

- Consumes the complete UI port.
- Produces fresh executable evidence for user-visible behavior without modifying render logic.

- [ ] **Step 1: Run the required user-data backup before any Electron launch**

Run:

```powershell
npm run userdata:backup
```

Expected: timestamped backup path and checksum verification. Stop if backup fails.

- [ ] **Step 2: Run focused editor suites**

```powershell
npx vitest run test/unit/video-engine/editor-ui-model.test.ts test/unit/video-engine/editor-operations.test.ts test/unit/video-engine/preview-path.test.ts test/unit/video-engine/auto-broll.test.ts test/unit/video-engine/caption-styles.test.ts test/unit/video-engine/hook-templates.test.ts test/unit/video-engine/remotion-transition-chains.test.ts --reporter=dot
```

Expected: all selected tests pass.

- [ ] **Step 3: Run project-level verification**

```powershell
npm run typecheck -- --pretty false
npm run build
npm test -- --reporter=dot
```

Expected: exit 0 for typecheck/build and zero failing tests.

- [ ] **Step 4: Run Electron E2E with disposable data**

Set a verified throwaway absolute directory for `ME_SMOKE_USERDATA_DIR`, then run the existing
Remotion studio E2E. The script must exercise project open, preview, timeline selection,
split/delete/undo, track reorder, automation entry points, export surface, and project close.

Expected: E2E OK, no renderer console errors, no live user data touched.

- [ ] **Step 5: Apply the requested Remotion best-practices review**

Load and apply the relevant Remotion references for app/player interactivity and markup.
Confirm:

- one existing `EditorPlayer` instance remains the preview authority;
- the Player receives the live project and frame state;
- UI playback/seeking does not create a second render timeline;
- timeline edits continue through existing editor operations and save funnel;
- preview/timeline UI changes did not alter composition, render options, or asset resolution;
- reduced motion affects editor chrome only, not deterministic rendered content.

- [ ] **Step 6: Inspect the final diff and protected areas**

Run:

```powershell
git status --short
git diff --stat
git diff --name-only
git diff --check
```

Verify no files under `electron/`, `video-engine/remotion/`, render services, providers,
effects/presets, or database code changed.

- [ ] **Step 7: Update the durable checkpoint**

Update `PROGRESS.md` with changed files, focused/full verification counts, browser viewport
results, Electron backup path, E2E result, Remotion review conclusion, and any honest blocker.

- [ ] **Step 8: Final handoff without committing**

Report the implemented UI, important mapping decisions, files changed, fresh verification,
disabled unsupported controls, and any remaining issue. Do not claim completion unless every
required command and user-visible check has fresh evidence.
