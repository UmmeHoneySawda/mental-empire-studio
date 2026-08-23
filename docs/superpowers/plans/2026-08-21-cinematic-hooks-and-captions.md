# Cinematic Hooks and Captions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the five new cinematic video hooks and five new caption systems from
`scratch/cinematic-hooks-and-captions/` into the Compose tab under one new **New Templates**
accordion, live in the `<Player>` preview and in the final render, without changing any existing
behaviour.

**Architecture:** A self-contained "new templates" layer sits beside the existing one and joins
it at three dispatch points. `shared/video-engine/new-templates.ts` is the single definition of
the ten templates (ids, names, defaults, caption paging). `electron/services/video-engine/templates/new-templates.ts`
turns that table into ten `TemplateManifest`s registered through `VideoTemplateRegistry` — never
through `BUILTIN_VIDEO_TEMPLATES`, so every existing count assertion stays green.
`video-engine/remotion/new-templates/` holds the ported components; `scene.tsx` gains one
new-hook branch and `composition.tsx` one caption-layer conditional. The UI is one collapsed
`<details>` accordion added to the top of `Inspector`'s Hook and Captions panels.

**Tech Stack:** Electron 32, React 19, TypeScript 5.6, Remotion 4.0.502 (`remotion`,
`@remotion/player`, `@remotion/bundler`), zod 4.4.3, zustand, vitest 2, Playwright 1.49,
`@fontsource/*` self-hosted fonts.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-21-cinematic-hooks-and-captions-design.md` before starting. It is the contract.
- The delivered source of truth is `scratch/cinematic-hooks-and-captions/remotion/src/` (gitignored working copy). `preview/` there is the look reference.
- **Additive only.** Do not change the behaviour, appearance, or signature of anything that already exists. The only permitted edits to existing files are the nine listed in the spec's "Modified" section, and each is an appended line, an appended block, or one new conditional branch.
- **Never touch `BUILTIN_VIDEO_TEMPLATES`.** Three existing tests assert exact counts and id sets against it.
- **Render performance is a closed phase.** Do not touch render or grade filter chains, encoder flags, or Remotion render options. Read `docs/RENDER-PERFORMANCE.md` only if you think you need to — you do not.
- Every component must be a pure function of the current frame. No `useEffect`, no `requestAnimationFrame`, no CSS `animation`/`transition`, no `Math.random`, no `Date.now`. Frame N must render identically on every machine or the render flickers and the scrubber lies.
- Only three motion helpers exist — `MOTION.rise`, `MOTION.sweep`, `MOTION.pop`. Do not add a fourth easing.
- Fonts are self-hosted through `@fontsource/*`. The renderer CSP forbids a font CDN. Never add a CDN `@import` or `<link>`.
- Type roles are fixed: Cinzel = statement, Oswald = impact, Courier Prime = apparatus. Do not swap them.
- No boxes behind text. Separation comes from a scrim gradient or a vignette, never a filled rectangle or a left-border accent bar.
- New template ids, verbatim:
  - `remotion-hook-cine-title-card`, `remotion-hook-cine-reel-burn`, `remotion-hook-cine-hard-light`, `remotion-hook-cine-trailer-drop`, `remotion-hook-cine-margin-note`
  - `remotion-caption-cine-word-pop`, `remotion-caption-cine-keyword-stack`, `remotion-caption-cine-scrim-roll`, `remotion-caption-cine-line-build`, `remotion-caption-cine-held`
- Palette constants, verbatim: black `#0b0a08`, bone `#ECE5D8`, dim `rgba(236,229,216,0.42)`, accent ember `#C9553C`. **Hex is canonicalised to UPPERCASE** across the new modules so identity comparisons cannot drift between the shared table, the manifests and the components. Lowercase hex is permitted only inside a comment's prose.
- `resolveTemplateProps` throws on any prop key that is not a declared manifest parameter. Every value a component reads from `scene.template.props` must be a declared parameter.
- Do not commit or push. `AGENTS.md` forbids it unless the user asks.
- Verification for every task: `npm run typecheck` must pass. Tasks that touch tests also run `npm test`.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/video-engine/new-templates.ts` | **New.** Ids, types, guards, the ten definition rows, caption style resolution, caption grouping options. Zero React, zod-only dependency. |
| `shared/video-engine/index.ts` | **Modify.** One `export * from './new-templates'`. |
| `electron/services/video-engine/templates/new-templates.ts` | **New.** Builds the ten `TemplateManifest`s from the shared table. |
| `electron/services/video-engine/templates/registry.ts` | **Modify.** Spread `NEW_VIDEO_TEMPLATES` into the registry. |
| `video-engine/remotion/new-templates/kit.tsx` | **New.** Ported theme + film primitives: fonts, palette, `Ease`, `MOTION`, `Mark`, `Grain`, `Dust`, `Vignette`, `Weave`, `FilmFrame`, prop readers. |
| `video-engine/remotion/new-templates/hooks.tsx` | **New.** The five hook components + `NewHookScene` dispatcher. |
| `video-engine/remotion/new-templates/captions.tsx` | **New.** The five caption bodies + `NewCaptionLayer`. |
| `video-engine/remotion/new-templates/index.ts` | **New.** Barrel: `NewHookScene`, `NewCaptionLayer`, re-exported guards. |
| `video-engine/remotion/scene.tsx` | **Modify.** One new-hook branch. |
| `video-engine/remotion/composition.tsx` | **Modify.** Caption-layer conditional. |
| `video-engine/remotion/entry.tsx` | **Modify.** Three font imports. |
| `src/main.tsx` | **Modify.** Three font imports. |
| `src/features/video-studio/editor/newTemplates.ts` | **New.** `newHookPlan()` and the accordion's field descriptors. |
| `src/features/video-studio/editor/NewTemplatesAccordion.tsx` | **New.** The `New Templates` accordion, hook and caption modes. |
| `src/features/video-studio/editor/Inspector.tsx` | **Modify.** Mount the accordion in `HookPanel` and `CaptionsPanel`. |
| `src/features/video-studio/editor/editor.css` | **Modify.** Appended `.ve-newtpl` block. |
| `package.json` | **Modify.** Three `@fontsource` dependencies. |
| `test/unit/video-engine/new-templates.test.ts` | **New.** Manifest, registry, additivity, plan and paging tests. |
| `scripts/e2e-new-templates.mjs` | **New.** Live Electron verification of all ten templates. |

---

### Task 1: Snapshot user data, then install and wire the three fonts

The delivered templates use Cinzel, Oswald and Courier Prime. None is declared in
`package.json`. Both font entry points need them: `src/main.tsx` for the live `<Player>` inside
the Electron renderer, and `video-engine/remotion/entry.tsx` for the webpack bundle the final
render loads. A missing face renders in a fallback and shifts every letterspacing measurement,
so this lands before any component.

**Files:**
- Modify: `package.json:45-84` (the `dependencies` block)
- Modify: `src/main.tsx:1-16`
- Modify: `video-engine/remotion/entry.tsx:1-7`

**Interfaces:**
- Consumes: nothing.
- Produces: the CSS families `Cinzel`, `Oswald` and `Courier Prime`, available to both the renderer and the Remotion bundle.

- [ ] **Step 1: Snapshot user data before anything else**

`AGENTS.md` requires this before any task that may launch the app or write settings. Agents have
wiped this data before.

```bash
npm run userdata:backup
```

Expected: a new `CLAUDE-BACKUP-*` folder is reported with checksums. If the command fails, stop
and report — do not continue.

- [ ] **Step 2: Install the three font packages**

Oswald already exists in `node_modules` as a transitive dependency but is **not declared**, so it
must be installed explicitly or a clean install will drop it.

```bash
npm install --save --save-exact @fontsource/cinzel@5.3.0 @fontsource/oswald@5.3.0 @fontsource/courier-prime@5.3.0
```

Expected: `package.json` `dependencies` gains exactly those three entries. Confirm the weight
files exist:

```bash
node -e "for (const p of ['@fontsource/cinzel/400.css','@fontsource/cinzel/700.css','@fontsource/oswald/300.css','@fontsource/oswald/400.css','@fontsource/oswald/600.css','@fontsource/oswald/700.css','@fontsource/courier-prime/400.css']) require.resolve(p); console.log('all font stylesheets resolve')"
```

Expected: `all font stylesheets resolve`.

- [ ] **Step 3: Import the faces in the renderer entry**

In `src/main.tsx`, immediately after the existing `import '@fontsource/anton/400.css'` line and
before `import '@fontsource-variable/archivo'`, add:

```ts
// Cinzel / Oswald / Courier Prime carry the fixed type roles of the New Templates set —
// statement, impact, apparatus. The live <Player> renders from the renderer's own CSS, so
// they have to be here as well as in the Remotion bundle entry.
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/oswald/300.css'
import '@fontsource/oswald/400.css'
import '@fontsource/oswald/600.css'
import '@fontsource/oswald/700.css'
import '@fontsource/courier-prime/400.css'
```

Do not reorder or remove any existing import.

- [ ] **Step 4: Import the same faces in the Remotion bundle entry**

In `video-engine/remotion/entry.tsx`, after the existing
`import '@fontsource/space-grotesk/700.css'` line and before `import { registerRoot } from 'remotion'`, add the identical seven imports with the same comment.

- [ ] **Step 5: Verify both bundles compile and actually carry the faces**

```bash
npm run typecheck
npm run build
```

Expected: both pass. Then confirm the faces reached the renderer bundle:

```bash
node -e "const fs=require('fs'),p=require('path');const d='out/renderer/assets';const css=fs.readdirSync(d).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(p.join(d,f),'utf8')).join('');for(const f of ['Cinzel','Oswald','Courier Prime'])if(!css.includes(f))throw new Error('missing '+f);console.log('renderer css declares all three families')"
```

Expected: `renderer css declares all three families`. If `out/renderer/assets` does not exist,
list `out/renderer` and search whichever directory holds the emitted CSS.

- [ ] **Step 6: Report**

State the installed versions and that both checks passed. Do not commit.

---

### Task 2: The shared definition table

One table, read by the Electron manifest builder, the Remotion components and the accordion UI,
so a name or default can never disagree across the three layers. Zero React; zod-only dependency,
matching the rest of `shared/video-engine`.

**Files:**
- Create: `shared/video-engine/new-templates.ts`
- Modify: `shared/video-engine/index.ts` (append one export line)
- Test: `test/unit/video-engine/new-templates.test.ts` (created here, extended by Tasks 3 and 7)

**Interfaces:**
- Consumes: `CaptionGroupingOptions` and `JsonObject` from the sibling modules in `shared/video-engine`.
- Produces:
  - `NEW_HOOK_TEMPLATE_IDS: readonly [5 ids]`, `NEW_CAPTION_TEMPLATE_IDS: readonly [5 ids]`
  - `type NewHookTemplateId`, `type NewCaptionTemplateId`
  - `isNewHookTemplateId(id: string | undefined | null): id is NewHookTemplateId`
  - `isNewCaptionTemplateId(id: string | undefined | null): id is NewCaptionTemplateId`
  - `NEW_TEMPLATE_ACCENT: '#c9553c'`, `NEW_TEMPLATE_BONE: '#ece5d8'`
  - `interface NewTemplateTextField { key: string; label: string; default: string; maxLength: number; role: 'headline' | 'body' | 'prop'; hint?: string }`
  - `interface NewTemplateNumberField { key: string; label: string; default: number; minimum: number; maximum: number; integer: boolean }`
  - `interface NewHookDefinition { id: NewHookTemplateId; name: string; description: string; defaultSeconds: number; grain: number; usesAccent: boolean; textFields: readonly NewTemplateTextField[]; numberFields: readonly NewTemplateNumberField[] }`
  - `NEW_HOOK_DEFINITIONS: Readonly<Record<NewHookTemplateId, NewHookDefinition>>`
  - `interface NewCaptionDefinition { id: NewCaptionTemplateId; name: string; description: string; grain: number; textColor: string; accentColor: string; fontScale: number; maxWordsPerCue: number; maxCharactersPerLine: number; maxLines: number; maxDurationSeconds: number; maxGapSeconds: number }`
  - `NEW_CAPTION_DEFINITIONS: Readonly<Record<NewCaptionTemplateId, NewCaptionDefinition>>`
  - `interface ResolvedNewCaptionStyle extends NewCaptionDefinition {}`
  - `resolveNewCaptionStyle(templateId: string | undefined, props?: JsonObject): ResolvedNewCaptionStyle | null`
  - `captionGroupingOptionsForNewTemplate(style: ResolvedNewCaptionStyle, fps: number): CaptionGroupingOptions`

- [ ] **Step 1: Write the failing test**

Create `test/unit/video-engine/new-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CAPTION_STYLE_IDS,
  NEW_CAPTION_DEFINITIONS,
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  captionGroupingOptionsForNewTemplate,
  captionStyleIdFromTemplateId,
  isNewCaptionTemplateId,
  isNewHookTemplateId,
  resolveNewCaptionStyle,
} from '../../../shared/video-engine'

describe('new template definitions', () => {
  it('declares five hooks and five captions with stable ids', () => {
    expect(NEW_HOOK_TEMPLATE_IDS).toHaveLength(5)
    expect(NEW_CAPTION_TEMPLATE_IDS).toHaveLength(5)
    const all = [...NEW_HOOK_TEMPLATE_IDS, ...NEW_CAPTION_TEMPLATE_IDS]
    expect(new Set(all).size).toBe(10)
    for (const id of all) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
  })

  it('guards only recognise their own ids', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      expect(isNewHookTemplateId(id)).toBe(true)
      expect(isNewCaptionTemplateId(id)).toBe(false)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      expect(isNewCaptionTemplateId(id)).toBe(true)
      expect(isNewHookTemplateId(id)).toBe(false)
    }
    expect(isNewHookTemplateId(undefined)).toBe(false)
    expect(isNewCaptionTemplateId('remotion-caption-highlight')).toBe(false)
  })

  it('never lets a new caption id be mistaken for an existing style', () => {
    // captionStyleIdFromTemplateId matches an existing style by "-<styleId>" suffix. A new id
    // that happened to end that way would silently render as the old style instead.
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      for (const styleId of CAPTION_STYLE_IDS) {
        expect(id.endsWith(`-${styleId}`), `${id} vs ${styleId}`).toBe(false)
      }
      expect(captionStyleIdFromTemplateId(id)).toBe('highlight')
    }
  })

  it('gives every hook a headline field, a default, and a real length', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      expect(definition.id).toBe(id)
      expect(definition.name.length).toBeGreaterThan(0)
      expect(definition.description.length).toBeGreaterThan(0)
      expect(definition.defaultSeconds).toBeGreaterThan(0)
      expect(definition.defaultSeconds).toBeLessThanOrEqual(30)
      expect(definition.grain).toBeGreaterThanOrEqual(0)
      expect(definition.grain).toBeLessThanOrEqual(1)
      const roles = definition.textFields.map((field) => field.role)
      expect(roles.filter((role) => role === 'headline')).toHaveLength(1)
      expect(roles.filter((role) => role === 'body').length).toBeLessThanOrEqual(1)
      for (const field of definition.textFields) {
        expect(field.default.length).toBeGreaterThan(0)
        expect(field.default.length).toBeLessThanOrEqual(field.maxLength)
      }
      expect(new Set(definition.textFields.map((field) => field.key)).size)
        .toBe(definition.textFields.length)
    }
  })

  it('resolves caption props inside their bounds and rejects unknown ids', () => {
    expect(resolveNewCaptionStyle('remotion-caption-highlight')).toBeNull()
    expect(resolveNewCaptionStyle(undefined)).toBeNull()
    const base = resolveNewCaptionStyle('remotion-caption-cine-word-pop')!
    expect(base.id).toBe('remotion-caption-cine-word-pop')
    expect(base).toEqual(NEW_CAPTION_DEFINITIONS['remotion-caption-cine-word-pop'])

    const overridden = resolveNewCaptionStyle('remotion-caption-cine-word-pop', {
      accentColor: '#00ffaa',
      textColor: 'not a colour',
      grain: 5,
      maxWordsPerCue: 99,
      maxCharactersPerLine: 1,
    })!
    expect(overridden.accentColor).toBe('#00FFAA')
    expect(overridden.textColor).toBe(base.textColor)
    expect(overridden.grain).toBe(1)
    expect(overridden.maxWordsPerCue).toBe(12)
    expect(overridden.maxCharactersPerLine).toBe(10)
  })

  it.each([24, 30, 60])('derives deterministic frame paging at %i fps', (fps) => {
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const style = resolveNewCaptionStyle(id)!
      const options = captionGroupingOptionsForNewTemplate(style, fps)
      expect(options.maxDurationFrames).toBe(Math.round(style.maxDurationSeconds * fps))
      expect(options.maxGapFrames).toBe(Math.round(style.maxGapSeconds * fps))
      expect(options.maxCharactersPerCue).toBe(style.maxCharactersPerLine * style.maxLines)
      expect(options.maxLines).toBeLessThanOrEqual(3)
      expect(options.preferSentenceBreaks).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts
```

Expected: FAIL — the imports do not resolve (`NEW_HOOK_TEMPLATE_IDS` is not exported).

- [ ] **Step 3: Create `shared/video-engine/new-templates.ts`**

```ts
import type { CaptionGroupingOptions } from './captions'
import { HexColorSchema, type JsonObject } from './common'

/* The Cinematic Hooks and Captions set — five hooks and five caption systems delivered as
 * Remotion components and ported in `video-engine/remotion/new-templates/`.
 *
 * This module is the ONLY definition of the set. The Electron manifest builder, the Remotion
 * components and the editor accordion all read it, so a display name, a default line or a
 * paging limit cannot drift between the three layers. It stays free of React and of anything
 * beyond the sibling shared modules, because Electron main imports it too. */

export const NEW_HOOK_TEMPLATE_IDS = [
  'remotion-hook-cine-title-card',
  'remotion-hook-cine-reel-burn',
  'remotion-hook-cine-hard-light',
  'remotion-hook-cine-trailer-drop',
  'remotion-hook-cine-margin-note',
] as const
export type NewHookTemplateId = (typeof NEW_HOOK_TEMPLATE_IDS)[number]

export const NEW_CAPTION_TEMPLATE_IDS = [
  'remotion-caption-cine-word-pop',
  'remotion-caption-cine-keyword-stack',
  'remotion-caption-cine-scrim-roll',
  'remotion-caption-cine-line-build',
  'remotion-caption-cine-held',
] as const
export type NewCaptionTemplateId = (typeof NEW_CAPTION_TEMPLATE_IDS)[number]

const NEW_HOOK_ID_SET: ReadonlySet<string> = new Set(NEW_HOOK_TEMPLATE_IDS)
const NEW_CAPTION_ID_SET: ReadonlySet<string> = new Set(NEW_CAPTION_TEMPLATE_IDS)

export function isNewHookTemplateId(id: string | undefined | null): id is NewHookTemplateId {
  return typeof id === 'string' && NEW_HOOK_ID_SET.has(id)
}

export function isNewCaptionTemplateId(id: string | undefined | null): id is NewCaptionTemplateId {
  return typeof id === 'string' && NEW_CAPTION_ID_SET.has(id)
}

/** Ember. The set allows exactly one accent per video, and this is its default. */
export const NEW_TEMPLATE_ACCENT = '#c9553c'
export const NEW_TEMPLATE_BONE = '#ece5d8'

export interface NewTemplateTextField {
  readonly key: string
  readonly label: string
  readonly default: string
  readonly maxLength: number
  /** headline and body are also written onto the plan's single beat, so the existing Beats
   *  list edits the same line the accordion does. Everything else lives only in props. */
  readonly role: 'headline' | 'body' | 'prop'
  readonly hint?: string
}

export interface NewTemplateNumberField {
  readonly key: string
  readonly label: string
  readonly default: number
  readonly minimum: number
  readonly maximum: number
  readonly integer: boolean
}

export interface NewHookDefinition {
  readonly id: NewHookTemplateId
  readonly name: string
  readonly description: string
  /** The delivered length. Internal beat times scale with dur / defaultSeconds, so the
   *  choreography is byte-identical here and keeps its proportions at any other length. */
  readonly defaultSeconds: number
  readonly grain: number
  readonly usesAccent: boolean
  readonly textFields: readonly NewTemplateTextField[]
  readonly numberFields: readonly NewTemplateNumberField[]
}

const HOOKS: Record<NewHookTemplateId, NewHookDefinition> = {
  'remotion-hook-cine-title-card': {
    id: 'remotion-hook-cine-title-card',
    name: 'Cine · Title Card',
    description:
      'Prestige film open on black. A hairline rule opens, the statement rises, its letterspacing settles, and a monospace kicker lands underneath.',
    defaultSeconds: 4,
    grain: 0.55,
    usesAccent: true,
    textFields: [
      {
        key: 'line',
        label: 'Statement',
        default: "THAT ISN'T THE ENDING.",
        maxLength: 500,
        role: 'headline',
        hint: 'Cinzel has no true lowercase — write this in capitals.',
      },
      { key: 'kicker', label: 'Kicker', default: 'ON LEAVING', maxLength: 120, role: 'prop' },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-reel-burn': {
    id: 'remotion-hook-cine-reel-burn',
    name: 'Cine · Reel Burn',
    description:
      'A 35mm light leak sweeps across your footage and wipes the line in, then a warm flash takes it out.',
    defaultSeconds: 5,
    grain: 0.7,
    usesAccent: true,
    textFields: [
      { key: 'lineA', label: 'First line', default: "They didn't reach out", maxLength: 500, role: 'headline' },
      {
        key: 'lineB',
        label: 'Second line',
        default: 'when you were *falling apart*.',
        maxLength: 500,
        role: 'body',
        hint: 'Wrap one word in *asterisks* to make it the accent word.',
      },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-hard-light': {
    id: 'remotion-hook-cine-hard-light',
    name: 'Cine · Hard Light',
    description:
      'Noir. A shaft rakes in through blinds and condensed slab capitals slide out of the shadow with a hard cut out.',
    defaultSeconds: 3.5,
    grain: 0.45,
    usesAccent: false,
    textFields: [
      { key: 'lineA', label: 'First line', default: "You've been braced", maxLength: 300, role: 'headline' },
      { key: 'lineB', label: 'Second line', default: 'for the explosion.', maxLength: 300, role: 'body' },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-trailer-drop': {
    id: 'remotion-hook-cine-trailer-drop',
    name: 'Cine · Trailer Drop',
    description:
      'Two clipped beats on black, then the line scales up as an anamorphic flare crosses the frame.',
    defaultSeconds: 6,
    grain: 0.5,
    usesAccent: true,
    textFields: [
      { key: 'beatA', label: 'Beat one', default: 'THE SCREAMING MATCH.', maxLength: 200, role: 'prop' },
      { key: 'beatB', label: 'Beat two', default: 'THE BLOCKED NUMBER.', maxLength: 200, role: 'prop' },
      {
        key: 'drop',
        label: 'The drop',
        default: "THAT'S THEM STILL PAYING *RENT* IN YOUR HEAD.",
        maxLength: 500,
        role: 'headline',
        hint: 'Wrap one word in *asterisks* to make it the accent word.',
      },
    ],
    numberFields: [],
  },
  'remotion-hook-cine-margin-note': {
    id: 'remotion-hook-cine-margin-note',
    name: 'Cine · Margin Note',
    description:
      'Documentary column with a running timecode beside your footage; the line builds word by word and slides out left.',
    defaultSeconds: 5.5,
    grain: 0.6,
    usesAccent: true,
    textFields: [
      {
        key: 'line',
        label: 'Line',
        default: 'The ending is a Tuesday where nothing happens at all.',
        maxLength: 500,
        role: 'headline',
      },
      { key: 'reel', label: 'Reel slate', default: 'REEL 04', maxLength: 64, role: 'prop' },
    ],
    numberFields: [
      {
        key: 'startTimecodeSeconds',
        label: 'Start timecode',
        default: 761,
        minimum: 0,
        maximum: 86_399,
        integer: true,
      },
    ],
  },
}

export const NEW_HOOK_DEFINITIONS: Readonly<Record<NewHookTemplateId, NewHookDefinition>> =
  Object.freeze(HOOKS)

export interface NewCaptionDefinition {
  readonly id: NewCaptionTemplateId
  readonly name: string
  readonly description: string
  readonly grain: number
  readonly textColor: string
  readonly accentColor: string
  /** Font size as a share of the canvas's smaller dimension, matching the delivered
   *  1920x1080 sizes. Clamped between 0.032 and 0.082 at render time. */
  readonly fontScale: number
  readonly maxWordsPerCue: number
  readonly maxCharactersPerLine: number
  readonly maxLines: number
  readonly maxDurationSeconds: number
  readonly maxGapSeconds: number
}

const CAPTIONS: Record<NewCaptionTemplateId, NewCaptionDefinition> = {
  'remotion-caption-cine-word-pop': {
    id: 'remotion-caption-cine-word-pop',
    name: 'Cine · Word Pop',
    description:
      'Karaoke in condensed capitals. Every word pops in on its own measured onset and the word being spoken burns accent.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.082,
    maxWordsPerCue: 3,
    maxCharactersPerLine: 18,
    maxLines: 2,
    maxDurationSeconds: 2.4,
    maxGapSeconds: 0.48,
  },
  'remotion-caption-cine-keyword-stack': {
    id: 'remotion-caption-cine-keyword-stack',
    name: 'Cine · Keyword Stack',
    description:
      'Roman capitals, left aligned. The opening line sits dim as setup and the key word turns accent as a rule swipes under it.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.076,
    maxWordsPerCue: 6,
    maxCharactersPerLine: 26,
    maxLines: 2,
    maxDurationSeconds: 3.2,
    maxGapSeconds: 0.55,
  },
  'remotion-caption-cine-scrim-roll': {
    id: 'remotion-caption-cine-scrim-roll',
    name: 'Cine · Scrim Roll',
    description:
      'Lower-third narration in monospace on a soft scrim — no box. Lines rise in sequence behind a blinking accent block.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.037,
    maxWordsPerCue: 9,
    maxCharactersPerLine: 34,
    maxLines: 3,
    maxDurationSeconds: 4,
    maxGapSeconds: 0.7,
  },
  'remotion-caption-cine-line-build': {
    id: 'remotion-caption-cine-line-build',
    name: 'Cine · Line Build',
    description:
      'Lines stack upward as they are spoken; earlier ones drift and dim while the newest lands in accent.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.072,
    maxWordsPerCue: 5,
    maxCharactersPerLine: 22,
    maxLines: 1,
    maxDurationSeconds: 2.8,
    maxGapSeconds: 0.5,
  },
  'remotion-caption-cine-held': {
    id: 'remotion-caption-cine-held',
    name: 'Cine · Held Statement',
    description:
      'A held statement whose letterspacing tightens as it settles, with the emphasised word switching to accent under a hairline rule.',
    grain: 0.35,
    textColor: NEW_TEMPLATE_BONE,
    accentColor: NEW_TEMPLATE_ACCENT,
    fontScale: 0.057,
    maxWordsPerCue: 8,
    maxCharactersPerLine: 30,
    maxLines: 2,
    maxDurationSeconds: 3.4,
    maxGapSeconds: 0.6,
  },
}

export const NEW_CAPTION_DEFINITIONS: Readonly<Record<NewCaptionTemplateId, NewCaptionDefinition>> =
  Object.freeze(CAPTIONS)

export type ResolvedNewCaptionStyle = NewCaptionDefinition

function boundedInteger(
  value: JsonObject[string] | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.round(value)))
    : fallback
}

function boundedUnit(value: JsonObject[string] | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

function colour(value: JsonObject[string] | undefined, fallback: string): string {
  return typeof value === 'string' && HexColorSchema.safeParse(value).success
    ? value.toUpperCase()
    : fallback
}

/** Null for anything that is not one of the five new caption templates, so the caller keeps
 *  using the existing caption layer instead of silently drawing a different style. */
export function resolveNewCaptionStyle(
  templateId: string | undefined,
  props: JsonObject | undefined = undefined,
): ResolvedNewCaptionStyle | null {
  if (!isNewCaptionTemplateId(templateId)) return null
  const base = CAPTIONS[templateId]
  return {
    ...base,
    textColor: colour(props?.['textColor'], base.textColor),
    accentColor: colour(props?.['accentColor'], base.accentColor),
    grain: boundedUnit(props?.['grain'], base.grain),
    maxWordsPerCue: boundedInteger(props?.['maxWordsPerCue'], base.maxWordsPerCue, 1, 12),
    maxCharactersPerLine: boundedInteger(
      props?.['maxCharactersPerLine'],
      base.maxCharactersPerLine,
      10,
      42,
    ),
  }
}

export function captionGroupingOptionsForNewTemplate(
  style: ResolvedNewCaptionStyle,
  fps: number,
): CaptionGroupingOptions {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30
  return {
    maxWordsPerCue: style.maxWordsPerCue,
    maxCharactersPerCue: style.maxCharactersPerLine * style.maxLines,
    maxCharactersPerLine: style.maxCharactersPerLine,
    maxLines: style.maxLines,
    maxDurationFrames: Math.max(1, Math.round(style.maxDurationSeconds * safeFps)),
    maxGapFrames: Math.max(0, Math.round(style.maxGapSeconds * safeFps)),
    preferSentenceBreaks: true,
  }
}
```

- [ ] **Step 4: Export it from the barrel**

Read `shared/video-engine/index.ts` first. Append one line in the same style as its neighbours,
keeping the file's existing order otherwise:

```ts
export * from './new-templates'
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts
npm run typecheck
```

Expected: all six cases PASS, typecheck clean.

- [ ] **Step 6: Confirm nothing else moved**

```bash
npm test
```

Expected: the whole suite passes, unchanged. If any existing test now fails, stop and report —
the barrel export has collided with an existing name and the new symbols need renaming rather
than the existing ones.

---

### Task 3: Ten manifests, registered beside the built-ins

A template only exists to the app once the registry knows it: `compileHookPlan` and
`setCaptionTemplate` both call `registry.require(id)`, and `preflightProject` reports
`unknown-template` for a scene whose template is not installed. Register through
`VideoTemplateRegistry`, never `BUILTIN_VIDEO_TEMPLATES` — `renderers.test.ts`,
`hook-templates.test.ts` and `caption-styles.test.ts` all assert exact counts against that array.

**Files:**
- Create: `electron/services/video-engine/templates/new-templates.ts`
- Modify: `electron/services/video-engine/templates/registry.ts:14`
- Test: `test/unit/video-engine/new-templates.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `NEW_HOOK_DEFINITIONS`, `NEW_CAPTION_DEFINITIONS`, `NEW_HOOK_TEMPLATE_IDS`, `NEW_CAPTION_TEMPLATE_IDS`, `NEW_TEMPLATE_ACCENT` from Task 2; `TemplateManifestSchema`, `type TemplateManifest` from `shared/video-engine`.
- Produces: `NEW_VIDEO_TEMPLATES: readonly TemplateManifest[]` (ten entries, all `rendererId: 'remotion'`, `version: '1.0.0'`), reachable as `new VideoTemplateRegistry().require(id)`.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/video-engine/new-templates.test.ts`. Add these imports at the top of the
file alongside the existing ones:

```ts
import { BUILTIN_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/builtins'
import { NEW_VIDEO_TEMPLATES } from '../../../electron/services/video-engine/templates/new-templates'
import { VideoTemplateRegistry } from '../../../electron/services/video-engine/templates/registry'
import { TemplateManifestSchema, resolveTemplateProps } from '../../../shared/video-engine'
```

Then append:

```ts
describe('new template manifests', () => {
  it('publishes ten valid Remotion manifests', () => {
    expect(NEW_VIDEO_TEMPLATES).toHaveLength(10)
    for (const manifest of NEW_VIDEO_TEMPLATES) {
      expect(TemplateManifestSchema.parse(manifest)).toEqual(manifest)
      expect(manifest.rendererId).toBe('remotion')
      expect(manifest.version).toBe('1.0.0')
      expect(manifest.tags).toContain('new-templates')
      expect(manifest.aspectRatios).toHaveLength(5)
    }
    const hooks = NEW_VIDEO_TEMPLATES.filter((manifest) => manifest.kind === 'hook')
    const captions = NEW_VIDEO_TEMPLATES.filter((manifest) => manifest.kind === 'caption')
    expect(hooks.map((manifest) => manifest.id).sort()).toEqual([...NEW_HOOK_TEMPLATE_IDS].sort())
    expect(captions.map((manifest) => manifest.id).sort()).toEqual([...NEW_CAPTION_TEMPLATE_IDS].sort())
  })

  it('adds to the registry without touching the built-in set', () => {
    // The additive claim, asserted rather than assumed. Three existing suites pin these counts.
    const builtinIds = new Set(BUILTIN_VIDEO_TEMPLATES.map((manifest) => manifest.id))
    for (const manifest of NEW_VIDEO_TEMPLATES) expect(builtinIds.has(manifest.id)).toBe(false)
    expect(
      BUILTIN_VIDEO_TEMPLATES.filter((m) => m.rendererId === 'remotion' && m.kind === 'hook'),
    ).toHaveLength(7)
    expect(
      BUILTIN_VIDEO_TEMPLATES.filter((m) => m.rendererId === 'remotion' && m.kind === 'caption'),
    ).toHaveLength(10)

    const registry = new VideoTemplateRegistry()
    for (const manifest of NEW_VIDEO_TEMPLATES) {
      expect(registry.require(manifest.id).id).toBe(manifest.id)
      expect(registry.require(manifest.id, '1.0.0').kind).toBe(manifest.kind)
    }
    expect(registry.list({ rendererId: 'remotion', kind: 'hook' })).toHaveLength(12)
    expect(registry.list({ rendererId: 'remotion', kind: 'caption' })).toHaveLength(15)
    expect(registry.list({ rendererId: 'hyperframes', kind: 'hook' })).toHaveLength(2)
    expect(registry.list({ rendererId: 'hyperframes', kind: 'caption' })).toHaveLength(10)
  })

  it('declares every prop a component reads, with the delivered defaults', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const resolved = resolveTemplateProps(registry.require(id), {})
      for (const field of definition.textFields) expect(resolved[field.key]).toBe(field.default)
      for (const field of definition.numberFields) expect(resolved[field.key]).toBe(field.default)
      expect(resolved['grain']).toBe(definition.grain)
      expect(Object.hasOwn(resolved, 'accentColor')).toBe(definition.usesAccent)
      // Anything undeclared must be rejected, or a typo would render as silence.
      expect(() => resolveTemplateProps(registry.require(id), { nope: 'x' })).toThrow(/Unknown template property/u)
    }
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const definition = NEW_CAPTION_DEFINITIONS[id]
      const resolved = resolveTemplateProps(registry.require(id), {})
      expect(resolved['accentColor']).toBe(definition.accentColor.toUpperCase())
      expect(resolved['textColor']).toBe(definition.textColor.toUpperCase())
      expect(resolved['grain']).toBe(definition.grain)
      expect(resolved['maxWordsPerCue']).toBe(definition.maxWordsPerCue)
      expect(resolved['maxCharactersPerLine']).toBe(definition.maxCharactersPerLine)
    }
  })

  it('keeps hook durations inside the range the compiler checks', () => {
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const manifest = new VideoTemplateRegistry().require(id)
      expect(manifest.duration.minimumFrames).toBe(12)
      expect(manifest.duration.maximumFrames).toBe(7_200)
      expect(manifest.duration.defaultFrames)
        .toBe(Math.round(NEW_HOOK_DEFINITIONS[id].defaultSeconds * 30))
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts
```

Expected: FAIL — `electron/services/video-engine/templates/new-templates` does not exist.

- [ ] **Step 3: Create the manifest builder**

`electron/services/video-engine/templates/new-templates.ts`:

```ts
import {
  NEW_CAPTION_DEFINITIONS,
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  NEW_TEMPLATE_ACCENT,
  TemplateManifestSchema,
  type NewCaptionDefinition,
  type NewHookDefinition,
  type TemplateManifest
} from '../../../../shared/video-engine'

/* Manifests for the Cinematic Hooks and Captions set.
 *
 * Deliberately NOT part of BUILTIN_VIDEO_TEMPLATES. That array is pinned by three test suites
 * to exact counts and exact id sets, and this set is additive: it joins the app through
 * VideoTemplateRegistry instead, which is the only thing compileHookPlan, setCaptionTemplate,
 * preflight and videoEngine.templates() actually read. */

const ASPECT_RATIOS: TemplateManifest['aspectRatios'] = ['16:9', '9:16', '1:1', '4:5', 'custom']

function grainParameter(value: number): TemplateManifest['parameters'][number] {
  return {
    key: 'grain',
    label: 'Film grain',
    type: 'number',
    required: false,
    default: value,
    minimum: 0,
    maximum: 1,
    integer: false
  }
}

function accentParameter(): TemplateManifest['parameters'][number] {
  return {
    key: 'accentColor',
    label: 'Accent',
    type: 'color',
    required: false,
    default: NEW_TEMPLATE_ACCENT.toUpperCase()
  }
}

function hookManifest(definition: NewHookDefinition): TemplateManifest {
  const parameters: TemplateManifest['parameters'] = [
    ...definition.textFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: 'string' as const,
      required: false,
      default: field.default,
      maxLength: field.maxLength
    })),
    ...definition.numberFields.map((field) => ({
      key: field.key,
      label: field.label,
      type: 'number' as const,
      required: false,
      default: field.default,
      minimum: field.minimum,
      maximum: field.maximum,
      integer: field.integer
    })),
    grainParameter(definition.grain),
    ...(definition.usesAccent ? [accentParameter()] : [])
  ]
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    version: '1.0.0',
    rendererId: 'remotion',
    kind: 'hook',
    name: definition.name,
    description: definition.description,
    implementationId: definition.id,
    aspectRatios: ASPECT_RATIOS,
    duration: {
      minimumFrames: 12,
      maximumFrames: 7_200,
      // The delivered length at 30fps. The accordion converts defaultSeconds to the project's
      // own fps, so this only seeds the manifest's range.
      defaultFrames: Math.round(definition.defaultSeconds * 30)
    },
    capabilities: ['audio', 'broll', 'dynamic-duration', 'transitions'],
    parameters,
    tags: ['hook', 'cinematic', 'new-templates', 'film']
  })
}

function captionManifest(definition: NewCaptionDefinition): TemplateManifest {
  return TemplateManifestSchema.parse({
    schemaVersion: 1,
    id: definition.id,
    version: '1.0.0',
    rendererId: 'remotion',
    kind: 'caption',
    name: definition.name,
    description: definition.description,
    implementationId: definition.id,
    aspectRatios: ASPECT_RATIOS,
    duration: { minimumFrames: 12, maximumFrames: 7_200, defaultFrames: 90 },
    capabilities: ['captions', 'dynamic-duration', 'word-highlighting'],
    parameters: [
      {
        key: 'textColor',
        label: 'Text',
        type: 'color',
        required: false,
        default: definition.textColor.toUpperCase()
      },
      {
        key: 'accentColor',
        label: 'Accent',
        type: 'color',
        required: false,
        default: definition.accentColor.toUpperCase()
      },
      grainParameter(definition.grain),
      {
        key: 'maxWordsPerCue',
        label: 'Maximum words per cue',
        type: 'number',
        required: false,
        default: definition.maxWordsPerCue,
        minimum: 1,
        maximum: 12,
        integer: true
      },
      {
        key: 'maxCharactersPerLine',
        label: 'Maximum characters per line',
        type: 'number',
        required: false,
        default: definition.maxCharactersPerLine,
        minimum: 10,
        maximum: 42,
        integer: true
      }
    ],
    tags: ['caption', 'cinematic', 'new-templates', 'word-timed']
  })
}

export const NEW_VIDEO_TEMPLATES: readonly TemplateManifest[] = Object.freeze([
  ...NEW_HOOK_TEMPLATE_IDS.map((id) => hookManifest(NEW_HOOK_DEFINITIONS[id])),
  ...NEW_CAPTION_TEMPLATE_IDS.map((id) => captionManifest(NEW_CAPTION_DEFINITIONS[id]))
])
```

- [ ] **Step 4: Register them**

In `electron/services/video-engine/templates/registry.ts`, add the import and extend the one
constructor line. The whole diff is:

```ts
import { BUILTIN_VIDEO_TEMPLATES } from './builtins'
import { NEW_VIDEO_TEMPLATES } from './new-templates'
```

```ts
  constructor(additional: readonly TemplateManifest[] = []) {
    this.registry = new TemplateRegistry([
      ...BUILTIN_VIDEO_TEMPLATES,
      ...NEW_VIDEO_TEMPLATES,
      ...additional
    ])
  }
```

Change nothing else in that file.

- [ ] **Step 5: Run the tests and watch them pass**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts
npm run typecheck
```

Expected: PASS, clean.

- [ ] **Step 6: Prove the existing suites are untouched**

```bash
npx vitest run test/unit/video-engine/renderers.test.ts test/unit/video-engine/hook-templates.test.ts test/unit/video-engine/caption-styles.test.ts test/unit/video-engine/service.test.ts
npm test
```

Expected: all pass with no edits to any of those files. If `renderers.test.ts` or
`hook-templates.test.ts` fails, `BUILTIN_VIDEO_TEMPLATES` was modified — revert that and register
through the registry instead.

---

### Task 4: The film kit

The delivered `theme.tsx` and `film.tsx`, ported once so all ten components share them. Two
deliberate departures, both forced by this app's compositional model, and both documented in
comments inside the file.

**Files:**
- Read: `scratch/cinematic-hooks-and-captions/remotion/src/theme.tsx`, `scratch/cinematic-hooks-and-captions/remotion/src/film.tsx`
- Create: `video-engine/remotion/new-templates/kit.tsx`

**Interfaces:**
- Consumes: `JsonObject` from `shared/video-engine`; `AbsoluteFill` from `remotion`.
- Produces:
  - `SERIF`, `COND`, `MONO` — font stacks
  - `BLACK`, `BONE`, `DIM`, `ACCENT` — palette
  - `clamp(v: number, a?: number, b?: number): number`
  - `Ease` — `{ outQuart, inOutQuart, outExpo, inOutCubic, outBack }`, each `(p: number) => number`
  - `MOTION.rise(t, s, d?, y?): { opacity: number; transform: string }`
  - `MOTION.sweep(t, s, d?, ease?): number`
  - `MOTION.pop(t, s, d?): { opacity: number; transform: string }`
  - `Mark: React.FC<{ text: string; accent?: string; glow?: boolean }>`
  - `Grain: React.FC<{ t: number; amount?: number }>`
  - `Dust`, `Vignette`, `Weave` — as delivered
  - `FilmFrame: React.FC<{ t: number; grain?: number; weave?: boolean; background?: string; vignette?: boolean; dust?: boolean; children: React.ReactNode }>`
  - `textProp(props: JsonObject | undefined, key: string, fallback: string): string`
  - `numberProp(props: JsonObject | undefined, key: string, fallback: number): number`
  - `colorProp(props: JsonObject | undefined, key: string, fallback: string): string`

- [ ] **Step 1: Copy `theme.tsx` verbatim into the top of the new file**

Copy `SERIF`, `COND`, `MONO`, `BLACK`, `BONE`, `DIM`, `ACCENT`, `clamp`, `Ease`, `MOTION` and
`Mark` from `scratch/cinematic-hooks-and-captions/remotion/src/theme.tsx` with **no numeric
changes**. Apply exactly these substitutions:

- `COND` fallback: `'Helvetica Neue'` → `'Hanken Grotesk'` (that face is self-hosted here; Helvetica Neue is not).
- `MONO` fallback: `'Courier New'` → `'JetBrains Mono'` (same reason).
- `BONE` and `ACCENT` must **not** be re-declared as literals. Task 2 already canonicalised them:
  `export const BONE = NEW_TEMPLATE_BONE` and `export const ACCENT = NEW_TEMPLATE_ACCENT`, both
  imported from `../../../shared/video-engine`. A second literal here is a second source of truth
  and defeats the point of the shared table. `BLACK` and `DIM` stay as delivered literals — neither
  exists in the shared table.
- Nothing else. The easings, the three motion helpers and `Mark` are byte-identical.

Head the file with this comment:

```tsx
/* The Cinematic Hooks and Captions film kit.
 *
 * A port of the delivered theme.tsx and film.tsx (see the working copy under
 * scratch/cinematic-hooks-and-captions/). The numbers are the delivered numbers: three motion
 * helpers and no fourth easing, every value a pure function of t in seconds, so frame N renders
 * identically on every machine and the scrubber does not lie.
 *
 * Two deliberate departures from the delivered source, both because a template here composites
 * over a timeline rather than standing alone:
 *   · FilmFrame takes `background`. Footage-backed templates pass 'transparent' so the clip
 *     underneath shows through, which is what a hook on an overlay lane means in this app. The
 *     delivered striped FootagePlate placeholder is dropped — it exists to make a standalone
 *     catalog readable and has no place in a product render.
 *   · FilmFrame takes `vignette` and `dust` flags, so the caption layer can carry grain without
 *     also stamping a vignette across the user's whole video. */
```

- [ ] **Step 2: Copy the film primitives**

Copy `GRAIN_TILE`, `Grain`, `SPECKS`, `Dust`, `Vignette` and `Weave` from the delivered
`film.tsx` verbatim. Skip `FootagePlate` and `Slate` entirely — neither is ported.

`Dust`'s hardcoded speck coordinates are authored at 1920×1080. Wrap the returned
`<AbsoluteFill>` contents in a scaling transform so they land in the same relative places on
other canvases: give the outer fill `transform: 'scale(var(--x))'` — no. Instead, express each
speck's `left`/`top` as a percentage of 1920/1080:

```tsx
export const Dust: React.FC<{ t: number; amount?: number }> = ({ t, amount = 0.45 }) => {
  const k = Math.floor(t * 11)
  return (
    <AbsoluteFill style={{ opacity: amount }}>
      {SPECKS.map((s, i) =>
        (k + i) % 5 === 0 ? (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${((s[0] / 1920) * 100).toFixed(3)}%`,
              top: `${((s[1] / 1080) * 100).toFixed(3)}%`,
              width: s[2],
              height: s[2] * 3,
              background: 'rgba(255,248,232,0.5)',
              borderRadius: 2,
            }}
          />
        ) : null,
      )}
    </AbsoluteFill>
  )
}
```

- [ ] **Step 3: Write the reworked `FilmFrame`**

```tsx
export const FilmFrame: React.FC<{
  t: number
  grain?: number
  weave?: boolean
  /** 'transparent' lets the timeline underneath show through — see the header comment. */
  background?: string
  vignette?: boolean
  dust?: boolean
  children: React.ReactNode
}> = ({
  t,
  grain = 0.55,
  weave = true,
  background = BLACK,
  vignette = true,
  dust = true,
  children,
}) => (
  <AbsoluteFill style={{ background, overflow: 'hidden' }}>
    <Weave t={t} on={weave}>{children}</Weave>
    <Grain t={t} amount={grain} />
    {dust ? <Dust t={t} amount={grain * 0.8} /> : null}
    {vignette ? <Vignette /> : null}
  </AbsoluteFill>
)
```

- [ ] **Step 4: Add the three prop readers**

`resolveTemplateProps` has already validated these against the manifest before they reach a
scene, but a project saved by an older build or edited by hand can still carry anything, so each
reader falls back rather than throwing mid-render.

```tsx
export function textProp(props: JsonObject | undefined, key: string, fallback: string): string {
  const value = props?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

export function numberProp(props: JsonObject | undefined, key: string, fallback: number): number {
  const value = props?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const HEX = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u

export function colorProp(props: JsonObject | undefined, key: string, fallback: string): string {
  const value = props?.[key]
  return typeof value === 'string' && HEX.test(value) ? value : fallback
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: clean. `tsconfig.video-engine.json` already includes the whole `video-engine`
directory, so no config change is needed.

- [ ] **Step 6: Report**

State that `FootagePlate` and `Slate` were not ported and that no easing or motion constant
changed.

---

### Task 5: The five hook components and the scene dispatch

**Files:**
- Read: all five `Hook0*.tsx` under `scratch/cinematic-hooks-and-captions/remotion/src/templates/`
- Create: `video-engine/remotion/new-templates/hooks.tsx`
- Create: `video-engine/remotion/new-templates/index.ts`
- Modify: `video-engine/remotion/scene.tsx:250-255`

**Interfaces:**
- Consumes: everything Task 4 produced from `./kit`; `isNewHookTemplateId`, `NEW_HOOK_DEFINITIONS`, `HookPlanSchema`, `type HookPlan`, `type VideoScene`, `type JsonObject` from `shared/video-engine`; `sceneTransformStyle` from `../asset`.
- Produces: `NewHookScene: React.FC<{ scene: VideoScene }>` — renders the component for `scene.template.id`, or `null` if the id is not one of the five.

**Timing rule for every component in this task.** The delivered beat times are absolute seconds
tuned for the delivered length. Multiply **every** hardcoded time by `k = dur / defaultSeconds`
through the context's `T()` helper, including the exit's start and duration. At the delivered
length `k === 1`, so the choreography is byte-identical; at any other length it keeps its
proportions instead of clipping mid-beat. Flare and flash half-widths divide by `k` for the same
reason. `t` itself is never scaled — Margin Note's running timecode must advance in real seconds.

**Sizing rule.** Absolute pixel values in the delivered source are authored at 1920×1080.
Multiply geometry by `scale` and font sizes by `type`, both from the context. `type` is 1.38×
`scale` on portrait and square canvases, which lands on the 0.78× the delivered handoff
prescribes for 9:16.

- [ ] **Step 1: Write the context, the plan reader and the dispatcher**

Create `video-engine/remotion/new-templates/hooks.tsx` starting with:

```tsx
import { useMemo } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  HookPlanSchema,
  NEW_HOOK_DEFINITIONS,
  isNewHookTemplateId,
  type HookPlan,
  type JsonObject,
  type VideoScene,
} from '../../../shared/video-engine'
import { sceneTransformStyle } from '../asset'
import {
  ACCENT,
  BONE,
  COND,
  DIM,
  Ease,
  FilmFrame,
  MONO,
  MOTION,
  Mark,
  SERIF,
  clamp,
  colorProp,
  numberProp,
  textProp,
} from './kit'

/* The five Cinematic hooks.
 *
 * Each is a port of the matching Hook0*.tsx in the delivered set. Two rules apply everywhere:
 *
 *   · Every delivered time goes through T(), which scales it by dur / defaultSeconds. At the
 *     delivered length that is the identity, so the choreography is unchanged; at any other
 *     length the beats keep their proportions instead of the tail being clipped. t itself is
 *     never scaled — Margin Note's timecode has to advance in real seconds.
 *   · Delivered pixel sizes are authored at 1920x1080. Geometry multiplies by `scale`, type by
 *     `type` — 1.38x scale on portrait and square canvases, which is the 0.78x the delivered
 *     handoff prescribes for 9:16.
 *
 * Reel Burn and Margin Note are the footage-backed two: they pass background 'transparent' so
 * the clip under the hook lane shows through. */

interface HookContext {
  readonly t: number
  readonly dur: number
  readonly k: number
  /** Delivered seconds, retimed to this scene's length. */
  readonly T: (seconds: number) => number
  /** Geometry: delivered pixels at 1920 wide. */
  readonly px: (value: number) => number
  /** Type: delivered pixels, with the portrait/square uplift applied. */
  readonly tp: (value: number) => number
  readonly width: number
  readonly height: number
  readonly props: JsonObject
  readonly headline: string | undefined
  readonly body: string | undefined
}

function planFromScene(scene: VideoScene): HookPlan | null {
  const parsed = HookPlanSchema.safeParse(scene.template?.props?.['hookPlan'])
  return parsed.success ? parsed.data : null
}

export function NewHookScene({ scene }: { readonly scene: VideoScene }): JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const plan = useMemo(() => planFromScene(scene), [scene])
  const id = scene.template?.id
  if (!isNewHookTemplateId(id)) return null

  const scale = Math.max(0.3, width / 1920)
  const portraitish = width <= height * 1.05
  const typeScale = scale * (portraitish ? 1.38 : 1)
  const dur = Math.max(1, scene.durationFrames) / fps
  const k = dur / NEW_HOOK_DEFINITIONS[id].defaultSeconds
  const beat = plan?.beats[0]
  const context: HookContext = {
    t: frame / fps,
    dur,
    k,
    T: (seconds) => seconds * k,
    px: (value) => Math.round(value * scale),
    tp: (value) => Math.max(10, Math.round(value * typeScale)),
    width,
    height,
    props: scene.template?.props ?? {},
    headline: beat?.headline,
    body: beat?.body,
  }

  return (
    <AbsoluteFill style={sceneTransformStyle(scene)}>
      {id === 'remotion-hook-cine-title-card' ? <CineTitleCard c={context} /> : null}
      {id === 'remotion-hook-cine-reel-burn' ? <CineReelBurn c={context} /> : null}
      {id === 'remotion-hook-cine-hard-light' ? <CineHardLight c={context} /> : null}
      {id === 'remotion-hook-cine-trailer-drop' ? <CineTrailerDrop c={context} /> : null}
      {id === 'remotion-hook-cine-margin-note' ? <CineMarginNote c={context} /> : null}
    </AbsoluteFill>
  )
}
```

- [ ] **Step 2: Hook 01 — Title Card**

```tsx
/** HOOK 01 · TITLE CARD — prestige open on black. Rule opens, letterspacing settles. */
function CineTitleCard({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, props } = c
  const line = c.headline ?? textProp(props, 'line', "THAT ISN'T THE ENDING.")
  const kicker = textProp(props, 'kicker', 'ON LEAVING')
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.55)
  const out = 1 - MOTION.sweep(t, dur - T(0.8), T(0.8))
  const settle = MOTION.sweep(t, T(0.3), T(2.4), Ease.outExpo)
  const rule = MOTION.sweep(t, T(0.15), T(1.3))
  const ls = `${(0.4 - 0.16 * settle).toFixed(3)}em`

  return (
    <FilmFrame t={t} grain={grain}>
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          padding: `0 ${px(140)}px`,
          opacity: out,
          transform: `scale(${(1 + 0.014 * settle).toFixed(4)})`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: px(22), marginBottom: px(54), opacity: rule * 0.8 }}>
          <div style={{ width: px(170) * rule, height: 1, background: 'linear-gradient(90deg, transparent, rgba(236,229,216,0.7))' }} />
          <div style={{ width: Math.max(4, px(5)), height: Math.max(4, px(5)), background: accent, transform: 'rotate(45deg)' }} />
          <div style={{ width: px(170) * rule, height: 1, background: 'linear-gradient(90deg, rgba(236,229,216,0.7), transparent)' }} />
        </div>
        <div
          style={{
            fontFamily: SERIF,
            fontSize: tp(96),
            color: BONE,
            textAlign: 'center',
            lineHeight: 1.18,
            letterSpacing: ls,
            textIndent: ls,
            ...MOTION.rise(t, T(0.35), T(1.4), px(26)),
          }}
        >
          {line}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: tp(20),
            letterSpacing: '0.42em',
            color: DIM,
            marginTop: px(58),
            opacity: MOTION.sweep(t, T(1.5), T(1.1)),
          }}
        >
          {kicker}
        </div>
      </AbsoluteFill>
    </FilmFrame>
  )
}
```

- [ ] **Step 3: Hook 02 — Reel Burn (footage-backed)**

```tsx
/** HOOK 02 · REEL BURN — a light leak wipes the line in over the footage underneath. */
function CineReelBurn({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, k, px, tp, props } = c
  const lineA = c.headline ?? textProp(props, 'lineA', "They didn't reach out")
  const lineB = c.body ?? textProp(props, 'lineB', 'when you were *falling apart*.')
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.7)
  const out = 1 - MOTION.sweep(t, dur - T(0.7), T(0.7))
  const leak = MOTION.sweep(t, T(0.5), T(1.5), Ease.inOutCubic)
  const flash = Math.max(0, 1 - (Math.abs(t - (dur - T(1))) * 5) / Math.max(0.0001, k))

  return (
    <FilmFrame t={t} grain={grain} background="transparent">
      <AbsoluteFill style={{ opacity: out, transform: `translateY(${(Math.sin(t * 8.2) * 1.6).toFixed(2)}px)` }}>
        <AbsoluteFill style={{ background: 'radial-gradient(75% 60% at 26% 22%, rgba(255,196,128,0.30) 0%, rgba(255,150,80,0.07) 42%, transparent 72%)' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(120% 100% at 50% 50%, transparent 38%, rgba(0,0,0,0.82) 100%)' }} />
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            width: px(520),
            left: `${-30 + leak * 130}%`,
            background: 'linear-gradient(90deg, transparent, rgba(255,208,150,0.55), rgba(255,240,220,0.85), rgba(255,208,150,0.4), transparent)',
            mixBlendMode: 'screen',
            filter: `blur(${Math.max(2, px(9))}px)`,
            opacity: 0.85 * (1 - Math.abs(leak - 0.5) * 1.2),
          }}
        />
        <div style={{ position: 'absolute', left: px(150), right: px(150), top: '50%', transform: 'translateY(-50%)' }}>
          <div style={{ clipPath: `inset(0 ${((1 - Math.min(1, leak * 1.35)) * 100).toFixed(1)}% 0 0)` }}>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: tp(74),
                lineHeight: 1.3,
                letterSpacing: '0.1em',
                color: '#fff6e6',
                textShadow: `0 0 ${px(46)}px rgba(255,190,130,0.45)`,
              }}
            >
              {lineA}
              <br />
              <Mark text={lineB} accent={accent} glow />
            </div>
          </div>
          <div
            style={{
              marginTop: px(44),
              height: 1,
              width: `${60 * MOTION.sweep(t, T(1.6), T(1.4))}%`,
              background: 'linear-gradient(90deg, rgba(255,220,180,0.75), transparent)',
            }}
          />
        </div>
        <AbsoluteFill style={{ background: `rgba(255,226,190,${(flash * 0.5).toFixed(3)})`, mixBlendMode: 'screen' }} />
      </AbsoluteFill>
    </FilmFrame>
  )
}
```

- [ ] **Step 4: Hook 03 — Hard Light**

```tsx
/** HOOK 03 · HARD LIGHT — noir. A shaft rakes in, slab caps slide out of shadow. */
function CineHardLight({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, props } = c
  const lineA = c.headline ?? textProp(props, 'lineA', "You've been braced")
  const lineB = c.body ?? textProp(props, 'lineB', 'for the explosion.')
  const grain = numberProp(props, 'grain', 0.45)
  const out = 1 - MOTION.sweep(t, dur - T(0.4), T(0.4))
  const shaft = MOTION.sweep(t, T(0.05), T(0.85), Ease.outExpo)
  const slide = (1 - Ease.outQuart(clamp(t / T(0.9)))) * -px(90)
  const blind = Math.max(6, px(26))
  const gap = Math.max(18, px(74))

  return (
    <FilmFrame t={t} grain={grain} weave={false} background="#070706">
      <AbsoluteFill style={{ opacity: out }}>
        <div
          style={{
            position: 'absolute',
            top: -px(200),
            bottom: -px(200),
            left: `${-20 + shaft * 24}%`,
            width: px(640),
            transform: 'skewX(-18deg)',
            background: 'linear-gradient(90deg, transparent, rgba(240,232,214,0.16), rgba(240,232,214,0.05), transparent)',
            filter: `blur(${Math.max(1, px(2))}px)`,
          }}
        />
        <AbsoluteFill
          style={{
            opacity: 0.3 + 0.14 * shaft,
            background: `repeating-linear-gradient(0deg, rgba(0,0,0,0.9) 0 ${blind}px, rgba(0,0,0,0) ${blind}px ${gap}px)`,
            transform: `translateY(${(((t * 5) % 100) - 50).toFixed(1)}px)`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: px(160),
            right: px(260),
            top: '50%',
            transform: `translateY(-50%) translateX(${slide.toFixed(1)}px)`,
            opacity: MOTION.rise(t, T(0.12), T(0.75), 0).opacity,
          }}
        >
          <div
            style={{
              fontFamily: COND,
              fontWeight: 700,
              fontSize: tp(128),
              lineHeight: 0.98,
              color: '#f4efe4',
              textTransform: 'uppercase',
              textShadow: `${px(14)}px ${px(15)}px 0 rgba(0,0,0,0.92)`,
            }}
          >
            {lineA}
            <br />
            {lineB}
          </div>
        </div>
        <AbsoluteFill style={{ background: 'radial-gradient(100% 90% at 30% 45%, transparent 30%, rgba(0,0,0,0.9) 100%)' }} />
      </AbsoluteFill>
    </FilmFrame>
  )
}
```

- [ ] **Step 5: Hook 04 — Trailer Drop**

```tsx
/** HOOK 04 · TRAILER DROP — clipped beats, then the line scales up and a flare crosses. */
function CineTrailerDrop({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, k, px, tp, props } = c
  const drop = c.headline ?? textProp(props, 'drop', "THAT'S THEM STILL PAYING *RENT* IN YOUR HEAD.")
  const beats = [
    textProp(props, 'beatA', 'THE SCREAMING MATCH.'),
    textProp(props, 'beatB', 'THE BLOCKED NUMBER.'),
  ]
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.5)
  const out = 1 - MOTION.sweep(t, dur - T(0.6), T(0.6))
  const beatAt = [T(0.15), T(1.85)]
  const beatOff = [T(1.7), T(3.3)]
  const dropIn = MOTION.sweep(t, T(3.45), T(2.2), Ease.outExpo)
  const flare = Math.max(0, 1 - (Math.abs(t - T(3.95)) * 2.2) / Math.max(0.0001, k))

  return (
    <FilmFrame t={t} grain={grain} background="#070606">
      <AbsoluteFill style={{ opacity: out, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'linear-gradient(180deg, transparent, rgba(236,229,216,0.14), transparent)' }} />
        {beats.map((beat, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              padding: `0 ${px(120)}px`,
              textAlign: 'center',
              fontFamily: SERIF,
              fontSize: tp(60),
              letterSpacing: '0.5em',
              textIndent: '0.5em',
              color: DIM,
              opacity: clamp((t - beatAt[index]!) / T(0.22)) * (t < beatOff[index]! ? 1 : 0),
            }}
          >
            {beat}
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            left: px(130),
            right: px(130),
            textAlign: 'center',
            opacity: clamp((t - T(3.4)) / T(0.3)),
            transform: `scale(${(0.84 + 0.16 * dropIn).toFixed(3)})`,
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: tp(104),
              lineHeight: 1.12,
              letterSpacing: '0.06em',
              color: '#f6f1e6',
              textShadow: `0 0 ${px(70)}px rgba(255,220,180,${(0.16 + 0.2 * flare).toFixed(2)})`,
            }}
          >
            <Mark text={drop} accent={accent} glow />
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: px(2400),
            height: Math.max(2, px(5)),
            marginLeft: -px(1200),
            marginTop: -px(2),
            background: 'linear-gradient(90deg, transparent, #fff8ec, transparent)',
            filter: `blur(${Math.max(2, px(6))}px)`,
            transform: `scaleX(${(0.1 + flare).toFixed(2)})`,
            opacity: flare * 0.95,
          }}
        />
      </AbsoluteFill>
    </FilmFrame>
  )
}
```

- [ ] **Step 6: Hook 05 — Margin Note (footage-backed, two layouts)**

The delivered handoff says this template does not port to vertical and should be stacked
instead, so there are two explicit layouts here rather than one that reflows badly.

```tsx
function timecodeStamp(startSeconds: number, t: number): string {
  const total = startSeconds + t
  const pad = (value: number): string => String(Math.floor(value)).padStart(2, '0')
  return `00:${pad(total / 60)}:${pad(total % 60)}:${pad((t * 24) % 24)}`
}

/** HOOK 05 · MARGIN NOTE — documentary column, running timecode, line builds word by word. */
function CineMarginNote({ c }: { readonly c: HookContext }): JSX.Element {
  const { t, dur, T, px, tp, width, height, props } = c
  const line = c.headline ?? textProp(props, 'line', 'The ending is a Tuesday where nothing happens at all.')
  const reel = textProp(props, 'reel', 'REEL 04')
  const startSeconds = Math.round(numberProp(props, 'startTimecodeSeconds', 761))
  const accent = colorProp(props, 'accentColor', ACCENT)
  const grain = numberProp(props, 'grain', 0.6)
  const out = 1 - MOTION.sweep(t, dur - T(0.7), T(0.7))
  const exit = MOTION.sweep(t, dur - T(0.7), T(0.7))
  const words = line.split(' ')
  const stamp = timecodeStamp(startSeconds, t)
  const stacked = width <= height
  const slateShift = stacked ? 0 : -px(160) * exit

  const slate = (
    <>
      <div style={{ fontFamily: MONO, fontSize: tp(20), letterSpacing: '0.3em', color: accent, opacity: MOTION.sweep(t, T(0.3), T(0.6)) }}>{reel}</div>
      <div style={{ fontFamily: MONO, fontSize: tp(20), letterSpacing: '0.24em', color: DIM, marginTop: px(12), opacity: MOTION.sweep(t, T(0.45), T(0.6)) }}>{stamp}</div>
    </>
  )
  const body = (
    <div
      style={{
        fontFamily: SERIF,
        fontSize: tp(54),
        lineHeight: 1.34,
        letterSpacing: '0.06em',
        color: BONE,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: px(16),
      }}
    >
      {words.map((word, index) => (
        <span key={index} style={MOTION.rise(t, T(0.9 + index * 0.13), T(0.8), px(14))}>{word}</span>
      ))}
    </div>
  )

  return (
    <FilmFrame t={t} grain={grain} background="transparent">
      <AbsoluteFill style={{ opacity: out }}>
        {stacked ? (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: '46%', background: '#0a0908' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: '42%', height: '14%', background: 'linear-gradient(180deg, #0a0908, transparent)' }} />
            <div style={{ position: 'absolute', left: px(96), right: px(96), top: px(120), height: 1, background: 'rgba(236,229,216,0.22)', transform: `scaleX(${MOTION.sweep(t, T(0.15), T(1.1))})`, transformOrigin: 'left' }} />
            <div style={{ position: 'absolute', left: px(96), top: px(150), transform: `translateY(${(-px(60) * exit).toFixed(1)}px)` }}>{slate}</div>
            <div style={{ position: 'absolute', left: px(96), right: px(96), top: '24%', transform: `translateY(${(-px(60) * exit).toFixed(1)}px)` }}>{body}</div>
          </>
        ) : (
          <>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '34%', background: '#0a0908' }} />
            <div style={{ position: 'absolute', left: '30%', top: 0, bottom: 0, width: '14%', background: 'linear-gradient(90deg, #0a0908, transparent)' }} />
            <div style={{ position: 'absolute', left: px(96), top: px(130), bottom: px(130), width: 1, background: 'rgba(236,229,216,0.22)', transform: `scaleY(${MOTION.sweep(t, T(0.15), T(1.1))})`, transformOrigin: 'top' }} />
            <div style={{ position: 'absolute', left: px(148), top: px(150), width: px(500), transform: `translateX(${slateShift.toFixed(1)}px)` }}>{slate}</div>
            <div style={{ position: 'absolute', left: px(148), bottom: px(190), width: px(620), transform: `translateX(${slateShift.toFixed(1)}px)` }}>{body}</div>
          </>
        )}
      </AbsoluteFill>
    </FilmFrame>
  )
}
```

- [ ] **Step 7: Create the barrel**

`video-engine/remotion/new-templates/index.ts`:

```ts
export { NewHookScene } from './hooks'
export { NewCaptionLayer } from './captions'
export { isNewCaptionTemplateId, isNewHookTemplateId } from '../../../shared/video-engine'
```

`./captions` does not exist yet, so this file will not typecheck until Task 6. Create it now
anyway so both dispatch edits reference one stable module path; run the typecheck at the end of
Task 6 rather than here.

- [ ] **Step 8: Dispatch from `scene.tsx`**

Add the import beside the existing `./hook` import:

```ts
import { NewHookScene } from './new-templates'
```

Then, inside `SceneContent`, change only the `scene.kind === 'template'` block. It currently reads:

```tsx
  if (scene.kind === 'template') {
    if (hasValidHookPlan(scene)) {
      return <HookTemplate project={project} scene={scene} assetById={assetById} />
    }
    return <TrustedTemplateFallback scene={scene} />
  }
```

It becomes:

```tsx
  if (scene.kind === 'template') {
    // The Cinematic set has one component per template rather than one styled renderer, so it
    // dispatches before the generic hook path. Its footage comes from the timeline underneath
    // the hook lane, so it needs no asset from the plan.
    if (isNewHookTemplateId(scene.template?.id)) return <NewHookScene scene={scene} />
    if (hasValidHookPlan(scene)) {
      return <HookTemplate project={project} scene={scene} assetById={assetById} />
    }
    return <TrustedTemplateFallback scene={scene} />
  }
```

Add `isNewHookTemplateId` to the existing `shared/video-engine` type-import at the top of
`scene.tsx` — note that import is currently `import type { … }`, so add a second value import
line rather than putting a function inside a type-only import:

```ts
import { isNewHookTemplateId } from '../../shared/video-engine'
```

Change nothing else in `scene.tsx`.

- [ ] **Step 9: Report**

List the five components and confirm every delivered numeric constant was preserved, naming the
only three permitted transformations applied (`T()` retiming, `px()`/`tp()` sizing, and the
`transparent` background on the two footage-backed hooks).

---

### Task 6: The five caption layers and the caption dispatch

Unlike the delivered catalog, these are driven by the project's real word timings. The delivered
handoff asks exactly for this: replace Caption 01's per-word `step` and Caption 04's per-line
`step` with measured onsets. Here every onset is a `CaptionWord.startFrame`, and paging comes
from the same `groupCaptionCues` the existing styles use.

**Files:**
- Read: all five `Caption0*.tsx` under `scratch/cinematic-hooks-and-captions/remotion/src/templates/`
- Create: `video-engine/remotion/new-templates/captions.tsx`
- Modify: `video-engine/remotion/composition.tsx:153`
- Test: `test/unit/video-engine/new-templates.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `activeCaptionCue`, `captionGroupingOptionsForNewTemplate`, `captionNeedsLeadingSpace`, `captionWordIsActive`, `groupCaptionCues`, `resolveNewCaptionStyle`, `isNewCaptionTemplateId`, `type CaptionCue`, `type CaptionWord`, `type ResolvedNewCaptionStyle`, `type VideoProject`, `type VideoScene` from `shared/video-engine`; `captionLayerZIndex` from `../captions`; `sceneTransformStyle` from `../asset`; the kit from Task 4.
- Produces:
  - `NewCaptionLayer: React.FC<{ project: VideoProject }>`
  - `usesNewCaptionTemplate(project: VideoProject): boolean`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/video-engine/new-templates.test.ts`. Add to the existing shared import:
`createCaptionDocument`, `groupCaptionCues`, `wrapCaptionLines`, `type CaptionWord`.

```ts
function synthWords(fps: number): CaptionWord[] {
  const sentence =
    "You've been braced for the explosion. The screaming match, the blocked number, the unforgivable thing. That isn't the ending."
  return sentence.split(' ').map((text, index) => ({
    id: `w${index}`,
    text,
    startFrame: index * Math.round(fps * 0.34),
    endFrame: index * Math.round(fps * 0.34) + Math.round(fps * 0.3),
    importance: index === 4 ? 2 : 0,
  }))
}

describe('new caption paging', () => {
  it.each([24, 30, 60])('pages a real transcript into legal cues at %i fps', (fps) => {
    const document = createCaptionDocument({ id: 'captions:test', words: synthWords(fps) })
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const style = resolveNewCaptionStyle(id)!
      const cues = groupCaptionCues(document, captionGroupingOptionsForNewTemplate(style, fps))
      expect(cues.length, id).toBeGreaterThan(1)
      for (const cue of cues) {
        expect(cue.lines.length, `${id} lines`).toBeGreaterThanOrEqual(1)
        expect(cue.lines.length, `${id} lines`).toBeLessThanOrEqual(style.maxLines)
        expect(cue.endFrame).toBeGreaterThan(cue.startFrame)
        expect(cue.wordIds.length).toBeLessThanOrEqual(style.maxWordsPerCue + 2)
      }
      // Cues must be ordered and non-overlapping, or activeCaptionCue's binary search lies.
      for (let index = 1; index < cues.length; index += 1) {
        expect(cues[index]!.startFrame).toBeGreaterThanOrEqual(cues[index - 1]!.startFrame)
      }
      expect(cues.some((cue) => /ending\.$/u.test(cue.text)), `${id} punctuation`).toBe(true)
    }
  })

  it('keeps at least one cue carrying the emphasised word', () => {
    const document = createCaptionDocument({ id: 'captions:test', words: synthWords(30) })
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const style = resolveNewCaptionStyle(id)!
      const cues = groupCaptionCues(document, captionGroupingOptionsForNewTemplate(style, 30))
      expect(cues.some((cue) => cue.importantWordIds.includes('w4')), id).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts -t 'new caption paging'
```

Expected: FAIL only if the paging limits in Task 2 are wrong. If it passes immediately that is
fine — it is a regression guard on the shared table, and the components below depend on it.

- [ ] **Step 3: Write the layer scaffolding**

Create `video-engine/remotion/new-templates/captions.tsx`:

```tsx
import { Fragment, useMemo, type CSSProperties } from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import {
  activeCaptionCue,
  captionGroupingOptionsForNewTemplate,
  captionNeedsLeadingSpace,
  captionWordIsActive,
  groupCaptionCues,
  isNewCaptionTemplateId,
  resolveNewCaptionStyle,
  type CaptionCue,
  type CaptionWord,
  type ResolvedNewCaptionStyle,
  type VideoProject,
  type VideoScene,
} from '../../../shared/video-engine'
import { sceneTransformStyle } from '../asset'
import { captionLayerZIndex } from '../captions'
import { COND, DIM, Ease, Grain, MONO, MOTION, SERIF, clamp } from './kit'

/* The five Cinematic caption systems.
 *
 * The delivered catalog hardcodes its text and a fixed seconds-per-word step. These are driven by
 * the project's caption document instead: every onset is a CaptionWord.startFrame, and paging
 * comes from the same groupCaptionCues the existing styles use, with per-template limits from
 * shared/video-engine/new-templates.ts. That is exactly the retiming the delivered handoff asks
 * for on Caption 01 and Caption 04.
 *
 * Grain belongs to the LAYER, not to a cue: the caption scene spans the whole canvas, so grain
 * drawn per cue would blink on and off at every cue boundary. Scrim Roll's scrim is on the layer
 * for the same reason. Neither vignette nor gate weave is applied — a caption style has no
 * business moving the user's footage. */

interface Metrics {
  readonly safeInset: number
  readonly bottomOffset: number
  readonly maxWidth: number
  readonly fontSize: number
}

/** The same shape captionLayoutMetrics derives for the existing styles, recomputed here because
 *  that function takes a CaptionStyleDefinition this set deliberately does not implement. */
function metricsFor(
  style: ResolvedNewCaptionStyle,
  width: number,
  height: number,
  lineCharacterCounts: readonly number[],
): Metrics {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const minimum = Math.min(safeWidth, safeHeight)
  const ratio = safeWidth / safeHeight
  const aspect = ratio < 0.9 ? 'portrait' : ratio > 1.2 ? 'landscape' : 'square'
  const bottomRatio = aspect === 'portrait' ? 0.18 : aspect === 'square' ? 0.12 : 0.09
  const longestLine = Math.max(1, ...lineCharacterCounts)
  const fit = longestLine > style.maxCharactersPerLine
    ? Math.max(0.58, style.maxCharactersPerLine / longestLine)
    : 1
  const raw = minimum * style.fontScale * fit
  return {
    safeInset: Math.round(minimum * 0.07),
    bottomOffset: Math.round(safeHeight * bottomRatio),
    maxWidth: Math.round(safeWidth * (aspect === 'landscape' ? 0.78 : 0.84)),
    fontSize: Math.round(Math.max(minimum * 0.032, Math.min(minimum * 0.082, raw))),
  }
}

function activeCaptionScene(
  captionScenes: readonly VideoScene[],
  mutedTrackIds: ReadonlySet<string>,
  frame: number,
): VideoScene | null | undefined {
  if (captionScenes.length === 0) return undefined
  return (
    captionScenes.find(
      (scene) =>
        !mutedTrackIds.has(scene.trackId) &&
        frame >= scene.startFrame &&
        frame < scene.startFrame + scene.durationFrames,
    ) ?? null
  )
}

function lastStartedIndex(cues: readonly CaptionCue[], frame: number): number {
  let found = -1
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index]!.startFrame > frame) break
    found = index
  }
  return found
}

/** True when this project's captions belong to the Cinematic set, so exactly one caption layer
 *  ever draws. Checks the scene as well as the document, because CaptionLayer prefers the scene's
 *  template id and a project could carry one without the other. */
export function usesNewCaptionTemplate(project: VideoProject): boolean {
  if (isNewCaptionTemplateId(project.captions?.templateId)) return true
  return project.scenes.some(
    (scene) => scene.kind === 'caption' && isNewCaptionTemplateId(scene.template?.id),
  )
}
```

- [ ] **Step 4: Write the layer itself**

```tsx
export function NewCaptionLayer({ project }: { readonly project: VideoProject }): JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const document = project.captions
  const context = useMemo(
    () => ({
      scenes: project.scenes.filter((scene) => scene.kind === 'caption'),
      mutedTrackIds: new Set(
        project.tracks.filter((track) => track.muted).map((track) => track.id),
      ),
    }),
    [project.scenes, project.tracks],
  )
  const scene = document && document.words.length > 0
    ? activeCaptionScene(context.scenes, context.mutedTrackIds, frame)
    : null
  const style = useMemo(
    () => resolveNewCaptionStyle(scene?.template?.id ?? document?.templateId, scene?.template?.props),
    [document?.templateId, scene?.template?.id, scene?.template?.props],
  )
  const cues = useMemo(
    () => (document && style
      ? groupCaptionCues(document, captionGroupingOptionsForNewTemplate(style, fps))
      : []),
    [document, style, fps],
  )
  const wordById = useMemo(
    () => new Map((document?.words ?? []).map((word) => [word.id, word])),
    [document],
  )

  if (!document || document.words.length === 0 || !style) return null
  if (scene === null) return null

  const active = activeCaptionCue(cues, frame)
  const index = active ? cues.indexOf(active) : lastStartedIndex(cues, frame)
  // Line Build is a running stack: it must keep the last lines on screen through the pauses
  // between cues, or a stack that took four cues to assemble flickers away in every gap.
  const holdsBetweenCues = style.id === 'remotion-caption-cine-line-build'
  const cue = index >= 0 ? cues[index]! : null
  const showBody = cue !== null && (active !== null || holdsBetweenCues)
  const metrics = metricsFor(
    style,
    width,
    height,
    cue ? cue.lines.map((line) => [...line.text].length) : [],
  )

  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        zIndex: captionLayerZIndex(project, scene),
        contain: 'layout style',
        isolation: 'isolate',
        ...(scene ? sceneTransformStyle(scene) : {}),
      }}
    >
      {style.id === 'remotion-caption-cine-scrim-roll' ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '58%',
            background: 'linear-gradient(180deg, transparent, rgba(6,6,5,0.72) 46%, rgba(6,6,5,0.96))',
          }}
        />
      ) : null}

      {showBody && cue ? (
        <AbsoluteFill style={outerStyle(style, metrics)} data-caption-style={style.id}>
          {style.id === 'remotion-caption-cine-word-pop' ? (
            <WordPop style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-keyword-stack' ? (
            <KeywordStack style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-scrim-roll' ? (
            <ScrimRoll style={style} cue={cue} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-line-build' ? (
            <LineBuild style={style} cues={cues} index={index} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
          {style.id === 'remotion-caption-cine-held' ? (
            <Held style={style} cue={cue} wordById={wordById} frame={frame} fps={fps} metrics={metrics} />
          ) : null}
        </AbsoluteFill>
      ) : null}

      {style.grain > 0.01 ? <Grain t={frame / fps} amount={style.grain} /> : null}
    </AbsoluteFill>
  )
}

function outerStyle(style: ResolvedNewCaptionStyle, metrics: Metrics): CSSProperties {
  if (style.id === 'remotion-caption-cine-keyword-stack') {
    return {
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: `0 ${metrics.safeInset}px 0 ${Math.round(metrics.safeInset * 1.4)}px`,
    }
  }
  if (style.id === 'remotion-caption-cine-scrim-roll') {
    return {
      alignItems: 'flex-start',
      justifyContent: 'flex-end',
      padding: `0 ${metrics.safeInset}px ${metrics.bottomOffset}px ${Math.round(metrics.safeInset * 1.4)}px`,
    }
  }
  if (style.id === 'remotion-caption-cine-line-build') {
    return {
      alignItems: 'center',
      justifyContent: 'flex-end',
      padding: `0 ${metrics.safeInset}px ${metrics.bottomOffset}px`,
    }
  }
  return { alignItems: 'center', justifyContent: 'center', padding: metrics.safeInset }
}

interface BodyProps {
  readonly style: ResolvedNewCaptionStyle
  readonly cue: CaptionCue
  readonly wordById: ReadonlyMap<string, CaptionWord>
  readonly frame: number
  readonly fps: number
  readonly metrics: Metrics
}
```

- [ ] **Step 5: Caption 01 — Word Pop**

```tsx
/** CAPTION 01 · WORD POP — karaoke. Each word pops at its own measured onset; the word being
 *  spoken burns accent. */
function WordPop({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const shadow = `0 ${Math.max(2, Math.round(metrics.fontSize * 0.06))}px 0 rgba(0,0,0,0.6)`
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: Math.round(metrics.fontSize * 0.29),
        rowGap: Math.round(metrics.fontSize * 0.04),
        maxWidth: metrics.maxWidth,
      }}
    >
      {cue.wordIds.map((id) => {
        const word = wordById.get(id)
        if (!word) return null
        const pop = MOTION.pop(t, word.startFrame / fps)
        const now = captionWordIsActive(word, frame)
        return (
          <span
            key={word.id}
            style={{
              fontFamily: COND,
              fontWeight: 600,
              fontSize: metrics.fontSize,
              textTransform: 'uppercase',
              lineHeight: 1.08,
              display: 'inline-block',
              color: now ? style.accentColor : style.textColor,
              opacity: pop.opacity * (now ? 1 : 0.9),
              transform: pop.transform,
              textShadow: now
                ? `0 0 ${Math.round(metrics.fontSize * 0.42)}px ${style.accentColor}55, ${shadow}`
                : shadow,
            }}
          >
            {word.text}
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 6: Caption 02 — Keyword Stack**

```tsx
/** CAPTION 02 · KEYWORD STACK — the opening line sits dim as setup; the key word turns accent as
 *  a rule swipes under it, timed to that word. */
function KeywordStack({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  const setup = cue.lines.length > 1 ? cue.lines[0]! : null
  const payoff = cue.lines.length > 1 ? cue.lines.slice(1) : cue.lines
  const targetId =
    cue.importantWordIds[0] ??
    cue.wordIds.find((id) => {
      const word = wordById.get(id)
      return Boolean(word && captionWordIsActive(word, frame))
    }) ??
    cue.wordIds[cue.wordIds.length - 1]
  const target = targetId ? wordById.get(targetId) : undefined
  const swipe = target ? MOTION.sweep(t, target.startFrame / fps, 0.7, Ease.outExpo) : 0
  const hot = swipe > 0.15

  return (
    <div style={{ maxWidth: metrics.maxWidth }}>
      {setup ? (
        <div
          style={{
            fontFamily: SERIF,
            fontSize: Math.round(metrics.fontSize * 0.8),
            letterSpacing: '0.14em',
            color: DIM,
            ...MOTION.rise(t, cueStart, 0.9, Math.round(metrics.fontSize * 0.22)),
          }}
        >
          {setup.text}
        </div>
      ) : null}
      <div
        style={{
          marginTop: setup ? Math.round(metrics.fontSize * 0.36) : 0,
          ...MOTION.rise(t, cueStart + 0.12, 0.9, Math.round(metrics.fontSize * 0.3)),
        }}
      >
        {payoff.map((line, lineIndex) => (
          <div
            key={`${cue.id}:${lineIndex}`}
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: metrics.fontSize,
              letterSpacing: '0.08em',
              color: style.textColor,
              lineHeight: 1.2,
            }}
          >
            {line.wordIds.map((id, wordIndex) => {
              const word = wordById.get(id)
              if (!word) return null
              const isTarget = word.id === targetId
              const lead = wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : null
              return (
                <Fragment key={word.id}>
                  {lead}
                  <span style={{ position: 'relative', display: 'inline-block' }}>
                    <span
                      style={{
                        color: isTarget && hot ? style.accentColor : style.textColor,
                        textShadow: isTarget && hot
                          ? `0 0 ${Math.round(metrics.fontSize * 0.4)}px ${style.accentColor}4d`
                          : 'none',
                      }}
                    >
                      {word.text}
                    </span>
                    {isTarget ? (
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: -Math.round(metrics.fontSize * 0.17),
                          height: Math.max(2, Math.round(metrics.fontSize * 0.06)),
                          background: style.accentColor,
                          transform: `scaleX(${swipe.toFixed(3)})`,
                          transformOrigin: 'left',
                        }}
                      />
                    ) : null}
                  </span>
                </Fragment>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Caption 03 — Scrim Roll**

```tsx
/** CAPTION 03 · SCRIM ROLL — lower-third narration on the layer's scrim; lines rise in sequence
 *  behind a blinking accent block. */
function ScrimRoll({
  style,
  cue,
  frame,
  fps,
  metrics,
}: Omit<BodyProps, 'wordById'>): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  return (
    <div style={{ maxWidth: metrics.maxWidth }}>
      {cue.lines.map((line, index) => (
        <div
          key={`${cue.id}:${index}`}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: Math.round(metrics.fontSize * 0.35),
            ...MOTION.rise(t, cueStart + index * 0.18, 0.7, Math.round(metrics.fontSize * 0.3)),
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: metrics.fontSize,
              letterSpacing: '0.05em',
              lineHeight: 1.48,
              color: style.textColor,
            }}
          >
            {line.text}
          </span>
          {index === cue.lines.length - 1 ? (
            <span
              style={{
                width: Math.round(metrics.fontSize * 0.4),
                height: Math.round(metrics.fontSize * 0.85),
                background: style.accentColor,
                opacity: Math.floor(t * 2) % 2 ? 0.9 : 0.15,
              }}
            />
          ) : null}
        </div>
      ))}
      <div
        style={{
          marginTop: Math.round(metrics.fontSize * 0.9),
          fontFamily: MONO,
          fontSize: Math.max(9, Math.round(metrics.fontSize * 0.45)),
          letterSpacing: '0.34em',
          color: 'rgba(236,229,216,0.34)',
        }}
      >
        NARRATION
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Caption 04 — Line Build**

```tsx
/** CAPTION 04 · LINE BUILD — lines stack upward as they are spoken; earlier ones drift and dim
 *  while the newest lands in accent. Each cue's onset is its first word's real onset. */
function LineBuild({
  style,
  cues,
  index,
  frame,
  fps,
  metrics,
}: {
  readonly style: ResolvedNewCaptionStyle
  readonly cues: readonly CaptionCue[]
  readonly index: number
  readonly frame: number
  readonly fps: number
  readonly metrics: Metrics
}): JSX.Element {
  const t = frame / fps
  const visible = cues.slice(Math.max(0, index - 3), index + 1)
  const shadow = `0 ${Math.max(2, Math.round(metrics.fontSize * 0.06))}px 0 rgba(0,0,0,0.6)`
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: metrics.maxWidth }}>
      {visible.map((cue, position) => {
        const age = visible.length - 1 - position
        const newest = age === 0
        const rise = MOTION.rise(t, cue.startFrame / fps, 0.75, Math.round(metrics.fontSize * 0.55))
        const offset = Number.parseFloat(rise.transform.replace(/[^\d.-]/gu, '')) || 0
        return (
          <div
            key={cue.id}
            style={{
              fontFamily: COND,
              fontWeight: newest ? 600 : 300,
              fontSize: newest ? metrics.fontSize : Math.round(metrics.fontSize * 0.74),
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              lineHeight: 1.32,
              textAlign: 'center',
              color: newest ? style.accentColor : style.textColor,
              opacity: rise.opacity * (newest ? 1 : 0.26),
              transform: `translateY(${(-age * metrics.fontSize * 0.24 + offset).toFixed(2)}px) scale(${(1 - age * 0.03).toFixed(3)})`,
              textShadow: shadow,
            }}
          >
            {cue.text}
          </div>
        )
      })}
      <div
        style={{
          marginTop: Math.round(metrics.fontSize * 0.48),
          width: Math.round(metrics.fontSize * 2.2),
          height: 1,
          background: 'rgba(236,229,216,0.3)',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 9: Caption 05 — Held Statement**

```tsx
/** CAPTION 05 · HELD STATEMENT — letterspacing tightens as the cue settles; the emphasised word
 *  switches to accent with a glow, under a hairline rule. */
function Held({ style, cue, wordById, frame, fps, metrics }: BodyProps): JSX.Element {
  const t = frame / fps
  const cueStart = cue.startFrame / fps
  const span = Math.max(0.3, (cue.endFrame - cue.startFrame) / fps)
  const tighten = MOTION.sweep(t, cueStart + 0.05, span * 0.62, Ease.outExpo)
  const letterSpacing = `${(0.46 - 0.3 * tighten).toFixed(3)}em`
  const importantId = cue.importantWordIds[0]
  const hotAt = importantId
    ? (wordById.get(importantId)?.startFrame ?? cue.startFrame) / fps
    : cueStart + span * 0.5
  const hot = MOTION.sweep(t, hotAt, 0.55)

  return (
    <div style={{ textAlign: 'center', maxWidth: metrics.maxWidth }}>
      <div
        style={{
          fontFamily: SERIF,
          fontSize: metrics.fontSize,
          lineHeight: 1.42,
          color: style.textColor,
          letterSpacing,
          textIndent: letterSpacing,
          opacity: MOTION.sweep(t, cueStart, 0.4),
        }}
      >
        {cue.wordIds.map((id, wordIndex) => {
          const word = wordById.get(id)
          if (!word) return null
          const emphasised = word.id === importantId && hot > 0.1
          const lead = wordIndex > 0 && captionNeedsLeadingSpace(word.text) ? ' ' : null
          return (
            <Fragment key={word.id}>
              {lead}
              <span
                style={{
                  color: emphasised ? style.accentColor : style.textColor,
                  textShadow: emphasised
                    ? `0 0 ${Math.round(metrics.fontSize * 0.45)}px ${style.accentColor}66`
                    : 'none',
                }}
              >
                {word.text}
              </span>
            </Fragment>
          )
        })}
      </div>
      <div
        style={{
          margin: `${Math.round(metrics.fontSize * 0.84)}px auto 0`,
          width: Math.round(metrics.fontSize * 5.5 * clamp(MOTION.sweep(t, cueStart + 0.25, 0.9))),
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(236,229,216,0.6), transparent)',
        }}
      />
    </div>
  )
}
```

- [ ] **Step 10: Dispatch from `composition.tsx`**

Add to the imports:

```ts
import { NewCaptionLayer, usesNewCaptionTemplate } from './new-templates/captions'
```

Change only the final caption line inside `RemotionVideo`. It currently reads:

```tsx
      <CaptionLayer project={project} />
```

It becomes:

```tsx
      {/* Exactly one caption layer draws. The Cinematic set has its own typography, paging and
          film texture, and resolveCaptionStyle would otherwise fall back to `highlight` and
          silently render one of the existing styles instead. */}
      {usesNewCaptionTemplate(project)
        ? <NewCaptionLayer project={project} />
        : <CaptionLayer project={project} />}
```

Change nothing else in `composition.tsx`.

- [ ] **Step 11: Typecheck everything from Tasks 4 to 6**

```bash
npm run typecheck
npx vitest run test/unit/video-engine/new-templates.test.ts
npm test
```

Expected: all clean. `npm test` must still pass every pre-existing suite.

- [ ] **Step 12: Build**

```bash
npm run build
```

Expected: pass. This is the first point at which the new components are compiled into both the
renderer and the main bundle.

- [ ] **Step 13: Report**

Confirm that exactly one caption layer can draw at a time, that grain and the Scrim Roll scrim
live on the layer rather than the cue, and that no existing caption style's output changed.

---

### Task 7: The plan builder, the New Templates accordion, and its styling

**Files:**
- Create: `src/features/video-studio/editor/newTemplates.ts`
- Create: `src/features/video-studio/editor/NewTemplatesAccordion.tsx`
- Modify: `src/features/video-studio/editor/Inspector.tsx` (one import; one line in `HookPanel`, one in `CaptionsPanel`)
- Modify: `src/features/video-studio/editor/editor.css` (appended block at the end of the file)
- Test: `test/unit/video-engine/new-templates.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `NEW_HOOK_DEFINITIONS`, `NEW_HOOK_TEMPLATE_IDS`, `NEW_CAPTION_DEFINITIONS`, `NEW_CAPTION_TEMPLATE_IDS`, `NEW_TEMPLATE_ACCENT`, `type HookPlan`, `type JsonObject`, `type NewHookDefinition`, `type NewHookTemplateId`, `type NewCaptionTemplateId`, `type VideoTemplate` from `@shared/video-engine`; `useEditor` — specifically `project`, `templates`, `busy`, `importHookPlan`, `setCaptionTemplate`.
- Produces:
  - `interface NewHookDraft { text: Record<string, string>; numbers: Record<string, number>; accentColor: string; grain: number; seconds: number }`
  - `newHookDraft(definition: NewHookDefinition): NewHookDraft`
  - `newHookPlan(options: { template: VideoTemplate; definition: NewHookDefinition; draft: NewHookDraft; fps: number }): HookPlan`
  - `newCaptionProps(id: NewCaptionTemplateId, draft: NewCaptionDraft): JsonObject`
  - `interface NewCaptionDraft { accentColor: string; textColor: string; grain: number; maxWordsPerCue: number; maxCharactersPerLine: number }`
  - `newCaptionDraft(id: NewCaptionTemplateId): NewCaptionDraft`
  - `NewTemplatesAccordion: React.FC<{ kind: 'hook' | 'caption' }>`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/video-engine/new-templates.test.ts`. Add these imports:

```ts
import { compileHookPlan } from '../../../electron/services/video-engine/hook-compiler'
import { HookPlanSchema, createEmptyVideoProject } from '../../../shared/video-engine'
import { newCaptionDraft, newCaptionProps, newHookDraft, newHookPlan } from '../../../src/features/video-studio/editor/newTemplates'
```

`createEmptyVideoProject` is exported from `shared/video-engine/model.ts` and takes
`{ id, name, rendererId, width, height, fps, durationFrames, now? }` — it builds the canvas
itself, so pass the dimensions rather than a canvas object.

```ts
describe('new hook plans', () => {
  it.each([24, 30, 60])('builds a compiler-accepted single-beat plan at %i fps', (fps) => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const template = registry.require(id)
      const draft = newHookDraft(definition)
      const plan = newHookPlan({ template, definition, draft, fps })

      expect(HookPlanSchema.parse(plan)).toEqual(plan)
      expect(plan.rendererId).toBe('remotion')
      expect(plan.templateId).toBe(id)
      expect(plan.templateVersion).toBe('1.0.0')
      expect(plan.fps).toBe(fps)
      expect(plan.beats).toHaveLength(1)
      expect(plan.beats[0]!.startFrame).toBe(0)
      expect(plan.beats[0]!.durationFrames).toBe(plan.durationFrames)
      expect(plan.beats[0]!.visual).toEqual({ kind: 'none' })
      expect(plan.durationFrames).toBe(Math.round(definition.defaultSeconds * fps))

      const headlineField = definition.textFields.find((field) => field.role === 'headline')!
      const bodyField = definition.textFields.find((field) => field.role === 'body')
      expect(plan.beats[0]!.headline).toBe(headlineField.default)
      expect(plan.beats[0]!.body).toBe(bodyField ? bodyField.default : undefined)

      // Every declared parameter is present and nothing undeclared is, or resolveTemplateProps
      // throws inside compileHookPlan.
      for (const field of definition.textFields) expect(plan.props![field.key]).toBe(field.default)
      for (const field of definition.numberFields) expect(plan.props![field.key]).toBe(field.default)
      expect(plan.props!['grain']).toBe(definition.grain)
      expect(Object.hasOwn(plan.props!, 'accentColor')).toBe(definition.usesAccent)

      const project = createEmptyVideoProject({
        id: 'proj-new-templates',
        name: 'New templates',
        rendererId: 'remotion',
        width: 1920,
        height: 1080,
        fps,
        durationFrames: fps * 20
      })
      const compiled = compileHookPlan(project, plan, registry)
      const scene = compiled.project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
      expect(scene?.template?.id).toBe(id)
      expect(scene?.durationFrames).toBe(plan.durationFrames)
      expect(compiled.brollRequests).toHaveLength(0)
    }
  })

  it('never emits an empty headline or an over-long field', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_HOOK_TEMPLATE_IDS) {
      const definition = NEW_HOOK_DEFINITIONS[id]
      const template = registry.require(id)
      const emptied = newHookDraft(definition)
      for (const key of Object.keys(emptied.text)) emptied.text[key] = '   '
      const plan = newHookPlan({ template, definition, draft: emptied, fps: 30 })
      expect(HookPlanSchema.parse(plan)).toEqual(plan)
      expect(plan.beats[0]!.headline!.length).toBeGreaterThan(0)

      const flooded = newHookDraft(definition)
      for (const key of Object.keys(flooded.text)) flooded.text[key] = 'x'.repeat(5000)
      const bounded = newHookPlan({ template, definition, draft: flooded, fps: 30 })
      expect(HookPlanSchema.parse(bounded)).toEqual(bounded)
      for (const field of definition.textFields) {
        expect(String(bounded.props![field.key]).length).toBeLessThanOrEqual(field.maxLength)
      }
    }
  })

  it('clamps the length to the manifest range and the 30-second ceiling', () => {
    const registry = new VideoTemplateRegistry()
    const id = NEW_HOOK_TEMPLATE_IDS[0]
    const definition = NEW_HOOK_DEFINITIONS[id]
    const template = registry.require(id)
    const tiny = newHookPlan({ template, definition, draft: { ...newHookDraft(definition), seconds: 0 }, fps: 30 })
    expect(tiny.durationFrames).toBe(12)
    const huge = newHookPlan({ template, definition, draft: { ...newHookDraft(definition), seconds: 999 }, fps: 30 })
    expect(huge.durationFrames).toBe(900)
    expect(HookPlanSchema.parse(huge)).toEqual(huge)
  })

  it('builds caption props that resolveTemplateProps accepts', () => {
    const registry = new VideoTemplateRegistry()
    for (const id of NEW_CAPTION_TEMPLATE_IDS) {
      const props = newCaptionProps(id, newCaptionDraft(id))
      const resolved = resolveTemplateProps(registry.require(id), props)
      const definition = NEW_CAPTION_DEFINITIONS[id]
      expect(resolved['grain']).toBe(definition.grain)
      expect(resolved['maxWordsPerCue']).toBe(definition.maxWordsPerCue)
      expect(resolveNewCaptionStyle(id, resolved)).toEqual(definition)
      const wild = newCaptionProps(id, {
        accentColor: 'nonsense',
        textColor: '#abcdef',
        grain: 9,
        maxWordsPerCue: -4,
        maxCharactersPerLine: 900,
      })
      expect(() => resolveTemplateProps(registry.require(id), wild)).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts -t 'new hook plans'
```

Expected: FAIL — `src/features/video-studio/editor/newTemplates` does not exist.

- [ ] **Step 3: Write the plan and props builders**

Create `src/features/video-studio/editor/newTemplates.ts`:

```ts
import {
  NEW_CAPTION_DEFINITIONS,
  NEW_TEMPLATE_ACCENT,
  type HookPlan,
  type JsonObject,
  type NewCaptionTemplateId,
  type NewHookDefinition,
  type VideoTemplate
} from '@shared/video-engine'

/* Drafts and builders for the Cinematic set's accordion.
 *
 * The hook path deliberately produces a SINGLE-beat plan and sends it out through the existing
 * `importHookPlan`, which is the same validated, zod-checked entry point the premade and AI hooks
 * use. No new IPC and no second compiler. The primary line is written to both the beat headline
 * and the matching prop, so the existing Beats list edits the same line this accordion does. */

const HEX = /^#[0-9A-Fa-f]{6}$/u

function normalizedHex(value: string, fallback: string): string {
  return HEX.test(value) ? value.toUpperCase() : fallback.toUpperCase()
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export interface NewHookDraft {
  text: Record<string, string>
  numbers: Record<string, number>
  accentColor: string
  grain: number
  seconds: number
}

export function newHookDraft(definition: NewHookDefinition): NewHookDraft {
  return {
    text: Object.fromEntries(definition.textFields.map((field) => [field.key, field.default])),
    numbers: Object.fromEntries(definition.numberFields.map((field) => [field.key, field.default])),
    accentColor: NEW_TEMPLATE_ACCENT.toUpperCase(),
    grain: definition.grain,
    seconds: definition.defaultSeconds
  }
}

export function newHookPlan(options: {
  template: VideoTemplate
  definition: NewHookDefinition
  draft: NewHookDraft
  fps: number
}): HookPlan {
  const { template, definition, draft, fps } = options
  // The compiler checks the plan against the manifest range, and the schema refuses anything past
  // 30 seconds. Clamp here so a slider at either end produces a plan rather than an error.
  const durationFrames = Math.max(
    template.duration.minimumFrames,
    Math.min(
      template.duration.maximumFrames,
      Math.min(fps * 30, Math.max(1, Math.round(draft.seconds * fps)))
    )
  )

  const props: JsonObject = { grain: clampUnit(draft.grain) }
  for (const field of definition.textFields) {
    // An emptied field falls back to the delivered default: the schema requires a non-empty
    // headline, so writing '' would fail validation with a message about nothing the user did.
    const typed = (draft.text[field.key] ?? '').trim()
    props[field.key] = (typed || field.default).slice(0, field.maxLength)
  }
  for (const field of definition.numberFields) {
    const raw = draft.numbers[field.key]
    const value = Number.isFinite(raw) ? (raw as number) : field.default
    const bounded = Math.max(field.minimum, Math.min(field.maximum, value))
    props[field.key] = field.integer ? Math.round(bounded) : bounded
  }
  if (definition.usesAccent) {
    props['accentColor'] = normalizedHex(draft.accentColor, NEW_TEMPLATE_ACCENT)
  }

  const headlineField = definition.textFields.find((field) => field.role === 'headline')
  const bodyField = definition.textFields.find((field) => field.role === 'body')
  const headline = String(props[headlineField?.key ?? ''] ?? definition.name).slice(0, 500)
  const body = bodyField ? String(props[bodyField.key] ?? '').slice(0, 2000) : ''

  return {
    schemaVersion: 1,
    rendererId: 'remotion',
    templateId: template.id,
    templateVersion: template.version,
    fps,
    title: headline,
    durationFrames,
    props,
    beats: [
      {
        id: 'beat-1',
        startFrame: 0,
        durationFrames,
        headline,
        ...(body ? { body } : {}),
        visual: { kind: 'none' as const }
      }
    ]
  }
}

export interface NewCaptionDraft {
  accentColor: string
  textColor: string
  grain: number
  maxWordsPerCue: number
  maxCharactersPerLine: number
}

export function newCaptionDraft(id: NewCaptionTemplateId): NewCaptionDraft {
  const definition = NEW_CAPTION_DEFINITIONS[id]
  return {
    accentColor: definition.accentColor.toUpperCase(),
    textColor: definition.textColor.toUpperCase(),
    grain: definition.grain,
    maxWordsPerCue: definition.maxWordsPerCue,
    maxCharactersPerLine: definition.maxCharactersPerLine
  }
}

export function newCaptionProps(id: NewCaptionTemplateId, draft: NewCaptionDraft): JsonObject {
  const definition = NEW_CAPTION_DEFINITIONS[id]
  const bounded = (value: number, fallback: number, minimum: number, maximum: number): number =>
    Number.isFinite(value)
      ? Math.max(minimum, Math.min(maximum, Math.round(value)))
      : fallback
  return {
    accentColor: normalizedHex(draft.accentColor, definition.accentColor),
    textColor: normalizedHex(draft.textColor, definition.textColor),
    grain: clampUnit(draft.grain),
    maxWordsPerCue: bounded(draft.maxWordsPerCue, definition.maxWordsPerCue, 1, 12),
    maxCharactersPerLine: bounded(draft.maxCharactersPerLine, definition.maxCharactersPerLine, 10, 42)
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npx vitest run test/unit/video-engine/new-templates.test.ts
npm run typecheck
```

Expected: PASS. If `newHookPlan`'s `visual` literal fails to typecheck, keep the
`as const` on `kind` and do not widen the returned type.

- [ ] **Step 5: Write the accordion**

Create `src/features/video-studio/editor/NewTemplatesAccordion.tsx`:

```tsx
import { useMemo, useState } from 'react'
import {
  NEW_CAPTION_DEFINITIONS,
  NEW_CAPTION_TEMPLATE_IDS,
  NEW_HOOK_DEFINITIONS,
  NEW_HOOK_TEMPLATE_IDS,
  isNewCaptionTemplateId,
  type NewCaptionTemplateId,
  type NewHookTemplateId
} from '@shared/video-engine'
import { useEditor } from './useEditor'
import {
  newCaptionDraft,
  newCaptionProps,
  newHookDraft,
  type NewCaptionDraft,
  type NewHookDraft
} from './newTemplates'
import { newHookPlan } from './newTemplates'

/* The New Templates accordion — the Cinematic Hooks and Captions set.
 *
 * Collapsed by default and rendered above the panels it joins, so neither the Hook panel nor the
 * Captions panel looks any different until it is opened. <details> is this editor's existing
 * accordion idiom (see details.ve-bin-cycle in MediaBin and the model-prompt disclosure in the
 * Hook panel), so it inherits the keyboard behaviour for free.
 *
 * Hooks go out through the same validated importHookPlan the premade hooks use; captions through
 * the same setCaptionTemplate the existing styles use. Nothing here is a new code path into the
 * project. */

const MAX_NEW_HOOK_SECONDS = 30

export function NewTemplatesAccordion({ kind }: { kind: 'hook' | 'caption' }): JSX.Element | null {
  return kind === 'hook' ? <NewHookTemplates /> : <NewCaptionTemplates />
}

function NewHookTemplates(): JSX.Element | null {
  const project = useEditor((state) => state.project)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const importHookPlan = useEditor((state) => state.importHookPlan)
  const [selectedId, setSelectedId] = useState<NewHookTemplateId | ''>('')
  const [draft, setDraft] = useState<NewHookDraft | null>(null)

  const available = useMemo(
    () => NEW_HOOK_TEMPLATE_IDS
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is NonNullable<typeof template> => Boolean(template)),
    [templates]
  )

  if (!project || available.length === 0) return null

  const fps = project.canvas.fps
  const template = selectedId ? available.find((candidate) => candidate.id === selectedId) : undefined
  const definition = selectedId ? NEW_HOOK_DEFINITIONS[selectedId] : null

  const select = (id: NewHookTemplateId): void => {
    setSelectedId(id)
    setDraft(newHookDraft(NEW_HOOK_DEFINITIONS[id]))
  }

  return (
    <details className="ve-newtpl">
      <summary>New Templates</summary>
      <div className="ve-newtpl-body">
        <p className="ve-hint">
          Five cinematic openers: type on black, 35mm grain and vignette above everything, one accent
          per frame. Reel Burn and Margin Note sit over the clip on the timeline underneath.
        </p>
        <div className="ve-list">
          {available.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`ve-listitem${candidate.id === selectedId ? ' is-on' : ''}`}
              onClick={() => select(candidate.id as NewHookTemplateId)}
              title={candidate.description || candidate.name}
            >
              <span className="ve-listitem-title">{candidate.name}</span>
              <span className="ve-listitem-sub">{candidate.description || candidate.id}</span>
            </button>
          ))}
        </div>

        {definition && draft && template ? (
          <>
            {definition.textFields.map((field) => (
              <label className="ve-row" key={field.key}>
                <span className="ve-row-label">
                  {field.label}
                  {field.hint ? <span className="ve-row-hint">{field.hint}</span> : null}
                </span>
                <input
                  className="ve-input"
                  value={draft.text[field.key] ?? ''}
                  maxLength={field.maxLength}
                  onChange={(event) =>
                    setDraft({ ...draft, text: { ...draft.text, [field.key]: event.target.value } })}
                />
              </label>
            ))}

            {definition.numberFields.map((field) => (
              <label className="ve-row" key={field.key}>
                <span className="ve-row-label">{field.label}</span>
                <input
                  className="ve-input"
                  type="number"
                  min={field.minimum}
                  max={field.maximum}
                  value={draft.numbers[field.key] ?? field.default}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      numbers: { ...draft.numbers, [field.key]: Number(event.target.value) }
                    })}
                />
              </label>
            ))}

            <label className="ve-row">
              <span className="ve-row-label">
                Length
                <span className="ve-row-hint">{draft.seconds.toFixed(1)}s · {Math.round(draft.seconds * fps)}f</span>
              </span>
              <input
                type="range"
                min={1}
                max={MAX_NEW_HOOK_SECONDS}
                step={0.5}
                value={draft.seconds}
                onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })}
              />
            </label>

            <label className="ve-row">
              <span className="ve-row-label">
                Film grain
                <span className="ve-row-hint">{Math.round(draft.grain * 100)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={draft.grain}
                onChange={(event) => setDraft({ ...draft, grain: Number(event.target.value) })}
              />
            </label>

            {definition.usesAccent ? (
              <label className="ve-row">
                <span className="ve-row-label">
                  Accent
                  <span className="ve-row-hint">One accent per video</span>
                </span>
                <input
                  className="ve-newtpl-swatch"
                  type="color"
                  value={draft.accentColor}
                  onChange={(event) => setDraft({ ...draft, accentColor: event.target.value.toUpperCase() })}
                />
              </label>
            ) : null}

            <div className="ve-actions">
              <button
                type="button"
                className="ve-btn ve-btn--primary"
                disabled={!!busy}
                title="Compiles a single-beat plan through the same validated importer the other hooks use."
                onClick={() => void importHookPlan(
                  JSON.stringify(newHookPlan({ template, definition, draft, fps }))
                )}
              >
                {busy === 'Importing the hook' ? 'Adding…' : 'Add this hook'}
              </button>
              <button
                type="button"
                className="ve-btn ve-btn--soft"
                disabled={!!busy}
                onClick={() => setDraft(newHookDraft(definition))}
              >
                Reset the text
              </button>
            </div>
            <p className="ve-hint">
              Wrap a word in *asterisks* to make it the accent word. The first line also appears in the
              Beats list below, so either place edits it.
            </p>
          </>
        ) : (
          <p className="ve-hint">Pick one of the five above to edit its lines.</p>
        )}
      </div>
    </details>
  )
}

function NewCaptionTemplates(): JSX.Element | null {
  const project = useEditor((state) => state.project)
  const templates = useEditor((state) => state.templates)
  const busy = useEditor((state) => state.busy)
  const setCaptionTemplate = useEditor((state) => state.setCaptionTemplate)
  const activeId = project?.captions?.templateId
  const [draft, setDraft] = useState<NewCaptionDraft | null>(null)

  const available = useMemo(
    () => NEW_CAPTION_TEMPLATE_IDS
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is NonNullable<typeof template> => Boolean(template)),
    [templates]
  )

  if (!project || available.length === 0) return null

  const words = project.captions?.words ?? []
  const selectedId = isNewCaptionTemplateId(activeId) ? activeId : null
  const effective = draft ?? (selectedId ? newCaptionDraft(selectedId) : null)

  const apply = (id: NewCaptionTemplateId, next: NewCaptionDraft): void => {
    setDraft(next)
    void setCaptionTemplate(id, newCaptionProps(id, next))
  }

  return (
    <details className="ve-newtpl">
      <summary>New Templates</summary>
      <div className="ve-newtpl-body">
        <p className="ve-hint">
          Five cinematic caption systems, timed from the words above rather than a fixed rhythm — no
          boxes, no pills, one accent. Scrim Roll is the one that reads over footage.
        </p>
        {words.length === 0 ? (
          <p className="ve-hint">
            Transcribe this clip or import an SRT first — these styles draw the words that are actually
            spoken, so there is nothing to show until the timings exist.
          </p>
        ) : null}
        <div className="ve-list">
          {available.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              className={`ve-listitem${candidate.id === selectedId ? ' is-on' : ''}`}
              disabled={!!busy || words.length === 0}
              title={candidate.description || candidate.name}
              onClick={() => {
                const id = candidate.id as NewCaptionTemplateId
                apply(id, newCaptionDraft(id))
              }}
            >
              <span className="ve-listitem-title">{candidate.name}</span>
              <span className="ve-listitem-sub">{candidate.description || candidate.id}</span>
            </button>
          ))}
        </div>

        {selectedId && effective ? (
          <>
            <label className="ve-row">
              <span className="ve-row-label">Accent</span>
              <input
                className="ve-newtpl-swatch"
                type="color"
                value={effective.accentColor}
                onChange={(event) =>
                  apply(selectedId, { ...effective, accentColor: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">Text</span>
              <input
                className="ve-newtpl-swatch"
                type="color"
                value={effective.textColor}
                onChange={(event) =>
                  apply(selectedId, { ...effective, textColor: event.target.value.toUpperCase() })}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Film grain
                <span className="ve-row-hint">{Math.round(effective.grain * 100)}% · 0 turns it off</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={effective.grain}
                onChange={(event) => setDraft({ ...effective, grain: Number(event.target.value) })}
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Words per cue
                <span className="ve-row-hint">{effective.maxWordsPerCue}</span>
              </span>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={effective.maxWordsPerCue}
                onChange={(event) => setDraft({ ...effective, maxWordsPerCue: Number(event.target.value) })}
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
            <label className="ve-row">
              <span className="ve-row-label">
                Characters per line
                <span className="ve-row-hint">{effective.maxCharactersPerLine}</span>
              </span>
              <input
                type="range"
                min={10}
                max={42}
                step={1}
                value={effective.maxCharactersPerLine}
                onChange={(event) =>
                  setDraft({ ...effective, maxCharactersPerLine: Number(event.target.value) })}
                onMouseUp={() => apply(selectedId, effective)}
                onBlur={() => apply(selectedId, effective)}
              />
            </label>
          </>
        ) : (
          <p className="ve-hint">Pick one of the five above to adjust its colours and paging.</p>
        )}
      </div>
    </details>
  )
}
```

Merge the two `./newTemplates` imports into one statement before you finish — the split above is
only for readability here.

- [ ] **Step 6: Mount it in both panels**

In `src/features/video-studio/editor/Inspector.tsx`, add one import beside the existing
`./hookPlan` import:

```ts
import { NewTemplatesAccordion } from './NewTemplatesAccordion'
```

In `HookPanel`, make it the first child of the returned fragment — the line currently after
`return (` and `<>` is `<Section title="Hook template"`, so insert directly above it:

```tsx
      <NewTemplatesAccordion kind="hook" />
```

In `CaptionsPanel`, insert it immediately **after** the closing `</Section>` of the `Word timings`
section and before the `{captionTemplates.length > 0 && (` block. Caption styles need word
timings, so the accordion sits under the control that produces them:

```tsx
      <NewTemplatesAccordion kind="caption" />
```

Change nothing else in `Inspector.tsx`.

- [ ] **Step 7: Append the styling**

Append this block to the **end** of `src/features/video-studio/editor/editor.css`. Do not modify
any existing rule.

```css
/* --- New Templates accordion (Cinematic Hooks and Captions) --------------------------- */
.ve-newtpl {
  display: grid;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgb(var(--ve-border));
  border-radius: var(--ve-radius);
  background: rgb(var(--ve-card));
}
.ve-newtpl > summary {
  cursor: pointer;
  list-style: none;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--ve-fg-dim));
}
.ve-newtpl > summary::-webkit-details-marker { display: none; }
.ve-newtpl > summary::before {
  content: '\25B8';
  display: inline-block;
  width: 12px;
  color: rgb(var(--ve-accent));
}
.ve-newtpl[open] > summary { color: rgb(var(--ve-fg)); }
.ve-newtpl[open] > summary::before { content: '\25BE'; }
.ve-newtpl-body { display: grid; gap: 8px; }
.ve-newtpl-swatch {
  width: 100%;
  height: 26px;
  padding: 0;
  border: 1px solid rgb(var(--ve-border));
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
```

- [ ] **Step 8: Verify**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all three pass. If `--ve-fg`, `--ve-fg-dim`, `--ve-accent`, `--ve-border`, `--ve-card`
or `--ve-radius` is not defined in `editor.css`, grep for the token the neighbouring rules use and
match it rather than inventing a new one.

- [ ] **Step 9: Report**

Confirm the accordion is collapsed by default, that no existing `Section` moved, and that the CSS
block is appended at the end of the file.

---

### Task 8: Live verification of all ten templates against real 6-second footage

Unit tests cannot see wiring. The failures this set can actually have are a preload method with no
handler, a panel that throws on mount, a component that throws inside the `<Player>`, a caption
layer that draws twice, or a hook that compiles and then renders nothing. This boots the real app
and looks at every one of the ten.

**Files:**
- Read: `scripts/e2e-studio.mjs` (the established pattern — copy its safety and its assertion style)
- Create: `scripts/e2e-new-templates.mjs`

**Interfaces:**
- Consumes: the built app at `out/main/main.js`; `test/fixtures/broll/local/clip1.mp4` (6.000s, confirmed by ffprobe); `test/fixtures/audio/sample.mp3` (11.99s) as the seeded clip.
- Produces: `browser-test-out/new-templates/*.png` — one screenshot per template — and a non-zero exit code on any failure.

- [ ] **Step 1: Confirm the fixture is still the length the plan assumes**

```bash
./resources/bin/ffprobe.exe -v error -show_entries format=duration -of default=nw=1:nk=1 test/fixtures/broll/local/clip1.mp4
```

Expected: `6.000000`. If it differs, use whichever of `clip1.mp4`, `clip2.mp4`, `clip3.mp4` is
between 5 and 10 seconds and say which you picked.

- [ ] **Step 2: Write the script**

Create `scripts/e2e-new-templates.mjs`:

```js
/**
 * Live verification of the Cinematic Hooks and Captions set, driving the REAL Electron app
 * through Playwright — real preload bridge, real IPC handlers, real Remotion Player.
 *
 * Every one of the ten templates is selected from the New Templates accordion, applied, and then
 * seeked to four points while the renderer console is watched. A component that throws inside the
 * Player, a hook that compiles but draws nothing, or a caption layer that draws twice is invisible
 * to a unit test and obvious here.
 *
 * SAFETY: runs against a throwaway userData profile and a throwaway B-roll library, so it can
 * never read or damage the real library. The run asserts that at the end.
 *
 *   node scripts/e2e-new-templates.mjs
 *   node scripts/e2e-new-templates.mjs --keep     # leave the scratch profile for inspection
 */
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAIN = join(ROOT, 'out', 'main', 'main.js')
const FIXTURE_AUDIO = join(ROOT, 'test', 'fixtures', 'audio', 'sample.mp3')
const FIXTURE_VIDEO = join(ROOT, 'test', 'fixtures', 'broll', 'local', 'clip1.mp4')
const SHOTS = join(ROOT, 'browser-test-out', 'new-templates')
const CLIP_ID = 'cine-clip'
const CLIP_TITLE = 'Cinematic templates clip'
const KEEP = process.argv.includes('--keep')

const HOOKS = [
  ['remotion-hook-cine-title-card', 'Cine · Title Card'],
  ['remotion-hook-cine-reel-burn', 'Cine · Reel Burn'],
  ['remotion-hook-cine-hard-light', 'Cine · Hard Light'],
  ['remotion-hook-cine-trailer-drop', 'Cine · Trailer Drop'],
  ['remotion-hook-cine-margin-note', 'Cine · Margin Note']
]
const CAPTIONS = [
  ['remotion-caption-cine-word-pop', 'Cine · Word Pop'],
  ['remotion-caption-cine-keyword-stack', 'Cine · Keyword Stack'],
  ['remotion-caption-cine-scrim-roll', 'Cine · Scrim Roll'],
  ['remotion-caption-cine-line-build', 'Cine · Line Build'],
  ['remotion-caption-cine-held', 'Cine · Held Statement']
]

const failures = []
function check(ok, label, detail = '') {
  if (ok) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
  }
}

if (!existsSync(MAIN)) {
  console.error(`Build first: ${MAIN} does not exist (npm run build)`)
  process.exit(1)
}
for (const fixture of [FIXTURE_AUDIO, FIXTURE_VIDEO]) {
  if (!existsSync(fixture)) {
    console.error(`Missing fixture: ${fixture}`)
    process.exit(1)
  }
}

const scratch = join(tmpdir(), `me-cine-${Date.now()}`)
const scratchBroll = join(tmpdir(), `me-cine-broll-${Date.now()}`)
mkdirSync(scratch, { recursive: true })
mkdirSync(scratchBroll, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
console.log(`scratch profile: ${scratch}\nscreenshots    : ${SHOTS}\n`)

let app
let exitCode = 0
try {
  app = await electron.launch({
    args: [
      MAIN,
      '--no-sandbox',
      // A renderer Chromium believes is occluded gets no requestAnimationFrame, the Player goes
      // black, and every "stable element" wait times out.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    env: {
      ...process.env,
      ME_USERDATA_DIR: scratch,
      ME_BROLL_LIBRARY_DIR: scratchBroll,
      ME_E2E_SEED_AUDIO: FIXTURE_AUDIO,
      ME_E2E_SEED_ID: CLIP_ID,
      ME_E2E_SEED_TITLE: CLIP_TITLE,
      ME_TELEMETRY_OFF: '1',
      ME_E2E: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  // --- boot + isolation ----------------------------------------------------------
  console.log('boot')
  const skip = page.getByRole('button', { name: /^(Skip|Explore on my own)$/ }).first()
  await skip.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined)
  if ((await skip.count()) > 0 && (await skip.isVisible())) await skip.click()

  const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  check(
    resolve(userDataPath).toLowerCase() === resolve(scratch).toLowerCase(),
    'userData is the scratch profile',
    userDataPath
  )
  check(
    !resolve(userDataPath).toLowerCase().includes('appdata\\\\roaming\\\\mental empire studio'),
    'userData is NOT the real profile'
  )

  await page.getByRole('button', { name: 'Video Studio' }).first().click({ timeout: 10_000 })
  await page.waitForTimeout(600)

  // --- bind, add footage, add captions -------------------------------------------
  console.log('\nproject')
  const bound = await page.evaluate(async (clipId) => {
    const result = await window.api.videoEngine.bindDownload(clipId, 'remotion')
    return {
      id: result.project.id,
      fps: result.project.canvas.fps,
      durationFrames: result.project.canvas.durationFrames
    }
  }, CLIP_ID)
  check(bound.durationFrames > 0, `canvas is ${bound.durationFrames}f at ${bound.fps}fps`)
  const projectId = bound.id
  const fps = bound.fps

  const footage = await page.evaluate(async ([id, path]) => {
    const imported = await window.api.videoEngine.importAssets(id, [path])
    const video = imported.project.assets.find((asset) => asset.kind === 'video')
    if (!video) return { ok: false, message: `skipped: ${JSON.stringify(imported.skipped)}` }
    const filled = await window.api.videoEngine.fillWithMedia(id, {
      assetIds: [video.id],
      mode: 'cycle',
      segmentSeconds: 6,
      shuffle: false,
      replaceExisting: true
    })
    return { ok: true, placed: filled.placed, assetId: video.id }
  }, [projectId, FIXTURE_VIDEO])
  check(footage.ok, `6s footage placed on the timeline (${footage.placed ?? 0} clips)`, footage.message)
  if (!footage.ok) throw new Error('the footage-backed templates cannot be verified without footage')

  // An SRT needs no API key, so a scratch profile gets real word timings offline.
  const seconds = Math.floor(bound.durationFrames / fps)
  const lines = [
    "You've been braced for the explosion.",
    'The screaming match, the blocked number,',
    'the version of them that finally says the unforgivable thing.',
    "That isn't the ending.",
    "That's them still paying rent in your head."
  ]
  const stamp = (value) =>
    `00:00:${String(Math.floor(value)).padStart(2, '0')},${String(Math.round((value % 1) * 1000)).padStart(3, '0')}`
  const step = Math.max(1.6, seconds / lines.length)
  const srt = lines
    .map((text, index) => `${index + 1}\n${stamp(index * step)} --> ${stamp(index * step + step - 0.15)}\n${text}\n`)
    .join('\n')

  const captioned = await page.evaluate(async ([id, body]) => {
    const project = await window.api.videoEngine.setCaptionsFromSrt(id, body)
    return { words: project.captions?.words.length ?? 0 }
  }, [projectId, srt])
  check(captioned.words > 10, `captions imported (${captioned.words} words)`)

  // Re-bind the mounted editor so it sees everything added over raw IPC.
  const backToLibrary = page.getByRole('button', { name: 'Choose another video' }).first()
  const libraryCard = page.getByRole('button', { name: new RegExp(CLIP_TITLE, 'i') }).first()
  if ((await backToLibrary.count()) === 0) await libraryCard.click()
  else {
    await backToLibrary.click()
    await libraryCard.click()
  }
  await page.getByTestId('video-editor-workspace').waitFor({ state: 'visible', timeout: 15_000 })

  const preview = page.getByTestId('video-editor-preview')
  const playerErrors = page.locator('.ve-player-error')

  /** Seeks to four points inside a range and asserts the Player never faults. */
  const seekThrough = async (label, startFrame, durationFrames) => {
    for (const share of [0.08, 0.35, 0.62, 0.88]) {
      const frame = Math.min(
        bound.durationFrames - 1,
        Math.max(0, Math.round(startFrame + durationFrames * share))
      )
      await page.getByLabel('Playhead').fill(String(frame))
      await page.waitForTimeout(220)
      check(await playerErrors.count() === 0, `${label} seeks cleanly to frame ${frame}`)
    }
  }

  // --- the five hooks -------------------------------------------------------------
  console.log('\nnew hook templates')
  await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
  await page.getByRole('tab', { name: 'Hook generator', exact: true }).click()
  const hookAccordion = page.locator('details.ve-newtpl').first()
  await hookAccordion.locator('> summary').click()
  check(await hookAccordion.getAttribute('open') !== null, 'the New Templates accordion opens in the Hook panel')

  for (const [id, name] of HOOKS) {
    await hookAccordion.getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\\]\\\\]/gu, '\\\\$&')) }).click()
    await hookAccordion.getByRole('button', { name: 'Add this hook', exact: true }).click()
    const applied = await page
      .waitForFunction(
        async ([projectIdArg, templateId]) => {
          const project = await window.api.videoEngine.project(projectIdArg)
          const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-hook-plan')
          if (scene?.template?.id !== templateId) return null
          return {
            startFrame: scene.startFrame,
            durationFrames: scene.durationFrames,
            planFrames: scene.template?.props?.hookPlan?.durationFrames ?? 0,
            beats: scene.template?.props?.hookPlan?.beats?.length ?? 0,
            headline: scene.template?.props?.hookPlan?.beats?.[0]?.headline ?? ''
          }
        },
        [projectId, id],
        { timeout: 20_000 }
      )
      .then((handle) => handle.jsonValue())
    check(applied.beats === 1, `${name} compiles a single-beat plan`)
    check(applied.planFrames === applied.durationFrames, `${name} scene length matches its plan`)
    check(applied.headline.length > 0, `${name} carries its headline`)
    await seekThrough(name, applied.startFrame, applied.durationFrames)
    await preview.screenshot({ path: join(SHOTS, `${id}.png`) })
    check(true, `${name} screenshot captured`)
  }

  const hookPreflight = await page.evaluate(async (id) => {
    const problems = await window.api.videoEngine.preflight(id)
    return problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
  }, projectId)
  check(hookPreflight.length === 0, 'the hooked project passes export preflight', hookPreflight.join(', '))

  // --- the five captions ----------------------------------------------------------
  console.log('\nnew caption templates')
  await page.getByRole('button', { name: 'Sparkle', exact: true }).click()
  await page.getByRole('tab', { name: 'Active captions', exact: true }).click()
  const captionAccordion = page.locator('details.ve-newtpl').first()
  await captionAccordion.locator('> summary').click()
  check(
    await captionAccordion.getAttribute('open') !== null,
    'the New Templates accordion opens in the Captions panel'
  )

  for (const [id, name] of CAPTIONS) {
    await captionAccordion
      .getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\\]\\\\]/gu, '\\\\$&')) })
      .click()
    const applied = await page
      .waitForFunction(
        async ([projectIdArg, templateId]) => {
          const project = await window.api.videoEngine.project(projectIdArg)
          if (project.captions?.templateId !== templateId) return null
          const scene = project.scenes.find((candidate) => candidate.id === 'video-engine-captions')
          const words = project.captions?.words ?? []
          return {
            sceneTemplateId: scene?.template?.id ?? '',
            grain: scene?.template?.props?.grain ?? null,
            firstWordFrame: words[0]?.startFrame ?? 0,
            lastWordFrame: words[words.length - 1]?.endFrame ?? 0,
            captionSceneCount: project.scenes.filter((candidate) => candidate.kind === 'caption').length
          }
        },
        [projectId, id],
        { timeout: 20_000 }
      )
      .then((handle) => handle.jsonValue())
    check(applied.sceneTemplateId === id, `${name} persists on the caption scene`)
    check(applied.captionSceneCount === 1, `${name} leaves exactly one caption scene`)
    check(typeof applied.grain === 'number', `${name} carries its grain prop`)
    await seekThrough(
      name,
      applied.firstWordFrame,
      Math.max(1, applied.lastWordFrame - applied.firstWordFrame)
    )
    await preview.screenshot({ path: join(SHOTS, `${id}.png`) })
    check(true, `${name} screenshot captured`)

    // Two layers drawing at once is the failure mode of the composition dispatch.
    const layers = await page.evaluate(() => document.querySelectorAll('[data-caption-style]').length)
    check(layers <= 1, `${name} draws one caption layer, not two`, `found ${layers}`)
  }

  const captionPreflight = await page.evaluate(async (id) => {
    const problems = await window.api.videoEngine.preflight(id)
    return problems.filter((problem) => problem.severity === 'error').map((problem) => problem.code)
  }, projectId)
  check(captionPreflight.length === 0, 'the captioned project passes export preflight', captionPreflight.join(', '))

  // --- the existing styles still work --------------------------------------------
  console.log('\nregression: an existing caption style still renders')
  await page.getByRole('button', { name: /Impact Pop/ }).first().click()
  await page.waitForFunction(async (id) => {
    const project = await window.api.videoEngine.project(id)
    return project.captions?.templateId === 'remotion-caption-emoji-pop'
  }, projectId, { timeout: 20_000 })
  await seekThrough('Impact Pop', 0, bound.durationFrames)
  await preview.screenshot({ path: join(SHOTS, 'regression-impact-pop.png') })
  const legacyLayers = await page.evaluate(() => document.querySelectorAll('[data-caption-style]').length)
  check(legacyLayers <= 1, 'the existing style still draws exactly one layer', `found ${legacyLayers}`)

  // --- console ------------------------------------------------------------------
  const noisy = consoleErrors.filter(
    (text) => !/Autoplay|ResizeObserver loop|DevTools|Electron Security Warning/i.test(text)
  )
  check(noisy.length === 0, 'no renderer console errors', noisy.slice(0, 3).join(' | '))
} catch (error) {
  check(false, 'run completed', String(error?.message ?? error))
} finally {
  await app?.close().catch(() => undefined)
  if (!KEEP) {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(scratchBroll, { recursive: true, force: true })
  } else {
    console.log(`\nkept: ${scratch}`)
  }
  console.log(`\n${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`)
  for (const failure of failures) console.log(`  - ${failure}`)
  exitCode = failures.length === 0 ? 0 : 1
}
process.exit(exitCode)
```

- [ ] **Step 3: Build and run it**

```bash
npm run build
node scripts/e2e-new-templates.mjs
```

Expected: `PASS`, and eleven PNGs in `browser-test-out/new-templates/`.

- [ ] **Step 4: Fix what it finds, and iterate**

The likely first failures and what each means:

- **A card is not found.** The accordion locator resolves to the wrong `details` — there is one in each panel. Scope by the panel that is open, or by `page.locator('details.ve-newtpl').first()` after switching tabs, as above.
- **`Add this hook` throws `Unknown template property`.** A component reads a prop the manifest does not declare, or `newHookPlan` writes one it does not declare. Compare `NEW_HOOK_DEFINITIONS` against the manifest builder.
- **`hook-plan.fps-mismatch` in preflight.** `newHookPlan` wrote a different `fps` than `project.canvas.fps`.
- **A hook renders black.** Either the plan's template id did not match a dispatch branch in `NewHookScene`, or `dur` was read from `useVideoConfig().durationInFrames` instead of `scene.durationFrames` — inside a `Sequence` the former is the whole composition's length, so `T()` and the exit collapse.
- **Two caption layers.** `usesNewCaptionTemplate` returned false while the new layer's own resolve returned a style, or the `composition.tsx` conditional was added rather than substituted.
- **Text renders in the wrong face.** Task 1's imports are missing from one of the two entry points. Cinzel in a fallback face is obvious: it will show real lowercase.

- [ ] **Step 5: Look at the screenshots**

Open all eleven. Confirm for each:
- Hooks: type is present and legible, grain is visible, and Reel Burn and Margin Note show the 6-second clip behind the text rather than flat black.
- Captions: words appear, exactly one accent per frame, and no filled rectangle or pill behind any text.
- The regression shot still looks like Impact Pop.

Report anything that looks wrong with the specific template name; do not adjust numbers to taste
without saying so.

- [ ] **Step 6: Final gate**

```bash
npm run typecheck
npm test
npm run build
node scripts/e2e-new-templates.mjs
```

Expected: all four clean. Then confirm the real user data is intact:

```bash
npm run userdata:list
```

Expected: the backup point from Task 1 is listed. Report the final state; do not commit.

---

## Self-Review

**Spec coverage.**

| Spec requirement | Task |
|---|---|
| One shared definition of the ten templates | 2 |
| Ten manifests registered through `VideoTemplateRegistry`, never `BUILTIN_VIDEO_TEMPLATES` | 3 |
| Ids exactly as specified, none colliding with a caption style suffix | 2 (asserted), 3 |
| Every rendered string a declared manifest parameter | 3 (asserted), 7 |
| Ported film kit with `background`/`vignette`/`dust`; no `FootagePlate`, no `Slate` | 4 |
| Five hook components, delivered choreography, aspect-aware sizing, Hook 05 vertical stack | 5 |
| Single-beat plan through `importHookPlan`; primary line on the beat, rest in props | 5 (reader), 7 (writer) |
| `scene.tsx` new-hook branch | 5 |
| Five caption layers driven by real word timings | 6 |
| Grain continuous on the layer, no vignette, no weave; Scrim Roll scrim on the layer | 6 |
| `composition.tsx` conditional so exactly one caption layer draws | 6 |
| Three fonts declared and imported in both entry points | 1 |
| Collapsed `New Templates` accordion in both panels, CSS appended | 7 |
| Unit tests: manifests, additivity, disjoint ids, defaults, plan validity at 24/30/60fps, paging | 2, 3, 6, 7 |
| Live test: 6s footage, SRT captions, all ten applied and seeked, screenshots, preflight, isolation | 8 |
| Out of scope: HyperFrames, automation, Profiles, render performance | Global Constraints |

**Placeholders.** None. Every code step carries the code. Task 4 and Task 5 reference delivered
files that are present in the repository at `scratch/cinematic-hooks-and-captions/` and state the
exact transformations to apply, rather than deferring a decision.

**Type consistency.** `NewHookDefinition.textFields` / `.numberFields` are used with those names in
Tasks 3, 5 and 7. `NewHookDraft` fields `text` / `numbers` / `accentColor` / `grain` / `seconds`
match between `newHookDraft`, `newHookPlan` and the accordion. `ResolvedNewCaptionStyle` is the
return of `resolveNewCaptionStyle` in Task 2 and the parameter type in Task 6. `Metrics` is defined
once in Task 6 and used by all five bodies. `NewHookScene` takes `{ scene }` in both Task 5 and the
`scene.tsx` call site. `NewCaptionLayer` takes `{ project }` in both Task 6 and the
`composition.tsx` call site. `usesNewCaptionTemplate` is exported from
`new-templates/captions.tsx` and imported from that exact path in `composition.tsx`.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-08-21-cinematic-hooks-and-captions.md`.
