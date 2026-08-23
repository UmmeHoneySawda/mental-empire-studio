# Cinematic Hooks and Captions — wiring design

Date: 2026-08-21
Status: approved for implementation
Scope: the Compose tab (Video Studio) only.

## Goal

Wire the ten templates delivered in `D:\Cinematic hooks and captions.zip` — five video hooks
and five caption systems — into Mental Empire Studio's Compose tab so a user can select any of
them, see them live in the `<Player>` preview, and render them to file. They appear under one
new accordion named **New Templates**, added to the existing Hook panel and Captions panel.

Nothing already in the app changes behaviour or appearance. Existing hooks, existing caption
styles, existing render settings and the render-performance phase are untouched.

Working copy of the delivered source: `scratch/cinematic-hooks-and-captions/` (gitignored).
`remotion/src/` there is the authoritative port target; `preview/` is the look reference.

## What the delivered templates are

Ten pure-function-of-time React components authored at 1920×1080, 30fps, in a film idiom:
type on black, 35mm grain and vignette above everything, no boxes, no rounded cards, one
accent per frame. Three fonts with fixed roles — **Cinzel** (statement), **Oswald** (impact),
**Courier Prime** (apparatus). Palette: black `#0B0A08`, bone `#ECE5D8`, dim bone 42%, accent
ember `#C9553C`.

| Delivered id | Name | Default length | Behind the text |
|---|---|---|---|
| Hook01TitleCard | Title Card | 4.0s | black |
| Hook02ReelBurn | Reel Burn | 5.0s | footage |
| Hook03HardLight | Hard Light | 3.5s | black + blinds |
| Hook04TrailerDrop | Trailer Drop | 6.0s | black |
| Hook05MarginNote | Margin Note | 5.5s | footage (right 66%) |
| Caption01WordPop | Word Pop | 6.0s | black |
| Caption02KeywordStack | Keyword Stack | 4.5s | black |
| Caption03ScrimRoll | Scrim Roll | 6.0s | footage |
| Caption04LineBuild | Line Build | 6.5s | black |
| Caption05Held | Held Statement | 4.0s | black |

Every template already reads `dur` from the composition rather than hardcoding its length, and
its exit is always `1 - MOTION.sweep(t, dur - x, x)`. Shortening the scene therefore retimes
the exit automatically. Only Caption 01 and Caption 04 need real per-word / per-line onsets;
the handoff explicitly instructs replacing their fixed `step` with measured timings.

## How the app renders templates today

- **Manifest registry.** `electron/services/video-engine/templates/builtins.ts` exports
  `BUILTIN_VIDEO_TEMPLATES`; `VideoTemplateRegistry` (`templates/registry.ts`) wraps it and is
  constructed with no arguments in `service.ts:218`. `videoEngine.templates()` lists from the
  registry, and `useEditor` loads that list into `state.templates`.
- **Hooks.** A hook is a `kind: 'template'` scene on the `video-engine-hook` overlay lane whose
  `template.props.hookPlan` is a validated `HookPlan`. `compileHookPlan`
  (`electron/services/video-engine/hook-compiler.ts`) requires the manifest, validates the
  plan against the manifest's duration range, and runs `resolveTemplateProps` — which **throws
  on any prop key not declared as a manifest parameter**. `hookPlan` is injected after that
  resolution, so it never needs a parameter.
- **Hook rendering.** `video-engine/remotion/scene.tsx` sends every template scene with a valid
  plan to the single generic `HookTemplate` (`hook.tsx`), where the template id only selects a
  style preset and an eyebrow string. There is no per-template component dispatch yet.
- **Captions.** Captions are project-wide: a `CaptionDocument` of word-timed `CaptionWord`s
  plus one `kind: 'caption'` scene (`video-engine-captions`) spanning the whole canvas.
  `setCaptionTemplate` requires the manifest, writes `captions.templateId`, and re-creates that
  scene with resolved props. `video-engine/remotion/captions.tsx` `CaptionLayer` resolves a
  `CaptionStyleDefinition` via `resolveCaptionStyle`, which falls back to `highlight` for any
  unknown id — so an unregistered style silently renders as an existing one.
- **Preview and render share one component.** `RemotionPreview` mounts `RemotionVideo` from
  `video-engine/remotion/composition.tsx` in `@remotion/player`; the render bundles the same
  component through `video-engine/remotion/entry.tsx`. One dispatch change therefore fixes both.
- **Fonts are self-hosted.** The renderer CSP forbids a font CDN. Renderer fonts come from
  `@fontsource/*` imports in `src/main.tsx`; the Remotion render bundle imports its own set in
  `video-engine/remotion/entry.tsx`.
- **UI.** The live Compose editor is `EditorShell` → `Inspector`. `Inspector` switches on
  `state.tab`; `tab === 'hook'` renders its local `HookPanel`, `tab === 'captions'` its local
  `CaptionsPanel`. Both are built from a static `Section` helper (`ve-section`) and `ve-list` /
  `ve-listitem` cards. The panels under `src/features/video-studio/panels/` belong to the older
  studio shell and are not in this path.

## Approach

Add a self-contained "new templates" layer beside the existing one, and join it at exactly
three dispatch points. Chosen over the two alternatives:

- *Rejected — extend `CAPTION_STYLE_IDS` / `CaptionStyleDefinition`.* That type fixes
  `fontFamily` to four grotesk/mono faces, so Cinzel, Oswald and Courier Prime cannot be
  expressed. It also routes the new captions through the existing `CaptionLayer`, whose page
  plates, pills and boxes are the exact idiom these templates forbid.
- *Rejected — express the new hooks as `HookStyleProps` presets.* `HookStylePropsSchema` is a
  closed vocabulary of five animation presets and five backgrounds. None of the five new hooks
  (light leak wipe, raking shaft with blinds, trailer flare, documentary column with running
  timecode) is reachable from it.

### One source of truth for the ten templates

New file `shared/video-engine/new-templates.ts`, re-exported by the existing
`shared/video-engine/index.ts` barrel, is the single definition of the set:
`NEW_HOOK_TEMPLATE_IDS`, `NEW_CAPTION_TEMPLATE_IDS`, the `NewHookTemplateId` /
`NewCaptionTemplateId` types, the `isNewHookTemplateId` / `isNewCaptionTemplateId` guards, and a
table per template carrying its display name, blurb, delivered default seconds, delivered grain
default, and — for captions — its `CaptionGroupingOptions` inputs. The Electron manifest builder,
the Remotion components and the accordion UI all read that one table, so a name or default can
never disagree across the three layers.

`shared/video-engine` already has no dependency beyond `zod`, and is already imported by
`electron/`, `video-engine/` and `src/` alike, so this adds no coupling.

### Registration

New file `electron/services/video-engine/templates/new-templates.ts` builds
`NEW_VIDEO_TEMPLATES` — ten manifests, all `rendererId: 'remotion'` — from that shared table.

`VideoTemplateRegistry`'s constructor becomes
`new TemplateRegistry([...BUILTIN_VIDEO_TEMPLATES, ...NEW_VIDEO_TEMPLATES, ...additional])`.

`BUILTIN_VIDEO_TEMPLATES` is deliberately left alone. Three existing tests assert exact counts
and exact id sets against that array (`renderers.test.ts` 7 hooks / 10 captions,
`hook-templates.test.ts` 7 hooks equal to `REMOTION_HOOK_TEMPLATE_IDS`,
`caption-styles.test.ts` captions equal to `CAPTION_STYLE_IDS.length`). Registering through the
registry keeps all three green with no edit, and still puts the new templates in
`videoEngine.templates()`, in preflight's installed-template check, and in
`compileHookPlan`/`setCaptionTemplate`.

Ids (all `StableIdSchema`-safe, and none ending in an existing caption style id, which would
be mis-resolved by `captionStyleIdFromTemplateId`'s suffix match):

```
remotion-hook-cine-title-card      remotion-caption-cine-word-pop
remotion-hook-cine-reel-burn       remotion-caption-cine-keyword-stack
remotion-hook-cine-hard-light      remotion-caption-cine-scrim-roll
remotion-hook-cine-trailer-drop    remotion-caption-cine-line-build
remotion-hook-cine-margin-note     remotion-caption-cine-held
```

Manifest shape for all ten: `schemaVersion: 1`, `version: '1.0.0'`, all five aspect ratios,
`minimumFrames: 12`, `maximumFrames: 7200`. Hook `defaultFrames` is the delivered length at
30fps (120 / 150 / 105 / 180 / 165); caption `defaultFrames: 90`. Hook capabilities
`['audio', 'broll', 'dynamic-duration', 'transitions']`; caption capabilities
`['captions', 'dynamic-duration', 'word-highlighting']`. Every hook is tagged `['hook',
'cinematic', 'new-templates', …]` and every caption `['caption', 'cinematic',
'new-templates', …]`, so the accordion can find them by tag rather than by hardcoded list.### Parameters

`resolveTemplateProps` throws on undeclared keys, so every string the templates render is a
declared parameter with the delivered default as its `default`.

| Template | Parameters |
|---|---|
| Title Card | `line`, `kicker`, `accentColor`, `grain` |
| Reel Burn | `lineA`, `lineB`, `accentColor`, `grain` |
| Hard Light | `lineA`, `lineB`, `grain` |
| Trailer Drop | `beatA`, `beatB`, `drop`, `accentColor`, `grain` |
| Margin Note | `line`, `reel`, `startTimecodeSeconds`, `accentColor`, `grain` |
| all five captions | `accentColor`, `textColor`, `grain`, `maxWordsPerCue`, `maxCharactersPerLine` |

`grain` is `number` 0–1, defaulting per template to the delivered value — Title Card 0.55, Reel
Burn 0.70, Hard Light 0.45, Trailer Drop 0.50, Margin Note 0.60, every caption 0.35.
`accentColor` defaults to ember `#C9553C` and caption `textColor` to bone `#ECE5D8`.
`startTimecodeSeconds` is an integer 0–86399, default 761 (the delivered `12*60 + 41`).
`maxWordsPerCue` is 1–12 and `maxCharactersPerLine` 10–42, matching the bounds
`resolveCaptionStyle` already enforces elsewhere; each caption template's defaults come from its
row in the shared table.

Text that should be accented is wrapped in asterisks — `"still paying *rent* in your head"` —
exactly as the delivered `Mark` helper expects. This applies to `lineB` and `drop`.

### Hook rendering

New directory `video-engine/remotion/new-templates/`:

- `kit.tsx` — the delivered `theme.tsx` and `film.tsx` ported: `SERIF`/`COND`/`MONO`, the
  palette, `clamp`, `Ease`, the three `MOTION` helpers, `Mark`, `Grain`, `Dust`, `Vignette`,
  `Weave`, `FilmFrame`. Two deliberate departures from the delivered source, both required by
  the app's compositional model:
  - `FilmFrame` takes a `background` prop. Footage-backed templates pass `'transparent'` so the
    clip on the timeline underneath shows through, which is how a hook on an overlay lane
    composites here. The delivered striped `FootagePlate` placeholder is dropped — it exists to
    make a standalone catalog readable and has no place in a product render.
  - `FilmFrame` takes `vignette` and `dust` flags, so the caption layer can carry grain without
    also stamping a vignette over the user's whole video.
- `hooks.tsx` — the five components, each a pure function of `useCurrentFrame()/fps` with the
  delivered beat times and easings unchanged. Sizes that are absolute pixels in the source are
  multiplied by `width / 1920` so 9:16 and 1:1 canvases stay legible; Hook 05's two-column
  split collapses to a stacked column when the canvas is taller than it is wide
  (`width < height`), per the delivered handoff's vertical note.
- `captions.tsx` — the five caption layers (below).
- `index.ts` — `NewHookScene`, `NewCaptionLayer`, and a re-export of the shared id guards.

`scene.tsx` gains one branch at the top of its `scene.kind === 'template'` case:

```tsx
if (isNewHookTemplateId(scene.template?.id)) {
  return <NewHookScene project={project} scene={scene} assetById={assetById} />
}
```

The existing `hasValidHookPlan` / `TrustedTemplateFallback` lines below it are unchanged.

### Hook content model

Each new hook is compiled as a **single-beat** `HookPlan` so the Beats list stays meaningful
and `HookPlanSchema` is satisfied. The beat's `headline` is the template's primary line and its
`body`, where the template has a natural second line, is the secondary line:

| Template | `beats[0].headline` | `beats[0].body` | from props |
|---|---|---|---|
| Title Card | `line` | — | `kicker` |
| Reel Burn | `lineA` | `lineB` | — |
| Hard Light | `lineA` | `lineB` | — |
| Trailer Drop | `drop` | — | `beatA`, `beatB` |
| Margin Note | `line` | — | `reel`, `startTimecodeSeconds` |

Components read the primary/secondary line from the beat first and fall back to the matching
prop, so editing a line in the existing Beats list changes the render. All other strings come
from props only. `visual: { kind: 'none' }` on every beat — footage comes from the timeline
underneath, not from a beat asset.

The plan goes out through the existing `importHookPlan`, which is the same validated path the
premade and AI hooks use. No new IPC method, no second compiler.

### Caption rendering

The five caption layers are driven by the project's real caption document, not by fixed text.
`groupCaptionCues` already turns words into cues with wrapped lines; each new template supplies
its own grouping options (words per cue, characters per line, max lines, max cue seconds, max
gap seconds) through the same `CaptionGroupingOptions` shape the existing styles use. This
satisfies the delivered handoff's retiming instruction for Caption 01 and 04 directly: onsets
come from `CaptionWord.startFrame`, never from a fixed `step`.

| Template | Type | Behaviour |
|---|---|---|
| Cine Word Pop | Oswald 600 caps | cue's words centred; each word `MOTION.pop`s at its own `startFrame`; the word being spoken burns accent |
| Cine Keyword Stack | Cinzel | first line dim as setup, remaining lines bone as payoff; the cue's first important word (else the spoken word) turns accent as a rule swipes under it, timed to that word |
| Cine Scrim Roll | Courier Prime | lower third over a soft scrim gradient; lines rise staggered by line index; blinking accent block after the last line; `NARRATION` label |
| Cine Line Build | Oswald | the current cue's lines plus up to three earlier cues' closing lines stacked upward, drifting and dimming with age; the newest line lands in accent |
| Cine Held | Cinzel | cue centred, letterspacing tightening across the cue's life; the important word switches to accent with glow; hairline rule beneath |

`composition.tsx` changes one line — `<CaptionLayer project={project} />` becomes a conditional
that mounts `NewCaptionLayer` when `project.captions?.templateId` is one of the five new ids and
the original `CaptionLayer` otherwise. Exactly one caption layer renders, so there is no
double-drawn text and no behaviour change for existing styles.

Grain for captions defaults to `0.35` and is applied continuously across the caption scene —
which spans the whole canvas — rather than per cue, so it can never flicker on and off between
cues. No vignette and no gate weave on the caption layer: those belong to a full-frame
treatment, and a caption style has no business moving the user's footage. Setting `grain` to 0
turns the film texture off entirely.

### Fonts

Add `@fontsource/cinzel`, `@fontsource/oswald` and `@fontsource/courier-prime` to
`package.json` (Oswald is already present in `node_modules` as a transitive dependency but is
not declared, so it must be declared). Import the needed weights in both font entry points —
`src/main.tsx` for the live `<Player>` and `video-engine/remotion/entry.tsx` for the render
bundle. Weights: Cinzel 400/700, Oswald 300/400/600/700, Courier Prime 400. Both edits are
appended import lines; no existing import moves.

`src/render-worker/index.ts` is the GPU canvas encoder for the separate fast-preview path and
draws no Remotion component, so it is out of scope.

### The accordion

New `src/features/video-studio/editor/NewTemplatesAccordion.tsx`, rendered once at the top of
`Inspector`'s `HookPanel` with `kind="hook"` and once at the top of its `CaptionsPanel` with
`kind="caption"`. Two added JSX lines and one import in `Inspector.tsx`; nothing existing moves.

It is a `<details className="ve-newtpl">` element with `<summary>New Templates</summary>` —
collapsed by default, so neither panel changes on first sight. `<details>` is already the
editor's accordion idiom (`details.ve-bin-cycle` in `MediaBin`, the model-prompt disclosure in
`HookPanel`). Styling is a block appended to `editor.css` reusing the existing `--ve-*` tokens.

Hook mode: a `ve-list` of the five cards, then the selected template's text inputs, a length
slider in seconds seeded from the manifest's `defaultFrames / fps`, an accent colour input, a
grain slider, and an **Add this hook** button that builds the single-beat plan and calls
`importHookPlan`.

Caption mode: a `ve-list` of the five cards with `is-on` on the persisted
`captions.templateId`, then accent colour, text colour, grain, words per cue and characters per
line. Clicking a card calls `setCaptionTemplate(id, props)`. When the project has no caption
words the cards are disabled with a hint pointing at Transcribe / Import SRT above.

Template metadata for the accordion — display name, blurb, default seconds and the field list
per template — comes from the shared table in `shared/video-engine/new-templates.ts`. A new
`src/features/video-studio/editor/newTemplates.ts` holds only the renderer-side pieces: the
per-template input field descriptors and the `newHookPlan()` single-beat plan builder, keeping
the component free of data tables.

## Files

New:

1. `shared/video-engine/new-templates.ts`
2. `video-engine/remotion/new-templates/kit.tsx`
3. `video-engine/remotion/new-templates/hooks.tsx`
4. `video-engine/remotion/new-templates/captions.tsx`
5. `video-engine/remotion/new-templates/index.ts`
6. `electron/services/video-engine/templates/new-templates.ts`
7. `src/features/video-studio/editor/newTemplates.ts`
8. `src/features/video-studio/editor/NewTemplatesAccordion.tsx`
9. `test/unit/video-engine/new-templates.test.ts`
10. `scripts/e2e-new-templates.mjs`

Modified, minimally and additively:

1. `shared/video-engine/index.ts` — one `export * from './new-templates'`
2. `electron/services/video-engine/templates/registry.ts` — spread `NEW_VIDEO_TEMPLATES` into the registry
3. `video-engine/remotion/scene.tsx` — one new-hook branch
4. `video-engine/remotion/composition.tsx` — caption layer conditional
5. `video-engine/remotion/entry.tsx` — three font imports
6. `src/main.tsx` — three font imports
7. `src/features/video-studio/editor/Inspector.tsx` — accordion in both panels
8. `src/features/video-studio/editor/editor.css` — appended `.ve-newtpl` block
9. `package.json` — three `@fontsource` dependencies

## Testing

**Unit** (`test/unit/video-engine/new-templates.test.ts`, plain Node, no Electron):

- all ten manifests parse under `TemplateManifestSchema` and are reachable through
  `new VideoTemplateRegistry().require(id)`
- the ten new ids are disjoint from `BUILTIN_VIDEO_TEMPLATES`, and no existing `CaptionStyleId`
  is a `-<styleId>` suffix of any new caption id, so `captionStyleIdFromTemplateId` can never
  mistake one for an existing style
- `BUILTIN_VIDEO_TEMPLATES` still holds exactly 7 remotion hooks and 10 remotion captions, so
  the additive claim is asserted rather than assumed
- `resolveTemplateProps(manifest, {})` succeeds for all ten and returns every declared default
- `newHookPlan` produces a `HookPlanSchema`-valid single-beat plan at 24, 30 and 60 fps whose
  beat exactly fills `durationFrames`, and `compileHookPlan` accepts it for each of the five
  hooks
- the caption grouping options of each new template produce one-or-two-line cues from a
  synthetic word list and preserve sentence punctuation

**Live** (`scripts/e2e-new-templates.mjs`, real Electron through Playwright, throwaway
userData, modelled on `scripts/e2e-studio.mjs`): boot, dismiss onboarding, bind the seeded clip,
import `test/fixtures/broll/local/clip1.mp4` (6.0s, verified by ffprobe) and place it on
`main-video` so the footage-backed templates have real footage underneath, import captions from
a generated SRT so no Groq key is needed, then for each of the five hooks and each of the five
captions: open the New Templates accordion, click the card, apply, wait for the project to
persist the expected `template.id`, seek the playhead to several frames inside it, and capture
a screenshot to `browser-test-out/new-templates/`. Asserts `.ve-player-error` never appears, no
renderer console errors accumulate, `preflight` returns no errors, and userData stayed inside
the scratch profile.

`npm run typecheck` and `npm run build` gate the change. `npm run userdata:backup` runs before
anything launches the app.

## Out of scope

Render-performance work of any kind. The HyperFrames renderer — these are Remotion components
and the manifests are Remotion-only, so the HyperFrames engine keeps its current ten. The
automation pipeline, Profiles presets, and the older `src/features/video-studio/panels/` shell.
Vertical-specific redesign beyond the aspect-aware scaling described above.
