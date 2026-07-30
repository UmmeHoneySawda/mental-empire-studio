# Template video engine

Two template renderers — Remotion and HyperFrames — behind one strict project format, wired to the
Compose screen through IPC. Compose's **render head** at the top of the page picks which engine
builds the file:

| Engine | What it is |
| --- | --- |
| `classic` | The original GPU/ffmpeg pipeline (stills, Ken Burns, burned-in ASS captions). Untouched. |
| `remotion` | React compositions rendered frame by frame by `@remotion/renderer`. |
| `hyperframes` | HTML compositions rendered by HyperFrames' seek-safe GSAP timeline. |

Picking a renderer replaces the Compose workspace with the studio in
`src/features/video-studio/`, and the choice colours the whole studio through a `--engine` token so
the machine that will produce the file is always visible. Templates are filtered per renderer —
template IDs are renderer-scoped and cannot leak across engines.

## What is included

- One strict, versioned project format shared by Remotion and HyperFrames.
- Renderer-specific adapters with preflight, preparation, progress, cancellation, rendering, and
  cleanup.
- Two configurable hook templates per renderer, capped at 30 seconds.
- Six word-timed caption presets per renderer:
  Emoji Pop, Clip Wipe, Active Highlight, Neon Accent, Particle Burst, and Weight Shift.
- Stable word IDs, transcript hashes, an external-AI prompt builder, and validated important-word
  JSON import.
- Fade, slide, wipe, zoom, and dip-to-black transition logic where supported by the selected
  renderer.
- Shared FFmpeg cinematic grading with `.cube` LUT intensity, exposure, contrast, saturation,
  temperature, tint, vignette, and grain.
- Optional local, Pexels, Pixabay, and Coverr B-roll providers with a content-addressed cache and
  license sidecars.
- Atomic project persistence, revision checks, autosave, undo/redo, immutable render snapshots,
  persistent render jobs, recovery, retry, and cancellation.
- A constrained HyperFrames SDK editing wrapper for text, timing, declared variables, persistence,
  and undo/redo. It does not expose arbitrary script or HTML mutation.
- Structured Sentry milestones and failures when the engine is created inside Electron.
- Offline runtime assets: fonts, GSAP, FFmpeg, FFprobe, HyperFrames sources, and the production
  Remotion bundle are local.

## Installed runtime

The renderer packages are pinned so their closely coupled packages cannot drift independently:

- Remotion `4.0.502`: `remotion`, bundler, renderer, captions, media, transitions, and Zod types.
- HyperFrames `0.7.84`: core, producer, SDK, shader transitions, and CLI.
- `zod` `4.4.3`, `gsap` `3.13.0`, `remotion-bits` `0.2.0`, `culori` `4.0.2`, and `tsx`.

The UI phase adds `@remotion/player` (the on-screen Remotion preview) and `@remotion/cli`.
`onda-engine` is installed but not imported — see **Extra runtime packages** below for why.

HyperFrames requires Node 22 or newer.

## Important paths

```text
shared/video-engine/                    schemas, migrations, templates, captions, hook plans
electron/services/video-engine/         service, storage, queue, B-roll, grading
video-engine/remotion/                  Remotion composition and renderer adapter
video-engine/hyperframes/               compiler, Producer adapter, SDK editor
resources/video-engine/                 pinned, offline HyperFrames registry assets
scripts/video-engine-*.ts               setup, bundle, and real-render smoke tools
test/unit/video-engine/                 backend and renderer tests
```

Projects are stored below the `dataRoot` supplied to `createVideoEngine`:

```text
projects/<project-id>/project.json
projects/<project-id>/assets/
projects/<project-id>/renders/
projects/<project-id>/.work/
render-jobs/<job-id>.json
broll-cache/<sha256>.<ext>
broll-cache/<sha256>.<ext>.license.json
```

## Setup and verification

```bash
npm install
npx @electron/rebuild -f -w better-sqlite3
npm run video-engine:setup
npm run video-engine:bundle-remotion
npm run video-engine:templates:check
npm run video-engine:smoke
npm run typecheck
npm test
npm run build
```

`video-engine:setup` verifies Node, local FFmpeg/FFprobe, the Remotion browser, and a lint-clean
HyperFrames composition. `video-engine:smoke` performs real short MP4 renders with both engines,
probes the files with FFprobe, and applies a real cinematic LUT pass. Outputs go to the ignored
`tmp/video-engine-smoke/<timestamp>/` directory.

Distribution commands run `video-engine:bundle-remotion` automatically. The generated bundle is
ignored by Git and copied into packaged resources by Electron Builder. At runtime the factory
selects that prebuilt bundle automatically.

## Main-process usage

Create the service from Electron's main process. API keys remain optional and are passed at runtime;
the engine does not persist them.

```ts
import { app } from 'electron'
import { join } from 'node:path'
import { createVideoEngine } from './services/video-engine'

const engine = await createVideoEngine({
  dataRoot: join(app.getPath('userData'), 'video-engine'),
  renderConcurrency: 1,
  localBrollDirectories: ['D:\\Media\\B-roll'],
  brollCredentials: {
    pexelsApiKey: process.env.PEXELS_API_KEY,
    pixabayApiKey: process.env.PIXABAY_API_KEY,
  },
  remotion: {
    licenseKey: process.env.REMOTION_LICENSE_KEY,
  },
})
```

The factory injects the existing Sentry helpers into both renderer adapters. Direct Node scripts use
no-op telemetry, which keeps setup and smoke tools independent from Electron.

### Create a project and choose templates

```ts
const project = await engine.createProject({
  name: 'Episode 12',
  rendererId: 'remotion',
  width: 1920,
  height: 1080,
  fps: 30,
  durationFrames: 18_000,
})

const hooks = engine.listTemplates({
  rendererId: project.rendererId,
  kind: 'hook',
})

const captions = engine.listTemplates({
  rendererId: project.rendererId,
  kind: 'caption',
  capabilities: ['word-highlighting'],
})
```

Template IDs are renderer-specific and cannot leak across engines.

| Kind | Remotion | HyperFrames |
| --- | --- | --- |
| Hooks | `remotion-hook-kinetic-30`, `remotion-hook-cinematic-30` | `hyperframes-hook-kinetic-30`, `hyperframes-hook-cinematic-30` |
| Captions | `remotion-caption-*` | `hyperframes-caption-*` |
| Caption suffixes | `emoji-pop`, `clip-wipe`, `highlight`, `neon-accent`, `particle-burst`, `weight-shift` | Same |

### External-AI hook workflow

Do not accept arbitrary AI-generated JavaScript, JSX, HTML, or imports. Ask the external AI for a
data-only `HookPlan`:

```ts
const prompt = engine.buildHookPlanPrompt({
  rendererId: project.rendererId,
  templateId: 'remotion-hook-kinetic-30',
  fps: project.canvas.fps,
  title: 'Why most channels lose viewers in ten seconds',
  durationSeconds: 30,
  transcript: 'Optional narration or context',
  availableAssetIds: project.assets.map((asset) => asset.id),
})

// Paste the external AI's JSON response:
const compiled = await engine.importHookPlan(project.id, pastedJson)
console.log(engine.unresolvedHookBroll(compiled))
```

The importer rejects executable-shaped fields, unknown properties, invalid frame ranges, hooks over
30 seconds, renderer/template mismatches, unknown assets, and stale versions. It creates one trusted
template scene containing the full validated plan.

### Captions and important words

Word timings use frames and stable IDs:

```ts
await engine.setCaptions({
  projectId: project.id,
  language: 'en',
  templateId: 'remotion-caption-highlight',
  templateProps: {
    fontFamily: 'Hanken Grotesk',
    textColor: '#FFFFFF',
    activeColor: '#E6FF38',
    importantColor: '#FF5A45',
    maxWordsPerCue: 6,
  },
  words: [
    { id: 'word-001', text: 'This', startFrame: 0, endFrame: 8 },
    { id: 'word-002', text: 'changes', startFrame: 8, endFrame: 18 },
    { id: 'word-003', text: 'everything', startFrame: 18, endFrame: 30 },
  ],
})

// SRT is also accepted. Multi-word cue timings are distributed
// deterministically; true word timestamps are preferable when available.
await engine.setCaptionsFromSrt({
  projectId: project.id,
  srt: subtitleFileContents,
  templateId: 'remotion-caption-highlight',
})

const current = await engine.openProject(project.id)
const importantWordsPrompt = engine.buildImportantWordsPrompt(current, {
  purpose: 'Emphasize the central claim, numbers, and emotionally strong words.',
})

// Paste the external AI's JSON response:
await engine.applyImportantWordsResponse(project.id, pastedImportantWordsJson)

// Change the preset while retaining word timings and importance:
await engine.setCaptionTemplate(
  project.id,
  'remotion-caption-neon-accent',
  { activeColor: '#43F6FF', importantColor: '#FF4FD8' },
)
```

The response must contain exact word IDs and the current transcript hash. Unknown IDs, duplicates,
stale transcripts, executable fields, and excessive selections are rejected.

### Transitions and grading

```ts
await engine.applyTransitionTemplate(project.id, {
  templateId: 'remotion-transition-fade',
  fromSceneId: 'scene-a',
  toSceneId: 'scene-b',
  startFrame: 285,
  durationFrames: 15,
  easing: 'ease-in-out',
})

await engine.setGrading(project.id, {
  enabled: true,
  lutAssetId: 'lut-cinematic',
  lutIntensity: 0.72,
  exposure: 0.08,
  contrast: 0.1,
  saturation: 1.06,
  temperature: 0.05,
  tint: -0.02,
  vignette: 0.18,
  grain: 0.05,
})
```

The LUT must already be a project asset with `kind: 'lut'`. Grading runs once, after either renderer,
so final color behavior is consistent across engines.

### B-roll

Remote providers are disabled unless credentials are supplied. Local folders can be used without a
network connection.

```ts
const candidates = await engine.searchBroll(
  {
    query: 'rain over a city at night',
    orientation: 'landscape',
    minWidth: 1920,
    maxDurationMs: 12_000,
    safeSearch: true,
  },
  { providers: engine.broll.listProviders() },
)

const cached = await engine.cacheBroll(candidates[0])
await engine.placeBroll(project.id, {
  candidate: candidates[0],
  cached,
  startFrame: 300,
  durationFrames: 150,
})
```

Each cached asset is deduplicated by SHA-256 and keeps source, author, attribution, restrictions, and
license metadata. Provider terms can change; re-check them before release. Coverr is not enabled by
default and its current terms contain restrictions relevant to video-editing or competing stock
services.

### Render jobs

```ts
const unsubscribe = engine.onJobChanged((job) => {
  console.log(job.id, job.stage, job.progress)
})

const problems = await engine.preflightRender(project.id)
if (problems.some((problem) => problem.severity === 'error')) {
  throw new Error(JSON.stringify(problems))
}

const job = await engine.enqueueRender(project.id, 'episode-12.mp4')

// Later:
await engine.cancelRender(job.id)
await engine.retryRender(job.id)

unsubscribe()
await engine.shutdown()
```

The queue snapshots the validated project and its hash at enqueue time. Jobs survive restarts;
interrupted jobs recover to a retryable state. Paths are constrained to application-owned project
directories, and HyperFrames only deletes workspaces carrying its ownership marker.

## HyperFrames editing wrapper

For generated HyperFrames HTML, use `openHyperframesEditingSession` or
`openHyperframesCompositionFile`. The wrapper permits:

- `setText(dataHfId, text)`
- `setTimingFrames(dataHfId, timing, fps)`
- `setVariable(id, value)`
- batched edits, undo, redo, serialize, flush, and close

It deliberately does not provide raw script insertion, arbitrary attributes, or unvalidated
external code execution.

## Packaging and licensing

- Renderer-native binaries are unpacked from ASAR; the pinned HyperFrames registry and generated
  Remotion bundle are copied into packaged resources.
- Fonts and GSAP are vendored. Final rendering does not require Google Fonts or a CDN.
- Remotion uses a custom license. Confirm the appropriate Remotion license for an editor or
  automated video product before distributing this feature.
- Review every stock provider and community template license before enabling it for end users.

## UI layer

### Files

```text
src/features/video-studio/EngineSwitch.tsx        the render head (classic / remotion / hyperframes)
src/features/video-studio/VideoStudio.tsx         shell: preview + inspector + timeline + messages
src/features/video-studio/store/useVideoStudio.ts one zustand store; every mutation replaces `project`
src/features/video-studio/ui/kit.tsx              studio controls, self-demonstrating template thumbs
src/features/video-studio/preview/                @remotion/player and <hyperframes-player>
src/features/video-studio/timeline/               frame-addressed multi-track timeline
src/features/video-studio/panels/                 templates, hook, captions, transitions, grade,
                                                  b-roll, media, render
src/theme/pages/video-studio.css                  the `.vs-*` design system
```

The store never patches a local copy of the project: each IPC mutation returns the project the engine
persisted, and that becomes state. Revision conflicts and validation failures therefore surface as
errors instead of silent drift.

### `window.api.videoEngine`

Declared in `NativeApi` (`shared/types.ts`), bridged in `electron/preload.ts`, handled in
`electron/ipc/video-engine.ts`, and orchestrated by `electron/services/video-engine/studio.ts`.
Renderer-facing DTOs live in `shared/video-engine/ipc.ts` so the renderer never imports from
`electron/`.

A downloaded clip is *bound* to one engine project per renderer (`videoEngine.bindDownload`). Binding
seeds the project from the classic pipeline's own data — the MP3 as an audio asset, the ordered
stills with their ranges as media scenes, and the Groq transcript as word-timed captions — so the
studio opens on something immediately renderable. The mapping is stored in `app_meta` under
`ve.binding.<downloadId>`.

### Preview

Both previews run the real composition, not a lookalike:

- **Remotion**: `@remotion/player` mounts the same `RemotionVideo` component the renderer bundles.
- **HyperFrames**: the adapter's own `prepare()` stages a real workspace (vendored GSAP, fonts,
  copied assets, compiled `index.html`), and the studio drives it in a plain iframe.

  A compiled composition leaves every `.clip` at `visibility: hidden` — HyperFrames' browser runtime
  is what reveals them from `data-start`/`data-duration`, and the renderer injects that runtime
  itself. So `stageHyperframesPreview` writes a **second** entry, `preview.html`, which is
  `index.html` plus `<script src="./vendor/hyperframe.runtime.iife.js">`. The render entry stays
  byte-identical to what the renderer sees.

  The studio then talks to the runtime over its own postMessage channel rather than the packaged
  `<hyperframes-player>` web component, so the studio's playhead stays the single clock:

  ```text
  parent → frame  { source: 'hf-parent',  type: 'control', action: 'seek'|'play'|'pause', timeSeconds }
  frame  → parent { source: 'hf-preview', type: 'ready' | 'state' (frame, isPlaying) | 'timeline' }
  ```

Neither preview shows colour grading, because grading is a deterministic FFmpeg pass on the finished
file. The studio says so where the controls are.

Project media lives outside the renderer's origin and `file:` is unreachable under the app CSP, so
`electron/main.ts` registers a privileged **`mestudio://`** scheme confined to the engine's data root:

```text
mestudio://asset/<base64url absolute path>    one file (Remotion asset URIs are rewritten to this)
mestudio://hf/<projectId>/<relative path>     a staged HyperFrames workspace, so ./vendor/gsap.min.js
                                              and ./assets/* keep resolving inside the iframe
```

`resolvePreviewRequest` throws for anything that escapes the data root, which the protocol handler
turns into a 403. `index.html`'s CSP adds `mestudio:` to `img-src`, `media-src`, `font-src`,
`connect-src`, and `frame-src`.

### External-AI workflows

Two features hand off to any chat model and take a **data-only** answer back. Both use the same
copy-prompt / paste-JSON exchange, and both validate before anything touches a project:

- **Hook plans** (Hook panel) — `hookPrompt` → paste → `importHookPlan`. Rejects executable-shaped
  fields, unknown properties, bad frame ranges, hooks over 30s, renderer/template mismatches, and
  unknown assets. Beats that asked for b-roll are listed as unresolved and attachable from the B-roll
  panel.
- **Important words** (Captions panel) — `importantWordsPrompt` → paste → `applyImportantWords`. The
  answer must carry the current transcript hash and exact word IDs; stale or invented IDs are
  rejected. `setWordImportance` writes the same field manually, so the two paths are interchangeable.

### Extra runtime packages installed for the UI phase

`@remotion/player`, `@remotion/cli`, and `onda-engine`.

`onda-engine` is a standalone GPU scene-graph renderer (a Remotion *alternative* with its own
`react-reconciler` and wasm core), so its `Highlight` / `Underline` components cannot mount inside a
Remotion or HyperFrames composition. The behaviour they provide — accent on the spoken word,
underline on AI-selected important words — is implemented natively in both renderers
(`video-engine/remotion/captions.tsx`, `video-engine/hyperframes/compiler.ts`) and is what the
Active Highlight preset does. The same applies to the linked TikTok textbox component: the Clip Wipe
preset produces that rounded-box karaoke fill without importing an unmaintained package.
