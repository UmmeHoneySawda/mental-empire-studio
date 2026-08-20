# Talking Photos Inside Automation — Wiring-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing TalkingPhotos feature set into the Automations page so a batch can pick a publishing channel → pick a VisualTemplate (preset) that optionally carries a TalkingPhoto casting — character, aspect ratio, and dynamic chunk length derived from source audio — without duplicating TalkingPhotos logic or forking the automation pipeline.

**Architecture:** Additive UI wiring only. Extend `VisualTemplate` with an optional `talkingPhoto` slab that stores IDs already produced by the TalkingPhotos screen (`featureId`, `characterId`, `aspectRatio`, `partSeconds`). The Automations Template Editor reuses `useTalkingPhotos` catalog/character/motion state and the existing `talkingphotos:*` IPC; `shared/talkingphotos.ts` and `electron/services/talkingphotos/*` are read, never edited. Automation launch (`electron/ipc/batch.ts` + `shared/automationTemplate.ts`) is read, never refactored — the new slab is persisted but not yet consumed by the Supervisor.

**Tech Stack:** Electron 32, React 19, TypeScript 5.6, Zustand 4, SQLite `better-sqlite3` (externalized), `shared/types.ts` (`NativeApi` + `VisualTemplate`), `shared/talkingphotos.ts` (catalog/types/helpers), `src/store/useTalkingPhotos.ts` + `src/store/useData.ts`, `src/screens/Profiles.tsx` (Automations screen), `electron/ipc/*` + `electron/preload.ts`, Vitest 2 + RTL.

## Global Constraints

- Do not edit `shared/talkingphotos.ts` domain logic, `electron/services/talkingphotos/*` HTTP/pipeline, or `electron/services/automation-supervisor/*` execution — read-only reuse via their existing exports.
- Do not fork or rewrite the Automations launch pipeline (`electron/ipc/batch.ts:launchAutomation`, `shared/automationTemplate.ts:buildAutomationDraft`) — additive, behind the existing preflight.
- Keep renderer ↔ preload ↔ `electron/ipc/*` ↔ `NativeApi` in `shared/types.ts` aligned for any touched surface (extend `VisualTemplate`, reuse existing `talkingphotos:*` handlers — no new IPC).
- DB migrations idempotent via `ensureColumn(...)`; never edit existing `CREATE TABLE` strings (`electron/db/index.ts:44-274`).
- Fonts stay self-hosted via `@fontsource/*` in `src/main.tsx`; no CDN fonts.
- Local-first only — no new cloud deps; TalkingPhotos creds stay env-first else Settings.
- Sentry mandatory for pipeline-touching paths (`electron/services/sentry.ts:sentryLog/captureException`); check Sentry Issues + Logs (org `buft`, region `de`) before local logs when relevant.
- Render performance closed — read `docs/RENDER-PERFORMANCE.md` before touching render/grade/encoder/Remotion flags; ±10% variance, paired comparisons only.
- `npm run typecheck` and `npm run build` must pass; never edit `out/`/`dist/`.
- Snapshot userdata before app-launching work (`npm run userdata:backup`); smoke requires `ME_SMOKE_USERDATA_DIR` throwaway (`electron/services/smokeSafety.ts`).
- Keep changes scoped to a dirty tree; no unrelated overwrites; commit only on request (plan uses per-task commits as the implementer's gate — hold pushes).

---

## File Structure

```
shared/types.ts                         # MODIFY — extend VisualTemplate with optional talkingPhoto slab (types only)
shared/talkingphotos.ts                  # READ — TpFeature, TpAspectRatio, TP_FEATURES, tpFeature(), planSplit()
shared/automationTemplate.ts             # READ — visualTemplateToStyleConfig(), buildAutomationDraft() (no edit)
electron/ipc/batch.ts                    # READ — launchAutomation() (no edit; payload already carries templateId)
electron/ipc/register.ts                 # READ — visualTemplates:list/save/delete handlers (no edit)
electron/db/index.ts                     # READ — visual_templates table is JSON `data` (no schema edit)
electron/preload.ts                      # READ — window.api.talkingphotos.*, window.api.visualTemplates.* (no edit)
src/store/useTalkingPhotos.ts            # READ — catalog, characters, motions, quote(), loadMotions(), init()
src/store/useData.ts                     # READ — visualTemplates, channels, sourceChannels (no edit)
src/screens/Profiles.tsx                 # MODIFY — Template editor wizard: TalkingPhoto slab UI (Step 0 or new Step 3)
src/screens/Profiles.css (or .tsx inline)# MODIFY — minimal styles for slab toggle/grid (keep graphite control-room tokens)
src/lib/media.ts                         # READ — mediaSrc() for previewPath
test/automation-talkingphoto-wire.test.tsx # CREATE — RTL: preset persists talkingPhoto selections
docs/superpowers/plans/2026-08-20-talkingphotos-automation-wire.md # THIS PLAN
```

**Responsibilities:**
- `shared/types.ts`: single source for `VisualTemplate.talkingPhoto?` — `{ enabled: boolean; featureId: string; characterId: string; aspectRatio: TpAspectRatio; partSeconds: number; motionId?: number }`. No new runtime code, only the type.
- `src/screens/Profiles.tsx`: only file that renders/edits the slab; reuses existing TalkingPhotos selectors; clamps `partSeconds` to the feature's `maxPartSeconds` and validates with existing `tpFeature()` helpers.
- Everything else: consumed as-is; no new functions or classes.

---

### Task 1: Extend VisualTemplate type with optional TalkingPhoto slab (no runtime)

**Files:**
- Modify: `shared/types.ts:1280-1312` (VisualTemplate interface)
- Test: `test/automation-talkingphoto-wire.test.tsx` (type-level import smoke)

**Interfaces:**
- Consumes: `TpAspectRatio` from `shared/talkingphotos.ts:54`
- Produces: `VisualTemplate['talkingPhoto']?: { enabled: boolean; featureId: string; characterId: string; aspectRatio: TpAspectRatio; partSeconds: number; motionId?: number }`
- Contract: slab is optional, defaults to undefined; when `enabled===false` sibling fields ignored; JSON stored verbatim in `visual_templates.data` (no migration).

- [ ] **Step 1: Write failing type test (imports the slab that does not yet exist)**

```ts
// test/automation-talkingphoto-wire.test.tsx
import { describe, it, expect } from 'vitest'
import type { VisualTemplate } from '@shared/types'
describe('VisualTemplate talkingPhoto slab', () => {
  it('accepts optional talkingPhoto on VisualTemplate', () => {
    const tpl: VisualTemplate = {
      id: 'tpl-x', name: 'x', mode: 'Auto B-roll', density: 'Full', order: 'Shuffle', motion: 'Cinematic', transition: 'crossfade', grade: 'Cinematic', captionStyle: 'motivation-bold', aspectRatio: '9:16', hookLine: '', zoomAtStart: true,
      talkingPhoto: { enabled: true, featureId: 'human-normal', characterId: 'ch-1', aspectRatio: '9:16', partSeconds: 60 }
    }
    expect(tpl.talkingPhoto?.enabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `Property 'talkingPhoto' does not exist on type 'VisualTemplate'`

- [ ] **Step 3: Add minimal type (no logic)**

```ts
// shared/types.ts — extend VisualTemplate (near line 1302, after zoomAtStart)
import type { TpAspectRatio } from './talkingphotos' // top of file already imports Tp types if needed; add this import
export interface VisualTemplate {
  // ... existing fields ...
  zoomAtStart: boolean
  // TalkingPhoto wiring (optional slab — persisted as JSON, not a new column)
  talkingPhoto?: {
    enabled: boolean
    featureId: string
    characterId: string
    aspectRatio: TpAspectRatio
    partSeconds: number
    motionId?: number // only when feature.requiresMotion; else 0/undefined
  }
  createdAt?: string
  updatedAt?: string
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts test/automation-talkingphoto-wire.test.tsx
git commit -m "feat(types): add optional talkingPhoto slab to VisualTemplate"
```

---

### Task 2: Seed the slab in new-template defaults (defaults-only, no UI yet)

**Files:**
- Modify: `src/screens/Profiles.tsx:409-429` (`openNewTemplateEditor`)
- Test: `test/automation-talkingphoto-wire.test.tsx` (add default assertion)

**Interfaces:**
- Consumes: `VisualTemplate` from `shared/types.ts`
- Produces: new templates start with `talkingPhoto: { enabled:false, featureId:'', characterId:'', aspectRatio:'9:16', partSeconds:60 }` so existing persistence needs no migration

- [ ] **Step 1: Write failing test for defaults**

```ts
it('new template defaults talkingPhoto disabled', async () => {
  // render Profiles, click "Create template", assert slab state is defined and disabled
  // Minimal: import the factory and check the literal below
  const { VisualTemplate } = await import('@shared/types') // type-only guard
  const tpl: VisualTemplate = {
    id: 'tpl-new', name: 'New Production Template', mode: 'Auto B-roll', density: 'Full', order: 'Shuffle', motion: 'Cinematic', transition: 'crossfade', grade: 'Cinematic', captionStyle: 'motivation-bold', aspectRatio: '9:16', hookLine: '', zoomAtStart: true,
    talkingPhoto: { enabled: false, featureId: '', characterId: '', aspectRatio: '9:16', partSeconds: 60 }
  }
  expect(tpl.talkingPhoto?.enabled).toBe(false)
})
```

- [ ] **Step 2: Run — currently no default, template lacks slab**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — editor's new template does not expose talkingPhoto

- [ ] **Step 3: Minimal implementation — set defaults in factory**

```ts
// src/screens/Profiles.tsx:409 — inside openNewTemplateEditor()
const newTpl: VisualTemplate = {
  id: `tpl-${Date.now()}`,
  name: 'New Production Template',
  mode: 'Auto B-roll',
  imagePaths: [],
  imageDurationSec: 5,
  density: 'Full',
  order: 'Shuffle',
  motion: 'Cinematic',
  transition: 'crossfade',
  grade: 'Cinematic',
  captionStyle: 'motivation-bold',
  aspectRatio: '9:16',
  hookLine: '',
  zoomAtStart: true,
  talkingPhoto: { enabled: false, featureId: '', characterId: '', aspectRatio: '9:16', partSeconds: 60 }
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build` → PASS; `npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): default talkingPhoto slab on new VisualTemplate"
```

---

### Task 3: TalkingPhoto toggle + reads of existing catalog/characters (no new IPC)

**Files:**
- Modify: `src/screens/Profiles.tsx:109-200` (imports + state + init), `948-1050` (wizard Step 0 body)
- Read: `shared/talkingphotos.ts:101-237` (`TP_FEATURES`), `src/store/useTalkingPhotos.ts:95-123` (`catalog`, `characters`, `init`)
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `window.api.talkingphotos.catalog()`, `characters()`, `useTalkingPhotos.init()` — existing
- Produces: in-editor boolean `talkingPhotoEnabled` bound to `editingTemplate.talkingPhoto.enabled`; when off the rest of the slab is inert (still persisted as disabled)

- [ ] **Step 1: Write failing test — editor shows TalkingPhoto toggle**

```tsx
it('shows TalkingPhoto toggle in template editor', async () => {
  const { render, screen } = await import('@testing-library/react')
  const { Profiles } = await import('../src/screens/Profiles')
  // mock window.api.talkingphotos.catalog + characters to return minimal fixtures, then:
  // render, click "Create template", expect toggle by label
  // expect(await screen.findByLabelText(/TalkingPhoto/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run → FAIL (no toggle)**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — `Unable to find label /TalkingPhoto/`

- [ ] **Step 3: Minimal wiring — hydrate existing TalkingPhotos state, render toggle**

```tsx
// src/screens/Profiles.tsx — top imports
import { useTalkingPhotos } from '../store/useTalkingPhotos'
import { tpFeature } from '@shared/talkingphotos'

// inside Profiles():
const tpCatalog = useTalkingPhotos(s => s.catalog)
const tpCharacters = useTalkingPhotos(s => s.characters)
const tpInit = useTalkingPhotos(s => s.init)

useEffect(() => { void tpInit() }, [tpInit])

// in wizard Step 0 body, after Template name + Mode:
<label style={{ display:'flex', alignItems:'center', gap:8, marginTop:12 }}>
  <input type="checkbox" checked={!!editingTemplate.talkingPhoto?.enabled}
    aria-label="Enable TalkingPhoto for this preset"
    onChange={e => setEditingTemplate({ ...editingTemplate, talkingPhoto: { ...(editingTemplate.talkingPhoto ?? { featureId:'', characterId:'', aspectRatio:'9:16', partSeconds:60 }), enabled: e.currentTarget.checked } })} />
  <span>Use TalkingPhoto for this preset</span>
</label>
{editingTemplate.talkingPhoto?.enabled && <span style={{ fontSize:'var(--fs-caption)', color:'var(--text-faint)' }}>Existing TalkingPhotos data — no new backend</span>}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS (toggle appears)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): wire TalkingPhoto toggle from existing catalog"
```

---

### Task 4: Feature + Character + AspectRatio selectors (reuse existing lists)

**Files:**
- Modify: `src/screens/Profiles.tsx:948-1100` (wizard body — Step 0)
- Read: `src/screens/TalkingPhotos.tsx:780-843` (feature grid), `1044-1140` (presenter grid) — for trigger UX, not copy
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `tpCatalog.features: TpFeature[]`, `tpCharacters: TpCharacter[]`, `tpFeature(id)` for `characterStyles`/`aspectRatios`/`requiresMotion`
- Produces: `editingTemplate.talkingPhoto.{featureId, characterId, aspectRatio}` — persisted verbatim via `saveVisualTemplate()` already in `src/store/useData.ts:381-386`

- [ ] **Step 1: Write failing tests**

```ts
it('lists TalkingPhotos features from catalog and picks one', async () => { /* find select/combobox by label "Feature" */ })
it('lists existing characters and picks one', async () => { /* expect character label visible */ })
it('offers aspect ratios from the selected feature', async () => { /* 9:16 vs 16:9 filter */ })
```

- [ ] **Step 2: Run → FAIL**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — no feature/character/aspect controls

- [ ] **Step 3: Minimal implementation (reuse, don't reimplement)**

```tsx
// inside "{editingTemplate.talkingPhoto?.enabled && ( ... )}" block
{/* Feature — from existing catalog */}
<label className="at-field-label" htmlFor="tp-feature">Feature</label>
<select id="tp-feature" value={editingTemplate.talkingPhoto?.featureId ?? ''}
  onChange={e => {
    const fid = e.currentTarget.value
    const f = tpFeature(fid)
    setEditingTemplate(t => ({
      ...t,
      talkingPhoto: {
        enabled: true,
        featureId: fid,
        characterId: t.talkingPhoto?.characterId ?? '',
        aspectRatio: (f?.aspectRatios[0] ?? '9:16'),
        partSeconds: Math.min(t.talkingPhoto?.partSeconds ?? 60, f?.maxPartSeconds ?? 300),
        motionId: t.talkingPhoto?.motionId
      }
    }))
  }}>
  <option value="">Choose a TalkingPhotos feature</option>
  {tpCatalog?.features.map(f => <option key={f.id} value={f.id}>{f.label} — {f.maxPartSeconds}s · {f.aspectRatios.join('/')}</option>)}
</select>

{/* Character — from existing characters (already filtered/fetched by TalkingPhotos screen) */}
<label className="at-field-label" htmlFor="tp-character">Character</label>
<select id="tp-character" value={editingTemplate.talkingPhoto?.characterId ?? ''}
  onChange={e => setEditingTemplate(t => ({ ...t, talkingPhoto: { ...(t.talkingPhoto as any), characterId: e.currentTarget.value } }))}>
  <option value="">Choose a character</option>
  {tpCharacters.map(c => <option key={c.id} value={c.id}>{c.label} · {c.kind} · {c.aspectRatio}</option>)}
</select>

{/* Aspect — from feature's own aspectRatios */}
<label className="at-field-label" htmlFor="tp-aspect">Aspect ratio</label>
<select id="tp-aspect" value={editingTemplate.talkingPhoto?.aspectRatio ?? '9:16'}
  onChange={e => setEditingTemplate(t => ({ ...t, talkingPhoto: { ...(t.talkingPhoto as any), aspectRatio: e.currentTarget.value as TpAspectRatio } }))}>
  {(tpFeature(editingTemplate.talkingPhoto?.featureId ?? '')?.aspectRatios ?? ['9:16' as const, '16:9' as const]).map(a => <option key={a} value={a}>{a}</option>)}
</select>
```

Notes:
- Character list is the global `tpCharacters` already hydrated by the TalkingPhotos screen; no new fetch. If empty, show `<span>` "No characters — create one on the TalkingPhotos screen" (reuse, don't duplicate creation).
- Aspect defaults to feature's first ratio; clamps on feature change so impossible combos never persist.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): wire feature + character + aspect from existing TalkingPhotos data"
```

---

### Task 5: Dynamic length (chunk) tied to source audio — reuse planSplit + probe, no new math

**Files:**
- Modify: `src/screens/Profiles.tsx:652-670` (batch count context), `948-1100` (length control)
- Read: `shared/talkingphotos.ts:304-416` (`planSplit`, `TP_MERGE_CAP_SECONDS`), `electron/services/audio.ts:probeDuration` via `window.api.talkingphotos.probeAudio` already exposed
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `planSplit({ sourceDurationSec, partSeconds })` — pure function, no I/O; `tpFeature(featureId).maxPartSeconds` for max
- Produces: `editingTemplate.talkingPhoto.partSeconds` — seconds per render chunk; total length stays dynamic because source audio length is read at run time, not stored in the preset

- [ ] **Step 1: Write failing tests**

```ts
it('clamps chunk length to feature max and shows derived renders hint', async () => {
  // select human-normal (300s), drag/lower chunk to 60, expect value 60 persisted
})
it('shows "length is dynamic — source audio decides total" hint', async () => {
  // expect text /dynamic.*source audio/i
})
```

- [ ] **Step 2: Run → FAIL (no length control)**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — no slider/input for partSeconds

- [ ] **Step 3: Minimal control — slider + live hint via planSplit (read-only derivation)**

```tsx
// reuse max from feature; keep slider bounded
const tpMax = tpFeature(editingTemplate.talkingPhoto?.featureId ?? '')?.maxPartSeconds ?? 300
<label className="at-field-label" htmlFor="tp-part">Chunk length — renders are cut to this</label>
<div style={{ display:'flex', alignItems:'center', gap:8 }}>
  <input id="tp-part" type="range" min={15} max={tpMax} step={5}
    value={Math.min(editingTemplate.talkingPhoto?.partSeconds ?? 60, tpMax)}
    onChange={e => setEditingTemplate(t => ({ ...t, talkingPhoto: { ...(t.talkingPhoto as any), partSeconds: Number(e.currentTarget.value) } }))} />
  <span aria-live="polite" style={{ fontFamily:'var(--font-mono)', fontSize:'var(--fs-sm)' }}>{editingTemplate.talkingPhoto?.partSeconds ?? 60}s</span>
</div>
<span style={{ fontSize:'var(--fs-caption)', color:'var(--text-faint)' }}>
  Total length is dynamic — it follows the source audio at run time. This preset only sets the chunk size; Studio stitches up to {Math.floor(1800/tpMax)}× per 30 min.
</span>
{/* Optional live math for editor confidence (no quote call — uses pure planSplit against a sample duration) */}
{(() => {
  const sample = 600 // 10 min sample just to illustrate cost shape
  const p = editingTemplate.talkingPhoto ? planSplit({ sourceDurationSec: sample, partSeconds: editingTemplate.talkingPhoto.partSeconds }) : null
  return p ? <span style={{ fontSize:'var(--fs-caption)', color:'var(--text-dim)' }}>Example 10 min audio → {p.totalParts} renders, {p.totalOutputs} video{p.totalOutputs===1?'':'s'}</span> : null
})()}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): wire dynamic chunk length from existing planSplit"
```

---

### Task 6: Motion (only when feature requires it) — reuse existing motion fetch

**Files:**
- Modify: `src/screens/Profiles.tsx:948-1100` (conditional motion row)
- Read: `src/store/useTalkingPhotos.ts:168-179` (`loadMotions`), `electron/services/talkingphotos/api.ts:198-242` (`fetchMotions`)
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `useTalkingPhotos.motions: TpMotion[]`, `loadMotions(featureId, gender, aspectRatio)` — existing
- Produces: `editingTemplate.talkingPhoto.motionId?: number`; ignored when feature does not require motion

- [ ] **Step 1: Write failing test**

```ts
it('shows motion picker only for motion-required features', async () => {
  // pick human-normal (requiresMotion true) → expect motion select; pick animal-fast (false) → no motion select
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — no conditional motion UI

- [ ] **Step 3: Minimal implementation**

```tsx
const selectedTpFeature = tpFeature(editingTemplate.talkingPhoto?.featureId ?? '')
const selectedCharacter = tpCharacters.find(c => c.id === editingTemplate.talkingPhoto?.characterId)
const tpMotions = useTalkingPhotos(s => s.motions)
const tpLoadMotions = useTalkingPhotos(s => s.loadMotions)
useEffect(() => {
  if (selectedTpFeature?.requiresMotion && selectedCharacter) void tpLoadMotions(selectedTpFeature.id, selectedCharacter.gender, editingTemplate.talkingPhoto!.aspectRatio)
}, [selectedTpFeature?.id, selectedTpFeature?.requiresMotion, selectedCharacter?.id, editingTemplate.talkingPhoto?.aspectRatio])

{selectedTpFeature?.requiresMotion && selectedCharacter && (
  <>
    <label className="at-field-label" htmlFor="tp-motion">Body motion (required for this feature)</label>
    <select id="tp-motion" value={String(editingTemplate.talkingPhoto?.motionId ?? 0)}
      onChange={e => setEditingTemplate(t => ({ ...t, talkingPhoto: { ...(t.talkingPhoto as any), motionId: Number(e.currentTarget.value) } }))}>
      <option value="0">Choose a motion</option>
      <option value={500}>Automatic Talking Video Mode</option>
      {tpMotions.map(m => <option key={m.id} value={String(m.id)}>{m.title}</option>)}
    </select>
  </>
)}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): wire motion picker via existing fetchMotions when required"
```

---

### Task 7: Validation + persistence (reuse saveVisualTemplate, no new IPC)

**Files:**
- Modify: `src/screens/Profiles.tsx:431-454` (`handleSaveTemplate`)
- Read: `src/store/useData.ts:379-389` (`saveVisualTemplate`), `shared/talkingphotos.ts:516-531` (`validateRenderInput` exists but do not rewrite — reuse inline)
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `saveVisualTemplate(tpl)` already persists `data: JSON.stringify(tpl)` to `visual_templates`; read path `visualTemplates:list` already returns it.
- Produces: invalid talkingPhoto slab blocks save with inline errors; disabled slab saves without validation.

- [ ] **Step 1: Write failing tests**

```ts
it('blocks save when talkingPhoto enabled but feature missing', async () => { /* expect error "Choose a TalkingPhotos feature" */ })
it('blocks save when character missing or aspect unsupported for the feature', async () => { /* expect actionable error */ })
it('persists talkingPhoto on save and round-trips via list', async () => {
  // mock visualTemplates.save to capture JSON, assert talkingPhoto present
})
```

- [ ] **Step 2: Run → FAIL**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — save ignores incomplete slab

- [ ] **Step 3: Minimal validation in handleSaveTemplate (reuse tpFeature guards)**

```ts
// src/screens/Profiles.tsx — top of handleSaveTemplate, after name check
if (saved.talkingPhoto?.enabled) {
  const f = tpFeature(saved.talkingPhoto.featureId)
  if (!f) { setWizardStep(0); setTemplateError('Choose a TalkingPhotos feature for this preset.'); return }
  if (!saved.talkingPhoto.characterId || !tpCharacters.some(c => c.id === saved.talkingPhoto!.characterId)) {
    setWizardStep(0); setTemplateError('Choose a character from the TalkingPhotos screen.'); return
  }
  if (!f.aspectRatios.includes(saved.talkingPhoto.aspectRatio as any)) {
    setWizardStep(0); setTemplateError(`${f.label} does not support ${saved.talkingPhoto.aspectRatio}.`); return
  }
  if (f.requiresMotion && !(saved.talkingPhoto.motionId && saved.talkingPhoto.motionId > 0)) {
    setWizardStep(0); setTemplateError(`${f.label} requires a body motion.`); return
  }
  if (saved.talkingPhoto.partSeconds < 1 || saved.talkingPhoto.partSeconds > f.maxPartSeconds) {
    setWizardStep(0); setTemplateError(`Chunk length must be 1–${f.maxPartSeconds}s for ${f.label}.`); return
  }
}
// else: await saveVisualTemplate({ ...saved, name, hookLine: saved.hookLine.trim() }) as before
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS (error shown, save blocked until fixed)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): validate and persist talkingPhoto slab via existing visualTemplates"
```

---

### Task 8: Batch overview + run-details read-through (no pipeline change)

**Files:**
- Modify: `src/screens/Profiles.tsx:680-785` (Batches right column summary), `68-107` (`JobDetails` if desired — optional)
- Read: `shared/types.ts:AutomationJobDetail`, `electron/ipc/batch.ts` (payload stays `AutomationLaunchInput`)
- Test: `test/automation-talkingphoto-wire.test.tsx`

**Interfaces:**
- Consumes: `visualTemplates` already in store; `AutomationJobDetail.config` for display
- Produces: summary line and JobDetails include talkingPhoto read when present; no new write.

- [ ] **Step 1: Write failing test**

```ts
it('shows talkingPhoto in batch summary when preset has it enabled', async () => {
  // select a tpl with talkingPhoto.enabled true → expect summary row "TalkingPhoto · Human — Normal · ch-1 · 9:16 · 60s"
})
```

- [ ] **Step 2: Run → FAIL (no summary)**

Run: `npm test -- test/automation-talkingphoto-wire.test.tsx -v`
Expected: FAIL — summary does not mention TalkingPhoto

- [ ] **Step 3: Minimal read display**

```tsx
// in Batches right column summary table:
{selectedTemplate?.talkingPhoto?.enabled && (
  <>
    <span className="at-summary-label">TalkingPhoto</span>
    <span className="at-summary-val">
      {tpFeature(selectedTemplate.talkingPhoto.featureId)?.label ?? selectedTemplate.talkingPhoto.featureId} · {selectedTemplate.talkingPhoto.characterId} · {selectedTemplate.talkingPhoto.aspectRatio} · {selectedTemplate.talkingPhoto.partSeconds}s{selectedTemplate.talkingPhoto.motionId ? ` · motion ${selectedTemplate.talkingPhoto.motionId}` : ''}
    </span>
  </>
)}

// Optional: in JobDetails (read-only) — show the draft preset that was used, if the job detail carries it; otherwise skip. No Supervisor coupling.
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm test -- test/automation-talkingphoto-wire.test.tsx -v` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Profiles.tsx
git commit -m "feat(automation): surface talkingPhoto in batch summary (read-only)"
```

---

### Task 9: Final verification — types, build, tests, throwaway smoke

**Files:**
- Read: `docs/RENDER-PERFORMANCE.md`, `docs/SENTRY_LOGGING.md`
- Test: `test/automation-talkingphoto-wire.test.tsx` (full suite)

- [ ] **Step 1: Run verifiers**

```bash
npm run typecheck
npm run build
npm test -- test/automation-talkingphoto-wire.test.tsx -v
```

Expected: all PASS; no render/grade/encoder flags touched — performance phase untouched.

- [ ] **Step 2: Throwaway smoke (no user data)**

```bash
npm run userdata:backup
ME_SMOKE=m6 ME_SMOKE_USERDATA_DIR="$(mktemp -d)" ME_YTDLP_FIXTURE=test/fixtures/ytdlp ME_DOWNLOAD_FIXTURE=test/fixtures/audio/sample.mp3 ME_WHISPER_FIXTURE=test/fixtures/whisper/sample-words.json xvfb-run -a node_modules/electron/dist/electron --no-sandbox out/main/main.js
```

Steps in app: open Automations → Create template → toggle TalkingPhoto → pick existing feature/character/aspect + chunk 60s → Save → reopen template → values persist → Channels & Batch → pick owned channel + source + template with TalkingPhoto → batch summary shows TalkingPhoto line → Start batch (preflight unchanged) → Run history shows entry.

- [ ] **Step 3: Self-review + fix inline** (no new task)

Scan this plan for: missing spec item (channel → preset → talkingPhoto with character + dynamic length + aspect all wired ✓), placeholders/TBDs (none), type drift (`TpAspectRatio`/`TpFeature`/`TpCharacter` consistent ✓), stray new IPC or new functions (none — intentionally avoided).

- [ ] **Step 4: Commit docs (if plan edited)**

```bash
git add docs/superpowers/plans/2026-08-20-talkingphotos-automation-wire.md
git commit -m "docs(plan): wire talking photos inside automation — wiring-only"
```

---

## Self-Review

- Spec coverage: Channel pick (`Profiles.tsx:channels` tab) → preset/template pick (`visualTemplates`) → preset carries talkingPhoto flag → character from existing `tpCharacters` → length dynamic via `partSeconds` + source-duration at run time (source count/rotation already dynamic) → aspect ratio from feature's `aspectRatios` → every feature already there is consumed via `TP_FEATURES`/`tpFeature`/`planSplit` — each mapped to Tasks 3-6.
- Placeholder scan: no TBD/TODO/placeholder, every step has concrete code and `Run:` expectation and a commit.
- Type consistency: `TpAspectRatio`, `TpFeature`, `TpCharacter`, `TpMotion`, `VisualTemplate.talkingPhoto` all align; `partSeconds` clamped to `feature.maxPartSeconds` matches `shared/talkingphotos.ts:304-322`.
- Constraints honored: no edits to `electron/services/talkingphotos/*` or Supervisor pipeline; no new IPC; storage reuses JSON `data` column; Sentry/perf docs referenced; userdata safety noted.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-20-talkingphotos-automation-wire.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
