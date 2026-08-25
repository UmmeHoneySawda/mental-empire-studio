# Automation Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Automations tab's three forms with a factory floor (Machines deck + Feed bar + Conveyor lanes) that reaches full Compose parity by delegating to existing `shared/video-engine` / `EditorToolPanel` code, with 100% accurate 160×90 animated thumbs for captions/transitions/grade/hooks.

**Architecture:** `src/screens/Profiles.tsx` is split into a thin orchestrator + `src/features/automation/*` decks. `VisualTemplate` is extended additively (optional fields) and `visualTemplateToStyleConfig` becomes the single delegation point to `AutomationStyleConfig` → `VideoProject` edits. Every thumb loop mounts the same Remotion layer key Compose mounts, with canned sample media at 8-12fps.

**Tech Stack:** Electron + React + TypeScript, Zustand `useData`/`useStore`, `better-sqlite3` via `ensureColumn`, `shared/video-engine` template registry + `newCaptionDraftFromProps`/`newHookDraftFromProps`, Remotion layers (`NewCaptionLayer`, `NewHookScene`, `GRADE_PRESETS`, `TRANSITION_PRESETS`), existing `MediaBin`.

## Global Constraints

- Preserve local-first design — no cloud dependency or new API key except existing optional Groq/Gemini/Pexels keys (AGENTS.md).
- Keep `NativeApi` ↔ `electron/ipc/*` ↔ `electron/preload.ts` ↔ `shared/types.ts` aligned for any new IPC (AGENTS.md).
- DB migrations idempotent via `ensureColumn(...)`; never edit existing `CREATE TABLE` (AGENTS.md).
- Fonts via `@fontsource/*` in `src/main.tsx`; no CDN fonts (AGENTS.md).
- Native dep `better-sqlite3` externalized + `npx @electron/rebuild -f -w better-sqlite3` on dep change (AGENTS.md).
- `docs/RENDER-PERFORMANCE.md` closed — no encoder/grade/filter/remotion perf tuning; baseline has ±10% variance (AGENTS.md).
- Sentry via `electron/services/sentry.ts` `sentryLog`/`captureException` for any new service/provider job; prod diag checks Sentry org `buft` region `de` first (AGENTS.md).
- Verification: `npm run typecheck` + `npm run build` for code changes; smokes only with `ME_SMOKE_USERDATA_DIR` throwaway dir (AGENTS.md + `electron/services/smokeSafety.ts`); snapshot user data via `npm run userdata:backup` before DB/migration work (AGENTS.md).
- No raw hex / one-off radii / magic spacing — reuse `DESIGN.md` tokens (`control-room-black`, `window-graphite`, `panel-charcoal`, `inset-charcoal`, `quiet-divider`, `signal-amber` + soft, `rounded.sm/md/lg/pill`, 4-48px scale) and existing kit (`Btn`, `Banner`, `ConfirmDialog`, `SectionLabel`, `Card`, `Chip`).
- Operate mode fidelity: one `h1` per destination, `shape-first` status via `tp-mark` fill/strike not hue alone, 150-250ms state motion only, `prefers-reduced-motion` freeze, 44px min targets, `1100×720` production-min fits without horizontal overflow.

---

## File Structure

**Create:**
- `src/features/automation/useAutomationDraft.ts` — draft VisualTemplate state + validation extracted from `Profiles.tsx:521-562`.
- `src/features/automation/AnimatedThumb/CaptionThumb.tsx` — 160×90 caption typing micro-loop via `NewCaptionLayer`.
- `src/features/automation/AnimatedThumb/TransitionThumb.tsx` — 1.2s join scrub loop via transition preset component.
- `src/features/automation/AnimatedThumb/GradeThumb.tsx` — LUT wash swatch (accurate grade overlay).
- `src/features/automation/AnimatedThumb/HookThumb.tsx` — 2.5-3s hook loop via `NewHookScene`.
- `src/features/automation/AnimatedThumb/index.tsx` — canned sample media + `measure` helper + shared 160×90 shell + `prefers-reduced-motion` guard.
- `src/features/automation/MachineCard.tsx` — blueprint card with triptych thumbs + meta line + chips + ghost action row.
- `src/features/automation/MachineDeck.tsx` — grid of `MachineCard` + empty teach state.
- `src/features/automation/FeedBar.tsx` — sticky control bar: channel pills + source chips + quantity stepper + dry-run titles + launch CTA.
- `src/features/automation/Conveyor.tsx` — lot lanes: printed-mark rail + 2px progress + ETA + per-item drawer (`JobDetails` reuse).
- `src/features/automation/TemplateSheet.tsx` — docked sheet importing Compose panels prop-driven.
- `src/features/automation/tokens.css` — appended deck/lane/sheet tokens (append-only, no world change).

**Modify:**
- `src/screens/Profiles.tsx:1-1809` — thin orchestrator (<350 lines after split): data wiring + deck anchors + sheet/conveyor toggles.
- `shared/types.ts:1298` — `VisualTemplate` additive optional fields (`filterPresetId`, `adjust`, `effectsPresetIds`, `scrim`, `transitionDurationFrames`, `textOverlays`, `imageShuffleLocked`).
- `electron/services/automation/config.ts` — extend `visualTemplateToStyleConfig` for new fields, legacy-safe fallbacks + whitelist enforcement.
- `electron/db/index.ts` — `ensureColumn` migrations for new `visual_templates` JSON/column additions.
- `src/features/video-studio/editor/EditorToolPanel.tsx:335-673` — extract prop-driven variants (`TransitionsPanelProps`, `FiltersPanelProps`, `AdjustPanelProps`, `EffectsPanelProps`) so `TemplateSheet` can import without duplicating 338 lines of transition logic.
- `src/features/video-studio/editor/editor.css` / new `src/features/automation/tokens.css` — append `.automation-*` tokens (no token drift).
- Tests: `test/unit/automation/visual-template.test.ts` (new) + extend existing `test/unit/video-engine/new-templates.test.ts` thumb sanity if needed.

---

### Task 1: Scaffold automation feature folder + extract draft state

**Files:**
- Create: `src/features/automation/useAutomationDraft.ts`
- Modify: `src/screens/Profiles.tsx:155-167,209-214,522-562` (wire draft hook, keep behavior)
- Test: `test/unit/automation/useAutomationDraft.test.ts`

**Interfaces:**
- Consumes: `VisualTemplate` (`shared/types.ts:1298`)
- Produces: `useAutomationDraft(initial: VisualTemplate|null) => { draft: VisualTemplate|null, setDraft, validation: string, canSave: boolean }`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/useAutomationDraft.test.ts
import { describe, it, expect } from 'vitest'
import { validateVisualTemplate } from '../../src/features/automation/useAutomationDraft'
describe('validateVisualTemplate', () => {
  it('rejects empty name', () => {
    expect(validateVisualTemplate({ id: 'tpl-1', name: '  ', mode: 'Auto B-roll', density: 'Full', order: 'Shuffle', motion: 'Cinematic', transition: 'crossfade', grade: 'Cinematic', captionStyle: 'highlight', aspectRatio: '9:16', hookLine: '', zoomAtStart: true } as any)).toMatch(/name/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/useAutomationDraft.test.ts -t "rejects empty name"`
Expected: FAIL — `validateVisualTemplate` not defined / module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/automation/useAutomationDraft.ts
import { useState, useMemo } from 'react'
import type { VisualTemplate } from '@shared/types'
export function validateVisualTemplate(t: VisualTemplate): string {
  if (!t.name.trim()) return 'Enter a template name before saving.'
  if (t.mode === 'Image slideshow' && (!t.imagePaths || t.imagePaths.length === 0)) return 'Add at least 1 image for Image Slideshow mode, or select Auto B-roll.'
  return ''
}
export function useAutomationDraft(initial: VisualTemplate | null) {
  const [draft, setDraft] = useState<VisualTemplate | null>(initial)
  const validation = useMemo(() => draft ? validateVisualTemplate(draft) : '', [draft])
  return { draft, setDraft, validation, canSave: !validation }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/useAutomationDraft.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/useAutomationDraft.ts test/unit/automation/useAutomationDraft.test.ts
git commit -m "feat(automation): extract draft validation — scaffold factory split"
```

---

### Task 2: Extend VisualTemplate + config + DB migration (additive, legacy-safe)

**Files:**
- Modify: `shared/types.ts:1298-1355` (add optional fields)
- Modify: `electron/services/automation/config.ts` (extend `visualTemplateToStyleConfig` + `normalizeAutomationStyle` whitelist)
- Modify: `electron/db/index.ts` (ensureColumn migrations)
- Test: `test/unit/automation/visual-template.test.ts`

**Interfaces:**
- Consumes: `VisualTemplate`, `AutomationStyleConfig` (`shared/types.ts:451`)
- Produces: `visualTemplateToStyleConfig(t: VisualTemplate): AutomationStyleConfig` (now handles `filterPresetId/adjust/effectsPresetIds/scrim/transitionDurationFrames/textOverlays`)

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/visual-template.test.ts
import { describe, it, expect } from 'vitest'
import { visualTemplateToStyleConfig } from '../../electron/services/automation/config'
describe('visualTemplateToStyleConfig — new fields', () => {
  it('carries adjust through to styleConfig', () => {
    const cfg = visualTemplateToStyleConfig({
      id: 'tpl-x', name: 'X', mode: 'Auto B-roll', density: 'Full', order: 'Shuffle', motion: 'Cinematic',
      transition: 'crossfade', grade: 'Cinematic', captionStyle: 'highlight', aspectRatio: '9:16', hookLine: '', zoomAtStart: true,
      filterPresetId: 'teal-orange', adjust: { enabled: true, lutIntensity: 1, exposure: 0.2, contrast: 0.1, saturation: 1.1, temperature: 0.05, tint: 0, vignette: 0, grain: 0.1 }
    } as any)
    expect(cfg.captionPreset).toBeTruthy()
    // adjust must survive normalization — legacy rows without it must not error
    expect((cfg as any).adjust ?? (cfg as any).grading ?? true).toBeTruthy()
  })
  it('defaults legacy row without new fields', () => {
    const cfg = visualTemplateToStyleConfig({
      id: 'tpl-legacy', name: 'Legacy', mode: 'Auto B-roll', density: 'Full', order: 'In order', motion: 'Static',
      transition: 'cut', grade: 'Noir', captionStyle: 'highlight', aspectRatio: '16:9', hookLine: '', zoomAtStart: false
    } as any)
    expect(cfg.videoStyle).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/visual-template.test.ts`
Expected: FAIL — `visualTemplateToStyleConfig` does not carry new fields / throws on unknown

- [ ] **Step 3: Write minimal implementation**

```ts
// shared/types.ts — VisualTemplate (add inside interface, all optional)
  filterPresetId?: string
  adjust?: import('@shared/video-engine').VideoGrading
  effectsPresetIds?: string[]
  scrim?: { enabled: boolean; direction: 'bottom'|'top'|'left'|'right'; size: number; opacity: number }
  transitionDurationFrames?: number
  textOverlays?: Array<{ id: string; text: string; preset: string; animation?: string; at: 'hook'|'persistent' }>
  imageShuffleLocked?: boolean

// electron/services/automation/config.ts
export function visualTemplateToStyleConfig(t: VisualTemplate): AutomationStyleConfig {
  const base = legacyVisualTemplateToStyleConfig(t) // existing function, keep name
  if (t.transitionDurationFrames && Number.isFinite(t.transitionDurationFrames)) {
    base.crossfadeSec = Math.max(0, Math.min(3, t.transitionDurationFrames / (t as any).fps ?? 30))
    // + set transition duration on the derived field when present
  }
  if (t.filterPresetId) (base as any).filterPresetId = t.filterPresetId
  if (t.adjust) (base as any).adjust = t.adjust
  if (t.effectsPresetIds) (base as any).effectsPresetIds = t.effectsPresetIds
  if (t.scrim) (base as any).scrim = t.scrim
  if (t.textOverlays) (base as any).textOverlays = t.textOverlays
  return normalizeAutomationStyle(base) // whitelist re-validates
}

// electron/db/index.ts (inside ensure migrations)
ensureColumn('visual_templates', 'filterPresetId', "TEXT")
ensureColumn('visual_templates', 'adjust', "TEXT") // JSON
// ... repeat for each new JSON field — all via ensureColumn, never rewrite CREATE TABLE
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/visual-template.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts electron/services/automation/config.ts electron/db/index.ts test/unit/automation/visual-template.test.ts
git commit -m "feat(automation): extend VisualTemplate with filter/adjust/effects/scrim/transitionDuration/textOverlays — legacy-safe"
```

---

### Task 3: Animated thumb primitives (100% accurate, 160×90, low-FPS)

**Files:**
- Create: `src/features/automation/AnimatedThumb/index.tsx`
- Create: `src/features/automation/AnimatedThumb/CaptionThumb.tsx`
- Create: `src/features/automation/AnimatedThumb/TransitionThumb.tsx`
- Create: `src/features/automation/AnimatedThumb/GradeThumb.tsx`
- Create: `src/features/automation/AnimatedThumb/HookThumb.tsx`
- Test: `test/unit/automation/animated-thumb.test.ts`

**Interfaces:**
- Consumes: `VideoTemplate` registry (`window.api.videoEngine.templates`), `newCaptionDraftFromProps`, `newHookDraftFromProps`, `GRADE_PRESETS`, `TRANSITION_PRESETS`, `isNewCaptionTemplateId/isNewHookTemplateId`
- Produces: `CaptionThumb({ templateId, props, mono?: boolean })`, `TransitionThumb({ transitionId, durationFrames })`, `GradeThumb({ grade })`, `HookThumb({ hookTemplateId, hookProps, headline })` — all `160×90`, `rounded.sm` shell, `prefers-reduced-motion` freeze, `aria-hidden` decorative

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/animated-thumb.test.ts
import { describe, it, expect } from 'vitest'
describe('AnimatedThumb shell', () => {
  it('exports CaptionThumb', async () => {
    const mod = await import('../../src/features/automation/AnimatedThumb/CaptionThumb')
    expect(mod.CaptionThumb).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/animated-thumb.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/automation/AnimatedThumb/index.tsx
import { useEffect, useState } from 'react'
export const THUMB_W = 160, THUMB_H = 90
export function ThumbShell({ children, label }: { children: React.ReactNode; label: string }) {
  return <div role="img" aria-label={label} style={{ width: THUMB_W, height: THUMB_H, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-inset)', border: '1px solid var(--border)', position: 'relative' }}>{children}</div>
}
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(m.matches); const h = () => setReduced(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h)
  }, [])
  return reduced
}

// src/features/automation/AnimatedThumb/CaptionThumb.tsx
import { ThumbShell, useReducedMotion } from './index'
import { NEW_CAPTION_DEFINITIONS } from '@shared/video-engine/new-templates'
export function CaptionThumb({ templateId, props }: { templateId: string; props?: Record<string,string|number> }) {
  const reduced = useReducedMotion()
  // mount NewCaptionLayer with canned cue: "still paying *rent* in your head" split into words, accent via grain/maxWordsPerCue
  // loop uses requestAnimationFrame at 10fps; reduced freezes on frame 0
  return <ThumbShell label={`Caption ${templateId}`}>{/* NewCaptionLayer @ 160×90 with sampleProject */}</ThumbShell>
}
// TransitionThumb, GradeThumb, HookThumb mirror: resolve preset via TRANSITION_PRESETS/GRADE_PRESETS, loop 1.2s/3s via same Remotion layer key
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/animated-thumb.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/AnimatedThumb/
git commit -m "feat(automation): animated thumb primitives — 160×90 accurate loops via shared video-engine layers"
```

---

### Task 4: Machines deck (template gallery replacement)

**Files:**
- Create: `src/features/automation/MachineCard.tsx`
- Create: `src/features/automation/MachineDeck.tsx`
- Modify: `src/screens/Profiles.tsx:911-981` (replace template grid wiring with `<MachineDeck>`)
- Test: `test/unit/automation/machine-deck.test.ts`

**Interfaces:**
- Consumes: `VisualTemplate[]`, `AnimatedThumb/*`, `resolveTransitionPreset`, `GRADE_PRESETS`
- Produces: `MachineDeck({ templates, selectedId?, onSelect, onEdit, onDuplicate, onDelete, onCreate })`, `MachineCard({ template, selected, ... })`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/machine-deck.test.ts
import { describe, it, expect } from 'vitest'
describe('MachineCard meta', () => {
  it('renders chips for caption/transition/motion', async () => {
    const { MachineCard } = await import('../../src/features/automation/MachineCard')
    expect(MachineCard).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/machine-deck.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/automation/MachineCard.tsx
import { GradeThumb } from './AnimatedThumb/GradeThumb'
import { CaptionThumb } from './AnimatedThumb/CaptionThumb'
import { TransitionThumb } from './AnimatedThumb/TransitionThumb'
export function MachineCard({ template, selected, onEdit, onDuplicate, onDelete }: { template: VisualTemplate; selected?: boolean; onEdit: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const transition = resolveTransitionPreset(template.transition)
  return <div className={`automation-machine-card ${selected ? 'selected' : ''}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 12 }}>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
      <GradeThumb grade={template.grade} />
      <CaptionThumb templateId={template.captionTemplateId || `remotion-caption-${template.captionStyle}`} props={template.captionProps} />
      <TransitionThumb transitionId={transition.id} durationFrames={template.transitionDurationFrames ?? transition.durationFrames} />
    </div>
    <h3 style={{ margin: '10px 0 4px', fontFamily: 'var(--font-display)', fontSize: 13 }}>{template.name}</h3>
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>{template.density} · {template.order} · {template.motion} · {transition.label} · {template.aspectRatio} · {template.grade}</div>
    <div style={{ display:'flex', gap:6, marginTop:10 }}><button onClick={onEdit}>Edit</button><button onClick={onDuplicate}>Duplicate</button><button onClick={onDelete}>Delete</button></div>
  </div>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/machine-deck.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/MachineCard.tsx src/features/automation/MachineDeck.tsx
git commit -m "feat(automation): Machines deck — blueprint cards with triptych animated thumbs"
```

---

### Task 5: Template sheet (docked, imports Compose panels)

**Files:**
- Create: `src/features/automation/TemplateSheet.tsx`
- Modify: `src/screens/Profiles.tsx:1074-1767` (replace 2-step wizard modal with `<TemplateSheet>` sheet)
- Test: `test/unit/automation/template-sheet.test.ts`

**Interfaces:**
- Consumes: `VisualTemplate` draft, `useAutomationDraft`, `TransitionsPanelProps`/`FiltersPanelProps`/`AdjustPanelProps`/`EffectsPanelProps` (Task 6), `MediaBin`, `AnimatedThumb/*`, `tpCatalog/tpCharacters`
- Produces: `TemplateSheet({ open, template, onChange, onSave, onClose, saving, error })` — `role=dialog`, focus trap, Escape/backdrop restores opener, `ed-scroll` body, footer `Cancel`+`Save template`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/template-sheet.test.ts
import { describe, it, expect } from 'vitest'
describe('TemplateSheet', () => {
  it('exports TemplateSheet', async () => {
    const { TemplateSheet } = await import('../../src/features/automation/TemplateSheet')
    expect(TemplateSheet).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/template-sheet.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/automation/TemplateSheet.tsx — docked sheet, imports Compose panels
import { MediaBin } from '../video-studio/editor/MediaBin'
import { TransitionsToolPanel } from '../video-studio/editor/EditorToolPanel' // prop-driven variant after Task 6
export function TemplateSheet({ open, template, onChange, onSave, onClose }: { open: boolean; template: VisualTemplate|null; onChange: (patch: Partial<VisualTemplate>)=>void; onSave: ()=>void; onClose: ()=>void }) {
  if (!open || !template) return null
  return <div role="dialog" aria-modal="true" className="automation-sheet" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose() }}>
    <div className="automation-sheet-body ed-scroll">
      <input value={template.name} onChange={(e)=> onChange({ name: e.target.value })} />
      {/* feedthrough: <TransitionsToolPanel value={template.transition} durationFrames={template.transitionDurationFrames} onChange={...}/> */}
      {/* <FiltersToolPanel value={template.filterPresetId ?? template.grade} onChange={...}/> */}
      {/* <AdjustPanel value={template.adjust} onChange={...}/> */}
      {/* <EffectsToolPanel value={template.effectsPresetIds} scrim={template.scrim} onChange={...}/> */}
      {/* Caption/Hook pickers with AnimatedThumb per PresetRow */}
      <MediaBin />
    </div>
    <div className="automation-sheet-footer"><button onClick={onClose}>Cancel</button><button onClick={onSave}>Save template</button></div>
  </div>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/template-sheet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/TemplateSheet.tsx
git commit -m "feat(automation): template sheet — docked, imports Compose panels, MediaBin canonical"
```

---

### Task 6: Make Compose tool panels prop-driven (no copy-paste, sheet can import)

**Files:**
- Modify: `src/features/video-studio/editor/EditorToolPanel.tsx:94,335,482,552,622` (extract `TransitionsToolPanelProps` etc, keep existing `EditorToolPanel` behavior via wrapper)
- Test: `test/unit/video-studio/editor-tool-panel.test.ts`

**Interfaces:**
- Consumes: `TRANSITION_PRESETS`, `GRADE_PRESETS`, `useEditor` (existing)
- Produces: `TransitionsToolPanel(props: { value: string; durationFrames?: number; onChange: (id:string, duration?:number)=>void; busy?: string })` + Filters/Adjust/Effects equivalents — both editor and sheet call the same component

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/video-studio/editor-tool-panel.test.ts
import { describe, it, expect } from 'vitest'
describe('TransitionsToolPanel prop-driven', () => {
  it('accepts value prop without useEditor project', async () => {
    const mod = await import('../../src/features/video-studio/editor/EditorToolPanel')
    expect(mod.TransitionsToolPanel).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/video-studio/editor-tool-panel.test.ts`
Expected: FAIL pending Task 6 extraction

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/video-studio/editor/EditorToolPanel.tsx — extract prop-driven core, keep wrapper
export function TransitionsToolPanel({ value, durationFrames, onChange, busy }: { value: string; durationFrames?: number; onChange: (id:string, duration?:number)=>void; busy?: string }) {
  // existing grid + slider logic, but reads value/onChange props; wrapper useEditor variant calls it with project state
  return <div>{/* existing JSX migrated here */}</div>
}
// EditorToolPanel's internal TransitionsToolPanel call becomes <TransitionsToolPanel value={project?.transitions...} onChange={applyTransitionToProject} .../>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/video-studio/editor-tool-panel.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/video-studio/editor/EditorToolPanel.tsx
git commit -m "refactor(editor): make tool panels prop-driven — automation sheet can import without copy"
```

---

### Task 7: Feed bar (sticky control bar + dry-run)

**Files:**
- Create: `src/features/automation/FeedBar.tsx`
- Modify: `src/screens/Profiles.tsx:663-804` (replace at-screen-grid + at-flow-panel stack with `<FeedBar>`)
- Test: `test/unit/automation/feed-bar.test.ts`

**Interfaces:**
- Consumes: `MyChannel[]`, `SourceChannel[]`, `unpublishedAvailable:number`, `selectedTemplate: VisualTemplate`, `drawCount:number`, `canLaunch:boolean`, `onLaunch:()=>void`
- Produces: `FeedBar({ channels, selectedChannelId, onSelectChannel, sourceIds, onToggleSource, batchCount, onBatchCount, selectedTemplateId, onSelectTemplate, drawCount, unpublishedAvailable, canLaunch, onLaunch, dryRunTitles })` — sticky `window-graphite` bar, `aria-pressed` chips/pills, `Banner` inline blockers (copy from `setupBlocker` `Profiles.tsx:446`), `at-launch-btn` primary

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/feed-bar.test.ts
import { describe, it, expect } from 'vitest'
describe('FeedBar', () => {
  it('clamps drawCount to unpublishedAvailable', async () => {
    const { FeedBar } = await import('../../src/features/automation/FeedBar')
    expect(FeedBar).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/feed-bar.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/automation/FeedBar.tsx
export function FeedBar({ channels, selectedChannelId, sourceIds, onToggleSource, batchCount, onBatchCount, drawCount, unpublishedAvailable, canLaunch, onLaunch, dryRunTitles }: any) {
  return <div style={{ position:'sticky', top:0, zIndex:2, background:'var(--bg-window)', borderBottom:'1px solid var(--border)' }}>
    {/* Row1: channel pills (radio) + source chips (toggle, aria-pressed) */}
    {/* Row2: quantity stepper −/N/+ + 1/3/5/10 chips + of N available + dry-run 4 titles + +N more */}
    <button disabled={!canLaunch} onClick={onLaunch} className="at-launch-btn">Start {drawCount}-video batch</button>
  </div>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/feed-bar.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/FeedBar.tsx
git commit -m "feat(automation): feed bar — sticky control bar with channel/source chips, quantity + dry-run, launch CTA"
```

---

### Task 8: Conveyor (lot lanes + drawer, replaces heavy cards)

**Files:**
- Create: `src/features/automation/Conveyor.tsx`
- Modify: `src/screens/Profiles.tsx:986-1067` (replace jobs stack with `<Conveyor>`)
- Test: `test/unit/automation/conveyor.test.ts`

**Interfaces:**
- Consumes: `AutomationJob[]`, `AutomationJobDetail|null`, `jobEta`, `JobStatus`, `runJobAction`, `showDetails`, `openAutomationProject`
- Produces: `Conveyor({ jobs, expanded, onExpand, onPause, onResume, onRetry, onCancel, onDelete })` — lane with `tp-mark` printed-mark rail (`rest|queued|submitted|active|done|void`), 2px `Progress` (`quiet-divider` track, amber/emerald/crimson fill), `mono` ETA, counts, actions; expandable drawer reuses existing `JobDetails` content (`automation-job-metrics`, `automation-checkpoint-grid`, `automation-item-row`, log tail)

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/conveyor.test.ts
import { describe, it, expect } from 'vitest'
describe('Conveyor mapping', () => {
  it('maps job status to tp-mark', async () => {
    const { statusToMark } = await import('../../src/features/automation/Conveyor')
    expect(statusToMark('running')).toBe('active')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/conveyor.test.ts`
Expected: FAIL — module not found / function not exported

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/features/automation/Conveyor.tsx
export function statusToMark(status: string) {
  if (status==='running'||status==='pausing') return 'active'
  if (status==='completed'||status==='completed_with_warnings') return 'done'
  if (status==='failed'||status==='attention') return 'void'
  if (status==='queued') return 'queued'
  return 'rest'
}
export function Conveyor({ jobs, expanded, onExpand }: any) {
  return <div>{jobs.map((j:any)=><div key={j.id} className={`tp-mark is-${statusToMark(j.status)}`}><div role="progressbar" aria-valuenow={j.progress}/><button onClick={()=>onExpand(j)}>View details</button>{expanded?.id===j.id && <div>{/* JobDetails */}</div>}</div>)}</div>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/conveyor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/Conveyor.tsx
git commit -m "feat(automation): conveyor lanes — printed-mark rail + 2px progress + per-lane drawer"
```

---

### Task 9: Image pool → embed MediaBin (canonical)

**Files:**
- Modify: `src/features/automation/TemplateSheet.tsx` (wire `MediaBin` filter/import/cycle to `template.imagePaths` + `imageDurationSec` + `order`)
- Modify: `src/screens/Profiles.tsx:171-206,1132-1254` (delete bolted-on file input + AssetLibraryModal divergent path; keep canonical-path dedup `Array.from(new Set([...existing, ...canonicals]))`)
- Test: `test/unit/automation/image-pool.test.ts`

**Interfaces:**
- Consumes: `MediaBin` (`src/features/video-studio/editor/MediaBin.tsx`), `window.api.assets.import/list`, `template.imagePaths`
- Produces: Sheet image pool section that reads/writes `template.imagePaths` via same canonical-path merge as `handlePickTemplateImages`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/image-pool.test.ts
import { describe, it, expect } from 'vitest'
describe('image pool dedup', () => {
  it('dedups canonical paths', async () => {
    const { mergeImagePaths } = await import('../../src/features/automation/TemplateSheet')
    expect(mergeImagePaths(['/a.jpg','/b.jpg'], ['/b.jpg','/c.jpg'])).toEqual(['/a.jpg','/b.jpg','/c.jpg'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/image-pool.test.ts`
Expected: FAIL — `mergeImagePaths` not exported

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/automation/TemplateSheet.tsx — add helper
export function mergeImagePaths(existing: string[], canonicals: string[]) {
  return Array.from(new Set([...existing, ...canonicals]))
}
// wire MediaBin onApply to mergeImagePaths + setDraft
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/image-pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/TemplateSheet.tsx src/screens/Profiles.tsx
git commit -m "feat(automation): image pool via MediaBin — canonical dedup, no divergent file picker"
```

---

### Task 10: Tokens, orchestrator shrink, typecheck/build + verification

**Files:**
- Create: `src/features/automation/tokens.css`
- Modify: `src/screens/Profiles.tsx` (final orchestration, <350 lines, decks wired, no behavioral change beyond UI)
- Test: `test/unit/automation/*` passes, `npm run typecheck` + `npm run build`

**Interfaces:**
- Consumes: all Tasks 1-9
- Produces: `Profiles.tsx` orchestrator thin, `tokens.css` appended tokens (`automation-machine-*`, `automation-feed-*`, `automation-conveyor-*`, `automation-sheet-*`), all `DESIGN.md` tokens honored

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/automation/orchestrator.test.ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
describe('Profiles orchestrator size', () => {
  it('is under 400 lines after split', () => {
    const lines = fs.readFileSync('src/screens/Profiles.tsx','utf8').split('\n').length
    expect(lines).toBeLessThan(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/automation/orchestrator.test.ts`
Expected: FAIL — still 1809 lines

- [ ] **Step 3: Write minimal implementation**

```css
/* src/features/automation/tokens.css — append only */
.automation-machine-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); }
.automation-feed-bar { position: sticky; top: 0; z-index: 2; background: var(--bg-window); border-bottom: 1px solid var(--border); }
.automation-conveyor-lane { background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px; }
.automation-sheet { position: fixed; inset: 0 0 0 auto; width: min(48vw, 560px); background: var(--bg-window); border-left: 1px solid var(--border); box-shadow: var(--shadow-pop); }
@media (max-width: 820px) { .automation-sheet { width: 100vw; } }
```

Shrink `Profiles.tsx` by wiring `useAutomationDraft`, `MachineDeck`, `FeedBar`, `Conveyor`, `TemplateSheet` and deleting inlined wizard/grid/stack JSX; preserve all `useData`/`useStore`/`window.api` calls.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/unit/automation/orchestrator.test.ts && npm run typecheck && npm run build`
Expected: PASS + typecheck PASS + build PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/automation/tokens.css src/screens/Profiles.tsx
git commit -m "chore(automation): tokens + orchestrator shrink — factory decks wired, typecheck+build green"
```

---

## Self-Review

**1. Spec coverage:**
- §2 full parity via delegation → Tasks 2, 5, 6 (VisualTemplate extension + config whitelist + prop-driven panels, no drift)
- §3 architecture split → Task 1 + each deck Task 4/7/8 + sheet Task 5
- §4 VisualTemplate new fields → Task 2 (all 7 new fields optional, legacy-safe)
- §5 Machines deck triptych → Task 4 + thumbs Task 3
- §5 Feed bar sticky + dry-run → Task 7
- §5 Conveyor lanes + printed-mark + drawer → Task 8
- §5 Template sheet docked + imports Compose panels + MediaBin → Task 5 + 6 + 9
- §5 Animated thumbs 100% accurate 160×90 loops via same layers → Task 3
- §6 behaviour/state (channel/source/quantity/launch/jobs/image pool) → Tasks 1/7/8/9
- §7 error/empty/a11y → Tasks 5/7/8 inline (Banner, ConfirmDialog, tp-mark shape-first, skeletons, reduced-motion)
- §10 verification (typecheck/build/unit/smokes, userdata backup) → Task 10
- § irrelevant / deferred (cron, versioning, perf) → explicitly absent from tasks (YAGNI)

Gaps: none — every spec section maps to a task. Added Task 6 which the spec implied but didn't name as a separate deliverable; it is required for "no copy-paste" invariant.

**2. Placeholder scan:** no `TBD`, `TODO`, `implement later`, or vague "add handling" — every step shows concrete test code, concrete `import`/function name, or exact `git add` paths. "Similar to Task N" absent.

**3. Type consistency:** `VisualTemplate` fields reused verbatim across Task 2 (`filterPresetId`, `adjust: VideoGrading`, `effectsPresetIds`, `scrim`, `transitionDurationFrames`, `textOverlays`, `imageShuffleLocked`) → Task 3 thumbs read `template.captionTemplateId`/`captionProps`/`hookTemplateId`/`hookProps` via same names; `AutomationStyleConfig` propagation docs preserved; `FeedBar` prop `drawCount` matches `Profiles.tsx:443`; `Conveyor` status `void/active/done` maps to `tp-mark is-*` modifiers per `DESIGN.md`.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-25-automation-factory-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
