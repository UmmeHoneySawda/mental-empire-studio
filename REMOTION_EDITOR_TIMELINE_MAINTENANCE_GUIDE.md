# Remotion Editor, Timeline, and Editing-App Maintenance Guide

**Purpose:** A reusable engineering handbook for diagnosing, repairing, extending, and verifying a browser-based video editor built with React and Remotion.

**Intended use:** Place this file in the project root. Give it to Claude Code, Codex, Cursor, or another repository-aware coding agent whenever the editor, timeline, captions, Text Motion, video hooks, image cycling, preview, persistence, or export needs work.

**Reference-repository inspection date:** 2026-08-02

**Companion document:** `AUTO_BROLL_MAINTENANCE_GUIDE.md`

This guide focuses on the editor and rendering system. For transcript-driven Auto B-roll planning, provider search, ranking, and placement generation, use the companion Auto B-roll guide. Read both only when a defect crosses both systems.

---

## 1. Fast Routing

Do not make an agent read this entire document for every bug.

| Problem | Start here |
|---|---|
| Dragging duplicates an item | Sections 7–9 and 27 |
| Clicking changes visible width but not real duration | Sections 5, 7–9 and 27 |
| Trim handles are wrong | Sections 5, 7, and 8 |
| Split loses captions or B-roll | Sections 5, 8, and 10 |
| Reordering changes timing | Sections 5, 8, and 10 |
| Undo/redo removes the wrong work | Section 11 |
| Save/reload changes the edit | Section 12 |
| Preview and export differ | Sections 13–15 |
| Text Motion does not work | Section 17 |
| Video hooks are ugly or unsafe | Section 18 |
| Caption names or behavior are wrong | Sections 19–21 |
| Images should cycle over the full video | Section 22 |
| Audio, waveforms, or ducking are wrong | Section 23 |
| Long timeline is slow | Section 24 |
| Render jobs hang or lose progress | Section 25 |
| Auto B-roll editor integration is broken | Section 16 plus `AUTO_BROLL_MAINTENANCE_GUIDE.md` |
| Need external repository guidance | Sections 31–42 |

Minimal agent prompt:

```text
Follow AGENTS.md.

Read only the relevant sections of
REMOTION_EDITOR_TIMELINE_MAINTENANCE_GUIDE.md and the Local Application Map.

Observed problem:
<EXACT USER-VISIBLE BEHAVIOR>

Expected:
<EXACT RESULT>

Reproduce or establish evidence before editing. Trace the user gesture,
committed command, project state, derived timeline placement, persistence,
Player preview, and Remotion export only as far as this defect requires.

Apply the smallest safe fix, add focused regression coverage, and update
PROGRESS.md plus the guide's Local Application Map when paths or architecture
change.

Treat the guide's repository analysis as sufficient. Do not clone or reread
every reference repository unless one exact missing detail is required.

Do not commit or push unless explicitly authorized.
```

---

## 2. Scope

This guide covers:

- editor architecture;
- project and timeline models;
- packed and free-placement tracks;
- source time, clip-local time, project time, frames, milliseconds, and pixels;
- playhead, seeking, selection, and inspectors;
- pointer gestures;
- dragging, reordering, trimming, splitting, snapping, and resizing;
- clip-anchored captions and B-roll;
- Text Motion;
- opening video-hook templates;
- caption data, paging, timing, and styling;
- image cycling;
- audio, music, ducking, and waveforms;
- undo/redo and transactions;
- autosave, validation, and schema migrations;
- `@remotion/player`;
- Remotion composition and headless rendering;
- preview/export parity;
- background jobs and progress;
- performance, security, testing, and observability;
- earlier Remotion/editor repositories.

This file does not establish the target application's actual file paths until an agent completes the Local Application Map.

---

## 3. Core Product Model

The application should behave as one deterministic editor with two views of the same project:

```text
Canonical editable project
        |
        +----> browser editor + @remotion/player
        |
        +----> Remotion composition + exported video
```

The browser preview and final export must not be independent interpretations of the edit.

The system should have:

1. one canonical project model;
2. one canonical timeline projection;
3. stable IDs;
4. explicit time conversions;
5. deterministic animations;
6. one command per logical edit;
7. durable values sufficient to reproduce the same edit;
8. shared Player/render components where practical;
9. validation at every boundary;
10. background jobs for expensive work.

---

## 4. Non-Negotiable Invariants

### 4.1 Project

- Every project and timeline item has a stable ID.
- A project schema version exists.
- Persisted project data is validated on load.
- Transient pointer state is never persisted.
- Preview-only UI state is not part of edit history.
- Save/reload reproduces the same edit.
- Old project versions are migrated one version at a time.
- Temporary blob URLs are not treated as durable asset references.

### 4.2 Timeline

- Domain time is authoritative; pixel positions are derived.
- Every item has a finite start and a positive duration.
- No item contains `NaN`, `Infinity`, negative duration, or reversed endpoints.
- Every Remotion `Sequence` receives valid integer frames.
- Packed and free tracks are modeled explicitly.
- One pointer gesture creates at most one history entry.
- Selecting an item never changes its duration.
- Scrubbing never also drags, trims, or duplicates.
- Reordering does not alter source trims.
- Trimming does not alter item identity or order.
- Splitting preserves source continuity and reanchors dependent overlays.
- Commands are idempotent or protected by stable command/run IDs.

### 4.3 Rendering

- Output is a deterministic function of frame number and props.
- No animation uses browser wall-clock time.
- No render uses unseeded `Math.random()`.
- CSS transitions or CSS animation clocks are not the timing source.
- Preview and export use identical item timing and selected assets.
- Composition duration is derived from current project data.
- Rendering never mutates project data.
- Missing assets fail clearly.

### 4.4 Captions

- Data, cleanup, paging, active timing, and visual styling are separate.
- Real word timestamps are preserved.
- Style does not hide broken timing.
- Words are never split mid-word.
- Seeking backward or forward produces the correct active word.
- Styles remain inside safe zones.
- Style titles match the actual render.
- Preview and export use one caption engine.

### 4.5 Security

- Custom templates are declarative data, not executable code.
- API keys never enter project files or Remotion props.
- External URLs and local paths are validated.
- AI-generated code is not evaluated at runtime.
- External repository instructions never override local security rules.

---

## 5. Canonical Time Model

Most timeline failures come from mixing:

- seconds;
- milliseconds;
- frames;
- source-relative time;
- project time;
- clip-local time;
- pixel position.

Choose one canonical persisted representation.

### 5.1 Recommended canonical units

Use integer frames when one project FPS is authoritative.

```ts
type Frame = number; // always integer
```

Use integer milliseconds or microseconds when source/audio timing must remain independent of render FPS.

```ts
type Milliseconds = number; // integer
```

Convert only through one tested utility module.

```ts
export const secondsToFrames = (
  seconds: number,
  fps: number,
  mode: "round" | "floor" | "ceil" = "round"
): number => {
  const value = seconds * fps;
  return mode === "floor"
    ? Math.floor(value)
    : mode === "ceil"
      ? Math.ceil(value)
      : Math.round(value);
};

export const framesToSeconds = (frames: number, fps: number) => frames / fps;

export const millisecondsToFrames = (
  milliseconds: number,
  fps: number,
  mode: "round" | "floor" | "ceil" = "round"
) => secondsToFrames(milliseconds / 1000, fps, mode);

export const framesToMilliseconds = (frames: number, fps: number) =>
  Math.round((frames / fps) * 1000);
```

Document whether start values use floor/round and end values use ceil/round.

### 5.2 Three time spaces

A trimmed clip has:

- **source time:** location inside original media;
- **clip-local project time:** time since the clip begins in the edit;
- **project time:** time since the complete edit begins.

For playback speed `speed`:

```text
project duration = (sourceOut - sourceIn) / speed
source time = sourceIn + clipLocalProjectTime * speed
clipLocalProjectTime = (sourceTime - sourceIn) / speed
```

A trim delta measured on the project timeline must be multiplied by speed before changing source trim points.

### 5.3 Pixels are view state

```ts
const leftPx = startSeconds * pixelsPerSecond;
const widthPx = durationSeconds * pixelsPerSecond;
```

On drag:

```ts
const deltaProjectSeconds = deltaPixels / pixelsPerSecond;
```

Never persist `leftPx` or `widthPx`.

---

## 6. Recommended Data Model

Adapt these semantics to the existing project instead of rewriting working types without a demonstrated need.

### 6.1 Project

```ts
type EditorProject = {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  fps: number;
  width: number;
  height: number;

  assets: MediaAsset[];
  tracks: TimelineTrack[];
  settings: ProjectSettings;

  revision: number;
};
```

### 6.2 Asset

```ts
type MediaAsset = {
  id: string;
  kind: "video" | "image" | "audio";
  src: string;
  localPath?: string;
  sourceUrl?: string;

  durationMs?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;

  provider?: string;
  providerMediaId?: string;
  creatorName?: string;
  attribution?: string;

  checksum?: string;
  status: "ready" | "processing" | "missing" | "error";
};
```

An asset and a timeline item are different. Multiple timeline items may reference one asset.

### 6.3 Track

```ts
type TimelineTrack = {
  id: string;
  kind:
    | "video"
    | "broll"
    | "image"
    | "caption"
    | "text"
    | "hook"
    | "audio"
    | "effect";
  name: string;
  locked: boolean;
  hidden: boolean;
  muted?: boolean;
  order: number;
  placementMode: "packed" | "free";
  itemIds: string[];
};
```

A packed track derives each start from ordered preceding durations. A free track stores explicit starts.

### 6.4 Item base

```ts
type TimelineItemBase = {
  id: string;
  trackId: string;
  type:
    | "video"
    | "image"
    | "audio"
    | "caption"
    | "text-motion"
    | "hook"
    | "broll"
    | "effect";

  startFrame: number;
  durationInFrames: number;

  name?: string;
  locked?: boolean;
  hidden?: boolean;

  createdBy?: "manual" | "auto-broll" | "image-cycle" | "caption-generator";
  runId?: string;
};
```

For packed clips, do not persist both an independent authoritative start and authoritative order unless consistency is enforced.

### 6.5 Video clip

```ts
type VideoClip = TimelineItemBase & {
  type: "video";
  assetId: string;
  sourceInFrame: number;
  sourceOutFrame: number;
  sourceDurationInFrames: number;
  speed: number;
  volume: number;
  muted: boolean;
  keyframes?: TransformKeyframe[];
};
```

### 6.6 Overlay anchor

```ts
type ClipAnchor = {
  clipId: string;
  sourceStartMs: number;
  sourceEndMs: number;
};
```

Captions and B-roll may use source-relative anchors so they follow trims, speed changes, reorder, split, and autocut.

### 6.7 Normalized position

```ts
type NormalizedPosition = {
  x: number; // 0..1
  y: number; // 0..1
  anchor:
    | "top-left" | "top" | "top-right"
    | "left" | "center" | "right"
    | "bottom-left" | "bottom" | "bottom-right";
};
```

Persist normalized project coordinates, not DOM pixels.

---

## 7. Pointer Gesture Architecture

A gesture has:

1. pointer down;
2. deadzone detection;
3. transient preview;
4. pointer up/cancel;
5. one committed command;
6. cleanup.

Recommended flow:

```text
pointer down
-> capture original domain values
-> pointer move updates local preview
-> crossing deadzone classifies gesture
-> pointer up validates final value
-> dispatch one command
-> clear preview/listeners
```

### 7.1 Deadzone

Use approximately 4–6 pixels.

Before crossing:

- pointer up means click/select/seek;
- do not push history;
- do not reorder.

After crossing:

- click behavior must not also fire.

### 7.2 Event isolation

On interactive items and handles:

```ts
event.stopPropagation();
event.preventDefault();
event.currentTarget.setPointerCapture?.(event.pointerId);
```

This prevents:

- item click and canvas scrub both firing;
- trim and drag both firing;
- lost cleanup when pointer leaves the element.

### 7.3 Transient state

```ts
type DragPreview = {
  itemId: string;
  mode: "move" | "trim-left" | "trim-right" | "reorder";
  original: DomainSnapshot;
  deltaPx: number;
  candidate: DomainResult;
};
```

Never autosave this.

### 7.4 Idempotency

Give logical commands or async job completions a stable command ID/run ID. Reject duplicate application.

Do not insert generated items from a mount effect. React Strict Mode development behavior may reveal unsafe side effects.

---

## 8. Drag, Reorder, Trim, and Split

### 8.1 Reorder packed clips

1. Remove the dragged clip from a temporary list.
2. Derive spans for all other clips.
3. Compare pointer project time with other clip midpoints.
4. Choose insertion index.
5. Preview locally.
6. Commit one order command on pointer up.

Reordering changes order only. It must not rebuild source trim fields incorrectly.

### 8.2 Move a free item

```ts
newStartFrame = clamp(
  originalStartFrame + deltaFrames,
  0,
  projectDurationFrames - durationInFrames
);
```

Snapping is calculated in domain time. Pixel tolerance is only the UI threshold.

### 8.3 Trim

For speed-adjusted clips:

```ts
const deltaProjectSec = deltaPx / pixelsPerSecond;
const deltaSourceSec = deltaProjectSec * speed;
```

Clamp:

```text
0 <= sourceIn
sourceIn + minimumSourceSpan <= sourceOut
sourceOut <= sourceDuration
```

A common bug is using project seconds as source seconds at non-1× speed.

### 8.4 Visual trim preview

Transient width may be shown without repacking the complete timeline. On pointer up:

- clear preview;
- dispatch trim;
- recompute placements from canonical state.

The “item looks shortened but is not shortened” bug often means:

- only preview width changed;
- pointer up did not dispatch;
- stale closure values were committed;
- preview state survived cancellation;
- seconds/ms/frames were mixed;
- click triggered trim cleanup;
- selected border changed apparent width.

### 8.5 Split

To split at project frame:

1. find the placed clip containing the frame;
2. convert project-local frame to source time;
3. reject cuts near either edge;
4. create two stable IDs;
5. preserve media/audio settings;
6. split or pin keyframes;
7. reanchor dependent overlays;
8. replace one clip with two in one transaction;
9. add one history entry.

```ts
sourceSplitSec =
  sourceInSec + (projectLocalFrames / fps) * speed;
```

### 8.6 Transform continuity

Sample the transform at split and place that sampled value at the boundary in both halves when necessary.

### 8.7 Duplicate prevention

When drag duplicates an item, inspect:

- `onPointerDown`, `onClick`, and drop all committing;
- duplicate listeners;
- element and window pointer-up handlers both firing;
- optimistic insertion plus server insertion;
- Strict Mode effect replay;
- array index as React key;
- history replay treated as a new edit;
- preview object entering persisted item arrays.

Required regression:

```text
given one item
when one drag gesture crosses the deadzone and ends
then exactly one item with the same stable ID exists
and exactly one history entry was added
```

---

## 9. Selection, Clicking, Scrubbing, and Inspector

Selection is usually UI state, not persisted edit state.

A plain click may select, seek, or open the inspector. It must not trim, split, duplicate, normalize, or rewrite duration.

If clicking visually shortens an item:

1. compare canonical duration before/after;
2. inspect transient trim preview;
3. inspect selected border and `box-sizing`;
4. inspect zoom;
5. inspect click and pointer-up handlers;
6. inspect stale trim closures.

Timeline scrubbing should start only on empty canvas or the ruler. Item blocks and handles stop propagation.

Inspector numeric inputs should allow temporary local text, then validate and commit on blur/Enter. Do not push history for every invalid intermediate keystroke.

---

## 10. Clip-Anchored Overlays

Projection from source-relative anchor to project time:

```text
projectStart = placed clip start
sourceOffset = overlaySourceStart - clipSourceIn
projectOffset = sourceOffset / speed
overlayProjectStart = projectStart + projectOffset
```

Trim behavior:

- overlays outside the visible source range are hidden or marked out-of-range;
- partially visible overlays are projected/clamped;
- original source anchor should remain available if trim is restored.

Split behavior:

- before split stays on first clip;
- after split reanchors to second;
- crossing overlays are split or resolved by explicit policy.

Absolute project hooks and music should not be forced through clip-anchor projection.

---

## 11. Undo, Redo, and Transactions

One logical gesture equals one undo entry.

Do not include playhead, hover, selection, panel state, waveform cache, progress, or drag preview in edit history.

### 11.1 Snapshot history

Simple and reliable, but can be memory-heavy. Use immutable updates and a bounded history.

### 11.2 Command/patch history

More scalable but every command needs a correct inverse.

```ts
type CommandResult = {
  nextProject: EditorProject;
  inverse: EditorCommand;
};
```

### 11.3 Transactions

Complex operations must commit atomically:

- split plus overlay reanchor;
- image cycle generation;
- Auto B-roll insertion;
- bulk caption generation;
- multiclip autocut.

Redo restores exact IDs, timing, seeds, source offsets, and selected assets. It must not regenerate.

---

## 12. Persistence, Autosave, and Migration

Validate projects with Zod or equivalent.

Autosave should:

- debounce committed project changes;
- exclude transient pointer state;
- attach a monotonically increasing revision;
- cancel/ignore stale save requests;
- preserve the last valid project;
- avoid saving cleared state during project switching.

Prevent save races where revision 40 finishes after revision 41 and overwrites it.

Persist stable asset references. Do not persist browser blob URLs.

Migration flow:

```text
read envelope
-> detect schema version
-> migrate one version at a time
-> validate current schema
-> load editor
```

Regression:

```text
create edit
save
discard memory
reload
assert normalized project equality
assert representative preview frames match
```

---

## 13. Remotion Composition Architecture

The same composition should power:

- embedded Player;
- Studio;
- headless render.

A typical registration:

```tsx
<Composition
  id="EditorProject"
  component={EditorComposition}
  fps={30}
  width={1080}
  height={1920}
  durationInFrames={300}
  defaultProps={...}
  calculateMetadata={calculateProjectMetadata}
/>
```

`calculateMetadata` validates props and derives duration/dimensions. It must not mutate project data.

Typical layer order:

```text
background
primary clips/images
footage transitions/effects
B-roll / picture-in-picture
decorative overlays
hooks / Text Motion
captions
brand/logo
```

For every item:

```ts
const from = integerFrame;
const durationInFrames = Math.max(1, integerDuration);
```

Use `delayRender`, `continueRender`, and `cancelRender` for required assets/fonts/metadata. Every delayed handle must finish or cancel.

Use frame-derived animation only:

- `useCurrentFrame`;
- `useVideoConfig`;
- `interpolate`;
- `spring`;
- `Sequence`;
- `TransitionSeries`;
- seeded deterministic values.

---

## 14. Preview and Export Parity

Both receive one normalized input contract.

Do not calculate timeline placement independently in editor and renderer. Put projection in shared pure functions.

A useful media pattern is:

```ts
const MediaComponent =
  getRemotionEnvironment().isRendering ? OffthreadVideo : Video;
```

Both paths must receive identical `src`, trim, playback rate, volume, and dimensions.

Use `premountFor` to reduce decode flashes, but do not use it to hide incorrect timing.

Common mismatch causes:

| Preview works, export fails | Cause |
|---|---|
| Browser-only blob URL | asset is not durable |
| CSS transition | not frame-driven |
| Different trim | separate calculations |
| Caption differs | stale browser state |
| Random effect differs | unseeded randomness |
| Wrong duration | stale metadata |
| Font differs | render did not wait |
| Black seam | decode/premount or trim boundary |
| Audio differs | separate volume logic |

Maintain one deterministic render fixture with at least two clips, speed change, caption, hook, Text Motion, image, B-roll, and music.

---

## 15. Headless Rendering and Jobs

Flow:

```text
validate project
-> normalize render props
-> bundle once
-> select composition
-> renderMedia
-> validate output
-> publish/store result
```

Bundle once when rendering multiple outputs.

Job states:

```text
queued
preparing
bundling
rendering
encoding
validating
completed/cancelled/failed
```

Use renderer callbacks or completed frames for progress. Do not fake progress.

Long renders should use a durable queue with atomic claim, retry/backoff, cancellation, persistent progress, and result/error storage.

Validate final files for existence, duration, resolution, FPS, codec, audio, size, and decodability.

---

## 16. Auto B-Roll Editor Integration

Read `AUTO_BROLL_MAINTENANCE_GUIDE.md` for planning/search.

Editor requirements:

- stable B-roll item IDs;
- `createdBy: "auto-broll"`;
- persisted `runId`;
- manual/generated distinction;
- explicit preserve/replace/regenerate mode;
- one insertion transaction;
- selection, resize, position, replacement, removal;
- clip anchoring through trim/reorder/split;
- save/reload;
- shared B-roll preview/render layer;
- no provider call during render.

---

## 17. Text Motion

Text Motion is an independent styled timeline text item for titles, quotes, callouts, statistics, and kinetic typography.

It should be declarative:

```ts
type TextMotionConfig = {
  preset:
    | "fade"
    | "slide-up"
    | "pop"
    | "bounce"
    | "typewriter"
    | "word-rise"
    | "word-pop"
    | "highlight-sweep";
  entryFrames: number;
  holdFrames: number;
  exitFrames: number;
  staggerFrames?: number;
  spring?: {
    damping: number;
    stiffness?: number;
    mass?: number;
  };
};
```

Path to trace:

```text
editor control
-> command
-> project store
-> persistence
-> shared renderer
-> Player
-> export
```

Rules:

- frame-derived;
- clamped entry/hold/exit;
- stable word/character keys;
- seeded randomness only;
- transform/opacity first;
- readable hold;
- caption-safe positioning;
- explicit aspect-ratio behavior.

Common failures:

| Symptom | Cause |
|---|---|
| Button creates nothing | command/store path |
| Timeline item but no preview | renderer/layer missing |
| Preview only | CSS/browser-only behavior |
| Settings reset | schema omission |
| Restarts after seek | React local state instead of frame |
| Disappears early | wrong Sequence/local frame |
| Duplicate item | double handler/effect replay |

Verify creation, timing, seeking, save/reload, Player, and export.

---

## 18. Video Hooks and Safe Custom Templates

A video hook is a designed opening visual object, not a React hook and not an oversized caption.

Use a registry:

```ts
type HookTemplateDefinition = {
  id: string;
  version: number;
  name: string;
  description: string;
  defaultDurationFrames: number;
  schema: ZodSchema;
  render: React.ComponentType<HookRenderProps>;
};
```

Allow declarative fields:

- text and optional secondary text;
- duration;
- approved animation preset;
- approved font;
- size/weight;
- colors;
- background;
- alignment;
- normalized position;
- border/radius/padding/shadow;
- entry/exit timing.

Disallow JavaScript, TypeScript, JSX, shell commands, package installation, dynamic imports, `eval`, `Function`, and unvalidated URLs.

Suitable families for motivational and psychological content:

1. focused question;
2. psychology insight;
3. contrarian claim;
4. step/framework;
5. restrained quote card.

The hook should exit or settle before the normal caption rhythm dominates.

Test phone readability, face-safe placement, long text, all ratios, seeking, save/reload, Player, and export.


---

## 19. Caption System Architecture

Separate five concerns:

1. caption data;
2. cleanup;
3. paging/chunking;
4. active timing;
5. visual style.

Do not make every style reimplement all five.

```ts
type CaptionWord = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  accent?: boolean;
};

type CaptionPage = {
  id: string;
  startMs: number;
  endMs: number;
  words: CaptionWord[];
  lines: CaptionLine[];
};
```

A typed style configuration may include:

- display mode;
- typography;
- colors;
- active-word treatment;
- stroke and shadow;
- layout;
- safe zone;
- page animation;
- word animation;
- timing offset;
- cleanup;
- emphasis rules.

Use a preset registry whose UI title, thumbnail, and renderer all reference the exact same configuration.

### 19.1 Timing fallback order

1. real word timestamps;
2. segment timestamps with punctuation-aware estimation;
3. proportional text timing;
4. whole segment as one page.

Never replace accurate word timing with even distribution.

### 19.2 Active-word search

Use a shared pure function. For large caption arrays, use binary search after seeking or a maintained index during forward playback instead of scanning every segment on every frame.

### 19.3 Offset versus drift

A constant offset fixes fixed latency. It does not fix cumulative drift.

If captions start correctly but become wrong later, inspect:

- source timebase;
- variable frame rate;
- audio resampling;
- project FPS;
- transcript generated from a different media version;
- source/project time mapping.

### 19.4 Safe zones

For a 1080×1920 short, a practical starting caption-safe area from the researched references is approximately:

```text
x: 96..984
y: 220..1540
```

This is a starting point, not a universal platform guarantee.

Review at phone size.

---

## 20. Caption Cleanup, Paging, and Style Repair

Cleanup may remove configured:

- TTS markers;
- standalone ASR punctuation;
- filler words/phrases;
- list markers rendered separately.

Keep timestamps attached to retained words.

Paging should consider:

- characters per line;
- line count;
- word count;
- punctuation;
- time gaps;
- minimum on-screen duration;
- reading rate;
- phrase rhythm.

Never split a word mid-word.

For one unusually long word:

- keep it whole;
- measure and reduce font;
- allow controlled overflow;
- use a different line arrangement.

### 20.1 Repair order

1. verify raw timing;
2. verify cleanup;
3. verify paging;
4. verify active word;
5. verify layout;
6. verify visual preset;
7. verify animation;
8. verify style name and UI thumbnail.

Do not rename a style before determining whether its implementation or title is wrong.

### 20.2 Recommended focused style set

For motivational and psychological content:

- **CapCut Bold:** short chunks, strong outline, one active accent;
- **Educational Clean:** mixed case, restrained movement;
- **Focused Karaoke:** exact active word or pill;
- **Impact Phrase:** one to three key words, used sparingly;
- **Psychology Minimal:** calm two-line phrase with subtle emphasis.

Avoid crowding the main selector with dozens of gimmick effects.

---

## 21. Caption Tests

### Data

- invalid/overlapping timestamps;
- empty text;
- punctuation;
- long words;
- missing word timing;
- duplicate tokens;
- cleanup rules;
- non-English text.

### Paging

- one word;
- long sentence;
- sentence boundary;
- time gap;
- two lines;
- character limit;
- minimum display;
- final page;
- terminal-word orphan prevention.

### Active timing

- exact start;
- exact end;
- between words;
- forward seek;
- backward seek;
- fixed offset;
- no active segment;
- long-video drift fixture.

### Visual

For each preset capture:

- entry;
- active word;
- midpoint;
- exit;
- long text;
- portrait;
- landscape;
- square;
- safe-zone case.

### Preview/export

Render a short deterministic fixture and compare active word, placement, and representative frames.

---

## 22. Full-Timeline Image Cycling

The user selects two or more images and fills the complete project with repeated image items at a chosen interval, initially 3 or 4 seconds.

Modes:

- sequential;
- deterministic shuffle.

Generation:

```ts
function generateImageCycle({
  assetIds,
  projectDurationFrames,
  intervalFrames,
  mode,
  seed,
}: Input): ImageItem[] {
  // validate assets and duration
  // derive deterministic order
  // generate until complete duration is covered
  // clamp final item exactly
}
```

Use a seeded PRNG. Persist seed, generated order, IDs, and items. Do not call `Math.random()` during rendering.

Final item:

```ts
const remaining = projectDurationFrames - cursor;
const duration = Math.min(intervalFrames, remaining);
```

Create and insert all items as one validated transaction and one undo entry.

Tests:

- project shorter than interval;
- exact multiple;
- partial final segment;
- two and three images;
- sequential;
- same seed same shuffle;
- save/reload;
- undo/redo;
- export parity.

---

## 23. Audio, Waveforms, Music, and Ducking

Waveforms are derived cache, not project source of truth.

Cache by durable asset identity or checksum.

To display a trimmed clip waveform:

```text
start index = sourceIn / sourceDuration * peakCount
end index   = sourceOut / sourceDuration * peakCount
```

The source slice remains the same when speed changes, but its displayed project width changes.

Persist:

- clip volume;
- mute;
- playback rate;
- trim;
- music source offset;
- music fade;
- ducking enabled;
- duck level.

Ducking can derive speech ranges from captions, transcript activity, or audio analysis. The Remotion volume function must be deterministic and use smooth ramps.

Common problems:

| Symptom | Cause |
|---|---|
| Waveform misaligned after trim | incorrect source slice |
| Audio ends early | trim/rate mapping |
| Music restarts at every clip | music nested in clip sequence |
| Ducking differs in export | browser-only audio state |
| Muted clip is audible | mute/volume precedence |
| Seek desync | buffering or trim mismatch |
| Cut pops | unsuitable boundary or no transition |

---

## 24. Large-Timeline Performance

- Virtualize or cull off-screen timeline blocks.
- Keep ruler/playhead and visible items with modest overscan.
- Memoize placed clips, projected overlays, waveform slices, and item style positions by stable revision.
- Do not keep raw provider payloads in editor state.
- Avoid per-frame logs, parsing, sorting, allocation, or large `.find()` scans in Remotion hot paths.
- Use workers/backend jobs for waveform generation, thumbnails, transcription, probing, and rendering.
- Timeline zoom changes only view state.
- Keep large binary assets outside undo snapshots.
- Split large stores into project state, derived selectors, and UI state.

---

## 25. Background Jobs, Cancellation, and Progress

Use durable jobs for:

- transcription;
- captions;
- Auto B-roll;
- waveform generation;
- media conversion;
- rendering;
- export encoding.

```ts
type Job = {
  id: string;
  projectId: string;
  type: string;
  state:
    | "queued"
    | "preparing"
    | "running"
    | "validating"
    | "completed"
    | "cancelled"
    | "failed";
  phase: string;
  progress: number;
  revision: number;
  error?: string;
};
```

Cancellation should stop new work, abort supported requests, and avoid committing an incomplete editor transaction.

A completion handler must be idempotent by job/run ID.

Progress must correspond to real completed units or render frames, not a timer.

---

## 26. Observability

Record concise structured events.

```ts
type EditorDiagnosticEvent = {
  projectId: string;
  revision: number;
  commandId?: string;
  gestureId?: string;
  jobId?: string;
  itemId?: string;
  phase: string;
  event: string;
  outcome: "success" | "cancelled" | "failure";
  durationMs?: number;
  errorCode?: string;
};
```

Useful diagnostics:

- item count before/after;
- command type and ID;
- history length;
- project revision;
- source/project frame ranges;
- active item IDs;
- render job phase;
- save revision.

Do not log API keys, full transcripts, signed URLs, complete project JSON, or private local paths without redaction.

---

## 27. Symptom-to-Subsystem Triage

| Symptom | Inspect first | Likely causes |
|---|---|---|
| Drag duplicates an item | pointer handlers, command ID, store insertion | click+drag both commit, duplicate listener, Strict Mode, optimistic+server insert |
| Click visually shortens item but state is unchanged | trim preview, CSS selection, zoom | stale transient state, border sizing, click invoking trim cleanup |
| State changes but width does not | selector/memoization | in-place mutation, stale dependency |
| Trim fails at 2× speed | conversion | project delta not converted to source delta |
| Reorder changes trims | command payload | item reconstructed incorrectly |
| Split jumps | keyframes | boundary transform not sampled |
| Split loses captions/B-roll | anchor mapping | overlays not assigned to second clip |
| Undo removes unrelated edits | history/transaction | scope too broad or wrong snapshot |
| Redo changes media/order | regeneration | seed/IDs/assets not persisted |
| Reload changes item order | serialization | track order or IDs omitted |
| Preview contains item, export does not | props/layer/assets | separate renderer, transient URL, stale schema |
| Black frame at seam | trim/decoder/Sequence | incorrect `trimAfter`, no premount, overlap/gap |
| Text Motion does nothing | state→renderer path | missing type registration or layer |
| Text Motion restarts on seek | local state/CSS | not frame-derived |
| Hook looks like subtitle | design model | reused caption lane |
| Custom hook crashes | unsafe runtime | executable input or weak validation |
| Caption title is misleading | preset registry | title/thumbnail/config mismatch |
| Active word sticks after backward seek | active timing cache | forward-only state |
| Captions drift later | timebase | VFR, FPS mismatch, wrong source |
| Captions flash | paging | page duration too short |
| Long captions clip | layout | no fit/wrap/safe zone |
| Image cycle changes after reload | random order | seed/order not persisted |
| Final image exceeds duration | generator | no remaining-duration clamp |
| Timeline is slow | DOM/projection | no culling, repeated sorting |
| Waveform refetches | cache/effect deps | unstable source list |
| Old autosave overwrites new | persistence race | no revision enforcement |
| Render hangs | asset readiness | `delayRender` never completed |
| UI freezes on render | job architecture | synchronous rendering |
| Auto B-roll removes manual media | regeneration filter | deletes by track/type, not generator marker |
| Item click also scrubs | event propagation | block did not stop canvas handler |
| Drag remains active outside window | cleanup | no pointer capture/cancel |

---

## 28. Repair Workflow

1. Record exact observed and expected behavior.
2. Reproduce with the smallest deterministic fixture.
3. Trace:

```text
user event
-> transient UI state
-> command
-> project store
-> derived placement
-> persistence
-> composition props
-> Remotion layer
-> export
```

4. Compare counts, IDs, revisions, and frame ranges.
5. Identify the root-cause class:
   - event;
   - conversion;
   - command;
   - immutability;
   - projection;
   - persistence;
   - rendering;
   - asset;
   - schema;
   - async race.
6. Apply the smallest safe fix.
7. Add a test that fails before the fix.
8. Verify the direct boundaries.
9. Update the Local Application Map and Change Log.

Do not begin with a complete production video when a two-clip fixture can reproduce the issue.

---

## 29. Test Matrix

### Time

- seconds/frames;
- ms/frames;
- rounding;
- 24/25/30/60 FPS;
- speed 0.25/1/2/4;
- exact project end.

### Gestures

- click;
- movement below deadzone;
- drag;
- pointer cancel;
- pointer up outside;
- trim left/right;
- empty-canvas scrub;
- propagation;
- one history entry.

### Reorder/trim/split

- first↔last;
- same index;
- stable IDs;
- no duplicates;
- source bounds;
- speed-aware trim;
- keyframe continuity;
- overlay reanchor;
- undo/redo.

### Persistence

- save/load;
- migration;
- revision race;
- missing asset;
- generated metadata;
- no transient state.

### Remotion

- metadata duration;
- valid Sequences;
- Player/export props;
- media trims;
- seeking;
- fonts;
- missing media;
- first/last frame.

### Features

- Text Motion;
- hooks;
- invalid custom hook;
- caption paging/timing;
- image cycling;
- Auto B-roll regression;
- music/ducking.

Manual verification should include one real short export.

---

## 30. Reference Strategy

Do not inspect all repositories on every task.

Priority:

1. `andriidrok1/autobroll` — direct editor/timeline architecture.
2. `45ck/content-machine` — caption, motion, hook schemas and skills.
3. `remotion-dev/template-tiktok` — official caption/Remotion baseline.
4. `el-frontend/video-wizard` — production services, queue, templates.
5. `AgriciDaniel/claude-shorts` — preflight, snapping, render workflow.
6. Secondary repos only for one named unresolved need.

Before copying:

- verify current license;
- inspect only the exact source;
- adapt to the local model;
- do not import complete applications;
- recreate behavior when permission or compatibility is uncertain.

---

## 31. Repository Analysis — andriidrok1/autobroll

Repository:

https://github.com/andriidrok1/autobroll

**Why it matters:** This is the strongest direct reference for a browser-based CapCut-style editor built on Remotion.

Features documented by the repository:

- multi-clip timeline;
- drag reorder;
- edge trim;
- split;
- waveforms;
- captions and B-roll;
- keyframes;
- speed, volume, mute;
- music fade and ducking;
- full undo/redo;
- autosave and projects;
- shared Player/export composition.

Architecture:

```text
editor/    React, Vite, Tailwind, Zustand, @remotion/player
src/       shared timeline domain and Remotion composition
server/    projects, uploads, waveforms, AI jobs, render
scripts/   transcription, arrange, captions, B-roll, autocut
```

### `editor/Timeline.tsx`

Important responsibilities:

- common ruler/playhead;
- caption/video/B-roll/audio tracks;
- zoom;
- waveform loading;
- scrubbing;
- trim and reorder;
- selection;
- projected overlays.

Important patterns:

- `placeClips()` derives packed positions;
- `projectCaptions()`/`projectBrolls()` derive project positions;
- a drag deadzone separates click from reorder;
- trim preview is local;
- history is pushed once per gesture;
- pixel delta is converted to source seconds using speed;
- blocks stop event propagation.

Potential improvements:

- split large track components;
- virtualize long timelines;
- use pointer capture;
- introduce explicit command IDs;
- ensure listener cleanup through a shared gesture utility.

### `editor/store.ts`

Uses Zustand for clips, captions, B-roll, music, selection, playhead, and history.

Notable behavior:

- full editable-state snapshots;
- bounded history;
- project duration recomputed after clip edits;
- split maps project frame to source time with speed;
- split pins transform at the boundary;
- captions/B-roll after split are reanchored;
- autocut segments and reanchors in one history step.

Potential cautions:

- snapshots may become large;
- time-derived IDs are not ideal for deterministic replay;
- text editing may evenly retime words and lose accurate timestamps;
- nested mutations must remain immutable.

### `src/timeline.ts`

Key types/functions:

- `Clip`;
- `Keyframe`;
- `Music`;
- `clipDurationSec`;
- `placeClips`;
- `totalDurationFrames`;
- `sampleTransform`.

Key formula:

```text
timeline duration = (source out - source in) / speed
```

Keyframes are source-time values sampled with smooth interpolation.

### `src/Root.tsx`

Registers `MultiClip` and uses `calculateMetadata` to derive duration and normalize props/fallback files.

### `src/MultiClipVideo.tsx`

- places clips in `Sequence`;
- applies source trim and playback rate;
- samples zoom/pan keyframes;
- uses native `Video` in live Player and `OffthreadVideo` while rendering;
- premounts upcoming clips;
- projects captions and B-roll;
- renders deterministic music ducking;
- orders clips → B-roll → music → captions.

**Adopt:** source-relative clips, pure placement, clip anchoring, one-commit gestures, speed-aware trim, keyframe pinning, shared composition.

**Improve:** modularity, durable IDs, scalable history, schema migrations, virtualization, strict render contracts.

---

## 32. Repository Analysis — 45ck/content-machine

Repository:

https://github.com/45ck/content-machine

Default branch at inspection: `master`.

This is a local-first video workflow/skill system rather than a direct timeline editor.

Useful layout:

```text
skills/
flows/
docs/user/
docs/demo/
scripts/harness/
src/harness/
src/
```

### Caption implementation

Important files:

```text
src/render/captions/config.ts
src/render/captions/presets.ts
src/render/captions/paging.ts
src/render/captions/Caption.tsx
src/render/service.ts
```

`config.ts` uses a Zod configuration for:

- page/single/buildup/chunk display;
- highlight modes;
- page and word animation;
- pill, stroke, shadow;
- emphasis and cleanup;
- line/word/time limits;
- positions and safe zones;
- timing offsets.

`presets.ts` contains style families including TikTok, Shorts, Reels, bold, minimal, neon, CapCut, Hormozi, and karaoke.

`paging.ts` handles timed words, marker cleanup, filler phrases, list markers, punctuation, line limits, word limits, time gaps, and page construction without breaking words.

### Skills

`skills/short-form-captions/SKILL.md`:

- clean timing first;
- captions are part of the edit;
- fewer stronger words;
- safe zones and phone-size review.

`skills/motion-design-coder/SKILL.md`:

```text
frame number + props -> deterministic image
```

Blocks browser time, CSS animation clocks, unseeded randomness, and motion that competes with captions.

Useful defaults include word pops around 70–130ms, card entrances 180–320ms, transitions 250–500ms, and 2–5 frame staggers.

`skills/hook-overlay/SKILL.md` treats a hook as a separately designed object rather than a giant caption.

**Adopt:** typed declarative schemas, preset registries, separate paging/visuals, frame-driven motion, safe-zone review, hook/caption separation.

---

## 33. Repository Analysis — remotion-dev/template-tiktok

Repository:

https://github.com/remotion-dev/template-tiktok

Important files:

```text
src/CaptionedVideo/index.tsx
src/CaptionedVideo/Page.tsx
src/CaptionedVideo/SubtitlePage.tsx
sub.mjs
whisper-config.mjs
```

`index.tsx` demonstrates:

- `@remotion/captions`;
- `createTikTokStyleCaptions`;
- sidecar caption JSON;
- `calculateMetadata`;
- video metadata;
- `useDelayRender` and cancellation;
- static-file watching;
- page-to-Sequence conversion;
- `OffthreadVideo`.

`SubtitlePage.tsx` uses `useCurrentFrame`, `useVideoConfig`, and a spring for deterministic page entry.

**Use as:** official timing/data baseline.

**Limitations:** one principal visual style; sidecar files are not a project database; richer editor paging may be required.

Verify current Remotion licensing terms for the target organization/use case.

---

## 34. Repository Analysis — el-frontend/video-wizard

Repository:

https://github.com/el-frontend/video-wizard

Architecture:

```text
apps/web/                 Next.js UI/API/worker
apps/processing-engine/   Python/FastAPI/Whisper/FFmpeg/MediaPipe
apps/remotion-server/     Express + Remotion
packages/remotion-compositions/
```

Important editor/render paths:

```text
apps/web/features/video/components/remotion-preview.tsx
apps/web/features/video/components/subtitle-editor.tsx
apps/web/features/video/components/template-selector.tsx
apps/web/features/video/components/brand-kit-settings.tsx
apps/web/features/video/hooks/
apps/web/server/services/
apps/remotion-server/server/index.ts
apps/remotion-server/server/render-queue.ts
packages/remotion-compositions/src/Root.tsx
packages/remotion-compositions/src/compositions/CaptionOverlay.tsx
packages/remotion-compositions/src/hooks/useActiveSubtitle.ts
packages/remotion-compositions/src/templates/
packages/remotion-compositions/src/types.ts
```

Architecture rules documented in `AGENTS.md`:

- API routes handle HTTP only;
- services own business logic;
- hooks orchestrate UI;
- components remain props-driven;
- Zod schemas define contracts;
- long work uses a queue;
- strict TypeScript.

`CaptionOverlay.tsx` centralizes active caption selection and dispatches to visual templates.

`useActiveSubtitle.ts` centralizes current segment/word with a 200ms offset and gated debug logging. Cautions: linear search every frame, hardcoded offset, and constant offset cannot correct drift.

`HormoziTemplate.tsx` demonstrates energetic visual treatment but uses equal chunk/word timing and periodic emphasis; preserve real word timing and semantic emphasis in production.

**Adopt:** service boundaries, typed contracts, queue, central timing plus visual template dispatch.

---

## 35. Repository Analysis — AgriciDaniel/claude-shorts

Repository:

https://github.com/AgriciDaniel/claude-shorts

Important files:

```text
SKILL.md
scripts/preflight.sh
scripts/transcribe.py
scripts/detect_content.py
scripts/snap_boundaries.py
scripts/compute_reframe.py
scripts/export.sh
scripts/validate.sh
remotion/render.mjs
remotion/src/Root.tsx
remotion/src/ShortVideo.tsx
remotion/src/types.ts
remotion/src/components/
remotion/src/hooks/useCaptionPages.ts
remotion/src/styles/
references/
```

Its 10-step workflow covers preflight, word-level transcription, content classification, candidate review, boundary snapping, clip extraction, reframe coordinates, Remotion rendering, platform encoding, and validation.

Boundary snapping uses word timing, sentence endings, nearby silence, padding, and duration limits.

Rendering guidance bundles once, reuses browser resources, reports progress, and validates output.

**Adopt:** preflight, inspectable intermediate artifacts, audio-aware cut boundaries, short render fixtures, post-export validation.

---

## 36. Repository Analysis — ahgsql/remotion-subtitles

Repository:

https://github.com/ahgsql/remotion-subtitles

Package: `remotion-subtitle`

Important files:

```text
src/index.js
src/core/SubtitleSequence.js
src/captions/
```

`SubtitleSequence`:

- fetches SRT from `staticFile`;
- parses comma/dot milliseconds;
- converts time to frames;
- creates `Sequence` elements;
- accepts a custom caption component.

The project offers many animated text effects.

**Use for:** isolated effect inspiration or simple SRT display.

**Do not use as:** the central word-timing engine for a production editor.

Limitations include untyped JavaScript, regex parsing, no word-level timing, index keys, minimal errors, and no meaningful automated tests.

---

## 37. Repository Analysis — ayadalshaikhli/video-api

Repository:

https://github.com/ayadalshaikhli/video-api

The useful file is:

```text
src/TikTokCaption.tsx
```

It exposes a broad customization inventory:

- fonts;
- size/weight;
- active/inactive colors;
- position/alignment;
- width;
- padding/background/blur/radius/shadow;
- stroke;
- phrase size;
- glow.

Use that inventory to design a typed local schema.

Do not copy the implementation as a production timing engine because it contains many `any` types, approximate text measurement, equal timing fallbacks, CSS transitions, and debug logging.

---

## 38. Repository Analysis — scotthavird/remotion-docker-template

Repository:

https://github.com/scotthavird/remotion-docker-template

Important paths:

```text
.claude/skills/remotion/
.claude/skills/remotion-docker-template/SKILL.md
examples/player/
public/captions/
src/index.tsx
src/components/
remotion.config.ts
render.mjs
Dockerfile
docker-compose.yml
docs/LAMBDA_DEPLOY.md
```

It demonstrates:

- Studio and headless rendering;
- Player embedding;
- caption and transition compositions;
- Tailwind v4 in both bundling paths;
- Docker and Lambda;
- agent skills.

`render.mjs` bundles, maps composition input props, calls `selectComposition`, then `renderMedia`.

The project skill emphasizes atoms/molecules/organisms and forbids Tailwind/CSS animation classes as the Remotion timing mechanism.

**Adopt:** matching bundler config, explicit render entrypoint, composition validation, deployment outside composition logic.

---

## 39. Repository Analysis — reactvideoeditor/remotion-templates

Repository:

https://github.com/reactvideoeditor/remotion-templates

It contains 81 standalone frame-driven components.

Useful filenames:

### Text

```text
animated-text.tsx
bounce-text.tsx
bubble-pop-text.tsx
floating-bubble-text.tsx
glitch-text.tsx
popping-text.tsx
pulsing-text.tsx
slide-text.tsx
typewriter-subtitle.tsx
```

### Cinematic

```text
camera-shake.tsx
film-burn.tsx
ken-burns.tsx
letterbox-reveal.tsx
parallax-pan.tsx
spotlight-reveal.tsx
vignette-pulse.tsx
whip-pan.tsx
zoom-pulse.tsx
```

### Transitions

```text
cross-dissolve.tsx
fade-through-black.tsx
push-transition.tsx
slide-wipe.tsx
zoom-through.tsx
```

### Hooks/intro

```text
chapter-title.tsx
cinematic-title-intro.tsx
lower-third.tsx
quote-card.tsx
title-split.tsx
```

### Image/media

```text
image-carousel.tsx
image-zoom-reveal.tsx
picture-in-picture.tsx
split-screen.tsx
ken-burns.tsx
```

Inspect one component for a specific approved effect. Do not import the complete library into the editor.

---

## 40. Repository Analysis — ali-abassi/remotion-templates

Repository:

https://github.com/ali-abassi/remotion-templates

This is primarily a curated template index and generic Remotion skill, not an editor implementation.

Use it to discover underlying repositories and general design patterns.

Its skill includes some examples using unseeded `Math.random()`. Never copy those nondeterministic patterns into Remotion rendering.

Licenses of linked projects must be checked individually.

---

## 41. Earlier Auto B-Roll Repositories

Full analysis exists in `AUTO_BROLL_MAINTENANCE_GUIDE.md`.

### pandillabalaji/broll-assistant

https://github.com/pandillabalaji/broll-assistant

Editor relevance:

- timestamped Groq moments;
- transcript context;
- media selection;
- trim/export metadata.

### createkuntal-ship-it/broll-scout

https://github.com/createkuntal-ship-it/broll-scout

Editor relevance:

- multi-provider fan-out;
- media collection;
- gap analyzer;
- trusted Electron bridge.

### Carlton-Li/broll-background-sourcer

https://github.com/Carlton-Li/broll-background-sourcer

Editor relevance:

- deterministic query fallback;
- ranking and deduplication;
- manifests and sidecar metadata.

These are not complete timeline-editor references.

---

## 42. Combined Architecture Recommendations

| Concern | Main reference |
|---|---|
| Timeline/clip domain | `andriidrok1/autobroll` |
| Pointer trim/reorder | `andriidrok1/autobroll` |
| Clip anchoring | `andriidrok1/autobroll` |
| Shared Player/export | `andriidrok1/autobroll` |
| Caption data baseline | `remotion-dev/template-tiktok` |
| Caption config/paging | `45ck/content-machine` |
| Caption styles | `el-frontend/video-wizard`, `AgriciDaniel/claude-shorts` |
| Motion and hooks | `45ck/content-machine` |
| Service boundaries/queue | `el-frontend/video-wizard` |
| Cut snapping/preflight | `AgriciDaniel/claude-shorts` |
| Effect inspiration | `reactvideoeditor/remotion-templates`, `ahgsql/remotion-subtitles` |
| Config field inventory | `ayadalshaikhli/video-api` |
| Docker/headless render | `scotthavird/remotion-docker-template` |
| Discovery index | `ali-abassi/remotion-templates` |
| Auto B-roll planner/search | companion guide |

Do not mechanically merge whole repositories. Build one coherent local architecture.

---

## 43. Local Application Map

The first agent working with the actual project must fill these paths. Future agents should start here.

```text
Project schema:
<fill in>

Project migrations:
<fill in>

Editor project store:
<fill in>

UI-only editor state:
<fill in>

History/undo/redo:
<fill in>

Timeline domain model:
<fill in>

Time conversion utilities:
<fill in>

Timeline component:
<fill in>

Track components:
<fill in>

Pointer gesture utilities:
<fill in>

Placement/projection:
<fill in>

Clip trim:
<fill in>

Clip reorder:
<fill in>

Clip split:
<fill in>

Autosave:
<fill in>

Project API/storage:
<fill in>

Asset registry/import:
<fill in>

Waveforms:
<fill in>

Audio/music:
<fill in>

Player wrapper:
<fill in>

Remotion Root:
<fill in>

Main composition:
<fill in>

Headless render entry:
<fill in>

Render queue/job:
<fill in>

Text Motion model/renderer:
<fill in>

Hook schema/registry/renderer:
<fill in>

Caption data:
<fill in>

Caption cleanup/paging:
<fill in>

Caption active timing:
<fill in>

Caption style registry/renderer:
<fill in>

Image cycling:
<fill in>

Auto B-roll editor integration:
<fill in>

Tests:
<fill in>
```

### Current local flow

```text
<fill in>
```

### Known deviations

```text
- <fill in>
```

---

## 44. Token-Efficient Agent Rules

- Start from the Local Application Map.
- Read only routed sections.
- Do not reread all external repositories.
- Search local symbols before full files.
- Do not print complete project JSON, logs, diffs, transcripts, or provider payloads.
- Use counts, IDs, revisions, and frame ranges.
- Reproduce with a compact fixture.
- Run targeted tests before complete builds.
- Render a short fixture before a full video.
- Do not install/build reference repositories unless one exact detail requires it.
- Do not broaden a timeline bug into an editor redesign.
- Update this guide when architectural discoveries will save future work.

---

## 45. Ready-to-Paste Prompts

### Timeline

```text
Follow AGENTS.md.

Read Sections 5–12, 27–29, and the Local Application Map in
REMOTION_EDITOR_TIMELINE_MAINTENANCE_GUIDE.md.

Fix this timeline issue:

<OBSERVED>

Expected:
<EXPECTED>

Reproduce using the smallest deterministic project. Trace the pointer gesture,
command, project state, placement, history, and persistence. Apply the smallest
safe fix.

Add a regression test proving one gesture creates one intended command and no
duplicate or unrelated mutation.

Do not reread external repositories. Do not commit or push.
```

### Text Motion

```text
Follow AGENTS.md.

Read Sections 13–17 and the Local Application Map.

Fix:
<PROBLEM>

Trace editor control -> command -> project state -> persistence -> shared
Remotion component -> Player -> export.

Use deterministic frame-derived animation. Add focused creation, timing,
seeking, persistence, and preview/export tests.

Do not redesign unrelated systems. Do not commit or push.
```

### Hooks

```text
Follow AGENTS.md.

Read Sections 13, 18, 32, and 43.

Repair the video-hook templates for motivational and psychological content.

Use validated declarative templates. Never execute pasted JavaScript,
TypeScript, JSX, shell commands, or package instructions.

Verify phone readability, safe zones, persistence, seeking, Player, and export.
Do not commit or push.
```

### Captions

```text
Follow AGENTS.md.

Read Sections 19–21, 32–40, and the Local Application Map.

Determine whether the defect is in caption data, cleanup, paging, active
timing, style configuration, or rendering.

Keep one shared timing/paging path and a declarative style registry. Preserve
real word timestamps and frame-derived animation.

Repair the exact issue and verify seeking, save/reload, Player, and export.
Do not inspect all external repositories. Do not commit or push.
```

### Preview/export mismatch

```text
Follow AGENTS.md.

Read Sections 5, 13–15, 27–29, and the Local Application Map.

Fix this preview/export mismatch:
<DIFFERENCE AND TIME/FRAME>

Compare normalized props, placement, assets, Sequence boundaries, trim/rate,
animation input, fonts, and metadata. Use one deterministic render path.

Add a minimal frame-equivalence or render fixture. Do not commit or push.
```

---

## 46. Bug Report Template

```markdown
# Editor/Timeline Bug

## Observed

## Expected

## Steps

1.
2.
3.

## Project

- Project ID:
- Version/commit:
- FPS:
- Resolution:
- Duration:
- Item IDs:
- Speed:
- Track:
- Save/reload:
- Preview/export:

## Evidence

- Screenshot/video:
- Error:
- State before:
- State after:
- History before/after:
- Relevant frames:

## Do not modify

-
```

---

## 47. Change Log

### 2026-08-02 — Initial guide

- Added editor/timeline invariants and time model.
- Added gesture, trim, reorder, split, anchor, history, and persistence guidance.
- Added Remotion composition, Player/export parity, jobs, Text Motion, hooks, captions, image cycling, audio, performance, and testing.
- Analyzed ten Remotion/editor repositories and three earlier Auto B-roll references.
- Added routing and token-efficient agent prompts.

---

## 48. Reference Links

### Editor/timeline

- https://github.com/andriidrok1/autobroll
- https://github.com/andriidrok1/autobroll/blob/main/editor/Timeline.tsx
- https://github.com/andriidrok1/autobroll/blob/main/editor/store.ts
- https://github.com/andriidrok1/autobroll/blob/main/src/timeline.ts
- https://github.com/andriidrok1/autobroll/blob/main/src/Root.tsx
- https://github.com/andriidrok1/autobroll/blob/main/src/MultiClipVideo.tsx

### Caption/motion/hooks

- https://github.com/45ck/content-machine
- https://github.com/45ck/content-machine/blob/master/skills/short-form-captions/SKILL.md
- https://github.com/45ck/content-machine/blob/master/skills/motion-design-coder/SKILL.md
- https://github.com/45ck/content-machine/blob/master/skills/hook-overlay/SKILL.md
- https://github.com/45ck/content-machine/blob/master/src/render/captions/config.ts
- https://github.com/45ck/content-machine/blob/master/src/render/captions/presets.ts
- https://github.com/45ck/content-machine/blob/master/src/render/captions/paging.ts

### Official caption baseline

- https://github.com/remotion-dev/template-tiktok
- https://github.com/remotion-dev/template-tiktok/blob/main/src/CaptionedVideo/index.tsx
- https://github.com/remotion-dev/template-tiktok/blob/main/src/CaptionedVideo/Page.tsx
- https://github.com/remotion-dev/template-tiktok/blob/main/src/CaptionedVideo/SubtitlePage.tsx

### Production architecture

- https://github.com/el-frontend/video-wizard
- https://github.com/el-frontend/video-wizard/blob/main/AGENTS.md
- https://github.com/el-frontend/video-wizard/blob/main/packages/remotion-compositions/src/compositions/CaptionOverlay.tsx
- https://github.com/el-frontend/video-wizard/blob/main/packages/remotion-compositions/src/hooks/useActiveSubtitle.ts
- https://github.com/el-frontend/video-wizard/blob/main/docs/SUBTITLE_TIMING_ADJUSTMENT.md

### Longform/short workflow

- https://github.com/AgriciDaniel/claude-shorts
- https://github.com/AgriciDaniel/claude-shorts/blob/main/SKILL.md

### Effects/configuration

- https://github.com/ahgsql/remotion-subtitles
- https://github.com/ahgsql/remotion-subtitles/blob/main/src/core/SubtitleSequence.js
- https://github.com/ayadalshaikhli/video-api
- https://github.com/ayadalshaikhli/video-api/blob/main/src/TikTokCaption.tsx
- https://github.com/reactvideoeditor/remotion-templates
- https://github.com/ali-abassi/remotion-templates

### Rendering

- https://github.com/scotthavird/remotion-docker-template
- https://github.com/scotthavird/remotion-docker-template/blob/main/render.mjs

### Auto B-roll

- https://github.com/pandillabalaji/broll-assistant
- https://github.com/createkuntal-ship-it/broll-scout
- https://github.com/Carlton-Li/broll-background-sourcer
